/* Shared theme controller for standalone pages; financial data remains in IndexedDB. */
(() => {
  const root = document.documentElement;
  const button = document.querySelector("#themeToggleBtn");
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  let theme = "dark";
  try {
    theme = localStorage.getItem("pf-theme") || "dark";
  } catch {
    // Keep the app usable if preference storage is unavailable.
  }

  const applyTheme = (value) => {
    const light = value === "light";
    root.dataset.theme = light ? "light" : "dark";
    if (button) {
      button.textContent = light ? "🌙 Tema escuro" : "☀️ Tema claro";
      button.setAttribute("aria-label", light ? "Ativar tema escuro" : "Ativar tema claro");
      button.setAttribute("aria-pressed", String(light));
    }
    if (metaTheme) metaTheme.setAttribute("content", light ? "#f5f8fb" : "#0a1018");
  };

  applyTheme(theme);
  button?.addEventListener("click", () => {
    theme = root.dataset.theme === "light" ? "dark" : "light";
    applyTheme(theme);
    try {
      localStorage.setItem("pf-theme", theme);
    } catch {
      // The selected theme still applies for this session.
    }
  });
})();
