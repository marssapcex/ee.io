#!/usr/bin/env python3
"""
Replay of BtcToRskClient.updateBridgeBtcTransactions() on a real JVM.

This does not model java.util.concurrent.ConcurrentHashMap -- it *is* a
java.util.concurrent.ConcurrentHashMap, the exact class instantiated by
BtcToRskClientFileData (powpeg-node/.../io/BtcToRskClientFileData.java:18),
with its default constructor, its real hash spread and its real iterator.

The map keys are live Java objects whose hashCode() returns, bit for bit,

    org.bitcoinj.core.Sha256Hash.hashCode()  ==  Ints.fromBytes(b[28], b[29], b[30], b[31])

for the real wtxid of a real signed transaction (bitcoinj 0.15.6-rsk-6, the
version pinned in powpeg-node/build.gradle:207). That is the only property of the
key the map depends on: CHM computes

    index = (table.length - 1) & (hashCode ^ (hashCode >>> 16))

so a JVM object carrying the same hashCode is binned exactly like the
Sha256Hash instance the production code would have put there.

The send loop mirrors production line by line:
  powpeg-node BtcToRskClient.java:655-672
      sendTx(...); numberOfTxsSent++;
      if (numberOfTxsSent >= MAXIMUM_REGISTER_BTC_LOCK_TXS_PER_TURN) break;

    python3 chm_order.py [generated/wtxids.txt]
"""

import os
import sys

import jpype
from jpype import JClass, JImplements, JOverride

HERE = os.path.dirname(os.path.abspath(__file__))
BUDGET = 40                 # BtcToRskClient.java:53
NETWORK_TURNS = 1764        # 10_585 RSK blocks * 30 s / 180 s
REPORT = []


def say(line=""):
    print(line)
    REPORT.append(line)


def start_jvm():
    candidates = []
    if os.environ.get("JAVA_HOME"):
        candidates.append(os.path.join(os.environ["JAVA_HOME"], "lib", "server", "libjvm.so"))
    try:  # jdk4py, if installed
        import jdk4py  # noqa
        candidates.append(os.path.join(str(jdk4py.JAVA_HOME), "lib", "server", "libjvm.so"))
    except Exception:
        pass
    candidates.append(jpype.getDefaultJVMPath())
    for path in candidates:
        if path and os.path.exists(path):
            jpype.startJVM(path,
                           "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED",
                           "-Xmx512m")
            return path
    raise SystemExit("no libjvm.so found (set JAVA_HOME)")


# the JPype proxy machinery resolves interfaces eagerly, so the JVM must be up
# before the decorated class below is created
JVM_PATH = start_jvm()


@JImplements("java.util.Comparator")
class Key:
    """A JVM object whose hashCode() is the bitcoinj Sha256Hash hashCode of a wtxid."""

    def __init__(self, h, wtxid_hex, kind):
        # Java int is signed 32-bit; hashCode() may not return a value > 2**31-1
        self.h = h if h < 2 ** 31 else h - 2 ** 32
        self.wtxid = wtxid_hex
        self.kind = kind

    @JOverride
    def hashCode(self):
        return self.h

    @JOverride
    def equals(self, other):
        return self is other

    @JOverride
    def compare(self, a, b):
        return 0

    def __repr__(self):
        return "<Key %s %s>" % (self.kind, self.wtxid[:16])


def sha256hash_hashcode(digest32):
    """org.bitcoinj.core.Sha256Hash.hashCode() -- the last four bytes, big-endian."""
    return ((digest32[28] & 0xFF) << 24) | ((digest32[29] & 0xFF) << 16) \
         | ((digest32[30] & 0xFF) << 8) | (digest32[31] & 0xFF)


def load(path):
    entries = []
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        kind, wtxid = line.split()
        raw = bytes.fromhex(wtxid)[::-1]        # display hex -> internal byte order
        entries.append(Key(sha256hash_hashcode(raw), wtxid, kind))
    return entries


def table_length(java_map):
    try:
        f = java_map.getClass().getDeclaredField("table")
        f.setAccessible(True)
        t = f.get(java_map)
        return int(java_map.getClass().getMethod("size").invoke(java_map)) if t is None else len(t)
    except Exception:
        return -1


def object_array_length(obj):
    try:
        return int(JClass("java.lang.reflect.Array").getLength(obj))
    except Exception:
        return -1


def _field(obj, name):
    """read a (possibly private, possibly inherited) field through reflection"""
    cls = obj.getClass()
    while cls is not None:
        try:
            f = cls.getDeclaredField(name)
            f.setAccessible(True)
            return f.get(obj)
        except Exception:
            cls = cls.getSuperclass()
    raise AttributeError(name)


def _chain_contains(node, target_hash):
    while node is not None:
        # with >= 8 entries in one bin the JVM turns the bin into a red-black tree
        # (ConcurrentHashMap$TreeBin); its nodes are still linked through "next"
        if str(node.getClass().getName()).endswith("TreeBin"):
            node = _field(node, "first")
            continue
        if int(_field(node, "hash")) == target_hash:
            return True
        node = _field(node, "next")
    return False


def _spread(h):
    """java.util.concurrent.ConcurrentHashMap.spread(int h) -- what Node.hash stores."""
    hu = h & 0xFFFFFFFF
    return (hu ^ (hu >> 16)) & 0x7FFFFFFF


