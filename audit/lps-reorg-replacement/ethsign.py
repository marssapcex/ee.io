#!/usr/bin/env python3
"""
ethsign.py - the minimum needed to build and sign a legacy (pre-EIP-2718)
Ethereum transaction, in the standard library.  Used by regtest_reorg_replacement.py
so the proof does not need a wallet, web3.py, or an unlocked account on the node.

Everything here is checked by `python3 ethsign.py`, which prints PASS/FAIL for
each property (keccak vectors, the premined regtest account, RLP, signing and
public-key recovery).
"""

import hashlib
import hmac
import sys

# ---------------------------------------------------------------------------
# keccak-256 (the pre-NIST padding Ethereum uses - NOT hashlib.sha3_256)
# ---------------------------------------------------------------------------

_KECCAK_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_KECCAK_ROT = [
    [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
]
_MASK = (1 << 64) - 1


def _rol(x, n):
    n %= 64
    return ((x << n) | (x >> (64 - n))) & _MASK if n else x


def _keccak_f(a):
    for rnd in range(24):
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _KECCAK_ROT[x][y])
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y] & _MASK)
        a[0][0] ^= _KECCAK_RC[rnd]
    return a


def keccak256(data: bytes) -> bytes:
    rate = 136
    a = [[0] * 5 for _ in range(5)]
    padded = bytearray(data)
    padded += b"\x01"
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
    return out


# ---------------------------------------------------------------------------
# secp256k1
# ---------------------------------------------------------------------------

P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def _inv(a, m):
    return pow(a, m - 2, m)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    if p1[0] == p2[0] and (p1[1] + p2[1]) % P == 0:
        return None
    if p1 == p2:
        lam = (3 * p1[0] * p1[0]) * _inv(2 * p1[1], P) % P
    else:
        lam = (p2[1] - p1[1]) * _inv(p2[0] - p1[0], P) % P
    x = (lam * lam - p1[0] - p2[0]) % P
    return (x, (lam * (p1[0] - x) - p1[1]) % P)


def _mul(k, point=G):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _add(result, addend)
        addend = _add(addend, addend)
        k >>= 1
    return result


def pubkey(priv: bytes):
    x, y = _mul(int.from_bytes(priv, "big"))
    return x.to_bytes(32, "big") + y.to_bytes(32, "big")


def address_of(priv: bytes) -> bytes:
    return keccak256(pubkey(priv))[12:]


def checksum(addr20: bytes) -> str:
    h = keccak256(addr20.hex().encode()).hex()
    return "0x" + "".join(
        c.upper() if c.isalpha() and int(h[i], 16) >= 8 else c
        for i, c in enumerate(addr20.hex())
    )


def sign(msg_hash: bytes, priv: bytes):
    z = int.from_bytes(msg_hash, "big")
    k_bytes = hmac.new(b"reorg-poc", msg_hash + priv, hashlib.sha256).digest()
    k = int.from_bytes(k_bytes, "big") % N
    while True:
        R = _mul(k)
        r = R[0] % N
        if r == 0:
            k = (k + 1) % N
            continue
        s = (_inv(k, N) * (z + r * int.from_bytes(priv, "big"))) % N
        if s == 0:
            k = (k + 1) % N
            continue
        recovery = (R[1] & 1) ^ (1 if s * 2 > N else 0)
        if s * 2 > N:          # low-s, as every client requires since EIP-2
            s = N - s
        return r, s, recovery


