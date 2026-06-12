/**
 * ArulFundX – Charts Module
 * All Chart.js 4 rendering: NAV, Annual Returns, CAGR, Rolling, Alpha, Drawdown, Gauges
 */

// Store active chart instances so we can destroy before re-rendering
const instances = {};

// Register global vertical crosshair plugin for all Chart.js instances
Chart.register({
  id: 'verticalHoverLine',
  afterDraw(chart) {
    const activeElements = chart.getActiveElements() || [];
    const tooltipActive = chart.tooltip?.active || [];
    const active = activeElements.length ? activeElements : tooltipActive;

    if (active && active.length) {
      const activePoint = active[0];
      const x = activePoint.element.x;
      const ctx = chart.ctx;
      
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 5]); // Dashed line
      ctx.lineWidth = 1.5;
      
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.4)';
      
      const topY = chart.chartArea.top;
      const bottomY = chart.chartArea.bottom;
      
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.stroke();
      ctx.restore();
    }
  }
});

// ── Theme Color Helper ────────────────────────────────────────────────────────

function getTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    isDark,
    bg: isDark ? '#060d1a' : '#ffffff',
    gridColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    tickColor: isDark ? '#4b5e78' : '#94a3b8',
    textPrimary: isDark ? '#f0f6ff' : '#0f172a',
    textMuted: isDark ? '#64748b' : '#94a3b8',
    blue: '#3b82f6',
    blueLight: '#60a5fa',
    teal: '#06b6d4',
    green: '#10b981',
    red: '#ef4444',
    orange: '#f59e0b',
    purple: '#8b5cf6',
    tooltipBg: isDark ? '#0e1726' : '#ffffff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
  };
}

function destroyChart(id) {
  if (instances[id]) {
    instances[id].destroy();
    delete instances[id];
  }
}

export function destroyAll() {
  Object.keys(instances).forEach(destroyChart);
}

function isCompactScreen() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function isNarrowScreen() {
  return window.matchMedia('(max-width: 540px)').matches;
}

function chartFontSizes() {
  if (isNarrowScreen()) return { tick: 9, tooltipTitle: 11, tooltipBody: 10, legend: 10 };
  if (isCompactScreen()) return { tick: 10, tooltipTitle: 12, tooltipBody: 11, legend: 11 };
  return { tick: 11, tooltipTitle: 13, tooltipBody: 12, legend: 12 };
}

export function resizeAllCharts() {
  const fonts = chartFontSizes();
  const compact = isCompactScreen();

  Object.values(instances).forEach((chart) => {
    if (!chart?.options) return;

    if (chart.options.plugins?.tooltip) {
      chart.options.plugins.tooltip.titleFont = {
        ...chart.options.plugins.tooltip.titleFont,
        size: fonts.tooltipTitle,
      };
      chart.options.plugins.tooltip.bodyFont = {
        ...chart.options.plugins.tooltip.bodyFont,
        size: fonts.tooltipBody,
      };
      chart.options.plugins.tooltip.padding = compact ? 8 : 12;
    }

    if (chart.options.plugins?.legend?.labels) {
      chart.options.plugins.legend.labels.font = { size: fonts.legend };
    }

    ['x', 'y', 'y1', 'y2'].forEach((axisKey) => {
      const axis = chart.options.scales?.[axisKey];
      if (!axis?.ticks) return;
      axis.ticks.font = { ...axis.ticks.font, size: fonts.tick };
      axis.ticks.maxRotation = compact ? 45 : 0;
      axis.ticks.autoSkipPadding = compact ? 8 : 16;
      if (compact) axis.ticks.maxTicksLimit = axisKey === 'x' ? 6 : 5;
    });

    chart.resize();
    chart.update('none');
  });
}

