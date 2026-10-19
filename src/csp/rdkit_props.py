from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen
smiles_pubchem = "COc1ccc(cc1)n1nc(C(N)=O)c2c1n(C3=CC=C(C=C3)N3CCCCC3=O)C(=O)CC2"
mol=Chem.MolFromSmiles(smiles_pubchem)
if mol:
    mw=Descriptors.MolWt(mol)
    logp=Crippen.MolLogP(mol)
    print(f"MW {mw:.2f} [COMPUTED: rdkit_props.py -> MW {mw:.2f}]")
    print(f"logP {logp:.3f} [COMPUTED: rdkit_props.py -> logP {logp:.3f}]")
    cof_smiles={"succinic acid":"OC(=O)CCC(O)=O","saccharin":"O=C1NS(=O)(=O)c2ccccc12","nicotinamide":"NC(=O)c1ccncc1"}
    for name,sm in cof_smiles.items():
        m=Chem.MolFromSmiles(sm)
        print(f"{name} logP {Crippen.MolLogP(m):.3f} MW {Descriptors.MolWt(m):.1f}")
else:
    print("none")
