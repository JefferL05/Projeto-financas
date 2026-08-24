import { openDB, getAll, put, remove } from "./db.js";
import { formatMoney, normalizeToPYG, parseLooseNumber, uid, todayISO } from "./utils.js";

const $ = (s) => document.querySelector(s);
let transactions = [];
let goals = [];
let settings = { brlToPyg: 1300, baseCurrency: "PYG" };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await openDB();
  await reload();
  bindTabs();
  bindAI();
  bindPlanning();
  routeFromHash();
  renderInsights();
  renderGoals();
  welcome();
}

async function reload() {
  transactions = await getAll("transactions");
  goals = await getAll("goals");
  const storedSettings = await getAll("settings");
  const map = Object.fromEntries(storedSettings.map((x) => [x.key, x.value]));
  settings.brlToPyg = Number(map.brlToPyg) || 1300;
  settings.baseCurrency = map.baseCurrency || "PYG";
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });
  window.addEventListener("hashchange", routeFromHash);
}

function routeFromHash() {
  selectTab(location.hash === "#planejamento" ? "planejamento" : "ia", false);
}

function selectTab(name, updateHash = true) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".intel-view").forEach((v) => v.classList.toggle("active", v.id === `tab-${name}`));
  if (updateHash) history.replaceState(null, "", `#${name}`);
}

function monthTransactions() {
  const month = new Date().toISOString().slice(0, 7);
  return transactions.filter((t) => t.date?.startsWith(month));
}

function financialSnapshot() {
  const monthTx = monthTransactions();
  const rate = settings.brlToPyg;
  const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + normalizeToPYG(t.amount, t.currency, rate), 0);
  const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + normalizeToPYG(t.amount, t.currency, rate), 0);
  const categoryMap = new Map();
  monthTx.filter((t) => t.type === "expense").forEach((t) => categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + normalizeToPYG(t.amount, t.currency, rate)));
  const categories = [...categoryMap.entries()].sort((a,b) => b[1]-a[1]);
  const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
  const day = Math.max(new Date().getDate(), 1);
  const dailyExpense = expense / day;
  const projection = dailyExpense * new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  return { monthTx, income, expense, categories, savingsRate, dailyExpense, projection, balance: income-expense };
}

function bindAI() {
  $("#askAiBtn").addEventListener("click", askAI);
  $("#aiQuestion").addEventListener("keydown", (e) => { if (e.key === "Enter") askAI(); });
  document.querySelectorAll("[data-prompt]").forEach((b) => b.addEventListener("click", () => { $("#aiQuestion").value = b.dataset.prompt; askAI(); }));
}

function welcome() {
  addMessage("bot", "Olá! Sou o assistente financeiro do Projeto Finanças. Analiso seus lançamentos localmente no navegador e posso explicar gastos, poupança, categorias e projeções. Seus dados não são enviados para um modelo externo nesta versão.");
}

function askAI() {
  const input = $("#aiQuestion");
  const question = input.value.trim();
  if (!question) return;
  addMessage("user", question);
  input.value = "";
  const answer = answerQuestion(question);
  setTimeout(() => addMessage("bot", answer), 180);
}

