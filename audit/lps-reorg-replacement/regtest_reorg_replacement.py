#!/usr/bin/env python3
"""
regtest_reorg_replacement.py - what happens to an RSK transaction that a reorg
orphans, and that a same-nonce transaction then replaces?

The LP binds a deposit to a quote, the deposit disappears, and the watcher keeps
retrying a transaction hash that no longer exists on chain.  This script asks
that question of two real rskj nodes instead of arguing about it.

WHAT THE POC DOES, IN ORDER
  1. starts rskj node1 on a fresh regtest database and measures the replacement
     rules of the transaction pool with ordinary transfers: a mined transaction
     cannot be replaced, a pooled one needs +40% (so +15% is refused, +100% is
     accepted), and once accepted the old hash is gone;
  2. grows the chain to --prefix blocks.  That history is the thing the reorg
     must NOT touch;
  3. starts node2, points it at node1 and waits until node2 reports node1's tip
     hash at node1's height, so both nodes own exactly the same history;
  4. disconnects them (peer count 0/0, asserted) and lets the chains diverge:
     node1 mines one block holding the victim and the control, node2 mines three
     empty blocks on the same parent.  Node2's chain now has the larger total
     difficulty - read from both nodes and printed;
  5. reconnects them and waits for node1 to switch: the block with the two
     transactions is orphaned, its hash changes, the prefix blocks keep their
     hashes, and the two transactions go back into node1's pool with the account
     nonce and balance rolled back to their pre-fork values;
  6. sends a same-nonce replacement for the victim at +15% (refused, still) and
     +100% (accepted), mines three blocks, and reads every surviving block for
     the victim's hash.  It is nowhere: the replacement took its nonce.  The
     control - orphaned in the same block, never replaced - is mined again
     normally, which is what shows the reorg alone does not kill a transaction.

  No database is written by hand, no rskj constant is patched, there is no
  emulator and no mock: two JVMs, real blocks, real P2P, real fork choice.

WHY THE ANSWER IS "NEVER COMES BACK"
  A reorg by itself RESCUES the transaction: retractBlock -> addTransactions
  returns the orphaned block's transactions to the pool and they are mined
  again.  What kills it is the replacement, which is only possible after the
  reorg, and which needs +40%: reference.conf:306 sets
  transaction.gasPriceBump = 40 and TransactionPoolImpl:309-311 accepts a
  same-nonce replacement only when new >= old * 140 / 100.  Once the original
  is mined, TxValidatorNonceRangeValidator compares its nonce with the account
  nonce at the best block and answers "transaction nonce too low" - mining is
  final, a reorg is not.

GAS PRICE GRANULARITY
  Regtest quotes 1 wei, and 15% of 1 wei does not exist, so every transfer here
  uses 1000 wei: +15% is 1150, +100% is 2000.

OUTPUT
  one line per measurement, numbers first, nothing interpreted:
      P1a ok    mined, 1 wei delivered              blk=2 status=1 bal=1
      P2d ok    B is heavier on the same parent      A h=15 td=16 | B h=17 td=18
      P2f ok    node1 switched, history untouched     blk15 0xec9e5986->0xdbb931f1 blk1..14 intact
      P3c ok    victim in any surviving block        blk15..20: none replacement blk=18
  and result.json next to it with the same rows and their timestamps.

USAGE
  python3 regtest_reorg_replacement.py --rskj-jar /path/to/rskj-core-*-all.jar
  python3 regtest_reorg_replacement.py --rskj-jar ... --prefix 20
  python3 regtest_reorg_replacement.py --rskj-jar ... --keep     # keep node dirs
  python3 regtest_reorg_replacement.py --rskj-jar ... --probe    # diagnose the box
  python3 ethsign.py                                             # crypto self-test

Needs a JRE 17+ and the rskj fat jar.  Nothing else - no docker, no web3, no
unlocked account: transactions are signed here and pushed with
eth_sendRawTransaction.  The key is the account premined in rskj's own regtest
genesis (genesis/rsk-dev.json, cd2a3d9f938e13cd947ec05abc7fe734df8dd826).

Before anything is measured, rskj processes left by an earlier attempt are
stopped, both databases are wiped, every node has to prove that its peer port is
listening, that its RPC answer comes from the JVM this script just launched, and
that it does not mine on its own.
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
# a plain, codeless address.  The first version of this file sent the wei to
# 0x00..01, which is the ecrecover precompile: with gasLimit == 21000 the call
# has no gas left, the call fails, and the receipt says status 0x0 even though
# the transaction was mined.  Every transaction here must end 0x1.
RECIPIENT = bytes.fromhex("00" * 18 + "dead")
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

    def balance(self, addr):
        return int(self.rpc("eth_getBalance",
                            ["0x" + bytes(addr).hex(), "latest"]), 16)

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


def send(node, nonce, gas_price, value=1):
    raw, digest, sender = ethsign.sign_tx(
        nonce, gas_price, GAS_LIMIT, RECIPIENT, value, b"", CHAIN_ID, COW_KEY)
    try:
        node.rpc("eth_sendRawTransaction", ["0x" + raw.hex()])
        return digest, None
    except RpcError as exc:
        return digest, str(exc)


RESULTS = []
T0 = time.time()


def section(text):
    print(f"\n{text}")


def note(text):
    print(f"     {text}")


def row(phase, label, value, ok=True):
    if not isinstance(ok, bool):
        raise PocError(f"internal: row({phase}) was given {ok!r}, which is not a "
                       f"verdict; a non-empty string must never decide a phase")
    RESULTS.append((phase, label, ok, str(value), time.time() - T0))
    print(f"{phase:<4}{'ok' if ok else 'FAIL':<6}{label:<38}{value}")
    return ok


_PROGRESS = 0


def progress(text):
    """One line that keeps being overwritten, so waiting prints no history."""
    global _PROGRESS
    sys.stdout.write("\r     " + text[:100].ljust(100))
    sys.stdout.flush()
    _PROGRESS = len(text)


def progress_done():
    global _PROGRESS
    if _PROGRESS:
        sys.stdout.write("\r" + " " * 110 + "\r")
        sys.stdout.flush()
        _PROGRESS = 0


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
    while time.time() < deadline:
        counts = [n.peers() for n in nodes]
        if all(c >= want for c in counts):
            progress_done()
            return True
        try:
            progress(f"{label}: " + " | ".join(
                f"{n.name} h={n.height()} peers={c}" for n, c in zip(nodes, counts)))
        except Exception:                      # noqa: BLE001
            progress(f"{label}: a node is not answering")
        time.sleep(0.35)
    progress_done()
    return False


def wait_for_switch(n1, n2, height, old_hash, timeout, label):
    """Poll until node1's block at `height` stops being the one we mined."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            blk = n1.block(height)
            if blk and blk["hash"] != old_hash:
                progress_done()
                return True
        except Exception:                      # noqa: BLE001 - node may be busy
            pass
        try:
            progress(f"{label}: node1 h={n1.height()} peers={n1.peers()} | "
                     f"node2 h={n2.height()} peers={n2.peers()}")
        except Exception:                      # noqa: BLE001
            progress(f"{label}: a node is not answering")
        time.sleep(0.35)
    progress_done()
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


