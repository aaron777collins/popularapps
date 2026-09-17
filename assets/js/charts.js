/* Rankwatch chart layer. Chart.js v4 loads as a classic deferred script,
   so Chart is a global here. All colors are read from CSS custom properties
   at creation time so charts follow the active theme. */

/* global Chart */
import { formatShortDate } from './data.js';

export function getChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const cssVar = (name) => styles.getPropertyValue(name).trim();
  return {
    fontFamily: "'Inter', system-ui, sans-serif",
    textSecondary: cssVar('--text-secondary'),
    border: cssVar('--border'),
    surface: cssVar('--surface'),
    seriesFree: cssVar('--series-free'),
    seriesPaid: cssVar('--series-paid'),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

export function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  const theme = getChartTheme();
  Chart.defaults.font.family = theme.fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = theme.textSecondary;
  Chart.defaults.animation = theme.reducedMotion ? false : { duration: 150 };
}

export function createDonut(canvas, { free = 0, paid = 0 } = {}) {
  if (typeof Chart === 'undefined' || !canvas) return null;
  applyChartDefaults();
  const theme = getChartTheme();
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Free', 'Paid'],
      datasets: [{
        data: [free, paid],
        backgroundColor: [theme.seriesFree, theme.seriesPaid],
        borderColor: theme.surface,
        borderWidth: 2,
        hoverOffset: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: theme.reducedMotion ? false : { duration: 150 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const data = context.dataset.data ?? [];
              const total = data.reduce((sum, value) => sum + value, 0) || 1;
              const pct = Math.round((context.parsed / total) * 100);
              return `${context.label}: ${context.parsed} of ${total} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

export function updateDonut(chart, { free = 0, paid = 0 } = {}) {
  if (!chart || typeof chart.update !== 'function') return;
  chart.data.datasets[0].data = [free, paid];
  chart.update();
}

export function createRankLine(canvas, points = []) {
  if (typeof Chart === 'undefined' || !canvas) return null;
  applyChartDefaults();
  const theme = getChartTheme();
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map((point) => formatShortDate(point.date)),
      datasets: [{
        data: points.map((point) => point.rank),
        borderColor: theme.seriesFree,
        backgroundColor: theme.seriesFree,
        pointBackgroundColor: theme.seriesFree,
        pointBorderColor: theme.surface,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 5,
        borderWidth: 2,
        borderJoinStyle: 'round',
        fill: false,
        tension: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: theme.reducedMotion ? false : { duration: 150 },
      scales: {
        x: {
          grid: { color: theme.border },
          border: { display: false },
          ticks: {
            color: theme.textSecondary,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
          },
        },
        y: {
          reverse: true,
          grace: '10%',
          grid: { color: theme.border },
          border: { display: false },
          ticks: {
            color: theme.textSecondary,
            precision: 0,
            font: { variant: 'tabular-nums' },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Rank ${context.parsed.y}`,
          },
        },
      },
    },
  });
}

export function destroyDonut(chart) {
  if (chart && typeof chart.destroy === 'function') chart.destroy();
}

export function destroyRankLine(chart) {
  if (chart && typeof chart.destroy === 'function') chart.destroy();
}
