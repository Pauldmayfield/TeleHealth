/* Larkspur TeleSpecialty executive dashboard (synthetic data, fictional company).
   Reads only data/metrics.json. Every headline sentence is built from that data. */
"use strict";
let M = null;            // metrics
let charts = [];         // live Chart.js instances, destroyed on each page change
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PAGES = [["overview", "Overview"], ["performance", "Hospital performance"], ["risk", "Account risk"], ["account", "Account detail"],
  ["margin", "Margin drivers"], ["staffing", "Staffing & capacity"], ["leading", "Leading indicators"]];

/* ---------- formatting ---------- */
const money = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const num = n => Math.round(n).toLocaleString("en-US");
const p0 = n => `${Math.round(n)}%`, p1 = n => `${n.toFixed(1)}%`;
const monLabel = m => { const [y, mo] = m.split("-"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo - 1] + " " + y.slice(2); };
const chip = (txt, cls) => `<span class="chip c-${cls}">${esc(txt)}</span>`;
const perfChip = p => chip(p, { "Exceptional": "green", "As expected": "gray", "Needs assistance": "red" }[p]);
const tierChip = t => chip(t, { High: "red", Watch: "amber", Healthy: "green" }[t]);
const posChip = p => chip(p, { Short: "red", "Right-sized": "green", Heavy: "amber" }[p]);

/* ---------- theme colors (read from CSS so dark mode works) ---------- */
const col = () => { const s = getComputedStyle(document.documentElement), g = n => s.getPropertyValue(n).trim();
  return { red: g("--red"), amber: g("--amber"), green: g("--green"), gray: g("--gray"), navy: g("--navy"), blue: g("--blue"), text: g("--text"), muted: g("--muted"), grid: g("--grid") }; };

/* ---------- small Chart.js plugins ---------- */
const endLabels = { id: "endLabels", afterDatasetsDraw(ch) { const c = ch.ctx; c.save(); c.font = "600 12px system-ui"; c.textBaseline = "middle";
  ch.data.datasets.forEach((d, i) => { if (!d.endLabel) return; const pt = ch.getDatasetMeta(i).data.at(-1); if (!pt) return;
    c.fillStyle = d.borderColor; c.fillText(d.endLabel, pt.x + 6, pt.y + (d.labelDy || 0)); }); c.restore(); } };
const refLines = { id: "refLines", afterDatasetsDraw(ch, _a, o) { ((o && o.lines) || []).forEach(l => { const sc = ch.scales[l.axis]; if (!sc) return;
  const c = ch.ctx, a = ch.chartArea; c.save(); c.strokeStyle = l.color; c.setLineDash([5, 4]); c.lineWidth = 1.5; c.beginPath();
  if (l.axis === "y") { const y = sc.getPixelForValue(l.value); c.moveTo(a.left, y); c.lineTo(a.right, y); } else { const x = sc.getPixelForValue(l.value); c.moveTo(x, a.top); c.lineTo(x, a.bottom); }
  c.stroke(); c.setLineDash([]); c.fillStyle = l.color; c.font = "12px system-ui"; c.textAlign = "left";
  if (l.axis === "y") c.fillText(l.label, a.left + 6, sc.getPixelForValue(l.value) - 5); else { const x = sc.getPixelForValue(l.value), right = x > (a.left + a.right) / 2; c.textAlign = right ? "right" : "left"; c.fillText(l.label, x + (right ? -5 : 5), a.top + 12); } c.restore(); }); } };
Chart.register(endLabels, refLines);

function mkChart(id, cfg, label) {
  const el = $("#" + id); el.setAttribute("role", "img"); el.setAttribute("aria-label", label || "Chart");
  const c = col(); Chart.defaults.color = c.muted; Chart.defaults.borderColor = c.grid; Chart.defaults.font.family = "system-ui, sans-serif";
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options);
  const ch = new Chart(el, cfg); charts.push(ch); return ch;
}
const dataTable = (head, rows) => `<details><summary>View chart data as a table</summary><div style="overflow-x:auto"><table><thead><tr>${head.map((h, i) => `<th class="${i ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${i ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
const labels = () => M.meta.months.map(monLabel);

/* ---------- router ---------- */
function route() {
  const [page, arg] = (location.hash.slice(1) || "overview").split("/");
  charts.forEach(c => c.destroy()); charts = [];
  const known = PAGES.find(p => p[0] === page) ? page : "overview";
  $("#nav").innerHTML = PAGES.map(([k, t]) => `<a href="#${k}" ${k === known ? 'aria-current="page"' : ""}>${t}</a>`).join("") + `<a href="methodology.html">Methodology</a>`;
  const view = { overview, performance, risk, account, margin, staffing, leading }[known];
  $("#app").innerHTML = ""; view($("#app"), arg); window.scrollTo(0, 0);
  document.title = `${PAGES.find(p => p[0] === known)[1]} · Larkspur Executive Dashboard`;
}
const openAccount = id => { location.hash = "account/" + id; };
document.addEventListener("click", e => { const r = e.target.closest("tr[data-id]"); if (r) openAccount(r.dataset.id); });
document.addEventListener("keydown", e => { if (e.key === "Enter") { const r = e.target.closest("tr[data-id]"); if (r) openAccount(r.dataset.id); } });

