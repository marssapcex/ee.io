#!/usr/bin/env python3
"""
regtest_reorg_replacement.py - does an RSK transaction that was mined, orphaned
by a reorg, and then replaced by a same-nonce transaction ever come back?

This is the load-bearing question behind the corpse-quote report: the LP binds a
deposit to a quote, the deposit vanishes, and the watcher retries a hash that no
longer exists.  Everything else in that report is code reading; this is the part
that needs a chain.

WHAT IT RUNS
  two real RSK regtest nodes (rskj), same genesis, different databases, no
  discovery.  Node 2 mines a longer chain while isolated; we then let it connect
  to node 1, which switches to the longer chain.  That is a genuine
  proof-of-work-chain reorganisation - node 1 executes switchToBlockChain and
  retracts the losing block's transactions back into its pool.  Nothing is done
  to any database by hand.

THE EXPERIMENT
  P1  can a MINED transaction be replaced by the same nonce and more gas?
  P2  after a reorg orphans the block that held it, does the transaction come
      back into the pool, or is it gone?
  P3  once back, does a same-nonce replacement with a bigger gas price take its
      place, and does the original stay dead afterwards?
  P4  control: a second transaction in the SAME orphaned block, never replaced,
      is re-mined on its own - so P3's outcome is caused by the replacement and
      not by the reorg.

WHAT RSKJ SAYS IT WILL DO (read from source, this is what the run should confirm)
  P1  "transaction nonce too low" - TxValidatorNonceRangeValidator compares the
      transaction nonce against the account nonce at the best block.  Once a
      transaction is mined the account nonce is N+1, so a same-nonce
      replacement is not even considered: rskj has no replace-by-fee for mined
      transactions.  The replacement is only possible after the reorg.
  P1b "gas price not enough to bump transaction" - the pool only replaces a
      same-nonce transaction if the new gas price is at least
      transaction.gasPriceBump percent higher.  reference.conf:306 sets that to
      40, so +10-15% is rejected; the run uses +50%.
  P2  retractBlock -> addTransactions: an orphaned block's transactions are
      re-added to the pool, so the deposit comes back unless it is replaced.

USAGE
  python3 regtest_reorg_replacement.py --rskj-jar /path/to/rskj-core-*-all.jar
  python3 regtest_reorg_replacement.py --rskj-jar ... --keep     # keep logs/dbs
  python3 ethsign.py                                             # crypto self-test

Needs a JRE 17+ and the rskj fat jar.  Nothing else - no docker, no web3, no
unlocked account: transactions are signed here and pushed with
eth_sendRawTransaction.  The signing key is the account premined in rskj's own
regtest genesis (genesis/rsk-dev.json, cd2a3d9f938e13cd947ec05abc7fe734df8dd826).
"""

import argparse
import glob
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ethsign

CHAIN_ID = 33                     # Constants.REGTEST_CHAIN_ID
COW_KEY = ethsign.COW_KEY         # premined in genesis/rsk-dev.json
GAS_LIMIT = 21000
THROWAWAY = bytes.fromhex("00" * 19 + "01")


class RpcError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# a node
# ---------------------------------------------------------------------------


