/* ═══════════════════════════════════════════════════════════════════════════
   IoT Asistencial — Frontend Logic
   ═══════════════════════════════════════════════════════════════════════════ */

"use strict";

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  nodo01: {},
  nodo02: {},
  nodo03: {},
  prev: { pulso: null, spo2: null, temperatura: null, humedad: null, co2: null },
  mqttConectado: false,
  demoActivo: false,
  autoMode: false,
  logVisible: false,
  eventos: [],
  lastUpdate: null,
};

// Rangos para alertas
const RANGOS = {
  pulso:       { ok: [60, 100], warn: [50, 120] },
  spo2:        { ok: [95, 100], warn: [90, 100] },
  co2:         { ok: [0, 800],  warn: [800, 1000] },
  temperatura: { ok: [18, 28],  warn: [15, 32] },
  humedad:     { ok: [40, 70],  warn: [30, 80] },
};

// ── Gráficas Chart.js ─────────────────────────────────────────────────────────
let chartAmbiente   = null;
let chartHistorial  = null;
let chartPulsoGauge = null;
let chartSpo2Gauge  = null;
let chartTempSemi   = null;
let chartSparkline  = null;

const COLORS = {
  teal:   "#00D4AA",
  teal_d: "#028090",
  red:    "#FF4757",
  yellow: "#FFA502",
  green:  "#2ED573",
  blue:   "#54A0FF",
  orange: "#FF6348",
  purple: "#A29BFE",
};

Chart.defaults.color = "#7A9BB5";
Chart.defaults.borderColor = "rgba(255,255,255,0.05)";
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const socket = io({ transports: ["websocket", "polling"] });

socket.on("connect", () => {
  console.log("WS conectado:", socket.id);
});

socket.on("mqtt_status", (data) => {
  state.mqttConectado = data.conectado;
  actualizarMqttUI();
});

socket.on("demo_status", (data) => {
  state.demoActivo = data.demo;
  actualizarDemoUI();
});

socket.on("nuevo_dato", ({ nodo, data }) => {
  procesarDato(nodo, data);
});

socket.on("comando_enviado", ({ cmd }) => {
  agregarLog("comando", 0, `Comando enviado: ${cmd}`);
});

socket.on("auto_accion", ({ cmd, razon }) => {
  agregarLog("alerta", 2, `Auto: ${cmd} (${razon})`);
});

// ── Procesar dato entrante ─────────────────────────────────────────────────────
function procesarDato(nodo, data) {
  state.lastUpdate = new Date();
  const key = `nodo${String(nodo).padStart(2, "0")}`;
  const prev = { ...state[key] };
  state[key] = { ...state[key], ...data };

  if (nodo === 1) {
    actualizarSalud(data);
    state.prev.pulso = prev.pulso;
    state.prev.spo2  = prev.spo2;
    actualizarSparkline(data.pulso);
    agregarLog("dato", 1, `Pulso: ${data.pulso} BPM, SpO₂: ${data.spo2}%`);
  }
  if (nodo === 2) {
    actualizarAmbiente(data);
    state.prev.temperatura = prev.temperatura;
    state.prev.humedad     = prev.humedad;
    state.prev.co2         = prev.co2;
    actualizarChartAmbiente();
    agregarLog("dato", 2, `Temp: ${data.temperatura}°C, Hum: ${data.humedad}%, CO₂: ${data.co2}ppm`);
  }
  if (nodo === 3) {
    actualizarActuadores(data);
    agregarLog("dato", 3, `Luz: ${data.luz ? "ON" : "OFF"}, Ventilador: ${data.ventilador ? "ON" : "OFF"}`);
  }

  actualizarResumen();
  actualizarLastUpdate();
}

