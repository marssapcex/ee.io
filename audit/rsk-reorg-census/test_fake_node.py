#!/usr/bin/env python3
"""
test_fake_node.py - run reorgcensus.py end to end against a node that is not
real but is not mocked either: a local HTTP JSON-RPC server that serves a chain
and forks it while the watcher is running.  This exercises the whole path -
argparse, urllib, the retry loop, the sqlite store, the detector and the report.

  python3 test_fake_node.py

Expected: probe PASSes, watch prints "REORG depth 1: heights 100..100 replaced",
report shows one reorg of depth 1, export writes one event.  Runs in ~9 s.
"""
import json, os, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def make(h, parent, tag="a"):
    return {"number": hex(h), "hash": f"0x{h:08x}{tag}", "parentHash": parent,
            "timestamp": hex(1700000000 + h * 24)}

chain, st = {}, {"reorged": False}
def build(upto, tag="a"):
    if not chain: chain[0] = make(0, "0x"+"0"*64, "g")
    h = max(chain); parent = chain[h]["hash"]
    for k in range(h+1, upto+1):
        chain[k] = make(k, parent, tag); parent = chain[k]["hash"]
build(100)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        m, p = b.get("method"), b.get("params", [])
        if m == "eth_blockNumber":
            res = hex(max(chain))
        elif m == "eth_getBlockByNumber":
            n = int(p[0], 16)
            # the fork appears the first time the watcher asks for the block
            # above the tip it has already stored
            res = chain.get(n)
        elif m == "eth_getBlockByHash":
            res = next((x for x in chain.values() if x["hash"] == p[0]), None)
        else:
            res = "fake-rskj/0.0.1"
        o = json.dumps({"jsonrpc": "2.0", "id": 1, "result": res}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(o)))
        self.end_headers(); self.wfile.write(o)

def ticker():
    # give the watcher time to store the tip, then fork it away, then keep going
    time.sleep(2.5)
    chain[100] = make(100, chain[99]["hash"], "c")
    build(105, "d")
    st["reorged"] = True
    while True:
        time.sleep(0.5)
        build(max(chain) + 1, "d")

srv = ThreadingHTTPServer(("127.0.0.1", 18545), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
threading.Thread(target=ticker, daemon=True).start(); time.sleep(0.3)

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reorgcensus.py")
DB = os.path.join(tempfile.mkdtemp(prefix="reorgcensus-"), "census.sqlite")
for f in (DB, DB+"-wal", DB+"-shm"):
    if os.path.exists(f): os.remove(f)

def run(*a, **kw):
    r = subprocess.run([sys.executable, "-u", TOOL, *a], capture_output=True, text=True, **kw)
    return r.stdout + (r.stderr or "")

print("### watch (8 s)")
try:
    subprocess.run([sys.executable, "-u", TOOL, "watch", "--rpc", "http://127.0.0.1:18545",
                    "--db", DB, "--interval", "0.2", "--start-depth", "20", "--rps", "50"],
                   capture_output=True, text=True, timeout=6)
except subprocess.TimeoutExpired as e:
    print(((e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")))
print("### probe\n" + run("probe", "--rpc", "http://127.0.0.1:18545", "--sample", "5"))
print("### report\n" + run("report", "--db", DB, "--project"))
print("### export\n" + run("export", "--db", DB, "--out", os.path.join(os.path.dirname(DB), "out.json")))
print(json.dumps(json.load(open(os.path.join(os.path.dirname(DB), "out.json")))["reorgs"], indent=2))
srv.shutdown()