function answerQuestion(question) {
  const q = question.toLowerCase();
  const s = financialSnapshot();
  if (!s.monthTx.length) return "Ainda não há lançamentos no mês atual. Cadastre receitas e despesas no Dashboard e eu consigo fazer uma análise mais útil.";

  if (/econom|reduz|cortar|gasto demais/.test(q)) {
    const top = s.categories.slice(0,3);
    if (!top.length) return "Não encontrei despesas suficientes para sugerir cortes.";
    const share = s.expense ? (top[0][1] / s.expense * 100) : 0;
    return `A primeira área para revisar é ${top[0][0]}, com ${formatMoney(top[0][1], "PYG")} (${share.toFixed(1)}% dos gastos do mês). Depois vêm ${top.slice(1).map(x=>x[0]).join(" e ") || "as demais categorias"}. Eu começaria definindo um limite semanal para a maior categoria.`;
  }

  if (/maior categoria|categoria.*gasto|onde gasto/.test(q)) {
    const top = s.categories[0];
    return top ? `Sua maior categoria de despesa neste mês é ${top[0]}, com aproximadamente ${formatMoney(top[1], "PYG")}. Isso representa ${(top[1]/s.expense*100).toFixed(1)}% do total gasto.` : "Ainda não encontrei despesas categorizadas no mês.";
  }

  if (/poup|guardar|economizando|saldo/.test(q)) {
    if (s.income <= 0) return `Você registrou ${formatMoney(s.expense,"PYG")} em despesas, mas nenhuma receita consolidada no mês. Cadastre suas entradas para eu calcular sua taxa de poupança.`;
    const tone = s.savingsRate >= 20 ? "uma margem saudável" : s.savingsRate >= 0 ? "uma margem positiva, mas apertada" : "um déficit";
    return `Sua taxa de poupança estimada é ${s.savingsRate.toFixed(1)}%, o que indica ${tone}. Entradas consolidadas: ${formatMoney(s.income,"PYG")}; saídas: ${formatMoney(s.expense,"PYG")}.`;
  }

  if (/proje|fim do mês|este mês|gastos/.test(q)) {
    return `Até agora você gastou ${formatMoney(s.expense,"PYG")} no mês. A média diária está em ${formatMoney(s.dailyExpense,"PYG")}. Mantido esse ritmo, a projeção simples para o fim do mês é ${formatMoney(s.projection,"PYG")}.`;
  }

  if (/receita|entrada/.test(q)) return `As receitas consolidadas do mês somam aproximadamente ${formatMoney(s.income,"PYG")}, usando a cotação de 1 BRL = ${Math.round(settings.brlToPyg)} PYG.`;

  return `Resumo do mês: receitas ${formatMoney(s.income,"PYG")}, despesas ${formatMoney(s.expense,"PYG")}, saldo ${formatMoney(s.balance,"PYG")} e taxa de poupança ${s.savingsRate.toFixed(1)}%. Pergunte, por exemplo, onde economizar, qual a maior categoria ou qual a projeção até o fim do mês.`;
}

function addMessage(type, text) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  $("#chatLog").appendChild(div);
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
}

function renderInsights() {
  const s = financialSnapshot();
  const insights = [];
  if (!s.monthTx.length) insights.push(["warning", "Cadastre transações", "Ainda não há dados suficientes no mês atual para gerar insights."]);
  else {
    if (s.income > 0) {
      if (s.savingsRate >= 20) insights.push(["good", "Boa taxa de poupança", `Você está retendo cerca de ${s.savingsRate.toFixed(1)}% das entradas do mês.`]);
      else if (s.savingsRate >= 0) insights.push(["warning", "Poupança baixa", `Sua taxa estimada é ${s.savingsRate.toFixed(1)}%. Uma pequena redução nos gastos recorrentes pode ampliar sua margem.`]);
      else insights.push(["danger", "Mês em déficit", `As despesas superam as entradas em ${formatMoney(Math.abs(s.balance),"PYG")}.`]);
    }
    if (s.categories[0]) insights.push(["", `Maior gasto: ${s.categories[0][0]}`, `${formatMoney(s.categories[0][1],"PYG")} concentrados nessa categoria.`]);
    insights.push(["", "Projeção mensal", `Mantido o ritmo atual, seus gastos podem chegar a ${formatMoney(s.projection,"PYG")}.`]);
  }
  $("#aiInsights").innerHTML = insights.map(([cls,title,text]) => `<div class="insight ${cls}"><strong>${title}</strong><p class="muted" style="margin-top:5px">${text}</p></div>`).join("");
}

function bindPlanning() {
  $("#addGoalBtn").addEventListener("click", addGoal);
  $("#simulateBtn").addEventListener("click", simulate);
  window.deleteGoal = deleteGoal;
  window.addGoalContribution = addGoalContribution;
  const future = new Date(); future.setFullYear(future.getFullYear()+2); $("#goalDate").value = future.toISOString().slice(0,10);
  simulate();
}