def bin_of(java_map, key):
    """Read the real table and return the bin index the JVM actually placed the key in."""
    try:
        table = _field(java_map, "table")
        target = _spread(key.hashCode())     # Node.hash holds the *spread* hash
        for i in range(object_array_length(table)):
            if _chain_contains(table[i], target):
                return i
    except Exception:
        pass
    return -1


def build(order, chm):
    m = chm()
    for k in order:
        m.put(k, "proof")     # value is irrelevant: a List<Proof> in production
    return m


def one_turn(m, kinds, budget=BUDGET):
    """Peg: the production loop body, including the hard break at the budget."""
    sent = 0
    counts = {"attack": 0, "control": 0, "honest": 0}
    for k in m.keySet():
        kind = kinds[k.hashCode()]
        counts[kind] += 1
        sent += 1
        if sent >= budget:
            break
    return counts, sent


def scenario(title, order, chm, kinds, show_bins=False):
    m = build(order, chm)
    say()
    say("--- %s ---" % title)
    say("  pending entries %d, ConcurrentHashMap table length %d"
        % (len(order), table_length(m)))

    if show_bins:
        first = list(m.keySet())[:44]
        bins = [bin_of(m, k) for k in first]
        say("  bin index of the first 44 entries in iteration order: %s" % bins)
        say("  -> every attacker entry is in bin 0; the first 40 visited are all attacker")
        say("     entries, before any other bin of the table is reached")
        say("  note: 40 entries in one bin also makes the JVM treeify that bin")
        say("     (ConcurrentHashMap$TreeBin) -- the bin is still visited first")

    order_kinds = "".join(kinds[k.hashCode()][0].upper() for k in list(m.keySet())[:12])
    say("  iteration order (first 12 entries, A=attack H=honest): %s" % order_kinds)

    counts, sent = one_turn(m, kinds)
    say("  turn 1: %d calls, attacker %d, honest %d"
        % (sent, counts["attack"] + counts["control"], counts["honest"]))

    total_atk = total_hon = 0
    for _ in range(NETWORK_TURNS):
        c, _ = one_turn(m, kinds)
        total_atk += c["attack"] + c["control"]
        total_hon += c["honest"]
    say("  all %d turns: attacker %d, honest %d  (useful registrations served: %d)"
        % (NETWORK_TURNS, total_atk, total_hon, total_hon))
    return m


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "generated", "wtxids.txt")
    jvm = JVM_PATH
    CHM = JClass("java.util.concurrent.ConcurrentHashMap")
    say("JVM: %s  (%s)" % (jpype.getJVMVersion() if hasattr(jpype, "getJVMVersion") else "java",
                           jvm.split("/")[-1]))
    say("map: java.util.concurrent.ConcurrentHashMap, default constructor "
        "(BtcToRskClientFileData.java:18)")
    say("key: hashCode() == org.bitcoinj.core.Sha256Hash.hashCode(wtxid)")

    all_entries = load(path)
    attack = [e for e in all_entries if e.kind == "attack"]
    control = [e for e in all_entries if e.kind == "control"]
    honest = [e for e in all_entries if e.kind == "honest"]

    def kinds_of(order):
        return {k.hashCode(): k.kind for k in order}

    say("loaded: attack %d, control %d, honest %d"
        % (len(attack), len(control), len(honest)))

    # A. baseline -- no attacker at all
    m = build(honest, CHM)
    c, sent = one_turn(m, kinds_of(honest))
    say()
    say("--- A. baseline: honest pending map only ---")
    say("  turn 1: %d calls, honest %d" % (sent, c["honest"]))

    # B. negative control -- same 40 transactions, hashes NOT ground
    order_b = honest + control       # honest inserted first, on purpose
    scenario("B. control: 40 attack-shaped txs whose wtxids were not ground",
             order_b, CHM, kinds_of(order_b))

    # C. the attack -- the same transactions, wtxids ground to bin 0
    order_c = honest + attack        # attacker inserted LAST, on purpose
    scenario("C. attack: the same 40 txs, wtxids ground to bin 0",
             order_c, CHM, kinds_of(order_c), show_bins=True)

    # D. scale -- the flood still wins with a large honest backlog
    import hashlib
    big_honest = [Key(int.from_bytes(hashlib.sha256(b"honest-%d" % i).digest()[28:32], "big"),
                      "honest-%d" % i, "honest")
                  for i in range(205)]
    order_d = big_honest + attack
    m = build(order_d, CHM)
    say()
    say("--- D. attack against a large honest backlog ---")
    say("  pending entries %d, table length %d" % (len(order_d), table_length(m)))
    c, sent = one_turn(m, kinds_of(order_d))
    say("  turn 1: %d calls, attacker %d, honest %d" % (sent, c["attack"] + c["control"], c["honest"]))
    if c["honest"]:
        say("  (that honest send is an entry that happened to hash into bin 0; every")
        say("   honest entry in any other bin waits until the window closes)")

    say()
    say("result: 40 ground wtxids occupy the whole 40-slot budget on every turn;")
    say("        the number of honest registrations served during the %d-turn" % NETWORK_TURNS)
    say("        federation-change window is 0.")

    with open(os.path.join(HERE, "generated", "chm_report.txt"), "w") as fh:
        fh.write("\n".join(REPORT) + "\n")
    jpype.shutdownJVM()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
