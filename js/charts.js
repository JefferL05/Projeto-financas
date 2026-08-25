let cashflowChart;
let categoryChart;
let balanceChart;

function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#cbd5df" } }
    },
    scales: {
      x: {
        ticks: { color: "#8d99a6" },
        grid: { color: "rgba(141,153,166,.08)" }
      },
      y: {
        ticks: { color: "#8d99a6" },
        grid: { color: "rgba(141,153,166,.08)" }
      }
    }
  };
}

function canvasContext(canvas) {
  if (!canvas) return null;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, canvas.clientWidth || 600);
  const height = Math.max(220, canvas.clientHeight || 280);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function clearFallback(canvas) {
  const setup = canvasContext(canvas);
  if (!setup) return null;
  setup.ctx.clearRect(0, 0, setup.width, setup.height);
  setup.ctx.font = "12px system-ui";
  setup.ctx.fillStyle = "#8d99a6";
  return setup;
}

function drawFallbackBars(canvas, data) {
  const setup = clearFallback(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const max = Math.max(1, ...data.flatMap((item) => [item.income || 0, item.expense || 0]));
  const pad = 38;
  const slot = (width - pad * 2) / Math.max(1, data.length);

  data.forEach((item, index) => {
    const x = pad + slot * index;
    const availableHeight = height - 70;
    const incomeHeight = (Number(item.income || 0) / max) * availableHeight;
    const expenseHeight = (Number(item.expense || 0) / max) * availableHeight;
    const barWidth = Math.max(6, slot * 0.28);

    ctx.fillStyle = "#3fd59a";
    ctx.fillRect(x + slot * 0.15, height - 38 - incomeHeight, barWidth, incomeHeight);
    ctx.fillStyle = "#ff7070";
    ctx.fillRect(x + slot * 0.52, height - 38 - expenseHeight, barWidth, expenseHeight);
    ctx.fillStyle = "#8d99a6";
    ctx.textAlign = "center";
    ctx.fillText(String(item.label || ""), x + slot / 2, height - 16);
  });
}

function drawFallbackDoughnut(canvas, data) {
  const setup = clearFallback(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const colors = ["#7dd3fc", "#3fd59a", "#ff7070", "#fbbf24", "#c084fc", "#fb7185", "#60a5fa", "#a3e635"];
  const cx = width / 2;
  const cy = height / 2 - 8;
  const radius = Math.min(width, height) * 0.28;

  if (!total) {
    ctx.textAlign = "center";
    ctx.fillText("Sem dados para o gráfico", cx, cy);
    return;
  }

  let angle = -Math.PI / 2;
  data.forEach((item, index) => {
    const slice = Number(item.value || 0) / total * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, angle, angle + slice);
    ctx.arc(cx, cy, radius * 0.58, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    angle += slice;
  });

  ctx.fillStyle = "#cbd5df";
  ctx.textAlign = "center";
  ctx.fillText("Modo offline", cx, cy + 4);
}

function drawFallbackLine(canvas, data) {
  const setup = clearFallback(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  if (!data.length) {
    ctx.textAlign = "center";
    ctx.fillText("Sem dados para o gráfico", width / 2, height / 2);
    return;
  }

  const values = data.map((item) => Number(item.value || 0));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(1, max - min);
  const pad = 38;

  ctx.beginPath();
  data.forEach((item, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(1, data.length - 1));
    const y = height - pad - ((Number(item.value || 0) - min) / range) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function renderCashflowChart(canvas, data) {
  if (!canvas) return;
  if (!window.Chart) {
    drawFallbackBars(canvas, data);
    return;
  }

  cashflowChart?.destroy();
  cashflowChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: data.map((item) => item.label),
      datasets: [
        { label: "Entradas", data: data.map((item) => item.income), backgroundColor: "rgba(63,213,154,.65)", borderRadius: 7 },
        { label: "Saídas", data: data.map((item) => item.expense), backgroundColor: "rgba(255,112,112,.65)", borderRadius: 7 }
      ]
    },
    options: baseOptions()
  });
}

export function renderCategoryChart(canvas, data) {
  if (!canvas) return;
  if (!window.Chart) {
    drawFallbackDoughnut(canvas, data);
    return;
  }

  categoryChart?.destroy();
  categoryChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: data.map((item) => item.label),
      datasets: [{
        data: data.map((item) => item.value),
        backgroundColor: ["#7dd3fc", "#3fd59a", "#ff7070", "#fbbf24", "#c084fc", "#fb7185", "#60a5fa", "#a3e635", "#f97316", "#2dd4bf", "#e879f9", "#94a3b8"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#cbd5df", boxWidth: 10 } }
      }
    }
  });
}

export function renderBalanceChart(canvas, data) {
  if (!canvas) return;
  if (!window.Chart) {
    drawFallbackLine(canvas, data);
    return;
  }

  balanceChart?.destroy();
  balanceChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: data.map((item) => item.label),
      datasets: [{
        label: "Saldo acumulado",
        data: data.map((item) => item.value),
        borderColor: "#7dd3fc",
        backgroundColor: "rgba(125,211,252,.12)",
        fill: true,
        tension: 0.32,
        pointRadius: 2
      }]
    },
    options: baseOptions()
  });
}
