"""How much room is there between `reach - 1` and the tick boundary? (arithmetic only)

Everything here is computed with the formulas that are visible in the decompiled contract:
    0x475c / 0x478f   amount deltas over a sqrt-price span (SqrtPriceMath shapes, Q96 = uint96.max+1)
    0x47ac            mulDiv (FullMath, 512-bit)
    0x4429            getSqrtRatioAtTick  (verified in tick_math.py against MIN/MAX_SQRT_RATIO)
    v131              the "amount that reaches the target" (calcReachAmount), then `swap(v131 - 1)`

The question this answers: with the amount set to exactly one wei below the reach amount, how much
error in the price computation does it take to push the result across the boundary? That headroom is
what the KyberSwap rounding bug had to spend.
"""
from math import ceil
from tick_math import get_sqrt_ratio_at_tick

Q96 = 1 << 96

def next_price_up(sqrt_p, amount, L):
    """price after an exact-input swap of token1: sqrtP + ceil(amount*Q96/L)"""
    return sqrt_p + ceil(amount * Q96 / L)

def reach_amount(sqrt_p, target, L):
    """the input needed to reach `target`: ceil(span*L/Q96)"""
    return ceil((target - sqrt_p) * L / Q96)

def analyse(sqrt_p, target, reach, label):
    span = target - sqrt_p
    # liquidity implied by the reach amount
    L = ceil(reach * Q96 / span)
    margin = target - next_price_up(sqrt_p, reach - 1, L)
    tick_span = get_sqrt_ratio_at_tick(1) - get_sqrt_ratio_at_tick(0)
    print(f"{label}")
    print(f"  price span to the boundary      : {span:,} Q96 units  ({span/tick_span:.4f} ticks at t=0)")
    print(f"  implied liquidity               : {L:,}")
    print(f"  reach amount                    : {reach:,}")
    print(f"  headroom after swapping reach-1 : {margin:,} Q96 units")
    print(f"  as a fraction of the span       : {margin/span:.3e}")
    print(f"  a relative error in the price of {margin/span:.2e} would close it")
    return margin / span

if __name__ == "__main__":
    sqrt_p = get_sqrt_ratio_at_tick(0)
    # indictment: swap qty 1,056,056,735,638,220,799 vs 1,056,056,735,638,220,800 needed to cross
    reach = 1_056_056_735_638_220_800
    print(__doc__)
    for label, ticks in [("boundary one full tick away", 1),
                         ("boundary half a tick away", 0.5),
                         ("boundary at the very edge of the range", 0.0001)]:
        target = sqrt_p + int((get_sqrt_ratio_at_tick(1) - sqrt_p) * ticks)
        analyse(sqrt_p, target, reach, f"-- {label} --")
        print()
