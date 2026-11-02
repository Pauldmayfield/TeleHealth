#!/usr/bin/env python3
"""Generate the synthetic Larkspur TeleSpecialty dataset (fictional company, no real data).

Maps to CLAUDE.md sections 5 and 6. Fixed seed, so every run is identical.
Run:  python3 scripts/generate_data.py
Money and FTE are tracked as integers (cents / hundredths of an FTE) until written, so FTE reconciles exactly.
"""
import calendar
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
MONTHS = [f"{y}-{m:02d}" for y in (2024, 2025) for m in range(1, 13)]
N = len(MONTHS)
START = 13            # index of Feb 2025, when the divergence begins
RAMP_LEN = 11         # Feb..Dec 2025
EPF = 60.0            # healthy encounters per FTE per month
SENS = 0.95           # minutes of delay added per encounter-per-FTE above 62
LINES = ["Tele-Neurology", "Tele-Psychiatry", "Tele-Critical Care"]
SPEC = {"Tele-Neurology": "Neurology", "Tele-Psychiatry": "Psychiatry", "Tele-Critical Care": "Critical Care"}
STATES = {
    "Northeast": ["PA", "NY", "ME", "NH", "VT", "MA", "CT", "NJ"],
    "South": ["TX", "GA", "FL", "NC", "TN", "AL", "LA", "KY", "SC", "VA"],
    "Midwest": ["OH", "MI", "WI", "MN", "IA", "MO", "KS", "NE", "IN", "IL"],
    "West": ["CA", "WA", "OR", "CO", "AZ", "MT", "ID", "NM", "UT", "NV"],
}
MARKETS = {  # where fictional hospitals are located
    "Northeast": ["PA", "NY", "ME", "NH", "VT", "MA"],
    "South": ["TX", "GA", "FL", "NC", "TN", "AL", "LA", "KY"],
    "Midwest": ["OH", "MI", "WI", "MN", "IA", "MO", "KS", "NE"],
    "West": ["CA", "WA", "OR", "CO", "AZ", "MT", "ID", "NM"],
}
REGIONS = list(STATES)
ALL_STATES = sorted(s for r in STATES.values() for s in r)
NAMES = ["Cedar Ridge", "Willow Creek", "Stonebrook", "Harlow Bend", "Alder Glen", "Fairmont Hollow",
         "Juniper Falls", "Copperfield", "Marlow Springs", "Briar Hill", "Tamarack Flats", "Sable Point",
         "Quarry Run", "Elmstead", "Ashgrove", "Kestrel Valley", "Larch Haven", "Mill Pond", "Northfield Crossing",
         "Oak Meadow", "Thistle Down", "Raven Ledge", "Ironwood Bluff", "Pelican Bend", "Wren Hollow",
         "Foxglove Run", "Granite Shoals", "Heron Landing", "Pine Barrens East", "Sorrel Creek",
         "Birchwood Terrace", "Amber Prairie", "Cobalt Ridge", "Dunmore Glen", "Evergreen Hollow",
         "Falcon Mesa", "Gilded Pass", "Hawthorn Bay", "Indigo Vale", "Jasper Fork"]
SUFFIX = {"Critical Access": ["Community Hospital", "Memorial Hospital", "District Hospital"],
          "Community": ["Community Hospital", "General Hospital", "Health Center", "Medical Center"],
          "Regional": ["Regional Medical Center", "Regional Hospital"]}


def ramp(t, start=START, length=RAMP_LEN):
    return float(min(1.0, max(0.0, (t - start + 1) / length)))


