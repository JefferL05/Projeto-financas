import {
  changeCredential,
  createProtectionWithRecovery,
  disableProtection,
  getAuthProfile,
  regenerateRecoveryCode,
  resetCredentialWithRecovery,
  updateAuthPreferences,
  verifyAccess
} from "./auth-service.js";
import { lockSession, unlockSession } from "./session.js";

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function field(labelText, input) {
  const wrapper = node("div", "auth-field");
  const label = node("label", "", labelText);
  label.htmlFor = input.id;
  wrapper.append(label, input);
  return wrapper;
}

function input(id, type, autocomplete) {
  const element = document.createElement("input");
  element.id = id;
  element.type = type;
  element.className = "auth-input";
  element.autocomplete = autocomplete;
  return element;
}

function errorRegion() {
  const region = node("div", "auth-error");
  region.setAttribute("role", "alert");
  region.setAttribute("aria-live", "assertive");
  return region;
}

function buildShell(title, subtitle) {
  const overlay = node("div", "auth-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const card = node("section", "auth-card");
  const flags = node("div", "auth-flags", "🇧🇷   🇵🇾");
  const brand = node("div", "auth-brand", "Projeto Finanças");
  const caption = node("p", "auth-caption", "Controle Brasil & Paraguai");
  const heading = node("h1", "auth-title", title);
  const info = node("p", "auth-subtitle", subtitle);
  card.append(flags, brand, caption, heading, info);
  overlay.append(card);
  document.body.append(overlay);
  return { overlay, card };
}

function addShowToggle(secretInput, card, label = "Mostrar senha") {
  const button = node("button", "auth-link", label);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    const visible = secretInput.type === "text";
    secretInput.type = visible ? "password" : "text";
    button.textContent = visible ? label : "Ocultar senha";
    button.setAttribute("aria-label", button.textContent);
  });
  card.append(button);
}

async function copyRecoveryCode(code, feedback) {
  try {
    await navigator.clipboard.writeText(code);
    feedback.textContent = "Código copiado. Guarde-o fora deste dispositivo.";
  } catch {
    feedback.textContent = "Não foi possível copiar automaticamente. Anote o código manualmente.";
  }
}

function showRecoveryCode(card, recoveryCode, onContinue, title = "Guarde seu código de recuperação") {
  card.querySelectorAll(".auth-form, .auth-link, .auth-footnote, .auth-recovery").forEach((element) => element.remove());
  const box = node("div", "auth-recovery");
  const heading = node("h2", "auth-title", title);
  const warning = node("p", "auth-subtitle", "Este código permite redefinir sua senha ou PIN. Ele será mostrado somente agora e não é salvo em texto puro.");
  const code = node("code", "auth-recovery-code", recoveryCode);
  code.id = "authRecoveryCode";
  const feedback = node("p", "auth-footnote", "Guarde em um local seguro, separado do aparelho.");
  feedback.setAttribute("aria-live", "polite");
  const copy = node("button", "auth-link", "Copiar código");
  copy.type = "button";
  copy.addEventListener("click", () => copyRecoveryCode(recoveryCode, feedback));
  const done = node("button", "auth-submit", "Já guardei, continuar");
  done.type = "button";
  done.addEventListener("click", onContinue);
  box.append(heading, warning, code, copy, feedback, done);
  card.append(box);
  done.focus();
}