// Common chart defaults
function baseOptions(t) {
  const fonts = chartFontSizes();
  const compact = isCompactScreen();

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        titleColor: t.textPrimary,
        bodyColor: t.textMuted,
        padding: compact ? 8 : 12,
        cornerRadius: 10,
        titleFont: { family: "'Space Grotesk', sans-serif", weight: '600', size: fonts.tooltipTitle },
        bodyFont: { family: "'Inter', sans-serif", size: fonts.tooltipBody },
      },
    },
    scales: {
      x: {
        grid: { color: t.gridColor, drawBorder: false },
        ticks: {
          color: t.tickColor,
          font: { size: fonts.tick, family: "'Inter', sans-serif" },
          maxRotation: compact ? 45 : 0,
          autoSkipPadding: compact ? 8 : 16,
          maxTicksLimit: compact ? 6 : undefined,
        },
        border: { display: false },
      },
      y: {
        grid: { color: t.gridColor, drawBorder: false },
        ticks: {
          color: t.tickColor,
          font: { size: fonts.tick, family: "'Inter', sans-serif" },
          maxTicksLimit: compact ? 5 : undefined,
        },
        border: { display: false },
      },
    },
    animation: { duration: 600, easing: 'easeInOutQuart' },
  };
}

// ── NAV History Chart ─────────────────────────────────────────────────────────

