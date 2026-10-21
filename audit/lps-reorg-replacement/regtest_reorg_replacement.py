#!/usr/bin/env python3
"""
Two rskj regtest nodes, one question: a transaction is mined, a reorg orphans
it, a same-nonce transaction takes its nonce - does the first one come back?

  P1  pool rules: mined is final, a pooled replacement needs +40%.
  P2  build --prefix blocks, sync node2, split, diverge, reconnect, reorg.
  P3  replace the retracted transaction at +15% and +100%, then scan every
      surviving block for the original hash.
  P4  the control transaction, orphaned in the same block and never replaced,
      is mined again - so it is the replacement that killed the other one.

No mock, no emulator, no patched constant, no database touched by hand.
Needs JRE 17+ and rskj-core-*-all.jar; transactions are signed in ethsign.py.

usage: regtest_reorg_replacement.py --rskj-jar ~/rskj.jar [--prefix 12]
                                   [--keep] [--probe] [--skip-policy]
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
# codeless address, so a 21000-gas transfer always ends status 1.
# 0x00..01 is ecrecover: the call runs out of gas and the receipt says 0x0.
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

# no self-mining and no timer: every block comes from an explicit evm_mine
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
        """Kill the JVM this directory started last time; a leftover still
        answers its port, and every number would then be that node's."""
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
        # no start_new_session: if this script is killed the JVM must die too
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

        # the answer has to come from the JVM just launched, not a leftover
        owners = lsof_pids([self.rpc_port]).get(self.rpc_port, [])
        if owners and self.proc.pid not in owners:
            raise PocError(
                f"{self.name}: port {self.rpc_port} is answered by pid {owners}, not "
                f"by the JVM I started (pid {self.proc.pid}).\n"
                f"  that is somebody else's node; every number after this would be "
                f"theirs.  Kill it and run again.")

        # a node that answers RPC but never binds its peer port is useless here
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

        # self-mining would make every height in this run meaningless
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
        # both ports must be free: a node up on a stale peer port is deaf, and
        # a deaf node looks exactly like "the reorg never happened"
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
        """Mine n blocks now, and prove the height moved."""
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
        """{hash: nonce} of what the node holds, or None if unanswered."""
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


_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def _c(code, text):
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def section(text):
    print(f"\n{_c('1', text)}")


def note(text):
    print(f"     {_c('2', text)}")


def row(phase, label, value, ok=True):
    if not isinstance(ok, bool):
        raise PocError(f"row({phase}) got {ok!r}; a verdict must be a bool")
    RESULTS.append((phase, label, ok, str(value), time.time() - T0))
    mark = _c("32", "✓") if ok else _c("1;31", "✗")
    print(f"  {mark} {phase:<4}{label:<10}{value}")
    return ok


_PROGRESS = 0


def progress(text):
    """Redraw one line, on a terminal only, so a piped log stays clean."""
    global _PROGRESS
    if not sys.stdout.isatty():
        return
    sys.stdout.write("\r     " + _c("2", text[:96].ljust(96)))
    sys.stdout.flush()
    _PROGRESS = len(text)


def progress_done():
    global _PROGRESS
    if _PROGRESS and sys.stdout.isatty():
        sys.stdout.write("\r" + " " * 104 + "\r")
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
    """Poll until node1's block at `height` is no longer the one we mined."""
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
    section("P1  pool rules")

    n = n1.nonce()
    a, err = send(n1, n, POOL_GAS)
    if err:
        raise PocError(f"the first transaction was rejected: {err}")
    n1.mine(1)
    rc = wait_receipt(n1, a)
    bal = n1.balance(RECIPIENT)
    status = int(rc["status"], 16) if rc else -1
    row("P1a", "mined",
        f"blk {int(rc['blockNumber'], 16) if rc else '-'}  status {status}  bal {bal}",
        rc is not None and status == 1 and bal == 1)

    # the same nonce, after the account nonce has moved past it
    _, err = send(n1, n, POOL_GAS * 2)
    row("P1b", "remine",
        f"nonce {n}  {POOL_GAS * 2} wei  →  {err}",
        err is not None and "nonce" in err.lower())

    n = n1.nonce()
    a, err = send(n1, n, POOL_GAS)
    if err:
        raise PocError(f"the pool transaction was rejected: {err}")
    small = POOL_GAS * 115 // 100
    _, err_s = send(n1, n, small)
    row("P1c", "+15%",
        f"{small}/{POOL_GAS}  →  {err_s}",
        err_s is not None and "bump" in err_s.lower())

    big = POOL_GAS * 2
    b, err_b = send(n1, n, big)
    gone = n1.tx(a) is None
    row("P1d", "+100%",
        f"{big}/{POOL_GAS}  →  {'accepted' if err_b is None else err_b}"
        f"  old hash {'gone' if gone else 'here'}",
        err_b is None and gone)

    n1.mine(1)
    rc = wait_receipt(n1, b)
    row("P1e", "which",
        f"blk {int(rc['blockNumber'], 16) if rc else '-'}  original receipt "
        f"{n1.receipt(a)}",
        rc is not None and n1.receipt(a) is None)


