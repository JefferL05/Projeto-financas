/* Shared UI behavior: consistent dismissal, theme controls and informational footer. */
(() => {
  const root = document.documentElement;
  const cancelPattern = /^cancelar(?:\\b|$)/i;
  const closePattern = /^(?:fechar|close|dispensar)(?:\\b|$)/i;
  const closeGlyphs = new Set(["×", "✕", "✖", "✗", "x", "X"]);

  function installFooter() {
    let footer = document.querySelector("footer.app-info-footer, footer.diagnostic-footer");
    if (!footer) {
      footer = document.createElement("footer");
      footer.className = "app-info-footer";
      document.body.appendChild(footer);
    } else {
      footer.classList.add("app-info-footer");
    }

    if (!footer.querySelector("[data-footer-note]")) {
      const note = document.createElement("span");
      note.dataset.footerNote = "true";
      note.textContent = "Projeto Finanças · Dados financeiros armazenados neste navegador. Faça backups regularmente.";
      footer.appendChild(note);
    }
    footer.setAttribute("role", "contentinfo");
  }

  function setTheme(theme) {
    const light = theme === "light";
    root.dataset.theme = light ? "light" : "dark";
    document.querySelectorAll("#themeToggleBtn").forEach((button) => {
      button.textContent = light ? "🌙 Tema escuro" : "☀️ Tema claro";
      button.setAttribute("aria-label", light ? "Ativar tema escuro" : "Ativar tema claro");
      button.setAttribute("aria-pressed", String(light));
    });
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", light ? "#f5f8fb" : "#0a1018");
    try {
      localStorage.setItem("pf-theme", light ? "light" : "dark");
    } catch {
      // The theme still changes for the current session if storage is unavailable.
    }
  }

  function installThemeFallback() {
    let saved = "dark";
    try { saved = localStorage.getItem("pf-theme") || "dark"; } catch { /* ignore */ }
    setTheme(saved);

    // The dashboard has its own controller; only bind here if no controller marked the button.
    document.querySelectorAll("#themeToggleBtn").forEach((button) => {
      if (button.dataset.sharedThemeBound === "true") return;
      button.dataset.sharedThemeBound = "true";
      button.addEventListener("click", () => {
        setTheme(root.dataset.theme === "light" ? "dark" : "light");
      });
    });
  }

  function hideSurface(surface) {
    if (!surface) return false;
    if (surface instanceof HTMLDialogElement) {
      if (surface.open) surface.close("cancel");
      return true;
    }
    surface.classList.remove("active", "open", "show", "visible");
    surface.setAttribute("aria-hidden", "true");
    surface.hidden = true;
    return true;
  }

  function closeAssociatedSurface(button, closeTab = false) {
    const selector = button.getAttribute("data-close-target") || button.getAttribute("aria-controls");
    if (selector) {
      const target = document.getElementById(selector.replace(/^#/, "")) || document.querySelector(selector);
      if (target && hideSurface(target)) return true;
    }

    const dialog = button.closest("dialog, [role='dialog'], [aria-modal='true'], .modal-overlay, .modal, .drawer, .sheet, [data-modal]");
    if (dialog && hideSurface(dialog)) return true;

    const dismissible = button.closest("[data-dismissible-panel]");
    if (dismissible && hideSurface(dismissible)) return true;

    // X/close controls inside a tab can dismiss that tab and activate the first remaining tab.
    if (closeTab) {
      const panel = button.closest(".intel-view, .fm-panel, .view");
      if (panel) {
        const nav = panel.parentElement?.querySelector("[data-tab], [data-fm-tab], [data-view]");
        if (!nav) return false;
        const activeSelector = panel.classList.contains("fm-panel") ? "[data-fm-tab]" :
          panel.classList.contains("view") ? "[data-view]" : "[data-tab]";
        const tabButtons = [...document.querySelectorAll(activeSelector)];
        const panelPrefix = panel.id.startsWith("fm-panel-") ? "fm-panel-" :
          panel.id.startsWith("tab-") ? "tab-" : "view-";
        const tabName = panel.id.startsWith(panelPrefix) ? panel.id.slice(panelPrefix.length) : "";
        const currentButton = tabButtons.find((item) =>
          (item.dataset.tab || item.dataset.fmTab || item.dataset.view) === tabName
        );
        if (currentButton) currentButton.classList.remove("active");
        panel.hidden = true;
        panel.classList.remove("active");
        const next = tabButtons.find((item) => item !== currentButton);
        if (next) next.click();
        return true;
      }
    }
    return false;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    const label = (button.textContent || "").trim();
    const ariaLabel = (button.getAttribute("aria-label") || "").trim();
    const title = (button.getAttribute("title") || "").trim();
    const isCancel = cancelPattern.test(label);
    const isCloseIcon = closeGlyphs.has(label) ||
      closePattern.test(ariaLabel) || closePattern.test(title) ||
      button.hasAttribute("data-close-modal") ||
      button.hasAttribute("data-close-target");

    if (!isCancel && !isCloseIcon) return;

    const dialog = button.closest("dialog");
    if (dialog?.open) {
      event.preventDefault();
      dialog.close("cancel");
      return;
    }

    // Keep the domain-specific action for ordinary Cancel buttons; only close
    // non-dialog surfaces when the button explicitly targets one.
    if (button.hasAttribute("data-close-target") || button.hasAttribute("data-close-modal") ||
        button.closest("[data-dismissible-panel]") ||
        button.closest("[role='dialog'], [aria-modal='true'], .modal-overlay, .modal, .drawer, .sheet, [data-modal]")) {
      event.preventDefault();
      closeAssociatedSurface(button, isCloseIcon && !isCancel);
      return;
    }

    if (isCloseIcon) {
      const closed = closeAssociatedSurface(button, true);
      if (closed) event.preventDefault();
    }
  });

  const boot = () => {
    installFooter();
    installThemeFallback();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