export function renderNavChart(filteredNav, parseDate) {
  const canvas = document.getElementById('navChart');
  if (!canvas) return;
  destroyChart('nav');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  // Sample to max 365 points for performance
  const maxPts = 365;
  const step = Math.max(1, Math.floor(filteredNav.length / maxPts));
  const sampled = filteredNav.filter((_, i) => i % step === 0);
  if (sampled[sampled.length - 1] !== filteredNav[filteredNav.length - 1]) {
    sampled.push(filteredNav[filteredNav.length - 1]);
  }

  const labels = sampled.map(item => {
    const d = parseDate(item.date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  });
  const navs = sampled.map(item => parseFloat(item.nav));

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 320);
  gradient.addColorStop(0, t.isDark ? 'rgba(59,130,246,0.35)' : 'rgba(37,99,235,0.2)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');

  const opts = baseOptions(t);
  opts.plugins.tooltip.callbacks = {
    title: items => sampled[items[0].dataIndex]?.date || '',
    label: item => ` NAV: ₹${item.raw.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
  };
  opts.scales.y.ticks.callback = v => `₹${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`;

  instances.nav = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: navs,
        borderColor: t.blue,
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: t.blue,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }],
    },
    options: opts,
  });
}

// ── Annual Bar Chart (Overview) ───────────────────────────────────────────────

export function renderAnnualBarChart(annualReturns) {
  const canvas = document.getElementById('annualBarChart');
  if (!canvas) return;
  destroyChart('annualBar');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  const labels = annualReturns.map(r => String(r.year));
  const values = annualReturns.map(r => r.returnPct);
  const colors = values.map(v => v >= 0
    ? (t.isDark ? 'rgba(16,185,129,0.8)' : 'rgba(5,150,105,0.85)')
    : (t.isDark ? 'rgba(239,68,68,0.8)' : 'rgba(220,38,38,0.85)')
  );

  const opts = baseOptions(t);
  opts.interaction = { mode: 'index', intersect: false };
  opts.plugins.tooltip.callbacks = {
    label: item => ` Return: ${item.raw >= 0 ? '+' : ''}${item.raw.toFixed(2)}%`,
  };
  opts.scales.y.ticks.callback = v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;

  instances.annualBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: opts,
  });
}

// ── CAGR Bar Chart (Performance Tab) ─────────────────────────────────────────

export function renderCagrChart(cagrData) {
  const canvas = document.getElementById('cagrChart');
  if (!canvas) return;
  destroyChart('cagr');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  const valid = cagrData.filter(r => r.cagr !== null);
  const labels = valid.map(r => r.label.replace(' Years', 'Y').replace(' Year', 'Y').replace('Since Inception', 'Inception'));
  const values = valid.map(r => r.cagr);

  // Gradient per bar
  const barColors = values.map((v, i) => {
    const hue = i / (values.length - 1);
    const colors = [t.blue, t.teal, t.green, t.purple, t.orange, t.blueLight];
    return colors[i % colors.length];
  });

  const opts = baseOptions(t);
  opts.indexAxis = 'y';
  opts.plugins.tooltip.callbacks = {
    label: item => ` CAGR: ${item.raw.toFixed(2)}%`,
  };
  opts.scales.x.ticks.callback = v => `${v}%`;
  opts.scales.y.grid = { display: false };

  instances.cagr = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: barColors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: opts,
  });
}

// ── Rolling Returns Line Chart ────────────────────────────────────────────────

export function renderRollingChart(rollingData, windowYears) {
  const canvas = document.getElementById('rollingChart');
  if (!canvas) return;
  destroyChart('rolling');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  // Sample to ~300 points for performance
  const maxPts = 300;
  const step = Math.max(1, Math.floor(rollingData.length / maxPts));
  const sampled = rollingData.filter((_, i) => i % step === 0);

  const labels = sampled.map(r => {
    const parts = r.endDate.split('-');
    return `${parts[2]}-${parts[1]}`;
  });
  const values = sampled.map(r => parseFloat(r.cagr.toFixed(2)));

  // Gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 320);
  gradient.addColorStop(0, t.isDark ? 'rgba(59,130,246,0.3)' : 'rgba(37,99,235,0.15)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');

  // 12% reference line data
  const ref12 = new Array(labels.length).fill(12);

  const opts = baseOptions(t);
  opts.plugins.legend = {
    display: true,
    position: 'top',
    align: 'end',
    labels: {
      color: t.tickColor,
      font: { size: 12, family: "'Inter', sans-serif" },
      boxWidth: 10, boxHeight: 10, borderRadius: 5,
      usePointStyle: true, pointStyle: 'circle',
    },
  };
  opts.plugins.tooltip.callbacks = {
    title: items => `End: ${sampled[items[0].dataIndex]?.endDate || ''}\nStart: ${sampled[items[0].dataIndex]?.startDate || ''}`,
    label: item => item.datasetIndex === 0
      ? ` ${windowYears}Y CAGR: ${item.raw.toFixed(2)}%`
      : ` 12% Reference`,
  };
  opts.scales.y.ticks.callback = v => `${v}%`;

  instances.rolling = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `${windowYears}Y Rolling CAGR`,
          data: values,
          borderColor: t.blue,
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: t.blue,
        },
        {
          label: '12% Target',
          data: ref12,
          borderColor: t.orange,
          borderWidth: 1.5,
          borderDash: [6, 4], // Note: Chart.js 4 uses segment.borderDash but borderDash on dataset also works
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          pointRadius: 0,
          segment: { borderDash: [6, 4] },
        },
      ],
    },
    options: opts,
  });
}

// ── Alpha Bar Chart ───────────────────────────────────────────────────────────

export function renderAlphaChart(alphaData) {
  const canvas = document.getElementById('alphaChart');
  if (!canvas) return;
  destroyChart('alpha');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  const labels = alphaData.map(a => String(a.year));
  const fundRets = alphaData.map(a => parseFloat(a.fundReturn.toFixed(2)));
  const benchRets = alphaData.map(a => parseFloat(a.benchReturn.toFixed(2)));
  const alphas = alphaData.map(a => parseFloat(a.alpha.toFixed(2)));
  const alphaColors = alphas.map(v => v >= 0
    ? (t.isDark ? 'rgba(16,185,129,0.85)' : 'rgba(5,150,105,0.9)')
    : (t.isDark ? 'rgba(239,68,68,0.85)' : 'rgba(220,38,38,0.9)')
  );

  const opts = baseOptions(t);
  opts.plugins.legend = {
    display: true,
    position: 'top',
    align: 'end',
    labels: {
      color: t.tickColor,
      font: { size: 12, family: "'Inter', sans-serif" },
      boxWidth: 10, boxHeight: 10, borderRadius: 5,
      usePointStyle: true, pointStyle: 'circle',
    },
  };
  opts.plugins.tooltip.callbacks = {
    label: item => {
      if (item.datasetIndex === 0) return ` Fund: ${item.raw >= 0 ? '+' : ''}${item.raw.toFixed(2)}%`;
      if (item.datasetIndex === 1) return ` Index: ${item.raw >= 0 ? '+' : ''}${item.raw.toFixed(2)}%`;
      return ` Alpha: ${item.raw >= 0 ? '+' : ''}${item.raw.toFixed(2)}%`;
    },
  };
  opts.scales.y.ticks.callback = v => `${v >= 0 ? '+' : ''}${v}%`;

  instances.alpha = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Fund Return',
          data: fundRets,
          backgroundColor: t.isDark ? 'rgba(59,130,246,0.5)' : 'rgba(37,99,235,0.4)',
          borderRadius: 3,
          borderSkipped: false,
        },
        {
          label: 'Index',
          data: benchRets,
          backgroundColor: t.isDark ? 'rgba(100,116,139,0.4)' : 'rgba(148,163,184,0.5)',
          borderRadius: 3,
          borderSkipped: false,
        },
        {
          label: 'Alpha',
          data: alphas,
          backgroundColor: alphaColors,
          borderRadius: 4,
          borderSkipped: false,
          type: 'bar',
        },
      ],
    },
    options: opts,
  });
}

// ── Drawdown Chart ────────────────────────────────────────────────────────────

export function renderDrawdownChart(drawdownSeries) {
  const canvas = document.getElementById('drawdownChart');
  if (!canvas) return;
  destroyChart('drawdown');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  // Sample to 300 points
  const maxPts = 300;
  const step = Math.max(1, Math.floor(drawdownSeries.length / maxPts));
  const sampled = drawdownSeries.filter((_, i) => i % step === 0);

  const labels = sampled.map(s => {
    const parts = s.date.split('-');
    return `${parts[2]}-${parts[1]}`;
  });
  const values = sampled.map(s => parseFloat(s.drawdown.toFixed(2)));

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 280);
  gradient.addColorStop(0, t.isDark ? 'rgba(239,68,68,0.4)' : 'rgba(220,38,38,0.25)');
  gradient.addColorStop(1, 'rgba(239,68,68,0)');

  const opts = baseOptions(t);
  opts.plugins.tooltip.callbacks = {
    title: items => sampled[items[0].dataIndex]?.date || '',
    label: item => ` Drawdown: ${item.raw.toFixed(2)}%`,
  };
  opts.scales.y.ticks.callback = v => `${v}%`;
  opts.scales.y.reverse = false;

  instances.drawdown = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: t.red,
        borderWidth: 1.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: t.red,
      }],
    },
    options: opts,
  });
}

// ── Gauge (Doughnut semicircle) ───────────────────────────────────────────────

/**
 * Draw a semi-circular gauge using native Canvas API
 * @param {string} canvasId
 * @param {number} value  - normalized 0..1 (clipped)
 * @param {string} color  - arc color
 */
export function renderGauge(canvasId, value, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const t = getTheme();
  const wrap = canvas.closest('.gauge-wrap');
  const W = canvas.width = Math.max(80, Math.round(wrap?.clientWidth || canvas.offsetWidth || 160));
  const H = canvas.height = Math.max(40, Math.round(W * 0.52));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H * 0.92;
  const R = Math.min(W * 0.44, H * 0.85);
  const lw = Math.max(8, R * 0.22);
  const norm = Math.max(0, Math.min(1, value));

  // Track (background arc)
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 0, false);
  ctx.lineWidth = lw;
  ctx.strokeStyle = t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Value arc
  const startAngle = Math.PI;
  const endAngle = Math.PI + norm * Math.PI;
  ctx.beginPath();
  ctx.arc(cx, cy, R, startAngle, endAngle, false);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Needle
  const angle = startAngle + norm * Math.PI;
  const nx = cx + (R * 0.72) * Math.cos(angle);
  const ny = cy + (R * 0.72) * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, lw * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Render all four risk gauges
 * @param {{ beta, sharpe, sortino, stdDevAnnual }} metrics
 */
export function renderRiskGauges(metrics) {
  const t = getTheme();

  // Beta gauge: range 0–2, 1 = market
  if (metrics.beta !== null && isFinite(metrics.beta)) {
    const norm = Math.min(1, Math.max(0, metrics.beta / 2));
    const color = metrics.beta < 0.8 ? t.green : metrics.beta > 1.2 ? t.red : t.orange;
    renderGauge('betaGauge', norm, color);
    const el = document.getElementById('beta-value');
    if (el) el.textContent = metrics.beta.toFixed(2);
    const badge = document.getElementById('beta-badge');
    if (badge) {
      if (metrics.beta < 0.8) { badge.textContent = 'Low Risk'; badge.className = 'risk-badge low'; }
      else if (metrics.beta > 1.2) { badge.textContent = 'High Risk'; badge.className = 'risk-badge high'; }
      else { badge.textContent = 'Market Risk'; badge.className = 'risk-badge medium'; }
    }
  } else {
    ['betaGauge', 'beta-value', 'beta-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { if (id === 'betaGauge') renderGauge(id, 0, t.tickColor); else el.textContent = 'N/A'; }
    });
    const b = document.getElementById('beta-badge');
    if (b) { b.textContent = 'N/A'; b.className = 'risk-badge na'; }
  }

  // Sharpe gauge: range -1 to 3 → norm = (value + 1) / 4
  if (metrics.sharpe !== null && isFinite(metrics.sharpe)) {
    const norm = Math.min(1, Math.max(0, (metrics.sharpe + 1) / 4));
    const color = metrics.sharpe < 0 ? t.red : metrics.sharpe < 1 ? t.orange : t.green;
    renderGauge('sharpeGauge', norm, color);
    const el = document.getElementById('sharpe-value');
    if (el) el.textContent = metrics.sharpe.toFixed(2);
    const badge = document.getElementById('sharpe-badge');
    if (badge) {
      if (metrics.sharpe < 0) { badge.textContent = 'Poor'; badge.className = 'risk-badge bad'; }
      else if (metrics.sharpe < 1) { badge.textContent = 'Fair'; badge.className = 'risk-badge medium'; }
      else if (metrics.sharpe < 2) { badge.textContent = 'Good'; badge.className = 'risk-badge good'; }
      else { badge.textContent = 'Excellent'; badge.className = 'risk-badge low'; }
    }
  } else {
    setGaugeNA('sharpeGauge', 'sharpe-value', 'sharpe-badge');
  }

  // Sortino gauge: range -1 to 4 → norm = (value + 1) / 5
  if (metrics.sortino !== null && isFinite(metrics.sortino)) {
    const norm = Math.min(1, Math.max(0, (metrics.sortino + 1) / 5));
    const color = metrics.sortino < 0 ? t.red : metrics.sortino < 1 ? t.orange : t.green;
    renderGauge('sortinoGauge', norm, color);
    const el = document.getElementById('sortino-value');
    if (el) el.textContent = metrics.sortino.toFixed(2);
    const badge = document.getElementById('sortino-badge');
    if (badge) {
      if (metrics.sortino < 0) { badge.textContent = 'Poor'; badge.className = 'risk-badge bad'; }
      else if (metrics.sortino < 1) { badge.textContent = 'Fair'; badge.className = 'risk-badge medium'; }
      else if (metrics.sortino < 2) { badge.textContent = 'Good'; badge.className = 'risk-badge good'; }
      else { badge.textContent = 'Excellent'; badge.className = 'risk-badge low'; }
    }
  } else {
    setGaugeNA('sortinoGauge', 'sortino-value', 'sortino-badge');
  }

  // Std Dev gauge: range 0–40%
  if (metrics.stdDevAnnual !== null && isFinite(metrics.stdDevAnnual)) {
    const norm = Math.min(1, Math.max(0, metrics.stdDevAnnual / 40));
    const color = metrics.stdDevAnnual < 10 ? t.green : metrics.stdDevAnnual < 20 ? t.orange : t.red;
    renderGauge('stddevGauge', norm, color);
    const el = document.getElementById('stddev-value');
    if (el) el.textContent = metrics.stdDevAnnual.toFixed(1) + '%';
    const badge = document.getElementById('stddev-badge');
    if (badge) {
      if (metrics.stdDevAnnual < 10) { badge.textContent = 'Low Vol'; badge.className = 'risk-badge low'; }
      else if (metrics.stdDevAnnual < 20) { badge.textContent = 'Med Vol'; badge.className = 'risk-badge medium'; }
      else { badge.textContent = 'High Vol'; badge.className = 'risk-badge high'; }
    }
  } else {
    setGaugeNA('stddevGauge', 'stddev-value', 'stddev-badge');
  }
}

function setGaugeNA(gaugeId, valId, badgeId) {
  const t = getTheme();
  renderGauge(gaugeId, 0, t.tickColor);
  const v = document.getElementById(valId);
  if (v) v.textContent = 'N/A';
  const b = document.getElementById(badgeId);
  if (b) { b.textContent = 'N/A'; b.className = 'risk-badge na'; }
}

/** Re-render all active charts on theme change */
export function refreshChartsOnThemeChange() {
  destroyAll();
}

// ── Period Returns Chart ──────────────────────────────────────────────────────

export function renderPeriodReturnsChart(periodData) {
  const canvas = document.getElementById('periodReturnsChart');
  if (!canvas) return;
  destroyChart('periodReturns');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  // Filter out periods with insufficient history
  const validData = periodData.filter(item => item.startNav !== null);
  const labels = validData.map(item => item.label);
  const absoluteSeries = validData.map(item => item.absReturn);
  const averageSeries = validData.map(item => {
    // Only plot CAGR/Annualized return for periods >= 1 year to prevent crazy short-term scaling
    if (item.years >= 0.95 && item.avgReturn !== null) {
      return item.avgReturn;
    }
    return null; // Don't draw the bar
  });

  const opts = baseOptions(t);
  opts.plugins.tooltip.callbacks = {
    label: item => {
      const val = item.raw;
      if (val === null) return null;
      return ` ${item.dataset.label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
    }
  };
  opts.scales.y.ticks.callback = v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;

  instances.periodReturns = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Absolute Return',
          data: absoluteSeries,
          backgroundColor: t.isDark ? 'rgba(59,130,246,0.85)' : 'rgba(37,99,235,0.9)',
          borderRadius: 4,
        },
        {
          label: 'Average Return (CAGR)',
          data: averageSeries,
          backgroundColor: t.isDark ? 'rgba(6,182,212,0.85)' : 'rgba(8,145,178,0.9)',
          borderRadius: 4,
        }
      ]
    },
    options: opts
  });
}

