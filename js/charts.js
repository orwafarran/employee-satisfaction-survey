/**
 * Chart helpers (Chart.js doughnuts — the client's "circles").
 */
(function () {
  'use strict';

  // Scale colours: SD, D, A, SA — must match css variables.
  const SCALE_COLORS = ['#dc2626', '#f59e0b', '#38bdf8', '#0d7d72'];
  const SCALE_LABELS = ['Strongly Disagree', 'Disagree', 'Agree', 'Strongly Agree'];

  // Categorical palette for demographic charts.
  const CAT_COLORS = [
    '#0d7d72', '#38bdf8', '#6366f1', '#f59e0b', '#ec4899',
    '#14b8a6', '#a855f7', '#84cc16', '#ef4444', '#0ea5e9',
  ];

  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    Chart.defaults.plugins.legend.display = false;
  }

  function makeDoughnut(canvas, labels, data, colors, opts) {
    opts = opts || {};
    return new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderColor: '#fff',
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: opts.cutout || '62%',
        animation: opts.animate === false ? false : { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                const v = ctx.parsed;
                const pct = ((v / total) * 100).toFixed(1);
                return ` ${ctx.label}: ${v} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // Distribution donut across the 4 scale levels.
  function distributionDonut(canvas, counts, opts) {
    return makeDoughnut(canvas, SCALE_LABELS, counts, SCALE_COLORS, opts);
  }

  // Categorical donut for demographics.
  function categoryDonut(canvas, labels, values, opts) {
    const colors = labels.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]);
    return makeDoughnut(canvas, labels, values, colors, opts);
  }

  window.Charts = {
    SCALE_COLORS,
    SCALE_LABELS,
    CAT_COLORS,
    distributionDonut,
    categoryDonut,
  };
})();