// ── RELOJ ─────────────────────────────────────────────────────────────────────
function actualizarReloj() {
  const ahora = new Date();
  const hms = ahora.toLocaleTimeString("es-PE", { hour12: false });
  const fecha = ahora.toLocaleDateString("es-PE", { weekday: "short", month: "short", day: "numeric" });
  document.getElementById("clockTime").textContent = hms;
  document.getElementById("clockDate").textContent = fecha;
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ── MQTT UI ───────────────────────────────────────────────────────────────────
function actualizarMqttUI() {
  const dot    = document.getElementById("mqttDot");
  const label  = document.getElementById("mqttLabel");
  const broker = document.getElementById("footerBroker");
  if (state.mqttConectado) {
    dot.classList.add("conectado");
    label.textContent = "HiveMQ";
    broker.textContent = "🟢 HiveMQ conectado";
    broker.classList.add("online");
  } else {
    dot.classList.remove("conectado");
    label.textContent = "Desconectado";
    broker.textContent = "🔴 Broker desconectado";
    broker.classList.remove("online");
  }
}

// ── Last update ───────────────────────────────────────────────────────────────
function actualizarLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (!state.lastUpdate) { el.textContent = "Sin datos"; return; }
  const seg = Math.round((new Date() - state.lastUpdate) / 1000);
  el.textContent = seg < 60 ? `Hace ${seg}s` : `Hace ${Math.round(seg / 60)}m`;
}
setInterval(actualizarLastUpdate, 5000);

// ── Clase de alerta ────────────────────────────────────────────────────────────
function clasificar(variable, valor) {
  if (valor == null) return "";
  const r = RANGOS[variable];
  if (!r) return "ok";
  if (valor >= r.ok[0] && valor <= r.ok[1]) return "ok";
  if (valor >= r.warn[0] && valor <= r.warn[1]) return "precaucion";
  return "alerta";
}

// ── Resumen mini-cards ────────────────────────────────────────────────────────
const sparkData = { pulso: [], spo2: [], temperatura: [], humedad: [], co2: [] };

function actualizarResumen() {
  const n1 = state.nodo01;
  const n2 = state.nodo02;

  setMiniCard("Pulso", "valPulso", "cardPulso", "trendPulso", n1.pulso, state.prev.pulso, "pulso");
  setMiniCard("SpO₂",  "valSpo2",  "cardSpo2",  "trendSpo2",  n1.spo2,  state.prev.spo2,  "spo2");

  // Sistema
  const sistCard = document.getElementById("cardSistema");
  const sistVal  = document.getElementById("valSistema");
  const algun_nodo_ok = n1.pulso || n2.temperatura;
  sistCard.className = "mini-card " + (algun_nodo_ok ? "ok" : "");
  sistVal.textContent = algun_nodo_ok ? "Online" : "Offline";
  document.getElementById("trendSistema").textContent = algun_nodo_ok ? "●" : "○";

  // Banner CO2
  const co2Banner = document.getElementById("co2AlertBanner");
  if (n2.co2 > 1000) co2Banner.style.display = "flex";
  else co2Banner.style.display = "none";
}

function setMiniCard(nombre, valId, cardId, trendId, valor, prevValor, variable) {
  const valEl  = document.getElementById(valId);
  const card   = document.getElementById(cardId);
  const trend  = document.getElementById(trendId);

  if (valor == null) return;
  const fmt = valor % 1 === 0 ? String(Math.round(valor)) : valor.toFixed(1);

  if (valEl.textContent !== fmt) {
    valEl.textContent = fmt;
    valEl.classList.remove("flash");
    void valEl.offsetWidth;
    valEl.classList.add("flash");
  }

  card.className = "mini-card " + clasificar(variable, valor);

  if (prevValor != null) {
    if (valor > prevValor + 0.05) {
      trend.textContent = "↑";
      trend.className = "mini-trend up";
    } else if (valor < prevValor - 0.05) {
      trend.textContent = "↓";
      trend.className = "mini-trend down";
    } else {
      trend.textContent = "→";
      trend.className = "mini-trend";
    }
  }
}

// ── SALUD ─────────────────────────────────────────────────────────────────────
const sparklineBuffer = [];

