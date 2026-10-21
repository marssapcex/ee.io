#!/usr/bin/env python3
"""
reorgcensus.py - measure how often the Rootstock (RSK) chain reorganises.

Why a watcher and not a query: an RSK node keeps only the canonical chain. A
block that lost a fork is deleted from the database (rskj IndexedBlockStore.
removeBlock) and no RPC enumerates it. So "how many reorgs happened last year"
cannot be answered by asking a node today - it can only be answered by watching
the chain while it happens, which is what this does. See CAVEATS at the bottom.

Usage
-----
  ./reorgcensus.py selftest                 # prove the detector on synthetic chains
  ./reorgcensus.py probe                    # is the endpoint reachable, what is the block time
  ./reorgcensus.py watch                    # observe until interrupted (resumable)
  ./reorgcensus.py report                   # what has been observed so far
  ./reorgcensus.py export --json out.json   # machine-readable dump

Typical run against the public node:

  ./reorgcensus.py watch \
      --rpc https://public-node.rsk.co \
      --db reorg.sqlite \
      --rps 4

Leave it running (screen/tmux/systemd).  Restarting resumes from the database;
a reorg that happened while it was stopped is still detected and recorded with
detection='resume', only its exact depth is then unknown.

Exit codes: 0 ok, 1 runtime error, 2 bad usage.  Python 3.8+, standard library
only - no pip install, no node, no docker.
"""