def phase_policy(n1, gp):
    """P1 - what rskj does with a same-nonce transaction."""
    section(f"P1  same-nonce replacement   price {POOL_GAS} wei (eth_gasPrice {gp})")

    n = n1.nonce()
    a, err = send(n1, n, POOL_GAS)
    if err:
        raise PocError(f"the first transaction was rejected: {err}")
    n1.mine(1)
    rc = wait_receipt(n1, a)
    bal = n1.balance(RECIPIENT)
    status = int(rc["status"], 16) if rc else -1
    row("P1a", "mined, 1 wei delivered",
        f"blk={int(rc['blockNumber'], 16) if rc else '-'} status={status} bal={bal}",
        rc is not None and status == 1 and bal == 1)

    # the same nonce, after the account nonce has moved past it
    _, err = send(n1, n, POOL_GAS * 2)
    row("P1b", "same nonce, already mined",
        f"nonce={n} at {POOL_GAS * 2} wei -> {err}",
        err is not None and "nonce" in err.lower())

    n = n1.nonce()
    a, err = send(n1, n, POOL_GAS)
    if err:
        raise PocError(f"the pool transaction was rejected: {err}")
    small = POOL_GAS * 115 // 100
    _, err_s = send(n1, n, small)
    row("P1c", "in the pool, +15%",
        f"{small}/{POOL_GAS} -> {err_s}",
        err_s is not None and "bump" in err_s.lower())

    big = POOL_GAS * 2
    b, err_b = send(n1, n, big)
    gone = n1.tx(a) is None
    row("P1d", "in the pool, +100%",
        f"{big}/{POOL_GAS} -> {'accepted' if err_b is None else err_b},"
        f" old hash {'gone' if gone else 'still there'}",
        err_b is None and gone)

    n1.mine(1)
    rc = wait_receipt(n1, b)
    row("P1e", "which of the two is on chain",
        f"blk={int(rc['blockNumber'], 16) if rc else '-'} "
        f"original receipt={n1.receipt(a)}",
        rc is not None and n1.receipt(a) is None)


