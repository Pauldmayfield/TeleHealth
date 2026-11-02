#!/usr/bin/env python3
"""Turn the generated CSVs into site/data/metrics.json (every number the dashboard shows).

Maps to CLAUDE.md sections 7 and 8, plus the performance-tier and staffing additions listed in section 8a.
Rule from section 7: margin percentages are always a ratio of sums, never an average of monthly percentages.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config/thresholds.json").read_text())
GROUPS = {"at_risk": "At-risk", "growth": "Growth", "quiet_churn": "Quiet churn", "steady": "Steady"}
STATES_ALL = sorted(["PA", "NY", "ME", "NH", "VT", "MA", "CT", "NJ", "TX", "GA", "FL", "NC", "TN", "AL", "LA", "KY", "SC", "VA",
                     "OH", "MI", "WI", "MN", "IA", "MO", "KS", "NE", "IN", "IL", "CA", "WA", "OR", "CO", "AZ", "MT", "ID", "NM", "UT", "NV"])


def pct(num, den):
    return float(num / den * 100) if den else 0.0


def r(x, n=1):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def months_between(a, b):  # 'YYYY-MM' strings
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def load():
    d = ROOT / "data"
    return (pd.read_csv(d / "accounts.csv"), pd.read_csv(d / "account_months.csv"),
            pd.read_csv(d / "clinicians.csv"), pd.read_csv(d / "clinician_months.csv"))


def account_month_table(am):
    am = am.copy()
    am["cm"] = am.revenue - am.direct_cost
    am["resp_w"] = am.avg_response_min * am.encounters
    am["sla_w"] = am.sla_met_pct * am.encounters
    am["sat_w"] = am.satisfaction_score * am.encounters
    g = am.groupby(["account_id", "month"], sort=True).agg(
        enc=("encounters", "sum"), fte=("assigned_fte", "sum"), rev=("revenue", "sum"), cost=("direct_cost", "sum"),
        resp_w=("resp_w", "sum"), sla_w=("sla_w", "sum"), sat_w=("sat_w", "sum"), transfers=("transfers_avoided", "sum")).reset_index()
    g["resp"] = g.resp_w / g.enc; g["sla"] = g.sla_w / g.enc; g["sat"] = g.sat_w / g.enc
    g["need"] = g.enc / CFG["healthy_encounters_per_fte"]
    return g


def main():
    acc, am, clin, cm = load()
    months = sorted(am.month.unique()); M = len(months); last = M - 1
    amt = account_month_table(am)
    arche = dict(zip(acc.account_id, acc.archetype))
    amt["group"] = amt.account_id.map(arche)
    R = CFG["risk"]; P = CFG["performance"]; target = CFG["target_response_min"]

    # ---------- per account ----------
    accounts = []
    for _, a in acc.iterrows():
        s = amt[amt.account_id == a.account_id].sort_values("month").reset_index(drop=True)
        l3, p3, l6 = s.iloc[last - 2:last + 1], s.iloc[last - 5:last - 2], s.iloc[last - 5:last + 1]
        q4_25 = s[s.month.isin(["2025-10", "2025-11", "2025-12"])]; q4_24 = s[s.month.isin(["2024-10", "2024-11", "2024-12"])]
        over3 = int((l3.resp > target).sum()); over6 = int((l6.resp > target).sum())
        vol_chg = l3.enc.sum() / p3.enc.sum() - 1
        sat_now = float(s.sat.iloc[last])
        m_now, m_then = pct(q4_25.rev.sum() - q4_25.cost.sum(), q4_25.rev.sum()), pct(q4_24.rev.sum() - q4_24.cost.sum(), q4_24.rev.sum())
        flags = dict(service=int(over3 >= R["service_months_over_target"]), volume=int(vol_chg <= R["volume_drop_pct"]),
                     satisfaction=int(sat_now < R["satisfaction_below"]), margin=int(m_now - m_then <= R["margin_drop_pts"]))
        # falling use while service is healthy: the quiet-churn signature (compares Q4 with Q4 a year earlier, so slow erosion shows)
        yoy = q4_25.enc.sum() / q4_24.enc.sum() - 1
        quiet = bool(yoy <= R["volume_drop_pct"] and not flags["service"])
        nrow = am[(am.account_id == a.account_id) & (am.service_line == "Tele-Neurology")]
        dtn = None
        if len(nrow):
            nw = nrow.assign(w=nrow.door_to_needle_min * nrow.encounters).groupby("month")[["w", "encounters"]].sum()
            dtn = [r(x) for x in (nw.w / nw.encounters)]
        score = sum(flags.values())
        tier = "High" if score >= R["high_score"] else "Watch" if score >= R["watch_score"] else "Healthy"
        reasons = []
        if flags["service"]: reasons.append(f"response over target in {over3} of last 3 months")
        if flags["volume"]: reasons.append(f"volume down {abs(vol_chg) * 100:.0f}% vs prior 3 months")
        if flags["satisfaction"]: reasons.append(f"satisfaction {sat_now:.1f}")
        if flags["margin"]: reasons.append(f"margin down {abs(m_now - m_then):.0f} pts year over year")
        if quiet: reasons.append(f"volume down {abs(yoy) * 100:.0f}% vs a year ago while response is on target")
        # performance (what the user asked for): clinicians assigned + response time
        avg_resp = l3.resp_w.sum() / l3.enc.sum(); sla = l3.sla_w.sum() / l3.enc.sum(); sat3 = l3.sat_w.sum() / l3.enc.sum()
        coverage = l3.fte.sum() / l3.need.sum()
        N_, E_ = P["needs_assistance"], P["exceptional"]
        needs = over3 >= N_["months_over_target_last3"] or avg_resp > target or coverage < N_["min_coverage"] or sla < N_["min_sla_pct"]
        exc = (not needs) and over6 == 0 and avg_resp <= E_["max_avg_response_min"] and sla >= E_["min_sla_pct"] \
            and sat3 >= E_["min_satisfaction"] and coverage >= E_["min_coverage"]
        perf = "Needs assistance" if needs else "Exceptional" if exc else "As expected"
        pos = "Short" if coverage < CFG["staffing_position"]["short_below"] else "Heavy" if coverage > CFG["staffing_position"]["heavy_above"] else "Right-sized"
        if perf == "Needs assistance":
            why = []
            if over3 >= 2 or avg_resp > target: why.append(f"response {avg_resp:.1f} min vs {target} target")
            if coverage < N_["min_coverage"]: why.append(f"staffed at {coverage * 100:.0f}% of need")
            if sla < N_["min_sla_pct"]: why.append(f"only {sla:.0f}% of encounters met SLA")
            pwhy = "; ".join(why)
        elif perf == "Exceptional":
            pwhy = f"response {avg_resp:.1f} min, {sla:.0f}% within SLA, satisfaction {sat3:.1f}, staffed at {coverage * 100:.0f}% of need"
        else:
            pwhy = f"response {avg_resp:.1f} min, {sla:.0f}% within SLA, staffed at {coverage * 100:.0f}% of need"
        fte0 = float(s.fte.iloc[12]); drop = next((months[i] for i in range(12, M) if s.fte.iloc[i] < 0.92 * fte0), None)
        ry, rm = int(a.renewal_date[:4]), int(a.renewal_date[5:7])
        accounts.append(dict(
            id=a.account_id, name=a.hospital_name, region=a.region, state=a.state, type=a.hospital_type, beds=int(a.licensed_beds),
            lines=a.service_lines.split("|"), renewal=a.renewal_date[:7], renewal_in_months=(ry - 2026) * 12 + rm - 1,
            acv=int(a.annual_contract_value), risk_score=score, tier=tier, flags=flags, reason="; ".join(reasons) or "no warning signs",
            perf=perf, perf_reason=pwhy, position=pos, coverage=r(coverage, 2), avg_resp=r(avg_resp), sla=r(sla), sat=r(sat3),
            months_over_target_6=over6, epf=r(l3.enc.sum() / l3.fte.sum()), margin_pct=r(m_now), margin_prior_pct=r(m_then),
            cost_per_fte=int(round(l3.cost.sum() / l3.fte.sum())), fte_now=r(l3.fte.mean(), 2), need_now=r(l3.need.mean(), 2),
            first_fte_drop=drop, yoy_vol=r(yoy * 100), quiet=quiet,
            series=dict(fte=[r(x, 2) for x in s.fte], need=[r(x, 2) for x in s.need], resp=[r(x) for x in s.resp],
                        sat=[r(x) for x in s.sat], enc=[int(x) for x in s.enc], dtn=dtn,
                        margin=[r(pct(c, v)) for c, v in zip(s.rev - s.cost, s.rev)])))
    accounts.sort(key=lambda x: ({"High": 0, "Watch": 1, "Healthy": 2}[x["tier"]], x["renewal_in_months"], -x["acv"]))
    by_id = {x["id"]: x for x in accounts}
    amt["tier"] = amt.account_id.map(lambda i: by_id[i]["tier"]); amt["perf"] = amt.account_id.map(lambda i: by_id[i]["perf"])

    # ---------- portfolio ----------
    def series(df):
        g = df.groupby("month").agg(rev=("rev", "sum"), cost=("cost", "sum"), enc=("enc", "sum"), fte=("fte", "sum"))
        return dict(revenue=[r(x, 0) for x in g.rev], rev_cents=[int(round(x * 100)) for x in g.rev], cost=[r(x, 0) for x in g.cost], enc=[int(x) for x in g.enc],
                    fte=[r(x, 2) for x in g.fte], margin=[r(pct(a_ - b_, a_)) for a_, b_ in zip(g.rev, g.cost)],
                    margin_usd=[r(a_ - b_, 0) for a_, b_ in zip(g.rev, g.cost)])
    port = dict(total=series(amt), groups={GROUPS[k]: series(amt[amt.group == k]) for k in GROUPS})
    y25 = amt[amt.month.str.startswith("2025")]; y24 = amt[amt.month.str.startswith("2024")]
    m25, m24 = pct(y25.rev.sum() - y25.cost.sum(), y25.rev.sum()), pct(y24.rev.sum() - y24.cost.sum(), y24.rev.sum())
    rev24 = y24.groupby("account_id").rev.sum(); rev25 = y25.groupby("account_id").rev.sum()
    grr = float(np.minimum(rev25, rev24).sum() / rev24.sum() * 100)
    high = [x for x in accounts if x["tier"] == "High"]
    q1 = [x for x in high if 0 <= x["renewal_in_months"] <= 2]
    kpis = dict(revenue_t12=r(y25.rev.sum(), 0), margin_pct=r(m25), margin_change_pts=r(m25 - m24), encounters=int(y25.enc.sum()),
                accounts=len(accounts), value_at_risk=sum(x["acv"] for x in high), value_at_risk_q1=sum(x["acv"] for x in q1),
                high_count=len(high), q1_count=len(q1), grr_pct=r(grr))
    mm = port["total"]["margin"]
    headline = (f"Margin held near {m25:.0f}%, but ${kpis['value_at_risk'] / 1e6:.1f}M of contract value is at high risk"
                + (f", ${kpis['value_at_risk_q1'] / 1e6:.1f}M of it renewing in Q1 2026." if q1 else "."))

    # ---------- performance tiers & response -> margin link ----------
    lq = amt[amt.month.isin(months[-3:])]
    tiers = []
    for name in ["Exceptional", "As expected", "Needs assistance"]:
        grp = [x for x in accounts if x["perf"] == name]; d = lq[lq.account_id.isin([x["id"] for x in grp])]
        tiers.append(dict(name=name, count=len(grp), acv=sum(x["acv"] for x in grp),
                          margin_pct=r(pct(d.rev.sum() - d.cost.sum(), d.rev.sum())) if len(d) else None,
                          avg_resp=r(d.resp_w.sum() / d.enc.sum()) if len(d) else None, sla=r(d.sla_w.sum() / d.enc.sum()) if len(d) else None,
                          sat=r(d.sat_w.sum() / d.enc.sum()) if len(d) else None, epf=r(d.enc.sum() / d.fte.sum()) if len(d) else None,
                          cost_per_fte=int(d.cost.sum() / d.fte.sum()) if len(d) else None,
                          short=sum(1 for x in grp if x["position"] == "Short"), heavy=sum(1 for x in grp if x["position"] == "Heavy")))
    hv = [x for x in accounts if x["position"] == "Heavy"]
    dh = lq[lq.account_id.isin([x["id"] for x in hv])]
    heavy = dict(count=len(hv), acv=sum(x["acv"] for x in hv), margin_pct=r(pct(dh.rev.sum() - dh.cost.sum(), dh.rev.sum())) if len(dh) else None)
    bands = []
    for lo, hi, lab in [(0, 8.5, "Under 8.5 min"), (8.5, 10, "8.5 to 10 min"), (10, 13, "10 to 13 min"), (13, 99, "Over 13 min")]:
        d = amt[(amt.resp >= lo) & (amt.resp < hi)]
        bands.append(dict(band=lab, n=int(len(d)), margin_pct=r(pct(d.rev.sum() - d.cost.sum(), d.rev.sum())) if len(d) else None,
                          sat=r(d.sat_w.sum() / d.enc.sum()) if len(d) else None, sla=r(d.sla_w.sum() / d.enc.sum()) if len(d) else None,
                          cost_per_fte=int(d.cost.sum() / d.fte.sum()) if len(d) else None))

    # ---------- margin bridge ----------
    jan, dec = months.index("2025-01"), months.index("2025-12")
    bridge = dict(start=port["total"]["margin_usd"][jan], end=port["total"]["margin_usd"][dec],
                  steps=[dict(group=g, delta=r(port["groups"][g]["margin_usd"][dec] - port["groups"][g]["margin_usd"][jan], 0)) for g in GROUPS.values()])

    # ---------- clinicians ----------
    cm = cm.copy(); cm["util_key"] = cm.clinician_id + cm.month
    cmu = cm.drop_duplicates("util_key")[["clinician_id", "month", "utilization_pct", "attrition_risk_flag"]]
    c3 = cmu[cmu.month.isin(months[-3:])].groupby("clinician_id").agg(util=("utilization_pct", "mean"), flag=("attrition_risk_flag", "max"))
    first_year = cmu[cmu.month.isin(months[-12:])].groupby("clinician_id").utilization_pct.mean()
    cl = clin.set_index("clinician_id").join(c3).join(first_year.rename("util12"))
    cl["spare"] = cl.fte_status * (1 - cl.util / 100); cl["n_states"] = cl.licensed_states.str.count(r"\|") + 1
    cl["flag"] = cl.flag.fillna(0).astype(int)
    CAP = CFG["capacity"]
    clinicians = [dict(id=i, specialty=c.specialty, region=c.home_region, fte=float(c.fte_status), shift=c["shift"], util=r(c.util),
                       spare=r(c.spare, 2), states=c.licensed_states.split("|"), flag=int(c.flag)) for i, c in cl.iterrows()]
    util_rs = []
    for (sp, rg), g in cl.groupby(["specialty", "home_region"]):
        util_rs.append(dict(specialty=sp, region=rg, n=len(g), util=r(pct((g.fte_status * g.util / 100).sum(), g.fte_status.sum())),
                            flagged=int(g.flag.sum()), spare=r(g.spare.sum(), 1)))
    buckets = []
    for sp, g in list(cl.groupby("specialty")) + [("All", cl)]:
        buckets.append(dict(specialty=sp, under60=int((g.util < 60).sum()), mid=int(((g.util >= 60) & (g.util < 70)).sum()),
                            healthy=int(((g.util >= 70) & (g.util <= 92)).sum()), over92=int((g.util > 92).sum())))
    spare_by_spec = {sp: r(g.spare.sum(), 1) for sp, g in cl.groupby("specialty")}
    status_counts = {str(k): int(v) for k, v in cl.fte_status.value_counts().sort_index().items()}
    shifts = []
    for (sp, sh), g in cl.groupby(["specialty", "shift"]):
        shifts.append(dict(specialty=sp, shift=sh, n=len(g), fte=r(g.fte_status.sum(), 1), util=r(pct((g.fte_status * g.util / 100).sum(), g.fte_status.sum()))))
    overnight = []
    for rg, g in cl.groupby("home_region"):
        row = dict(region=rg)
        for sh in ["Day", "Evening", "Overnight"]:
            row[sh] = r(g[g["shift"] == sh].fte_status.sum(), 1)
        row["thin"] = bool(row["Overnight"] < 1.5)
        overnight.append(row)

    # ---------- line-level gaps, capacity moves, licensure ----------
    line = am[am.month.isin(months[-3:])].merge(acc[["account_id", "hospital_name", "state"]], on="account_id")
    lg = line.groupby(["account_id", "hospital_name", "state", "service_line"]).agg(enc=("encounters", "mean"), fte=("assigned_fte", "mean")).reset_index()
    lg["need"] = lg.enc / CFG["healthy_encounters_per_fte"]; lg["gap"] = lg.need - lg.fte
    lg["spec"] = lg.service_line.map({"Tele-Neurology": "Neurology", "Tele-Psychiatry": "Psychiatry", "Tele-Critical Care": "Critical Care"})
    # Where to move capacity first: every hospital short of clinicians, most urgent first
    # (High risk, then soonest renewal, then biggest gap). A hospital's gap is the sum of its short service lines.
    pos_gap = lg[lg.gap > 0.02].groupby("account_id").gap.sum()
    short_ids = [i for i in pos_gap.index if by_id[i]["position"] == "Short" and pos_gap[i] >= 0.05]
    short_ids.sort(key=lambda i: (by_id[i]["tier"] != "High", by_id[i]["renewal_in_months"], -pos_gap[i]))
    moves = []
    for i in short_ids[:8]:
        g = lg[(lg.account_id == i) & (lg.gap > 0.02)].sort_values("gap", ascending=False).iloc[0]
        elig = cl[(cl.specialty == g.spec) & (cl.licensed_states.str.contains(g.state)) & (cl.util < CAP["spare_util_below_pct"])].sort_values("spare", ascending=False)
        inel = cl[(cl.specialty == g.spec) & (~cl.licensed_states.str.contains(g.state)) & (cl.util < CAP["spare_util_below_pct"])].sort_values("spare", ascending=False)
        x = by_id[i]
        moves.append(dict(account=x["name"], id=i, state=g.state, line=g.service_line, gap=r(pos_gap[i], 2), tier=x["tier"], renewal=x["renewal"],
                          renewal_in_months=x["renewal_in_months"], acv=x["acv"],
                          ready=[dict(id=k, spare=r(c.spare, 2), util=r(c.util), shift=c["shift"]) for k, c in elig.head(3).iterrows()],
                          need_license=[dict(id=k, spare=r(c.spare, 2), util=r(c.util)) for k, c in inel.head(2).iterrows()] if len(elig) == 0 else []))
    heavy_rows = [x for x in accounts if x["position"] == "Heavy"]
    short_rows = [x for x in accounts if x["position"] == "Short"]
    balance = dict(surplus_fte=r(sum(x["fte_now"] - x["need_now"] for x in heavy_rows), 2), surplus_n=len(heavy_rows),
                   surplus_names=[x["name"] for x in heavy_rows],
                   shortfall_fte=r(sum(x["need_now"] - x["fte_now"] for x in short_rows), 2), shortfall_n=len(short_rows),
                   moves_total=r(sum(m["gap"] for m in moves), 2))
    states = []
    for st in STATES_ALL:
        g = lg[lg.state == st]
        lic = cl[cl.licensed_states.str.contains(st)]
        spare_lic = lic[lic.util < CAP["spare_util_below_pct"]]
        row = dict(state=st, accounts=int(g.account_id.nunique()), need=r(g.need.sum(), 2), assigned=r(g.fte.sum(), 2), gap=r(max(0.0, (g.need - g.fte).clip(lower=0).sum()), 2),
                   licensed=int(len(lic)), spare_clinicians=int(len(spare_lic)), spare_fte=r(spare_lic.spare.sum(), 1),
                   by_spec={sp: int((lic.specialty == sp).sum()) for sp in ["Neurology", "Psychiatry", "Critical Care"]})
        if row["accounts"] == 0:
            row["status"] = "Open territory" if row["licensed"] >= CAP["thin_state_min_clinicians"] else "Thin"
        else:
            row["status"] = "Thin" if (row["spare_fte"] < 1.5 * row["gap"] or row["spare_clinicians"] < CAP["thin_state_min_clinicians"]) else "Covered"
        states.append(row)
    st_spec_gap = {}
    for _, g in lg.iterrows():
        k = (g.state, g.spec); st_spec_gap[k] = st_spec_gap.get(k, 0.0) + max(0.0, g.gap)
    lic_count = {(st, sp): int(((cl.specialty == sp) & cl.licensed_states.str.contains(st)).sum()) for st in STATES_ALL for sp in ["Neurology", "Psychiatry", "Critical Care"]}
    recs = []
    remaining = dict(st_spec_gap)  # unmet need still to be covered, shrinks as licenses are recommended
    for i, c in cl[cl.spare >= 0.15].sort_values(["spare"], ascending=False).iterrows():
        best = None
        for st in STATES_ALL:
            if st in c.licensed_states.split("|"):
                continue
            gap = remaining.get((st, c.specialty), 0.0)
            depth = max(0, CAP["thin_state_min_clinicians"] - lic_count[(st, c.specialty)])
            sc = min(c.spare, gap) + 0.05 * depth
            if best is None or sc > best[0] or (sc == best[0] and st < best[1]):
                best = (sc, st, gap, depth)
        if best and best[0] > 0:
            sc, st, gap, depth = best
            why = (f"{gap:.2f} FTE of unmet need still open there" if gap > 0 else f"only {lic_count[(st, c.specialty)]} {c.specialty.lower()} clinicians licensed there")
            recs.append(dict(clinician=i, specialty=c.specialty, shift=c["shift"], spare=r(c.spare, 2), state=st, score=r(sc, 2), why=why))
            remaining[(st, c.specialty)] = max(0.0, gap - c.spare); lic_count[(st, c.specialty)] += 1
    recs = sorted(recs, key=lambda x: (-x["score"], x["clinician"]))[:10]
    lines_total = int(len(lg)); avg_line_fte = float(lg.fte.mean())
    headroom = dict(spare_total=r(cl.spare.sum(), 1), by_specialty=spare_by_spec, avg_line_fte=r(avg_line_fte, 2),
                    extra_lines=int(cl.spare.sum() / avg_line_fte), lines_now=lines_total, balance=balance)

    # ---------- leading indicators (for accounts that ended High risk) ----------
    inds = {"Staffing drop (FTE 8% below Jan 2025)": [], "Response over target 2 months running": [], "Satisfaction below 7.5": [],
            "Volume 10% below prior 3 months": [], "Margin 5 pts below its 2024 level": []}
    for x in high:
        s = amt[amt.account_id == x["id"]].sort_values("month").reset_index(drop=True)
        base = pct((s.rev[:12] - s.cost[:12]).sum(), s.rev[:12].sum())
        def first(cond):
            return next((i for i in range(12, M) if cond(i)), None)
        trig = {"Staffing drop (FTE 8% below Jan 2025)": first(lambda i: s.fte[i] < 0.92 * s.fte[12]),
                "Response over target 2 months running": first(lambda i: i >= 1 and s.resp[i] > target and s.resp[i - 1] > target),
                "Satisfaction below 7.5": first(lambda i: s.sat[i] < 7.5),
                "Volume 10% below prior 3 months": first(lambda i: i >= 5 and s.enc[i - 2:i + 1].sum() / s.enc[i - 5:i - 2].sum() - 1 <= -0.10),
                "Margin 5 pts below its 2024 level": first(lambda i: pct((s.rev[i - 2:i + 1] - s.cost[i - 2:i + 1]).sum(), s.rev[i - 2:i + 1].sum()) <= base - 5)}
        for k, v in trig.items():
            inds[k].append((x["id"], v, x["renewal_in_months"]))
    lead = []
    for k, v in inds.items():
        hit = [t for _, t, _ in v if t is not None]
        mt = [t for _, t, _ in inds["Margin 5 pts below its 2024 level"] if t is not None]
        lead.append(dict(indicator=k, fired=len(hit), of=len(v), first_month=months[min(hit)] if hit else None,
                         months_before_margin=r(float(np.median([max(mt) - t for t in hit])), 0) if hit and mt else None))
    lead_sorted = sorted(lead, key=lambda z: (z["first_month"] is None, z["first_month"] or ""))
    lastm = amt[amt.month == months[-1]]
    over_now = lastm[lastm.resp > target]
    vol_down = [x for x in accounts if x["flags"]["volume"]]
    strain = [x for x in accounts if 0 <= x["renewal_in_months"] <= 12 and x["series"]["fte"][-1] < 0.9 * x["series"]["fte"][-7]]
    def who(rows):  # soonest renewal first, because a problem at a hospital about to renew is the most expensive one
        return [dict(name=x["name"], renews_in=x["renewal_in_months"], id=x["id"]) for x in sorted(rows, key=lambda z: (z["renewal_in_months"], -z["acv"]))]
    over_ids = set(over_now.account_id)
    quiet_rows = [x for x in accounts if x["quiet"]]
    tiles = dict(response=dict(n=len(over_ids), of=len(accounts), names=who([by_id[i] for i in over_ids])),
                 volume=dict(n=len(vol_down), of=len(accounts), names=who(vol_down)),
                 staffing=dict(n=len(strain), of=len(accounts), names=who(strain)),
                 quiet=dict(n=len(quiet_rows), of=len(accounts), names=who(quiet_rows)))

    out = dict(
        meta=dict(company="Larkspur TeleSpecialty", today=CFG["today"], months=months, target=target, thresholds=CFG,
                  clinicians=len(clin), accounts=len(acc), generated_from="scripts/generate_data.py (seed 42)"),
        kpis=kpis, headline=headline, heavy=heavy, portfolio=port, accounts=accounts, perf_tiers=tiers, response_bands=bands, bridge=bridge,
        staffing=dict(clinicians=clinicians, util_by_region_specialty=util_rs, buckets=buckets, status_counts=status_counts, shifts=shifts,
                      overnight=overnight, moves=moves, states=states, license_recs=recs, headroom=headroom),
        leading=dict(indicators=lead_sorted, tiles=tiles, n_high=len(high)),
        totals=dict(revenue_cents=int(round(am.revenue.sum() * 100)), revenue=r(am.revenue.sum(), 2)))
    (ROOT / "site/data").mkdir(parents=True, exist_ok=True)
    (ROOT / "site/data/metrics.json").write_text(json.dumps(out, separators=(",", ":")))
    print(headline)
    print("risk tiers:", {t: sum(1 for x in accounts if x["tier"] == t) for t in ["High", "Watch", "Healthy"]})
    print("performance:", {t["name"]: t["count"] for t in tiers})


if __name__ == "__main__":
    main()