function actualizarSalud(data) {
  const { pulso, spo2 } = data;
  document.getElementById("gaugePulsoVal").textContent = pulso != null ? Math.round(pulso) : "--";
  document.getElementById("gaugeSpo2Val").textContent  = spo2  != null ? spo2.toFixed(1)  : "--";

  if (pulso != null) dibujarGaugeCircular("gaugePulso", pulso, 0, 180, colorPorAlerta("pulso", pulso));
  if (spo2  != null) dibujarGaugeCircular("gaugeSpo2",  spo2,  85, 100, colorPorAlerta("spo2", spo2));

  const healthCard = document.getElementById("healthCard");
  const claseAlerta = clasificar("pulso", pulso) === "alerta" || clasificar("spo2", spo2) === "alerta";
  healthCard.classList.toggle("alerta", claseAlerta);

  // nodo status
  const nodo01Status = document.getElementById("nodo01Status");
  nodo01Status.textContent = "🟢 Online";
  nodo01Status.classList.add("online");

  const ts = data.timestamp ? new Date(data.timestamp) : new Date();
  document.getElementById("healthLastRead").textContent = "Última lectura: " + ts.toLocaleTimeString("es-PE");
}

function colorPorAlerta(variable, valor) {
  const clase = clasificar(variable, valor);
  if (clase === "alerta") return COLORS.red;
  if (clase === "precaucion") return COLORS.yellow;
  return COLORS.teal;
}

function dibujarGaugeCircular(canvasId, valor, min, max, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r  = cx - 12;
  const pct = Math.max(0, Math.min(1, (valor - min) / (max - min)));
  const startAngle = Math.PI * 0.75;
  const endAngle   = Math.PI * 2.25;
  const fillEnd    = startAngle + pct * (endAngle - startAngle);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Pista de fondo
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth   = 10;
  ctx.lineCap     = "round";
  ctx.stroke();

  // Relleno
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, COLORS.teal_d);
  grad.addColorStop(1, color);
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillEnd);
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 10;
  ctx.lineCap     = "round";
  ctx.stroke();

  // Glow
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillEnd);
  ctx.strokeStyle = color + "44";
  ctx.lineWidth   = 16;
  ctx.lineCap     = "round";
  ctx.stroke();
}