def recover(msg_hash: bytes, r: int, s: int, recovery: int) -> bytes:
    x = r
    alpha = (pow(x, 3, P) + 7) % P
    y = pow(alpha, (P + 1) // 4, P)
    if y % 2 != recovery:
        y = P - y
    z = int.from_bytes(msg_hash, "big")
    r_inv = _inv(r, N)
    # sR = zG + rQ  ->  Q = (s/r)R - (z/r)G
    Q = _add(_mul((s * r_inv) % N, (x, y)), _mul((-z * r_inv) % N))
    return Q[0].to_bytes(32, "big") + Q[1].to_bytes(32, "big")


# ---------------------------------------------------------------------------
# RLP + legacy signed transaction
# ---------------------------------------------------------------------------

def rlp_encode(item):
    if isinstance(item, int):
        item = item.to_bytes((item.bit_length() + 7) // 8, "big") if item else b""
    if isinstance(item, str):
        item = bytes.fromhex(item[2:]) if item.startswith("0x") else item.encode()
    if isinstance(item, (bytes, bytearray)):
        item = bytes(item)
        if len(item) == 1 and item[0] < 0x80:
            return item
        return _len_prefix(len(item), 0x80) + item
    payload = b"".join(rlp_encode(x) for x in item)
    return _len_prefix(len(payload), 0xC0) + payload


def rlp_decode(data):
    """Minimal decoder: enough to read back what rlp_encode produced."""
    def take(i):
        b = data[i]
        if b < 0x80:
            return bytes([b]), i + 1
        if b < 0xB8:
            n = b - 0x80
            return data[i + 1:i + 1 + n], i + 1 + n
        if b < 0xC0:
            ll = b - 0xB7
            n = int.from_bytes(data[i + 1:i + 1 + ll], "big")
            start = i + 1 + ll
            return data[start:start + n], start + n
        if b < 0xF8:
            n = b - 0xC0
            start = i + 1
        else:
            ll = b - 0xF7
            n = int.from_bytes(data[i + 1:i + 1 + ll], "big")
            start = i + 1 + ll
        out, j, end = [], start, start + n
        while j < end:
            v, j = take(j)
            out.append(v)
        return out, end
    value, _ = take(0)
    return value


def _len_prefix(length, offset):
    if length < 56:
        return bytes([offset + length])
    encoded = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([offset + 55 + len(encoded)]) + encoded


def sign_tx(nonce, gas_price, gas_limit, to, value, data, chain_id, priv):
    """Returns (raw_signed_tx_bytes, tx_hash_hex, sender_hex)."""
    fields = [nonce, gas_price, gas_limit, to, value, data]
    if chain_id:
        to_sign = rlp_encode(fields + [chain_id, 0, 0])
        v = chain_id * 2 + 35
    else:
        to_sign = rlp_encode(fields)
        v = 27
    h = keccak256(to_sign)
    r, s, rec = sign(h, priv)
    v += rec
    raw = rlp_encode(fields + [v, r, s])
    return raw, "0x" + keccak256(raw).hex(), "0x" + address_of(priv).hex()


# ---------------------------------------------------------------------------
# self-test
# ---------------------------------------------------------------------------

# the account premined in rskj's regtest genesis (rskj-core/src/main/resources/
# genesis/rsk-dev.json, address cd2a3d9f938e13cd947ec05abc7fe734df8dd826) - the
# classic pyethereum "cow" key
COW_KEY = bytes.fromhex("c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4")


def selftest():
    ok = True

    def check(name, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print(f"  [{'PASS' if good else 'FAIL'}] {name}")
        if not good:
            print(f"         got  {got}\n         want {want}")

    check("keccak256('')", keccak256(b"").hex(),
          "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
    check("keccak256('abc')", keccak256(b"abc").hex(),
          "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45")
    check("address of the premined regtest key", address_of(COW_KEY).hex(),
          "cd2a3d9f938e13cd947ec05abc7fe734df8dd826")
    check("RLP of ['cat','dog']", rlp_encode(["cat", "dog"]).hex(), "c88363617483646f67")

    to = bytes.fromhex("11" * 20)
    raw, txh, sender = sign_tx(0, 1, 21000, to, 1, b"", 33, COW_KEY)
    fields = rlp_decode(raw)
    check("RLP round-trip: nonce", int.from_bytes(fields[0] or b"\x00", "big"), 0)
    check("RLP round-trip: gasPrice", int.from_bytes(fields[1], "big"), 1)
    check("RLP round-trip: to", fields[3].hex(), "11" * 20)
    v = int.from_bytes(fields[6], "big")
    r = int.from_bytes(fields[7], "big")
    s = int.from_bytes(fields[8], "big")
    h = keccak256(rlp_encode([0, 1, 21000, to, 1, b"", 33, 0, 0]))
    rec_addr = "0x" + keccak256(recover(h, r, s, (v - 35) % 2))[12:].hex()
    check("sign -> recover == sender", rec_addr, sender)
    check("tx hash is keccak of the raw bytes", txh, "0x" + keccak256(raw).hex())
    check("signature is low-s", s * 2 <= N, True)
    check("v is EIP-155 encoded for chainId 33", v in (33 * 2 + 35, 33 * 2 + 36), True)

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(selftest())
