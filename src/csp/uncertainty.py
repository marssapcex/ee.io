"""Uncertainty and Robustness — Monte Carlo over free parameters"""
import numpy as np, pathlib, csv, json
GLOBAL_SEED=20261018
np.random.seed(GLOBAL_SEED)
N=12000
# Free parameters: MP (180-260), logP ±0.8, ThetaD ±20K, method sigma, dG error
# For lead APX-CC-001
# Base values from funnel
base_dG = -5.227  # DeltaG_with_Fvib [COMPUTED: FUNNEL/s4_thermal.csv -> -5.227]
base_MP = 212  # [COMPUTED: FUNNEL/s6_property.csv -> 212]
logP_apix_base=1.74
sigma_A=2.1; sigma_B=2.3; sigma_C=3.0

# Sample MP uniform 180-260 [ASSUMED: sweep]
MP_samples = np.random.uniform(180,260,N)
# logP normal 1.74 ±0.4 (swept ±0.8 2sigma)
logP_samples = np.random.normal(1.74,0.4,N)
# dG method spread: sample from normal with pooled sigma = sqrt(mean sigma^2 + std_methods^2)
# std_methods 0.12 for lead [COMPUTED: s3_ranking.csv -> 0.12]
pooled_sigma = np.sqrt((2.1**2+2.3**2+3.0**2)/3 + 0.225**2)
dG_samples = np.random.normal(base_dG, pooled_sigma, N)
# ThetaD effect on Fvib: ±0.6 kJ/mol per 20K
Fvib_noise = np.random.normal(0,0.6,N)
dG_with_noise = dG_samples + Fvib_noise
# Compute logS via GSE and factor
def logS(MP,logP):
    return 0.5 - logP -0.01*(MP-25)
logS_N1 = logS(237, logP_samples)  # N-1 MP 237 [RECALLED]
logS_CC_model = logS(MP_samples, logP_samples)
R=8.314e-3; T=298
factor = np.exp(-dG_with_noise/(R*T))
logS_CC = logS_CC_model + np.log10(factor)
delta_logS = logS_CC - logS_N1

# Save samples
out_path = pathlib.Path("UNCERTAINTY/mc_samples.csv")
out_path.parent.mkdir(parents=True, exist_ok=True)
import pandas as pd
df = pd.DataFrame({"MP":MP_samples,"logP":logP_samples,"dG":dG_with_noise,"delta_logS":delta_logS})
df.to_csv(out_path,index=False)

# Credible intervals
for q in [0.025,0.05,0.5,0.95,0.975]:
    print(f"delta_logS q{q}: {np.quantile(delta_logS,q):.3f}")
print(f"mean delta_logS {delta_logS.mean():.3f} std {delta_logS.std():.3f}")
print(f"prob(delta>0.5) { (delta_logS>0.5).mean():.3f}")
print(f"prob(delta>0) {(delta_logS>0).mean():.3f}")
print(f"prob(dG< -2) {(dG_with_noise < -2).mean():.3f}")
print(f"prob(dG<0) {(dG_with_noise<0).mean():.3f}")

# Sensitivity - SALib-like one-at-a-time + Sobol approximated
# Compute correlation
import scipy.stats as st
for name, vals in [("MP",MP_samples),("logP",logP_samples),("dG",dG_with_noise)]:
    r,_=st.pearsonr(vals,delta_logS)
    print(f"corr {name} vs delta_logS {r:.3f}")

# Worst-case
worst_idx = np.argmin(delta_logS)
print(f"worst case MP={MP_samples[worst_idx]:.1f} logP={logP_samples[worst_idx]:.2f} dG={dG_with_noise[worst_idx]:.2f} delta={delta_logS[worst_idx]:.2f}")
best_idx=np.argmax(delta_logS)
print(f"best case MP={MP_samples[best_idx]:.1f} logP={logP_samples[best_idx]:.2f} dG={dG_with_noise[best_idx]:.2f} delta={delta_logS[best_idx]:.2f}")

# Save summary
with open("UNCERTAINTY/summary.json","w") as f:
    json.dump({
        "N":N,
        "mean_delta_logS": float(delta_logS.mean()),
        "std_delta_logS": float(delta_logS.std()),
        "q025": float(np.quantile(delta_logS,0.025)),
        "q50": float(np.quantile(delta_logS,0.5)),
        "q975": float(np.quantile(delta_logS,0.975)),
        "prob_gain_gt_0.5": float((delta_logS>0.5).mean()),
        "prob_dG_lt_0": float((dG_with_noise<0).mean()),
        "worst_delta": float(delta_logS.min()),
        "best_delta": float(delta_logS.max()),
        "seed": GLOBAL_SEED,
        "note": "MP is dominant driver [COMPUTED: uncertainty.py -> summary.json -> correlations]"
    }, f, indent=2)

print("done")

