"""Convert the synthetic Access TeleCare workbook into tidy CSV + JSON for dashboards.

Usage: python3 scripts/load_data.py
Reads data/source/access_telecare_case_study.xlsx, writes data/*.csv and data/telehealth.json.
"""
import csv, json, re
from datetime import datetime
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/source/access_telecare_case_study.xlsx"
OUT = ROOT / "data"

# sheet -> (output name, {original header: snake_case name})
SHEETS = {
    "Client Roster": ("clients", {
        "Client ID": "client_id", "Hospital Name": "hospital_name", "Region": "region",
        "Licensed Beds": "licensed_beds", "Primary Service Line": "service_line",
        "Contract Start": "contract_start", "Annual Contract Value ($)": "annual_contract_value",
        "Contract Renewal Date": "renewal_month", "Account Status": "account_status"}),
    "Monthly Utilization": ("utilization", {
        "Client ID": "client_id", "Hospital Name": "hospital_name", "Month": "month",
        "Encounter Volume": "encounters", "Avg Response Time (min)": "avg_response_min",
        "Target Response Time (min)": "target_response_min", "Clinician FTE Assigned": "clinician_fte"}),
    "Financial Summary": ("financials", {
        "Client ID": "client_id", "Hospital Name": "hospital_name", "Month": "month",
        "Monthly Revenue ($)": "revenue", "Monthly Direct Cost ($)": "direct_cost",
        "Contribution Margin ($)": "contribution_margin", "Contribution Margin (%)": "contribution_margin_pct"}),
    "Quality & Satisfaction": ("quality", {
        "Client ID": "client_id", "Hospital Name": "hospital_name", "Month": "month",
        "Hospital Satisfaction Score (1-10)": "satisfaction_score",
        "Avg Door-to-Needle Time (min)*": "door_to_needle_min",
        "Encounters Meeting SLA (%)": "sla_met_pct"}),
    "Clinician Staffing": ("clinicians", {
        "Clinician ID": "clinician_id", "Region": "region", "Specialty": "specialty",
        "FTE Status": "fte_status", "Avg Encounters / Month": "avg_encounters_per_month",
        "Utilization Rate (%)": "utilization_pct", "90-Day Attrition Risk Flag": "attrition_risk_90d"}),
}

def iso_month(label):  # 'Jan-25' -> '2025-01'
    return datetime.strptime(label, "%b-%y").strftime("%Y-%m")

def load():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    out = {}
    for sheet, (name, cols) in SHEETS.items():
        rows = list(wb[sheet].iter_rows(values_only=True))
        header = rows[0]
        recs = []
        for r in rows[1:]:
            if r[0] is None or not re.match(r"^(H|CL)-\d+$", str(r[0])):
                continue  # blank / footnote rows
            rec = {cols[h]: v for h, v in zip(header, r)}
            if "month" in rec:
                rec["month"] = iso_month(rec["month"])
            if "renewal_month" in rec:
                rec["renewal_month"] = datetime.strptime(rec["renewal_month"], "%b-%Y").strftime("%Y-%m")
            recs.append(rec)
        out[name] = recs
    return out

if __name__ == "__main__":
    data = load()
    for name, recs in data.items():
        with open(OUT / f"{name}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(recs[0])); w.writeheader(); w.writerows(recs)
        print(f"{name}: {len(recs)} rows")
    (OUT / "telehealth.json").write_text(json.dumps(data, indent=1))
    print("wrote data/telehealth.json")
