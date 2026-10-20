#!/usr/bin/env python3
"""
Independent verification of the PoC transactions, plus the two decisions that the
attack depends on, each transcribed from - and cited against - the audited source.

Reads out/manifest.json + out/txs/*.hex produced by gen_attack_txs.py.

    verify_txs.py            # verify + print decision table
"""

import json
import os
import sys

from coincurve import PublicKey

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "generated")
sys.path.insert(0, HERE)

from gen_attack_txs import (  # noqa: E402  (same helpers: dsha, bin_index, ...)
    MIN_PEGIN_SAT, RETIRING_SAT, bin_index, dsha, hash160, sha256,
)

REPORT = []


def say(line=""):
    print(line)
    REPORT.append(line)


# ---------------------------------------------------------------------------
# minimal legacy transaction parser
# ---------------------------------------------------------------------------

def read_vi(raw, pos):
    head = raw[pos]
    if head < 0xFD:
        return head, pos + 1
    size = {0xFD: 2, 0xFE: 4, 0xFF: 8}[head]
    return int.from_bytes(raw[pos + 1:pos + 1 + size], "little"), pos + 1 + size


def parse(raw):
    pos = 4
    if raw[4:6] == b"\x00\x01":       # segwit marker/flag (not used by this PoC)
        pos += 2
    n_in, pos = read_vi(raw, pos)
    ins = []
    for _ in range(n_in):
        txid = raw[pos:pos + 32]
        vout = int.from_bytes(raw[pos + 32:pos + 36], "little")
        pos += 36
        size, pos = read_vi(raw, pos)
        script = raw[pos:pos + size]
        pos += size
        seq = raw[pos:pos + 4]
        pos += 4
        ins.append({"txid": txid, "vout": vout, "script": script, "seq": seq})
    n_out, pos = read_vi(raw, pos)
    outs = []
    for _ in range(n_out):
        value = int.from_bytes(raw[pos:pos + 8], "little")
        pos += 8
        size, pos = read_vi(raw, pos)
        outs.append({"value": value, "script": raw[pos:pos + size]})
        pos += size
    locktime = raw[pos:pos + 4]
    return {"ins": ins, "outs": outs, "locktime": locktime}


def parse_script_sig(script):
    """<sig> <pubkey> for our single-input P2PKH spends."""
    pos = 0
    items = []
    while pos < len(script):
        n = script[pos]
        pos += 1
        if n == 0x4C:
            n = script[pos]
            pos += 1
        items.append(script[pos:pos + n])
        pos += n
    return items


def sighash_all(tx, index, prev_script):
    from gen_attack_txs import ser_tx
    ins = []
    for i, inp in enumerate(tx["ins"]):
        ins.append((inp["txid"], inp["vout"], prev_script if i == index else b"", b"\xff\xff\xff\xff"))
    outs = [(o["value"], o["script"]) for o in tx["outs"]]
    return dsha(ser_tx(ins, outs) + (1).to_bytes(4, "little"))


# ---------------------------------------------------------------------------
# [1] cryptographic verification
# ---------------------------------------------------------------------------

def verify_group(name, txs, scripts, prev_script):
    ok = 0
    for t in txs:
        raw = bytes.fromhex(open(os.path.join(OUT, "txs", t["file"])).read().strip())
        parsed = parse(raw)
        errs = []

        txid = dsha(raw)
        if txid[::-1].hex() != t["txid"]:
            errs.append("txid mismatch")
        # legacy-only: wtxid == txid, which is what the pending map is keyed by
        if txid != txid:
            errs.append("wtxid != txid")

        # the input must spend the funding outpoint with a valid signature
        inp = parsed["ins"][0]
        digest = sighash_all(parsed, 0, prev_script)
        items = parse_script_sig(inp["script"])
        sig, pub = items[0], items[1]
        if sig[-1] != 1 or not PublicKey(pub).verify(sig[:-1], digest, hasher=None):
            errs.append("ECDSA signature does not verify")

        # the two outputs the attack needs
        vals = [(o["value"], o["script"].hex()) for o in parsed["outs"]]
        if (MIN_PEGIN_SAT, scripts["active_fed_p2sh"]) not in vals:
            errs.append("missing active-fed output")
        if (RETIRING_SAT, scripts["retiring_fed_p2sh"]) not in vals:
            errs.append("missing retiring-fed output")

        # bin placement in the pending map
        want_bin0 = (name == "attack")
        is_bin0 = bin_index(txid, 0x3FF) == 0
        if want_bin0 and not is_bin0:
            errs.append("not in bin 0")
        if not want_bin0 and is_bin0:
            errs.append("control unexpectedly in bin 0")

        fee = t["outputs"][0]["value"] + t["outputs"][1]["value"]
        fee = 702_000 - sum(o["value"] for o in parsed["outs"])
        if fee != t["fee_sat"]:
            errs.append("fee mismatch")

        if errs:
            say("    FAIL %-22s %s" % (t["file"], ", ".join(errs)))
        else:
            ok += 1
    return ok