// Sparkline de pulso
function actualizarSparkline(pulso) {
  if (pulso == null) return;
  sparklineBuffer.push(pulso);
  if (sparklineBuffer.length > 30) sparklineBuffer.shift();

  const canvas = document.getElementById("sparklinePulso");
  if (!canvas) return;
  if (!chartSparkline) {
    chartSparkline = new Chart(canvas, {
      type: "line",
      data: {
        labels: sparklineBuffer.map((_, i) => i),
        datasets: [{
          data: sparklineBuffer,
          borderColor: COLORS.teal,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 60);
            g.addColorStop(0, COLORS.teal + "33");
            g.addColorStop(1, "transparent");
            return g;
          },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  } else {
    chartSparkline.data.labels = sparklineBuffer.map((_, i) => i);
    chartSparkline.data.datasets[0].data = sparklineBuffer;
    chartSparkline.update("none");
  }
}

// ── AMBIENTE ──────────────────────────────────────────────────────────────────
function actualizarAmbiente(data) {
  const { temperatura, humedad, co2, presion, gas } = data;

  // Temperatura
  if (temperatura != null) {
    document.getElementById("tempVal").textContent = temperatura.toFixed(1);
    dibujarGaugeSemi("gaugeTempSemi", temperatura, 10, 40, colorPorAlerta("temperatura", temperatura));
    const tempCard = document.getElementById("tempCard");
    tempCard.className = "ambient-item card " + (clasificar("temperatura", temperatura) === "alerta" ? "alerta-card" : "");
  }

  // Humedad
  if (humedad != null) {
    document.getElementById("humVal").textContent = humedad.toFixed(1);
    document.getElementById("humBar").style.width = Math.min(100, humedad) + "%";
    const clase = clasificar("humedad", humedad);
    document.getElementById("humStatus").textContent =
      clase === "ok" ? "Nivel óptimo" : clase === "precaucion" ? "Revisar humedad" : "Humedad fuera de rango";
  }

  // CO2
  if (co2 != null) {
    document.getElementById("co2Val").textContent = Math.round(co2);
    const clCo2 = clasificar("co2", co2);
    ["Verde", "Amarillo", "Rojo"].forEach((c) => document.getElementById(`sem${c}`).classList.remove("activo"));
    if (clCo2 === "ok")        document.getElementById("semVerde").classList.add("activo");
    else if (clCo2 === "precaucion") document.getElementById("semAmarillo").classList.add("activo");
    else                       document.getElementById("semRojo").classList.add("activo");
    document.getElementById("co2Label").textContent =
      clCo2 === "ok" ? "Nivel normal" : clCo2 === "precaucion" ? "Nivel elevado" : "¡Nivel peligroso!";
  }

  // Presión
  if (presion != null) {
    document.getElementById("presVal").textContent = presion.toFixed(1);
  }

  // Gas VOC
  if (gas != null) {
    document.getElementById("gasVal").textContent = Math.round(gas).toLocaleString("es-PE");
  }

  // Nodo 02 status
  const nodo02Status = document.getElementById("nodo02Status");
  nodo02Status.textContent = "🟢 Online";
  nodo02Status.classList.add("online");
}

function dibujarGaugeSemi(canvasId, valor, min, max, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h - 10;
  const r  = Math.min(cx - 10, cy - 10);
  const pct = Math.max(0, Math.min(1, (valor - min) / (max - min)));
  const start = Math.PI;
  const end   = Math.PI + pct * Math.PI;

  ctx.clearRect(0, 0, w, h);

  // Fondo
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0, false);
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth   = 8;
  ctx.lineCap     = "round";
  ctx.stroke();

  // Relleno
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, false);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 8;
  ctx.lineCap     = "round";
  ctx.stroke();
}

// ── CHART AMBIENTE ────────────────────────────────────────────────────────────
const ambienteBuffer = { labels: [], temperatura: [], humedad: [], co2: [], presion: [], gas: [] };

function actualizarChartAmbiente() {
  const ahora = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  ambienteBuffer.labels.push(ahora);
  ambienteBuffer.temperatura.push(state.nodo02.temperatura);
  ambienteBuffer.humedad.push(state.nodo02.humedad);
  ambienteBuffer.co2.push(state.nodo02.co2);
  ambienteBuffer.presion.push(state.nodo02.presion);
  ambienteBuffer.gas.push(state.nodo02.gas);
  const maxPuntos = 60;
  if (ambienteBuffer.labels.length > maxPuntos) {
    ambienteBuffer.labels.shift();
    ambienteBuffer.temperatura.shift();
    ambienteBuffer.humedad.shift();
    ambienteBuffer.co2.shift();
    ambienteBuffer.presion.shift();
    ambienteBuffer.gas.shift();
  }
  if (chartAmbiente) {
    chartAmbiente.data.labels                 = ambienteBuffer.labels;
    chartAmbiente.data.datasets[0].data       = ambienteBuffer.temperatura;
    chartAmbiente.data.datasets[1].data       = ambienteBuffer.humedad;
    chartAmbiente.data.datasets[2].data       = ambienteBuffer.co2;
    chartAmbiente.data.datasets[3].data       = ambienteBuffer.presion;
    chartAmbiente.data.datasets[4].data       = ambienteBuffer.gas;
    chartAmbiente.update("none");
  }
}

function makeGradient(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, color + "55");
  g.addColorStop(1, "transparent");
  return g;
}