def phase_reorg(n1, n2, prefix):
    """P2/P3/P4 - reorg of the tip on a chain that has history, then replacement."""
    section("P2  reorg")

    for i in range(1, prefix + 1):
        if i == prefix // 2:            # one real transfer, so the prefix holds state
            send(n1, n1.nonce(), POOL_GAS)
        n1.mine(1)
    h0 = n1.height()
    tip0 = n1.block(h0)["hash"]
    prefix_hashes = {k: n1.block(k)["hash"] for k in range(1, h0 + 1)}
    bal0 = n1.balance(RECIPIENT)
    note(f"prefix  h {h0}   tip {tip0[:10]}   bal {bal0}   nonce {n1.nonce()}")

    # node2 must own the same history before the two chains diverge
    n2.active = [(n1.node_id, n1.peer_port)]
    n2.start()
    try:
        synced = wait_until(
            lambda: n2.height() >= h0 and n2.block(h0)["hash"] == tip0,
            90, "node2 to sync the prefix")
    except PocError:
        synced = False
    row("P2a", "sync", f"node2 h {n2.height()}  tip {tip0[:10]}", synced)
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
    row("P2b", "split",
        f"h {n1.height()}/{n2.height()}  peers {n1.peers()}/{n2.peers()}", isolated)
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
    row("P2c", "mine",
        f"blk {hA}  {hash_A[:10]}  txs {len(a_txs)}",
        victim.lower() in a_txs and control.lower() in a_txs)

    td_a = int(n1.block(n1.height())["totalDifficulty"], 16)
    n2.mine(3)
    td_b = int(n2.block(n2.height())["totalDifficulty"], 16)
    row("P2d", "diff",
        f"A h {n1.height()} td {td_a}   |   B h {n2.height()} td {td_b}", td_b > td_a)
    if td_b <= td_a:
        raise PocError(f"chain B (td {td_b}) is not heavier than chain A (td {td_a})")

    n2.stop()
    n2.active = [(n1.node_id, n1.peer_port)]
    n2.start()
    linked = wait_peers([n1, n2], 1, 45, "p2p")
    row("P2e", "join", f"peers {n1.peers()}/{n2.peers()}", linked)
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
    row("P2f", "switch",
        f"blk {hA}  {hash_A[:8]} → {now_A[:8]}   blk 1..{h0} "
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
    row("P2g", "tips", f"h {n1.height()}/{n2.height()}  {tip[:10]}  td {td_tip}",
        converged and td_tip == td_b)

    vt, kt = n1.tx(victim), n1.tx(control)
    pooled = n1.pool()
    back = (vt is not None and vt.get("blockNumber") is None
            and kt is not None and kt.get("blockNumber") is None)
    nonce_now, bal_now = n1.nonce(), n1.balance(RECIPIENT)
    in_pool = pooled is None or (victim.lower() in pooled and control.lower() in pooled)
    row("P2h", "rollback",
        f"nonce {nonce_now}  bal {bal_now}  pool "
        f"{len(pooled) if pooled is not None else '?'}",
        back and in_pool and nonce_now == n and bal_now == bal0)
    if not back:
        raise PocError("the orphaned transactions did not come back to the pool; "
                       "the rest of the experiment has nothing to act on")

    section("P3  replace")
    small = POOL_GAS * 115 // 100
    _, err_s = send(n1, n, small)
    row("P3a", "+15%", f"{small}/{POOL_GAS}  →  {err_s}",
        err_s is not None and "bump" in err_s.lower())

    b, err_b = send(n1, n, POOL_GAS * 2)
    gone = n1.tx(victim) is None
    row("P3b", "+100%",
        f"{POOL_GAS * 2}/{POOL_GAS}  →  {'accepted' if err_b is None else err_b}"
        f"  victim {'null' if gone else 'here'}", err_b is None and gone)

    n1.mine(1)
    rc = wait_receipt(n1, b)
    n1.mine(2)
    last = n1.height()
    hits = where_mined(n1, victim, hA, last)
    row("P3c", "scan",
        f"blk {hA}..{last}  {'found ' + str(hits) if hits else 'none'}"
        f"   new blk {int(rc['blockNumber'], 16) if rc else '-'}",
        rc is not None and not hits and n1.receipt(victim) is None)

    section("P4  control")
    ck = n1.receipt(control)
    ck_blk = int(ck["blockNumber"], 16) if ck and ck.get("blockNumber") else -1
    bal_final = n1.balance(RECIPIENT)
    row("P4", "mined",
        f"blk {ck_blk}  bal {bal_final}  (same as P2c)",
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
    """Kill rskj started with this workdir's config or holding the PoC's ports.
    A node on any other port is left alone."""
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
    """One node, empty database, its own ports: report what it does."""
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
    """Path, glob, or the usual build output dirs."""
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

    # a leftover JVM keeps its ports and keeps answering: wipe first
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
        acct = "0x" + ethsign.address_of(COW_KEY).hex()
        ver = n1.client_version().split("/")[-1]
        print(_c("1", f"rskj {ver} · regtest"))
        print(f"gas {POOL_GAS} wei (node quotes {gp}) · prefix {args.prefix}"
              f" · node1 4444/50501 · node2 4445/50502")
        print(f"account {acct[:8]}..{acct[-4:]}  bal {bal}")
        if bal <= 0:
            raise PocError("the premined regtest account has no balance - wrong genesis?")

        if not args.skip_policy:
            phase_policy(n1, gp)

        phase_reorg(n1, n2, args.prefix)

    except Exception as exc:            # noqa: BLE001 - the point is to report it
        progress_done()
        print(f"\n  {_c('1;31', 'ABORTED')}  {exc}")
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
    head = (f"{passed}/{len(RESULTS)}" if not failed
            else f"{passed}/{len(RESULTS)}  ✗ " + " ".join(p for p, *_ in failed))
    print(f"\n  {_c('1;32' if not failed else '1;31', head)}   {elapsed:.1f} s")

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
    print(f"  {_c('2', result_path)}")
    if not args.keep:
        for name in ("node1", "node2"):
            shutil.rmtree(os.path.join(work, name), ignore_errors=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
