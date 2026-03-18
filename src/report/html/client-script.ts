/**
 * Client-side JavaScript for the HTML report
 *
 * Theme toggling, view switching, test filtering, modal interaction,
 * and telemetry chart rendering — all embedded in the report.
 *
 * @module report/html/client-script
 */

/**
 * Returns the self-contained JavaScript block that is injected into
 * the HTML report. The script relies on two global variables being
 * declared before it runs:
 *
 * ```js
 * const tests   = [ ... ]; // TestSummary[]
 * const metrics = [ ... ]; // NormalizedSystemMetrics[]
 * ```
 */
export function getClientScript(): string {
  return `
    // ── State ──────────────────────────────────────────────
    let currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);

    // ── Theme ──────────────────────────────────────────────
    function toggleTheme() {
      currentTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', currentTheme);
      localStorage.setItem('theme', currentTheme);
      if (document.getElementById('view-telemetry')?.classList.contains('active')) {
        setTimeout(renderTelemetryChart, 0);
      }
    }

    // ── View switching ─────────────────────────────────────
    function switchView(viewId) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      event.currentTarget.classList.add('active');

      document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
      document.getElementById('view-' + viewId).classList.add('active');

      const titles = {
        overview:  'Dashboard Overview',
        tests:     'Test Suite',
        insights:  'AI & Pattern Insights',
        telemetry: 'System Telemetry'
      };
      document.getElementById('page-title').innerText = titles[viewId];

      if (viewId === 'telemetry') {
        setTimeout(renderTelemetryChart, 100);
      }
    }

    // ── Test filtering ───────────────────────────────────
    function filterByStatus(status) {
      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
        if (chip.dataset.filter === status) chip.classList.add('active');
      });

      document.querySelectorAll('#testList .test-card').forEach(card => {
        if (status === 'all') {
          card.style.display = 'flex';
        } else {
          const s = card.dataset.status;
          card.style.display = (s === status || (status === 'failed' && s === 'timedOut'))
            ? 'flex' : 'none';
        }
      });
    }

    function filterTests() {
      const term = document.getElementById('testSearch').value.toLowerCase();
      document.querySelectorAll('#testList .test-card').forEach(card => {
        const title = card.dataset.title || '';
        card.style.display = title.includes(term) ? 'flex' : 'none';
      });
    }

    // ── Modal ────────────────────────────────────────────
    function openTestModal(testId) {
      const test = tests.find(t => t.testId === testId);
      if (!test) return;

      document.getElementById('modal-title').innerText = test.title;

      let body = '<div style="margin-bottom: 1rem">'
        + '<span class="badge ' + (test.status === 'failed' || test.status === 'timedOut' ? 'badge-danger' : 'badge-success') + '">' + test.status + '</span>'
        + '<span style="margin-left:0.5rem;color:var(--text-secondary)">' + test.duration + 'ms</span>'
        + (test.retries > 0 ? '<span style="margin-left:0.5rem;color:var(--color-flaky)">🔄 ' + test.retries + ' retries</span>' : '')
        + '</div>';

      if (test.error) {
        body += '<h4>Error</h4>'
          + '<div class="error-message">' + test.error.message + '\\n' + (test.error.stack || '') + '</div>';
      }

      if (test.attachments && test.attachments.length) {
        body += '<h4 style="margin-top:1rem">Attachments</h4><div class="attachments">';
        test.attachments.forEach(att => {
          body += '<a href="' + att.path + '" target="_blank" class="attachment-link">📎 ' + att.name + '</a>';
        });
        body += '</div>';
      }

      document.getElementById('modal-body').innerHTML = body;
      document.getElementById('detail-modal').classList.add('open');
    }

    function closeModal(e) {
      if (e.target === document.getElementById('detail-modal')) {
        document.getElementById('detail-modal').classList.remove('open');
      }
    }

    // ── Telemetry charts ─────────────────────────────────
    function renderTelemetryChart() {
      if (!metrics.length) return;

      renderChart('cpuChart', metrics, {
        getValue: m => m.cpu.load1,
        color: '#ef4444',
        label: 'CPU Load',
        threshold: 4,
        maxValue: Math.max(...metrics.map(m => m.cpu.load1), 5)
      });

      renderChart('memoryChart', metrics, {
        getValue: m => m.process.rssMb,
        color: '#8b5cf6',
        label: 'Memory (MB)',
        threshold: null,
        maxValue: Math.max(...metrics.map(m => m.process.rssMb))
      });

      populateMetricsTable();
    }

    function renderChart(canvasId, data, config) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;

      const container = canvas.parentElement;
      const containerWidth = container ? container.getBoundingClientRect().width : 600;
      const minPxPerPoint  = 10;
      const paddingCss     = 80;
      const desiredCssWidth = Math.max(containerWidth, paddingCss + Math.max(0, (data.length - 1)) * minPxPerPoint);
      canvas.style.width = desiredCssWidth + 'px';

      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      const width  = rect.width;
      const height = rect.height;
      const padding = { top: 20, right: 20, bottom: 40, left: 60 };
      const chartWidth  = width  - padding.left - padding.right;
      const chartHeight = height - padding.top  - padding.bottom;

      const isDark   = document.documentElement.getAttribute('data-theme') === 'dark';
      const gridColor = isDark ? '#334155' : '#e2e8f0';
      const textColor = isDark ? '#94a3b8' : '#64748b';
      const bgColor   = isDark ? '#1e293b' : '#ffffff';

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      const maxValue = config.maxValue * 1.1;
      const xScale = chartWidth / (data.length - 1 || 1);
      const yScale = chartHeight / maxValue;

      // Grid lines
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      const gridLines = 5;
      for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartHeight * i / gridLines);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = textColor;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText((maxValue * (1 - i / gridLines)).toFixed(1), padding.left - 10, y + 4);
      }

      // Threshold
      if (config.threshold !== null) {
        const thresholdY = padding.top + chartHeight - (config.threshold * yScale);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padding.left, thresholdY);
        ctx.lineTo(width - padding.right, thresholdY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Data line
      ctx.strokeStyle = config.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      data.forEach((point, i) => {
        const x = padding.left + (i * xScale);
        const v = config.getValue(point);
        const y = padding.top + chartHeight - (v * yScale);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Points & spikes
      const avg = data.reduce((s, m) => s + config.getValue(m), 0) / data.length;
      const spikeAt = avg * 1.5;

      data.forEach((point, i) => {
        const x = padding.left + (i * xScale);
        const v = config.getValue(point);
        const y = padding.top + chartHeight - (v * yScale);

        ctx.fillStyle = config.color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        if (v > spikeAt || (config.threshold && v > config.threshold)) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#dc2626';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('⚠️', x, y - 15);
        }
      });

      ctx.fillStyle = textColor;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Time (sample points)', width / 2, height - 10);
    }

    window.addEventListener('resize', () => {
      if (document.getElementById('view-telemetry')?.classList.contains('active')) {
        renderTelemetryChart();
      }
    });

    function populateMetricsTable() {
      const tbody = document.getElementById('metricsTableBody');
      if (!tbody || !metrics.length) return;

      const avgCpu = metrics.reduce((s, m) => s + m.cpu.load1, 0) / metrics.length;
      const cpuTh  = avgCpu * 1.5;
      const avgMem = metrics.reduce((s, m) => s + m.process.rssMb, 0) / metrics.length;
      const memTh  = avgMem * 1.3;

      tbody.innerHTML = metrics.map(m => {
        const d = new Date(m.timestamp);
        const dateStr = d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
        const timeStr = d.toLocaleTimeString();
        const off = -d.getTimezoneOffset();
        const tz = 'UTC' + (off >= 0 ? '+' : '-')
          + String(Math.floor(Math.abs(off) / 60)).padStart(2, '0') + ':'
          + String(Math.abs(off) % 60).padStart(2, '0');

        const cpuSpike = m.cpu.load1 > cpuTh || m.cpu.load1 > 4;
        const memSpike = m.process.rssMb > memTh;
        const spike    = cpuSpike || memSpike;

        return '<tr style="border-bottom:1px solid var(--border-color);background:' + (spike ? 'rgba(239,68,68,0.05)' : 'transparent') + ';">'
          + '<td style="padding:0.75rem;color:var(--text-primary);font-family:monospace;font-size:0.8rem;">' + dateStr + ' ' + timeStr + ' (' + tz + ')</td>'
          + '<td style="padding:0.75rem;text-align:right;color:' + (cpuSpike ? 'var(--color-danger)' : 'var(--text-primary)') + ';font-weight:' + (cpuSpike ? 'bold' : 'normal') + ';">' + m.cpu.load1.toFixed(2) + '</td>'
          + '<td style="padding:0.75rem;text-align:right;color:var(--text-secondary);">' + (m.cpu.userPct?.toFixed(1) || 'N/A') + '</td>'
          + '<td style="padding:0.75rem;text-align:right;color:var(--text-secondary);">' + (m.cpu.systemPct?.toFixed(1) || 'N/A') + '</td>'
          + '<td style="padding:0.75rem;text-align:right;color:' + (memSpike ? 'var(--color-danger)' : 'var(--text-primary)') + ';font-weight:' + (memSpike ? 'bold' : 'normal') + ';">' + m.process.rssMb.toFixed(0) + '</td>'
          + '<td style="padding:0.75rem;color:var(--text-primary);">' + (spike ? '⚠️ Spike' : '✓ Normal') + '</td>'
          + '</tr>';
      }).join('');
    }
  `;
}
