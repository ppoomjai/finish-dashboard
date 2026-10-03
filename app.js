// Income / expense dashboard over the month tabs of the sheet (read-only).
// Totals follow the category Type: Out → out − in, In → in − out,
// Invest → shown separately, Transfer → excluded.
(function () {
  const $ = (id) => document.getElementById(id);
  const ALL = "";

  const state = {
    categoryType: {},   // category name → Out / In / Invest / Transfer
    months: [],         // "YYYY-MM", oldest first
    channels: [],       // channels that have rows in any month
    allChannels: [],    // every channel in the channel tab: { name, type }
    excluded: new Set(), // channels unticked in Sources
    txs: [],            // every transaction, with .month
    period: ALL,        // always opens on All months
    category: ALL,
  };

  // ---------- remembered choices (this browser only) ----------

  const PREFS = "finish.prefs";
  function restorePrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS));
      if (!p) return;
      state.excluded = new Set(p.excluded || []);
      $("hide-transfer").checked = p.hideTransfer ?? true;
    } catch {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({
        excluded: [...state.excluded], hideTransfer: $("hide-transfer").checked,
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

  // ---------- render ----------

  function render() {
    const scoped = state.txs.filter((tx) => inChannel(tx) && inPeriod(tx));
    const s = summarize(scoped);
    renderCards(s);
    renderMonthly();
    renderSources();
    renderCategoryBars($("by-expense"), s.byExpense, "expense");
    renderCategoryBars($("by-income"), s.byIncome, "income");
    renderTable(scoped);
    savePrefs();
  }

  function renderCards(s) {
    const net = s.income - s.expense;
    $("sum-income").textContent = baht(s.income);
    $("sum-expense").textContent = baht(s.expense);
    $("sum-net").textContent = baht(net);
    $("sum-net").className = net < 0 ? "neg" : "";
    $("sum-rate").textContent = s.income > 0 ? Math.round((net / s.income) * 100) + "%" : "–";
    $("sum-invest").textContent = baht(s.invest);

    // Average over months that have rows (an empty tab would drag it down).
    const n = state.period === ALL ? new Set(state.txs.filter(inChannel).map((tx) => tx.month)).size : 1;
    const per = n > 1 ? " / month avg" : "";
    $("sub-income").textContent = n > 1 ? baht(s.income / n) + per : "";
    $("sub-expense").textContent = n > 1 ? baht(s.expense / n) + per : "";
    $("sub-net").textContent = n > 1 ? baht(net / n) + per : "";

    const warn = $("warn");
    warn.hidden = !s.unknownCount;
    warn.textContent = `⚠ ${s.unknownCount} transaction(s) have no known category (${baht(s.unknown, 2)}), not counted in totals.`;

    const partial = (state.period === ALL ? state.months : [state.period])
      .filter((m) => missingChannels(m).length && !(state.period === ALL && isEmpty(m)));
    const coverage = $("coverage");
    coverage.hidden = !partial.length;
    coverage.innerHTML = partial.map((m) =>
      `<span class="tag tag-warn">⚠ ${monthLabel(m, true)}: ${esc(missingText(m))}</span>`).join("") +
      (partial.length ? '<span class="muted">statement not imported yet — totals are incomplete</span>' : "");
  }

  function renderMonthly() {
    const el = $("monthly");
    const rows = state.months.map((m) => {
      const s = summarize(state.txs.filter((tx) => tx.month === m && inChannel(tx)));
      return { month: m, income: s.income, expense: s.expense, net: s.income - s.expense,
        partial: missingChannels(m).length > 0 };
    });
    if (!rows.length) { el.innerHTML = '<p class="empty">No month tabs yet.</p>'; return; }

    const W = Math.max(el.clientWidth, 300), H = 256;
    const pad = { l: 44, r: 8, t: 10, b: 42 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
    const min = Math.min(0, ...rows.flatMap((r) => [r.income, r.expense]));
    const step = niceStep((max - min) / 4);
    const top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step;
    const y = (v) => pad.t + ih - ((v - bottom) / (top - bottom)) * ih;

    const band = iw / rows.length;
    const barW = Math.min(28, (band - 12) / 2);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly income and expenses">`;
    for (let v = bottom; v <= top + 1e-9; v += step) {
      svg += `<line class="grid-line${v === 0 ? " zero" : ""}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
    }
    rows.forEach((r, i) => {
      const cx = pad.l + band * i + band / 2;
      const dim = state.period !== ALL && state.period !== r.month ? " dim" : "";
      svg += `<g class="month${dim}" data-month="${r.month}">`;
      svg += `<rect class="hit" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${ih + pad.b}"/>`;
      svg += bar(cx - barW - 1, barW, y(Math.max(0, r.income)), y(Math.min(0, r.income)), "income");
      svg += bar(cx + 1, barW, y(Math.max(0, r.expense)), y(Math.min(0, r.expense)), "expense");
      svg += `<text class="axis" x="${cx}" y="${H - 24}" text-anchor="middle">${monthLabel(r.month)}</text>`;
      const note = isEmpty(r.month) ? "no data" : r.partial ? "⚠ partial" : "";
      if (note) svg += `<text class="partial" x="${cx}" y="${H - 8}" text-anchor="middle">${note}</text>`;
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
      g.addEventListener("click", () => {
        state.period = state.period === r.month ? ALL : r.month;
        $("period").value = state.period;
        render();
      });
    });
  }

  // Channel × month grid: rows per channel and month; the checkbox includes the channel.
  function renderSources() {
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
      render();
    }));
    $("sources").querySelectorAll("th.m").forEach((th) => th.addEventListener("click", () => {
      state.period = state.period === th.dataset.month ? ALL : th.dataset.month;
      $("period").value = state.period;
      render();
    }));
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

  function renderCategoryBars(el, totals, kind) {
    const entries = Object.entries(totals).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { el.innerHTML = '<p class="empty">Nothing in this period.</p>'; return; }
    const sum = entries.reduce((a, [, v]) => a + v, 0);
    const max = Math.max(...entries.map(([, v]) => v));
    el.innerHTML = entries.map(([cat, v]) => `
      <button class="cat-row${state.category === cat ? " active" : ""}" data-cat="${esc(cat)}">
        <span class="line"><span>${esc(cat)}</span><span>${baht(v)} <small>${sum > 0 ? Math.round((v / sum) * 100) : 0}%</small></span></span>
        <span class="bar"><span class="fill-${kind}" style="width:${max > 0 ? Math.max(0, (v / max) * 100) : 0}%"></span></span>
      </button>`).join("");
    el.querySelectorAll(".cat-row").forEach((b) => b.addEventListener("click", () => {
      state.category = state.category === b.dataset.cat ? ALL : b.dataset.cat;
      render();
    }));
  }

  function renderTable(scoped) {
    const q = $("search").value.trim().toLowerCase();
    const hideTransfer = $("hide-transfer").checked;
    const rows = scoped
      .filter((tx) => state.category === ALL || tx.category === state.category)
      .filter((tx) => !(hideTransfer && kindOf(tx) === "Transfer" && state.category !== tx.category))
      .filter((tx) => !q || [tx.name, tx.category, tx.remark, tx.channel].some((f) => String(f).toLowerCase().includes(q)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const chip = $("clear-cat");
    chip.hidden = state.category === ALL;
    chip.textContent = state.category + " ✕";
    $("tx-count").textContent = `(${rows.length})`;

    $("tx-table").tBodies[0].innerHTML = rows.length ? rows.map((tx) => {
      const kind = kindOf(tx);
      return `<tr class="k-${kind.toLowerCase()}">
        <td class="date">${esc(tx.date)}</td>
        <td>${esc(tx.name)}${tx.remark ? `<small>${esc(tx.remark)}</small>` : ""}</td>
        <td><span class="tag">${esc(tx.category || "—")}</span></td>
        <td class="muted">${esc(tx.channel)}</td>
        <td class="num">${tx.in ? baht(tx.in, 2) : ""}</td>
        <td class="num">${tx.out ? baht(tx.out, 2) : ""}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="6" class="empty">No transactions.</td></tr>';
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
    const status = $("status");
    status.hidden = false;
    status.textContent = "Loading sheet…";
    const ref = await FinishSheets.loadReference();
    state.categoryType = Object.fromEntries(ref.categories.map((c) => [c.name, c.type]));
    state.months = (await FinishSheets.listMonths()).sort();
    const byMonth = await FinishSheets.loadMonths(state.months);
    state.txs = state.months.flatMap((m) => byMonth[m].map((tx) => ({ ...tx, month: m })));
    const used = new Set(state.txs.map((tx) => tx.channel));
    state.allChannels = ref.channels;
    state.channels = ref.channels.map((c) => c.name).filter((c) => used.has(c));

    const period = $("period");
    period.innerHTML = `<option value="">All months</option>` +
      [...state.months].reverse().map((m) =>
        `<option value="${m}">${monthLabel(m, true)}${missingChannels(m).length ? " ⚠" : ""}</option>`).join("");
    if (!state.months.includes(state.period)) state.period = ALL;
    period.value = state.period;

    status.hidden = true;
    $("filters").hidden = false;
    $("dash").hidden = false;
    render();
  }

  function showError(e) {
    const status = $("status");
    status.hidden = false;
    if (e.message === "Not signed in") {
      status.textContent = "Session expired — sign in again (no consent screen this time).";
      $("connect").hidden = false;
      $("reload").hidden = true;
    } else {
      status.textContent = "Error: " + e.message;
    }
  }

  async function start() {
    $("connect").hidden = true;
    $("reload").hidden = false;
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
  $("period").addEventListener("change", (e) => { state.period = e.target.value; render(); });
  $("sources-all").addEventListener("click", () => { state.excluded.clear(); render(); });
  $("sources-none").addEventListener("click", () => { state.excluded = new Set(state.channels); render(); });
  $("search").addEventListener("input", () => render());
  $("hide-transfer").addEventListener("change", () => render());
  $("clear-cat").addEventListener("click", () => { state.category = ALL; render(); });

  restorePrefs();
  // Still signed in from earlier (token not expired): load straight away.
  if (FinishSheets.isSignedIn()) start().catch(showError);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$("dash").hidden) renderMonthly(); }, 150);
  });
})();