def phase_reorg(n1, n2, prefix):
    """P2/P3/P4 - reorg of the tip on a chain that has history, then replacement."""
    section(f"P2  reorg of the tip   chain grows to {prefix} blocks first")

    for i in range(1, prefix + 1):
        if i == prefix // 2:            # one real transfer, so the prefix holds state
            send(n1, n1.nonce(), POOL_GAS)
        n1.mine(1)
    h0 = n1.height()
    tip0 = n1.block(h0)["hash"]
    prefix_hashes = {k: n1.block(k)["hash"] for k in range(1, h0 + 1)}
    bal0 = n1.balance(RECIPIENT)
    note(f"chain A  h={h0} tip={tip0[:16]} bal={bal0} nonce={n1.nonce()}")

    # node2 must own the same history before the two chains diverge
    n2.active = [(n1.node_id, n1.peer_port)]
    n2.start()
    try:
        synced = wait_until(
            lambda: n2.height() >= h0 and n2.block(h0)["hash"] == tip0,
            90, "node2 to sync the prefix")
    except PocError:
        synced = False
    row("P2a", "node2 synced the same tip", f"h={n2.height()} {tip0[:16]}", synced)
    if not synced:
        print(n2.tail(30, only=("sync", "peer", "block", "connect", "reject")))
        raise PocError("node2 never reached node1's tip, so there is no shared "
                       "prefix to fork from")

    n2.stop()
    n2.active = []
    n2.start()
    try:
        wait_until(lambda: n1.peers() == 0 and n2.peers() == 0, 30,
                   "the two nodes to lose each other")
        isolated = True
    except PocError:
        isolated = False
    row("P2b", "both nodes isolated",
        f"h={n1.height()}/{n2.height()} peers={n1.peers()}/{n2.peers()}", isolated)
    if not isolated:
        raise PocError("the nodes are still connected; the next block would travel "
                       "over and the run would not be evidence")

    n = n1.nonce()
    victim, err_v = send(n1, n, POOL_GAS)
    control, err_k = send(n1, n + 1, POOL_GAS)
    if err_v or err_k:
        raise PocError(f"the two transactions were rejected: {err_v!r} {err_k!r}")
    n1.mine(1)
    hA = n1.height()
    hash_A = n1.block(hA)["hash"]
    a_txs = [t["hash"].lower()
             for t in (n1.block(hA, True) or {}).get("transactions", [])]
    if not wait_receipt(n1, victim) or not wait_receipt(n1, control):
        raise PocError("the victim and the control were not mined")
    bal_mined = n1.balance(RECIPIENT)
    row("P2c", "victim + control in one block",
        f"blk={hA} {hash_A[:16]} txs={len(a_txs)}",
        victim.lower() in a_txs and control.lower() in a_txs)

    td_a = int(n1.block(n1.height())["totalDifficulty"], 16)
    n2.mine(3)
    td_b = int(n2.block(n2.height())["totalDifficulty"], 16)
    row("P2d", "B is heavier on the same parent",
        f"A h={n1.height()} td={td_a} | B h={n2.height()} td={td_b}", td_b > td_a)
    if td_b <= td_a:
        raise PocError(f"chain B (td {td_b}) is not heavier than chain A (td {td_a})")

    n2.stop()
    n2.active = [(n1.node_id, n1.peer_port)]
    n2.start()
    linked = wait_peers([n1, n2], 1, 45, "p2p")
    row("P2e", "p2p session", f"peers={n1.peers()}/{n2.peers()}", linked)
    if not linked:
        print(n1.tail(30, only=("peer", "connect", "sync", "handshake", "reject")))
        raise PocError("no P2P session, so no reorg could be attempted")

    switched = wait_for_switch(n1, n2, hA, hash_A, 90, "switch")
    if not switched:
        print(n1.tail(40, only=("sync", "peer", "block", "header", "reject", "difficulty")))
        print(n2.tail(40, only=("sync", "peer", "block", "header", "reject", "difficulty")))
        raise PocError(f"block {hA} never changed after 90 s")

    now_A = n1.block(hA)["hash"]
    prefix_ok = all(n1.block(k)["hash"] == h for k, h in prefix_hashes.items())
    row("P2f", "node1 switched, history untouched",
        f"blk{hA} {hash_A[:8]}->{now_A[:8]} blk1..{h0} "
        f"{'intact' if prefix_ok else 'REWRITTEN'}", prefix_ok)
    if not prefix_ok:
        raise PocError("the reorg rewrote blocks before the fork, so this is not a "
                       "tip reorg and nothing below applies")

    try:
        converged = wait_until(
            lambda: n1.height() == n2.height()
            and n1.block(n1.height())["hash"] == n2.block(n2.height())["hash"],
            20, "the two tips to agree")
    except PocError:
        converged = False
    tipblk = n1.block(n1.height()) or {}
    tip = tipblk.get("hash", "")
    td_tip = int(tipblk["totalDifficulty"], 16) if tipblk.get("totalDifficulty") else -1
    row("P2g", "tips", f"h={n1.height()}/{n2.height()} {tip[:16]} td={td_tip}",
        converged and td_tip == td_b)

    vt, kt = n1.tx(victim), n1.tx(control)
    pooled = n1.pool()
    back = (vt is not None and vt.get("blockNumber") is None
            and kt is not None and kt.get("blockNumber") is None)
    nonce_now, bal_now = n1.nonce(), n1.balance(RECIPIENT)
    in_pool = pooled is None or (victim.lower() in pooled and control.lower() in pooled)
    row("P2h", "pool + state rolled back",
        f"nonce={nonce_now} bal={bal_now} pool="
        f"{len(pooled) if pooled is not None else '?'}",
        back and in_pool and nonce_now == n and bal_now == bal0)
    if not back:
        raise PocError("the orphaned transactions did not come back to the pool; "
                       "the rest of the experiment has nothing to act on")

    section("P3  replacement of the retracted transaction")
    small = POOL_GAS * 115 // 100
    _, err_s = send(n1, n, small)
    row("P3a", "replacement +15%", f"{small}/{POOL_GAS} -> {err_s}",
        err_s is not None and "bump" in err_s.lower())

    b, err_b = send(n1, n, POOL_GAS * 2)
    gone = n1.tx(victim) is None
    row("P3b", "replacement +100%",
        f"{POOL_GAS * 2}/{POOL_GAS} -> {'accepted' if err_b is None else err_b} "
        f"victim={'null' if gone else 'still there'}", err_b is None and gone)

    n1.mine(1)
    rc = wait_receipt(n1, b)
    n1.mine(2)
    last = n1.height()
    hits = where_mined(n1, victim, hA, last)
    row("P3c", "victim in any surviving block",
        f"blk{hA}..{last}: {'found in ' + str(hits) if hits else 'none'} "
        f"replacement blk={int(rc['blockNumber'], 16) if rc else '-'}",
        rc is not None and not hits and n1.receipt(victim) is None)

    section("P4  control: same orphaned block, never replaced")
    ck = n1.receipt(control)
    ck_blk = int(ck["blockNumber"], 16) if ck and ck.get("blockNumber") else -1
    bal_final = n1.balance(RECIPIENT)
    row("P4", "control re-mined",
        f"blk={ck_blk} bal={bal_final} (replacement + control, never the victim)",
        ck_blk >= hA and bal_final == bal_mined)


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
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "**",
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
    ap.add_argument("--prefix", type=int, default=12,
                    help="blocks of history before the fork (default 12); the "
                         "reorg must leave them untouched")
    ap.add_argument("--keep", action="store_true",
                    help="keep the node databases and logs after the run")
    ap.add_argument("--probe", action="store_true",
                    help="diagnose this machine instead of running the PoC")
    ap.add_argument("--skip-policy", action="store_true",
                    help="skip P1 and go straight to the reorg")
    args = ap.parse_args()

    if not 4 <= args.prefix <= 200:
        ap.error("--prefix must be between 4 and 200")

    args.rskj_jar = resolve_jar(args.rskj_jar, ap)
    args.java = resolve_java(args.java)
    work = os.path.abspath(args.workdir)

    if args.probe:
        os.makedirs(work, exist_ok=True)
        return probe(args.rskj_jar, args.java, work)

    # nothing from an earlier attempt may survive: a leftover JVM keeps the ports
    # and keeps answering on them, which is how a previous run spent ten minutes
    # measuring a node it had not started
    cleanup_rskj(work, NODE_PORTS)
    if os.path.exists(work):
        shutil.rmtree(work)
    os.makedirs(work, exist_ok=True)

    n1 = Node("node1", os.path.join(work, "node1"), 4444, 50501,
              ethsign.keccak256(b"poc-node-1")[:32], args.rskj_jar, args.java)
    n2 = Node("node2", os.path.join(work, "node2"), 4445, 50502,
              ethsign.keccak256(b"poc-node-2")[:32], args.rskj_jar, args.java)

    try:
        n1.start()
        bal = int(n1.rpc("eth_getBalance",
                         ["0x" + ethsign.address_of(COW_KEY).hex(), "latest"]), 16)
        gp = n1.gas_price()
        print(f"rskj     {n1.client_version()}")
        print(f"node1    127.0.0.1:4444  peer 50501  id {n1.node_id[:16]}...")
        print(f"node2    127.0.0.1:4445  peer 50502  id {n2.node_id[:16]}...")
        print(f"account  0x{ethsign.address_of(COW_KEY).hex()}  bal={bal}")
        print(f"gasPrice {gp} wei   prefix {args.prefix} blocks")
        print(f"{'phase':<4}{'':<6}{'measurement':<38}value")
        if bal <= 0:
            raise PocError("the premined regtest account has no balance - wrong genesis?")

        if not args.skip_policy:
            phase_policy(n1, gp)

        phase_reorg(n1, n2, args.prefix)

    except Exception as exc:            # noqa: BLE001 - the point is to report it
        progress_done()
        print(f"\nABORTED  {exc}")
        for node in (n2, n1):
            try:
                node.stop()
            except Exception:           # noqa: BLE001
                pass
        print(f"\nnode1 log tail:\n{n1.tail(25)}")
        print(f"node2 log tail:\n{n2.tail(25)}")
        return 1
    finally:
        progress_done()
        for node in (n2, n1):
            try:
                node.stop()
            except Exception:           # noqa: BLE001
                pass

    passed = sum(1 for r in RESULTS if r[2])
    failed = [r for r in RESULTS if not r[2]]
    elapsed = time.time() - T0
    print(f"\n{passed}/{len(RESULTS)} ok   {elapsed:.1f}s")
    if failed:
        print("failed: " + " ".join(f"{p} ({v})" for p, _l, _o, v, _a in failed))

    summary = {
        "when": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "jar": args.rskj_jar,
        "java": args.java,
        "workdir": work,
        "prefix_blocks": args.prefix,
        "elapsed_seconds": round(elapsed, 1),
        "passed": passed,
        "total": len(RESULTS),
        "checks": [{"phase": p, "measurement": l, "ok": o,
                    "value": v, "at_seconds": round(a, 1)}
                   for p, l, o, v, a in RESULTS],
    }
    result_path = os.path.join(work, "result.json")
    with open(result_path, "w") as fh:
        json.dump(summary, fh, indent=2)
    print(f"result.json  {result_path}")
    if args.keep:
        print(f"logs         {work}")
    else:
        for name in ("node1", "node2"):
            shutil.rmtree(os.path.join(work, name), ignore_errors=True)
        print(f"logs kept:   {result_path} (node dirs removed; --keep keeps them)")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
