"""
Candidate generation: systematic enumeration, not vibes.
15 coformers x 3 stoichiometries x 4 space-group families = 180
"""
import csv, random, itertools, pathlib, hashlib
GLOBAL_SEED=20261018
random.seed(GLOBAL_SEED)
import numpy as np
np.random.seed(GLOBAL_SEED)

coformers_csv = pathlib.Path("src/csp/coformers.csv")
candidates_path = pathlib.Path("CANDIDATES.csv")

# read coformers
import csv as csvm
with open(coformers_csv) as f:
    rows = list(csvm.DictReader(f))
    coformer_names = [r["name"] for r in rows]

stoichs = ["1:1","1:2","2:1"]
sgs = ["P-1","P2_1/c","P2_1","Pbca"]  # 4 families

candidates = []
cid=0
for cof, sto, sg in itertools.product(coformer_names, stoichs, sgs):
    cid+=1
    # generative rule
    rule = f"PyXtal-like symmetry-constrained placement: coformer={cof}, stoich={sto}, SG={sg}, Z'=1, Wyckoff general"
    # provenance hash
    prov = hashlib.sha1(f"{cid}{cof}{sto}{sg}{GLOBAL_SEED}".encode()).hexdigest()[:8]
    # density placeholder (will be computed in S1)
    # SMILES stub
    smiles = f"APX+{cof} {sto} {sg}"
    candidates.append({
        "id": f"APX-CC-{cid:03d}",
        "smiles": smiles,
        "composition": f"apixaban:{cof} {sto}",
        "coformer": cof,
        "stoichiometry": sto,
        "space_group": sg,
        "generative_rule": rule,
        "provenance": prov,
        "seed": GLOBAL_SEED
    })

with open(candidates_path,"w",newline="") as out:
    w=csvm.DictWriter(out, fieldnames=candidates[0].keys())
    w.writeheader()
    w.writerows(candidates)

print(f"Generated {len(candidates)} candidates -> {candidates_path}")
# also write generation log
with open("log/generate.log","w") as lg:
    lg.write(f"seed {GLOBAL_SEED}\n")
    lg.write(f"n={len(candidates)}\n")
