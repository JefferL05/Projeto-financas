/* Shared UI behavior: consistent dismissal and a persistent informational footer. */
(() => {
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
      const target = document.getElementById(selector.replace(/^#/, ""));
      if (target && hideSurface(target)) return true;
    }

    const dialog = button.closest("dialog, [role='dialog'], [aria-modal='true'], .modal-overlay, .modal, .drawer, .sheet, [data-modal]");
    if (dialog && hideSurface(dialog)) return true;

    const dismissible = button.closest("[data-dismissible-panel]");
    if (dismissible && hideSurface(dismissible)) return true;

    // An explicit X inside a tab panel closes that panel and selects a remaining tab.
    if (closeTab) {
      const panel = button.closest(".intel-view, .fm-panel, .view");
      if (panel) {
        const activeSelector = panel.classList.contains("fm-panel") ? "[data-fm-tab]" :
          panel.classList.contains("view") ? "[data-view]" : "[data-tab]";
        const tabButtons = [...document.querySelectorAll(activeSelector)];
        const panelPrefix = panel.id.startsWith("fm-panel-") ? "fm-panel-" :
          panel.id.startsWith("tab-") ? "tab-" : "view-";
        const tabName = panel.id.startsWith(panelPrefix) ? panel.id.slice(panelPrefix.length) : "";
        const currentButton = tabButtons.find((item) =>
          (item.dataset.tab || item.dataset.fmTab || item.dataset.view) === tabName
        );
        if (!currentButton) return false;
        currentButton.classList.remove("active");
        currentButton.removeAttribute("aria-current");
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

    const hasExplicitSurface = button.hasAttribute("data-close-target") ||
      button.hasAttribute("data-close-modal") ||
      button.closest("[data-dismissible-panel], [role='dialog'], [aria-modal='true'], .modal-overlay, .modal, .drawer, .sheet, [data-modal]");

    if (hasExplicitSurface) {
      event.preventDefault();
      closeAssociatedSurface(button, isCloseIcon && !isCancel);
      return;
    }

    if (isCloseIcon && closeAssociatedSurface(button, true)) {
      event.preventDefault();
    }
    // Ordinary Cancel buttons keep their domain-specific handlers.
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFooter, { once: true });
  } else {
    installFooter();
  }
})();
