// Light / dark toggle. With no saved choice the page follows the OS; the toggle
// saves an explicit choice (this browser only). index.html applies it before paint.
(function () {
  const KEY = "finish.theme";
  const root = document.documentElement;
  const os = window.matchMedia("(prefers-color-scheme: dark)");
  const btn = document.getElementById("theme");
  const BAR = { light: "#f4f5f7", dark: "#08090c" };

  const current = () => root.dataset.theme || (os.matches ? "dark" : "light");

  function sync() {
    const t = current();
    const label = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.dataset.mode = t;
    // A saved choice overrides both media-specific theme-color metas.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.content = root.dataset.theme ? BAR[t] : BAR[m.media.includes("dark") ? "dark" : "light"];
    });
  }

  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    // Picking what the OS already shows clears the override, so OS changes apply again.
    if (next === (os.matches ? "dark" : "light")) {
      delete root.dataset.theme;
      try { localStorage.removeItem(KEY); } catch {}
    } else {
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch {}
    }
    sync();
  });
  os.addEventListener("change", sync);
  // Follow a choice made in another open tab.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    if (e.newValue === "light" || e.newValue === "dark") root.dataset.theme = e.newValue;
    else delete root.dataset.theme;
    sync();
  });
  sync();
})();
