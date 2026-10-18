"""Env probe — records real system state."""
import sys, platform, subprocess, importlib
print("ENV_PROBE start")
for mod in ["numpy","scipy","pandas","matplotlib","rdkit","pymatgen","ase","spglib"]:
    try:
        m=importlib.import_module(mod)
        ver=getattr(m,"__version__","unknown")
        print(f"{mod} OK {ver}")
    except Exception as e:
        print(f"{mod} FAIL {e}")