function initChartAmbiente() {
  const canvas = document.getElementById("chartAmbiente");
  if (!canvas) return;
  chartAmbiente = new Chart(canvas, {
    type: "line",
    data: {
      labels: ambienteBuffer.labels,
      datasets: [
        {
          label: "Temperatura °C",
          data: ambienteBuffer.temperatura,
          borderColor: COLORS.red,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: true,
          backgroundColor: (ctx) => makeGradient(ctx.chart.ctx, COLORS.red),
          yAxisID: "y",
        },
        {
          label: "Humedad %",
          data: ambienteBuffer.humedad,
          borderColor: COLORS.teal,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: true,
          backgroundColor: (ctx) => makeGradient(ctx.chart.ctx, COLORS.teal),
          yAxisID: "y",
        },
        {
          label: "CO₂ ppm",
          data: ambienteBuffer.co2,
          borderColor: COLORS.yellow,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: false,
          yAxisID: "y2",
        },
        {
          label: "Presión hPa",
          data: ambienteBuffer.presion,
          borderColor: COLORS.blue,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: false,
          yAxisID: "y3",
          hidden: true,
        },
        {
          label: "Gas VOC Ω",
          data: ambienteBuffer.gas,
          borderColor: COLORS.orange,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: false,
          yAxisID: "y4",
          hidden: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { boxWidth: 10, font: { size: 11 }, padding: 12 },
        },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 6, font: { size: 10 }, maxRotation: 0 },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          position: "left",
          ticks: { font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y2: {
          position: "right",
          ticks: { font: { size: 10 }, color: COLORS.yellow },
          grid: { drawOnChartArea: false },
        },
        y3: { display: false },
        y4: { display: false },
      },
    },
  });
}

// Range buttons — ambiente
document.getElementById("rangeAmbiente").addEventListener("click", (e) => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll("#rangeAmbiente .range-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  const horas = parseInt(btn.dataset.h);
  cargarHistorialAmbiente(horas);
});

async function cargarHistorialAmbiente(horas = 1) {
  try {
    const res = await fetch(`/api/historial?nodo=2&horas=${horas}`);
    const rows = await res.json();
    if (!rows.length) return;
    ambienteBuffer.labels      = rows.map((r) => r.timestamp.slice(11, 19));
    ambienteBuffer.temperatura = rows.map((r) => r.temperatura);
    ambienteBuffer.humedad     = rows.map((r) => r.humedad);
    ambienteBuffer.co2         = rows.map((r) => r.co2);
    ambienteBuffer.presion     = rows.map((r) => r.presion);
    ambienteBuffer.gas         = rows.map((r) => r.gas);
    if (chartAmbiente) {
      chartAmbiente.data.labels                 = ambienteBuffer.labels;
      chartAmbiente.data.datasets[0].data       = ambienteBuffer.temperatura;
      chartAmbiente.data.datasets[1].data       = ambienteBuffer.humedad;
      chartAmbiente.data.datasets[2].data       = ambienteBuffer.co2;
      chartAmbiente.data.datasets[3].data       = ambienteBuffer.presion;
      chartAmbiente.data.datasets[4].data       = ambienteBuffer.gas;
      chartAmbiente.update();
    }
  } catch (err) { console.error("Error cargando historial ambiente:", err); }
}

// ── ACTUADORES ────────────────────────────────────────────────────────────────
const actuadorTimes = { luz: null, vent: null };

function actualizarActuadores(data) {
  const { luz, ventilador } = data;
  const ahora = new Date();

  if (luz != null) {
    actuadorTimes.luz = ahora;
    const toggle = document.getElementById("luzToggle");
    toggle.checked = luz;
    const card     = document.getElementById("luzCard");
    const stateEl  = document.getElementById("luzState");
    card.classList.toggle("luz-on", luz);
    stateEl.textContent = luz ? "Encendida" : "Apagada";
    stateEl.className   = "actuator-state " + (luz ? "on" : "");
    document.getElementById("luzLast").textContent = luz
      ? "Encendida ahora"
      : "Apagada ahora";
  }

  if (ventilador != null) {
    actuadorTimes.vent = ahora;
    const toggle = document.getElementById("ventToggle");
    toggle.checked = ventilador;
    const card    = document.getElementById("ventCard");
    const stateEl = document.getElementById("ventState");
    card.classList.toggle("vent-on", ventilador);
    stateEl.textContent = ventilador ? "Encendido" : "Apagado";
    stateEl.className   = "actuator-state " + (ventilador ? "on" : "");
    document.getElementById("ventLast").textContent = ventilador
      ? "Encendido ahora"
      : "Apagado ahora";
    const ventIcon = document.getElementById("ventIcon");
    ventIcon.classList.toggle("spinning", ventilador);
  }
}

