// Server-rendered SPA shell for /omar-dash. No external CSS framework
// — Tailwind's Play CDN uses runtime eval() which CSP blocks. All
// styling is inline CSS in the <style> block; layout primitives are
// semantic classes plus a handful of utility-style helpers
// (.flex, .col, .gap-N, etc.) defined ourselves.
//
// Five views: Submissions / Places / Users / Reports / Stats. Side
// nav on desktop, horizontal pill bar on mobile via a single media
// query.

export function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PortSaid Guide — Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  /* ── Reset + base ───────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: white;
    background: #0a0e1a;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  button { font: inherit; cursor: pointer; border: none; background: none; color: inherit; }
  input { font: inherit; color: white; }
  input::placeholder { color: rgba(255,255,255,0.4); }
  input:focus { outline: 1px solid rgba(255,149,85,0.5); }
  table { border-collapse: collapse; width: 100%; }

  /* ── Background aurora (matches mobile app) ─────────────────── */
  .aurora {
    position: fixed; inset: 0; z-index: -1; overflow: hidden;
    background:
      radial-gradient(circle at 20% 30%, rgba(255, 140, 90, 0.18), transparent 50%),
      radial-gradient(circle at 80% 60%, rgba(80, 180, 220, 0.18), transparent 50%),
      radial-gradient(circle at 50% 100%, rgba(200, 100, 220, 0.12), transparent 60%),
      #0a0e1a;
  }

  /* ── Layout container + responsive sidebar ──────────────────── */
  .container { max-width: 1280px; margin: 0 auto; padding: 24px 16px; }
  .header {
    display: flex; flex-direction: column; gap: 16px;
    margin-bottom: 24px;
  }
  .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
  .header h1 .grad {
    background: linear-gradient(135deg, #ff9555, #ff6b9d);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .header .sub { color: rgba(255,255,255,0.5); font-size: 13px; margin-top: 4px; }
  .layout { display: flex; flex-direction: column; gap: 24px; }
  .sidebar {
    flex-shrink: 0;
    display: flex; flex-direction: row; gap: 4px;
    overflow-x: auto;
    padding: 6px;
  }
  .sidebar::-webkit-scrollbar { display: none; }
  .sidebar { -ms-overflow-style: none; scrollbar-width: none; }
  .main-content { flex: 1; min-width: 0; }
  @media (min-width: 880px) {
    .container { padding: 32px 32px; }
    .header { flex-direction: row; align-items: center; justify-content: space-between; }
    .header h1 { font-size: 28px; }
    .layout { flex-direction: row; }
    .sidebar { flex-direction: column; width: 220px; position: sticky; top: 16px; }
  }

  /* ── Glass surfaces ─────────────────────────────────────────── */
  .glass {
    background: rgba(255,255,255,0.04);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
  }
  .glass-strong {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 16px;
  }

  /* ── Side nav items ─────────────────────────────────────────── */
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 10px;
    color: rgba(255,255,255,0.7); font-weight: 600; font-size: 14px;
    cursor: pointer; transition: background 0.15s, color 0.15s;
    white-space: nowrap; border: 1px solid transparent;
  }
  .nav-item:hover { background: rgba(255,255,255,0.06); color: white; }
  .nav-item.active {
    background: rgba(255, 149, 85, 0.18);
    color: white;
    border-color: rgba(255, 149, 85, 0.40);
  }

  /* ── Buttons ────────────────────────────────────────────────── */
  .btn { padding: 8px 16px; border-radius: 10px; font-weight: 600; font-size: 13px; transition: background 0.15s, transform 0.15s, box-shadow 0.15s; }
  .btn-primary {
    background: linear-gradient(135deg, #ff9555, #ff6b9d);
    color: white; font-weight: 700;
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255,130,130,0.30); }
  .btn-ghost {
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85);
    border: 1px solid rgba(255,255,255,0.10);
  }
  .btn-ghost:hover { background: rgba(255,255,255,0.10); }
  .btn-danger {
    background: rgba(255,70,70,0.16); color: #ff8a82;
    border: 1px solid rgba(255,100,100,0.30); font-weight: 700;
  }
  .btn-danger:hover { background: rgba(255,70,70,0.22); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }

  /* ── Tabs (used inside views) ───────────────────────────────── */
  .tab-row { display: flex; gap: 8px; padding: 8px; margin-bottom: 16px; overflow-x: auto; }
  .tab-row::-webkit-scrollbar { display: none; }
  .tab-row { -ms-overflow-style: none; scrollbar-width: none; }
  .tab { white-space: nowrap; }
  .tab.active {
    background: rgba(255, 149, 85, 0.18) !important;
    border-color: rgba(255, 149, 85, 0.50) !important;
  }

  /* ── Pills ──────────────────────────────────────────────────── */
  .pill {
    display: inline-block;
    padding: 2px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
  }
  .pill-pending   { background: rgba(255,200,50,0.18); color: #ffd060; }
  .pill-approved  { background: rgba(80,220,130,0.18); color: #6cf09a; }
  .pill-rejected  { background: rgba(255,110,100,0.18); color: #ff8a82; }
  .pill-duplicate { background: rgba(120,160,255,0.18); color: #97b6ff; }
  .pill-open      { background: rgba(255,110,100,0.18); color: #ff8a82; }
  .pill-resolved  { background: rgba(80,220,130,0.18); color: #6cf09a; }
  .pill-ghost     { background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.70); }

  /* ── Cards (list items) ─────────────────────────────────────── */
  .card { padding: 20px; }
  .card + .card { margin-top: 12px; }
  .card .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .card .title { font-size: 16px; font-weight: 700; margin: 8px 0 0; }
  .card .meta { font-size: 11px; color: rgba(255,255,255,0.5); }
  .card .body { font-size: 12px; margin-top: 8px; color: rgba(255,255,255,0.7); }
  .card .url { color: #97b6ff; word-break: break-all; }
  .card .url:hover { text-decoration: underline; }
  .card .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .ai-block { margin-top: 12px; font-size: 12px; color: rgba(255,255,255,0.5); }
  .ai-block .reasoning { color: rgba(255,255,255,0.4); font-style: italic; margin-top: 4px; }
  .note-block { margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.5); }

  /* ── Table ──────────────────────────────────────────────────── */
  .tbl-wrap { overflow-x: auto; }
  .tbl { width: 100%; }
  .tbl th {
    padding: 12px; text-align: left;
    font-size: 11px; color: rgba(255,255,255,0.5);
    text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .tbl td {
    padding: 12px;
    font-size: 13px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .tbl tr:hover td { background: rgba(255,255,255,0.03); }
  .tbl .place-id { color: rgba(255,255,255,0.4); font-size: 11px; font-family: ui-monospace, monospace; margin-top: 2px; }
  .tbl .avatar { width: 28px; height: 28px; border-radius: 50%; vertical-align: middle; margin-right: 8px; object-fit: cover; }
  .tbl .avatar-placeholder { display: inline-block; width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.10); vertical-align: middle; margin-right: 8px; }

  /* ── Filters row ────────────────────────────────────────────── */
  .filters {
    padding: 16px; margin-bottom: 16px;
    display: flex; flex-wrap: wrap; gap: 8px;
  }
  .filters input {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    min-width: 180px;
  }
  .filters .grow { flex: 1; }
  .filters .hint { width: 100%; font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; }

  /* ── Stats grid + cards ─────────────────────────────────────── */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  @media (min-width: 720px) {
    .stat-grid { grid-template-columns: repeat(4, 1fr); }
  }
  .stat-card { padding: 18px 20px; }
  .stat-label {
    font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.06em; color: rgba(255,255,255,0.5);
  }
  .stat-num {
    margin-top: 8px;
    font-size: 28px; font-weight: 800; line-height: 1;
    background: linear-gradient(135deg, #ff9555, #ff6b9d);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .stat-detail { padding: 20px; margin-top: 16px; }
  .stat-detail h3 { margin: 0 0 12px; font-size: 15px; font-weight: 700; }
  .stat-detail .row {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;
  }
  @media (min-width: 600px) {
    .stat-detail .row.cols-4 { grid-template-columns: repeat(4, 1fr); }
  }
  .stat-detail .item { font-size: 12px; color: rgba(255,255,255,0.6); }
  .stat-detail .item .big { display: block; font-size: 22px; font-weight: 800; margin-top: 4px; }
  .stat-detail .big-yellow { color: #ffd060; }
  .stat-detail .big-green { color: #6cf09a; }
  .stat-detail .big-red { color: #ff8a82; }
  .stat-detail .big-blue { color: #97b6ff; }

  /* ── Edit panel (expanded submission) ───────────────────────── */
  .edit-panel {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px dashed rgba(255,255,255,0.10);
    display: grid; gap: 12px;
  }
  .edit-panel .raw-block {
    background: rgba(0,0,0,0.25);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 10px 12px;
    font-family: ui-monospace, monospace;
    font-size: 11px; color: rgba(255,255,255,0.7);
    white-space: pre-wrap; word-break: break-word;
    max-height: 240px; overflow-y: auto;
  }
  .edit-panel .form-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  @media (min-width: 640px) {
    .edit-panel .form-grid { grid-template-columns: 1fr 1fr; }
    .edit-panel .form-grid .full { grid-column: 1 / -1; }
  }
  .edit-panel label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: 11px; color: rgba(255,255,255,0.5);
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
  }
  .edit-panel label input,
  .edit-panel label select,
  .edit-panel label textarea {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    color: white;
    text-transform: none; letter-spacing: 0;
    font-weight: 400;
  }
  .edit-panel label textarea { font-family: inherit; resize: vertical; }
  .edit-panel .hint {
    grid-column: 1 / -1;
    font-size: 11px; color: rgba(255,255,255,0.4);
  }
  .edit-panel .existing-place {
    grid-column: 1 / -1;
    background: rgba(80,220,130,0.10);
    border: 1px solid rgba(80,220,130,0.30);
    color: #b5f0c7;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
  }
  .edit-panel .save-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .edit-panel .status-msg {
    grid-column: 1 / -1;
    font-size: 12px;
    min-height: 14px;
  }
  .edit-panel .status-msg.ok { color: #6cf09a; }
  .edit-panel .status-msg.err { color: #ff8a82; }

  /* ── Empty / error states ───────────────────────────────────── */
  .empty {
    padding: 64px 24px; text-align: center;
    color: rgba(255,255,255,0.5); font-size: 14px;
  }
  .empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }
  .err { color: #ff8a82; padding: 16px; font-size: 13px; }

  /* ── Footer ─────────────────────────────────────────────────── */
  footer.app-footer {
    margin-top: 48px; padding-bottom: 24px;
    text-align: center; font-size: 11px;
    color: rgba(255,255,255,0.3);
  }

  /* ── View toggling ──────────────────────────────────────────── */
  [data-view-section] { display: none; }
  [data-view-section].active { display: block; }
</style>
</head>
<body>
<div class="aurora"></div>

<div class="container">
  <header class="header">
    <div>
      <h1><span class="grad">PortSaid Guide</span> <span style="color: rgba(255,255,255,0.7);">— Admin</span></h1>
      <div class="sub">Manage submissions, places, users, and reports.</div>
    </div>
    <button id="refreshBtn" class="btn btn-ghost" style="display: inline-flex; align-items: center; gap: 8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
      Refresh
    </button>
  </header>

  <div class="layout">
    <aside class="sidebar glass">
      <div class="nav-item active" data-view="submissions"><span>📋</span><span>Submissions</span></div>
      <div class="nav-item" data-view="places"><span>🗺️</span><span>All places</span></div>
      <div class="nav-item" data-view="users"><span>👤</span><span>Users</span></div>
      <div class="nav-item" data-view="reports"><span>🚩</span><span>Reports</span></div>
      <div class="nav-item" data-view="stats"><span>📊</span><span>Stats</span></div>
    </aside>

    <main class="main-content">
      <!-- Submissions -->
      <section data-view-section="submissions" class="active">
        <div class="tab-row glass">
          <button data-sub-status="pending" class="tab btn btn-ghost">Pending <span id="count-pending" style="opacity:0.6;font-size:11px;margin-left:4px;"></span></button>
          <button data-sub-status="approved" class="tab btn btn-ghost">Approved</button>
          <button data-sub-status="rejected" class="tab btn btn-ghost">Rejected</button>
          <button data-sub-status="duplicate" class="tab btn btn-ghost">Duplicates</button>
          <button data-sub-status="all" class="tab btn btn-ghost">All</button>
        </div>
        <div id="submissions-list"></div>
      </section>

      <!-- Places -->
      <section data-view-section="places">
        <div class="filters glass-strong">
          <input id="places-search" placeholder="Search title…" class="grow">
          <input id="places-main" placeholder="main slug (food, shopping…)">
          <input id="places-sub" placeholder="sub slug (coffee, bank…)">
          <button id="places-search-btn" class="btn btn-primary">Search</button>
          <div class="hint">'main' surfaces all sub-slugs of that main; 'sub' is exact match.</div>
        </div>
        <div class="glass-strong tbl-wrap">
          <table class="tbl" id="places-table">
            <thead><tr><th>Title</th><th>Type</th><th>Primary</th><th>Rating</th><th>Source</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <!-- Users -->
      <section data-view-section="users">
        <div class="glass-strong tbl-wrap">
          <table class="tbl" id="users-table">
            <thead><tr><th>User</th><th>Email</th><th>Joined</th><th>Last login</th><th>Submissions</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <!-- Reports -->
      <section data-view-section="reports">
        <div class="tab-row glass">
          <button data-rep-status="open" class="tab btn btn-ghost">Open</button>
          <button data-rep-status="resolved" class="tab btn btn-ghost">Resolved</button>
          <button data-rep-status="all" class="tab btn btn-ghost">All</button>
        </div>
        <div id="reports-list"></div>
      </section>

      <!-- Stats -->
      <section data-view-section="stats">
        <div class="stat-grid" id="stats-grid"></div>
        <div id="stats-detail"></div>
      </section>
    </main>
  </div>

  <footer class="app-footer">PortSaid Guide admin — protected by basic auth.</footer>
</div>

<script>
  // No external dependencies. All vanilla JS.
  var $ = function(s, r) { return (r || document).querySelector(s); };
  var $$ = function(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) { return iso; }
  }

  var currentView = 'submissions';
  var subStatus = 'pending';
  var repStatus = 'open';

  function setView(view) {
    currentView = view;
    $$('.nav-item').forEach(function(n) {
      n.classList.toggle('active', n.dataset.view === view);
    });
    $$('[data-view-section]').forEach(function(s) {
      s.classList.toggle('active', s.dataset.viewSection === view);
    });
    load(view);
  }

  function setSubStatus(s) {
    subStatus = s;
    $$('[data-sub-status]').forEach(function(t) {
      t.classList.toggle('active', t.dataset.subStatus === s);
    });
    loadSubmissions();
  }

  function setRepStatus(s) {
    repStatus = s;
    $$('[data-rep-status]').forEach(function(t) {
      t.classList.toggle('active', t.dataset.repStatus === s);
    });
    loadReports();
  }

  function load(view) {
    if (view === 'submissions') loadSubmissions();
    else if (view === 'places') loadPlaces();
    else if (view === 'users') loadUsers();
    else if (view === 'reports') loadReports();
    else if (view === 'stats') loadStats();
  }

  // ── Submissions ──
  function renderSubmission(it) {
    var v = it.ai_verdict || {};
    var conf = typeof v.confidence === 'number' ? (v.confidence * 100).toFixed(0) + '%' : '—';
    var aiBlock = it.ai_verdict
      ? '<div class="ai-block"><div><span style="color:rgba(255,255,255,0.7);">AI:</span> ' +
        escapeHtml(v.primary_slug || '—') +
        ' <span style="margin-left:8px;color:rgba(255,255,255,0.4);">conf: ' + conf + '</span></div>' +
        (v.reasoning ? '<div class="reasoning">"' + escapeHtml(v.reasoning).slice(0, 220) + '"</div>' : '') +
        '</div>'
      : '';
    var noteBlock = it.admin_note
      ? '<div class="note-block"><span style="color:rgba(255,255,255,0.7);">Note:</span> ' + escapeHtml(it.admin_note) + '</div>'
      : '';
    // Action row — every status gets a "Details / edit" toggle. Only
    // pending submissions get the Approve/Reject buttons; resolved
    // ones show their resolution metadata but the details panel is
    // still available so admins can audit what got recorded.
    var resolved = it.status !== 'pending'
      ? '<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.4);">Resolved ' + fmtDate(it.resolved_at) +
        (it.resolved_by ? ' by ' + escapeHtml(it.resolved_by) : '') + '</div>'
      : '';
    var pendingBtns = it.status === 'pending'
      ? '<button class="btn btn-primary approve-btn" data-id="' + it.id + '">Approve &amp; add</button>' +
        '<button class="btn btn-danger reject-btn" data-id="' + it.id + '">Reject</button>'
      : '';
    var actions =
      '<div class="card-footer" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">' +
      pendingBtns +
      '<button class="btn btn-ghost details-btn" data-id="' + it.id + '">Details / edit</button>' +
      '</div>';
    return '<div class="glass-strong card" data-card-id="' + it.id + '">' +
      '<div class="head"><span class="pill pill-' + it.status + '">' + it.status.toUpperCase() + '</span>' +
      '<span class="meta">' + fmtDate(it.submitted_at) + '</span></div>' +
      '<h3 class="title">' + escapeHtml(it.extracted_title || '(no extracted title)') + '</h3>' +
      (it.extracted_place_id
        ? '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px;font-family:ui-monospace,monospace;">place_id: ' + escapeHtml(it.extracted_place_id) + '</div>'
        : '') +
      '<div style="margin-top:8px;font-size:12px;"><a class="url" href="' + escapeHtml(it.submitted_url) + '" target="_blank" rel="noopener">' + escapeHtml(it.submitted_url) + '</a></div>' +
      aiBlock + noteBlock + resolved + actions +
      '<div class="edit-panel-mount" data-mount-id="' + it.id + '" style="display:none;"></div>' +
      '</div>';
  }
  function loadSubmissions() {
    var list = $('#submissions-list');
    list.innerHTML = '<div class="empty">Loading…</div>';
    fetch('/omar-dash/api/submissions?status=' + subStatus + '&limit=200', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        if (subStatus === 'pending') $('#count-pending').textContent = '(' + b.count + ')';
        list.innerHTML = b.items.length
          ? b.items.map(renderSubmission).join('')
          : '<div class="glass-strong empty"><div class="empty-icon">📭</div>Nothing here yet.</div>';
        wireSubActions();
      })
      .catch(function(e) { list.innerHTML = '<div class="err">Error: ' + escapeHtml(e.message) + '</div>'; });
  }
  function wireSubActions() {
    $$('.approve-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        var note = prompt('Optional note for this approval:') || '';
        b.disabled = true; b.textContent = '…';
        fetch('/omar-dash/api/submissions/' + b.dataset.id + '/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: note }),
          credentials: 'same-origin'
        })
          .then(function(r) { return r.json(); })
          .then(function(d) { if (!d.ok) throw new Error(d.error); loadSubmissions(); })
          .catch(function(e) { alert('Approve failed: ' + e.message); b.disabled = false; b.textContent = 'Approve & add'; });
      });
    });
    $$('.reject-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        var reason = prompt('Reason for rejection (visible to submitter):');
        if (!reason || !reason.trim()) return;
        b.disabled = true; b.textContent = '…';
        fetch('/omar-dash/api/submissions/' + b.dataset.id + '/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason }),
          credentials: 'same-origin'
        })
          .then(function(r) { return r.json(); })
          .then(function(d) { if (!d.ok) throw new Error(d.error); loadSubmissions(); })
          .catch(function(e) { alert('Reject failed: ' + e.message); b.disabled = false; b.textContent = 'Reject'; });
      });
    });
    $$('.details-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        toggleDetails(b.dataset.id, b);
      });
    });
  }

  // ── Submission detail / edit panel ──────────────────────────────
  //
  // toggleDetails(id, button): show or hide the inline edit panel
  // under the submission card. On first open we fetch the full doc
  // via GET /api/submissions/:id and render a form prefilled with
  // current values (extracted_* from scrape, or manual.* if the
  // admin previously edited). Save → PATCH; Approve here uses the
  // saved manual fields if the scrape produced nothing.
  function toggleDetails(id, btn) {
    var mount = document.querySelector('[data-mount-id="' + id + '"]');
    if (!mount) return;
    if (mount.style.display === 'block') {
      mount.style.display = 'none';
      btn.textContent = 'Details / edit';
      return;
    }
    btn.textContent = 'Loading…'; btn.disabled = true;
    fetch('/omar-dash/api/submissions/' + id, { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        mount.innerHTML = renderEditPanel(b);
        mount.style.display = 'block';
        wireEditPanel(mount, id);
      })
      .catch(function(e) {
        mount.innerHTML = '<div class="err">Couldn\\'t load details: ' + escapeHtml(e.message) + '</div>';
        mount.style.display = 'block';
      })
      .finally(function() {
        btn.disabled = false;
        btn.textContent = 'Hide details';
      });
  }

  // Render every raw field of the submission doc as read-only text,
  // then a form for the editable subset. The form starts prefilled
  // with manual.* values if present, otherwise with extracted_* /
  // parsed-URL hints — so an admin opening a brand-new submission
  // already sees lat/lon prefilled from the URL.
  function renderEditPanel(detail) {
    var raw = detail.raw || {};
    var parsed = detail.parsed_url || {};
    var manual = (raw.manual && typeof raw.manual === 'object') ? raw.manual : {};
    var existing = detail.existing_place;

    function field(label, name, value, opts) {
      opts = opts || {};
      var placeholder = opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : '';
      var cls = opts.full ? 'full' : '';
      var v = value == null ? '' : value;
      return '<label class="' + cls + '">' + escapeHtml(label) +
        '<input data-field="' + name + '" value="' + escapeHtml(String(v)) + '"' + placeholder + '></label>';
    }
    function selectField(label, name, value, options) {
      var opts = options.map(function(o) {
        var sel = (String(value) === o) ? ' selected' : '';
        return '<option value="' + escapeHtml(o) + '"' + sel + '>' + escapeHtml(o) + '</option>';
      }).join('');
      return '<label>' + escapeHtml(label) +
        '<select data-field="' + name + '"><option value=""></option>' + opts + '</select></label>';
    }

    var rawJson = JSON.stringify(raw, null, 2);
    var parsedJson = parsed && Object.keys(parsed).length
        ? JSON.stringify(parsed, null, 2)
        : '(URL re-parse not available)';

    var existingBanner = existing
      ? '<div class="existing-place">✓ A place with id <b>' + escapeHtml(existing.place_id) + '</b> already exists: <b>' +
        escapeHtml(existing.title || '(no title)') + '</b> — approving will back-ref onto it (won\\'t overwrite the place data).</div>'
      : '';

    // Prefill priority: manual override > extracted (scrape) > parsed URL hint.
    var pTitle = manual.title || raw.extracted_title || parsed.name_hint || '';
    var pPlaceId = manual.place_id || raw.extracted_place_id || parsed.place_hex_pair || '';
    var pLat = manual.lat != null ? manual.lat : (parsed.lat != null ? parsed.lat : '');
    var pLon = manual.lon != null ? manual.lon : (parsed.lon != null ? parsed.lon : '');
    var pType = manual.type || '';
    var pPrimary = manual.primary_slug || (raw.ai_verdict && raw.ai_verdict.primary_slug) || '';
    var pAddress = manual.address || '';
    var pPhone = manual.phone || '';
    var pThumb = manual.thumbnail || '';
    var pRating = manual.rating != null ? manual.rating : '';
    var pReviews = manual.reviews != null ? manual.reviews : '';
    var pCats = Array.isArray(manual.source_categories)
        ? manual.source_categories.join(', ')
        : (raw.ai_verdict && Array.isArray(raw.ai_verdict.source_categories)
            ? raw.ai_verdict.source_categories.join(', ')
            : '');

    var primarySlugOptions = [
      'coffee','restaurant','fast-food','fish-seafood','bakery','dessert','candy-store',
      'supermarket','grocery','mall','electronics','clothing','clothing-women','clothing-men','clothing-kids',
      'shoe-store','jewelry','bookstore','stationery','gift-shop','toy-store','florist',
      'pharmacy','clinic','hospital','dentist','veterinarian',
      'hotel','hostel',
      'bank','atm','money-exchange',
      'beach','park','cinema','gym','tourist-attr','amusement-park','water-park','playground','arcade',
      'mosque','church',
      'gas-station','car-wash','auto-repair','car-rental','parking',
      'other'
    ];

    return '<div class="edit-panel">' +
      '<div class="form-grid">' +
      existingBanner +
      '<div class="hint">Edit the fields the scraper missed. Save to persist, then Approve to publish. Lat/Lon prefilled from the URL when available.</div>' +
      field('Title', 'title', pTitle, { placeholder: 'Place name', full: true }) +
      field('Place ID (Google hex pair, optional)', 'place_id', pPlaceId, { placeholder: '0x14f99c...:0x5fd1...' , full: true }) +
      field('Latitude', 'lat', pLat, { placeholder: '31.2614' }) +
      field('Longitude', 'lon', pLon, { placeholder: '32.2811' }) +
      selectField('Primary slug (catalogue bucket)', 'primary_slug', pPrimary, primarySlugOptions) +
      field('Type (Google business type)', 'type', pType, { placeholder: 'Coffee shop / Bank / Cinema…' }) +
      field('Address', 'address', pAddress, { full: true }) +
      field('Phone', 'phone', pPhone) +
      field('Thumbnail URL', 'thumbnail', pThumb) +
      field('Rating (0–5)', 'rating', pRating) +
      field('Reviews count', 'reviews', pReviews) +
      field('Source categories (comma-sep slugs)', 'source_categories', pCats, { full: true, placeholder: 'coffee, bakery' }) +
      '<div class="save-row full">' +
        '<button class="btn btn-ghost panel-save-btn" data-id="' + detail.id + '">Save edits</button>' +
        (raw.status === 'pending'
          ? '<button class="btn btn-primary panel-approve-btn" data-id="' + detail.id + '">Save &amp; approve</button>'
          : '') +
      '</div>' +
      '<div class="status-msg" data-status-msg></div>' +
      '</div>' +
      '<details><summary style="cursor:pointer;font-size:12px;color:rgba(255,255,255,0.6);">Raw submission doc</summary>' +
      '<div class="raw-block">' + escapeHtml(rawJson) + '</div></details>' +
      '<details><summary style="cursor:pointer;font-size:12px;color:rgba(255,255,255,0.6);">Parsed URL hints</summary>' +
      '<div class="raw-block">' + escapeHtml(parsedJson) + '</div></details>' +
      '</div>';
  }

  function wireEditPanel(mount, id) {
    var msg = mount.querySelector('[data-status-msg]');
    function readForm() {
      var manual = {};
      $$('[data-field]', mount).forEach(function(el) {
        var v = el.value;
        if (v == null || v === '') return;
        manual[el.dataset.field] = v;
      });
      return manual;
    }
    function setMsg(text, cls) {
      if (!msg) return;
      msg.textContent = text;
      msg.className = 'status-msg ' + (cls || '');
    }
    function doSave() {
      var manual = readForm();
      setMsg('Saving…');
      return fetch('/omar-dash/api/submissions/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual: manual }),
        credentials: 'same-origin',
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.ok) throw new Error(d.error);
          setMsg('Saved.', 'ok');
        });
    }
    var saveBtn = mount.querySelector('.panel-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', function() {
      saveBtn.disabled = true;
      doSave()
        .catch(function(e) { setMsg('Save failed: ' + e.message, 'err'); })
        .finally(function() { saveBtn.disabled = false; });
    });
    var approveBtn = mount.querySelector('.panel-approve-btn');
    if (approveBtn) approveBtn.addEventListener('click', function() {
      approveBtn.disabled = true;
      doSave()
        .then(function() {
          setMsg('Approving…');
          return fetch('/omar-dash/api/submissions/' + id + '/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            credentials: 'same-origin',
          })
            .then(function(r) { return r.json(); })
            .then(function(d) {
              if (!d.ok) throw new Error(d.error);
              setMsg('Approved as ' + (d.place_id || '(no id)') + '. Reloading…', 'ok');
              setTimeout(loadSubmissions, 600);
            });
        })
        .catch(function(e) {
          setMsg('Approve failed: ' + e.message, 'err');
          approveBtn.disabled = false;
        });
    });
  }

  // ── Places ──
  function loadPlaces() {
    var search = $('#places-search').value.trim();
    var main = $('#places-main').value.trim();
    var sub = $('#places-sub').value.trim();
    var tbody = $('#places-table tbody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">Loading…</td></tr>';
    var params = new URLSearchParams({ limit: '200' });
    if (search) params.set('search', search);
    if (main) params.set('main', main);
    if (sub) params.set('sub', sub);
    fetch('/omar-dash/api/places?' + params.toString(), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        if (!b.items.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">No places match.</td></tr>';
          return;
        }
        tbody.innerHTML = b.items.map(function(p) {
          var rating = (p.rating != null)
            ? p.rating + ' ★ <span style="color:rgba(255,255,255,0.4);">(' + (p.reviews || 0) + ')</span>'
            : '—';
          return '<tr><td><div style="font-weight:600;">' + escapeHtml(p.title) + '</div><div class="place-id">' + escapeHtml(p.place_id) + '</div></td>' +
            '<td>' + escapeHtml(p.type || '—') + '</td>' +
            '<td>' + escapeHtml(p.primary_slug || '—') + '</td>' +
            '<td>' + rating + '</td>' +
            '<td><span class="pill pill-ghost">' + escapeHtml(p.created_via || 'scraper') + '</span></td></tr>';
        }).join('');
      })
      .catch(function(e) {
        tbody.innerHTML = '<tr><td colspan="5" class="err">Error: ' + escapeHtml(e.message) + '</td></tr>';
      });
  }

  // ── Users ──
  function loadUsers() {
    var tbody = $('#users-table tbody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">Loading…</td></tr>';
    fetch('/omar-dash/api/users?limit=200', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        if (!b.items.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">No users yet.</td></tr>';
          return;
        }
        tbody.innerHTML = b.items.map(function(u) {
          var avatar = u.photo_url
            ? '<img src="' + escapeHtml(u.photo_url) + '" class="avatar" alt="">'
            : '<span class="avatar-placeholder"></span>';
          return '<tr><td>' + avatar + '<span style="font-weight:600;vertical-align:middle;">' + escapeHtml(u.display_name || '(no name)') + '</span></td>' +
            '<td style="color:rgba(255,255,255,0.7);">' + escapeHtml(u.email || '—') + '</td>' +
            '<td style="color:rgba(255,255,255,0.5);">' + fmtDate(u.created_at) + '</td>' +
            '<td style="color:rgba(255,255,255,0.5);">' + fmtDate(u.last_login_at) + '</td>' +
            '<td><span class="pill ' + (u.submission_count > 0 ? 'pill-approved' : 'pill-ghost') + '">' + u.submission_count + '</span></td></tr>';
        }).join('');
      })
      .catch(function(e) {
        tbody.innerHTML = '<tr><td colspan="5" class="err">Error: ' + escapeHtml(e.message) + '</td></tr>';
      });
  }

  // ── Reports ──
  function renderReport(it) {
    var noteBlock = it.note
      ? '<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.6);">' + escapeHtml(it.note) + '</div>'
      : '';
    var action = it.status === 'open'
      ? '<button class="btn btn-primary resolve-btn" data-id="' + it.id + '" style="margin-top:12px;">Mark resolved</button>'
      : '';
    return '<div class="glass-strong card">' +
      '<div class="head"><span class="pill pill-' + it.status + '">' + it.status.toUpperCase() + '</span>' +
      '<span class="meta">' + fmtDate(it.created_at) + '</span></div>' +
      '<div style="font-weight:600;font-size:13px;">' + escapeHtml(it.reason) +
      ' <span style="color:rgba(255,255,255,0.4);font-size:11px;">on</span> ' +
      '<span style="font-family:ui-monospace,monospace;font-size:11px;color:rgba(255,255,255,0.6);">' + escapeHtml(it.place_id) + '</span></div>' +
      noteBlock +
      '<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.4);">by ' + escapeHtml(it.reported_by_email || it.reported_by_uid) + '</div>' +
      action + '</div>';
  }
  function loadReports() {
    var list = $('#reports-list');
    list.innerHTML = '<div class="empty">Loading…</div>';
    fetch('/omar-dash/api/reports?status=' + repStatus + '&limit=200', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        list.innerHTML = b.items.length
          ? b.items.map(renderReport).join('')
          : '<div class="glass-strong empty"><div class="empty-icon">🚩</div>Nothing here.</div>';
        $$('.resolve-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            btn.disabled = true; btn.textContent = '…';
            fetch('/omar-dash/api/reports/' + btn.dataset.id + '/resolve', {
              method: 'POST', credentials: 'same-origin'
            })
              .then(function(r) { return r.json(); })
              .then(function(d) { if (!d.ok) throw new Error(d.error); loadReports(); })
              .catch(function(e) { alert('Resolve failed: ' + e.message); btn.disabled = false; btn.textContent = 'Mark resolved'; });
          });
        });
      })
      .catch(function(e) { list.innerHTML = '<div class="err">Error: ' + escapeHtml(e.message) + '</div>'; });
  }

  // ── Stats ──
  function loadStats() {
    var grid = $('#stats-grid');
    var detail = $('#stats-detail');
    grid.innerHTML = '<div style="color:rgba(255,255,255,0.5);grid-column:1/-1;">Loading…</div>';
    detail.innerHTML = '';
    fetch('/omar-dash/api/stats', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        var cards = [
          ['Places', b.places],
          ['Users', b.users],
          ['Pending submissions', b.submissions.pending],
          ['Open reports', b.reports.open]
        ];
        grid.innerHTML = cards.map(function(c) {
          return '<div class="glass-strong stat-card">' +
            '<div class="stat-label">' + escapeHtml(c[0]) + '</div>' +
            '<div class="stat-num">' + c[1] + '</div></div>';
        }).join('');
        detail.innerHTML =
          '<div class="glass-strong stat-detail"><h3>Submissions</h3><div class="row cols-4">' +
          '<div class="item">Pending<span class="big big-yellow">' + b.submissions.pending + '</span></div>' +
          '<div class="item">Approved<span class="big big-green">' + b.submissions.approved + '</span></div>' +
          '<div class="item">Rejected<span class="big big-red">' + b.submissions.rejected + '</span></div>' +
          '<div class="item">Duplicates<span class="big big-blue">' + b.submissions.duplicate + '</span></div>' +
          '</div></div>' +
          '<div class="glass-strong stat-detail"><h3>Reports</h3><div class="row">' +
          '<div class="item">Open<span class="big big-red">' + b.reports.open + '</span></div>' +
          '<div class="item">Resolved<span class="big big-green">' + b.reports.resolved + '</span></div>' +
          '</div></div>';
      })
      .catch(function(e) {
        grid.innerHTML = '<div class="err" style="grid-column:1/-1;">Error: ' + escapeHtml(e.message) + '</div>';
      });
  }

  // ── Wire-up ──
  $$('.nav-item').forEach(function(n) {
    n.addEventListener('click', function() { setView(n.dataset.view); });
  });
  $$('[data-sub-status]').forEach(function(t) {
    t.addEventListener('click', function() { setSubStatus(t.dataset.subStatus); });
  });
  $$('[data-rep-status]').forEach(function(t) {
    t.addEventListener('click', function() { setRepStatus(t.dataset.repStatus); });
  });
  $('#refreshBtn').addEventListener('click', function() { load(currentView); });
  $('#places-search-btn').addEventListener('click', loadPlaces);
  $('#places-search').addEventListener('keydown', function(e) { if (e.key === 'Enter') loadPlaces(); });

  setSubStatus('pending');
  setRepStatus('open');
  setView('submissions');
</script>
</body>
</html>`;
}
