"""Reimplementation of helper 0x4429 from the decompiled exploit contract.

Claim under test: 0x4429 is Uniswap-V3 `TickMath.getSqrtRatioAtTick`, inlined.
Evidence used: the 20 multipliers in the listing, the `<= 0xd89e8` guard (887272),
the `uint256.max / x` branch for tick > 0, and the `(x >> 32) + (x % 2**32 != 0)` tail.

If the identification is right, feeding MIN_TICK / MAX_TICK must reproduce the two
magic numbers that appear *elsewhere* in the same contract (0x1000276a3 and
0xfffd8963efd1fc6a506488495d951d5263988d26), which are MIN/MAX_SQRT_RATIO.
"""
MAX_TICK = 0xD89E8          # 887272
Q96 = 1 << 96

# the 20 constants, verbatim from the listing, index = bit position
C = [
    0xFFFCB933BD6FAD37AA2D162D1A594001, 0xFFF97272373D413259A46990580E213A,
    0xFFF2E50F5F656932EF12357CF3C7FDCC, 0xFFE5CACA7E10E4E61C3624EAA0941CD0,
    0xFFCB9843D60F6159C9DB58835C926644, 0xFF973B41FA98C081472E6896DFB254C0,
    0xFF2EA16466C96A3843EC78B326B52861, 0xFE5DEE046A99A2A811C461F1969C3053,
    0xFCBE86C7900A88AEDCFFC83B479AA3A4, 0xF987A7253AC413176F2B074CF7815E54,
    0xF3392B0822B70005940C7A398E4B70F3, 0xE7159475A2C29B7443B29C7FA6E889D9,
    0xD097F3BDFD2022B8845AD8F792AA5825, 0xA9F746462D870FDF8A65DC1F90E061E5,
    0x70D869A156D2A1B890BB3DF62BAF32F7, 0x31BE135F97D08FD981231505542FCFA6,
    0x009AA508B5B7A84E1C677DE54F3E99BC9, 0x005D6AF8DEDB81196699C329225EE604,
    0x0002216E584F5FA1EA926041BEDFE98, 0x0000048A170391F7DC42444E8FA2,
]

def get_sqrt_ratio_at_tick(tick: int) -> int:
    a = -tick if tick < 0 else tick
    assert a <= MAX_TICK, "require(v0 <= 0xd89e8)"
    r = C[0] if (a & 1) else (1 << 128)   # listing seed: `uint128.max + 1`
    for i in range(1, 20):
        if a & (1 << i):
            r = (C[i] * r) >> 128
    if tick > 0:
        r = (2**256 - 1) // r                      # uint256.max / v6
    return (r >> 32) + (1 if r % (1 << 32) else 0)  # (v6 >> 32) + (v6 % 2**32 != 0)

if __name__ == "__main__":
    assert get_sqrt_ratio_at_tick(0) == Q96, "tick 0 must be exactly 2**96"
    lo = get_sqrt_ratio_at_tick(-MAX_TICK)
    hi = get_sqrt_ratio_at_tick(MAX_TICK)
    print(f"tick 0            -> {get_sqrt_ratio_at_tick(0)}  (== 2**96: {get_sqrt_ratio_at_tick(0) == Q96})")
    print(f"MIN_TICK          -> {lo}   0x{lo:x}")
    print(f"MAX_TICK          -> {hi}   0x{hi:x}")
    print()
    print(f"contract MIN_SQRT_RATIO  0x1000276a3            = {0x1000276a3}")
    print(f"contract MAX_SQRT_RATIO  0xfffd8963efd1...8d26  = {0xFFFD8963EFD1FC6A506488495D951D5263988D26}")
    print()
    print(f"MIN matches: {lo == 0x1000276a3}")
    print(f"MAX matches: {hi == 0xFFFD8963EFD1FC6A506488495D951D5263988D26}")
    # monotonicity + the 1.0001 step
    a, b = get_sqrt_ratio_at_tick(1), get_sqrt_ratio_at_tick(0)
    print(f"\nratio(t+1)/ratio(t) at t=0: {a/b:.12f}   (sqrt(1.0001) = {1.0001**0.5:.12f})")