def month_end(year, month):
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def make_accounts(rng):
    spec = ([("at_risk", t) for t in ["Regional"] * 3 + ["Community"] * 3]
            + [("growth", t) for t in ["Community"] * 5 + ["Critical Access"] * 3]
            + [("quiet_churn", "Community")] * 3
            + [("steady", t) for t in ["Critical Access"] * 8 + ["Community"] * 11 + ["Regional"] * 4])
    order = rng.permutation(len(spec))
    names = [NAMES[i] for i in rng.permutation(len(NAMES))]
    accts = []
    drifters_left = 3
    at_risk_seen = 0
    for i, k in enumerate(order):
        arche, htype = spec[k]
        region = REGIONS[i % 4]
        a = dict(account_id=f"H-{101 + i}", arche=arche, hospital_type=htype, region=region,
                 state=str(rng.choice(MARKETS[region])),
                 hospital_name=f"{names[i]} {rng.choice(SUFFIX[htype])}")
        a["licensed_beds"] = (25 if htype == "Critical Access" else
                              int(rng.choice(range(50, 201, 5))) if htype == "Community" else
                              int(rng.choice(range(200, 401, 10))))
        n_lines = (1 if rng.random() < 0.8 else 2) if htype == "Critical Access" else \
                  ((2 if rng.random() < 0.7 else 3) if htype == "Community" else (3 if rng.random() < 0.5 else 2))
        a["lines"] = [LINES[j] for j in sorted(rng.choice(3, n_lines, replace=False, p=[0.5, 0.25, 0.25]))]
        # contracts
        if arche == "growth":
            y = 2023
        elif arche == "at_risk":
            y = int(rng.integers(2019, 2022))
        else:
            y = int(rng.integers(2019, 2024))
        a["contract_start"] = f"{y}-{int(rng.integers(1, 13)):02d}-01"
        if arche == "at_risk":
            at_risk_seen += 1
            ren = (2026, [1, 2, 3, 2][at_risk_seen - 1]) if at_risk_seen <= 4 else (2026, int(rng.integers(6, 13)))
        elif arche == "quiet_churn":
            ren = (2026, int(rng.integers(6, 13)))
        elif arche == "growth":
            off = int(rng.integers(3, 24)); ren = (2026 + (off + 0) // 12, (off % 12) + 1)
        else:
            off = int(rng.integers(1, 36)); ren = (2026 + off // 12, (off % 12) + 1)
        a["renewal_date"] = month_end(*ren)
        a["epf0"] = float(rng.uniform(56, 62)) if arche != "at_risk" else float(rng.uniform(58, 60.5))
        a["cost_fte"] = int(rng.integers(30000, 34001))
        a["m0"] = float(np.clip(rng.normal({"steady": 0.322, "quiet_churn": 0.315, "growth": 0.305}.get(arche, 0.30), 0.01), 0.28, 0.34))
        a["base_resp"] = float(rng.uniform(8.6, 9.3)) if arche == "at_risk" else float(rng.uniform(7.6, 9.3))
        a["sat_base"] = float(np.clip(8.9 - 0.22 * (a["base_resp"] - 7.6) + rng.normal(0, 0.15), 7.6, 9.0))
        a["transfer_rate"] = float(rng.uniform(0.15, 0.25))
        # archetype behaviour (section 6.3)
        if arche == "at_risk":
            a["fdrop"] = float(rng.uniform(0.32, 0.35))
            epf_end = float(rng.uniform(70.5, 72))
            # size the drop so volume has fallen to the target level by Dec, despite the 2-month lag
            a["vdrop"] = float(np.clip((1 - (1 - a["fdrop"]) * epf_end / a["epf0"]) / ramp(N - 1 - 2), 0.15, 0.30))
        elif arche == "growth":
            a["fg"] = float(rng.uniform(0.50, 0.60))
            drift = drifters_left > 0 and rng.random() < 0.5 or (drifters_left > 0 and i > 30)
            if drift:
                drifters_left -= 1
            epf_end = float(rng.uniform(63, 65.5)) if drift else float(rng.uniform(57.5, 61))
            a["vg"] = float(np.clip((1 + a["fg"]) * epf_end / a["epf0"] - 1, 0.50, 0.90))
        elif arche == "quiet_churn":
            a["vdrop"] = float(rng.uniform(0.15, 0.20)); a["fup"] = float(rng.uniform(0.0, 0.02))
        else:
            a["trend"] = float(rng.uniform(-0.02, 0.03))
        accts.append(a)
    return accts


def line_paths(a, rng):
    """Per service line: FTE (hundredths) and encounters for each month, plus premium share."""
    rows = []
    rng_lo, rng_hi = {"Critical Access": (0.15, 0.30), "Community": (0.30, 0.50), "Regional": (0.50, 0.90)}[a["hospital_type"]]
    for sl in a["lines"]:
        f0 = int(5 * round(rng.uniform(rng_lo, rng_hi) * 20)) if False else int(5 * round(float(rng.uniform(rng_lo, rng_hi)) * 100 / 5))
        f0 = max(15, f0)
        e0 = max(6, int(round(f0 / 100 * a["epf0"] * (1 + rng.normal(0, 0.02)))))
        fte, enc, epf_det, backfill = [], [], [], []
        for t in range(N):
            r = ramp(t)
            if a["arche"] == "at_risk":
                fm, vm, b = 1 - a["fdrop"] * r, 1 - a["vdrop"] * ramp(t - 2), r
            elif a["arche"] == "growth":
                fm, vm, b = 1 + a["fg"] * r, 1 + a["vg"] * r, 0.0
            elif a["arche"] == "quiet_churn":
                fm, vm, b = 1 + a["fup"] * r, 1 - a["vdrop"] * r, 0.0
            else:
                fm, vm, b = 1 + a["trend"] * r, 1 + a["trend"] * r, 0.0
            f = max(10, int(round(f0 * fm)))
            e_det = e0 * vm
            fte.append(f); backfill.append(b); epf_det.append(e_det / (f / 100))
            enc.append(max(3, int(round(e_det * (1 + rng.normal(0, 0.035))))))
        rows.append(dict(sl=sl, f0=f0, e0=e0, fte=fte, enc=enc, epf_det=epf_det, backfill=backfill))
    return rows


def build_clinicians(lines, rng):
    demand = {s: [0] * N for s in SPEC.values()}
    for ln in lines:
        for t in range(N):
            demand[ln["spec"]][t] += ln["fte"][t]
    counts = {"Neurology": 30, "Psychiatry": 20, "Critical Care": 20}
    levels = [25, 50, 80, 100]
    clin = []
    cid = 1001
    for sp in ["Neurology", "Psychiatry", "Critical Care"]:
        idx = []
        for _ in range(counts[sp]):
            region = REGIONS[int(rng.integers(0, 4))]
            status = levels[int(rng.choice(4, p=[0.20, 0.20, 0.20, 0.40]))]
            n_lic = int(np.clip(round(rng.normal(10, 2)), 6, 14))
            k_home = min(len(STATES[region]), int(np.ceil(n_lic * 0.5)))
            home = list(rng.choice(STATES[region], k_home, replace=False))
            others = [s for s in ALL_STATES if s not in home]
            lic = home + list(rng.choice(others, n_lic - k_home, replace=False))
            hire = f"{int(rng.integers(2016, 2026))}-{int(rng.integers(1, 13)):02d}-{int(rng.integers(1, 29)):02d}"
            clin.append(dict(clinician_id=f"CL-{cid}", specialty=sp, home_region=region, status=status,
                             hire_date=hire, states=sorted(str(s) for s in lic)))
            idx.append(len(clin) - 1); cid += 1
        target = max(demand[sp]) / 0.70
        guard = 0
        while sum(clin[i]["status"] for i in idx) < target and guard < 500:
            cand = [i for i in idx if clin[i]["status"] < 100]
            i = cand[int(rng.integers(0, len(cand)))]
            clin[i]["status"] = levels[levels.index(clin[i]["status"]) + 1]; guard += 1
        guard = 0
        while sum(clin[i]["status"] for i in idx) > target * 1.08 and guard < 500:
            cand = [i for i in idx if clin[i]["status"] > 25]
            i = cand[int(rng.integers(0, len(cand)))]
            clin[i]["status"] = levels[levels.index(clin[i]["status"]) - 1]; guard += 1
    # make sure every state we serve has enough licensed capacity per specialty
    for sp in ["Neurology", "Psychiatry", "Critical Care"]:
        for st in sorted({ln["state"] for ln in lines if ln["spec"] == sp}):
            peak = max(sum(ln["fte"][t] for ln in lines if ln["spec"] == sp and ln["state"] == st) for t in range(N))
            def lic_cap():
                return [c for c in clin if c["specialty"] == sp and st in c["states"]]
            guard = 0
            while (len(lic_cap()) < 3 or sum(c["status"] for c in lic_cap()) < 2.0 * peak) and guard < 60:
                pool = sorted([c for c in clin if c["specialty"] == sp and st not in c["states"]],
                              key=lambda c: (len(c["states"]), c["clinician_id"]))
                pick = pool[int(rng.integers(0, min(5, len(pool))))]
                pick["states"] = sorted(pick["states"] + [st]); guard += 1
    # shifts for 24/7 coverage
    for c in clin:
        c["shift"] = ["Day", "Evening", "Overnight"][int(rng.choice(3, p=[0.5, 0.25, 0.25]))]
    for sp in ["Neurology", "Psychiatry", "Critical Care"]:
        for rg in REGIONS:
            grp = sorted([c for c in clin if c["specialty"] == sp and c["home_region"] == rg], key=lambda c: (-c["status"], c["clinician_id"]))
            if grp and not any(c["shift"] == "Overnight" for c in grp):
                grp[0]["shift"] = "Overnight"
    return clin


def allocate(lines, clin, rng):
    """Assign clinicians to account-service lines each month. Returns per-line allocations and per-clinician use."""
    elig = [[c["clinician_id"] for c in clin if c["specialty"] == ln["spec"] and ln["state"] in c["states"]] for ln in lines]
    status = {c["clinician_id"]: c["status"] for c in clin}
    soft = {k: int(v * 0.96) for k, v in status.items()}
    prev = {i: [] for i in range(len(lines))}
    alloc = [[None] * N for _ in lines]
    used_by_month = []
    for t in range(N):
        used = {k: 0 for k in status}
        for i in sorted(range(len(lines)), key=lambda i: (len(elig[i]), -lines[i]["fte"][t], i)):
            need = lines[i]["fte"][t]
            rest = sorted([c for c in elig[i] if c not in prev[i]], key=lambda c: (-(status[c] - used[c]), c))
            order = [c for c in prev[i] if c in elig[i]] + rest
            got = {}
            for cap in (soft, status):
                for c in order:
                    if need <= 0:
                        break
                    take = min(need, cap[c] - used[c])
                    if take > 0:
                        used[c] += take; got[c] = got.get(c, 0) + take; need -= take
            if need > 0:
                raise RuntimeError(f"cannot staff {lines[i]['account_id']} {lines[i]['sl']} {MONTHS[t]} short {need}")
            alloc[i][t] = got
            prev[i] = sorted(got, key=lambda c: (-got[c], c))
        used_by_month.append(used)
    return alloc, used_by_month, status


def largest_remainder(total, weights):
    s = sum(weights)
    raw = [total * w / s for w in weights]
    base = [int(x) for x in raw]
    for j in sorted(range(len(raw)), key=lambda j: -(raw[j] - base[j]))[: total - sum(base)]:
        base[j] += 1
    return base


def generate(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    accts = make_accounts(rng)

    lines, acct_rows = [], []
    for a in accts:
        paths = line_paths(a, rng)
        e0s = [p["e0"] for p in paths]
        inc = [int(round(0.75 * e)) for e in e0s]
        r0 = [p["f0"] / 100 * a["cost_fte"] / (1 - a["m0"]) for p in paths]
        base_total = 0.70 * sum(r0)
        fee = 0.30 * sum(r0) / (0.25 * sum(e0s))
        a["base_fee"] = round(base_total, -2)
        a["fee"] = round(fee, 2)
        a["inc_total"] = sum(inc)
        a["acv"] = int(round(sum(r0) * 12, -3))
        for p, inc_l in zip(paths, inc):
            lines.append(dict(account_id=a["account_id"], sl=p["sl"], spec=SPEC[p["sl"]], state=a["state"],
                              arche=a["arche"], a=a, inc=inc_l, **{k: p[k] for k in ("fte", "enc", "epf_det", "backfill")}))
        acct_rows.append(dict(
            account_id=a["account_id"], hospital_name=a["hospital_name"], region=a["region"], state=a["state"],
            hospital_type=a["hospital_type"], licensed_beds=a["licensed_beds"], service_lines="|".join(a["lines"]),
            contract_start=a["contract_start"], renewal_date=a["renewal_date"], monthly_base_fee=int(a["base_fee"]),
            included_encounters=a["inc_total"], per_encounter_fee=a["fee"], annual_contract_value=a["acv"],
            archetype=a["arche"]))

    clin = build_clinicians(lines, rng)
    alloc, used_by_month, status = allocate(lines, clin, rng)

    # account-month rows (response, quality, money)
    am = []
    for i, ln in enumerate(lines):
        a = ln["a"]
        inc_sum = sum(x["inc"] for x in lines if x["account_id"] == a["account_id"])
        resp_prev = None
        line_off = float(rng.normal(0, 0.2))
        for t in range(N):
            resp = a["base_resp"] + line_off + SENS * max(0.0, ln["epf_det"][t] - 62) + float(rng.normal(0, 0.35))
            resp = round(max(5.0, resp), 1)
            sla = round(float(np.clip(98 - 3.2 * max(0.0, resp - 7.5) + rng.normal(0, 1.0), 35, 99.5)), 1)
            sat_src = resp if resp_prev is None else resp_prev
            sat = round(float(np.clip(a["sat_base"] - 0.2 * max(0.0, sat_src - 9.0) + rng.normal(0, 0.12), 1, 10)), 1)
            resp_prev = resp
            dtn = round(38 + 1.1 * (resp - 9) + float(rng.normal(0, 1.5)), 1) if ln["sl"] == "Tele-Neurology" else None
            e, f = ln["enc"][t], ln["fte"][t]
            tr = 0
            if ln["sl"] != "Tele-Psychiatry":
                tr = int(round(e * a["transfer_rate"] * (1 - 0.02 * max(0.0, resp - 10))))
            base_share = a["base_fee"] * ln["inc"] / inc_sum
            rev = base_share + max(0, e - ln["inc"]) * a["fee"]
            cost = f / 100 * a["cost_fte"] * (1 + 0.4 * ln["backfill"][t]) * (1 + float(rng.normal(0, 0.01)))
            am.append(dict(account_id=ln["account_id"], service_line=ln["sl"], month=MONTHS[t], encounters=e,
                           included_encounters=ln["inc"], assigned_fte=round(f / 100, 2), avg_response_min=resp,
                           target_response_min=10, sla_met_pct=sla, satisfaction_score=sat, door_to_needle_min=dtn,
                           transfers_avoided=tr, revenue=round(rev, 2), direct_cost=round(cost, 2)))

    # clinician-month rows
    cm = []
    for t in range(N):
        used = used_by_month[t]
        util = {k: round(100 * used[k] / status[k], 1) for k in status}
        per_clin = {k: [] for k in status}
        for i, ln in enumerate(lines):
            got = alloc[i][t]
            cids = sorted(got)
            encs = largest_remainder(ln["enc"][t], [got[c] for c in cids])
            for c, e in zip(cids, encs):
                per_clin[c].append((ln["account_id"], got[c], e))
        for c in clin:
            k = c["clinician_id"]
            u = util[k]
            p = 0.03 + (0.12 if u < 60 else 0) + (0.18 if u > 92 else 0)
            flag = 1 if rng.random() < p else 0
            rows = per_clin[k] or [("", 0, 0)]
            for acct, f, e in rows:
                cm.append(dict(clinician_id=k, account_id=acct, month=MONTHS[t], fte_allocated=round(f / 100, 2),
                               encounters=e, utilization_pct=u, attrition_risk_flag=flag))

    clin_rows = [dict(clinician_id=c["clinician_id"], specialty=c["specialty"], home_region=c["home_region"],
                      fte_status=c["status"] / 100, hire_date=c["hire_date"], shift=c["shift"],
                      licensed_states="|".join(c["states"])) for c in clin]

    for name, rows in [("accounts", acct_rows), ("account_months", am), ("clinicians", clin_rows), ("clinician_months", cm)]:
        pd.DataFrame(rows).to_csv(out / f"{name}.csv", index=False, lineterminator="\n")
    return out


if __name__ == "__main__":
    target = Path(__file__).resolve().parent.parent / "data"
    generate(target)
    print(f"wrote CSVs to {target}")
