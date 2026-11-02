#!/usr/bin/env python3
"""Section 13 checks. Run after any data change:  python3 scripts/validate.py
Exits non-zero if any check fails."""
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import generate_data  # noqa: E402

FOOTER = "Synthetic data for a fictional company. Built by Paul Mayfield to demonstrate executive analytics."
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    names = ["accounts", "account_months", "clinicians", "clinician_months"]
    # 1. determinism
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        generate_data.generate(a); generate_data.generate(b)
        same = all(sha(Path(a) / f"{n}.csv") == sha(Path(b) / f"{n}.csv") for n in names)
        on_disk = all(sha(Path(a) / f"{n}.csv") == sha(ROOT / "data" / f"{n}.csv") for n in names)
    check("1. Fixed seed: two runs identical, and match data/", same and on_disk, f"runs equal={same}, data/ current={on_disk}")

    acc = pd.read_csv(ROOT / "data/accounts.csv"); am = pd.read_csv(ROOT / "data/account_months.csv")
    clin = pd.read_csv(ROOT / "data/clinicians.csv"); cm = pd.read_csv(ROOT / "data/clinician_months.csv", keep_default_na=False)
    cm["fte_allocated"] = pd.to_numeric(cm.fte_allocated)
    spec = {"Tele-Neurology": "Neurology", "Tele-Psychiatry": "Psychiatry", "Tele-Critical Care": "Critical Care"}

    # 2. FTE reconciles per account, service line, month
    am["spec"] = am.service_line.map(spec); am["a100"] = (am.assigned_fte * 100).round().astype(int)
    cmj = cm[cm.account_id != ""].merge(clin[["clinician_id", "specialty", "fte_status", "licensed_states"]], on="clinician_id")
    cmj["f100"] = (cmj.fte_allocated * 100).round().astype(int)
    left = am.groupby(["account_id", "spec", "month"]).a100.sum()
    right = cmj.groupby(["account_id", "specialty", "month"]).f100.sum(); right.index.names = ["account_id", "spec", "month"]
    diff = (left - right.reindex(left.index).fillna(0)).abs()
    check("2. assigned_fte equals sum of clinician fte_allocated", int(diff.sum()) == 0 and len(right) == len(left), f"{int((diff > 0).sum())} mismatches")

    # 3. capacity and licensure
    tot = cm.assign(f100=(cm.fte_allocated * 100).round().astype(int)).groupby(["clinician_id", "month"]).f100.sum().reset_index().merge(clin, on="clinician_id")
    over = int((tot.f100 > (tot.fte_status * 100).round()).sum())
    cmj = cmj.merge(acc[["account_id", "state"]], on="account_id")
    unlicensed = int(sum(s not in l.split("|") for s, l in zip(cmj.state, cmj.licensed_states)))
    check("3. No clinician over fte_status; none outside licensed states", over == 0 and unlicensed == 0, f"over={over}, unlicensed={unlicensed}")

    m = json.loads((ROOT / "site/data/metrics.json").read_text())
    # 4. revenue to the cent
    cents = int((am.revenue * 100).round().sum())
    check("4. metrics.json revenue equals CSV revenue to the cent", sum(m["portfolio"]["total"]["rev_cents"]) == cents == m["totals"]["revenue_cents"], f"{cents}")

    # 5. portfolio margin 28-32 every month
    mg = m["portfolio"]["total"]["margin"]
    check("5. Portfolio margin 28% to 32% every month", all(28 <= x <= 32 for x in mg), f"min {min(mg)}, max {max(mg)}")

    # 6. group margin moves
    mo = m["meta"]["months"]; j, d = mo.index("2025-01"), mo.index("2025-12")
    g = m["portfolio"]["groups"]
    ar = g["At-risk"]["margin"][d] - g["At-risk"]["margin"][j]; gr = g["Growth"]["margin"][d] - g["Growth"]["margin"][j]
    check("6. At-risk margin down >=15 pts; Growth up >=5 pts (Jan to Dec 2025)", ar <= -15 and gr >= 5, f"at-risk {ar:+.1f}, growth {gr:+.1f}")

    # 7. risk tiering catches the story
    arche = dict(zip(acc.account_id, acc.archetype)); tier = {x["id"]: x["tier"] for x in m["accounts"]}
    hi = sum(tier[i] == "High" for i in acc[acc.archetype == "at_risk"].account_id)
    qc = sum(tier[i] in ("Watch", "High") for i in acc[acc.archetype == "quiet_churn"].account_id)
    check("7. >=4 of 6 at-risk are High; >=2 of 3 quiet-churn are Watch or High", hi >= 4 and qc >= 2, f"{hi}/6 and {qc}/3")

    # 8. deny list
    deny = [x.strip().lower() for x in (ROOT / "config/deny_list.txt").read_text().splitlines() if x.strip()]
    hits = []
    for f in list((ROOT / "data").glob("*.csv")) + [p for p in (ROOT / "site").rglob("*") if p.is_file()]:
        txt = f.read_text(errors="ignore").lower()
        hits += [f"{f.name}:{w}" for w in deny if re.search(r"\b" + re.escape(w) + r"\b", txt)]
    check("8. No real company or hospital names in data/ or site/", not hits, ", ".join(hits[:5]))

    # 9. footer on every page
    pages = sorted((ROOT / "site").glob("*.html"))
    missing = [p.name for p in pages if FOOTER not in p.read_text()]
    check("9. Every page shows the synthetic-data footer", bool(pages) and not missing, f"pages={len(pages)} missing={missing}")

    # extra sanity checks for the additions in section 8a
    perf = {t["name"]: t["count"] for t in m["perf_tiers"]}
    check("A. All three performance tiers are populated", all(perf.get(k, 0) >= 3 for k in ["Exceptional", "As expected", "Needs assistance"]), str(perf))
    ns = clin.licensed_states.str.count(r"\|") + 1
    check("B. Clinicians hold about 10 state licenses on average", 8 <= ns.mean() <= 13, f"mean {ns.mean():.1f}, range {ns.min()}-{ns.max()}")

    q = m["leading"]["tiles"]["quiet"]["names"]; qc_ids = set(acc[acc.archetype == "quiet_churn"].account_id)
    check("C. Quiet-churn tile catches at least 2 of the 3 quiet-churn accounts", len({n["id"] for n in q} & qc_ids) >= 2, f"{len({n['id'] for n in q} & qc_ids)}/3")
    need = {x["id"] for x in m["accounts"] if x["tier"] == "High" and x["position"] == "Short"}; moved = {x["id"] for x in m["staffing"]["moves"]}
    check("D. Every high-risk hospital that is short of clinicians appears in capacity moves", need <= moved, f"missing {sorted(need - moved)}")
    print("\nALL CHECKS PASSED" if all(results) else f"\n{results.count(False)} CHECK(S) FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
