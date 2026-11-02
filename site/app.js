/* Larkspur TeleSpecialty executive dashboard (synthetic data, fictional company).
   Reads only data/metrics.json. Every headline is built from that data.
   Design rules applied (see methodology page): answer first, most important view upper-left, two to three views per page,
   big-number tiles, color only to spotlight, direct labels and annotations, cross-highlighting between views. */
"use strict";
let M = null;            // metrics
let charts = [];         // live Chart.js instances, destroyed on page change
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PAGES = [["overview", "Portfolio"], ["performance", "Hospital performance"], ["risk", "Account risk"], ["account", "Account detail"],
  ["margin", "Margin drivers"], ["capacity", "Capacity"], ["coverage", "Licensing & 24/7"], ["leading", "Early warnings"]];

/* ---------- formatting ---------- */
const money = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const num = n => Math.round(n).toLocaleString("en-US");
const p0 = n => `${Math.round(n)}%`, p1 = n => `${n.toFixed(1)}%`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monLabel = m => { const [y, mo] = m.split("-"); return MON[+mo - 1] + " " + y.slice(2); };
const chip = (txt, cls) => `<span class="chip c-${cls}">${esc(txt)}</span>`;
const perfChip = p => chip(p, { "Exceptional": "green", "As expected": "gray", "Needs assistance": "red" }[p]);
const tierChip = t => chip(t, { High: "red", Watch: "amber", Healthy: "green" }[t]);
const posChip = p => chip(p, { Short: "red", "Right-sized": "green", Heavy: "amber" }[p]);
const mk = p => `<span class="mk ${{ "Exceptional": "exc", "As expected": "exp", "Needs assistance": "need" }[p]}" aria-hidden="true"></span>`;
const delta = (txt, dir, good) => `<span class="delta ${good === null ? "flat" : good ? "good" : "bad"}"><span aria-hidden="true">${dir === "up" ? "▲" : dir === "down" ? "▼" : "●"}</span> ${txt}</span>`;
const dim = c => (c.length === 7 ? c + "40" : c);
const sum = (a, s, e) => a.slice(s, e).reduce((x, y) => x + y, 0);

/* ---------- theme colors (read from CSS so dark mode works) ---------- */
const col = () => { const s = getComputedStyle(document.documentElement), g = n => s.getPropertyValue(n).trim();
  return { red: g("--red"), amber: g("--amber"), green: g("--green"), gray: g("--gray"), navy: g("--navy"), blue: g("--blue"), text: g("--text"), muted: g("--muted"), grid: g("--grid") }; };

/* ---------- Chart.js plugins: end labels, reference lines, annotations, bar labels ---------- */
const endLabels = { id: "endLabels", afterDatasetsDraw(ch) { const c = ch.ctx; c.save(); c.font = "600 12px system-ui"; c.textBaseline = "middle";
  ch.data.datasets.forEach((d, i) => { if (!d.endLabel) return; const pt = ch.getDatasetMeta(i).data.at(-1); if (!pt) return;
    c.fillStyle = d.labelColor || d.borderColor; c.fillText(ch.width < 520 && d.endLabelShort ? d.endLabelShort : d.endLabel, pt.x + 7, pt.y + (d.labelDy || 0)); }); c.restore(); } };
const refLines = { id: "refLines", afterDatasetsDraw(ch, _a, o) { ((o && o.lines) || []).forEach(l => { const sc = ch.scales[l.axis]; if (!sc) return;
  const c = ch.ctx, a = ch.chartArea, lab = (ch.width < 460 && l.short) ? l.short : l.label; c.save(); c.strokeStyle = l.color; c.setLineDash([5, 4]); c.lineWidth = 1.3; c.beginPath();
  if (l.axis === "y") { const y = sc.getPixelForValue(l.value); c.moveTo(a.left, y); c.lineTo(a.right, y); } else { const x = sc.getPixelForValue(l.value); c.moveTo(x, a.top); c.lineTo(x, a.bottom); }
  c.stroke(); c.setLineDash([]); c.fillStyle = l.color; c.font = "12px system-ui";
  if (l.axis === "y") { const y = sc.getPixelForValue(l.value) - 5; c.textAlign = l.right ? "right" : "left"; c.fillText(lab, l.right ? a.right - 6 : a.left + 6, y); }
  else { const x = sc.getPixelForValue(l.value), right = x > (a.left + a.right) / 2; c.textAlign = right ? "right" : "left"; c.fillText(lab, x + (right ? -5 : 5), a.top + 12); } c.restore(); }); } };
const annos = { id: "annos", afterDatasetsDraw(ch, _a, o) { ((o && o.items) || []).forEach(a => { const xs = ch.scales.x, ys = ch.scales.y; if (!xs || !ys || (a.minW && ch.width < a.minW)) return;
  const x = xs.getPixelForValue(a.x), y = ys.getPixelForValue(a.y), c = ch.ctx, ar = ch.chartArea, ex = x + a.dx, ey = y + a.dy, lines = a.text.split("\n");
  c.save(); c.fillStyle = c.strokeStyle = a.color; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
  c.font = "600 12px system-ui"; const w = Math.max(...lines.map(l => c.measureText(l).width)); let al = a.dx >= 0 ? "left" : "right";
  if (al === "left" && ex + w + 6 > ar.right) al = "right"; if (al === "right" && ex - w - 6 < ar.left) al = "left";
  c.textAlign = al; c.textBaseline = "middle"; lines.forEach((l, i) => c.fillText(l, ex + (al === "left" ? 5 : -5), ey + (i - (lines.length - 1) / 2) * 14)); c.restore(); }); } };
const barLabels = { id: "barLabels", afterDatasetsDraw(ch, _a, o) { if (!o || !o.fmt) return; const c = ch.ctx, horiz = ch.options.indexAxis === "y"; c.save(); c.font = "600 12px system-ui"; c.fillStyle = col().text;
  ch.getDatasetMeta(0).data.forEach((b, i) => { const v = ch.data.datasets[0].data[i], t = o.fmt(v);
    if (horiz) { c.textBaseline = "middle"; c.textAlign = v >= 0 ? "left" : "right"; c.fillText(t, v >= 0 ? b.x + 6 : b.x - 6, b.y); }
    else { c.textAlign = "center"; c.textBaseline = v >= 0 ? "bottom" : "top"; c.fillText(t, b.x, v >= 0 ? b.y - 5 : b.y + 5); } }); c.restore(); } };
Chart.register(endLabels, refLines, annos, barLabels);