/* ---------- Page 1: portfolio overview ---------- */
function overview(el) {
  const k = M.kpis, tiers = M.perf_tiers, g = M.portfolio.groups, mo = M.meta.months, c = col();
  const t = n => tiers.find(x => x.name === n);
  el.innerHTML = `<h2 class="headline">${esc(M.headline)}</h2>
  <p class="sub">Service metrics move months before margin does. The portfolio average hides four different account patterns.</p>
  <div class="kpis">
    <div class="kpi"><div class="l">Revenue, last 12 months</div><div class="v">${money(k.revenue_t12)}</div><div class="d">Gross retention ${p0(k.grr_pct)}</div></div>
    <div class="kpi"><div class="l">Contribution margin</div><div class="v">${p0(k.margin_pct)}</div><div class="d">${k.margin_change_pts >= 0 ? "+" : ""}${k.margin_change_pts.toFixed(1)} pts vs prior year</div></div>
    <div class="kpi"><div class="l">Encounters, last 12 months</div><div class="v">${num(k.encounters)}</div><div class="d">${M.meta.clinicians} clinicians</div></div>
    <div class="kpi"><div class="l">Active hospital accounts</div><div class="v">${k.accounts}</div><div class="d">${t("Needs assistance").count} need assistance</div></div>
    <div class="kpi"><div class="l">Contract value at high risk</div><div class="v">${money(k.value_at_risk)}</div><div class="d">${k.high_count} accounts, ${money(k.value_at_risk_q1)} renewing in Q1</div></div>
  </div>
  <div class="card"><h3>Four account groups, one flat average</h3><p class="note">Contribution margin % by month. The dashed navy line is the whole portfolio.</p>
    <div class="chart tall"><canvas id="hero"></canvas></div><div id="herotbl"></div></div>
  <h3 style="margin:0 0 8px">Hospital performance today</h3>
  <div class="grid3">${tiers.map(x => tierCard(x)).join("")}</div>
  <p><a href="#performance">See every hospital ranked →</a></p>`;
  const style = { "At-risk": [c.red, 2.5], "Growth": [c.green, 2.5], "Quiet churn": [c.amber, 2.5], "Steady": [c.gray, 2.5] };
  const ds = Object.keys(g).map(n => ({ label: n, data: g[n].margin, borderColor: style[n][0], backgroundColor: style[n][0], borderWidth: style[n][1], pointRadius: 0, tension: .25, endLabel: n, labelDy: n === "Steady" ? -4 : n === "Quiet churn" ? -7 : n === "At-risk" ? 9 : 0 }));
  ds.push({ label: "Portfolio", data: M.portfolio.total.margin, borderColor: c.navy, borderDash: [6, 4], borderWidth: 2.5, pointRadius: 0, tension: .25, endLabel: "Portfolio", labelDy: -10 });
  mkChart("hero", { type: "line", data: { labels: labels(), datasets: ds }, options: { layout: { padding: { right: 78 } }, plugins: { legend: { display: false }, refLines: { lines: [{ axis: "x", value: mo.indexOf("2025-02"), color: c.muted, label: "Capacity moved (Feb 2025)" }] },
    tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}%` } } }, scales: { y: { min: 0, ticks: { callback: v => v + "%" } }, x: { ticks: { maxTicksLimit: 8 } } } } }, "Contribution margin percent by account group");
  $("#herotbl").innerHTML = dataTable(["Month", ...Object.keys(g), "Portfolio"], mo.map((m, i) => [monLabel(m), ...Object.keys(g).map(n => p1(g[n].margin[i])), p1(M.portfolio.total.margin[i])]));
}
function tierCard(x) {
  const cls = { "Exceptional": "exc", "As expected": "exp", "Needs assistance": "need" }[x.name];
  return `<div class="tier ${cls}"><div class="muted" style="font-size:13px">${esc(x.name)}</div><div class="n">${x.count}</div><div class="muted" style="font-size:13px">hospitals · ${money(x.acv)} contract value</div>
  <ul><li>Response time <b>${x.avg_resp.toFixed(1)} min</b> (target ${M.meta.target})</li><li>Met SLA <b>${p0(x.sla)}</b> · Satisfaction <b>${x.sat.toFixed(1)}</b></li><li>Margin <b>${p1(x.margin_pct)}</b> · Cost per FTE <b>${money(x.cost_per_fte)}</b></li><li>Encounters per clinician FTE <b>${x.epf.toFixed(0)}</b></li></ul></div>`;
}

/* ---------- Page 2: hospital performance (exceptional / as expected / needs assistance) ---------- */
function performance(el) {
  const T = n => M.perf_tiers.find(x => x.name === n), ex = T("Exceptional"), ne = T("Needs assistance"), c = col();
  el.innerHTML = `<h2 class="headline">${ex.count} hospitals are performing exceptionally and ${ne.count} need assistance. ${ne.short === ne.count ? "All " + ne.count : ne.short + " of " + ne.count} of those are short on clinicians.</h2>
  <p class="sub">Hospitals needing assistance earn ${p1(ne.margin_pct)} margin against ${p1(ex.margin_pct)} for the exceptional group, and each clinician FTE costs ${money(ne.cost_per_fte)} instead of ${money(ex.cost_per_fte)}. Latest 3 months.${M.heavy && M.heavy.count ? ` ${M.heavy.count} other hospitals have more clinicians than their volume needs (over 115% staffed) and earn only ${p1(M.heavy.margin_pct)}.` : ""}</p>
  <div class="grid3">${M.perf_tiers.map(tierCard).join("")}</div>
  <div class="card"><h3>Clinicians assigned against response time</h3><p class="note">Each dot is a hospital. Left of the vertical line, a hospital has fewer clinicians than its volume needs; above the horizontal line, response is slower than the contract target.</p>
    <div class="chart tall"><canvas id="perfsc"></canvas></div><div id="perftbl"></div></div>
  <div class="card"><h3>All hospitals</h3><p class="note">Select a row to open the account detail. How tiers are decided is on the <a href="methodology.html#tiers">methodology page</a>.</p>
    <div class="filters"><label>Performance<select id="fp"><option value="">All</option>${["Needs assistance", "As expected", "Exceptional"].map(x => `<option>${x}</option>`).join("")}</select></label>
    <label>Region<select id="fr"><option value="">All</option>${[...new Set(M.accounts.map(a => a.region))].sort().map(x => `<option>${x}</option>`).join("")}</select></label></div>
    <div id="ptable"></div></div>`;
  const shapes = { "Exceptional": "circle", "As expected": "rect", "Needs assistance": "triangle" }, colr = { "Exceptional": c.green, "As expected": c.gray, "Needs assistance": c.red };
  const ds = ["Needs assistance", "As expected", "Exceptional"].map(n => ({ label: n, pointStyle: shapes[n], backgroundColor: colr[n], borderColor: colr[n], pointRadius: 6, pointHoverRadius: 8,
    data: M.accounts.filter(a => a.perf === n).map(a => ({ x: a.coverage * 100, y: a.avg_resp, name: a.name })) }));
  mkChart("perfsc", { type: "scatter", data: { datasets: ds }, options: { plugins: { legend: { labels: { usePointStyle: true } }, tooltip: { callbacks: { label: x => `${x.raw.name}: ${x.raw.y.toFixed(1)} min, ${x.raw.x.toFixed(0)}% staffed` } },
    refLines: { lines: [{ axis: "y", value: M.meta.target, color: c.red, label: `Target ${M.meta.target} min` }, { axis: "x", value: 90, color: c.amber, label: "90% staffed" }] } },
    scales: { x: { title: { display: true, text: "Clinicians assigned as % of need (encounters ÷ 60 per FTE)" }, ticks: { callback: v => v + "%" } }, y: { title: { display: true, text: "Average response (min)" }, min: 6 } } } }, "Scatter of staffing coverage against response time by hospital");
  $("#perftbl").innerHTML = dataTable(["Hospital", "Staffed % of need", "Avg response (min)", "Performance"], M.accounts.map(a => [a.name, p0(a.coverage * 100), a.avg_resp.toFixed(1), a.perf]));
  const draw = () => { const fp = $("#fp").value, fr = $("#fr").value, order = { "Needs assistance": 0, "As expected": 1, "Exceptional": 2 };
    const rows = M.accounts.filter(a => (!fp || a.perf === fp) && (!fr || a.region === fr)).sort((a, b) => order[a.perf] - order[b.perf] || b.avg_resp - a.avg_resp);
    $("#ptable").innerHTML = `<table class="cards"><thead><tr><th>Hospital</th><th>Performance</th><th class="num">Response</th><th class="num">Met SLA</th><th class="num">Satisfaction</th><th>Staffing</th><th class="num">Margin</th><th>Why</th></tr></thead><tbody>${rows.map(a =>
      `<tr class="click" tabindex="0" data-id="${a.id}"><td data-label="Hospital"><b>${esc(a.name)}</b><br><span class="muted">${a.region} · ${a.type}</span></td><td data-label="Performance">${perfChip(a.perf)}</td><td class="num" data-label="Response">${a.avg_resp.toFixed(1)} min</td><td class="num" data-label="Met SLA">${p0(a.sla)}</td><td class="num" data-label="Satisfaction">${a.sat.toFixed(1)}</td><td data-label="Staffing">${posChip(a.position)} ${p0(a.coverage * 100)}</td><td class="num" data-label="Margin">${p1(a.margin_pct)}</td><td data-label="Why" class="muted">${esc(a.perf_reason)}</td></tr>`).join("")}</tbody></table>`; };
  $("#fp").onchange = draw; $("#fr").onchange = draw; draw();
}

/* ---------- Page 3: account risk ---------- */
function risk(el) {
  const k = M.kpis;
  el.innerHTML = `<h2 class="headline">${k.high_count} accounts are at high risk of leaving, worth ${money(k.value_at_risk)}; ${k.q1_count} of them renew in the next three months.</h2>
  <p class="sub">Risk counts four warning flags: response over target, volume falling, low satisfaction, margin sliding. Three or four is High, one or two is Watch. Ranked by soonest renewal, then contract value.</p>
  <div class="card"><div class="filters"><label>Risk tier<select id="rt"><option value="">All</option><option>High</option><option>Watch</option><option>Healthy</option></select></label>
  <label>Region<select id="rr"><option value="">All</option>${[...new Set(M.accounts.map(a => a.region))].sort().map(x => `<option>${x}</option>`).join("")}</select></label>
  <label>Service line<select id="rs"><option value="">All</option><option>Tele-Neurology</option><option>Tele-Psychiatry</option><option>Tele-Critical Care</option></select></label></div><div id="rtable"></div>
  <p class="note" style="margin-top:8px">Flags, left to right: <b>R</b> response, <b>V</b> volume, <b>S</b> satisfaction, <b>M</b> margin. A filled red circle means the flag is on.</p></div>`;
  const draw = () => { const t = $("#rt").value, r = $("#rr").value, s = $("#rs").value;
    const rows = M.accounts.filter(a => (!t || a.tier === t) && (!r || a.region === r) && (!s || a.lines.includes(s)));
    $("#rtable").innerHTML = `<table class="cards"><thead><tr><th>Hospital</th><th>Risk</th><th>Flags</th><th>Renewal</th><th class="num">Contract</th><th>Reason</th></tr></thead><tbody>${rows.map(a => {
      const f = a.flags; const fl = [["R", "service", "Response"], ["V", "volume", "Volume"], ["S", "satisfaction", "Satisfaction"], ["M", "margin", "Margin"]].map(([l, kf, n]) => `<span class="flag ${f[kf] ? "on" : ""}" title="${n}${f[kf] ? " flag on" : " ok"}" aria-label="${n} ${f[kf] ? "flag on" : "ok"}">${l}</span>`).join("");
      return `<tr class="click" tabindex="0" data-id="${a.id}"><td data-label="Hospital"><b>${esc(a.name)}</b><br><span class="muted">${a.region} · ${a.lines.map(x => x.replace("Tele-", "")).join(", ")}</span></td><td data-label="Risk">${tierChip(a.tier)} ${a.risk_score}/4</td><td data-label="Flags">${fl}</td><td data-label="Renewal">${monLabel(a.renewal)}<br><span class="muted">in ${a.renewal_in_months} mo</span></td><td class="num" data-label="Contract">${money(a.acv)}</td><td data-label="Reason" class="muted">${esc(a.reason)}</td></tr>`; }).join("")}</tbody></table>`; };
  ["rt", "rr", "rs"].forEach(i => $("#" + i).onchange = draw); draw();
}

/* ---------- Page 4: account drilldown ---------- */
function account(el, id) {
  const a = M.accounts.find(x => x.id === id) || M.accounts[0], c = col(), mo = M.meta.months, s = a.series;
  const dropIdx = a.first_fte_drop ? mo.indexOf(a.first_fte_drop) : null;
  el.innerHTML = `<div class="filters"><label>Hospital<select id="pick">${M.accounts.map(x => `<option value="${x.id}" ${x.id === a.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label></div>
  <h2 class="headline">${esc(a.name)}: ${a.perf === "Needs assistance" ? "response " + a.avg_resp.toFixed(1) + " minutes against a " + M.meta.target + "-minute target, staffed at " + p0(a.coverage * 100) + " of need" : a.perf === "Exceptional" ? "exceptional service, " + a.avg_resp.toFixed(1) + " minute response" : "performing as expected"}.</h2>
  <p class="sub">${a.region} · ${a.type} · ${a.beds} beds · ${a.lines.join(", ")} · renews ${monLabel(a.renewal)} · ${money(a.acv)} a year<br>${perfChip(a.perf)} ${tierChip(a.tier)} ${posChip(a.position)} <span class="muted">${esc(a.reason)}</span></p>
  <div class="multi">
   <div class="card"><h3>Clinicians assigned vs clinicians needed</h3><div class="chart small"><canvas id="a1"></canvas></div></div>
   <div class="card"><h3>Response time against the ${M.meta.target}-minute target</h3><div class="chart small"><canvas id="a2"></canvas></div></div>
   <div class="card"><h3>Hospital satisfaction (1 to 10)</h3><div class="chart small"><canvas id="a3"></canvas></div></div>
   <div class="card"><h3>Encounters per month</h3><div class="chart small"><canvas id="a4"></canvas></div></div>
   <div class="card"><h3>Contribution margin %</h3><div class="chart small"><canvas id="a5"></canvas></div></div></div>
  <div class="card">${dataTable(["Month", "Clinician FTE", "FTE needed", "Response (min)", "Satisfaction", "Encounters", "Margin %"], mo.map((m, i) => [monLabel(m), s.fte[i], s.need[i], s.resp[i], s.sat[i], s.enc[i], p1(s.margin[i])]))}</div>`;
  $("#pick").onchange = e => openAccount(e.target.value);
  const mark = dropIdx ? [{ axis: "x", value: dropIdx, color: c.muted, label: "FTE first dropped" }] : [];
  const line = (id, sets, extra = {}) => mkChart(id, { type: "line", data: { labels: labels(), datasets: sets.map(d => Object.assign({ pointRadius: 0, borderWidth: 2.5, tension: .25 }, d)) },
    options: { plugins: { legend: { display: sets.length > 1, labels: { boxWidth: 12 } }, refLines: { lines: mark.concat(extra.ref || []) } }, scales: { x: { ticks: { maxTicksLimit: 6 } }, y: extra.y || {} } } }, id);
  line("a1", [{ label: "Assigned", data: s.fte, borderColor: c.navy }, { label: "Needed", data: s.need, borderColor: c.gray, borderDash: [5, 4] }]);
  line("a2", [{ label: "Response", data: s.resp, borderColor: c.red }], { ref: [{ axis: "y", value: M.meta.target, color: c.muted, label: "Target" }] });
  line("a3", [{ label: "Satisfaction", data: s.sat, borderColor: c.amber }], { y: { min: 5, max: 10 } });
  line("a4", [{ label: "Encounters", data: s.enc, borderColor: c.blue }]);
  line("a5", [{ label: "Margin %", data: s.margin, borderColor: c.green }], { y: { ticks: { callback: v => v + "%" } } });
}

/* ---------- Page 5: margin drivers ---------- */
function margin(el) {
  const b = M.response_bands, first = b[0], lastb = b[b.length - 1], c = col(), br = M.bridge;
  el.innerHTML = `<h2 class="headline">When response time slips past 13 minutes, margin falls from ${p0(first.margin_pct)} to ${p0(lastb.margin_pct)} and each clinician costs ${p0((lastb.cost_per_fte / first.cost_per_fte - 1) * 100)} more.</h2>
  <p class="sub">Slow response is a staffing problem that shows up in satisfaction first and margin later, because backfilled shifts cost more.</p>
  <div class="cols2"><div class="card"><h3>Faster response, higher margin and satisfaction</h3><p class="note">All account-months, grouped by average response time.</p><div class="chart"><canvas id="m1"></canvas></div>
    ${dataTable(["Response band", "Account-months", "Margin %", "Satisfaction", "Met SLA %", "Cost per FTE"], b.map(x => [x.band, x.n, p1(x.margin_pct), x.sat.toFixed(1), p0(x.sla), money(x.cost_per_fte)]))}</div>
  <div class="card"><h3>Where portfolio margin dollars moved, Jan to Dec 2025</h3><p class="note">Monthly contribution margin by account group. Growth gains were offset by the other three.</p><div class="chart"><canvas id="m2"></canvas></div>
    ${dataTable(["Step", "Monthly margin $"], [["January 2025", money(br.start)], ...br.steps.map(s => [s.group, (s.delta >= 0 ? "+" : "−") + money(Math.abs(s.delta))]), ["December 2025", money(br.end)]])}</div></div>
  <div class="card"><h3>Density and margin, one dot per hospital</h3><p class="note">Encounters per clinician FTE (right = busier clinicians). Healthy range is about 55 to 65; above 70, response time breaks.</p><div class="chart tall"><canvas id="m3"></canvas></div>
    ${dataTable(["Hospital", "Encounters per FTE", "Margin %", "Risk"], M.accounts.map(a => [a.name, a.epf.toFixed(0), p1(a.margin_pct), a.tier]))}</div>`;
  mkChart("m1", { data: { labels: b.map(x => x.band), datasets: [{ type: "bar", order: 2, label: "Margin %", data: b.map(x => x.margin_pct), backgroundColor: c.navy, yAxisID: "y" }, { type: "line", order: 1, label: "Satisfaction (right axis)", data: b.map(x => x.sat), borderColor: c.amber, backgroundColor: c.amber, pointRadius: 5, borderWidth: 2.5, yAxisID: "y1" }] },
    options: { plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { y: { min: 0, ticks: { callback: v => v + "%" } }, y1: { position: "right", min: 6, max: 10, grid: { drawOnChartArea: false } } } } }, "Margin and satisfaction by response time band");
  const labs = ["Jan 2025", ...br.steps.map(s => s.group), "Dec 2025"]; let run = br.start; const fl = [[0, br.start]];
  br.steps.forEach(s => { fl.push([Math.min(run, run + s.delta), Math.max(run, run + s.delta)]); run += s.delta; }); fl.push([0, br.end]);
  const cols = [c.navy, ...br.steps.map(s => s.delta >= 0 ? c.green : c.red), c.navy];
  mkChart("m2", { type: "bar", data: { labels: labs, datasets: [{ data: fl, backgroundColor: cols }] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => { const i = x.dataIndex; return i === 0 ? money(br.start) : i === labs.length - 1 ? money(br.end) : (br.steps[i - 1].delta >= 0 ? "+" : "−") + money(Math.abs(br.steps[i - 1].delta)); } } } }, scales: { y: { ticks: { callback: v => money(v) } } } } }, "Waterfall of monthly margin dollars by account group");
  const tc = { High: c.red, Watch: c.amber, Healthy: c.green }, sh = { High: "triangle", Watch: "rect", Healthy: "circle" };
  mkChart("m3", { type: "scatter", data: { datasets: ["High", "Watch", "Healthy"].map(t => ({ label: t === "High" ? "High risk" : t, pointStyle: sh[t], backgroundColor: tc[t], borderColor: tc[t], pointRadius: 6, data: M.accounts.filter(a => a.tier === t).map(a => ({ x: a.epf, y: a.margin_pct, name: a.name })) })) },
    options: { plugins: { legend: { labels: { usePointStyle: true } }, tooltip: { callbacks: { label: x => `${x.raw.name}: ${x.raw.x.toFixed(0)} enc/FTE, ${x.raw.y.toFixed(1)}% margin` } }, refLines: { lines: [{ axis: "x", value: 70, color: c.red, label: "Response breaks above 70" }] } },
      scales: { x: { title: { display: true, text: "Encounters per clinician FTE (latest 3 months)" }, min: 45 }, y: { title: { display: true, text: "Contribution margin %" }, ticks: { callback: v => v + "%" } } } } }, "Scatter of density against margin by hospital");
}

/* ---------- Page 6: capacity and staffing (utilization, growth, licensing, 24/7) ---------- */
function staffing(el) {
  const S = M.staffing, h = S.headroom, c = col(), all = S.buckets.find(x => x.specialty === "All");
  const thin = S.states.filter(s => s.status === "Thin").length, open = S.states.filter(s => s.status === "Open territory").length;
  const parttime = (S.status_counts["0.25"] || 0), nCl = S.clinicians.length;
  el.innerHTML = `<h2 class="headline">${h.spare_total.toFixed(0)} FTE of clinician capacity is unused today, enough for about ${h.extra_lines} more hospital service lines, but only in states where those clinicians are licensed.</h2>
  <p class="sub">${all.under60} of ${nCl} clinicians run below 60% utilization and ${all.over92} above 92%. ${parttime} are part-time contributors at 0.25 FTE (about 10 hours a week), so capacity moves in small pieces and licensing is what limits where it can go.</p>
  <div class="cols2">
   <div class="card"><h3>Utilization by specialty and home region</h3><p class="note">Share of scheduled clinician time in use, latest 3 months. Flags show clinicians at risk of leaving in the next 90 days.</p><div id="heat"></div></div>
   <div class="card"><h3>How many clinicians sit in each utilization band</h3><p class="note">Below 60% is idle capacity; above 92% is burnout risk.</p><div class="chart"><canvas id="s1"></canvas></div>
    ${dataTable(["Specialty", "Under 60%", "60 to 70%", "70 to 92%", "Over 92%"], S.buckets.map(x => [x.specialty, x.under60, x.mid, x.healthy, x.over92]))}</div></div>
  <div class="card"><h3>Where to move capacity first</h3><p class="note">Hospital service lines with the biggest gap between clinicians assigned and clinicians needed, matched to clinicians under 70% utilization who are already licensed in that state. Where nobody is licensed, the table names who should get a license.</p><div id="moves"></div></div>
  <div class="card"><h3>Growth and new coverage: where licenses would unlock capacity</h3>
    <p class="note">${thin ? thin + " states with hospitals are thin on available licensed clinicians. " : "Every state with hospitals has licensed spare capacity. "}${open} states with no hospital yet already have enough licensed clinicians to serve one.</p>
    <div class="filters"><button class="tab" id="stAll" aria-pressed="false">Show all ${S.states.length} states</button></div><div id="states"></div></div>
  <div class="card"><h3>Next licenses to add</h3><p class="note">Clinicians with spare capacity, paired with the one state where a new license helps most: unmet need first, then states with few licensed clinicians.</p><div id="recs"></div></div>
  <div class="card"><h3>24/7 coverage by home region and shift</h3><p class="note">Clinician capacity in FTE by shift. Overnight under 1.5 FTE in a region is flagged thin.</p><div id="shifts"></div>
    ${dataTable(["Specialty", "Shift", "Clinicians", "FTE", "Utilization %"], S.shifts.map(x => [x.specialty, x.shift, x.n, x.fte, p0(x.util)]))}</div>`;
  const regions = [...new Set(S.util_by_region_specialty.map(x => x.region))].sort(), specs = ["Neurology", "Psychiatry", "Critical Care"];
  const cellCls = u => u < 60 ? "c-amber" : u > 92 ? "c-red" : u >= 70 ? "c-green" : "c-gray";
  $("#heat").innerHTML = `<table class="heat"><thead><tr><th></th>${specs.map(x => `<th class="num">${x}</th>`).join("")}</tr></thead><tbody>${regions.map(r => `<tr><td><b>${r}</b></td>${specs.map(sp => { const x = S.util_by_region_specialty.find(y => y.region === r && y.specialty === sp);
    return x ? `<td class="h"><span class="chip ${cellCls(x.util)}">${p0(x.util)}</span><br><span class="muted" style="font-size:12px">${x.n} clinicians${x.flagged ? ` · ${x.flagged} flagged` : ""}</span></td>` : "<td></td>"; }).join("")}</tr>`).join("")}</tbody></table>`;
  const bk = S.buckets.filter(x => x.specialty !== "All");
  mkChart("s1", { type: "bar", data: { labels: bk.map(x => x.specialty), datasets: [{ label: "Under 60%", data: bk.map(x => x.under60), backgroundColor: c.amber }, { label: "60 to 70%", data: bk.map(x => x.mid), backgroundColor: c.gray }, { label: "70 to 92%", data: bk.map(x => x.healthy), backgroundColor: c.green }, { label: "Over 92%", data: bk.map(x => x.over92), backgroundColor: c.red }] },
    options: { plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: "Clinicians" } } } } }, "Clinicians by utilization band and specialty");
  $("#moves").innerHTML = S.moves.length ? `<table class="cards"><thead><tr><th>Hospital and line</th><th class="num">Gap (FTE)</th><th>Ready to move (licensed here)</th><th>Needs a license</th></tr></thead><tbody>${S.moves.map(m => `<tr class="click" tabindex="0" data-id="${m.id}"><td data-label="Hospital"><b>${esc(m.account)}</b> (${m.state})<br><span class="muted">${m.line}</span></td><td class="num" data-label="Gap">${m.gap.toFixed(2)}</td><td data-label="Ready">${m.ready.length ? m.ready.map(r => `${r.id} (${r.spare.toFixed(2)} FTE spare, ${r.shift.toLowerCase()})`).join("<br>") : '<span class="muted">none</span>'}</td><td data-label="License">${m.need_license.length ? m.need_license.map(r => `${r.id} (${r.spare.toFixed(2)} spare)`).join("<br>") : '<span class="muted">not needed</span>'}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>No service line is short of clinicians.</p>";
  const stRows = all => { const order = { Thin: 0, Covered: 1, "Open territory": 2 }; const rows = S.states.slice().sort((a, b) => order[a.status] - order[b.status] || b.accounts - a.accounts || b.gap - a.gap || a.state.localeCompare(b.state));
    return (all ? rows : rows.filter(r => r.accounts > 0 || r.status === "Thin").concat(rows.filter(r => r.accounts === 0 && r.status === "Open territory").slice(0, 5))).filter((r, i, a) => a.indexOf(r) === i); };
  const drawStates = all => { $("#stAll").setAttribute("aria-pressed", all); $("#states").innerHTML = `<table class="cards"><thead><tr><th>State</th><th>Status</th><th class="num">Hospitals</th><th class="num">Unmet need (FTE)</th><th class="num">Licensed clinicians</th><th class="num">With spare time</th><th class="num">Spare FTE</th></tr></thead><tbody>${stRows(all).map(s => `<tr><td data-label="State"><b>${s.state}</b></td><td data-label="Status">${chip(s.status, { Thin: "red", Covered: "green", "Open territory": "amber" }[s.status])}</td><td class="num" data-label="Hospitals">${s.accounts}</td><td class="num" data-label="Unmet need">${s.gap.toFixed(2)}</td><td class="num" data-label="Licensed">${s.licensed} <span class="muted">(N${s.by_spec.Neurology} P${s.by_spec.Psychiatry} C${s.by_spec["Critical Care"]})</span></td><td class="num" data-label="With spare time">${s.spare_clinicians}</td><td class="num" data-label="Spare FTE">${s.spare_fte.toFixed(1)}</td></tr>`).join("")}</tbody></table><p class="note" style="margin-top:6px">N, P, C = neurology, psychiatry, critical care clinicians licensed in the state. "Open territory" means no hospital yet, but enough licensed clinicians to start one.</p>`; };
  let showAll = false; $("#stAll").onclick = () => { showAll = !showAll; $("#stAll").textContent = showAll ? "Show priority states only" : `Show all ${S.states.length} states`; drawStates(showAll); }; drawStates(false);
  $("#recs").innerHTML = `<table class="cards"><thead><tr><th>Clinician</th><th>Specialty</th><th class="num">Spare FTE</th><th>Add license in</th><th>Why</th></tr></thead><tbody>${S.license_recs.map(r => `<tr><td data-label="Clinician"><b>${r.clinician}</b> <span class="muted">${r.shift.toLowerCase()} shift</span></td><td data-label="Specialty">${r.specialty}</td><td class="num" data-label="Spare FTE">${r.spare.toFixed(2)}</td><td data-label="State"><b>${r.state}</b></td><td data-label="Why" class="muted">${esc(r.why)}</td></tr>`).join("")}</tbody></table>`;
  $("#shifts").innerHTML = `<table class="cards"><thead><tr><th>Home region</th><th class="num">Day FTE</th><th class="num">Evening FTE</th><th class="num">Overnight FTE</th><th>Overnight</th></tr></thead><tbody>${S.overnight.map(o => `<tr><td data-label="Region"><b>${o.region}</b></td><td class="num" data-label="Day">${o.Day.toFixed(1)}</td><td class="num" data-label="Evening">${o.Evening.toFixed(1)}</td><td class="num" data-label="Overnight">${o.Overnight.toFixed(1)}</td><td data-label="Status">${o.thin ? chip("Thin", "red") : chip("Covered", "green")}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- Page 7: leading indicators ---------- */