// ── Yearly Returns Chart ──────────────────────────────────────────────────────

export function renderYearlyReturnsChart(yearlyData) {
  const canvas = document.getElementById('yearlyReturnsChart');
  if (!canvas) return;
  destroyChart('yearlyReturns');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  const labels = yearlyData.map(item => String(item.year));
  const absoluteSeries = yearlyData.map(item => item.returnPct);
  const averageSeries = yearlyData.map(item => item.avgReturnPct);

  const opts = baseOptions(t);
  opts.plugins.tooltip.callbacks = {
    label: item => {
      const val = item.raw;
      if (val === null) return null;
      return ` ${item.dataset.label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
    }
  };
  opts.scales.y.ticks.callback = v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;

  instances.yearlyReturns = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Absolute Return',
          data: absoluteSeries,
          backgroundColor: t.isDark ? 'rgba(59,130,246,0.85)' : 'rgba(37,99,235,0.9)',
          borderRadius: 4,
        },
        {
          label: 'Average Return (Annualized)',
          data: averageSeries,
          backgroundColor: t.isDark ? 'rgba(6,182,212,0.85)' : 'rgba(8,145,178,0.9)',
          borderRadius: 4,
        }
      ]
    },
    options: opts
  });
}

// ── Comparison Charts ─────────────────────────────────────────────────────────

export function renderCompareNavChart(navA, navB, nameA, nameB, parseDate) {
  const canvas = document.getElementById('cmpNavChart');
  if (!canvas) return;
  destroyChart('cmpNav');
  const t = getTheme();
  const ctx = canvas.getContext('2d');

  // Find overlapping date range or use longer one
  const maxPts = 300;
  const sample = (arr) => {
    const step = Math.max(1, Math.floor(arr.length / maxPts));
    return arr.filter((_, i) => i % step === 0);
  };

  // Use dates from Fund A as primary axis labels (or longer one)
  const sampledA = sample(navA);
  const labels = sampledA.map(item => {
    const d = parseDate(item.date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  });

  const getPoints = (navArr) => {
    const s = sample(navArr);
    return s.map(item => parseFloat(item.nav));
  };

  const opts = baseOptions(t);
  opts.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: t.textMuted, usePointStyle: true, boxWidth: 8 } };
  opts.scales.y.ticks.callback = v => `₹${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`;

  instances.cmpNav = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: nameA, data: getPoints(navA), borderColor: t.blue, borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false },
        { label: nameB, data: getPoints(navB), borderColor: t.teal, borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }
      ]
    },
    options: opts
  });
}

export function renderCompareCagrChart(cagrsA, cagrsB, nameA, nameB) {
  const canvas = document.getElementById('cmpCagrChart');
  if (!canvas) return;
  destroyChart('cmpCagr');
  const t = getTheme();

  const labels = cagrsA.filter(r => r.cagr !== null).map(r => r.label.replace(' Years', 'Y').replace('Since Inception', 'Inc.'));
  const dataA = cagrsA.filter(r => r.cagr !== null).map(r => r.cagr);
  const dataB = cagrsB.filter(r => r.cagr !== null).map(r => r.cagr);

  const opts = baseOptions(t);
  opts.indexAxis = 'y';
  opts.plugins.legend = { display: true, position: 'bottom', labels: { color: t.textMuted, usePointStyle: true, boxWidth: 8 } };

  instances.cmpCagr = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: nameA, data: dataA, backgroundColor: t.blue, borderRadius: 4 },
        { label: nameB, data: dataB, backgroundColor: t.teal, borderRadius: 4 }
      ]
    },
    options: opts
  });
}

export function renderCompareAnnualChart(annualA, annualB, nameA, nameB) {
  const canvas = document.getElementById('cmpAnnualChart');
  if (!canvas) return;
  destroyChart('cmpAnnual');
  const t = getTheme();

  const years = [...new Set([...annualA.map(r => r.year), ...annualB.map(r => r.year)])].sort((a, b) => a - b);
  const dataA = years.map(y => annualA.find(r => r.year === y)?.returnPct ?? null);
  const dataB = years.map(y => annualB.find(r => r.year === y)?.returnPct ?? null);

  const opts = baseOptions(t);
  opts.plugins.legend = { display: true, position: 'top', labels: { color: t.textMuted, usePointStyle: true, boxWidth: 8 } };

  instances.cmpAnnual = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: years.map(String),
      datasets: [
        { label: nameA, data: dataA, backgroundColor: t.blue, borderRadius: 4 },
        { label: nameB, data: dataB, backgroundColor: t.teal, borderRadius: 4 }
      ]
    },
    options: opts
  });
}

export function renderCompareAlphaChart(alphaA, alphaB, nameA, nameB) {
  const canvas = document.getElementById('cmpAlphaChart');
  if (!canvas) return;
  destroyChart('cmpAlpha');
  const t = getTheme();

  const years = [...new Set([...alphaA.map(r => r.year), ...alphaB.map(r => r.year)])].sort((a, b) => a - b);
  const dataA = years.map(y => {
    const v = alphaA.find(r => r.year === y)?.alpha;
    return v != null ? parseFloat(v.toFixed(2)) : null;
  });
  const dataB = years.map(y => {
    const v = alphaB.find(r => r.year === y)?.alpha;
    return v != null ? parseFloat(v.toFixed(2)) : null;
  });

  const opts = baseOptions(t);
  opts.plugins.legend = { display: true, labels: { color: t.textMuted, usePointStyle: true, boxWidth: 8 } };
  opts.plugins.tooltip = {
    ...opts.plugins.tooltip,
    callbacks: {
      label: (item) => {
        const v = item.raw;
        if (v == null) return `${item.dataset.label}: N/A`;
        return ` ${item.dataset.label}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
      },
    },
  };

  instances.cmpAlpha = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: years.map(String),
      datasets: [
        { label: `${nameA} α`, data: dataA, backgroundColor: t.blue, borderRadius: 4 },
        { label: `${nameB} α`, data: dataB, backgroundColor: t.teal, borderRadius: 4 },
      ],
    },
    options: opts,
  });
}

