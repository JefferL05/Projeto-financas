import { formatMoney } from "../utils.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatMetric(item) {
  if (item.currency) return formatMoney(item.value, item.currency) + (item.approximate ? " (aprox.)" : "");
  if (item.unit === "%") return `${Number(item.value || 0).toFixed(1)}%`;
  return String(item.value ?? "—");
}

export function appendUserMessage(container, text) {
  const msg = el("div", "msg user", text);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

export function appendAssistantResponse(container, response, { mode = "Análise local" } = {}) {
  const wrapper = el("div", "msg bot structured-message");
  const head = el("div", "response-head");
  head.appendChild(el("strong", "response-title", response.title || "Assistente"));
  head.appendChild(el("span", "response-mode", mode));
  wrapper.appendChild(head);

  if (response.summary) wrapper.appendChild(el("p", "response-summary", response.summary));

  if (response.metrics?.length) {
    const grid = el("div", "response-metrics");
    response.metrics.forEach((item) => {
      const card = el("div", "response-metric");
      card.appendChild(el("span", "muted", item.label));
      card.appendChild(el("strong", "", formatMetric(item)));
      grid.appendChild(card);
    });
    wrapper.appendChild(grid);
  }

  if (response.observations?.length) {
    const list = el("ul", "response-list");
    response.observations.forEach((item) => list.appendChild(el("li", "", item)));
    wrapper.appendChild(list);
  }

  if (response.clarification) wrapper.appendChild(el("p", "clarification", response.clarification));

  if (response.requiresConfirmation && response.proposedMutation) {
    const box = el("div", "confirmation-box");
    box.appendChild(el("strong", "", "Confirmação necessária"));
    const p = response.proposedMutation.payload || {};
    const details = [
      p.type ? `Tipo: ${p.type === "income" ? "Entrada" : "Saída"}` : null,
      p.amount && p.currency ? `Valor: ${formatMoney(p.amount, p.currency)}` : null,
      p.category ? `Categoria: ${p.category}` : null,
      p.date ? `Data: ${p.date}` : null,
      p.description ? `Descrição: ${p.description}` : null
    ].filter(Boolean);
    details.forEach((text) => box.appendChild(el("div", "muted", text)));
    wrapper.appendChild(box);
  }

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return wrapper;
}

export function appendStatusMessage(container, text) {
  const msg = el("div", "msg bot status-message", text);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}