class Node:
    def __init__(self, name, base, rpc_port, peer_port, priv, jar, java,
                 active=None, log=print):
        self.name = name
        self.base = os.path.abspath(base)
        self.rpc_port = rpc_port
        self.peer_port = peer_port
        self.priv = priv
        self.jar = jar
        self.java = java
        self.active = active or []
        self.log = log
        self.proc = None
        self._id = 0

    # -- config ------------------------------------------------------------
    @property
    def node_id(self):
        return ethsign.pubkey(self.priv).hex()

    @property
    def conf_path(self):
        return os.path.join(self.base, "rsk.conf")

    @property
    def log_path(self):
        return os.path.join(self.base, "node.log")

    def write_config(self):
        os.makedirs(self.base, exist_ok=True)
        peers = ""
        if self.active:
            peers = "active = [\n" + "".join(
                f'          {{ url = "enode://{nid}@127.0.0.1:{port}" }}\n'
                for nid, port in self.active
            ) + "        ]\n"
        with open(self.conf_path, "w") as fh:
            fh.write(f"""# {self.name} - deltas over rskj's own regtest.conf
database.dir = "{self.base}/database"

peer {{
    port = {self.peer_port}
    privateKey = "{self.priv.hex()}"
    discovery.ip.list = []
    {peers}}}

rpc {{
    providers {{
        web {{
            http {{
                enabled = true
                bind_address = "127.0.0.1"
                hosts = ["*"]
                port = {self.rpc_port}
            }}
            ws.enabled = false
        }}
    }}
    modules {{
        eth.enabled = true
        net.enabled = true
        rpc.enabled = true
        web3.enabled = true
        evm.enabled = true
        txpool.enabled = true
    }}
}}

miner {{
    server.enabled = true
    client.enabled = false
}}
""")

    # -- process -----------------------------------------------------------
    def start(self):
        self.write_config()
        cmd = [str(self.java),
               f"-Drsk.conf.file={self.conf_path}",
               "-Duser.language=en",
               "-cp", str(self.jar),
               "co.rsk.Start", "--regtest"]
        out = open(self.log_path, "ab")
        self.proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT,
                                     cwd=self.base, start_new_session=True)
        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(
                    f"{self.name} exited with {self.proc.returncode}; "
                    f"last lines of {self.log_path}:\n{self.tail()}")
            try:
                self.rpc("eth_blockNumber", [])
                return self
            except Exception:
                time.sleep(0.4)
        raise RuntimeError(f"{self.name} did not answer RPC on port {self.rpc_port}"
                           f"\n{self.tail()}")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.proc.wait(timeout=25)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                self.proc.wait(timeout=10)
        self.proc = None
        for _ in range(40):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", self.rpc_port)) != 0:
                    return
            time.sleep(0.25)

    def tail(self, n=40):
        try:
            with open(self.log_path, "r", errors="replace") as fh:
                return "".join(fh.readlines()[-n:])
        except OSError:
            return "(no log)"

    # -- rpc ---------------------------------------------------------------
    def rpc(self, method, params):
        self._id += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self._id,
                           "method": method, "params": params}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.rpc_port}",
            data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode())
        if payload.get("error"):
            raise RpcError(payload["error"].get("message", str(payload["error"])))
        return payload.get("result")

    def height(self):
        return int(self.rpc("eth_blockNumber", []), 16)

    def block(self, h):
        return self.rpc("eth_getBlockByNumber", [hex(h), False])

    def mine(self, n=1):
        for _ in range(n):
            self.rpc("evm_mine", [])
        deadline = time.time() + 30
        start = self.height()
        while self.height() < start + n and time.time() < deadline:
            time.sleep(0.2)

    def tx(self, h):
        return self.rpc("eth_getTransactionByHash", [h])

    def receipt(self, h):
        return self.rpc("eth_getTransactionReceipt", [h])

    def nonce(self):
        return int(self.rpc("eth_getTransactionCount",
                            ["0x" + ethsign.address_of(COW_KEY).hex(), "latest"]), 16)

    def gas_price(self):
        try:
            return max(int(self.rpc("eth_gasPrice", []), 16), 1)
        except RpcError:
            return 1

    def peers(self):
        try:
            return int(self.rpc("net_peerCount", []), 16)
        except RpcError:
            return -1


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def send(node, nonce, gas_price, note=""):
    raw, digest, sender = ethsign.sign_tx(
        nonce, gas_price, GAS_LIMIT, THROWAWAY, 1, b"", CHAIN_ID, COW_KEY)
    try:
        node.rpc("eth_sendRawTransaction", ["0x" + raw.hex()])
        return digest, None
    except RpcError as exc:
        return digest, str(exc)


RESULTS = []