function leading(el) {
  const L = M.leading, T = L.tiles, first = L.indicators[0], resp = L.indicators.find(x => x.indicator.startsWith("Response")), mg = L.indicators.find(x => x.indicator.startsWith("Margin"));
  el.innerHTML = `<h2 class="headline">Slow response and thin staffing showed up ${resp.months_before_margin} months before margin moved.</h2>
  <p class="sub">Looking back at the ${L.n_high} accounts that ended in high risk. Watch these three tiles every month.</p>
  <div class="grid3">
   ${tile("Response time over target", `${T.response.n} of ${T.response.of} hospitals`, `Threshold: average response above ${M.meta.target} minutes this month.`, T.response.names, T.response.n)}
   ${tile("Volume falling", `${T.volume.n} of ${T.volume.of} hospitals`, "Threshold: last 3 months of encounters 10% or more below the 3 months before.", T.volume.names, T.volume.n)}
   ${tile("Staffing cut near renewal", `${T.staffing.n} of ${T.staffing.of} hospitals`, "Threshold: assigned clinicians down 10% or more in 6 months, with renewal inside 12 months.", T.staffing.names, T.staffing.n)}</div>
  <div class="card"><h3>How much warning each indicator gave</h3><p class="note">Months each signal fired before margin dropped 5 points below its 2024 level (negative means it fired after). Earliest first.</p>
   <table class="cards"><thead><tr><th>Indicator</th><th>First fired</th><th class="num">Accounts it caught</th><th class="num">Months before margin</th></tr></thead><tbody>${L.indicators.map(x => `<tr><td data-label="Indicator"><b>${esc(x.indicator)}</b></td><td data-label="First fired">${x.first_month ? monLabel(x.first_month) : "never"}</td><td class="num" data-label="Caught">${x.fired} of ${x.of}</td><td class="num" data-label="Warning">${x.months_before_margin === null ? "–" : (x.months_before_margin > 0 ? "+" : "") + x.months_before_margin}</td></tr>`).join("")}</tbody></table>
   <p class="note" style="margin-top:8px">Staffing cuts and slow response were the early warnings. Satisfaction and volume confirmed the problem only after margin had already slipped, so they are too late to act on.</p></div>`;
}
const tile = (title, big, thr, names, n) => `<div class="tier ${n ? "need" : "exc"}"><div class="muted" style="font-size:13px">${title}</div><div class="n" style="font-size:24px">${big}</div><p class="muted" style="font-size:13px;margin:6px 0">${thr}</p><div style="font-size:13px">${n ? names.slice(0, 5).map(esc).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "") : "None right now"}</div></div>`;

/* ---------- boot ---------- */
fetch("data/metrics.json").then(r => r.json()).then(d => { M = d; $("#asof").textContent = `Data through ${monLabel(d.meta.months.at(-1))} · fictional company`; route();
  window.addEventListener("hashchange", route); window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route); })
  .catch(() => { $("#app").innerHTML = "<p>Could not load data/metrics.json. If you opened this file directly, serve the folder instead: <code>python3 -m http.server --directory site</code></p>"; });
