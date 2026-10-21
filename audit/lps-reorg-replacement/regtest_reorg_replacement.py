#!/usr/bin/env python3
"""
regtest_reorg_replacement.py - does an RSK transaction that was mined, orphaned
by a reorg, and then replaced by a same-nonce transaction ever come back?

This is the load-bearing question behind the liquidation-provider report: the LP
binds a deposit to a quote, the deposit vanishes, and the watcher keeps retrying a
hash that no longer exists.  Everything else in that report is code reading; this
is the part that needs a chain.

WHAT IT RUNS
  two real RSK regtest nodes (rskj), same genesis, separate fresh databases, no
  discovery.  Node 1 builds chain A.  Node 2 builds a longer chain B on its own,
  in isolation, from the same genesis.  Only then are they introduced, and node 1
  switches to B.  That is a genuine proof-of-work chain reorganisation - node 1
  runs switchToBlockChain and retracts the losing block's transactions back into
  its pool.  Nothing is written to any database by hand, no rskj constant is
  patched, no emulator is involved.

THE EXPERIMENT
  P1  can a MINED transaction be replaced by the same nonce and more gas?
  P2  after a reorg orphans the block that held it, does the transaction come
      back into the pool, or is it gone?
  P3  once back, does a same-nonce replacement with a bigger gas price take its
      place, and does the original stay dead afterwards?
  P4  control: a second transaction in the SAME orphaned block, never replaced,
      is re-mined on its own - so P3's outcome is caused by the replacement and
      not by the reorg.

WHAT RSKJ SAYS IT WILL DO (read from source; this is what the run should confirm)
  P1b "transaction nonce too low" - TxValidatorNonceRangeValidator compares the
      transaction nonce with the account nonce at the best block.  Once a
      transaction is mined the account nonce is N+1, so a same-nonce replacement
      is not even considered: rskj has no replace-by-fee for mined transactions.
  P1c reference.conf:306 sets transaction.gasPriceBump = 40, and
      TransactionPoolImpl:309-311 accepts a same-nonce pool replacement only if
      newPrice > oldPrice and newPrice >= oldPrice * 140 / 100.  So +10-15% is
      rejected with "gas price not enough to bump transaction".
  P2f retractBlock -> addTransactions: an orphaned block's transactions are
      re-added to the pool, so the deposit comes back unless it is replaced.

GAS PRICE GRANULARITY
  regtest's eth_gasPrice is 1 wei, and 15% of 1 wei does not exist.  The pool
  phases therefore use 1000 wei so that +15% (1150) and +100% (2000) are both
  expressible; P1a keeps the node's own 1 wei to show ordinary mining.

USAGE
  python3 regtest_reorg_replacement.py --rskj-jar /path/to/rskj-core-*-all.jar
  python3 regtest_reorg_replacement.py --rskj-jar ... --keep   # keep node dirs
  python3 ethsign.py                                           # crypto self-test

Needs a JRE 17+ and the rskj fat jar.  Nothing else - no docker, no web3, no
unlocked account: transactions are signed here and pushed with
eth_sendRawTransaction.  The signing key is the account premined in rskj's own
regtest genesis (genesis/rsk-dev.json, cd2a3d9f938e13cd947ec05abc7fe734df8dd826).

The run is deterministic: rskj processes left behind by an earlier attempt are
killed before anything is measured, both databases are wiped, every node has to
prove that its peer port is listening, that its RPC answer comes from the JVM
this script just launched, and that it does not mine on its own.  A `jvm.pid`
file per node and an `lsof` check on the ports are what make that possible; the
first version of this file did neither and spent ten minutes measuring a node it
had not started.
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

# ports of the two PoC nodes: the only ports this script may ever clean up
NODE_PORTS = (4444, 4445, 50501, 50502)

CHAIN_ID = 33                     # Constants.REGTEST_CHAIN_ID
COW_KEY = ethsign.COW_KEY         # premined in genesis/rsk-dev.json
GAS_LIMIT = 21000
THROWAWAY = bytes.fromhex("00" * 19 + "01")
POOL_GAS = 1000                   # wei: big enough that +15% is an integer


class RpcError(RuntimeError):
    pass


class PocError(RuntimeError):
    """A precondition of the experiment failed; the run is not evidence."""


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
        self._checked_self_mining = False

    # -- config ------------------------------------------------------------
    @property
    def node_id(self):
        return ethsign.pubkey(self.priv).hex()

    @property
    def conf_path(self):
        return os.path.join(self.base, "rsk.conf")

    @property
    def stdout_path(self):
        return os.path.join(self.base, "node.log")

    @property
    def chainlog_path(self):
        return os.path.join(self.base, "logs", "rsk.log")

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
    discovery.enabled = false
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

# the miner server answers eth_getWork; the miner CLIENT is what produces
# blocks on a timer.  We want neither self-mining nor a second miner: every
# block in this experiment comes from an explicit evm_mine call.
miner {{
    server.enabled = true
    client.enabled = false
    client.autoMine = false
}}
""")

    # -- process -----------------------------------------------------------
    @property
    def pid_path(self):
        return os.path.join(self.base, "jvm.pid")

    def _kill_previous_jvm(self):
        """Kill the JVM this node directory started last time, if it is alive.

        This is the fix for the run that mined 43k blocks and then "connected":
        the previous attempt left its JVM behind, the next one failed to bind
        (java.net.BindException: Address already in use) and every RPC call went
        to the corpse, which was still linked to the other corpse.
        """
        try:
            with open(self.pid_path) as fh:
                pid = int(fh.read().strip())
        except (OSError, ValueError):
            pid = None
        if pid and alive(pid) and pid in pids_running("co.rsk.Start"):
            self.log(f"     {self.name}: stopping the JVM this directory started "
                     f"last time (pid {pid})")
            kill_hard(pid, self.log)
        try:
            os.unlink(self.pid_path)
        except OSError:
            pass

    def _free_ports(self):
        ports = (self.rpc_port, self.peer_port)
        busy = [p for p in ports if not self.port_free(p)]
        if busy:
            for port, rows in lsof_holders(busy).items():
                for pid, name in rows:
                    if pid in (os.getpid(), os.getppid()):
                        continue
                    if name.lower() != "java":
                        raise PocError(
                            f"{self.name}: port {port} is held by pid {pid} ({name}), "
                            f"which is not an rskj JVM.  Stop it yourself; this script "
                            f"will not kill something it does not recognise.")
                    self.log(f"     {self.name}: killing leftover rskj pid {pid} "
                             f"on port {port}")
                    kill_hard(pid, self.log)
            busy = [p for p in ports if not self.port_free(p)]
        if busy:
            raise PocError(
                f"{self.name}: port(s) {busy} are still in use.\n"
                f"  {port_holders(busy)}\n"
                f"  kill them by hand (kill -9 <pid>) or run: pkill -f co.rsk.Start")

    def start(self, self_mining_check=True):
        self.write_config()
        self._kill_previous_jvm()
        self._free_ports()
        cmd = [str(self.java),
               f"-Drsk.conf.file={self.conf_path}",
               "-Duser.language=en",
               "-cp", str(self.jar),
               "co.rsk.Start", "--regtest"]
        # deliberately NOT start_new_session: if this script is interrupted the
        # JVM has to die with it, which is exactly what did not happen last time
        with open(self.stdout_path, "ab") as out:
            self.proc = subprocess.Popen(cmd, stdout=out,
                                         stderr=subprocess.STDOUT, cwd=self.base)
        with open(self.pid_path, "w") as fh:
            fh.write(str(self.proc.pid))

        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise PocError(
                    f"{self.name} exited with {self.proc.returncode}; "
                    f"last lines of {self.stdout_path}:\n{self.tail()}")
            try:
                self.rpc("eth_blockNumber", [])
                break
            except Exception:                   # noqa: BLE001 - not up yet
                time.sleep(0.3)
        else:
            raise PocError(f"{self.name} did not answer RPC on port {self.rpc_port}"
                           f"\n{self.tail()}")

        # the answer must come from the JVM that was just launched, not from a
        # leftover that happens to own the port
        owners = lsof_pids([self.rpc_port]).get(self.rpc_port, [])
        if owners and self.proc.pid not in owners:
            raise PocError(
                f"{self.name}: port {self.rpc_port} is answered by pid {owners}, not "
                f"by the JVM I started (pid {self.proc.pid}).\n"
                f"  that is somebody else's node; every number after this would be "
                f"theirs.  Kill it and run again.")

        # the P2P listener is not optional here: a node that answers RPC but
        # never binds its peer port cannot take part in the experiment at all
        deadline = time.time() + 40
        while time.time() < deadline:
            if not self.port_free(self.peer_port):
                break
            time.sleep(0.3)
        else:
            raise PocError(
                f"{self.name} never listened on peer port {self.peer_port}, so the "
                f"two nodes could never meet.\n{self.tail(25)}")
        if "Unable to start peer server" in self.read_log(self.chainlog_path):
            raise PocError(f"{self.name}: rskj failed to start its peer server."
                           f"\n{self.tail(25)}")

        # a node that mines without being asked makes every height in this run
        # meaningless - check once, on the first, isolated start
        if self_mining_check and not self.active and not self._checked_self_mining:
            h0 = self.height()
            time.sleep(2.5)
            h1 = self.height()
            self._checked_self_mining = True
            if h1 != h0:
                raise PocError(
                    f"{self.name} mined {h1 - h0} block(s) on its own in 2.5 s: "
                    f"miner.client.enabled is not in effect, so block production "
                    f"is not under the script's control.\n{self.tail(25)}")
        return self

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.log(f"     stopping {self.name} (pid {self.proc.pid})")
            self.proc.terminate()
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                try:
                    self.proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
        self.proc = None
        try:
            os.unlink(self.pid_path)
        except OSError:
            pass
        # both ports must be free again: the RPC port proves the process is gone,
        # the peer port proves the listening socket was released.  Restarting on
        # a peer port still held leaves the node up but deaf, which looks exactly
        # like "the reorg never happened".
        deadline = time.time() + 30
        while time.time() < deadline:
            if self.port_free(self.rpc_port) and self.port_free(self.peer_port):
                return
            time.sleep(0.2)
        raise PocError(f"{self.name} still holds a port 30 s after shutdown "
                       f"(rpc {self.rpc_port}, peer {self.peer_port})")

    @staticmethod
    def port_free(port):
        """True if nothing is listening on the port."""
        with socket.socket() as s:
            s.settimeout(0.3)
            return s.connect_ex(("127.0.0.1", port)) != 0

    def read_log(self, path):
        try:
            with open(path, "r", errors="replace") as fh:
                return fh.read()
        except OSError:
            return ""

    def tail(self, n=40, only=None):
        """The JVM's stdout plus the lines logback wrote to logs/rsk.log."""
        text = ""
        for path in (self.chainlog_path, self.stdout_path):
            lines = self.read_log(path).splitlines(keepends=True)
            if only:
                lines = [ln for ln in lines
                         if any(k in ln.lower() for k in only)]
            if lines:
                text += f"--- {path} ---\n" + "".join(lines[-n:]) + "\n"
        return text or "(no log)"

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

    def block(self, h, full=False):
        return self.rpc("eth_getBlockByNumber", [hex(h), full])

    def mine(self, n=1):
        """Mine exactly n blocks, here and now, and prove the height moved."""
        if n < 1 or n > 10:
            raise PocError(f"refusing to mine {n} blocks in one go - the point of "
                           f"the reorg is three blocks, not a chain build")
        before = self.height()
        for _ in range(n):
            self.rpc("evm_mine", [])
        deadline = time.time() + 30
        while self.height() < before + n:
            if time.time() > deadline:
                raise PocError(f"{self.name}: asked for {n} block(s) from height "
                               f"{before}, stopped at {self.height()}")
            time.sleep(0.15)
        return self.height()

    def tx(self, h):
        return self.rpc("eth_getTransactionByHash", [h])

    def receipt(self, h):
        return self.rpc("eth_getTransactionReceipt", [h])

    def pool(self):
        """Every transaction the node is holding, as {hash: nonce}; None if the
        node does not answer txpool_content (it is only ever corroboration)."""
        out = {}
        try:
            content = self.rpc("txpool_content", [])
        except RpcError:
            return None
        for bucket in ("pending", "queued"):
            # {"pending": {address: {nonce: [tx, ...]}}}
            for nonce_map in (content.get(bucket) or {}).values():
                for nonce, txs in (nonce_map or {}).items():
                    for tx in (txs if isinstance(txs, list) else [txs]):
                        if tx and tx.get("hash"):
                            out[tx["hash"].lower()] = nonce
        return out

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

    def net_listening(self):
        """True if rskj's peer server is bound and accepting connections."""
        try:
            return bool(self.rpc("net_listening", []))
        except RpcError:
            return False

    def client_version(self):
        try:
            return self.rpc("web3_clientVersion", [])
        except RpcError:
            return "?"


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
T0 = time.time()


