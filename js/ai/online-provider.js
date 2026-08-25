const DEFAULT_ENDPOINT = "/api/financial-assistant";

export async function generateNarrative({ intent, question, financialContext, conversationContext, endpoint = DEFAULT_ENDPOINT, signal }) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, question: String(question).slice(0, 500), financialContext, conversationContext }),
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`IA online indisponível (${response.status}).`);
    const data = await response.json();
    if (!data || typeof data.summary !== "string") throw new Error("Resposta inválida da IA online.");
    return {
      title: typeof data.title === "string" ? data.title.slice(0, 120) : "Assistente online",
      summary: data.summary.slice(0, 1200),
      observations: Array.isArray(data.observations) ? data.observations.slice(0, 4).map((x) => String(x).slice(0, 400)) : [],
      suggestedActions: Array.isArray(data.suggestedActions) ? data.suggestedActions.slice(0, 2).map((x) => String(x).slice(0, 200)) : []
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
}
