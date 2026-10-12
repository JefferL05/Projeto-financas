/* Shared UI behavior: modal dismissal and a persistent informational footer. */
(() => {
  const closeLabels = new Set(["cancelar", "fechar"]);
  const closeGlyphs = new Set(["×", "✕", "✖", "x", "X"]);

  function installFooter() {
    let footer = document.querySelector("footer.diagnostic-footer, footer.app-info-footer");
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

  function closeAssociatedSurface(button) {
    const dialog = button.closest("dialog");
    if (dialog?.open) {
      dialog.close("cancel");
      return true;
    }

    const selector = button.getAttribute("data-close-target");
    if (selector) {
      const panel = document.querySelector(selector);
      if (panel) {
        panel.hidden = true;
        panel.classList.remove("active");
        return true;
      }
    }

    const dismissible = button.closest("[data-dismissible-panel]");
    if (dismissible) {
      dismissible.hidden = true;
      dismissible.classList.remove("active");
      return true;
    }
    return false;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    const label = (button.textContent || "").trim().toLocaleLowerCase("pt-BR");
    const ariaLabel = (button.getAttribute("aria-label") || "").trim().toLocaleLowerCase("pt-BR");
    const isCancel = closeLabels.has(label);
    const isCloseIcon = closeGlyphs.has((button.textContent || "").trim()) ||
      ariaLabel === "fechar" || button.hasAttribute("data-close-modal");

    if (!isCancel && !isCloseIcon) return;

    const dialog = button.closest("dialog");
    if (dialog?.open) {
      event.preventDefault();
      dialog.close("cancel");
      return;
    }

    if (button.hasAttribute("data-close-target") || button.closest("[data-dismissible-panel]")) {
      event.preventDefault();
      closeAssociatedSurface(button);
    }
    // Inline cancellation buttons keep their domain-specific handlers intact.
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFooter, { once: true });
  } else {
    installFooter();
  }
})();