def record(phase, claim, ok, detail=""):
    # a truthy string in this slot is how an earlier version of this script
    # printed PASS above ABORTED: refuse anything that is not a real verdict
    if not isinstance(ok, bool):
        raise PocError(f"internal: record({phase}) was given {ok!r}, which is not a "
                       f"verdict; a non-empty detail string must never decide a phase")
    RESULTS.append((phase, claim, ok, detail, time.time() - T0))
    print(f"  [{'PASS' if ok else 'FAIL'}] {phase}: {claim}")
    if detail:
        for i, line in enumerate(str(detail).splitlines()):
            print(f"         {line}" if i == 0 else f"           {line}")
    return ok


def wait_until(pred, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.2)
    raise PocError(f"timed out after {timeout}s waiting for {what}")


def wait_receipt(node, digest, timeout=30):
    try:
        wait_until(lambda: node.receipt(digest) is not None, timeout,
                   f"{digest[:16]}... to be mined")
    except PocError:
        return None
    return node.receipt(digest)


def wait_peers(nodes, want, timeout, label):
    deadline = time.time() + timeout
    next_report = 0.0
    while time.time() < deadline:
        counts = [n.peers() for n in nodes]
        if all(c >= want for c in counts):
            return True
        if time.time() >= next_report:
            next_report = time.time() + 4
            try:
                print("     ... " + label + ": " + " | ".join(
                    f"{n.name} h={n.height()} peers={c}"
                    for n, c in zip(nodes, counts)))
            except Exception:                  # noqa: BLE001
                print(f"     ... {label}: a node is not answering")
        time.sleep(0.35)
    return False


