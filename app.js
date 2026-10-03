// Income / expense dashboard over the month tabs of the sheet (read-only).
// Totals follow the category Type: Out → out − in, In → in − out,
// Invest → shown separately, Transfer → excluded.
(function () {
  const $ = (id) => document.getElementById(id);
  const ALL = "";
  const PAGE = 60; // transactions shown per "Show more"

  const state = {
    categoryType: {},   // category name → Out / In / Invest / Transfer
    months: [],         // "YYYY-MM", oldest first
    channels: [],       // channels that have rows in any month
    allChannels: [],    // every channel in the channel tab: { name, type }
    excluded: new Set(), // channels unticked in Data sources
    sourcesOpen: false, // Data sources grid expanded
    txs: [],            // every transaction, with .month
    period: ALL,        // always opens on All months
    category: ALL,
    limit: PAGE,
    catsOpen: { expense: false, income: false }, // show every category, not just the top ones
  };
  const TOP_CATS = 6;

  const ICONS = {
    "Eat": "🍜", "Drink": "☕", "Groceries": "🛒", "Entertainment": "🎬", "Subscription": "🔁",
    "Hangout": "🍻", "Book": "📚", "Car": "🚗", "Gas & tolls": "⛽", "Transport": "🚆",
    "Household": "🏠", "Bills & Utilities": "💡", "Shopping": "🛍️", "Installment": "🧾",
    "Health & Sport": "🏸", "Gym": "🧗", "Trip": "✈️", "Domain & hosting": "🌐", "Insurance": "🛡️",
    "Tax": "🏛️", "Misc": "✨", "Cash": "💵", "Family": "👨‍👩‍👧", "Investment": "📈", "Salary": "💼",
    "Bonus": "🎁", "Gigs": "🧑‍💻", "Divided & gain": "💹", "Cashback": "💳", "Tax return": "💰",
    "Extra": "➕", "Transfer": "🔄",
  };
  const icon = (cat) => ICONS[cat] || "•";

  // ---------- remembered choices (this browser only) ----------

  const PREFS = "finish.prefs";
  function restorePrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS));
      if (!p) return;
      state.excluded = new Set(p.excluded || []);
      $("hide-transfer").checked = p.hideTransfer ?? true;
      state.sourcesOpen = p.sourcesOpen ?? false;
    } catch {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({
        excluded: [...state.excluded], hideTransfer: $("hide-transfer").checked, sourcesOpen: state.sourcesOpen,
      }));
    } catch {}
  }

  // ---------- formatting ----------

  const baht = (n, digits = 0) =>
    (n < 0 ? "−฿" : "฿") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
    return String(Math.round(n));
  };
  const monthLabel = (m, long) =>
    new Date(m + "-01T00:00:00").toLocaleString("en-US", { month: "short", ...(long ? { year: "numeric" } : {}) });
  const dayLabel = (d) => {
    const dt = new Date(d + "T00:00:00");
    return Number.isNaN(dt.getTime()) ? d
      : dt.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---------- totals ----------

  function kindOf(tx) {
    return state.categoryType[tx.category] || "Unknown";
  }

  function summarize(txs) {
    const s = { income: 0, expense: 0, invest: 0, unknown: 0, unknownCount: 0, byExpense: {}, byIncome: {} };
    for (const tx of txs) {
      const i = tx.in || 0, o = tx.out || 0;
      switch (kindOf(tx)) {
        case "Out":
          s.expense += o - i;
          s.byExpense[tx.category] = (s.byExpense[tx.category] || 0) + o - i;
          break;
        case "In":
          s.income += i - o;
          s.byIncome[tx.category] = (s.byIncome[tx.category] || 0) + i - o;
          break;
        case "Invest":
          s.invest += o - i;
          break;
        case "Transfer":
          break;
        default:
          s.unknown += o - i;
          s.unknownCount++;
      }
    }
    return s;
  }

  const isOn = (channel) => !state.excluded.has(channel);
  const inChannel = (tx) => isOn(tx.channel);
  const inPeriod = (tx) => state.period === ALL || tx.month === state.period;
  const monthSummary = (m) => summarize(state.txs.filter((tx) => tx.month === m && inChannel(tx)));

  // Selected channels with no rows in this month although they have rows both before and
  // after it (a gap, i.e. a statement probably not imported). Months outside a channel's
  // first…last month are not flagged: the account may not have been used yet / any more.
  function isGap(channel, month) {
    const ms = state.txs.filter((tx) => tx.channel === channel).map((tx) => tx.month);
    if (!ms.length || ms.includes(month)) return false;
    return ms.some((m) => m < month) && ms.some((m) => m > month);
  }
  function missingChannels(month) {
    return state.channels.filter((c) => isOn(c) && isGap(c, month));
  }
  const isEmpty = (month) => !state.txs.some((tx) => tx.month === month && inChannel(tx));
  const missingText = (month) => isEmpty(month) ? "no data" : "missing " + missingChannels(month).join(", ");
  const monthsWithData = () => state.months.filter((m) => !isEmpty(m));

  // ---------- render ----------

  function render() {
    const scoped = state.txs.filter((tx) => inChannel(tx) && inPeriod(tx));
    const s = summarize(scoped);
    renderPeriods();
    renderOverview(s);
    renderMonthly();
    renderCategories($("by-expense"), s.byExpense, "expense");
    renderCategories($("by-income"), s.byIncome, "income");
    renderList(scoped);
    renderSources();
    savePrefs();
  }

  // Filter changes start the transaction list from the top again.
  function update() {
    state.limit = PAGE;
    render();
  }
  function setPeriod(m) {
    state.period = m;
    state.category = ALL;
    update();
  }

  function renderPeriods() {
    const nav = $("periods");
    const items = [[ALL, "All"], ...[...state.months].reverse().map((m) => [m, monthLabel(m, m.slice(0, 4) !== String(new Date().getFullYear()))])];
    nav.innerHTML = items.map(([m, label]) =>
      `<button data-m="${m}" class="${m === state.period ? "on" : ""}" aria-pressed="${m === state.period}"` +
      `${m && missingChannels(m).length ? ` title="${esc(missingText(m))}"` : ""}>${label}` +
      `${m && missingChannels(m).length ? '<i class="dot"></i>' : ""}</button>`).join("");
    nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setPeriod(b.dataset.m)));
  }

  function renderOverview(s) {
    const net = s.income - s.expense;
    $("hero-label").textContent = "Net · " + (state.period === ALL ? "All months" : monthLabel(state.period, true));
    $("sum-net").textContent = baht(net);
    $("sum-net").classList.toggle("neg", net < 0);
    $("sum-income").textContent = baht(s.income);
    $("sum-expense").textContent = baht(s.expense);
    $("sum-invest").textContent = baht(s.invest);

    // Average over months that have rows (an empty tab would drag it down).
    const n = state.period === ALL ? monthsWithData().length : 1;
    const avg = (v) => n > 1 ? baht(v / n) + " / month avg" : "";
    $("sub-income").textContent = avg(s.income);
    $("sub-expense").textContent = avg(s.expense);
    $("sub-net").textContent = avg(net);

    renderRing(s.income > 0 ? net / s.income : null);
    renderSpark();

    const warn = $("warn");
    warn.hidden = !s.unknownCount;
    warn.textContent = `⚠ ${s.unknownCount} transaction(s) have no known category (${baht(s.unknown, 2)}), not counted in totals.`;

    const partial = (state.period === ALL ? state.months : [state.period])
      .filter((m) => missingChannels(m).length && !(state.period === ALL && isEmpty(m)));
    const coverage = $("coverage");
    coverage.hidden = !partial.length;
    coverage.innerHTML = partial.map((m) => `<strong>⚠ ${monthLabel(m, true)}: ${esc(missingText(m))}</strong>`).join("") +
      (partial.length ? '<span class="muted">statement not imported yet — totals are incomplete</span>' : "");
  }

  function renderRing(rate) {
    const r = 34, c = 2 * Math.PI * r;
    const shown = rate === null ? 0 : Math.max(0, Math.min(1, rate));
    $("ring").innerHTML = `<svg viewBox="0 0 84 84" width="84" height="84" role="img" aria-label="Savings rate">
      <circle class="track" cx="42" cy="42" r="${r}" fill="none" stroke-width="8"/>
      <circle class="fill" cx="42" cy="42" r="${r}" fill="none" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - shown)}" transform="rotate(-90 42 42)"/>
      <text x="42" y="48" text-anchor="middle">${rate === null ? "–" : Math.round(rate * 100) + "%"}</text></svg>`;
  }

  // Net per month (months with data), as a small line + area.
  function renderSpark() {
    const el = $("spark");
    const ms = monthsWithData();
    const pts = ms.map((m) => { const s = monthSummary(m); return s.income - s.expense; });
    if (pts.length < 2) { el.innerHTML = ""; return; }
    const W = 300, H = 52, min = Math.min(0, ...pts), max = Math.max(...pts, 1);
    const x = (i) => (i / (pts.length - 1)) * W;
    const y = (v) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8);
    const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const sel = ms.indexOf(state.period);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--accent);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/>
      </linearGradient></defs>
      <path class="area" d="${line} L${W},${H} L0,${H} Z"/>
      <path class="line" d="${line}" vector-effect="non-scaling-stroke"/>
      ${sel >= 0 ? `<line class="mark" x1="${x(sel)}" x2="${x(sel)}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>` : ""}</svg>`;
  }

  function renderMonthly() {
    const el = $("monthly");
    const rows = state.months.map((m) => {
      const s = monthSummary(m);
      return { month: m, income: s.income, expense: s.expense, net: s.income - s.expense,
        partial: missingChannels(m).length > 0 };
    });
    if (!rows.length) { el.innerHTML = '<p class="empty">No month tabs yet.</p>'; return; }

    const W = Math.max(el.clientWidth, 300), H = 260;
    const pad = { l: 40, r: 4, t: 10, b: 44 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
    const min = Math.min(0, ...rows.flatMap((r) => [r.income, r.expense]));
    const step = niceStep((max - min) / 4);
    const top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step;
    const y = (v) => pad.t + ih - ((v - bottom) / (top - bottom)) * ih;

    const band = iw / rows.length;
    const barW = Math.max(4, Math.min(22, (band - 16) / 2));
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly income and expenses">`;
    for (let v = bottom; v <= top + 1e-9; v += step) {
      svg += `<line class="grid-line${v === 0 ? " zero" : ""}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
    }
    rows.forEach((r, i) => {
      const cx = pad.l + band * i + band / 2;
      const cls = state.period === ALL ? "" : state.period === r.month ? " sel" : " dim";
      svg += `<g class="month${cls}" data-month="${r.month}">`;
      svg += `<rect class="hit" x="${pad.l + band * i + 2}" y="${pad.t}" width="${band - 4}" height="${ih + pad.b - 4}" rx="10"/>`;
      svg += bar(cx - barW - 1, barW, y(Math.max(0, r.income)), y(Math.min(0, r.income)), "income");
      svg += bar(cx + 1, barW, y(Math.max(0, r.expense)), y(Math.min(0, r.expense)), "expense");
      svg += `<text class="axis" x="${cx}" y="${H - 26}" text-anchor="middle">${monthLabel(r.month)}</text>`;
      const note = isEmpty(r.month) ? "no data" : r.partial ? "⚠ partial" : "";
      if (note) svg += `<text class="partial" x="${cx}" y="${H - 10}" text-anchor="middle">${note}</text>`;
      svg += `</g>`;
    });
    svg += "</svg>";
    el.innerHTML = svg;

    el.querySelectorAll(".month").forEach((g) => {
      const r = rows.find((x) => x.month === g.dataset.month);
      g.addEventListener("mousemove", (e) => showTip(e,
        `<b>${monthLabel(r.month, true)}</b>` +
        `<div><i class="sw sw-income"></i>Income <span>${baht(r.income)}</span></div>` +
        `<div><i class="sw sw-expense"></i>Expenses <span>${baht(r.expense)}</span></div>` +
        `<div class="tip-net">Net <span>${baht(r.net)}</span></div>` +
        (r.partial ? `<div class="tip-warn">⚠ ${esc(missingText(r.month))}</div>` : "")));
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("click", () => { hideTip(); setPeriod(state.period === r.month ? ALL : r.month); });
    });
  }

  // A bar with a 4px rounded end away from the baseline.
  function bar(x, w, y0, y1, cls) {
    const h = y1 - y0;
    if (h < 0.5) return "";
    const r = Math.min(4, h, w / 2);
    return `<path class="bar-${cls}" d="M${x},${y1} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + w - r} Q${x + w},${y0} ${x + w},${y0 + r} V${y1} Z"/>`;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  function renderCategories(el, totals, kind) {
    const entries = Object.entries(totals).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { el.innerHTML = '<p class="empty">Nothing in this period.</p>'; return; }
    const sum = entries.reduce((a, [, v]) => a + v, 0);
    const max = Math.max(...entries.map(([, v]) => v));
    const open = state.catsOpen[kind] || entries.length <= TOP_CATS + 1;
    const shown = open ? entries : entries.slice(0, TOP_CATS);
    el.innerHTML = shown.map(([cat, v]) => `
      <button class="cat${state.category === cat ? " active" : ""}" data-cat="${esc(cat)}">
        <span class="ico" aria-hidden="true">${icon(cat)}</span>
        <span class="name">${esc(cat)}</span>
        <span class="val">${baht(v)}</span>
        <span class="bar"><span class="fill-${kind}" style="width:${max > 0 ? Math.max(0, (v / max) * 100) : 0}%"></span></span>
        <span class="pct">${sum > 0 ? Math.round((v / sum) * 100) : 0}%</span>
      </button>`).join("") +
      (entries.length > TOP_CATS + 1
        ? `<button class="more cats-more">${open ? "Show less" : `Show all ${entries.length}`}</button>` : "");
    el.querySelector(".cats-more")?.addEventListener("click", () => {
      state.catsOpen[kind] = !state.catsOpen[kind];
      render();
    });
    el.querySelectorAll(".cat").forEach((b) => b.addEventListener("click", () => {
      state.category = state.category === b.dataset.cat ? ALL : b.dataset.cat;
      update();
    }));
  }

  // Transactions grouped by day, newest first, like a banking app.
  function renderList(scoped) {
    const q = $("search").value.trim().toLowerCase();
    const hideTransfer = $("hide-transfer").checked;
    const rows = scoped
      .filter((tx) => state.category === ALL || tx.category === state.category)
      .filter((tx) => !(hideTransfer && kindOf(tx) === "Transfer" && state.category !== tx.category))
      .filter((tx) => !q || [tx.name, tx.category, tx.remark, tx.channel].some((f) => String(f).toLowerCase().includes(q)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const chip = $("clear-cat");
    chip.hidden = state.category === ALL;
    chip.textContent = `${icon(state.category)} ${state.category}  ✕`;
    $("tx-count").textContent = rows.length;

    const shown = rows.slice(0, state.limit);
    const spentByDay = {};
    for (const tx of rows) {
      if (kindOf(tx) === "Out") spentByDay[tx.date] = (spentByDay[tx.date] || 0) + (tx.out || 0) - (tx.in || 0);
    }

    let html = "", day = null;
    for (const tx of shown) {
      if (tx.date !== day) {
        day = tx.date;
        const spent = spentByDay[day];
        html += `<div class="day"><span>${esc(dayLabel(day))}</span><span>${spent ? baht(-spent) : ""}</span></div>`;
      }
      const kind = kindOf(tx);
      const isIn = (tx.in || 0) > 0;
      const amount = isIn ? "+" + baht(tx.in, 2) : baht(-(tx.out || 0), 2);
      const meta = [kind === "Unknown" ? `⚠ ${tx.category || "no category"}` : tx.category, tx.channel, tx.remark]
        .filter(Boolean).map(esc).join(" · ");
      html += `<div class="tx k-${kind.toLowerCase()}">
        <span class="ico" aria-hidden="true">${icon(tx.category)}</span>
        <span class="main"><span class="title">${esc(tx.name)}</span><span class="meta">${meta}</span></span>
        <span class="amt${isIn ? " in" : ""}">${amount}</span>
      </div>`;
    }
    $("tx-list").innerHTML = html || '<p class="empty">No transactions.</p>';
    const more = $("more");
    more.hidden = rows.length <= state.limit;
    more.textContent = `Show more (${rows.length - shown.length} left)`;
  }

  // Channel × month grid: rows per channel and month; the checkbox includes the channel.
  // Collapsed, only a one-line summary is shown.
  function renderSources() {
    const open = state.sourcesOpen;
    $("sources").hidden = !open;
    $("sources-tools").hidden = !open;
    $("sources-toggle").setAttribute("aria-expanded", open);
    $("sources-toggle").classList.toggle("closed", !open);
    const on = state.channels.filter(isOn).length;
    const gaps = state.months.reduce((n, m) => n + missingChannels(m).length, 0);
    $("sources-summary").textContent = open
      ? "rows per channel and month — untick to exclude"
      : `${on} of ${state.channels.length} channels` + (gaps ? ` · ${gaps} missing` : "");
    if (!open) return;

    const months = state.months;
    const count = {};
    for (const tx of state.txs) count[tx.channel + "|" + tx.month] = (count[tx.channel + "|" + tx.month] || 0) + 1;

    const head = months.map((m) =>
      `<th class="m${m === state.period ? " sel" : ""}" data-month="${m}">${monthLabel(m)}</th>`).join("");
    const body = state.allChannels.map(({ name, type }) => {
      const used = state.channels.includes(name);
      const on = isOn(name);
      const cells = months.map((m) => {
        const n = count[name + "|" + m];
        const sel = m === state.period ? " sel" : "";
        if (n) return `<td class="has${sel}" title="${esc(name)} · ${monthLabel(m, true)}: ${n} rows">${n}</td>`;
        if (isGap(name, m)) return `<td class="miss${sel}" title="${esc(name)} · ${monthLabel(m, true)}: no rows — statement not imported?">missing</td>`;
        if (used) return `<td class="quiet${sel}" title="${esc(name)} · ${monthLabel(m, true)}: no rows">–</td>`;
        return `<td class="none${sel}"></td>`;
      }).join("");
      return `<tr class="${on ? "" : "off"}${used ? "" : " unused"}">
        <th><label><input type="checkbox" data-ch="${esc(name)}"${on ? " checked" : ""}${used ? "" : " disabled"}>
          <span>${esc(name)}<small>${esc(type)}${used ? "" : " · no data yet"}</small></span></label></th>${cells}</tr>`;
    }).join("");
    $("sources").innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;

    $("sources").querySelectorAll("input[data-ch]").forEach((cb) => cb.addEventListener("change", () => {
      cb.checked ? state.excluded.delete(cb.dataset.ch) : state.excluded.add(cb.dataset.ch);
      update();
    }));
    $("sources").querySelectorAll("th.m").forEach((th) => th.addEventListener("click", () =>
      setPeriod(state.period === th.dataset.month ? ALL : th.dataset.month)));
  }

  // ---------- tooltip ----------

  function showTip(e, html) {
    const tip = $("tip");
    tip.innerHTML = html;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = e.clientY + 14 + "px";
  }
  const hideTip = () => { $("tip").hidden = true; };

  // ---------- load ----------

  async function load() {
    $("reload").classList.add("spin");
    try {
      const ref = await FinishSheets.loadReference();
      state.categoryType = Object.fromEntries(ref.categories.map((c) => [c.name, c.type]));
      state.months = (await FinishSheets.listMonths()).sort();
      const byMonth = await FinishSheets.loadMonths(state.months);
      state.txs = state.months.flatMap((m) => byMonth[m].map((tx) => ({ ...tx, month: m })));
      const used = new Set(state.txs.map((tx) => tx.channel));
      state.allChannels = ref.channels;
      state.channels = ref.channels.map((c) => c.name).filter((c) => used.has(c));
      if (state.period !== ALL && !state.months.includes(state.period)) state.period = ALL;

      $("signin").hidden = true;
      $("periods").hidden = false;
      $("reload").hidden = false;
      $("dash").hidden = false;
      render();
    } finally {
      $("reload").classList.remove("spin");
    }
  }

  function showError(e) {
    $("signin").hidden = false;
    $("dash").hidden = true;
    $("periods").hidden = true;
    $("reload").hidden = true;
    $("connect").hidden = false;
    $("status").textContent = e.message === "Not signed in"
      ? "Session expired — sign in again (no consent screen this time)."
      : "Error: " + e.message;
  }

  async function start() {
    $("connect").hidden = true;
    $("status").textContent = "Loading your sheet…";
    await load();
  }

  $("connect").addEventListener("click", async () => {
    try {
      $("status").textContent = "Signing in…";
      await FinishSheets.signIn();
      await start();
    } catch (e) {
      showError(e);
    }
  });
  $("reload").addEventListener("click", () => load().catch(showError));
  $("sources-toggle").addEventListener("click", () => { state.sourcesOpen = !state.sourcesOpen; render(); });
  $("sources-all").addEventListener("click", () => { state.excluded.clear(); update(); });
  $("sources-none").addEventListener("click", () => { state.excluded = new Set(state.channels); update(); });
  $("search").addEventListener("input", update);
  $("hide-transfer").addEventListener("change", update);
  $("clear-cat").addEventListener("click", () => { state.category = ALL; update(); });
  $("more").addEventListener("click", () => { state.limit += PAGE; render(); });

  restorePrefs();
  // Still signed in from earlier (token not expired): load straight away.
  if (FinishSheets.isSignedIn()) start().catch(showError);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$("dash").hidden) renderMonthly(); }, 150);
  });
})();