async function setupScreen() {
  return new Promise((resolve) => {
    const { overlay, card } = buildShell("Proteja seus dados financeiros", "Crie uma proteção de acesso local. Seus dados continuam armazenados neste dispositivo.");
    const form = node("form", "auth-form");
    const username = input("authSetupUser", "text", "username");
    const method = document.createElement("select");
    method.id = "authSetupMethod";
    method.className = "auth-input";
    [["password", "Senha"], ["pin", "PIN numérico"]].forEach(([value, label]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = label; method.append(option);
    });
    const secret = input("authSetupSecret", "password", "new-password");
    const confirm = input("authSetupConfirm", "password", "new-password");
    const error = errorRegion();
    const submit = node("button", "auth-submit", "Criar acesso"); submit.type = "submit";
    form.append(field("Nome do usuário", username), field("Método", method), field("Senha ou PIN", secret), field("Confirmar", confirm), error, submit);
    card.append(form);
    addShowToggle(secret, card);
    card.append(node("p", "auth-footnote", "🔒 Este é um bloqueio local de privacidade, não autenticação de servidor."));

    method.addEventListener("change", () => {
      secret.inputMode = method.value === "pin" ? "numeric" : "text";
      confirm.inputMode = secret.inputMode;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      if (secret.value !== confirm.value) { error.textContent = "A confirmação não corresponde."; return; }
      submit.disabled = true;
      try {
        const { profile, recoveryCode } = await createProtectionWithRecovery({ username: username.value, secret: secret.value, method: method.value });
        secret.value = confirm.value = "";
        showRecoveryCode(card, recoveryCode, () => {
          unlockSession(profile);
          overlay.remove();
          resolve(profile);
        });
      } catch (err) {
        error.textContent = err?.message || "Não foi possível criar a proteção.";
        submit.disabled = false;
      }
    });
    queueMicrotask(() => username.focus());
  });
}

function showRecoveryForm({ card, overlay, profile, resolve }) {
  card.querySelectorAll(".auth-form, .auth-link, .auth-footnote, .auth-recovery").forEach((element) => element.remove());
  const form = node("form", "auth-form");
  const username = input("authRecoveryUser", "text", "username");
  username.value = profile.username;
  const recovery = input("authRecoveryInput", "text", "off");
  recovery.placeholder = "PF-XXXX-XXXX-XXXX-XXXX-XXXX";
  recovery.autocapitalize = "characters";
  const method = document.createElement("select");
  method.id = "authRecoveryMethod";
  method.className = "auth-input";
  [["password", "Nova senha"], ["pin", "Novo PIN"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; method.append(option);
  });
  const secret = input("authRecoverySecret", "password", "new-password");
  const confirm = input("authRecoveryConfirm", "password", "new-password");
  const error = errorRegion();
  const submit = node("button", "auth-submit", "Redefinir acesso"); submit.type = "submit";
  const cancel = node("button", "auth-link", "Voltar ao login"); cancel.type = "button";
  form.append(field("Usuário", username), field("Código de recuperação", recovery), field("Novo método", method), field("Nova senha ou PIN", secret), field("Confirmar nova credencial", confirm), error, submit);
  card.append(form, cancel, node("p", "auth-footnote", "A recuperação é totalmente local. Não existe envio por e-mail, SMS ou WhatsApp."));
  addShowToggle(secret, card);

  method.addEventListener("change", () => {
    secret.inputMode = method.value === "pin" ? "numeric" : "text";
    confirm.inputMode = secret.inputMode;
  });
  cancel.addEventListener("click", () => { overlay.remove(); loginScreen(profile).then(resolve); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (secret.value !== confirm.value) { error.textContent = "A confirmação não corresponde."; return; }
    submit.disabled = true;
    try {
      const result = await resetCredentialWithRecovery({
        username: username.value,
        recoveryCode: recovery.value,
        newSecret: secret.value,
        method: method.value
      });
      secret.value = confirm.value = recovery.value = "";
      showRecoveryCode(card, result.recoveryCode, () => {
        unlockSession(result.profile);
        overlay.remove();
        resolve(result.profile);
      }, "Novo código de recuperação");
    } catch (err) {
      error.textContent = err?.message || "Não foi possível recuperar o acesso.";
      submit.disabled = false;
      recovery.focus();
    }
  });
  recovery.focus();
}