async function enviarComando(cmd, dispositivo) {
  try {
    const res  = await fetch("/api/comando", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comando: cmd }),
    });
    const data = await res.json();
    if (!data.ok) console.warn("Comando no enviado:", data);
  } catch (err) {
    console.error("Error enviando comando:", err);
  }
}

async function toggleAutoMode(activo) {
  try {
    await fetch("/api/auto_mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo }),
    });
    state.autoMode = activo;
    const card     = document.getElementById("autoCard");
    const stateEl  = document.getElementById("autoState");
    card.classList.toggle("active", activo);
    stateEl.textContent = activo ? "Activo" : "Desactivado";
    stateEl.className   = "actuator-state " + (activo ? "on" : "");
  } catch (err) { console.error("Error toggle auto:", err); }
}

// ── ESTADÍSTICAS ──────────────────────────────────────────────────────────────
async function cargarEstadisticas() {
  try {
    const res   = await fetch("/api/estadisticas");
    const stats = await res.json();
    const tbody = document.getElementById("statsTableBody");
    const vars  = [
      ["temperatura", "Temperatura", "°C"],
      ["humedad",     "Humedad",     "%"],
      ["co2",         "CO₂",         "ppm"],
      ["presion",     "Presión",     "hPa"],
      ["gas",         "Gas VOC",     "Ω"],
      ["pulso",       "Pulso",       "BPM"],
      ["spo2",        "SpO₂",        "%"],
    ];
    tbody.innerHTML = vars.map(([key, label, unit]) => {
      const s = stats[key] || {};
      const fmt = (v) => (v != null ? `${v} ${unit}` : "—");
      return `<tr>
        <td>${label}</td>
        <td>${fmt(s.promedio)}</td>
        <td>${fmt(s.minimo)}</td>
        <td>${fmt(s.maximo)}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    document.getElementById("statsTableBody").innerHTML =
      '<tr><td colspan="4" class="stats-loading">Error al cargar</td></tr>';
  }
}

// ── HISTORIAL ─────────────────────────────────────────────────────────────────
function initChartHistorial() {
  const canvas = document.getElementById("chartHistorial");
  if (!canvas) return;
  chartHistorial = new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Temperatura °C",
        data: [],
        borderColor: COLORS.teal,
        borderWidth: 2.5,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
        fill: true,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
          g.addColorStop(0, COLORS.teal + "44");
          g.addColorStop(1, "transparent");
          return g;
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
          pan: { enabled: true, mode: "x" },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, font: { size: 10 }, maxRotation: 0 },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          ticks: { font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

const varNodo = {
  temperatura: 2, humedad: 2, co2: 2, presion: 2, gas: 2,
  pulso: 1, spo2: 1,
};

async function cargarHistorial() {
  const variable = document.getElementById("selectVarHist").value;
  const horasBtn = document.querySelector("#rangeHistorial .range-btn.active");
  const horas    = horasBtn ? parseInt(horasBtn.dataset.h) : 24;
  const nodo     = varNodo[variable] || 2;

  try {
    const res  = await fetch(`/api/historial?nodo=${nodo}&horas=${horas}`);
    const rows = await res.json();
    if (!chartHistorial) return;

    const coloresVar = {
      temperatura: COLORS.red,
      humedad:     COLORS.teal,
      co2:         COLORS.yellow,
      presion:     COLORS.blue,
      gas:         COLORS.orange,
      pulso:       COLORS.green,
      spo2:        COLORS.purple,
    };

    chartHistorial.data.labels = rows.map((r) => r.timestamp.slice(11, 19));
    chartHistorial.data.datasets[0].data        = rows.map((r) => r[variable]);
    chartHistorial.data.datasets[0].borderColor = coloresVar[variable] || COLORS.teal;
    chartHistorial.data.datasets[0].label       = document.getElementById("selectVarHist").options[
      document.getElementById("selectVarHist").selectedIndex
    ].text;
    chartHistorial.update();
  } catch (err) { console.error("Error historial:", err); }
}

document.getElementById("rangeHistorial").addEventListener("click", (e) => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll("#rangeHistorial .range-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  cargarHistorial();
});

// ── LOG ───────────────────────────────────────────────────────────────────────
const tipoColor = { dato: "dato", alerta: "alerta", comando: "comando" };

function agregarLog(tipo, nodo, mensaje) {
  const ts = new Date().toLocaleTimeString("es-PE", { hour12: false });
  const evento = { tipo, nodo, mensaje, ts };
  state.eventos.unshift(evento);
  if (state.eventos.length > 100) state.eventos.pop();
  if (state.logVisible) renderizarLog();
}

function renderizarLog() {
  const lista = document.getElementById("logList");
  if (!state.eventos.length) {
    lista.innerHTML = '<div class="log-empty">Sin eventos registrados</div>';
    return;
  }
  lista.innerHTML = state.eventos.slice(0, 50).map((ev) => `
    <div class="log-item">
      <div class="log-dot ${tipoColor[ev.tipo] || "dato"}"></div>
      <div class="log-content">
        <div class="log-ts">${ev.ts} · Nodo ${ev.nodo || "–"}</div>
        <div class="log-msg">${ev.mensaje}</div>
      </div>
    </div>
  `).join("");
}

function toggleLog() {
  state.logVisible = !state.logVisible;
  const card  = document.getElementById("logCard");
  const btnTxt = document.getElementById("logToggleText");
  card.style.display  = state.logVisible ? "block" : "none";
  btnTxt.textContent  = state.logVisible ? "Colapsar" : "Expandir";
  if (state.logVisible) renderizarLog();
}

// ── DEMO ──────────────────────────────────────────────────────────────────────
async function toggleDemo() {
  try {
    const accion = state.demoActivo ? "desactivar" : "activar";
    const res    = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion }),
    });
    const data = await res.json();
    state.demoActivo = data.demo;
    actualizarDemoUI();
  } catch (err) { console.error("Error demo:", err); }
}

function actualizarDemoUI() {
  const banner = document.getElementById("demoBanner");
  const btn    = document.getElementById("demoBtn");
  const txt    = document.getElementById("demoBtnText");
  banner.style.display = state.demoActivo ? "flex" : "none";
  btn.classList.toggle("active", state.demoActivo);
  txt.textContent = state.demoActivo ? "⏹ Desactivar Demo" : "▶ Activar Demo";
}

// ── Carga inicial ─────────────────────────────────────────────────────────────
async function cargarUltimoDato() {
  try {
    const res  = await fetch("/api/ultimo");
    const data = await res.json();
    for (const [key, val] of Object.entries(data)) {
      if (!val) continue;
      const nodo = parseInt(key.replace("nodo", ""));
      procesarDato(nodo, val);
    }
  } catch (err) { console.error("Error carga inicial:", err); }
}

async function cargarEstadoDemo() {
  try {
    const res  = await fetch("/api/demo/estado");
    const data = await res.json();
    state.demoActivo = data.demo;
    actualizarDemoUI();
  } catch (err) {}
}

async function cargarEstadoMqtt() {
  try {
    const res  = await fetch("/api/status");
    const data = await res.json();
    state.mqttConectado = data.mqtt_conectado;
    state.autoMode      = data.auto_mode;
    actualizarMqttUI();
    document.getElementById("autoToggle").checked = state.autoMode;
  } catch (err) {}
}

// ── Tab navigation ────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));

  const panel = document.getElementById("panel-" + tabId);
  const btn   = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (panel) panel.classList.add("active");
  if (btn)   btn.classList.add("active");

  // Forzar resize de gráficas al hacer visible su panel
  requestAnimationFrame(() => {
    if (tabId === "nodo02" && chartAmbiente)  chartAmbiente.resize();
    if (tabId === "stats"  && chartHistorial) chartHistorial.resize();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initChartAmbiente();
  initChartHistorial();
  await cargarEstadoDemo();
  await cargarEstadoMqtt();
  await cargarUltimoDato();
  await cargarEstadisticas();
  cargarHistorial();
  cargarHistorialAmbiente(1);

  // Refrescar estadísticas cada 5 minutos
  setInterval(cargarEstadisticas, 300_000);
  // Refrescar estado MQTT cada 15 segundos
  setInterval(cargarEstadoMqtt, 15_000);
});
