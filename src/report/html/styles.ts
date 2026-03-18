/**
 * HTML Report CSS Styles
 *
 * All CSS variables, resets, component styles, and theme definitions
 * used by the Playwright Oracle Reporter HTML output.
 *
 * @module report/html/styles
 */

/**
 * Returns the complete CSS stylesheet for the report.
 *
 * @param gradeColor - CSS colour value for the health-score grade badge
 */
export function getHtmlStyles(gradeColor: string): string {
  return `
    :root {
      /* Base Colors */
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-sidebar: #ffffff;
      --bg-hover: #f1f5f9;
      --text-primary: #1e293b;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --border-color: #e2e8f0;
      --border-hover: #cbd5e1;

      /* Brand Colors */
      --brand-primary: #6366f1;
      --brand-secondary: #818cf8;
      --brand-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --brand-gradient-hover: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%);
      --brand-gradient-subtle: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%);

      /* Status Colors */
      --color-success: #10b981;
      --color-success-light: #d1fae5;
      --color-warning: #f59e0b;
      --color-warning-light: #fef3c7;
      --color-danger: #ef4444;
      --color-danger-light: #fee2e2;
      --color-info: #3b82f6;
      --color-info-light: #dbeafe;
      --color-flaky: #f97316;
      --color-flaky-light: #ffedd5;

      /* Shadows */
      --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.03);
      --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
      --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);

      /* Layout */
      --sidebar-width: 280px;
      --header-height: 72px;
      --content-max-width: 1600px;

      /* Transitions */
      --transition-base: 0.2s ease;

      /* Radii */
      --border-radius-md: 8px;
      --border-radius-lg: 12px;
    }

    [data-theme="dark"] {
      --bg-primary: #0a0e1a;
      --bg-secondary: #131826;
      --bg-tertiary: #1a2030;
      --bg-sidebar: #0f1420;
      --bg-hover: #1e2736;
      --bg-elevated: #1a2030;
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #94a3b8;
      --text-inverse: #0f172a;
      --border-color: #1e293b;
      --border-hover: #334155;
      --border-focus: #6366f1;

      --brand-gradient-subtle: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%);

      --color-success-light: rgba(16, 185, 129, 0.12);
      --color-warning-light: rgba(245, 158, 11, 0.12);
      --color-danger-light: rgba(239, 68, 68, 0.12);
      --color-info-light: rgba(99, 102, 241, 0.1);
      --color-flaky-light: rgba(249, 115, 22, 0.12);

      --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.6);
      --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.7), 0 1px 2px 0 rgb(0 0 0 / 0.3);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.7), 0 2px 4px -1px rgb(0 0 0 / 0.3);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.7), 0 4px 6px -2px rgb(0 0 0 / 0.3);
      --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.8), 0 10px 10px -5px rgb(0 0 0 / 0.2);
      --shadow-focus: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Helvetica Neue', sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      display: flex;
      line-height: 1.65;
      font-size: 15px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      letter-spacing: -0.011em;
    }

    /* ===== SIDEBAR ===== */
    .sidebar {
      width: var(--sidebar-width);
      background-color: var(--bg-sidebar);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      padding: 2rem 1.5rem;
      z-index: 20;
      box-shadow: inset -1px 0 0 0 var(--border-color);
      backdrop-filter: blur(8px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      font-weight: 700;
      font-size: 1.125rem;
      color: var(--text-primary);
      margin-bottom: 2.5rem;
      padding: 0.5rem;
      letter-spacing: -0.02em;
    }

    .brand-icon {
      width: 44px;
      height: 44px;
      background: var(--brand-gradient);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 1.25rem;
      font-weight: 800;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    .nav-section { margin-bottom: 1.5rem; }

    .nav-section-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      padding: 0 1rem;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 1.125rem;
      border-radius: var(--border-radius-md);
      color: var(--text-secondary);
      cursor: pointer;
      margin-bottom: 0.375rem;
      font-weight: 500;
      font-size: 0.9375rem;
      transition: all var(--transition-base);
      position: relative;
    }

    .nav-item:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
      transform: translateX(2px);
    }

    .nav-item.active {
      background: var(--brand-gradient-subtle);
      color: var(--brand-primary);
      font-weight: 600;
      box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1);
    }

    .nav-item.active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 24px;
      background: var(--brand-gradient);
      border-radius: 0 3px 3px 0;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.4);
    }

    .nav-icon { font-size: 1.25rem; width: 24px; text-align: center; }

    .health-card {
      margin-top: auto;
      background: var(--brand-gradient-subtle);
      border-radius: var(--border-radius-lg);
      padding: 1.75rem;
      border: 1px solid var(--border-color);
      text-align: center;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(8px);
    }

    .health-score {
      font-size: 3rem;
      font-weight: 800;
      color: ${gradeColor};
      line-height: 1;
      margin: 0.75rem 0;
      letter-spacing: -0.02em;
    }

    .health-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
    }

    .health-score-value {
      font-size: 0.875rem;
      color: var(--text-secondary);
      font-weight: 600;
      margin-top: 0.5rem;
    }

    /* ===== MAIN CONTENT ===== */
    .main {
      flex: 1;
      overflow-y: auto;
      padding: 0;
      background-color: var(--bg-primary);
      scroll-behavior: smooth;
    }

    .content-wrapper {
      max-width: var(--content-max-width);
      margin: 0 auto;
      padding: 2.5rem 3rem;
      min-height: calc(100vh - 80px);
    }

    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-color);
    }

    .header-title h1 {
      font-size: 1.875rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
      letter-spacing: -0.02em;
    }

    .header-meta {
      color: var(--text-muted);
      font-size: 0.875rem;
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .header-meta-item { display: flex; align-items: center; gap: 0.25rem; }

    .actions { display: flex; gap: 0.75rem; align-items: center; }

    .btn {
      padding: 0.625rem 1.25rem;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.15s ease;
      box-shadow: var(--shadow-xs);
    }

    .btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-hover);
      box-shadow: var(--shadow-sm);
    }

    .btn:active { transform: translateY(1px); }

    .btn-primary { background: var(--brand-gradient); border: none; color: white; }
    .btn-primary:hover { background: var(--brand-gradient-hover); }

    /* ===== CARDS & GRID ===== */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }

    .card {
      background: var(--bg-secondary);
      border-radius: var(--border-radius-lg);
      padding: 1.75rem;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-sm);
      transition: all var(--transition-base);
    }

    .card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-3px);
      border-color: var(--border-hover);
    }

    .card h2 {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 1.25rem;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .card h3 {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: var(--text-primary);
    }

    .stat-card { position: relative; overflow: hidden; }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: var(--stat-color, var(--brand-primary));
    }

    .stat-value {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0.5rem 0;
      color: var(--text-primary);
      line-height: 1;
      letter-spacing: -0.02em;
    }

    .stat-label {
      color: var(--text-secondary);
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-change {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
      margin-top: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      background: var(--bg-primary);
    }

    .stat-change.positive { color: var(--color-success); }
    .stat-change.negative { color: var(--color-danger); }

    /* ===== QUICK INSIGHTS ===== */
    .insights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }

    .insight-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .insight-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0;
      width: 4px; height: 100%;
      background: var(--insight-color, var(--brand-primary));
    }

    .insight-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-4px);
      border-color: var(--insight-color);
    }

    .insight-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }

    .insight-icon { font-size: 2rem; line-height: 1; }

    .insight-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .insight-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
      line-height: 1;
    }

    .insight-subtitle { font-size: 0.875rem; color: var(--text-muted); }

    /* ===== TEST LIST ===== */
    .test-list { display: flex; flex-direction: column; gap: 0.75rem; }

    .test-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-md);
      padding: 1.375rem;
      cursor: pointer;
      transition: all var(--transition-base);
      position: relative;
      border-left: 3px solid var(--test-status-color, var(--color-info));
    }

    .test-card:hover {
      transform: translateX(6px);
      box-shadow: var(--shadow-lg);
      border-color: var(--test-status-color);
    }

    .test-card.passed { --test-status-color: var(--color-success); }
    .test-card.failed { --test-status-color: var(--color-danger); }
    .test-card.flaky  { --test-status-color: var(--color-flaky); }
    .test-card.skipped { --test-status-color: var(--text-muted); }

    .test-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }

    .test-title {
      font-weight: 600;
      font-size: 1rem;
      color: var(--text-primary);
      flex: 1;
      line-height: 1.4;
    }

    .test-meta {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .test-meta-item { display: flex; align-items: center; gap: 0.375rem; }

    /* ===== BADGES ===== */
    .badge {
      padding: 0.375rem 0.875rem;
      border-radius: 6px;
      font-size: 0.6875rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
      border: 1px solid transparent;
      transition: all var(--transition-base);
    }

    .badge-danger  { background: var(--color-danger-light);  color: var(--color-danger);  border-color: rgba(239, 68, 68, 0.2); }
    .badge-success { background: var(--color-success-light); color: var(--color-success); }
    .badge-warning { background: var(--color-warning-light); color: var(--color-warning); }
    .badge-info    { background: var(--color-info-light);    color: var(--color-info); }
    .badge-flaky   { background: var(--color-flaky-light);   color: var(--color-flaky); }

    /* ===== FILTERS ===== */
    .filter-bar {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-group { display: flex; gap: 0.5rem; align-items: center; }

    .filter-chip {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .filter-chip:hover { background: var(--bg-hover); border-color: var(--border-hover); }
    .filter-chip.active { background: var(--brand-primary); color: white; border-color: var(--brand-primary); }

    .search-box { flex: 1; max-width: 400px; position: relative; }

    .search-box input {
      width: 100%;
      padding: 0.625rem 1rem 0.625rem 2.5rem;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 0.875rem;
      transition: all 0.15s ease;
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--brand-primary);
      box-shadow: 0 0 0 3px var(--color-info-light);
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 1rem;
    }

    /* ===== SECTIONS ===== */
    .view-section { display: none; animation: fadeIn 0.3s ease; }
    .view-section.active { display: block; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .section {
      background: var(--bg-secondary);
      border-radius: 12px;
      padding: 1.5rem;
      border: 1px solid var(--border-color);
      margin-bottom: 1.5rem;
      box-shadow: var(--shadow-sm);
    }

    .section h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem; }
    .section h3 { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-primary); }
    .section h4 { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-secondary); }
    .section p  { color: var(--text-secondary); line-height: 1.6; margin-bottom: 0.75rem; }

    /* ===== AI & SPECIAL CONTENT ===== */
    .ai-insight {
      background: linear-gradient(135deg, var(--color-info-light) 0%, var(--color-flaky-light) 100%);
      border: 2px solid var(--brand-primary);
      border-radius: 12px;
      padding: 1.5rem;
      position: relative;
      overflow: hidden;
    }

    .ai-insight::before { content: '✨'; position: absolute; top: 1rem; right: 1rem; font-size: 2rem; opacity: 0.3; }

    .cause-card {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 1.25rem;
      margin-bottom: 1rem;
      border-left: 4px solid var(--brand-primary);
    }

    .test-item {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .test-item.failed { border-left: 4px solid var(--color-danger); }
    .test-item .test-title { font-weight: 600; font-size: 1rem; margin-bottom: 0.5rem; color: var(--text-primary); }
    .test-item .test-file  { font-size: 0.875rem; color: var(--text-secondary); font-family: monospace; margin-bottom: 0.25rem; }
    .test-item .test-duration { font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem; }

    .cause-card h4 { color: var(--text-primary); }

    .error-message {
      background: var(--color-danger-light);
      border-left: 4px solid var(--color-danger);
      padding: 1rem;
      border-radius: 6px;
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-size: 0.875rem;
      color: var(--text-primary);
      margin: 0.75rem 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .attachments { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }

    .attachment-link {
      padding: 0.5rem 1rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--brand-primary);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .attachment-link:hover {
      background: var(--brand-primary);
      color: white;
      box-shadow: var(--shadow-sm);
    }

    /* ===== CHARTS ===== */
    .chart-container {
      height: 280px;
      margin: 1rem 0;
      position: relative;
      background: var(--bg-primary);
      border-radius: 8px;
      padding: 1rem;
      overflow-x: auto;
      overflow-y: hidden;
    }

    canvas { display: block; height: 100%; width: auto; }

    .chart-legend {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 0.5rem;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .legend-item { display: flex; align-items: center; gap: 0.4rem; }
    .legend-swatch { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }
    .legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .legend-threshold { width: 20px; height: 0; border-top: 2px dashed #f59e0b; display: inline-block; }

    /* ===== FOOTER ===== */
    .footer {
      margin-top: 4rem;
      padding: 2.5rem 0;
      border-top: 1px solid var(--border-color);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    .footer-brand { margin-bottom: 0.625rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
    .footer-copyright { color: var(--text-muted); }

    .pattern-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
    }

    .ai-summary {
      background: linear-gradient(to right, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08));
      border-left: 4px solid var(--brand-primary);
      padding: 1.5rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
    }

    .ai-summary h3 { font-size: 1.25rem; margin-bottom: 0.75rem; color: var(--text-primary); }
    .ai-summary p  { line-height: 1.6; color: var(--text-primary); }

    .confidence-badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .confidence-high { background: rgba(16, 185, 129, 0.1); color: var(--color-success); }
    .confidence-med  { background: rgba(245, 158, 11, 0.1); color: var(--color-warning); }

    /* ===== MODAL ===== */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }

    .modal-overlay.open { display: flex; }

    .modal-content {
      background: var(--bg-secondary);
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-lg);
    }

    .modal-header {
      padding: 1.5rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-body { padding: 1.5rem; overflow-y: auto; }

    pre {
      background: var(--bg-primary);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      font-family: monospace;
      font-size: 0.875rem;
    }
  `;
}