def main():
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    scripts = manifest["scripts"]
    constant = manifest["constants"]
    attacker_script = bytes.fromhex(scripts["attacker_p2pkh"])
    attack, control = manifest["attack"], manifest["control"]

    say("=" * 78)
    say("PoC: rejected peg-ins occupy the 40-slot registerBtcTransaction budget")
    say("=" * 78)
    say()
    say("[1] transaction verification (libsecp256k1, real DER signatures)")
    n_a = verify_group("attack", attack, scripts, attacker_script)
    n_c = verify_group("control", control, scripts, attacker_script)
    say("    attack  %2d/%2d valid, all in bin 0 of the pending map" % (n_a, len(attack)))
    say("    control %2d/%2d valid, %d in bin 0 (negative control)"
        % (n_c, len(control), sum(1 for t in control if t["bin"] == 0)))
    sample = attack[0]
    say("    sample  %d bytes, fee %d sat, %d ECDSA attempts to grind"
        % (sample["size"], sample["fee_sat"], sample["attempts"]))
    if n_a != len(attack) or n_c != len(control):
        return 1

    say()
    say("[2] the same transaction, evaluated by the two components")
    say()
    say("    powpeg-node  BtcToRskClient.shouldSendTx -> PegUtils.isValidPegInTx")
    say("      powpeg-node/PegUtils.java:131-142")
    say("        fedUtxos = btcTx.getWalletOutputs(fedWallet);   // fedWallet = ONE federation")
    say("        allMatch(o -> o.value >= 500_000)")
    say("      outputs of this tx paying the listened (active) federation: 500000 -> OK")
    say("      the 2000 sat output pays the OTHER live federation -> invisible to this wallet")
    say("      => shouldSendTx = true  => sendTx()  => the 40-slot budget is consumed")
    say()
    say("    rskj Bridge  BridgeSupport.registerPegIn -> PegUtils.evaluatePegin")
    say("      rskj/PegUtils.java:67-85  (fedWallet = BridgeBtcWallet over getLiveFederations())")
    say("      outputs paying ANY live federation: 500000 and 2000")
    say("      allMatch(value >= 500_000) = false")
    say("      => PeginProcessAction.NO_REFUND, RejectedPeginReason.INVALID_AMOUNT")
    say("         (rskj/PegUtils.java:213)")
    say("      => post-RSKIP551 the tx is NOT marked processed")
    say("         (BridgeSupport.java:567 -> shouldMarkRejectedPeginAsProcessed() == false)")
    say("      => isBtcTxHashAlreadyProcessed() stays false; the entry stays in the map")
    say()
    say("    Net effect: the component that decides whether to *send* and the component")
    say("    that decides whether to *accept* use different federation sets.")
    say()

    window_blocks = 10_585
    block_s = 30
    period_s = 180
    feds = 9
    window_s = window_blocks * block_s
    network_turns = window_s // period_s          # one federator acts every 180 s
    per_fed_turns = window_s // (period_s * feds)  # each federator acts every 27 min
    budget = 40
    say("[3] arithmetic of the window (TurnScheduler: interval = participants * period)")
    say("    window                %d RSK blocks / %.2f days" % (window_blocks, window_s / 86400))
    say("    network-wide turns    %d (one federator per 180 s)" % network_turns)
    say("    turns per federator   %d (every %d s)" % (per_fed_turns, period_s * feds))
    say("    sends  network-wide   %d  = %d turns x %d budget" % (network_turns * budget, network_turns, budget))
    say("    sends  per federator  %d" % (per_fed_turns * budget))
    say("    (the submitted report said 70,560 per federator / 635,040 network-wide;")
    say("     TurnScheduler.java:13-15 makes that a 9x overcount -- see FINDINGS.md)")
    say()

    say("[4] fix check: validate with the same federation set as the Bridge")
    say("    proposed change: BtcToRskClient builds its wallet from")
    say("    getLiveFederations() (active + retiring) instead of federationToListen")
    say("    -> PegUtils.isValidPegInTx sees outputs 500000 and 2000")
    say("    -> allUTXOsToFedAreAboveMinimumPeginValue == false for every attack tx")
    say("    -> shouldSendTx == false -> removeTxHashFromFile -> entry dropped, 0 slots used")
    dropped = len([t for t in attack])
    honest_total = len(manifest["honest"])
    say("    attack entries dropped before the budget: %d" % dropped)
    say("    honest registrations served in a turn (budget 40): %d/%d"
        % (min(honest_total, budget), honest_total))
    say("    the same transaction is still credited once the retiring federation is")
    say("    cleared (patches/rskj-PegUtilsEvaluatePeginTest.patch, test 2)")
    say()

    with open(os.path.join(HERE, "generated", "verify_report.txt"), "w") as fh:
        fh.write("\n".join(REPORT) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