import argparse
import json
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_RPC = "https://public-node.rsk.co"
SCHEMA = """
CREATE TABLE IF NOT EXISTS blocks (
    height     INTEGER PRIMARY KEY,
    hash       TEXT NOT NULL,
    parent     TEXT NOT NULL,
    ts         INTEGER,
    first_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reorgs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at INTEGER NOT NULL,
    fork_height INTEGER NOT NULL,
    old_tip     INTEGER NOT NULL,
    new_tip     INTEGER NOT NULL,
    depth       INTEGER NOT NULL,
    detection   TEXT NOT NULL,
    old_hashes  TEXT NOT NULL,
    new_hash    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def now():
    return int(time.time())


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")


# --------------------------------------------------------------------------
# RPC
# --------------------------------------------------------------------------


class RpcError(RuntimeError):
    pass


class Rpc:
    """Minimal JSON-RPC client: retries with backoff, global rate limit."""

    def __init__(self, url, timeout=20.0, retries=5, rps=4.0, verbose=False):
        self.url = url
        self.timeout = timeout
        self.retries = retries
        self.min_interval = (1.0 / rps) if rps > 0 else 0.0
        self.verbose = verbose
        self._last_call = 0.0
        self.calls = 0

    def _throttle(self):
        if self.min_interval:
            wait = self._last_call + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
        self._last_call = time.monotonic()

    def call(self, method, params):
        body = json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        ).encode()
        last = None
        for attempt in range(self.retries):
            self._throttle()
            req = urllib.request.Request(
                self.url,
                data=body,
                headers={"Content-Type": "application/json", "User-Agent": "reorgcensus/1"},
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode())
                self.calls += 1
                if payload.get("error"):
                    raise RpcError(f"{method}: {payload['error']}")
                return payload.get("result")
            except (urllib.error.URLError, OSError, ValueError, RpcError) as exc:
                last = exc
                if self.verbose:
                    print(f"  retry {attempt + 1}/{self.retries} {method}: {exc}", file=sys.stderr)
                time.sleep(min(2 ** attempt, 20) * (0.5 + random.random() / 2))
        raise RpcError(f"{method} failed after {self.retries} attempts: {last}")

    def block_number(self):
        return int(self.call("eth_blockNumber", []), 16)

    def get_block_by_number(self, height):
        return _norm(self.call("eth_getBlockByNumber", [hex(height), False]))

    def get_block_by_hash(self, h):
        return _norm(self.call("eth_getBlockByHash", [h, False]))


def _norm(blk):
    if not blk:
        return None
    return {
        "height": int(blk["number"], 16),
        "hash": blk["hash"],
        "parent": blk["parentHash"],
        "ts": int(blk.get("timestamp", "0x0"), 16),
    }


# --------------------------------------------------------------------------
# store
# --------------------------------------------------------------------------


class Store:
    def __init__(self, path):
        self.conn = sqlite3.connect(path)
        self.conn.executescript(SCHEMA)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.commit()

    def close(self):
        self.conn.close()

    # --- blocks ---
    def put(self, blk, ts=None):
        self.conn.execute(
            "INSERT OR REPLACE INTO blocks(height,hash,parent,ts,first_seen) VALUES (?,?,?,?,?)",
            (blk["height"], blk["hash"], blk["parent"], blk["ts"], ts or now()),
        )
        self.conn.commit()

    def get(self, height):
        row = self.conn.execute(
            "SELECT height,hash,parent,ts FROM blocks WHERE height=?", (height,)
        ).fetchone()
        if not row:
            return None
        return {"height": row[0], "hash": row[1], "parent": row[2], "ts": row[3]}

    def bounds(self):
        row = self.conn.execute("SELECT MIN(height), MAX(height), COUNT(*) FROM blocks").fetchone()
        return row[0], row[1], row[2]

    def truncate_above(self, height):
        self.conn.execute("DELETE FROM blocks WHERE height>?", (height,))
        self.conn.commit()

    # --- reorgs ---
    def add_reorg(self, fork, old_tip, new_tip, depth, detection, old_hashes, new_hash):
        self.conn.execute(
            "INSERT INTO reorgs(detected_at,fork_height,old_tip,new_tip,depth,detection,old_hashes,new_hash)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (now(), fork, old_tip, new_tip, depth, detection, ",".join(old_hashes), new_hash),
        )
        self.conn.commit()

    def reorgs(self):
        rows = self.conn.execute(
            "SELECT id,detected_at,fork_height,old_tip,new_tip,depth,detection,old_hashes,new_hash"
            " FROM reorgs ORDER BY id"
        ).fetchall()
        keys = ("id", "detected_at", "fork_height", "old_tip", "new_tip", "depth", "detection",
                "old_hashes", "new_hash")
        return [dict(zip(keys, r)) for r in rows]


# --------------------------------------------------------------------------
# detector
# --------------------------------------------------------------------------


class Watcher:
    """
    Maintains a contiguous height -> hash map and reports every discontinuity.

    The chain is only ever read forward, one height at a time, so the stored map
    is exactly what this process has seen. A reorg shows up twice:
      - a new block whose parentHash is not the hash we stored at height-1;
      - a node whose tip went backwards.
    In both cases we walk the new branch backwards until it joins our map; that
    join point is the fork height, and old_tip - fork is the depth.
    """

    def __init__(self, store, rpc, max_walk=512, log=print):
        self.store = store
        self.rpc = rpc
        self.max_walk = max_walk
        self.log = log
        # set when the map already has history: the first discontinuity after a
        # restart happened while we were not looking, so its depth is exact but
        # the moment it happened is not
        self.resume_pending = False

    def _record(self, fork, old_tip, new_tip, detection, old_hashes, new_hash):
        depth = old_tip - fork
        self.store.truncate_above(fork)
        self.store.add_reorg(fork, old_tip, new_tip, depth, detection, old_hashes, new_hash)
        self.log(
            f"  REORG depth {depth}: heights {fork + 1}..{old_tip} replaced "
            f"(fork at {fork}, new tip {new_tip}, {detection})"
        )

    def reconcile(self, tip):
        """Handle tip going backwards relative to what we stored."""
        lo, hi, _ = self.store.bounds()
        if hi is None or hi <= tip:
            return False
        floor = max(lo if lo is not None else 0, tip - self.max_walk)
        fork = None
        for k in range(tip, floor - 1, -1):
            blk = self.rpc.get_block_by_number(k)
            stored = self.store.get(k)
            if stored and blk and stored["hash"] == blk["hash"]:
                fork = k
                break
        if fork is None:
            fork = floor
        old_hashes = []
        for k in range(fork + 1, hi + 1):
            b = self.store.get(k)
            if b:
                old_hashes.append(b["hash"])
        self._record(fork, hi, tip, "rollback", old_hashes,
                     self.rpc.get_block_by_number(tip)["hash"] if fork < tip else "")
        return True

    def resolve(self, blk, height):
        """
        A discontinuity was seen at `height`; find the fork point and record it.

        We walk the NEW branch backwards (by hash, straight from the node, so
        the walk is not limited by what we happen to have stored) until a block
        matches the hash we stored at that height.  The match is the fork.

        If the fork sits further back than max_walk we cannot name it; we then
        truncate at the deepest point we reached and flag the event 'deep' so
        the depth is known to be a lower bound rather than a measurement.
        """
        _, old_tip, _ = self.store.bounds()
        fork = None
        detection = "watch"
        cur_hash = blk["parent"]
        cur_h = height - 1
        floor = max(0, height - self.max_walk)
        while cur_h >= floor:
            stored = self.store.get(cur_h)
            if stored and stored["hash"] == cur_hash:
                fork = cur_h
                break
            nxt = self.rpc.get_block_by_hash(cur_hash)
            if not nxt:
                break
            cur_hash = nxt["parent"]
            cur_h -= 1
        if fork is None:
            fork = max(0, cur_h)
            detection = "deep"
        if detection == "watch" and self.resume_pending:
            detection = "resume"
        self.resume_pending = False
        # the block at height-1 is known to differ, so we must always drop at
        # least one stored block - otherwise advance() would make no progress
        fork = max(0, min(fork, height - 2))
        old_hashes = []
        for k in range(fork + 1, old_tip + 1):
            b = self.store.get(k)
            if b:
                old_hashes.append(b["hash"])
        self._record(fork, old_tip, height, detection, old_hashes, blk["hash"])
        return True

    def advance(self, tip):
        """Fetch forward until `tip`. Returns number of blocks ingested."""
        lo, hi, _ = self.store.bounds()
        if hi is None:
            start = max(0, tip - self.start_depth)
            self.start_depth = 0
            h = start
        else:
            h = hi + 1
        n = 0
        guard = 0
        while h <= tip:
            blk = self.rpc.get_block_by_number(h)
            if blk is None:
                self.log(f"  node returned no block at height {h}; stopping this pass")
                break
            prev = self.store.get(h - 1)
            if prev and prev["hash"] != blk["parent"]:
                self.resolve(blk, h)
                lo, hi, _ = self.store.bounds()
                h = (hi + 1) if hi is not None else max(0, h - 2)
                guard += 1
                if guard > 200:
                    raise RuntimeError(
                        f"cannot stabilise height {h}: the node keeps answering with a "
                        f"different block each poll. Stop, check the endpoint, retry."
                    )
                continue
            self.store.put(blk)
            n += 1
            h += 1
        return n

    start_depth = 32


# --------------------------------------------------------------------------
# selftest - the detector against chains whose reorgs we chose ourselves
# --------------------------------------------------------------------------


class FakeRpc:
    """Holds the current canonical chain; reorgs are applied by the test."""

    def __init__(self):
        self.chain = {}

    def block_number(self):
        return max(self.chain)

    def get_block_by_number(self, h):
        return self.chain.get(h)

    def get_block_by_hash(self, h):
        for b in self.chain.values():
            if b["hash"] == h:
                return b
        return None

    @staticmethod
    def make(h, parent, tag="a"):
        return {"height": h, "hash": f"0x{h:08x}{tag}", "parent": parent, "ts": 1700000000 + h * 24}

    def extend(self, upto, tag="a"):
        if not self.chain:
            genesis = self.make(0, "0x" + "0" * 64, "g")
            self.chain[0] = genesis
        h = max(self.chain)
        parent = self.chain[h]["hash"]
        for k in range(h + 1, upto + 1):
            b = self.make(k, parent, tag if tag != "a" else ("a" if k % 2 else "b"))
            self.chain[b["height"]] = b
            parent = b["hash"]

    def reorg(self, from_height, depth, tag):
        """Replace heights from_height..from_height+depth-1 with a new branch."""
        parent = self.chain[from_height - 1]["hash"]
        for k in range(from_height, from_height + depth):
            b = self.make(k, parent, tag)
            self.chain[b["height"]] = b
            parent = b["hash"]
        # drop everything above the replaced branch
        for k in [k for k in self.chain if k >= from_height + depth]:
            del self.chain[k]


def selftest():
    print("selftest: synthetic chain, reorgs injected at known heights")
    rpc = FakeRpc()
    rpc.extend(200)
    watcher = Watcher(Store(":memory:"), rpc, log=lambda *a: None)
    store = watcher.store
    watcher.start_depth = 200   # start the map at height 0
    # 1) walk 0..150 and stop, so the old branch is in the map
    rpc.chain = {k: v for k, v in rpc.chain.items() if k <= 150}
    watcher.advance(150)
    assert store.bounds()[1] == 150, store.bounds()

    # 2) depth-1 reorg at 150, then continue
    rpc.reorg(150, 1, "c")
    rpc.extend(160)
    watcher.advance(160)

    # 3) depth-2 reorg replacing two blocks we had already stored (159, 160)
    rpc.reorg(159, 2, "d")
    rpc.extend(170)
    watcher.advance(170)

    # 4) depth-3 reorg replacing three stored blocks (168..170)
    rpc.reorg(168, 3, "e")
    rpc.extend(180)
    watcher.advance(180)

    # 5) tip rollback: the node loses the top 2 blocks
    for k in (179, 180):
        del rpc.chain[k]
    watcher.reconcile(178)
    rpc.extend(185)
    watcher.advance(185)

    events = store.reorgs()
    got = [(e["fork_height"], e["depth"], e["detection"]) for e in events]
    want = [(149, 1, "watch"), (158, 2, "watch"), (167, 3, "watch"), (178, 2, "rollback")]
    print(f"  expected: {want}")
    print(f"  detected: {got}")
    assert got == want, "detector mismatch"
    hi = store.bounds()[1]
    assert hi == 185, hi
    # the map must stay contiguous and end on the live tip
    for h in range(store.bounds()[0], hi):
        assert store.get(h)["hash"] == store.get(h + 1)["parent"], f"broken link at {h}"
    print(f"  chain map contiguous {store.bounds()[0]}..{hi} and ends on tip")
    print("  PASS")
    return 0


# --------------------------------------------------------------------------
# probe
# --------------------------------------------------------------------------


def probe(args):
    rpc = Rpc(args.rpc, rps=args.rps, verbose=args.verbose)
    try:
        version = rpc.call("web3_clientVersion", [])
    except RpcError:
        version = "(web3_clientVersion unavailable)"
    tip = rpc.block_number()
    print(f"endpoint : {args.rpc}")
    print(f"client   : {version}")
    print(f"tip      : {tip}")
    n = min(args.sample, tip)
    blocks = []
    for h in range(tip - n + 1, tip + 1):
        b = rpc.get_block_by_number(h)
        if b:
            blocks.append(b)
    if len(blocks) > 1:
        span = blocks[-1]["ts"] - blocks[0]["ts"]
        print(f"blocktime: {span / (len(blocks) - 1):.2f}s over {len(blocks)} blocks")
    print("  PASS  (endpoint answers eth_blockNumber and eth_getBlockByNumber)")
    return 0


# --------------------------------------------------------------------------
# watch / report / export
# --------------------------------------------------------------------------


def watch(args):
    store = Store(args.db)
    rpc = Rpc(args.rpc, rps=args.rps, verbose=args.verbose)
    watcher = Watcher(store, rpc, max_walk=args.max_walk)
    watcher.start_depth = args.start_depth
    lo, hi, n = store.bounds()
    print(f"db       : {args.db}")
    print(f"endpoint : {args.rpc}")
    if hi is not None:
        watcher.resume_pending = True
        print(f"resuming : {n} blocks stored, heights {lo}..{hi}")
    else:
        print(f"starting : no history, will begin {args.start_depth} blocks below the tip")
    print("watching (Ctrl-C to stop; state is saved after every block)\n")
    idle = 0
    try:
        while True:
            tip = rpc.block_number()
            if hi is not None and hi > tip:
                print(f"  tip moved backwards: stored {hi}, node says {tip}")
                watcher.reconcile(tip)
            ingested = watcher.advance(tip)
            lo, hi, n = store.bounds()
            if ingested:
                print(f"  {iso(now())}  tip {tip}  stored {n} blocks  heights {lo}..{hi}")
                idle = 0
            else:
                idle += 1
                if idle % 30 == 1:
                    print(f"  {iso(now())}  waiting, tip {tip}, stored {n} blocks, "
                          f"{len(store.reorgs())} reorgs so far")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped by user")
    finally:
        store.close()
    return 0


def report(args):
    store = Store(args.db)
    lo, hi, n = store.bounds()
    if not n:
        print("no data yet - run `reorgcensus.py watch` first")
        return 1
    events = store.reorgs()
    first_seen = store.conn.execute("SELECT MIN(first_seen), MAX(first_seen) FROM blocks").fetchone()
    span_s = max(1, (first_seen[1] or now()) - (first_seen[0] or now()))
    last_ts = store.get(hi)["ts"] if store.get(hi) else 0
    first_ts = store.get(lo)["ts"] if store.get(lo) else 0
    chain_span = max(1, last_ts - first_ts)

    print("=" * 72)
    print("RSK REORG CENSUS")
    print("=" * 72)
    print(f"database          : {args.db}")
    print(f"heights covered   : {lo}..{hi}  ({n} blocks)")
    print(f"chain time covered: {chain_span / 86400:.2f} days  (~{chain_span / 3600:.1f} h)")
    print(f"wall time watched : {span_s / 3600:.2f} h")
    if n > 1:
        print(f"mean block time   : {chain_span / (n - 1):.2f} s")
    print()

    depth_hist = {}
    orphaned = 0
    for e in events:
        depth_hist[e["depth"]] = depth_hist.get(e["depth"], 0) + 1
        orphaned += e["depth"]

    print(f"reorgs detected   : {len(events)}")
    print(f"blocks orphaned   : {orphaned}  ({100.0 * orphaned / n:.2f}% of the blocks we saw)")
    if events:
        print(f"mean depth        : {orphaned / len(events):.2f}")
        print(f"rate              : 1 reorg every {n / len(events):.1f} blocks"
              f"  ({len(events) / max(chain_span / 86400, 1e-9):.1f} per day at this sample)")
        print(f"depth histogram   : " + ", ".join(f"{d}: {c}" for d, c in sorted(depth_hist.items())))
        print(f"deepest reorg     : {max(depth_hist)}")
        print()
        print(f"{'when (UTC)':<20} {'fork':>10} {'depth':>6} {'how':>9}")
        for e in events[-args.last:]:
            print(f"{iso(e['detected_at']):<20} {e['fork_height']:>10} {e['depth']:>6} {e['detection']:>9}")
    else:
        print("no reorg seen yet - either the chain was quiet or the watch has just begun")
    print()

    if args.project and n > 100:
        share = orphaned / n
        print("-" * 72)
        print("projection for the LP deposit watcher (clearly a projection, not a measurement)")
        print("-" * 72)
        print(f"a deposit mined into a random block sits in a block that is later orphaned")
        print(f"with probability {share * 100:.2f}%, measured on this sample.")
        print(f"the LP binds that deposit at its next 60 s tick; if the block is orphaned")
        print(f"after the bind and the transaction is replaced, the quote is a corpse.")
        print(f"at {args.max_value} RSBTC max quote value, {args.lp_balance} RSBTC of liquidity")
        print(f"needs {args.lp_balance / args.max_value:.0f} corpses to be exhausted.")
        print("-" * 72)
    store.close()
    return 0


def export(args):
    store = Store(args.db)
    lo, hi, n = store.bounds()
    payload = {
        "generated_at": iso(now()),
        "rpc": args.rpc,
        "heights": {"from": lo, "to": hi, "count": n},
        "reorgs": store.reorgs(),
    }
    with open(args.out, "w") as fh:
        json.dump(payload, fh, indent=2)
    print(f"wrote {args.out}: {len(payload['reorgs'])} reorgs over {n} blocks")
    store.close()
    return 0


# --------------------------------------------------------------------------


def main(argv=None):
    # accepted both before and after the subcommand, so that
    # `reorgcensus.py probe --rpc URL` works as naturally as the reverse order
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--rpc", default=argparse.SUPPRESS)
    common.add_argument("--db", default=argparse.SUPPRESS)
    common.add_argument("--rps", type=float, default=argparse.SUPPRESS)
    common.add_argument("--verbose", action="store_true", default=argparse.SUPPRESS)

    p = argparse.ArgumentParser(
        description="Measure how often Rootstock reorganises its chain.",
        epilog=CAVEATS,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--rpc", default=DEFAULT_RPC, help=f"RSK JSON-RPC endpoint (default {DEFAULT_RPC})")
    p.add_argument("--db", default="reorg.sqlite", help="state file (default reorg.sqlite)")
    p.add_argument("--rps", type=float, default=4.0, help="max requests per second (default 4)")
    p.add_argument("--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd")

    s = sub.add_parser("selftest", parents=[common], help="prove the detector on synthetic chains")
    s.set_defaults(func=lambda a: selftest())

    s = sub.add_parser("probe", parents=[common], help="check the endpoint and measure its block time")
    s.add_argument("--sample", type=int, default=200)
    s.set_defaults(func=probe)

    s = sub.add_parser("watch", parents=[common], help="observe the chain until interrupted")
    s.add_argument("--interval", type=float, default=2.0, help="seconds between passes (default 2)")
    s.add_argument("--start-depth", type=int, default=32, help="blocks below tip on a fresh start")
    s.add_argument("--max-walk", type=int, default=512, help="how far back to hunt for the fork")
    s.set_defaults(func=watch)

    s = sub.add_parser("report", parents=[common], help="summarise what has been observed")
    s.add_argument("--last", type=int, default=40, help="show the last N events (default 40)")
    s.add_argument("--project", action="store_true", help="add the LP projection block")
    s.add_argument("--max-value", type=float, default=100.0, help="LP max pegout quote, RSBTC")
    s.add_argument("--lp-balance", type=float, default=300.0, help="LP pegout liquidity, RSBTC")
    s.set_defaults(func=report)

    s = sub.add_parser("export", parents=[common], help="dump everything as JSON")
    s.add_argument("--out", default="reorgs.json")
    s.set_defaults(func=export)

    args = p.parse_args(argv)
    if not getattr(args, "func", None):
        p.print_help()
        return 2
    return args.func(args)


CAVEATS = """\
CAVEATS - read before quoting the numbers
  * A node keeps only the canonical chain, so the past cannot be replayed. This
    tool measures from the moment you start it. There is no RPC that lists
    orphaned blocks: rskj deletes them on switch (IndexedBlockStore.removeBlock).
  * Detection requires having seen the old block before it was replaced. With
    --interval 2 and ~24-30 s blocks that holds for essentially every reorg; a
    fork that appears and resolves inside one polling gap can be missed, so the
    count is a lower bound, never an overestimate.
  * If the process is stopped across a reorg, the event is still recorded but
    flagged detection='resume' because the exact depth is no longer knowable.
  * `estimate` of blocks orphaned counts old_tip-fork per event; a chain that
    reorgs twice in the same place counts twice, which is what you want if you
    are asking "how often does a block I saw disappear".
  * Public endpoints are rate limited; --rps 4 is polite. Your own node is
    better: --rpc http://127.0.0.1:4444
"""


if __name__ == "__main__":
    sys.exit(main())
