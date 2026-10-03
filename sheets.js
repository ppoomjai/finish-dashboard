// Google Sheets connector: OAuth sign-in (Google Identity Services) + Sheets API v4.
// Requires https://accounts.google.com/gsi/client and config.js to be loaded first.
(function () {
  const API = "https://sheets.googleapis.com/v4/spreadsheets/";
  const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
  const cfg = window.FINISH_CONFIG;

  // The access token (valid ~1 h) is kept in localStorage so a reload or a new tab
  // within that hour needs no sign-in. After the first consent, signing in again
  // skips the consent screen.
  const STORE = "finish.token";
  const CONSENTED = "finish.consented";
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let token = null;
  let expiresAt = 0;
  let tokenClient = null;

  try {
    const saved = JSON.parse(storage.get(STORE));
    if (saved && saved.expiresAt > Date.now() + 60_000) ({ token, expiresAt } = saved);
  } catch {}

  function forget() {
    token = null;
    expiresAt = 0;
    storage.del(STORE);
  }

  function signIn() {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error("Google Identity Services script not loaded"));
        return;
      }
      tokenClient ??= google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: SCOPE,
        callback: () => {},
      });
      tokenClient.callback = (res) => {
        if (res.error) return reject(new Error(res.error_description || res.error));
        token = res.access_token;
        expiresAt = Date.now() + Number(res.expires_in || 3600) * 1000;
        storage.set(STORE, JSON.stringify({ token, expiresAt }));
        storage.set(CONSENTED, "1");
        resolve();
      };
      tokenClient.error_callback = (err) => reject(new Error(err.message || err.type));
      tokenClient.requestAccessToken({ prompt: storage.get(CONSENTED) ? "" : "consent" });
    });
  }

  function signOut() {
    if (token) google.accounts.oauth2.revoke(token);
    forget();
    storage.del(CONSENTED);
  }

  async function call(path, options = {}) {
    if (!token || Date.now() > expiresAt) {
      forget();
      throw new Error("Not signed in");
    }
    const res = await fetch(API + cfg.spreadsheetId + path, {
      ...options,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    });
    if (res.status === 401) {
      forget();
      throw new Error("Not signed in");
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message || res.statusText);
    return body;
  }

  // Rows below the header, with trailing blank rows dropped.
  function rowsOf(valueRange) {
    return (valueRange.values || []).slice(1).filter((r) => r.some((c) => c !== ""));
  }

  function num(v) {
    if (v === undefined || v === "") return undefined;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isNaN(n) ? undefined : n;
  }

  const parse = {
    category: (r) => ({ name: r[0], type: r[1], description: r[2] || "" }),
    channel: (r) => ({ name: r[0], type: r[1] }),
    merchant: (r) => ({ name: r[0], category: r[1] || "" }),
    transaction: (r) => ({
      date: r[0], channel: r[1], name: r[2],
      in: num(r[3]), out: num(r[4]),
      category: r[5] || "", remark: r[6] || "",
    }),
  };

  // Tab names like "2026-09" must be quoted in A1 ranges.
  const rangeOf = (tab, cols) => `'${tab.replace(/'/g, "''")}'!${cols}`;

  // One transaction tab per month, named YYYY-MM.
  const MONTH_TAB = /^\d{4}-\d{2}$/;
  const monthOf = (date) => String(date).slice(0, 7);

  async function sheetTitles() {
    const { sheets } = await call("?fields=sheets.properties(sheetId,title)");
    return sheets.map((s) => s.properties);
  }

  // Month tabs that exist in the spreadsheet, newest first.
  async function listMonths() {
    return (await sheetTitles()).map((p) => p.title).filter((t) => MONTH_TAB.test(t)).sort().reverse();
  }

  // Categories, channels and merchants.
  async function loadReference() {
    const t = cfg.tabs;
    const ranges = [rangeOf(t.category, "A:C"), rangeOf(t.channel, "A:B"), rangeOf(t.merchant, "A:B")];
    const query = ranges.map((r) => "ranges=" + encodeURIComponent(r)).join("&");
    const { valueRanges } = await call("/values:batchGet?" + query);
    return {
      categories: rowsOf(valueRanges[0]).map(parse.category),
      channels: rowsOf(valueRanges[1]).map(parse.channel),
      merchants: rowsOf(valueRanges[2]).map(parse.merchant),
    };
  }

  // Transactions of one month ("YYYY-MM"); empty if that month has no tab yet.
  async function loadMonth(month) {
    if (!(await listMonths()).includes(month)) return [];
    const range = encodeURIComponent(rangeOf(month, "A:G"));
    return rowsOf(await call(`/values/${range}`)).map(parse.transaction);
  }

  // Transactions of several existing month tabs in one request: { "YYYY-MM": [tx, …] }.
  async function loadMonths(months) {
    if (!months.length) return {};
    const query = months.map((m) => "ranges=" + encodeURIComponent(rangeOf(m, "A:G"))).join("&");
    const { valueRanges } = await call("/values:batchGet?" + query);
    return Object.fromEntries(months.map((m, i) => [m, rowsOf(valueRanges[i]).map(parse.transaction)]));
  }

  // Creates the month tab by duplicating the template, if it does not exist yet.
  async function ensureMonthTab(month) {
    const props = await sheetTitles();
    if (props.some((p) => p.title === month)) return;
    const template = props.find((p) => p.title === cfg.tabs.template);
    if (!template) throw new Error(`Template tab "${cfg.tabs.template}" not found`);
    await call(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ duplicateSheet: { sourceSheetId: template.sheetId, newSheetName: month } }],
      }),
    });
  }

  // tx.date is "YYYY-MM-DD"; the row goes to that month's tab.
  async function appendTransaction(tx) {
    const month = monthOf(tx.date);
    if (!MONTH_TAB.test(month)) throw new Error("Date must be YYYY-MM-DD");
    await ensureMonthTab(month);
    const row = [tx.date, tx.channel, tx.name, tx.in ?? "", tx.out ?? "", tx.category ?? "", tx.remark ?? ""];
    const range = encodeURIComponent(rangeOf(month, "A:G"));
    return call(`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values: [row] }),
    });
  }

  window.FinishSheets = {
    signIn, signOut, isSignedIn: () => !!token && Date.now() < expiresAt,
    loadReference, listMonths, loadMonth, loadMonths, appendTransaction,
  };
})();