async function addGoal() {
  const name = $("#goalName").value.trim();
  const currency = $("#goalCurrency").value;
  const target = parseLooseNumber($("#goalTarget").value);
  const current = parseLooseNumber($("#goalCurrent").value) || 0;
  const monthly = parseLooseNumber($("#goalMonthly").value) || 0;
  const targetDate = $("#goalDate").value;
  const priority = $("#goalPriority").value;
  if (!name || !target || !targetDate) return toast("Preencha nome, valor alvo e data.");
  await put("goals", { id: uid(), name, currency, target, current, monthly, targetDate, priority, createdAt: new Date().toISOString() });
  $("#goalName").value=""; $("#goalTarget").value=""; $("#goalCurrent").value=""; $("#goalMonthly").value="";
  await reload(); renderGoals(); toast("Meta adicionada.");
}

function renderGoals() {
  const list = [...goals].sort((a,b) => a.targetDate.localeCompare(b.targetDate));
  $("#goalList").innerHTML = list.length ? list.map(g => {
    const pct = Math.min(100, g.target ? (g.current/g.target*100) : 0);
    const remaining = Math.max(0, g.target-g.current);
    const months = monthsUntil(g.targetDate);
    const needed = months > 0 ? remaining/months : remaining;
    const status = g.monthly >= needed ? "No ritmo" : `Faltam ${formatMoney(Math.max(0,needed-g.monthly),g.currency)}/mês`;
    return `<div class="goal-card"><div class="goal-head"><div><strong>${g.name}</strong><div class="muted" style="margin-top:4px">Prioridade ${g.priority}</div></div><strong>${pct.toFixed(0)}%</strong></div><div class="progress"><span style="width:${pct}%"></span></div><div class="goal-meta"><span>${formatMoney(g.current,g.currency)} de ${formatMoney(g.target,g.currency)}</span><span>Até ${formatDateBR(g.targetDate)}</span><span>${status}</span></div><div class="goal-actions"><button class="btn btn-secondary" onclick="addGoalContribution('${g.id}')">+ Aporte</button><button class="btn btn-danger" onclick="deleteGoal('${g.id}')">Excluir</button></div></div>`;
  }).join("") : `<div class="empty">Nenhuma meta criada ainda.</div>`;
}

function monthsUntil(date) {
  const now = new Date(); const end = new Date(date+"T00:00:00");
  return Math.max(0, (end.getFullYear()-now.getFullYear())*12 + end.getMonth()-now.getMonth());
}
function formatDateBR(date){const [y,m,d]=date.split("-");return `${d}/${m}/${y}`;}

async function addGoalContribution(id) {
  const goal = goals.find(g=>g.id===id); if(!goal) return;
  const raw = prompt(`Quanto deseja adicionar à meta "${goal.name}"?`); if(raw===null) return;
  const amount = parseLooseNumber(raw); if(!amount || amount<=0) return toast("Valor inválido.");
  goal.current = Math.min(goal.target, Number(goal.current||0)+amount);
  goal.updatedAt = new Date().toISOString(); await put("goals", goal); await reload(); renderGoals(); toast("Aporte registrado.");
}
async function deleteGoal(id){const goal=goals.find(g=>g.id===id);if(!goal||!confirm(`Excluir a meta "${goal.name}"?`))return;await remove("goals",id);await reload();renderGoals();toast("Meta excluída.");}

function simulate() {
  const monthly = Number($("#simMonthly").value)||0;
  const years = Number($("#simYears").value)||0;
  const annual = Number($("#simRate").value)||0;
  const months = years*12;
  const r = Math.pow(1+annual/100,1/12)-1;
  const future = r > 0 ? monthly*((Math.pow(1+r,months)-1)/r) : monthly*months;
  const contributed = monthly*months;
  $("#simulationResult").textContent = formatMoney(future,"BRL");
  $("#simulationDetail").textContent = `Aportes: ${formatMoney(contributed,"BRL")} · crescimento matemático estimado: ${formatMoney(Math.max(0,future-contributed),"BRL")}.`;
}

let toastTimer;
function toast(msg){clearTimeout(toastTimer);const t=$("#toast");t.textContent=msg;t.classList.add("show");toastTimer=setTimeout(()=>t.classList.remove("show"),2000);}
