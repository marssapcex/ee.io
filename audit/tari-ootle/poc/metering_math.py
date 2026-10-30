"""Worst-case accounting for a script-path stealth spend, using the repository's own prices.

Source of every constant:
  crates/engine_types/src/limits.rs        NativeExecutionPoints::{PER_HASH, PER_HASH_BYTE, PER_INPUT, PER_STATEMENT}
  crates/engine_types/src/limits.rs        STEALTH_LIMITS (max_total_inputs_per_transaction = 1024, max_witness_data_len = 4096)
  crates/template_lib_types/src/stealth/spend_witness.rs   MAX_INCLUSION_PROOF_LEN = 32
  crates/engine/src/runtime/impl.rs:1004   verify_script_path_authorization  (no charge call on this path)
  crates/engine/src/runtime/impl.rs:1134   evaluate_builtin -> stealth::hashlock_digest(alg, data)
"""
PER_HASH, PER_HASH_BYTE, PER_INPUT, PER_STATEMENT = 10_000, 30, 42_000, 2_100_000
MAX_INPUTS_PER_TX = 1024
MAX_INCLUSION_PROOF_LEN = 32
MAX_WITNESS_DATA = 4096
MAX_NATIVE_PER_TX = 2_400_000_000
MAX_BLOCK_VALIDATION = 7_250_000_000
POINTS_PER_MS = 8_400_000  # README-of-the-constants: "~8.4M points/ms"

def hash_cost(nbytes):
    return PER_HASH + PER_HASH_BYTE * nbytes

# one script-path input, worst case the limits admit
siblings = MAX_INCLUSION_PROOF_LEN * hash_cost(64)      # branch_hash over two 32-byte children
leaf = hash_cost(512)                                   # condition_leaf_hash over a 16-atom leaf (generous)
hashlock = hash_cost(MAX_WITNESS_DATA)                  # HashLock digest over the whole 4 KiB blob
uncharged_per_input = siblings + leaf + hashlock
charged_per_input = PER_INPUT

print(f"per script-path input")
print(f"  charged           {charged_per_input:>12,} points  ({PER_INPUT/POINTS_PER_MS*1000:.1f} us at the repo's own rate)")
print(f"  inclusion proof   {siblings:>12,} points  ({MAX_INCLUSION_PROOF_LEN} branch hashes)")
print(f"  leaf hash         {leaf:>12,} points")
print(f"  hashlock digest   {hashlock:>12,} points  ({MAX_WITNESS_DATA} bytes)")
print(f"  uncharged total   {uncharged_per_input:>12,} points  ({uncharged_per_input/POINTS_PER_MS*1000:.0f} us)")
print(f"  ratio             {uncharged_per_input/charged_per_input:>12.1f} x uncharged work per charged point")

charged_tx = PER_STATEMENT + MAX_INPUTS_PER_TX * charged_per_input
uncharged_tx = MAX_INPUTS_PER_TX * uncharged_per_input
print(f"\none maximal transaction (1024 script-path inputs, no outputs)")
print(f"  charged           {charged_tx:>15,} points")
print(f"  actually spent    {charged_tx + uncharged_tx:>15,} points-equivalent")
print(f"  metered fraction  {charged_tx/(charged_tx+uncharged_tx)*100:>14.1f} %")
print(f"  wall clock, real  {(charged_tx+uncharged_tx)/POINTS_PER_MS:>14.1f} ms   (charged says {charged_tx/POINTS_PER_MS:.1f} ms)")

budget = MAX_BLOCK_VALIDATION
n_fit = budget // charged_tx
print(f"\nblock budget {budget:,} points = {budget/POINTS_PER_MS:.0f} ms of priced work")
print(f"  such transactions that fit by their charge : {n_fit}")
print(f"  real work they force                       : {n_fit*(charged_tx+uncharged_tx):,} points-equiv "
      f"({n_fit*(charged_tx+uncharged_tx)/budget:.1f} x the validation budget)")
print(f"  UTXOs needed                               : {n_fit*MAX_INPUTS_PER_TX:,}")
print(f"  fee paid at the charged rate               : {n_fit*charged_tx:,} points")
print(f"\nrepeatability: the spend aborts (e.g. SpendConditionNotMet), so the UTXOs are not consumed;")
print(f"processor.rs:380 (finalize_failure) still charges only the metered points, of which the")
print(f"hashing above contributes zero.")