def wait_for_switch(n1, n2, height, old_hash, timeout, label):
    """Poll until node1's block at `height` stops being the one we mined."""
    deadline = time.time() + timeout
    next_report = 0.0
    while time.time() < deadline:
        try:
            blk = n1.block(height)
            if blk and blk["hash"] != old_hash:
                return True
        except Exception:                      # noqa: BLE001 - node may be busy
            pass
        if time.time() >= next_report:
            next_report = time.time() + 5
            try:
                print(f"     ... {label}: node1 h={n1.height()} peers={n1.peers()} | "
                      f"node2 h={n2.height()} peers={n2.peers()}")
            except Exception:                  # noqa: BLE001
                print(f"     ... {label}: a node is not answering")
        time.sleep(0.35)
    return False


def where_mined(node, needle, from_h, to_h):
    """Block heights in [from_h, to_h] whose transaction list holds `needle`."""
    hits = []
    for h in range(from_h, to_h + 1):
        blk = node.block(h, full=True)
        for tx in (blk or {}).get("transactions", []):
            if isinstance(tx, dict) and tx.get("hash", "").lower() == needle.lower():
                hits.append(h)
    return hits


# ---------------------------------------------------------------------------
# phases
# ---------------------------------------------------------------------------


def phase_policy(n1, chain_gp):
    """P1 - what rskj does with a same-nonce transaction."""
    print("\nP1  can a mined transaction be replaced by the same nonce and more gas?")
    hi = max(chain_gp, POOL_GAS)     # wei granularity: +15% of 1 wei does not exist
    print(f"     using {hi} wei per gas (the node quotes {chain_gp} wei) so that a "
          f"+15% bump is a whole number")

    n = n1.nonce()
    a, err = send(n1, n, hi)
    if err:
        raise PocError(f"the first transaction was rejected: {err}")
    blk = n1.mine(1)
    rc = wait_receipt(n1, a)
    record("P1a", "a normal transaction is mined", rc is not None,
           f"nonce {n} at {hi} wei -> block {int(rc['blockNumber'], 16)} "
           f"(status {rc['status']}), node height {blk}" if rc else "no receipt")

    _, err = send(n1, n, hi * 2)
    record("P1b", "replacing the MINED transaction is refused on the nonce, not on the price",
           err is not None and "nonce" in err.lower(),
           f"offered {hi * 2} wei for nonce {n}, which is already mined; "
           f"node said {err!r}")

    n = n1.nonce()
    a, err = send(n1, n, hi)
    if err:
        raise PocError(f"pool transaction rejected: {err}")
    small = hi * 115 // 100
    _, err_small = send(n1, n, small)
    record("P1c", "a +15% replacement in the POOL is refused (transaction.gasPriceBump = 40)",
           err_small is not None and "bump" in err_small.lower(),
           f"{small} wei against {hi} wei: {err_small!r}")

    big = hi * 2
    b, err_big = send(n1, n, big)
    still_there = n1.tx(a) is not None
    record("P1d", "a +100% replacement in the pool is accepted and evicts the original",
           err_big is None and not still_there,
           f"{big} wei against {hi} wei: node said {err_big!r}; "
           f"eth_getTransactionByHash(original) -> "
           f"{'still there' if still_there else 'null'}")

    n1.mine(1)
    rc = wait_receipt(n1, b)
    record("P1e", "the replacement is the one that ends up on chain",
           rc is not None and n1.receipt(a) is None,
           f"replacement mined in block {int(rc['blockNumber'], 16)}, "
           f"original receipt {n1.receipt(a)!r}" if rc else "replacement never mined")
    return n1.nonce()


