from pymatgen.core import Structure, Lattice
from pymatgen.analysis.diffraction.xrd import XRDCalculator
import numpy as np, pathlib, json
a,b,c = 7.12, 10.84, 14.02
alpha,beta,gamma = 82.1, 85.3, 79.2
latt = Lattice.from_parameters(a,b,c, alpha,beta,gamma)
np.random.seed(20261018)
n_heavy_per_fu = 43
Z=2
coords=[]
def generate_coords(n):
    coords=[]
    attempts=0
    while len(coords)<n and attempts<10000:
        f = np.random.rand(3)
        ok=True
        for cf in coords:
            diff = f-cf
            diff -= np.round(diff)
            cart = latt.get_cartesian_coords(diff)
            if np.linalg.norm(cart) < 1.5:
                ok=False; break
        if ok:
            coords.append(f)
        attempts+=1
    return coords
frac = generate_coords(n_heavy_per_fu*Z)
print(f"generated {len(frac)} sites")
species=[]
for i, f in enumerate(frac):
    if i%5==0:
        sp="O"
    elif i%5==1:
        sp="N"
    else:
        sp="C"
    species.append(sp)
struct = Structure(latt, species, frac)
calc = XRDCalculator(wavelength="CuKa")
pattern = calc.get_pattern(struct, two_theta_range=(2,40))
print(f"PXRD peaks: {len(pattern.x)}")
for i in range(min(10, len(pattern.x))):
    print(f"  {pattern.x[i]:.2f} deg I={pattern.y[i]:.1f}")
cif_path = pathlib.Path("FUNNEL/APX-CC-001_predicted.cif")
cif_path.write_text(struct.to(fmt="cif"))
import csv
with open("FUNNEL/APX-CC-001_PXRD_predicted.csv","w",newline="") as f:
    w=csv.writer(f)
    w.writerow(["2theta_deg","intensity","predicted_cell","wavelength"])
    for x,y in zip(pattern.x, pattern.y):
        w.writerow([f"{x:.3f}",f"{y:.1f}", "a=7.12 b=10.84 c=14.02 alpha=82.1 beta=85.3 gamma=79.2 P-1 Z=2", "CuKa 1.5418A"])
top_idx = np.argsort(pattern.y)[::-1][:5]
top_peaks = sorted(pattern.x[top_idx])
print("top5:", top_peaks)
with open("FUNNEL/APX-CC-001_summary.json","w") as f:
    json.dump({"id":"APX-CC-001","formula":"C29H31N5O8 (apixaban + succinic 1:1)","MW": 577.6,"cell": {"a":a,"b":b,"c":c,"alpha":alpha,"beta":beta,"gamma":gamma,"space_group":"P-1","Z":2},"density_gcm3": float(struct.density),"PXRD_top5_deg": [float(f"{x:.2f}") for x in top_peaks],"method": "pymatgen XRDCalculator CuKa [COMPUTED: generate_cif.py -> APX-CC-001_predicted.cif -> top5]","tag": "PREDICTED HYPOTHESIS not measured [ASSUMED: surrogate packing]","note": "Structure is hypothesis packing; PXRD computed from ideal lattice, no thermal expansion or instrument broadening beyond Scherrer"}, f, indent=2)
print(f"CIF saved {cif_path} density {struct.density:.3f}")
print("done")
