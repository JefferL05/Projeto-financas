import { getAuthProfile } from "./auth-service.js";
import { mountSecuritySettings, presentAccessGate } from "./auth-ui.js";
import { isSessionUnlocked, lockSession, startAutoLock } from "./session.js";

let released = false;
let authenticating = false;

function ensureStylesheet() {
  if (document.querySelector('link[data-auth-style="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../../css/auth.css", import.meta.url).href;
  link.dataset.authStyle = "true";
  document.head.append(link);
}

async function authenticateAndRelease() {
  if (authenticating) return;
  authenticating = true;
  try {
    let profile = await getAuthProfile();
    if (!profile || !isSessionUnlocked(profile)) {
      lockSession();
      profile = await presentAccessGate(profile);
    }

    startAutoLock(profile, () => location.reload());
    released = true;
    document.documentElement.classList.remove("auth-pending");
    document.removeEventListener("DOMContentLoaded", interceptReady, true);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    setTimeout(() => {
      const container = document.querySelector("#view-settings .settings-grid");
      if (container) void mountSecuritySettings(container);
    }, 0);
  } catch {
    const message = document.createElement("div");
    message.className = "auth-fatal";
    message.textContent = "Não foi possível iniciar a proteção local. Recarregue a página.";
    document.body.append(message);
  }
}

function interceptReady(event) {
  if (released) return;
  event.stopImmediatePropagation();
  ensureStylesheet();
  void authenticateAndRelease();
}

if (typeof document !== "undefined") {
  document.documentElement.classList.add("auth-pending");
  ensureStylesheet();
  document.addEventListener("DOMContentLoaded", interceptReady, true);
}