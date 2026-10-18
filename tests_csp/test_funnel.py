import pandas as pd
def test_funnel_counts():
    import pathlib
    assert pathlib.Path("CANDIDATES.csv").exists()
    df=pd.read_csv("CANDIDATES.csv")
    assert len(df)>=150, f"candidates {len(df)} <150"
    s0=pd.read_csv("FUNNEL/s0_benchmark.csv")
    assert 1 <= int(open("FUNNEL/S0_REPORT.md").read().split("rank")[1].split()[1]) <= 200  # trivial
def test_lead_exists():
    df=pd.read_csv("FUNNEL/s6_property.csv")
    assert "APX-CC-001" in df["id"].values
    lead=df[df["id"]=="APX-CC-001"].iloc[0]
    assert lead["DeltaG_with_Fvib_kJmol"] < -2.0
    assert lead["delta_logS_vs_N1"] > 0.5
def test_no_invented_measurement():
    # Ensure PATENT_DRAFT marks PREDICTED not MEASURED
    text=open("PATENT_DRAFT.md").read()
    assert "PREDICTED" in text
    assert "MEASURED: lab report" not in text or "to be performed" in text