export function renderCompareRollingChart(rollingA, rollingB, windowYears, nameA, nameB) {
  const canvas = document.getElementById('cmpRollingChart');
  if (!canvas) return;
  destroyChart('cmpRolling');
  const t = getTheme();

  // Align by periodLabel
  const periodMap = new Map();
  rollingA.forEach(r => {
    periodMap.set(r.periodLabel, { a: r.cagr, b: null });
  });
  rollingB.forEach(r => {
    if (periodMap.has(r.periodLabel)) {
      periodMap.get(r.periodLabel).b = r.cagr;
    } else {
      periodMap.set(r.periodLabel, { a: null, b: r.cagr });
    }
  });

  const sortedPeriods = [...periodMap.keys()].sort((p1, p2) => {
    const y1 = parseInt(p1.split('–')[0]);
    const y2 = parseInt(p2.split('–')[0]);
    return y1 - y2;
  });

  const dataA = sortedPeriods.map(p => periodMap.get(p).a);
  const dataB = sortedPeriods.map(p => periodMap.get(p).b);

  const opts = baseOptions(t);
  opts.plugins.legend = { display: true, labels: { color: t.textMuted, usePointStyle: true, boxWidth: 8 } };

  opts.plugins.tooltip.callbacks = {
    title: items => {
      const idx = items[0].dataIndex;
      return `Period: ${sortedPeriods[idx]}`;
    },
    label: item => {
      const val = item.raw;
      if (val === null) return `${item.dataset.label}: N/A`;
      return ` ${item.dataset.label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
    }
  };

  instances.cmpRolling = new Chart(canvas, {
    type: 'line',
    data: {
      labels: sortedPeriods,
      datasets: [
        { label: nameA, data: dataA, borderColor: t.blue, borderWidth: 2, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, fill: false },
        { label: nameB, data: dataB, borderColor: t.teal, borderWidth: 2, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, fill: false }
      ]
    },
    options: opts
  });
}

export function renderCompareDrawdownChart(ddA, ddB, nameA, nameB) {
  const canvas = document.getElementById('cmpDrawdownChart');
  if (!canvas) return;
  destroyChart('cmpDrawdown');
  const t = getTheme();

  const dates = [...new Set([...ddA.map(s => s.date), ...ddB.map(s => s.date)])].sort((d1, d2) => {
    const [d, m, y] = d1.split('-').map(Number);
    const [d_, m_, y_] = d2.split('-').map(Number);
    return new Date(y, m - 1, d) - new Date(y_, m_ - 1, d_);
  });

  const sampleDates = dates.filter((_, i) => i % (Math.max(1, Math.floor(dates.length / 80))) === 0);
  const dataA = sampleDates.map(d => ddA.find(s => s.date === d)?.drawdown ?? null);
  const dataB = sampleDates.map(d => ddB.find(s => s.date === d)?.drawdown ?? null);

  const opts = baseOptions(t);
  opts.plugins.legend = { display: true, labels: { color: t.textMuted, usePointStyle: true, boxWidth: 8 } };

  instances.cmpDrawdown = new Chart(canvas, {
    type: 'line',
    data: {
      labels: sampleDates.map(d => d.split('-').slice(1).join('-')),
      datasets: [
        { label: nameA, data: dataA, borderColor: t.blue, borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
        { label: nameB, data: dataB, borderColor: t.teal, borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 }
      ]
    },
    options: opts
  });
}