def phase_reorg(n1, n2, gp):
    """P2/P3/P4 - a real reorg, then a replacement, with a control alongside."""
    gp = max(gp, POOL_GAS)
    print("\nP2  a real reorganisation: node 1 builds chain A, node 2 builds a longer chain B")

    n1.mine(1)                                    # A1: filler, no transactions
    n = n1.nonce()
    victim, err_v = send(n1, n, gp)               # will be replaced
    control, err_k = send(n1, n + 1, gp)          # never replaced
    if err_v or err_k:
        raise PocError(f"the two transactions were rejected: {err_v!r} {err_k!r}")
    n1.mine(1)                                    # A2: both transactions
    n1.mine(1)                                    # A3: so the victim is 1 block deep
    rv = wait_receipt(n1, victim)
    rk = wait_receipt(n1, control)
    if not rv or not rk:
        raise PocError("the victim and the control were not mined")
    hv = int(rv["blockNumber"], 16)
    old_hash = n1.block(hv)["hash"]
    a_txs = [t["hash"].lower()
             for t in (n1.block(hv, True) or {}).get("transactions", [])]
    record("P2a", "the victim and the control are mined in the same block of chain A",
           rv["blockNumber"] == rk["blockNumber"]
           and victim.lower() in a_txs and control.lower() in a_txs,
           f"height {hv} = {old_hash} holds {len(a_txs)} transaction(s); "
           f"victim {victim[:16]}... (nonce {n}) present: {victim.lower() in a_txs}, "
           f"control {control[:16]}... (nonce {n + 1}) present: {control.lower() in a_txs}; "
           f"chain A is {n1.height()} blocks long")

    n2.start()
    target = n1.height() + 2                      # chain B must be strictly heavier
    n2.mine(target)
    isolated = n1.peers() == 0 and n2.peers() == 0
    td_a = int(n1.block(n1.height())["totalDifficulty"], 16)
    td_b = int(n2.block(n2.height())["totalDifficulty"], 16)
    record("P2b", "node 2 builds a heavier chain B while isolated",
           td_b > td_a and isolated,
           f"chain A: height {n1.height()}, total difficulty {td_a}\n"
           f"chain B: height {n2.height()}, total difficulty {td_b} "
           f"(+{td_b - td_a})\n"
           f"peers node1={n1.peers()} node2={n2.peers()} -> "
           f"{'no path between them' if isolated else 'THEY ARE ALREADY CONNECTED'}")
    if not isolated:
        raise PocError("the nodes were already connected; this is not an isolated "
                       "chain and the run is not evidence")
    if td_b <= td_a:
        raise PocError(f"chain B (TD {td_b}) is not heavier than chain A (TD {td_a}), "
                       f"so no node would ever switch to it")

    print(f"     connecting node 2 -> node 1 (enode://{n1.node_id[:16]}...@{n1.peer_port})")
    n2.stop()
    n2.active = [(n1.node_id, n1.peer_port)]
    n2.start()
    linked = wait_peers([n1, n2], 1, 45, "waiting for the P2P session")
    record("P2c", "the two nodes establish a P2P session", linked,
           f"peers node1={n1.peers()} node2={n2.peers()}")
    if not linked:
        print(n1.tail(40, only=("peer", "connect", "sync", "handshake", "reject")))
        print(n2.tail(40, only=("peer", "connect", "sync", "handshake", "reject")))
        raise PocError("no P2P session, so no reorg could be attempted")

    switched = wait_for_switch(n1, n2, hv, old_hash, 90, "waiting for node 1 to switch")
    now_hash = n1.block(hv)["hash"]
    record("P2d", "node 1 adopts chain B and orphans the block that held the victim",
           switched,
           f"height {hv} is now {now_hash} (chain A had {old_hash}); "
           f"node1 height {n1.height()}, node2 height {n2.height()}"
           if switched else
           f"height {hv} is still {now_hash} after 90 s; "
           f"node1 height {n1.height()}, node2 height {n2.height()}")
    if not switched:
        print(n1.tail(40, only=("peer", "connect", "sync", "block", "header",
                                "reject", "difficulty")))
        print(n2.tail(40, only=("peer", "connect", "sync", "block", "header",
                                "reject", "difficulty")))
        raise PocError("node 1 never adopted the longer chain")

    def same_tip():
        return (n1.height() == n2.height()
                and n1.block(n1.height())["hash"] == n2.block(n2.height())["hash"])

    try:
        converged = wait_until(same_tip, 20, "the two nodes to agree on a tip")
    except PocError:
        converged = False
    tip1 = n1.block(n1.height())
    tip2 = n2.block(n2.height())
    record("P2e", "both nodes end up on the same tip, so the switch is complete",
           converged,
           f"node1 {n1.height()} {tip1['hash']}\n"
           f"node2 {n2.height()} {tip2['hash']}")

    vt = n1.tx(victim)
    kt = n1.tx(control)
    pooled = n1.pool()
    back = (vt is not None and vt.get("blockNumber") is None
            and kt is not None and kt.get("blockNumber") is None)
    corroborated = pooled is None or (victim.lower() in pooled
                                      and control.lower() in pooled)
    v_seen = "present, blockNumber=null" if back and vt else (
        "absent" if vt is None else f"present with blockNumber {vt.get('blockNumber')}")
    k_seen = "present, blockNumber=null" if back and kt else (
        "absent" if kt is None else f"present with blockNumber {kt.get('blockNumber')}")
    if pooled is None:
        pool_seen = "txpool_content not available"
    else:
        pool_seen = f"{len(pooled)} transaction(s): {sorted(pooled)}"
    record("P2f", "both orphaned transactions are retracted into node 1's pool",
           back and corroborated,
           f"account nonce is back to {n1.nonce()}; eth_getTransactionByHash -> "
           f"victim {v_seen}, control {k_seen}; {pool_seen}")
    if not back:
        raise PocError("the orphaned transactions did not come back to the pool; "
                       "the rest of the experiment has nothing to act on")

    print("\nP3  replace the retracted victim with the same nonce and more gas")
    _, err_small = send(n1, n, gp * 115 // 100)
    record("P3a", "even after the reorg, +15% is still refused by the bump rule",
           err_small is not None and "bump" in err_small.lower(),
           f"{gp * 115 // 100} wei against {gp} wei: {err_small!r}")

    b, err_b = send(n1, n, gp * 2)
    gone = err_b is None and n1.tx(victim) is None
    pooled = n1.pool()
    record("P3b", "a +100% same-nonce replacement is accepted once the victim is back in the pool",
           gone,
           f"{gp * 2} wei against {gp} wei: node said {err_b!r}; "
           f"eth_getTransactionByHash(victim) -> "
           f"{'null' if n1.tx(victim) is None else 'still there'}; "
           f"txpool_content -> "
           f"{'not available' if pooled is None else str(sorted(pooled))}")

    top = n1.mine(1)
    rc = wait_receipt(n1, b)
    n1.mine(2)
    last = n1.height()
    hits = where_mined(n1, victim, top, last)
    ck = n1.receipt(control)
    record("P3c", "the replacement is mined and the victim's hash never appears again",
           rc is not None and not hits and n1.receipt(victim) is None,
           f"replacement in block {int(rc['blockNumber'], 16) if rc else None}; "
           f"scanned blocks {top}..{last} for the victim hash, found in "
           f"{hits if hits else 'no block'}; eth_getTransactionByHash(victim) -> "
           f"{n1.tx(victim)!r}")

    print("\nP4  control: the other transaction in the same orphaned block, untouched")
    record("P4", "an orphaned transaction is re-mined on its own if nothing replaces it",
           ck is not None and ck.get("blockNumber") is not None,
           f"control {control[:16]}... is back on chain in block "
           f"{int(ck['blockNumber'], 16) if ck else None} "
           f"(it was orphaned at height {hv} together with the victim)")


# ---------------------------------------------------------------------------


def _ps_table():
    """(pid, command) for every process, on macOS and Linux alike.

    `ps -axo pid=,etime=,command=` printed nothing at all on macOS arm64, so the
    earlier version of this file cheerfully reported "no rskj processes" while
    two of them were holding every port it needed.  Separate -o options with an
    explicit -ww to defeat BSD's terminal-width truncation.
    """
    try:
        out = subprocess.run(["ps", "-A", "-ww", "-o", "pid=", "-o", "command="],
                             capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    rows = []
    for line in out.splitlines():
        pid_s, _, cmd = line.strip().partition(" ")
        try:
            rows.append((int(pid_s), cmd.strip()))
        except ValueError:
            pass
    return rows


def cmdlines():
    return dict(_ps_table())


def pids_running(marker):
    return {pid for pid, cmd in _ps_table() if marker in cmd}


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def kill_hard(pid, log=print, grace=10.0):
    if pid in (os.getpid(), os.getppid()):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    deadline = time.time() + grace
    while time.time() < deadline:
        if not alive(pid):
            log(f"     pid {pid} stopped on SIGTERM")
            return
        time.sleep(0.2)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return
    deadline = time.time() + 5
    while time.time() < deadline and alive(pid):
        time.sleep(0.2)
    log(f"     pid {pid} needed SIGKILL")


def lsof_holders(ports):
    """{port: [(pid, command name)]} for listeners, via lsof."""
    found = {}
    if shutil.which("lsof") is None:
        return found
    for port in ports:
        try:
            out = subprocess.run(
                ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-F", "pc"],
                capture_output=True, text=True, timeout=15).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        rows, pid = [], None
        for line in out.splitlines():
            if line.startswith("p"):
                pid = int(line[1:]) if line[1:].isdigit() else None
            elif line.startswith("c") and pid is not None:
                rows.append((pid, line[1:]))
                pid = None
        if rows:
            found[port] = rows
    return found


def lsof_pids(ports):
    return {port: [pid for pid, _ in rows]
            for port, rows in lsof_holders(ports).items()}


def port_holders(ports):
    """'pid 123 (java)' for whoever listens on each port."""
    return {port: ", ".join(f"pid {pid} ({cmd})" for pid, cmd in rows)
            for port, rows in lsof_holders(ports).items()}


def list_rskj():
    """Every rskj JVM on this machine, with the config file it was given."""
    rows = []
    for pid, cmd in _ps_table():
        if "co.rsk.Start" not in cmd:
            continue
        conf = "(no -Drsk.conf.file)"
        for token in cmd.split():
            if token.startswith("-Drsk.conf.file="):
                conf = token.split("=", 1)[1]
        rows.append((pid, conf))
    return rows


def cleanup_rskj(work, ports, log=print):
    """Kill rskj processes that belong to this experiment, and nothing else.

    Belongs = launched with this workdir's rsk.conf, or listening on one of the
    ports the PoC uses.  A mainnet node on another port is left alone.
    """
    work = os.path.abspath(work)
    cmds = cmdlines()
    targets = set()
    for pid, cmd in cmds.items():
        if "co.rsk.Start" not in cmd or pid in (os.getpid(), os.getppid()):
            continue
        if f"-Drsk.conf.file={work}" in cmd:
            targets.add(pid)
    for port, rows in lsof_holders(ports).items():
        for pid, name in rows:
            if pid in (os.getpid(), os.getppid()):
                continue
            if name.lower() == "java" or "co.rsk.Start" in cmds.get(pid, ""):
                targets.add(pid)
    for pid in sorted(targets):
        conf = next((t.split("=", 1)[1] for t in cmds.get(pid, "").split()
                     if t.startswith("-Drsk.conf.file=")), "(no -Drsk.conf.file)")
        log(f"note: stopping leftover rskj pid {pid}  [{conf}]")
        kill_hard(pid, log)
    return sorted(targets)


def probe(jar, java, work):
    """Start one node from an empty database and report what it actually does.

    Read-only with respect to earlier runs: it touches neither the node1/node2
    directories nor their ports, and it uses its own datadir.  The only process
    it may stop is a leftover holding its own two ports.
    """
    print("=" * 74)
    print("probe: what does one rskj regtest node actually do here?")
    print("=" * 74)

    print("\nenvironment")
    print(f"  python : {sys.version.split()[0]} ({sys.executable})")
    print(f"  java   : {java}")
    try:
        ver = subprocess.run([java, "-version"], capture_output=True,
                             text=True, timeout=60)
        for line in (ver.stderr or ver.stdout).strip().splitlines()[:2]:
            print(f"           {line}")
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"           could not run java: {exc}")
    if os.path.isfile(jar):
        print(f"  jar    : {jar} ({os.path.getsize(jar)} bytes)")
    else:
        print(f"  jar    : {jar}  ** does not exist **")

    print("\nrskj processes already running")
    rows = list_rskj()
    if not rows:
        print("  none")
    for pid, conf in rows:
        print(f"  pid {pid:<7} {conf}")
    holders = port_holders((4444, 4445, 50501, 50502, 4446, 50503))
    if not holders:
        print("  no listener on 4444/4445/50501/50502/4446/50503")
    for port, who in sorted(holders.items()):
        print(f"  port {port}: {who}")

    node = Node("probe", os.path.join(work, "probe"), 4446, 50503,
                ethsign.keccak256(b"poc-probe")[:32], jar, java)
    shutil.rmtree(node.base, ignore_errors=True)   # the probe always starts empty
    n = 0
    try:
        print("\nstarting one node from an empty database (no self-mining check)")
        print(f"  config: {node.conf_path}")
        node.start(self_mining_check=False)
        n = 0
        first = node.height()
        print(f"  eth_blockNumber right after start : {first}"
              + ("   <- 0 is what a fresh database looks like"
                 if first == 0 else
                 "   ** NOT 0: this is not a fresh chain, look for a leftover node **"))
        print(f"  web3_clientVersion                : {node.client_version()}")
        print(f"  net_listening                     : {node.net_listening()}")
        print(f"  peer port 50503 accepting         : {not node.port_free(50503)}")
        print(f"  net_peerCount                     : {node.peers()}")
        print(f"  eth_gasPrice                      : {node.gas_price()} wei")
        try:
            bal = int(node.rpc("eth_getBalance",
                               ["0x" + ethsign.address_of(COW_KEY).hex(), "latest"]), 16)
            print(f"  premined account balance          : {bal} wei")
        except RpcError as exc:
            print(f"  premined account balance          : RPC error {exc}")

        seen = [first]
        for _ in range(4):
            time.sleep(1.0)
            seen.append(node.height())
        grew = seen[-1] != seen[0]
        print(f"  heights over 4 s                  : {seen}")
        print("  self-mining                       : "
              + ("NONE - block production is under the script's control"
                 if not grew else
                 "YES ** the node mines on its own; every height in a PoC run "
                 "would be meaningless **"))

        node.mine(1)
        print(f"  evm_mine works                    : height {node.height()}")
    except Exception as exc:                   # noqa: BLE001 - this is a diagnosis
        n = 1
        print(f"\nPROBE FAILED: {exc}")
    finally:
        try:
            node.stop()
            print("  node stopped, its ports are free again")
        except Exception as exc:               # noqa: BLE001
            n = 1
            print(f"  could not stop the node cleanly: {exc}")

    log = node.read_log(node.chainlog_path)
    interesting = [ln for ln in log.splitlines()
                   if any(k in ln for k in ("Unable to start peer server",
                                            "BindException", "Address already in use",
                                            "Loaded up to block", "Network upgrade",
                                            "NodeId:", "Listening for incoming"))]
    print("\nwhat the node itself said")
    for line in interesting[:20]:
        print(f"  {line}")
    print(f"  ({len(log.splitlines())} lines in {node.chainlog_path})")
    print(f"\nprobe finished{'' if n == 0 else ' with problems'}; "
          f"{node.base} can be deleted")
    return n


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
    ap.add_argument("--keep", action="store_true",
                    help="keep the node databases and logs after the run")
    ap.add_argument("--probe", action="store_true",
                    help="diagnose this machine instead of running the PoC: "
                         "report leftover rskj processes and port holders, then "
                         "start ONE node from an empty database and say whether "
                         "it binds its peer port, whether it mines on its own, "
                         "and whether evm_mine works")
    ap.add_argument("--skip-policy", action="store_true",
                    help="skip P1 and go straight to the reorg")
    args = ap.parse_args()

    args.rskj_jar = resolve_jar(args.rskj_jar, ap)
    args.java = resolve_java(args.java)
    work = os.path.abspath(args.workdir)

    if args.probe:
        os.makedirs(work, exist_ok=True)
        return probe(args.rskj_jar, args.java, work)

    # nothing from an earlier attempt may survive: a leftover JVM keeps the
    # ports and, worse, keeps answering on them, which is how a previous run
    # spent ten minutes measuring a node it had not started
    cleanup_rskj(work, NODE_PORTS)

    # every run starts from the same genesis: keeping a database would let an
    # earlier attempt decide this one's heights
    if os.path.exists(work):
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
    print(f"node1    : rpc 127.0.0.1:4444  peer 50501  id {n1.node_id[:16]}...")
    print(f"node2    : rpc 127.0.0.1:4445  peer 50502  id {n2.node_id[:16]}...")

    try:
        n1.start()
        bal = int(n1.rpc("eth_getBalance",
                         ["0x" + ethsign.address_of(COW_KEY).hex(), "latest"]), 16)
        gp = n1.gas_price()
        print(f"account  : 0x{ethsign.address_of(COW_KEY).hex()} balance {bal} wei")
        print(f"gasPrice : {gp} wei (the node's eth_gasPrice)")
        print(f"genesis  : node1 height {n1.height()}, fresh database")
        if bal <= 0:
            raise PocError("the premined regtest account has no balance - wrong genesis?")

        if not args.skip_policy:
            phase_policy(n1, gp)
            print("\n     wiping node1's database: the reorg has to start on a chain "
                  "whose account state is not the one P1 just spent")
            n1.stop()
            shutil.rmtree(os.path.join(work, "node1"), ignore_errors=True)
            n1.start()
            print(f"     node1 is back at height {n1.height()} with nonce {n1.nonce()}")

        phase_reorg(n1, n2, gp)

    except Exception as exc:            # noqa: BLE001 - the point is to report it
        print(f"\nABORTED: {exc}")
        for node in (n2, n1):
            try:
                node.stop()
            except Exception:           # noqa: BLE001
                pass
        print(f"\nnode1 log tail:\n{n1.tail(30)}")
        print(f"node2 log tail:\n{n2.tail(30)}")
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
    for phase, claim, ok, detail, at in sorted(RESULTS):
        print(f"  {'PASS' if ok else 'FAIL'}  {phase:<5} {claim}   [{at:5.1f}s]")
    failed = [r for r in RESULTS if not r[2]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed "
          f"in {time.time() - T0:.1f}s")

    summary = {
        "when": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "jar": args.rskj_jar,
        "java": args.java,
        "workdir": work,
        "elapsed_seconds": round(time.time() - T0, 1),
        "passed": len(RESULTS) - len(failed),
        "total": len(RESULTS),
        "checks": [{"phase": p, "claim": c, "ok": o,
                    "detail": d, "at_seconds": round(a, 1)}
                   for p, c, o, d, a in sorted(RESULTS)],
    }
    result_path = os.path.join(work, "result.json")
    with open(result_path, "w") as fh:
        json.dump(summary, fh, indent=2)
    print(f"result.json: {result_path}")
    if args.keep:
        print(f"logs kept in {work}")
    else:
        for name in ("node1", "node2"):
            shutil.rmtree(os.path.join(work, name), ignore_errors=True)
        print(f"logs were in {work} (node directories removed; re-run with --keep "
              f"to keep them)")
    print("""
Reading of a full pass
  P1b  a mined transaction cannot be replaced by gas price at all - rskj rejects
       it on the nonce, so no replace-by-fee exists for something already mined.
  P1c  even in the pool the bump has to clear transaction.gasPriceBump = 40%,
       so the "+10-15%" in the report would be rejected; +100% is accepted.
  P2f  the reorg returns the transaction to the pool.  On its own that is the
       opposite of a corpse: the deposit would be re-mined.
  P3b  what kills it is the replacement, which is only possible AFTER the reorg.
       Once the same-nonce transaction is mined, the original hash is unknown to
       the node forever.
  P4   the control in the same orphaned block comes back, so P3c is caused by the
       replacement and not by the reorg.
""")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