async function loginScreen(profile) {
  return new Promise((resolve) => {
    const { overlay, card } = buildShell("Bem-vindo de volta", "Seus dados financeiros permanecem armazenados neste dispositivo.");
    const form = node("form", "auth-form");
    const username = input("authLoginUser", "text", "username"); username.value = profile.username;
    const secret = input("authLoginSecret", "password", "current-password");
    if (profile.method === "pin") secret.inputMode = "numeric";
    const error = errorRegion();
    const submit = node("button", "auth-submit", "Entrar"); submit.type = "submit";
    const forgot = node("button", "auth-link", "Esqueci minha senha"); forgot.type = "button";
    form.append(field("Usuário", username), field(profile.method === "pin" ? "PIN" : "Senha", secret), error, submit);
    card.append(form);
    addShowToggle(secret, card);
    card.append(forgot, node("p", "auth-footnote", "🔑 Esqueceu? Use o código de recuperação salvo no primeiro acesso."));

    let failures = 0;
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); error.textContent = ""; submit.disabled = true;
      const delay = failures >= 3 ? Math.min(5000, (failures - 2) * 750) : 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const result = await verifyAccess({ username: username.value, secret: secret.value });
        secret.value = "";
        if (!result.ok) { failures += 1; error.textContent = "Senha ou PIN incorreto."; secret.focus(); return; }
        unlockSession(result.profile);
        overlay.remove();
        resolve(result.profile);
      } catch { error.textContent = "Não foi possível validar o acesso."; }
      finally { submit.disabled = false; }
    });
    forgot.addEventListener("click", () => showRecoveryForm({ card, overlay, profile, resolve }));
    queueMicrotask(() => secret.focus());
  });
}

export async function presentAccessGate(profile = null) {
  return profile ? loginScreen(profile) : setupScreen();
}

export async function mountSecuritySettings(container) {
  if (!container || document.getElementById("authSecurityCard")) return;
  const profile = await getAuthProfile();
  if (!profile) return;
  const card = node("article", "card"); card.id = "authSecurityCard";
  card.append(node("h2", "", "Segurança e privacidade"));
  const status = node("p", "muted", `Proteção de acesso: ativada · Método: ${profile.method === "pin" ? "PIN" : "Senha"}`);
  const select = document.createElement("select"); select.className = "input"; select.id = "authAutoLock";
  [[0,"Nunca"],[1,"1 minuto"],[5,"5 minutos"],[15,"15 minutos"],[30,"30 minutos"]].forEach(([value,label]) => { const option=document.createElement("option");option.value=String(value);option.textContent=label;select.append(option); });
  select.value = String(profile.autoLockMinutes ?? 5);
  const actions = node("div", "button-stack");
  const lock = node("button", "btn btn-secondary", "Bloquear agora"); lock.type = "button";
  const change = node("button", "btn btn-secondary", "Alterar senha/PIN"); change.type = "button";
  const recovery = node("button", "btn btn-secondary", "Gerar novo código de recuperação"); recovery.type = "button";
  const disable = node("button", "btn btn-danger", "Desativar proteção"); disable.type = "button";
  actions.append(lock, change, recovery, disable);
  card.append(status, field("Bloqueio automático", select), actions);
  container.append(card);

  select.addEventListener("change", async () => { await updateAuthPreferences({ autoLockMinutes: Number(select.value), hideSensitiveNotificationsWhenLocked: true }); });
  lock.addEventListener("click", () => { lockSession(); location.reload(); });
  change.addEventListener("click", async () => {
    const current = prompt("Digite sua senha/PIN atual:"); if (current === null) return;
    const next = prompt("Digite a nova senha (mín. 8 caracteres) ou novo PIN (4–8 dígitos):"); if (next === null) return;
    const method = /^\d{4,8}$/.test(next) ? "pin" : "password";
    try { await changeCredential({ currentSecret: current, newSecret: next, method }); alert("Credencial alterada."); location.reload(); }
    catch (err) { alert(err?.message || "Não foi possível alterar."); }
  });
  recovery.addEventListener("click", async () => {
    const current = prompt("Digite sua senha/PIN atual para gerar um novo código:"); if (current === null) return;
    try {
      const result = await regenerateRecoveryCode(current);
      const message = `Novo código de recuperação:\n\n${result.recoveryCode}\n\nGuarde-o em local seguro. O código anterior foi invalidado.`;
      alert(message);
    } catch (err) { alert(err?.message || "Não foi possível gerar o código."); }
  });
  disable.addEventListener("click", async () => {
    const current = prompt("Digite sua senha/PIN atual para desativar a proteção:"); if (current === null) return;
    try { await disableProtection(current); lockSession(); alert("Proteção local desativada."); location.reload(); }
    catch (err) { alert(err?.message || "Não foi possível desativar."); }
  });
}