function mkChart(id, cfg, label) {
  const el = $("#" + id); el.setAttribute("role", "img"); el.setAttribute("aria-label", label || "Chart");
  const c = col(); Chart.defaults.color = c.muted; Chart.defaults.borderColor = c.grid; Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options);
  const ch = new Chart(el, cfg); charts.push(ch); return ch;
}
const killCharts = ids => { charts = charts.filter(ch => { if (ids.includes(ch.canvas.id)) { ch.destroy(); return false; } return true; }); };
const dataTable = (head, rows) => `<details><summary>View chart data as a table</summary><div style="overflow-x:auto"><table><thead><tr>${head.map((h, i) => `<th class="${i ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${i ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
const labels = () => M.meta.months.map(monLabel);
const gridOpts = (c, extra = {}) => Object.assign({ grid: { color: c.grid }, border: { display: false } }, extra);

/* ---------- small UI parts ---------- */
const head = (q, title, sub) => `<p class="eyebrow">${esc(q)}</p><h2 class="headline">${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}`;
const spark = v => { const w = 84, h = 26, mn = Math.min(...v), mx = Math.max(...v), sx = i => 2 + i * (w - 4) / (v.length - 1), sy = y => h - 3 - (y - mn) / ((mx - mn) || 1) * (h - 7);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${v.map((y, i) => `${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="${sx(v.length - 1).toFixed(1)}" cy="${sy(v.at(-1)).toFixed(1)}" r="2.6" fill="currentColor"/></svg>`; };
const kpi = (label, value, note, sp) => `<div class="kpi"><div class="kl">${label}</div><div class="kv">${value}</div><div class="kd">${note}</div>${sp ? spark(sp) : ""}</div>`;
const seg = (id, opts, cur) => `<div class="seg" id="${id}" role="group">${opts.map(o => `<button type="button" data-v="${esc(o)}" aria-pressed="${o === cur}">${esc(o)}</button>`).join("")}</div>`;
const bindSeg = (id, fn) => $("#" + id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; [...b.parentNode.children].forEach(x => x.setAttribute("aria-pressed", x === b)); fn(b.dataset.v); });
function tierCard(x, asButton, pressed) {
  const tag = asButton ? "button" : "div", attrs = asButton ? ` type="button" data-tier="${esc(x.name)}" aria-pressed="${pressed}"` : "";
  return `<${tag} class="tier"${attrs}><div class="tn">${mk(x.name)} ${esc(x.name)}</div><div class="n">${x.count}</div><div class="muted" style="font-size:13px">hospitals · ${money(x.acv)} contract value</div>
  <ul><li>Response time <b>${x.avg_resp.toFixed(1)} min</b></li><li>Met SLA <b>${p0(x.sla)}</b></li><li>Satisfaction <b>${x.sat.toFixed(1)}</b></li><li>Margin <b>${p1(x.margin_pct)}</b></li><li>Cost per clinician FTE <b>${money(x.cost_per_fte)}</b></li></ul></${tag}>`;
}

/* ---------- router ---------- */
function route() {
  const [page, ...rest] = (location.hash.slice(1) || "overview").split("-"), arg = rest.join("-");
  charts.forEach(c => c.destroy()); charts = [];
  const known = (PAGES.find(p => p[0] === page) || page === "methodology") ? page : "overview";
  $("#nav").innerHTML = PAGES.map(([k, t]) => `<a href="#${k}" ${k === known ? 'aria-current="page"' : ""}>${t}</a>`).join("") + methLink(known);
  const view = { overview, performance, risk, account, margin, capacity, coverage, leading, methodology: el => { el.innerHTML = window.__METH || ""; } }[known];
  $("#app").innerHTML = ""; view($("#app"), arg); window.scrollTo(0, 0);
  document.title = `${(PAGES.find(p => p[0] === known) || ["", "Methodology"])[1]} · Larkspur Executive Dashboard`;
}
const methLink = known => window.__METH ? `<a href="#methodology" ${known === "methodology" ? 'aria-current="page"' : ""}>Methodology</a>` : `<a href="methodology.html">Methodology</a>`;
const methHref = () => window.__METH ? "#methodology" : "methodology.html";
const openAccount = id => { location.hash = "account-" + id; };
document.addEventListener("click", e => { const r = e.target.closest("[data-id]"); if (r && r.dataset.open !== "no") openAccount(r.dataset.id); });
document.addEventListener("keydown", e => { if (e.key === "Enter") { const r = e.target.closest("[data-id]"); if (r) openAccount(r.dataset.id); } });

/* ---------- Portfolio: how is the portfolio doing? ---------- */
function overview(el) {
  const k = M.kpis, T = M.portfolio.total, g = M.portfolio.groups, mo = M.meta.months, c = col(), j = mo.indexOf("2025-01"), d = mo.indexOf("2025-12");
  const revY = (sum(T.revenue, 12, 24) / sum(T.revenue, 0, 12) - 1) * 100, encY = (sum(T.enc, 12, 24) / sum(T.enc, 0, 12) - 1) * 100;
  const needs = M.perf_tiers.find(x => x.name === "Needs assistance"), br = M.bridge;
  const pos = br.steps.filter(s => s.delta > 0).reduce((a, s) => a + s.delta, 0), neg = br.steps.filter(s => s.delta < 0).reduce((a, s) => a + s.delta, 0);
  el.innerHTML = head("How is the portfolio doing?", esc(M.headline), "Service metrics move months before margin does. The portfolio average hides four different account patterns.") + `
  <div class="kpis">
    ${kpi("Revenue, last 12 months", money(k.revenue_t12), delta(`${revY >= 0 ? "+" : ""}${revY.toFixed(0)}% vs 2024`, revY >= 0 ? "up" : "down", revY >= 0), T.revenue.slice(12))}
    ${kpi("Contribution margin", p0(k.margin_pct), delta(`${Math.abs(k.margin_change_pts).toFixed(1)} pts vs 2024`, k.margin_change_pts >= 0 ? "up" : "down", k.margin_change_pts >= 0), T.margin.slice(12))}
    ${kpi("Encounters, last 12 months", num(k.encounters), delta(`${encY >= 0 ? "+" : ""}${encY.toFixed(0)}% vs 2024`, encY >= 0 ? "up" : "down", encY >= 0), T.enc.slice(12))}
    ${kpi("Hospital accounts", k.accounts, delta(`${needs.count} need assistance`, "flat", false))}
    ${kpi("Contract value at high risk", money(k.value_at_risk), delta(`${money(k.value_at_risk_q1)} renews in Q1`, "flat", false))}
  </div>
  <div class="grid">
    <div class="panel c8"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h3>Margin looks flat at ${p0(k.margin_pct)}, but ${Math.abs(g["At-risk"].margin[d] - g["At-risk"].margin[j]).toFixed(0)} points of it left the at-risk group</h3><p class="note">Contribution margin % by month. Select a group to spotlight it.</p></div>
      ${seg("grpsel", ["All groups", "At-risk", "Growth", "Quiet churn", "Steady"], "All groups")}</div>
      <div class="chart tall"><canvas id="hero"></canvas></div><div id="herotbl"></div></div>
    <div class="panel c4"><h3>Growth added ${money(pos)} a month; the other groups gave back ${money(Math.abs(neg))}</h3><p class="note">Change in monthly margin dollars, Jan to Dec 2025.</p><div class="chart tall"><canvas id="wf"></canvas></div></div>
  </div>
  <h3 class="sect">Hospital performance today</h3>
  <div class="tiers">${M.perf_tiers.map(x => tierCard(x, false)).join("")}</div>
  <p><a href="#performance">See every hospital ranked →</a></p>`;
  const style = { "At-risk": c.red, "Growth": c.green, "Quiet churn": c.amber, "Steady": c.gray };
  const draw = sel => {
    killCharts(["hero", "wf"]);
    const on = n => sel === "All groups" || sel === n;
    const ds = Object.keys(g).map(n => ({ label: n, data: g[n].margin, borderColor: on(n) ? style[n] : dim(style[n]), backgroundColor: style[n], borderWidth: on(n) ? 3 : 1.5, pointRadius: 0, tension: .25, labelColor: on(n) ? style[n] : c.muted,
      endLabel: `${n} ${g[n].margin[d].toFixed(0)}%`, endLabelShort: n, labelDy: n === "Steady" ? -5 : n === "Quiet churn" ? -7 : n === "At-risk" ? 9 : 0 }));
    ds.push({ label: "Portfolio", data: T.margin, borderColor: c.navy, borderDash: [6, 4], borderWidth: 2.5, pointRadius: 0, tension: .25, endLabel: `Portfolio ${T.margin[d].toFixed(0)}%`, labelDy: -4 });
    const drop = g["At-risk"].margin[d] - g["At-risk"].margin[j];
    mkChart("hero", { type: "line", data: { labels: labels(), datasets: ds }, options: { layout: { padding: { right: window.innerWidth < 640 ? 76 : 112, top: 6 } }, plugins: { legend: { display: false },
        refLines: { lines: [{ axis: "x", value: j + 1, color: c.muted, label: "Feb 2025: clinicians move to growth accounts", short: "Feb 2025" }] },
        annos: { items: [{ x: mo.indexOf("2025-08"), y: g["At-risk"].margin[mo.indexOf("2025-08")], dx: 22, dy: 74, minW: 560, color: style["At-risk"], text: `At-risk: ${Math.abs(drop).toFixed(0)} pts lower\nthan Jan 2025` }] },
        tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}%` } } },
      scales: { y: gridOpts(c, { min: 0, ticks: { callback: v => v + "%" } }), x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } } } }, "Contribution margin percent by account group");
    const net = br.end - br.start, gl = [...br.steps.map(s => s.group), "Net"], gv = [...br.steps.map(s => s.delta), net], sg = v => (v >= 0 ? "+" : "−") + money(Math.abs(v));
    mkChart("wf", { type: "bar", data: { labels: gl, datasets: [{ data: gv, borderRadius: 2, backgroundColor: gv.map((v, i) => i === gv.length - 1 ? c.navy : (on(gl[i]) ? (v >= 0 ? c.green : c.red) : dim(v >= 0 ? c.green : c.red))) }] },
      options: { layout: { padding: { top: 18, bottom: 4 } }, plugins: { legend: { display: false }, barLabels: { fmt: sg }, tooltip: { callbacks: { label: x => sg(x.parsed.y) + " a month" } } },
        scales: { y: gridOpts(c, { ticks: { callback: v => (v < 0 ? "−" : "") + money(Math.abs(v)) }, suggestedMin: Math.min(...gv) * 1.25, suggestedMax: Math.max(...gv) * 1.25 }), x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 0, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 8 && window.innerWidth < 1100 ? l.split(" ") : l; } } } } } }, "Change in monthly margin dollars by account group");
  };
  draw("All groups"); bindSeg("grpsel", draw);
  $("#herotbl").innerHTML = dataTable(["Month", ...Object.keys(g), "Portfolio"], mo.map((m, i) => [monLabel(m), ...Object.keys(g).map(n => p1(g[n].margin[i])), p1(T.margin[i])]));
}

/* ---------- Hospital performance: who is exceptional, as expected, or needs assistance? ---------- */
function performance(el) {
  const T = n => M.perf_tiers.find(x => x.name === n), ex = T("Exceptional"), ne = T("Needs assistance"), c = col(), target = M.meta.target;
  const heavy = M.heavy && M.heavy.count ? ` ${M.heavy.count} other hospitals have more clinicians than their volume needs (over 115% staffed) and earn only ${p1(M.heavy.margin_pct)}.` : "";
  const regions = ["All regions", ...[...new Set(M.accounts.map(a => a.region))].sort()];
  el.innerHTML = head("Which hospitals are exceptional, as expected, or need assistance?", `${ex.count} hospitals are performing exceptionally and ${ne.count} need assistance. ${ne.short === ne.count ? "All " + ne.count : ne.short + " of " + ne.count} of those are short on clinicians.`,
    `Hospitals needing assistance earn ${p1(ne.margin_pct)} margin against ${p1(ex.margin_pct)} for the exceptional group, and each clinician FTE costs ${money(ne.cost_per_fte)} instead of ${money(ex.cost_per_fte)}. Latest 3 months.${heavy}`) + `
  <div class="tiers" id="tiers">${["Needs assistance", "As expected", "Exceptional"].map(n => tierCard(T(n), true, false)).join("")}</div>
  <div class="controls"><div class="ctl"><span>Region</span>${seg("regsel", regions, "All regions")}</div><div class="ctl"><span>Tip</span><span class="muted" style="font-weight:400">Select a tier above to filter. Hover a hospital to see it in both views. Select it to open its detail.</span></div></div>
  <div class="grid"><div class="panel c7"><h3>Hospitals short of clinicians answer slowest</h3><p class="note">Each mark is a hospital. Left of the line: fewer clinicians than the volume needs. Above the line: slower than the ${target}-minute contract target.</p><div class="chart tall"><canvas id="perfsc"></canvas></div><div id="perftbl"></div></div>
  <div class="panel c5"><h3>Ranked by response time</h3><p class="note">Bars show average response; the tick marks the ${target}-minute target.</p><ul class="rank" id="rank" style="position:relative"></ul></div></div>`;
  let ft = null, reg = "All regions", pc = null, locate = {};
  const shapes = { "Exceptional": "circle", "As expected": "rect", "Needs assistance": "triangle" }, colr = { "Exceptional": c.green, "As expected": c.gray, "Needs assistance": c.red };
  const setHl = id => { document.querySelectorAll("#rank li.hl").forEach(x => x.classList.remove("hl")); const row = id && $(`#rank li[data-id="${id}"]`); if (row) { row.classList.add("hl"); const ul = $("#rank"); ul.scrollTop = Math.max(0, row.offsetTop - ul.clientHeight / 2); } };
  const draw = () => {
    killCharts(["perfsc"]); locate = {};
    const rows = M.accounts.filter(a => (!ft || a.perf === ft) && (reg === "All regions" || a.region === reg));
    const ds = ["Needs assistance", "As expected", "Exceptional"].map((n, di) => ({ label: n, pointStyle: shapes[n], backgroundColor: ft && ft !== n ? dim(colr[n]) : colr[n], borderColor: ft && ft !== n ? dim(colr[n]) : colr[n], pointRadius: 6.5, pointHoverRadius: 10, pointHoverBorderWidth: 2, pointHoverBorderColor: c.text,
      data: rows.filter(a => a.perf === n).map((a, i) => { locate[a.id] = [di, i]; return { x: a.coverage * 100, y: a.avg_resp, name: a.name, id: a.id }; }) }));
    pc = mkChart("perfsc", { type: "scatter", data: { datasets: ds }, options: { onHover: (e, els) => setHl(els.length ? pc.data.datasets[els[0].datasetIndex].data[els[0].index].id : null), onClick: (e, els) => { if (els.length) openAccount(pc.data.datasets[els[0].datasetIndex].data[els[0].index].id); },
      plugins: { legend: { labels: { usePointStyle: true } }, tooltip: { callbacks: { label: x => `${x.raw.name}: ${x.raw.y.toFixed(1)} min, ${x.raw.x.toFixed(0)}% staffed` } },
        refLines: { lines: [{ axis: "y", value: target, color: c.red, label: `Target ${target} min`, right: true }, { axis: "x", value: 90, color: c.amber, label: "90% staffed" }] } },
      scales: { x: gridOpts(c, { title: { display: true, text: "Clinicians assigned as % of need" }, ticks: { callback: v => v + "%" } }), y: gridOpts(c, { title: { display: true, text: "Average response (min)" }, min: 6 }) } } }, "Scatter of staffing coverage against response time by hospital");
    const order = { "Needs assistance": 0, "As expected": 1, "Exceptional": 2 };
    $("#rank").innerHTML = rows.slice().sort((a, b) => order[a.perf] - order[b.perf] || b.avg_resp - a.avg_resp).map(a => `<li tabindex="0" data-id="${a.id}"><div><div class="rn">${mk(a.perf)} ${esc(a.name)}</div><div class="rr">${esc(a.perf_reason)}</div></div><div><div class="bar"><i class="${a.avg_resp > target ? "late" : ""}" style="width:${Math.min(100, a.avg_resp / 20 * 100)}%"></i><s style="left:50%"></s></div><div class="bv">${a.avg_resp.toFixed(1)} min</div></div></li>`).join("") || '<li class="muted" data-open="no">No hospitals match.</li>';
    $("#rank").querySelectorAll("li[data-id]").forEach(li => { li.addEventListener("mouseenter", () => { const l = locate[li.dataset.id]; if (l && pc) { pc.setActiveElements([{ datasetIndex: l[0], index: l[1] }]); pc.update("none"); li.classList.add("hl"); } });
      li.addEventListener("mouseleave", () => { if (pc) { pc.setActiveElements([]); pc.update("none"); } li.classList.remove("hl"); }); });
    $("#perftbl").innerHTML = dataTable(["Hospital", "Staffed % of need", "Avg response (min)", "Performance"], rows.map(a => [a.name, p0(a.coverage * 100), a.avg_resp.toFixed(1), a.perf]));
  };
  $("#tiers").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; const t = b.dataset.tier; ft = ft === t ? null : t; $("#tiers").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x.dataset.tier === ft)); draw(); });
  bindSeg("regsel", v => { reg = v; draw(); }); draw();
}

/* ---------- Account risk: which accounts might leave, and why? ---------- */
function risk(el) {
  const k = M.kpis, hi = M.accounts.filter(a => a.tier === "High"), wa = M.accounts.filter(a => a.tier === "Watch");
  el.innerHTML = head("Which accounts are at risk of leaving, and why?", `${k.high_count} accounts are at high risk of leaving, worth ${money(k.value_at_risk)}; ${k.q1_count} of them renew in the next three months.`,
    "Risk counts four warning flags: response over target, volume falling, low satisfaction, margin sliding. Three or four is High, one or two is Watch. Ranked by soonest renewal, then contract value.") + `
  <div class="kpis">${kpi("High risk", hi.length, delta(`${money(k.value_at_risk)} contract value`, "flat", false))}${kpi("Renewing in Q1", k.q1_count, delta(`${money(k.value_at_risk_q1)} at risk`, "flat", false))}${kpi("Watch", wa.length, `${money(wa.reduce((a, x) => a + x.acv, 0))} contract value`)}${kpi("Healthy", M.accounts.length - hi.length - wa.length, "no warning flags on")}</div>
  <div class="card"><div class="controls"><div class="ctl"><span>Risk tier</span>${seg("rt", ["All", "High", "Watch", "Healthy"], "All")}</div><div class="ctl"><span>Region</span>${seg("rr", ["All", ...[...new Set(M.accounts.map(a => a.region))].sort()], "All")}</div>
  <div class="ctl"><span>Service line</span>${seg("rs", ["All", "Tele-Neurology", "Tele-Psychiatry", "Tele-Critical Care"], "All")}</div></div><div id="rtable"></div>
  <p class="note" style="margin-top:8px">Flags, left to right: <b>R</b> response, <b>V</b> volume, <b>S</b> satisfaction, <b>M</b> margin. A filled red circle means the flag is on. Select a row to open the account.</p></div>`;
  const f = { t: "All", r: "All", s: "All" };
  const draw = () => { const rows = M.accounts.filter(a => (f.t === "All" || a.tier === f.t) && (f.r === "All" || a.region === f.r) && (f.s === "All" || a.lines.includes(f.s)));
    $("#rtable").innerHTML = `<table class="cards"><thead><tr><th>Hospital</th><th>Risk</th><th>Flags</th><th>Renewal</th><th class="num">Contract</th><th>Reason</th></tr></thead><tbody>${rows.map(a => {
      const fl = [["R", "service", "Response"], ["V", "volume", "Volume"], ["S", "satisfaction", "Satisfaction"], ["M", "margin", "Margin"]].map(([l, kf, n]) => `<span class="flag ${a.flags[kf] ? "on" : ""}" title="${n}${a.flags[kf] ? " flag on" : " ok"}" aria-label="${n} ${a.flags[kf] ? "flag on" : "ok"}">${l}</span>`).join("");
      return `<tr class="click" tabindex="0" data-id="${a.id}"><td data-label="Hospital"><div><b>${esc(a.name)}</b><br><span class="muted">${a.region} · ${a.lines.map(x => x.replace("Tele-", "")).join(", ")}</span></div></td><td data-label="Risk">${tierChip(a.tier)} ${a.risk_score}/4</td><td data-label="Flags">${fl}</td><td data-label="Renewal">${monLabel(a.renewal)}<br><span class="muted">in ${a.renewal_in_months} mo</span></td><td class="num" data-label="Contract">${money(a.acv)}</td><td data-label="Reason" class="muted">${esc(a.reason)}</td></tr>`; }).join("")}</tbody></table>`; };
  bindSeg("rt", v => { f.t = v; draw(); }); bindSeg("rr", v => { f.r = v; draw(); }); bindSeg("rs", v => { f.s = v; draw(); }); draw();
}

/* ---------- Account detail: one hospital's story, with the lag visible ---------- */
function account(el, id) {
  const a = M.accounts.find(x => x.id === id) || M.accounts[0], c = col(), mo = M.meta.months, s = a.series, target = M.meta.target;
  const dropIdx = a.first_fte_drop ? mo.indexOf(a.first_fte_drop) : null, brk = s.resp.findIndex((v, i) => i >= 12 && v > target), sat75 = s.sat.findIndex((v, i) => i >= 12 && v < 7.5);
  el.innerHTML = `<div class="controls"><div class="ctl"><span>Hospital</span><select id="pick">${M.accounts.map(x => `<option value="${x.id}" ${x.id === a.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div></div>` +
  head("How did this hospital get here?", `${esc(a.name)}: ${a.perf === "Needs assistance" ? "response " + a.avg_resp.toFixed(1) + " minutes against a " + target + "-minute target, staffed at " + p0(a.coverage * 100) + " of need" : a.perf === "Exceptional" ? "exceptional service, " + a.avg_resp.toFixed(1) + " minute response" : "performing as expected"}.`,
    `${a.region} · ${a.type} · ${a.beds} beds · ${a.lines.join(", ")} · renews ${monLabel(a.renewal)} · ${money(a.acv)} a year<br>${perfChip(a.perf)} ${tierChip(a.tier)} ${posChip(a.position)} <span class="muted">${esc(a.reason)}</span>`) + `
  <div class="multi">
   <div class="panel"><h3>Clinicians assigned vs clinicians needed</h3><div class="chart small"><canvas id="a1"></canvas></div></div>
   <div class="panel"><h3>Response time against the ${target}-minute target</h3><div class="chart small"><canvas id="a2"></canvas></div></div>
   <div class="panel"><h3>Hospital satisfaction (1 to 10)</h3><div class="chart small"><canvas id="a3"></canvas></div></div>
   <div class="panel"><h3>Encounters per month</h3><div class="chart small"><canvas id="a4"></canvas></div></div>
   <div class="panel"><h3>Contribution margin %</h3><div class="chart small"><canvas id="a5"></canvas></div></div>
   ${s.dtn ? `<div class="panel"><h3>Stroke door-to-needle, hospital average (minutes)</h3><div class="chart small"><canvas id="a6"></canvas></div><p class="note" style="margin-top:6px">Public goal for reference: American Heart Association, within 60 minutes for 85% of patients. A hospital-wide average, so read it as associated with our response time, not caused by it.</p></div>` : ""}</div>
  <div class="card" style="margin-top:16px">${dataTable(["Month", "Clinician FTE", "FTE needed", "Response (min)", "Satisfaction", "Encounters", "Margin %"], mo.map((m, i) => [monLabel(m), s.fte[i], s.need[i], s.resp[i], s.sat[i], s.enc[i], p1(s.margin[i])]))}</div>`;
  $("#pick").onchange = e => openAccount(e.target.value);
  const mark = dropIdx ? [{ axis: "x", value: dropIdx, color: c.muted, label: "FTE first dropped" }] : [];
  const line = (cid, sets, extra = {}) => mkChart(cid, { type: "line", data: { labels: labels(), datasets: sets.map(d => Object.assign({ pointRadius: 0, borderWidth: 2.5, tension: .25 }, d)) },
    options: { plugins: { legend: { display: sets.length > 1, labels: { boxWidth: 12 } }, refLines: { lines: mark.concat(extra.ref || []) }, annos: { items: extra.an || [] } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: gridOpts(c, extra.y || {}) } } }, cid);
  line("a1", [{ label: "Assigned", data: s.fte, borderColor: c.navy }, { label: "Needed", data: s.need, borderColor: c.gray, borderDash: [5, 4] }]);
  line("a2", [{ label: "Response", data: s.resp, borderColor: c.gray, segment: { borderColor: ctx => ctx.p1.parsed.y > target ? c.red : c.gray } }], { ref: [{ axis: "y", value: target, color: c.muted, label: "Target" }],
    an: brk > 0 ? [{ x: brk, y: s.resp[brk], dx: -34, dy: -52, color: c.red, text: `Breaks target\n${monLabel(mo[brk])}` }] : [] });
  line("a3", [{ label: "Satisfaction", data: s.sat, borderColor: c.amber }], { y: { min: 5, max: 10 }, an: sat75 > 0 ? [{ x: sat75, y: s.sat[sat75], dx: -30, dy: 40, color: c.amber, text: `Below 7.5\n${monLabel(mo[sat75])}` }] : [] });
  line("a4", [{ label: "Encounters", data: s.enc, borderColor: c.blue }]);
  line("a5", [{ label: "Margin %", data: s.margin, borderColor: c.green }], { y: { ticks: { callback: v => v + "%" } } });
  if (s.dtn) line("a6", [{ label: "Door-to-needle", data: s.dtn, borderColor: c.blue }], { ref: [{ axis: "y", value: 60, color: c.muted, label: "AHA goal: 60 min" }], y: { suggestedMin: 30, suggestedMax: 78 } });
}

/* ---------- Margin drivers: what is behind the margin? ---------- */
function margin(el) {
  const b = M.response_bands, first = b[0], lastb = b[b.length - 1], c = col(), mo = M.meta.months, g0 = M.portfolio.groups["At-risk"], j0 = mo.indexOf("2025-01");
  const ix = arr => arr.slice(j0).map(v => v / arr[j0] * 100), fteI = ix(g0.fte), costI = ix(g0.cost), cpfI = ix(g0.cost.map((v, i) => v / g0.fte[i]));
  el.innerHTML = head("What is driving margin?", `When response time slips past 13 minutes, margin falls from ${p0(first.margin_pct)} to ${p0(lastb.margin_pct)} and each clinician costs ${p0((lastb.cost_per_fte / first.cost_per_fte - 1) * 100)} more.`,
    "Slow response is a staffing problem that shows up in satisfaction first and margin later, because backfilled shifts cost more.") + `
  <div class="grid"><div class="panel c7"><h3>At-risk hospitals lost ${p0(100 - fteI.at(-1))} of their clinicians, but direct cost fell only ${p0(100 - costI.at(-1))}</h3><p class="note">At-risk group, January 2025 = 100. Gaps were covered by premium-rate backfill.</p><div class="chart tall"><canvas id="m0"></canvas></div>
      ${dataTable(["Month", "Clinicians assigned", "Direct cost", "Cost per clinician FTE"], mo.slice(j0).map((m, i) => [monLabel(m), fteI[i].toFixed(0), costI[i].toFixed(0), cpfI[i].toFixed(0)]))}</div>
    <div class="panel c5"><h3>Faster response, higher margin and satisfaction</h3><p class="note">All account-months grouped by average response time. Bars: margin. Dots: satisfaction.</p><div class="chart tall"><canvas id="m1"></canvas></div>
      ${dataTable(["Response band", "Account-months", "Margin %", "Satisfaction", "Met SLA %", "Cost per FTE"], b.map(x => [x.band, x.n, p1(x.margin_pct), x.sat.toFixed(1), p0(x.sla), money(x.cost_per_fte)]))}</div></div>
  <div class="panel"><h3>Density and margin, one mark per hospital</h3><p class="note">Encounters per clinician FTE (right means busier clinicians). The healthy range is about 55 to 65; above 70, response time breaks.</p><div class="chart tall"><canvas id="m3"></canvas></div>
    ${dataTable(["Hospital", "Encounters per FTE", "Margin %", "Risk"], M.accounts.map(a => [a.name, a.epf.toFixed(0), p1(a.margin_pct), a.tier]))}</div>`;
  mkChart("m0", { type: "line", data: { labels: mo.slice(j0).map(monLabel), datasets: [
      { label: "Clinicians assigned", data: fteI, borderColor: c.navy, endLabel: `Clinicians ${fteI.at(-1).toFixed(0)}`, labelDy: 12 }, { label: "Direct cost", data: costI, borderColor: c.red, endLabel: `Cost ${costI.at(-1).toFixed(0)}`, labelDy: 0 },
      { label: "Cost per clinician FTE", data: cpfI, borderColor: c.amber, borderDash: [5, 4], endLabel: `Per clinician ${cpfI.at(-1).toFixed(0)}`, labelDy: -4 }].map(d => Object.assign({ pointRadius: 0, borderWidth: 3, tension: .25 }, d)) },
    options: { layout: { padding: { right: 110 } }, plugins: { legend: { display: false } }, scales: { y: gridOpts(c, { suggestedMin: 50, suggestedMax: 150, title: { display: true, text: "Index (Jan 2025 = 100)" } }), x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } } } }, "Clinicians assigned, direct cost and cost per clinician for at-risk hospitals");
  mkChart("m1", { data: { labels: b.map(x => x.band), datasets: [{ type: "bar", order: 2, label: "Margin %", data: b.map(x => x.margin_pct), backgroundColor: b.map((x, i) => i === b.length - 1 ? c.red : c.gray), borderRadius: 2, yAxisID: "y" }, { type: "line", order: 1, label: "Satisfaction (right axis)", data: b.map(x => x.sat), borderColor: c.navy, backgroundColor: c.navy, pointRadius: 5, borderWidth: 2.5, yAxisID: "y1" }] },
    options: { plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { y: gridOpts(c, { min: 0, ticks: { callback: v => v + "%" } }), y1: { position: "right", min: 6, max: 10, grid: { drawOnChartArea: false }, border: { display: false } }, x: { grid: { display: false } } } } }, "Margin and satisfaction by response time band");
  const tc = { High: c.red, Watch: c.amber, Healthy: c.green }, sh = { High: "triangle", Watch: "rect", Healthy: "circle" };
  mkChart("m3", { type: "scatter", data: { datasets: ["High", "Watch", "Healthy"].map(t => ({ label: t === "High" ? "High risk" : t, pointStyle: sh[t], backgroundColor: tc[t], borderColor: tc[t], pointRadius: 6.5, data: M.accounts.filter(a => a.tier === t).map(a => ({ x: a.epf, y: a.margin_pct, name: a.name })) })) },
    options: { plugins: { legend: { labels: { usePointStyle: true } }, tooltip: { callbacks: { label: x => `${x.raw.name}: ${x.raw.x.toFixed(0)} enc/FTE, ${x.raw.y.toFixed(1)}% margin` } }, refLines: { lines: [{ axis: "x", value: 70, color: c.red, label: "Response breaks above 70" }] } },
      scales: { x: gridOpts(c, { title: { display: true, text: "Encounters per clinician FTE (latest 3 months)" }, min: 45 }), y: gridOpts(c, { title: { display: true, text: "Contribution margin %" }, ticks: { callback: v => v + "%" } }) } } }, "Scatter of density against margin by hospital");
}

/* ---------- Capacity: is clinician capacity matched to demand? ---------- */
function capacity(el) {
  const S = M.staffing, h = S.headroom, c = col(), all = S.buckets.find(x => x.specialty === "All"), nCl = S.clinicians.length, parttime = S.status_counts["0.25"] || 0, bal = h.balance;
  el.innerHTML = head("Is clinician capacity matched to demand?", `${h.spare_total.toFixed(0)} FTE of clinician capacity is unused today, enough for about ${h.extra_lines} more hospital service lines, but only in states where those clinicians are licensed.`,
    `${all.under60} of ${nCl} clinicians run below 60% utilization and ${all.over92} above 92%, so the load is uneven. ${parttime} are part-time contributors at 0.25 FTE (about 10 hours a week), so capacity moves in small pieces.`) + `
  <div class="kpis">${kpi("Unused capacity", h.spare_total.toFixed(0) + " FTE", "clinicians under 70% utilization")}${kpi("Short of clinicians", bal.shortfall_n + " hospitals", delta(`${bal.shortfall_fte.toFixed(1)} FTE short`, "flat", false))}${kpi("Over-staffed", bal.surplus_n + " hospitals", `${bal.surplus_fte.toFixed(1)} FTE above need`)}${kpi("At risk of leaving", S.clinicians.filter(x => x.flag).length + " clinicians", "flagged for the next 90 days")}</div>
  <div class="grid"><div class="panel c7"><h3>Utilization by specialty and home region</h3><p class="note">Share of scheduled clinician time in use, latest 3 months. Amber: under 60%. Red: over 92%.</p><div id="heat"></div></div>
    <div class="panel c5"><h3>Idle on one side, stretched on the other</h3><p class="note">Clinicians by utilization band.</p><div class="chart"><canvas id="s1"></canvas></div>${dataTable(["Specialty", "Under 60%", "60 to 70%", "70 to 92%", "Over 92%"], S.buckets.map(x => [x.specialty, x.under60, x.mid, x.healthy, x.over92]))}</div></div>
  <div class="panel" style="margin-bottom:16px"><h3>Where to move capacity first</h3><p class="note">Hospitals short of clinicians, most urgent first: high risk, then soonest renewal, then biggest gap. Matched to clinicians under 70% utilization who are already licensed in that state.</p><div id="moves"></div></div>`;
  const regions = [...new Set(S.util_by_region_specialty.map(x => x.region))].sort(), specs = ["Neurology", "Psychiatry", "Critical Care"], cellCls = u => u < 60 ? "c-amber" : u > 92 ? "c-red" : u >= 70 ? "c-green" : "c-gray";
  $("#heat").innerHTML = `<table class="heat"><thead><tr><th></th>${specs.map(x => `<th class="num">${x}</th>`).join("")}</tr></thead><tbody>${regions.map(r => `<tr><td><b>${r}</b></td>${specs.map(sp => { const x = S.util_by_region_specialty.find(y => y.region === r && y.specialty === sp);
    return x ? `<td class="h"><span class="chip ${cellCls(x.util)}">${p0(x.util)}</span><br><span class="muted" style="font-size:12px;font-weight:400">${x.n} clinicians${x.flagged ? ` · ${x.flagged} flagged` : ""}</span></td>` : "<td></td>"; }).join("")}</tr>`).join("")}</tbody></table>`;
  const bk = S.buckets.filter(x => x.specialty !== "All");
  mkChart("s1", { type: "bar", data: { labels: bk.map(x => x.specialty), datasets: [{ label: "Under 60%", data: bk.map(x => x.under60), backgroundColor: c.amber }, { label: "60 to 70%", data: bk.map(x => x.mid), backgroundColor: dim(c.gray) }, { label: "70 to 92%", data: bk.map(x => x.healthy), backgroundColor: c.gray }, { label: "Over 92%", data: bk.map(x => x.over92), backgroundColor: c.red }] },
    options: { plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { x: { stacked: true, grid: { display: false } }, y: gridOpts(c, { stacked: true, title: { display: true, text: "Clinicians" } }) } } }, "Clinicians by utilization band and specialty");
  $("#moves").innerHTML = S.moves.length ? `<p class="note" style="color:var(--text)">${bal.shortfall_n} hospitals are short ${bal.shortfall_fte.toFixed(1)} FTE in total. ${bal.surplus_n} hospitals carry ${bal.surplus_fte.toFixed(1)} FTE more than their volume needs (${bal.surplus_names.map(esc).join(", ")}), so part of the fix is redeploying that, not hiring.</p>
    <table class="cards"><thead><tr><th>Hospital and line</th><th>Renewal</th><th class="num">Gap (FTE)</th><th>Ready to move (licensed here)</th><th>Needs a license</th></tr></thead><tbody>${S.moves.map(m => `<tr class="click" tabindex="0" data-id="${m.id}"><td data-label="Hospital"><div><b>${esc(m.account)}</b> (${m.state}) ${tierChip(m.tier)}<br><span class="muted">biggest gap: ${m.line}</span></div></td><td data-label="Renewal">${monLabel(m.renewal)}<br><span class="muted">${m.renewal_in_months <= 0 ? "this month" : "in " + m.renewal_in_months + " mo"} · ${money(m.acv)}</span></td><td class="num" data-label="Gap">${m.gap.toFixed(2)}</td><td data-label="Ready">${m.ready.length ? m.ready.map(r => `${r.id} (${r.spare.toFixed(2)} FTE spare, ${r.shift.toLowerCase()})`).join("<br>") : '<span class="muted">none</span>'}</td><td data-label="License">${m.need_license.length ? m.need_license.map(r => `${r.id} (${r.spare.toFixed(2)} spare)`).join("<br>") : '<span class="muted">not needed</span>'}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>No hospital is short of clinicians.</p>";
}

/* ---------- Licensing and 24/7: where can we grow, and are the nights covered? ---------- */
function coverage(el) {
  const S = M.staffing, thin = S.states.filter(s => s.status === "Thin").length, open = S.states.filter(s => s.status === "Open territory").length, thinNight = S.overnight.filter(o => o.thin).length;
  el.innerHTML = head("Where can we grow, and are the nights covered?", `${open} states with no hospital yet already have enough licensed clinicians to serve one; ${thin ? thin + " states with hospitals are thin on available clinicians" : "every state with hospitals has licensed spare capacity"}.`,
    "Each clinician holds licenses in about 10 states and can only cover hospitals in those states, so a new license is what opens a new part of the country.") + `
  <div class="kpis">${kpi("States covered", S.states.filter(s => s.status === "Covered").length, "have hospitals and spare licensed capacity")}${kpi("Open territory", open, "licensed clinicians, no hospital yet")}${kpi("Thin states", thin, thin ? delta("need more licenses", "flat", false) : "none today")}${kpi("Overnight coverage", thinNight ? thinNight + " thin" : "All covered", "by home region, under 1.5 FTE flagged")}</div>
  <div class="grid"><div class="panel c7"><h3>Where licensed clinicians and hospitals meet</h3><p class="note">States with hospitals first, then the best open territory.</p><div class="filters"><button class="tab" id="stAll" aria-pressed="false">Show all ${S.states.length} states</button></div><div id="states"></div></div>
    <div class="panel c5"><h3>Next licenses to add</h3><p class="note">Clinicians with spare capacity, paired with the one state where a new license helps most: unmet need first, then states with few licensed clinicians.</p><div id="recs"></div></div></div>
  <div class="panel"><h3>24/7 coverage by home region and shift</h3><p class="note">Clinician capacity in FTE. Overnight under 1.5 FTE in a region is flagged thin.</p><div id="shifts"></div>${dataTable(["Specialty", "Shift", "Clinicians", "FTE", "Utilization %"], S.shifts.map(x => [x.specialty, x.shift, x.n, x.fte, p0(x.util)]))}</div>`;
  const stRows = all => { const order = { Thin: 0, Covered: 1, "Open territory": 2 }, rows = S.states.slice().sort((a, b) => order[a.status] - order[b.status] || b.accounts - a.accounts || b.gap - a.gap || a.state.localeCompare(b.state));
    return (all ? rows : rows.filter(r => r.accounts > 0 || r.status === "Thin").concat(rows.filter(r => r.accounts === 0 && r.status === "Open territory").slice(0, 5))).filter((r, i, a) => a.indexOf(r) === i); };
  const drawStates = all => { $("#stAll").setAttribute("aria-pressed", all); $("#states").innerHTML = `<table class="cards"><thead><tr><th>State</th><th>Status</th><th class="num">Hospitals</th><th class="num">Unmet need</th><th class="num">Licensed</th><th class="num">Spare FTE</th></tr></thead><tbody>${stRows(all).map(s => `<tr><td data-label="State"><b>${s.state}</b></td><td data-label="Status">${chip(s.status, { Thin: "red", Covered: "green", "Open territory": "amber" }[s.status])}</td><td class="num" data-label="Hospitals">${s.accounts}</td><td class="num" data-label="Unmet need">${s.gap.toFixed(2)} FTE</td><td class="num" data-label="Licensed">${s.licensed} <span class="muted">(N${s.by_spec.Neurology} P${s.by_spec.Psychiatry} C${s.by_spec["Critical Care"]})</span></td><td class="num" data-label="Spare FTE">${s.spare_fte.toFixed(1)}</td></tr>`).join("")}</tbody></table><p class="note" style="margin-top:6px">N, P, C = neurology, psychiatry, critical care clinicians licensed in the state.</p>`; };
  let showAll = false; $("#stAll").onclick = () => { showAll = !showAll; $("#stAll").textContent = showAll ? "Show priority states only" : `Show all ${S.states.length} states`; drawStates(showAll); }; drawStates(false);
  $("#recs").innerHTML = `<table class="cards"><thead><tr><th>Clinician</th><th>Add license in</th><th>Why</th></tr></thead><tbody>${S.license_recs.map(r => `<tr><td data-label="Clinician"><b>${r.clinician}</b><br><span class="muted">${r.specialty}, ${r.shift.toLowerCase()}, ${r.spare.toFixed(2)} FTE spare</span></td><td data-label="State"><b>${r.state}</b></td><td data-label="Why" class="muted">${esc(r.why)}</td></tr>`).join("")}</tbody></table>`;
  $("#shifts").innerHTML = `<table class="cards"><thead><tr><th>Home region</th><th class="num">Day FTE</th><th class="num">Evening FTE</th><th class="num">Overnight FTE</th><th>Overnight</th></tr></thead><tbody>${S.overnight.map(o => `<tr><td data-label="Region"><b>${o.region}</b></td><td class="num" data-label="Day">${o.Day.toFixed(1)}</td><td class="num" data-label="Evening">${o.Evening.toFixed(1)}</td><td class="num" data-label="Overnight">${o.Overnight.toFixed(1)}</td><td data-label="Status">${o.thin ? chip("Thin", "red") : chip("Covered", "green")}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- Early warnings: what would have caught this sooner? ---------- */
function leading(el) {
  const L = M.leading, T = L.tiles, c = col(), resp = L.indicators.find(x => x.indicator.startsWith("Response")), ind = L.indicators.filter(x => x.months_before_margin !== null);
  const tile = (title, big, thr, who, n) => `<div class="tier"><div class="tn">${n ? mk("Needs assistance") : mk("Exceptional")} ${title}</div><div class="n" style="font-size:30px">${big}</div><p class="muted" style="font-size:13px;margin:6px 0">${thr}</p><div style="font-size:13px">${n ? who.slice(0, 4).map(x => `<a href="#account-${x.id}">${esc(x.name)}</a> <span class="muted">(${x.renews_in <= 0 ? "renews this month" : "renews in " + x.renews_in + " mo"})</span>`).join("<br>") + (who.length > 4 ? `<br><span class="muted">and ${who.length - 4} more</span>` : "") : "None right now"}</div></div>`;
  el.innerHTML = head("What would have caught this sooner?", `Slow response and thin staffing showed up ${resp.months_before_margin} months before margin moved.`,
    `Looking back at the ${L.n_high} accounts that ended in high risk. Watch these four tiles every month. Hospitals are listed soonest renewal first, because a problem at a hospital about to renew is the costly one.`) + `
  <div class="tiers">${tile("Response time over target", `${T.response.n} of ${T.response.of} hospitals`, `Threshold: average response above ${M.meta.target} minutes this month.`, T.response.names, T.response.n)}
   ${tile("Volume falling", `${T.volume.n} of ${T.volume.of} hospitals`, "Threshold: last 3 months of encounters 10% or more below the 3 months before.", T.volume.names, T.volume.n)}
   ${tile("Staffing cut near renewal", `${T.staffing.n} of ${T.staffing.of} hospitals`, "Threshold: assigned clinicians down 10% or more in 6 months, with renewal inside 12 months.", T.staffing.names, T.staffing.n)}
   ${tile("Quiet churn: volume down, service fine", `${T.quiet.n} of ${T.quiet.of} hospitals`, "Threshold: last quarter's encounters 10% or more below the same quarter a year ago, while response is on target.", T.quiet.names, T.quiet.n)}</div>
  <div class="panel"><h3>Staffing and response gave months of warning; satisfaction and volume came after margin</h3><p class="note">Months each signal fired before margin dropped 5 points below its 2024 level. Left of zero means it fired after.</p><div class="chart short"><canvas id="ld"></canvas></div>
   ${dataTable(["Indicator", "First fired", "Accounts it caught", "Months before margin"], L.indicators.map(x => [x.indicator, x.first_month ? monLabel(x.first_month) : "never", `${x.fired} of ${x.of}`, x.months_before_margin === null ? "–" : x.months_before_margin]))}
   <div class="so"><b>So what:</b> staffing cuts and slow response were the early warnings. Satisfaction and volume confirmed the problem only after margin had slipped. Volume is the early signal only for quiet churn, which is why the fourth tile compares with the same quarter a year ago.</div></div>`;
  mkChart("ld", { type: "bar", data: { labels: ind.map(x => x.indicator), datasets: [{ data: ind.map(x => x.months_before_margin), backgroundColor: ind.map(x => x.months_before_margin > 0 ? c.navy : c.gray), borderRadius: 2 }] },
    options: { indexAxis: "y", layout: { padding: { right: 44, left: 4 } }, plugins: { legend: { display: false }, barLabels: { fmt: v => (v > 0 ? "+" : "") + v + " mo" } },
      scales: { x: gridOpts(c, { title: { display: true, text: "Months before margin moved" }, suggestedMin: -5, suggestedMax: 6 }), y: { grid: { display: false }, ticks: { font: { size: 12 }, callback(v) { const l = this.getLabelForValue(v); return l.length > 34 ? l.slice(0, 33) + "…" : l; } } } } } }, "Months of warning each indicator gave before margin moved");
}

/* ---------- boot ---------- */
const boot = d => { M = d; $("#asof").textContent = `Data through ${monLabel(d.meta.months.at(-1))} · fictional company`; route();
  window.addEventListener("hashchange", route); window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route); };
(window.__M ? Promise.resolve(window.__M) : fetch("data/metrics.json").then(r => r.json())).then(boot)
  .catch(() => { $("#app").innerHTML = "<p>Could not load data/metrics.json. If you opened this file directly, serve the folder instead: <code>python3 -m http.server --directory site</code></p>"; });