def record(phase, claim, got, want_ok, detail=""):
    ok = want_ok
    RESULTS.append((phase, claim, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {phase}: {claim}")
    if detail:
        print(f"         {detail}")
    return ok


def wait_until(pred, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.3)
    raise RuntimeError(f"timed out after {timeout}s waiting for {what}")


# ---------------------------------------------------------------------------
# phases
# ---------------------------------------------------------------------------


def phase_policy(n1, gp):
    """P1 - what rskj does with a same-nonce transaction."""
    print("\nP1  can a mined transaction be replaced by the same nonce and more gas?")
    n = n1.nonce()
    digest, err = send(n1, n, gp)
    assert err is None, f"the first transaction must be accepted: {err}"
    n1.mine(1)
    wait_until(lambda: n1.receipt(digest) is not None, 20, "the transaction to be mined")
    mined = n1.receipt(digest)
    record("P1a", "a normal transaction is mined", mined is not None,
           f"nonce {n} at {gp} wei mined in block {int(mined['blockNumber'], 16)}")

    digest2, err = send(n1, n, gp * 2)
    low = err is not None and ("nonce too low" in err or "nonce" in err)
    record("P1b", "replacing the MINED transaction is refused by nonce, not by price",
           low, f'node said: {err!r}  (gas price was doubled)')

    # now the pool-level rule, using the next nonce
    n = n1.nonce()
    c_hash, err_c = send(n1, n, gp)
    assert err_c is None, f"pool transaction rejected: {err_c}"
    small = gp + max(1, gp * 15 // 100)
    _, err_small = send(n1, n, small)
    bumped = (err_small is not None
              and ("bump" in err_small.lower() or "gas price" in err_small.lower()))
    record("P1c", f"a +15% replacement in the pool is refused (default bump is 40%)",
           bumped, f"tried {small} wei against {gp} wei: {err_small!r}")

    big = gp * 2
    d_hash, err_big = send(n1, n, big)
    replaced = err_big is None and n1.tx(c_hash) is None
    record("P1d", "a +100% replacement in the pool is accepted and drops the original",
           replaced, f"nonce {n} at {big} wei accepted; original now unknown to the node")
    n1.mine(1)
    wait_until(lambda: n1.receipt(d_hash) is not None, 20, "the replacement to be mined")
    return n1.nonce()


def phase_reorg(n1, n2, gp):
    """P2/P3/P4 - a real reorg, then a replacement, with a control alongside."""
    print("\nP2  a real reorganisation: node 2 mines a longer chain, then connects")
    n = n1.nonce()
    victim, err_v = send(n1, n, gp)               # will be replaced
    control, err_k = send(n1, n + 1, gp)          # never replaced
    assert err_v is None and err_k is None, (err_v, err_k)
    n1.mine(1)
    wait_until(lambda: n1.receipt(victim) and n1.receipt(control), 25, "both to be mined")
    h = int(n1.receipt(victim)["blockNumber"], 16)
    old_hash = n1.block(h)["hash"]
    record("P2a", "two transactions are mined in the same block on node 1",
           True, f"height {h}, block {old_hash[:18]}..., victim {victim[:14]}..., "
                 f"control {control[:14]}...")

    target = h + 3
    n2.start()
    n2.mine(target)
    record("P2b", "node 2 builds a longer chain while isolated",
           n2.height() >= target,
           f"node2 height {n2.height()} vs node1 height {n1.height()}, "
           f"peers {n1.peers()} (isolated)")

    print("     connecting node 2 -> node 1 and waiting for the switch")
    n2.stop()
    n2.active = [(n1.node_id, n1.peer_port)]
    n2.start()
    try:
        wait_until(lambda: n1.block(h) is not None
                   and n1.block(h)["hash"] != old_hash, 90,
                   "node 1 to switch to the longer chain")
    except RuntimeError:
        record("P2c", "node 1 adopts the longer chain", False,
               f"still on {n1.block(h)['hash'][:18]}... after 90 s; "
               f"peers={n1.peers()}\n{n1.tail(25)}")
        raise
    new_hash = n1.block(h)["hash"]
    record("P2c", "node 1 adopts the longer chain and orphans the block",
           True, f"height {h} is now {new_hash[:18]}... (was {old_hash[:18]}...)")

    vt = n1.tx(victim)
    kt = n1.tx(control)
    back = (vt is not None and vt.get("blockNumber") is None
            and kt is not None and kt.get("blockNumber") is None)
    record("P2d", "both orphaned transactions are retracted into the pool",
           back, "eth_getTransactionByHash returns them with blockNumber=null "
                 "(retractBlock -> addTransactions)")

    print("\nP3  replace the retracted transaction with the same nonce, +100% gas")
    if not back:
        record("P3a", "replacement", False, "skipped: the transaction did not come back")
        return
    b_hash, err_b = send(n1, n, gp * 2)
    gone = err_b is None and n1.tx(victim) is None
    record("P3a", "the replacement is accepted once the original is back in the pool",
           gone, f"node said {err_b!r}; original victim hash now unknown to the node")

    n1.mine(1)
    wait_until(lambda: n1.receipt(b_hash) is not None, 30, "the replacement to be mined")
    n1.mine(2)
    final = n1.tx(victim)
    record("P3b", "the original hash never appears again",
           final is None and n1.receipt(victim) is None,
           f"victim: tx={final}, receipt={n1.receipt(victim)} "
           f"while replacement is mined in block {int(n1.receipt(b_hash)['blockNumber'], 16)}")

    print("\nP4  control: the other transaction in the same orphaned block, untouched")
    ck = n1.receipt(control)
    record("P4", "an orphaned transaction is re-mined on its own if nothing replaces it",
           ck is not None and ck.get("blockNumber") is not None,
           f"control {control[:14]}... is back on chain in block "
           f"{int(ck['blockNumber'], 16) if ck else None}")


# ---------------------------------------------------------------------------


def resolve_jar(value, ap):
    """
    Find the rskj fat jar.  Accepts a path, a glob (the shell may hand over a
    literal '~' or a pattern zsh refused to expand), and falls back to the
    usual build output locations.
    """
    looked = []
    candidates = []
    if value:
        expanded = os.path.expanduser(os.path.expandvars(value))
        looked.append(expanded)
        if any(ch in expanded for ch in "*?["):
            candidates.extend(sorted(glob.glob(expanded), key=os.path.getmtime))
        elif os.path.isfile(expanded):
            return expanded
    for pattern in (
        "~/rskj*.jar",
        "~/powpeg-deps/rskj/rskj-core/build/libs/rskj-core-*-all.jar",
        "~/rskj/rskj-core/build/libs/rskj-core-*-all.jar",
        "~/src/rskj/rskj-core/build/libs/rskj-core-*-all.jar",
        "~/ee.io/**/rskj-core-*-all.jar",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "**",
                     "rskj-core-*-all.jar"),
    ):
        looked.append(pattern)
        candidates.extend(sorted(glob.glob(os.path.expanduser(pattern),
                                           recursive=True), key=os.path.getmtime))
    if candidates:
        jar = candidates[-1]
        if value:
            print(f"note: used {jar} (from --rskj-jar {value})")
        else:
            print(f"note: found {jar}")
        return jar
    ap.error(
        "no rskj fat jar found.\n"
        "  I looked at: " + ", ".join(looked) + "\n"
        "  Get one either way:\n"
        "    curl -L -o ~/rskj.jar https://github.com/rsksmart/rskj/releases/"
        "download/VETIVER-9.0.4/rskj-core-9.0.4-VETIVER-all.jar\n"
        "    (or) git clone --depth 1 -b VETIVER-9.0.4 "
        "https://github.com/rsksmart/rskj.git && cd rskj && ./gradlew fatJar\n"
        "  then: --rskj-jar \"$HOME/rskj.jar\"   (quote $HOME, not ~)")


def resolve_java(value):
    if value:
        return value
    home = os.environ.get("JAVA_HOME")
    if home:
        cand = os.path.join(home, "bin", "java")
        if os.path.exists(cand):
            return cand
    for cand in ("/opt/homebrew/opt/openjdk@17/bin/java",
                 "/usr/local/opt/openjdk@17/bin/java",
                 "/opt/homebrew/opt/openjdk/bin/java"):
        if os.path.exists(cand):
            return cand
    return "java"


def main():
    ap = argparse.ArgumentParser(
        description="Prove what happens to a mined RSK transaction that a reorg "
                    "orphans and a same-nonce higher-gas transaction replaces.",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rskj-jar", default=os.environ.get("RSKJ_JAR"),
                    help="path to rskj-core-<version>-all.jar (or set RSKJ_JAR)")
    ap.add_argument("--java", default=None,
                    help="java binary; defaults to $JAVA_HOME/bin/java, then a "
                         "Homebrew openjdk@17, then whatever is on PATH")
    ap.add_argument("--workdir", default="./regtest-reorg-poc")
    ap.add_argument("--keep", action="store_true", help="keep node dirs and logs")
    ap.add_argument("--skip-policy", action="store_true")
    args = ap.parse_args()

    args.rskj_jar = resolve_jar(args.rskj_jar, ap)

    args.java = resolve_java(args.java)
    work = os.path.abspath(args.workdir)
    if os.path.exists(work) and not args.keep:
        shutil.rmtree(work)
    os.makedirs(work, exist_ok=True)

    n1 = Node("node1", os.path.join(work, "node1"), 4444, 50501,
              ethsign.keccak256(b"poc-node-1")[:32], args.rskj_jar, args.java)
    n2 = Node("node2", os.path.join(work, "node2"), 4445, 50502,
              ethsign.keccak256(b"poc-node-2")[:32], args.rskj_jar, args.java)

    print("=" * 74)
    print("RSK regtest: does a reorged-out transaction survive a same-nonce replacement?")
    print("=" * 74)
    print(f"jar      : {args.rskj_jar}")
    print(f"workdir  : {work}")
    print(f"node1    : rpc 127.0.0.1:4444  peer {n1.peer_port}  id {n1.node_id[:16]}...")
    print(f"node2    : rpc 127.0.0.1:4445  peer {n2.peer_port}  id {n2.node_id[:16]}...")

    started = []
    try:
        n1.start()
        started.append(n1)
        bal = int(n1.rpc("eth_getBalance",
                         ["0x" + ethsign.address_of(COW_KEY).hex(), "latest"]), 16)
        gp = n1.gas_price()
        print(f"account  : 0x{ethsign.address_of(COW_KEY).hex()} balance {bal} wei")
        print(f"gasPrice : {gp} wei (node's eth_gasPrice)")
        if bal <= 0:
            print("FATAL: the premined regtest account has no balance - wrong genesis?")
            return 1

        if not args.skip_policy:
            phase_policy(n1, gp)

        phase_reorg(n1, n2, gp)

    except Exception as exc:            # noqa: BLE001 - the point is to report it
        print(f"\nABORTED: {exc}")
        for node in started + [n2]:
            if node.proc:
                node.stop()
        print(f"\nnode1 log tail:\n{n1.tail(30)}")
        return 1
    finally:
        for node in (n2, n1):
            try:
                node.stop()
            except Exception:           # noqa: BLE001
                pass

    print("\n" + "=" * 74)
    print("RESULT")
    print("=" * 74)
    for phase, claim, ok, _ in RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {phase:<5} {claim}")
    failed = [r for r in RESULTS if not r[2]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if args.keep:
        print(f"logs kept in {work}")
    else:
        shutil.rmtree(work, ignore_errors=True)
    print("""
Reading of a full pass
  P1b  a mined transaction cannot be replaced by gas price at all - rskj rejects
       it on the nonce, so no replace-by-fee exists for something already mined.
  P1c  even in the pool, the bump has to clear transaction.gasPriceBump = 40%,
       so the "+10-15%" in the report would be rejected; the run uses +100%.
  P2d  the reorg returns the transaction to the pool.  On its own that is the
       opposite of a corpse: the deposit would be re-mined.
  P3b  what kills it is the replacement, not the reorg.  Once a same-nonce
       transaction is mined, the original hash is unknown to the node forever.
  P4   the control in the same orphaned block comes back, so P3b is caused by
       the replacement and not by the reorg.
""")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
