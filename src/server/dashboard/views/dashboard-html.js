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
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0a0e1a">
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
  /* Container padding scales: 12px on iPhone-narrow (≤380px), 16px
     on standard phones, 32px on desktop. The env(safe-area-*) shims
     keep content clear of the iOS Dynamic Island / notch when the
     dashboard is opened in mobile Safari with viewport-fit=cover. */
  .container {
    max-width: 1280px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  }
  .header {
    display: flex; flex-direction: column; gap: 12px;
    margin-bottom: 20px;
  }
  .header h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.4px; line-height: 1.15; }
  .header h1 .grad {
    background: linear-gradient(135deg, #ff9555, #ff6b9d);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .header .sub { color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 4px; }
  .layout { display: flex; flex-direction: column; gap: 18px; }
  .sidebar {
    flex-shrink: 0;
    display: flex; flex-direction: row; gap: 4px;
    overflow-x: auto;
    padding: 6px;
    -webkit-overflow-scrolling: touch; /* iOS momentum scroll */
  }
  .sidebar::-webkit-scrollbar { display: none; }
  .sidebar { -ms-overflow-style: none; scrollbar-width: none; }
  .main-content { flex: 1; min-width: 0; }
  @media (min-width: 480px) {
    .container { padding: 20px 16px; }
    .header h1 { font-size: 22px; }
  }
  @media (min-width: 880px) {
    .container { padding: 32px 32px; }
    .header { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 28px; }
    .layout { flex-direction: row; gap: 24px; }
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
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; border-radius: 10px;
    color: rgba(255,255,255,0.7); font-weight: 600; font-size: 13px;
    cursor: pointer; transition: background 0.15s, color 0.15s;
    white-space: nowrap; border: 1px solid transparent;
    touch-action: manipulation;
  }
  @media (min-width: 880px) {
    .nav-item { padding: 10px 14px; font-size: 14px; gap: 10px; }
  }
  .nav-item:hover { background: rgba(255,255,255,0.06); color: white; }
  .nav-item.active {
    background: rgba(255, 149, 85, 0.18);
    color: white;
    border-color: rgba(255, 149, 85, 0.40);
  }

  /* ── Buttons ────────────────────────────────────────────────── */
  /* min-height keeps buttons tappable on mobile (Apple HIG: 44 pt) */
  .btn {
    padding: 9px 14px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 13px;
    min-height: 38px;
    transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
    touch-action: manipulation; /* eliminate iOS 300ms tap delay */
  }
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
  .tab-row {
    display: flex; gap: 6px;
    padding: 6px; margin-bottom: 14px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
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
  .card { padding: 16px; }
  @media (min-width: 600px) {
    .card { padding: 20px; }
  }
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
  .tbl-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .tbl { width: 100%; min-width: 520px; /* keep columns readable; horizontal scroll on narrow screens */ }
  .tbl th {
    padding: 10px 12px; text-align: left;
    font-size: 11px; color: rgba(255,255,255,0.5);
    text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }
  .tbl td {
    padding: 10px 12px;
    font-size: 13px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .tbl tr:hover td { background: rgba(255,255,255,0.03); }
  .tbl .place-id { color: rgba(255,255,255,0.4); font-size: 11px; font-family: ui-monospace, monospace; margin-top: 2px; }
  .tbl .avatar { width: 28px; height: 28px; border-radius: 50%; vertical-align: middle; margin-right: 8px; object-fit: cover; }
  .tbl .avatar-placeholder { display: inline-block; width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.10); vertical-align: middle; margin-right: 8px; }

  /* ── Filters row ────────────────────────────────────────────── */
  .filters {
    padding: 12px; margin-bottom: 14px;
    display: flex; flex-wrap: wrap; gap: 8px;
  }
  .filters input {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    /* On mobile every input takes a full row; on desktop they line
       up. min-width: 0 lets flex-basis: 100% actually shrink instead
       of pushing the row past the viewport. */
    flex: 1 1 100%;
    min-width: 0;
  }
  @media (min-width: 600px) {
    .filters { padding: 16px; }
    .filters input { flex: 1 1 180px; }
  }
  .filters .grow { flex: 1 1 100%; }
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
  .stat-card { padding: 14px 16px; }
  @media (min-width: 600px) {
    .stat-card { padding: 18px 20px; }
  }
  .stat-label {
    font-size: 10.5px; text-transform: uppercase;
    letter-spacing: 0.06em; color: rgba(255,255,255,0.5);
    line-height: 1.3;
  }
  .stat-num {
    margin-top: 8px;
    font-size: 24px; font-weight: 800; line-height: 1;
    background: linear-gradient(135deg, #ff9555, #ff6b9d);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  @media (min-width: 600px) {
    .stat-label { font-size: 11px; }
    .stat-num { font-size: 28px; }
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

  /* ── Send (admin notification) form ─────────────────────────── */
  .send-form {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @media (min-width: 720px) {
    .send-form { grid-template-columns: 1fr 1fr; }
    .send-form .full { grid-column: 1 / -1; }
  }
  .send-form label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: 11px; color: rgba(255,255,255,0.5);
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
  }
  .send-form label .lbl { /* used for inline labels not wrapped in <label> */ }
  .send-form input,
  .send-form textarea {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    color: white;
    text-transform: none; letter-spacing: 0; font-weight: 400;
    font-family: inherit;
  }
  .send-form textarea { resize: vertical; min-height: 88px; }
  .send-form .row-check {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: rgba(255,255,255,0.85);
    text-transform: none; letter-spacing: 0; font-weight: 600;
  }
  .send-form .user-list {
    max-height: 240px; overflow-y: auto;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    margin-top: 8px;
  }
  .send-form .user-list-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    font-size: 12.5px;
  }
  .send-form .user-list-row:last-child { border-bottom: none; }
  .send-form .user-list-row:hover { background: rgba(255,255,255,0.04); }
  .send-form .user-list-row.checked { background: rgba(255,149,85,0.10); }
  .send-form .user-list-row input[type="checkbox"] { margin: 0; }
  .send-form .user-list-row .uname { font-weight: 600; }
  .send-form .user-list-row .uemail { color: rgba(255,255,255,0.55); font-size: 11.5px; }
  .send-form #send-user-picker[hidden] { display: none; }

  /* ── Modal (place editor) ───────────────────────────────────── */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(5,8,18,0.75);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    z-index: 9000;
    display: flex; align-items: center; justify-content: center;
    padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
             max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  }
  .modal-overlay[hidden] { display: none; }
  .modal-card {
    width: 100%; max-width: 680px;
    max-height: 90vh; overflow-y: auto;
    padding: 20px;
    border-radius: 18px;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-bottom: 14px;
  }
  .modal-head h3 { margin: 0; font-size: 18px; font-weight: 800; }
  .modal-head .btn { padding: 6px 10px; min-height: 0; }

  /* ── Row action buttons (Edit / Delete in tables) ───────────── */
  .row-actions {
    display: inline-flex; gap: 6px;
    justify-content: flex-end;
  }
  .row-actions .btn {
    padding: 4px 9px; font-size: 11.5px; min-height: 0;
    border-radius: 7px;
  }

  /* ── Toasts ─────────────────────────────────────────────────── */
  /* Floating non-blocking notifications. Used for API errors that
     used to replace whole sections (e.g. quota exhaustion on stats).
     The section UI stays put; the toast surfaces the error and self-
     dismisses after 6s (or on click). Stacks vertically when several
     fire at once. */
  #toast-host {
    position: fixed;
    right: max(12px, env(safe-area-inset-right));
    bottom: max(14px, env(safe-area-inset-bottom));
    display: flex; flex-direction: column-reverse; gap: 8px;
    z-index: 10000;
    pointer-events: none;
    max-width: min(90vw, 380px);
  }
  .toast {
    pointer-events: auto;
    padding: 11px 14px;
    border-radius: 12px;
    font-size: 12.5px; line-height: 1.4;
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(20,24,36,0.85);
    color: white;
    box-shadow: 0 8px 24px rgba(0,0,0,0.40);
    cursor: pointer;
    animation: toastIn 180ms ease-out;
  }
  .toast.err {
    background: rgba(70,18,18,0.92);
    border-color: rgba(255,100,100,0.40);
  }
  .toast.ok {
    background: rgba(20,46,28,0.92);
    border-color: rgba(80,220,130,0.40);
  }
  .toast .t-title { font-weight: 700; margin-bottom: 2px; }
  .toast .t-body { color: rgba(255,255,255,0.78); font-size: 11.5px; }
  @keyframes toastIn {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes toastOut {
    from { transform: translateY(0); opacity: 1; }
    to   { transform: translateY(8px); opacity: 0; }
  }
  .toast.dismissing { animation: toastOut 160ms ease-in forwards; }

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
      <div class="nav-item" data-view="inquiries"><span>💬</span><span>Inquiries</span></div>
      <div class="nav-item" data-view="send"><span>📣</span><span>Send</span></div>
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
          <input id="places-search" placeholder="Search title, type, slug, place_id…" class="grow">
          <input id="places-main" placeholder="main slug (food, shopping…)">
          <input id="places-sub" placeholder="sub slug (coffee, bank…)">
          <button id="places-search-btn" class="btn btn-primary">Search</button>
          <button id="places-new-btn" class="btn btn-ghost" style="display:inline-flex;align-items:center;gap:6px;">
            <span style="font-size:16px;line-height:1;">+</span> Add place
          </button>
          <div class="hint">'main' surfaces all sub-slugs of that main; 'sub' is exact match. Search hits title, type, primary slug, and place_id.</div>
        </div>
        <!-- "Showing X-Y of Z" label + prev/next buttons +
             "Total in catalogue: N" chip. Re-rendered on every
             loadPlaces() resolve via renderPlacesPagination(). -->
        <div id="places-pagination"></div>
        <div class="glass-strong tbl-wrap">
          <table class="tbl" id="places-table">
            <thead><tr><th>Title</th><th>Type</th><th>Primary</th><th>Rating</th><th>Source</th><th style="text-align:right;">Actions</th></tr></thead>
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

      <!-- Inquiries -->
      <section data-view-section="inquiries">
        <div class="tab-row glass">
          <button data-inq-status="open" class="tab btn btn-ghost">Open <span id="count-inq-open" style="opacity:0.6;font-size:11px;margin-left:4px;"></span></button>
          <button data-inq-status="resolved" class="tab btn btn-ghost">Resolved</button>
          <button data-inq-status="all" class="tab btn btn-ghost">All</button>
        </div>
        <div id="inquiries-list"></div>
      </section>

      <!-- Send notification (admin → users) -->
      <section data-view-section="send">
        <div class="glass-strong" style="padding:18px;border-radius:16px;">
          <h2 style="margin:0 0 4px;font-size:18px;font-weight:800;">Send a notification</h2>
          <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:14px;">
            Picks land in the user's bell drawer in-app AND fire as push notifications to every device they're signed in on.
          </div>

          <div class="send-form">
            <label class="full">
              <div class="lbl">Subject</div>
              <input id="send-subject" placeholder="A new feature is live!" maxlength="200">
            </label>
            <label class="full">
              <div class="lbl">Body</div>
              <textarea id="send-body" rows="4" maxlength="2000" placeholder="Tap to read more in PortSaid Guide."></textarea>
            </label>
            <label class="full">
              <div class="lbl">Deep link to a place (optional)</div>
              <input id="send-place-id" placeholder="place_id — tap on the push will open this place">
            </label>

            <div class="recipients-row full">
              <div class="lbl" style="margin-bottom:6px;">Recipients</div>
              <label class="row-check">
                <input type="checkbox" id="send-all-users">
                <span>Send to all users</span>
              </label>
              <div id="send-user-picker" style="margin-top:8px;">
                <input id="send-user-filter" placeholder="Search users by name or email…">
                <div id="send-user-list" class="user-list"></div>
                <div id="send-user-count" class="hint" style="margin-top:6px;">0 users selected</div>
              </div>
            </div>

            <div class="save-row full" style="margin-top:6px;">
              <button id="send-btn" class="btn btn-primary">Send</button>
              <button id="send-clear-btn" class="btn btn-ghost">Clear form</button>
            </div>
            <div id="send-status" class="status-msg full"></div>
          </div>
        </div>
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

<!-- Toast host. Positioned fixed bottom-right; each .toast inside is
     a floating notification. Used to surface errors that USED to
     wipe whole sections (e.g. quota exhaustion on /api/stats). The
     section UI now stays put; the toast carries the error message. -->
<div id="toast-host" aria-live="polite" aria-atomic="true"></div>

<!-- Place editor modal — shared between "+ Add place" and "Edit" row
     actions. The same form serves both flows; openPlaceModal() sets
     a mode flag that decides whether to POST (create) or PATCH (update). -->
<div id="place-modal" class="modal-overlay" hidden>
  <div class="modal-card glass-strong">
    <div class="modal-head">
      <h3 id="place-modal-title">Add a place</h3>
      <button id="place-modal-close" class="btn btn-ghost" aria-label="Close">✕</button>
    </div>
    <div id="place-modal-existing" class="existing-place" style="display:none;"></div>
    <div class="edit-panel">
      <div class="form-grid">
        <label class="full"><div class="lbl">Title *</div><input data-pm-field="title" placeholder="Place name"></label>
        <label><div class="lbl">Latitude *</div><input data-pm-field="lat" placeholder="31.2614"></label>
        <label><div class="lbl">Longitude *</div><input data-pm-field="lon" placeholder="32.2811"></label>
        <label><div class="lbl">Primary slug *</div><select data-pm-field="primary_slug"></select></label>
        <label><div class="lbl">Type (Google business type)</div><input data-pm-field="type" placeholder="Coffee shop / Bank / Cinema…"></label>
        <label class="full"><div class="lbl">Address</div><input data-pm-field="address"></label>
        <label><div class="lbl">Phone</div><input data-pm-field="phone"></label>
        <label><div class="lbl">Website</div><input data-pm-field="website" placeholder="https://example.com"></label>
        <label><div class="lbl">Thumbnail URL</div><input data-pm-field="thumbnail"></label>
        <label><div class="lbl">Rating (0–5)</div><input data-pm-field="rating"></label>
        <label><div class="lbl">Reviews count</div><input data-pm-field="reviews"></label>
        <label class="full"><div class="lbl">Source categories (comma-sep)</div><input data-pm-field="source_categories" placeholder="coffee, bakery"></label>
      </div>
      <div id="place-modal-status" class="status-msg full"></div>
      <div class="save-row full">
        <button id="place-modal-cancel" class="btn btn-ghost">Cancel</button>
        <button id="place-modal-save" class="btn btn-primary">Save</button>
      </div>
    </div>
  </div>
</div>

<script>
  // No external dependencies. All vanilla JS.
  var $ = function(s, r) { return (r || document).querySelector(s); };
  var $$ = function(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Toasts. Surface a non-blocking message in the bottom-right.
  // kind: 'err' | 'ok' | 'info' (info is the default neutral style).
  // Auto-dismiss after 6 s OR on click. Same toast text within 4 s
  // is de-duped so a retry loop doesn't spam the screen.
  var _toastRecent = new Map(); // text → ts
  function showToast(title, body, kind) {
    var host = $('#toast-host');
    if (!host) return;
    var key = (title || '') + '||' + (body || '');
    var now = Date.now();
    var last = _toastRecent.get(key);
    if (last && now - last < 4000) return; // dedupe burst-fires
    _toastRecent.set(key, now);
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
    el.innerHTML =
      (title ? '<div class="t-title">' + escapeHtml(title) + '</div>' : '') +
      (body ? '<div class="t-body">' + escapeHtml(body) + '</div>' : '');
    var dismissed = false;
    function dismiss() {
      if (dismissed) return; dismissed = true;
      el.classList.add('dismissing');
      setTimeout(function() { try { host.removeChild(el); } catch(_) {} }, 200);
    }
    el.addEventListener('click', dismiss);
    host.appendChild(el);
    setTimeout(dismiss, 6000);
  }

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
  var inqStatus = 'open';

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

  function setInqStatus(s) {
    inqStatus = s;
    $$('[data-inq-status]').forEach(function(t) {
      t.classList.toggle('active', t.dataset.inqStatus === s);
    });
    loadInquiries();
  }

  function load(view) {
    if (view === 'submissions') loadSubmissions();
    else if (view === 'places') loadPlaces();
    else if (view === 'users') loadUsers();
    else if (view === 'reports') loadReports();
    else if (view === 'inquiries') loadInquiries();
    else if (view === 'send') loadSendView();
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
      .catch(function(e) {
        list.innerHTML = '<div class="glass-strong empty"><div class="empty-icon">⚠️</div>Couldn\\'t load submissions. See the toast for details.</div>';
        showToast('Couldn\\'t load submissions', friendlyApiError(e), 'err');
      });
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
    var pWebsite = manual.website || '';
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
      field('Website', 'website', pWebsite, { placeholder: 'https://example.com' }) +
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
  // Cache the last fetched list so the row-action handlers can look
  // up the full record on Edit without a second network call.
  var _placesById = {};
  // Page state — survives across loads so prev/next buttons can
  // walk forward/backward without losing the filter context.
  var _placesPageSize = 500;
  var _placesOffset = 0;
  var _placesTotal = 0;
  var _placesTotalUnfiltered = 0;

  function loadPlaces(opts) {
    opts = opts || {};
    var search = $('#places-search').value.trim();
    var main = $('#places-main').value.trim();
    var sub = $('#places-sub').value.trim();
    var tbody = $('#places-table tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">Loading…</td></tr>';

    // Reset offset on new search / filter; keep it on next/prev.
    if (opts.resetOffset) _placesOffset = 0;

    // 500 per page matches the server's hard cap. Filters apply
    // BEFORE the slice on the server, so a search for "ZAK." returns
    // its 1-3 matches in a single page regardless of where they
    // land alphabetically.
    var params = new URLSearchParams({
      limit: String(_placesPageSize),
      offset: String(_placesOffset),
    });
    if (search) params.set('search', search);
    if (main) params.set('main', main);
    if (sub) params.set('sub', sub);

    fetch('/omar-dash/api/places?' + params.toString(), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        _placesTotal = b.total || b.items.length;
        _placesTotalUnfiltered = b.total_unfiltered || _placesTotal;
        _placesOffset = b.offset || 0;

        renderPlacesPagination();

        if (!b.items.length) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">No places match.</td></tr>';
          _placesById = {};
          return;
        }
        _placesById = {};
        tbody.innerHTML = b.items.map(function(p) {
          _placesById[p.place_id] = p;
          var rating = (p.rating != null)
            ? p.rating + ' ★ <span style="color:rgba(255,255,255,0.4);">(' + (p.reviews || 0) + ')</span>'
            : '—';
          return '<tr><td><div style="font-weight:600;">' + escapeHtml(p.title) + '</div><div class="place-id">' + escapeHtml(p.place_id) + '</div></td>' +
            '<td>' + escapeHtml(p.type || '—') + '</td>' +
            '<td>' + escapeHtml(p.primary_slug || '—') + '</td>' +
            '<td>' + rating + '</td>' +
            '<td><span class="pill pill-ghost">' + escapeHtml(p.created_via || 'scraper') + '</span></td>' +
            '<td><div class="row-actions">' +
              '<button class="btn btn-ghost place-edit-btn" data-id="' + escapeHtml(p.place_id) + '">Edit</button>' +
              '<button class="btn btn-danger place-delete-btn" data-id="' + escapeHtml(p.place_id) + '" data-title="' + escapeHtml(p.title || '') + '">Delete</button>' +
            '</div></td>' +
          '</tr>';
        }).join('');
        wirePlacesRowActions();
      })
      .catch(function(e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">Couldn\\'t load places. See toast for details.</td></tr>';
        showToast('Couldn\\'t load places', friendlyApiError(e), 'err');
      });
  }

  // Render the "Showing X-Y of Z" label + prev/next buttons +
  // "Total in catalogue: N" chip into the #places-pagination host.
  // Recomputed on every loadPlaces() resolve.
  function renderPlacesPagination() {
    var host = $('#places-pagination');
    if (!host) return;
    var total = _placesTotal;
    var offset = _placesOffset;
    var limit = _placesPageSize;
    var pageEnd = Math.min(offset + limit, total);
    var hasPrev = offset > 0;
    var hasNext = pageEnd < total;
    var pageNumber = Math.floor(offset / limit) + 1;
    var pageCount = Math.max(1, Math.ceil(total / limit));

    var filterActive = total !== _placesTotalUnfiltered;
    var totalChip =
      '<span class="pill pill-ghost" style="font-size:11px;font-weight:600;">' +
        'Total in catalogue: ' + _placesTotalUnfiltered.toLocaleString() +
      '</span>';
    var filteredChip = filterActive
      ? ' <span class="pill" style="font-size:11px;background:rgba(255,149,85,0.18);color:#ffae7a;">' +
          'Filtered: ' + total.toLocaleString() +
        '</span>'
      : '';

    host.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 4px;font-size:12px;color:rgba(255,255,255,0.7);">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
          totalChip + filteredChip +
        '</div>' +
        '<div style="flex:1;min-width:8px;"></div>' +
        (total === 0
          ? ''
          : '<div style="display:flex;align-items:center;gap:4px;">' +
              '<span style="margin-right:4px;">Showing ' +
                (offset + 1).toLocaleString() + '–' + pageEnd.toLocaleString() +
                ' of ' + total.toLocaleString() +
              '</span>' +
              '<button class="btn btn-ghost places-prev-btn" ' +
                (hasPrev ? '' : 'disabled') + ' style="padding:6px 10px;min-height:30px;">‹ Prev</button>' +
              '<span style="padding:0 8px;font-size:11.5px;color:rgba(255,255,255,0.55);">' +
                'Page ' + pageNumber + ' of ' + pageCount +
              '</span>' +
              '<button class="btn btn-ghost places-next-btn" ' +
                (hasNext ? '' : 'disabled') + ' style="padding:6px 10px;min-height:30px;">Next ›</button>' +
            '</div>') +
      '</div>';

    var prevBtn = $('.places-prev-btn');
    var nextBtn = $('.places-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', function() {
      _placesOffset = Math.max(0, _placesOffset - _placesPageSize);
      loadPlaces();
      // Bring the table back into view after the page change.
      $('#places-pagination').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (nextBtn) nextBtn.addEventListener('click', function() {
      _placesOffset = _placesOffset + _placesPageSize;
      loadPlaces();
      $('#places-pagination').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Wire Edit / Delete on every freshly-rendered row.
  function wirePlacesRowActions() {
    $$('.place-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var p = _placesById[btn.dataset.id];
        if (!p) {
          showToast('Place not loaded', 'Refresh the list and try again.', 'err');
          return;
        }
        openPlaceModal({ mode: 'edit', place: p });
      });
    });
    $$('.place-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var title = btn.dataset.title || '(no title)';
        if (!confirm('Delete "' + title + '" from places + every catalogue bucket?\\nThis cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = '…';
        fetch('/omar-dash/api/places/' + encodeURIComponent(btn.dataset.id), {
          method: 'DELETE', credentials: 'same-origin',
        })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (!d.ok) throw new Error(d.error || 'failed');
            var removed = (d.removed_from_buckets || []).length;
            showToast('Place deleted', 'Removed from ' + removed + ' catalogue bucket(s).', 'ok');
            loadPlaces();
          })
          .catch(function(e) {
            showToast('Delete failed', friendlyApiError(e), 'err');
            btn.disabled = false;
            btn.textContent = 'Delete';
          });
      });
    });
  }

  // ── Place modal (Add / Edit) ──
  var ALL_PRIMARY_SLUGS = [
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

  // openPlaceModal({ mode: 'create' | 'edit', place?: {...} })
  function openPlaceModal(opts) {
    opts = opts || {};
    var mode = opts.mode === 'edit' ? 'edit' : 'create';
    var place = opts.place || {};

    // Title + Save button copy depend on mode.
    $('#place-modal-title').textContent = mode === 'edit' ? 'Edit place' : 'Add a place';
    $('#place-modal-save').textContent = mode === 'edit' ? 'Save changes' : 'Create place';

    // Build the primary_slug dropdown.
    var slugSel = document.querySelector('[data-pm-field="primary_slug"]');
    slugSel.innerHTML = '<option value="">—</option>' + ALL_PRIMARY_SLUGS.map(function(s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
    }).join('');

    // Prefill fields.
    function setField(name, val) {
      var el = document.querySelector('[data-pm-field="' + name + '"]');
      if (el) el.value = (val == null ? '' : String(val));
    }
    setField('title', place.title);
    setField('lat', place.lat);
    setField('lon', place.lon);
    setField('primary_slug', place.primary_slug);
    setField('type', place.type);
    setField('address', place.address);
    setField('phone', place.phone);
    setField('website', place.website);
    setField('thumbnail', place.thumbnail);
    setField('rating', place.rating);
    setField('reviews', place.reviews);
    setField('source_categories',
        Array.isArray(place.source_categories) ? place.source_categories.join(', ') : '');

    // Edit mode: show the place_id banner so the admin knows what
    // they're modifying.
    var banner = $('#place-modal-existing');
    if (mode === 'edit' && place.place_id) {
      banner.style.display = 'block';
      banner.innerHTML = 'Editing <b>' + escapeHtml(place.title || '(no title)') + '</b> — id <code>' + escapeHtml(place.place_id) + '</code>';
    } else {
      banner.style.display = 'none';
      banner.textContent = '';
    }

    $('#place-modal-status').textContent = '';
    $('#place-modal-status').className = 'status-msg full';
    $('#place-modal').hidden = false;

    // Stash mode + id so the Save handler knows which request to fire.
    $('#place-modal').dataset.mode = mode;
    $('#place-modal').dataset.placeId = place.place_id || '';
  }

  function closePlaceModal() { $('#place-modal').hidden = true; }

  function readPlaceModalForm() {
    var out = {};
    $$('[data-pm-field]').forEach(function(el) {
      var v = el.value;
      if (v == null || v === '') return;
      out[el.dataset.pmField] = v;
    });
    return out;
  }

  // Single Save handler wired once at boot — it inspects the modal's
  // mode flag to decide POST vs PATCH.
  function wirePlaceModalOnce() {
    if (wirePlaceModalOnce.done) return; wirePlaceModalOnce.done = true;
    $('#places-new-btn').addEventListener('click', function() {
      openPlaceModal({ mode: 'create' });
    });
    $('#place-modal-close').addEventListener('click', closePlaceModal);
    $('#place-modal-cancel').addEventListener('click', closePlaceModal);
    $('#place-modal').addEventListener('click', function(e) {
      // Clicking the overlay (outside the card) closes the modal.
      if (e.target === $('#place-modal')) closePlaceModal();
    });
    $('#place-modal-save').addEventListener('click', function() {
      var mode = $('#place-modal').dataset.mode || 'create';
      var placeId = $('#place-modal').dataset.placeId || '';
      var fields = readPlaceModalForm();
      var statusEl = $('#place-modal-status');
      function setStatus(text, cls) {
        statusEl.textContent = text || '';
        statusEl.className = 'status-msg full ' + (cls || '');
      }
      var saveBtn = $('#place-modal-save');
      saveBtn.disabled = true;
      var origLabel = saveBtn.textContent;
      saveBtn.textContent = 'Saving…';
      setStatus('Saving…');
      var url, method;
      if (mode === 'edit') {
        if (!placeId) { setStatus('No place id to edit.', 'err'); saveBtn.disabled = false; saveBtn.textContent = origLabel; return; }
        url = '/omar-dash/api/places/' + encodeURIComponent(placeId);
        method = 'PATCH';
      } else {
        url = '/omar-dash/api/places';
        method = 'POST';
      }
      fetch(url, {
        method: method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          showToast(
            mode === 'edit' ? 'Place updated' : 'Place created',
            mode === 'edit' ? 'Catalogue buckets re-synced.' : ('Doc id: ' + d.place_id),
            'ok'
          );
          closePlaceModal();
          loadPlaces();
        })
        .catch(function(e) {
          setStatus(e.message || 'Save failed', 'err');
          showToast(mode === 'edit' ? 'Update failed' : 'Create failed',
              friendlyApiError(e), 'err');
        })
        .finally(function() {
          saveBtn.disabled = false;
          saveBtn.textContent = origLabel;
        });
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
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.5);padding:32px;">Couldn\\'t load users. See toast for details.</td></tr>';
        showToast('Couldn\\'t load users', friendlyApiError(e), 'err');
      });
  }

  // ── Reports ──
  function renderReport(it) {
    return renderThreadCard({
      kind: 'reports',
      item: it,
      headlineHtml:
        '<div style="font-weight:700;font-size:13.5px;">' +
        escapeHtml(it.reason) + '</div>' +
        (it.note
          ? '<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,0.7);">' + escapeHtml(it.note) + '</div>'
          : ''),
      meta: it.created_at,
    });
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
              .catch(function(e) { showToast('Resolve failed', friendlyApiError(e), 'err'); btn.disabled = false; btn.textContent = 'Mark resolved'; });
          });
        });
        $$('.thread-open-btn').forEach(function(btn) {
          btn.addEventListener('click', function() { toggleThread(btn); });
        });
        $$('.thread-reopen-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            if (!confirm('Reopen this thread? The user will be able to send messages again.')) return;
            reopenThreadFromCard(btn);
          });
        });
      })
      .catch(function(e) {
        list.innerHTML = '<div class="glass-strong empty"><div class="empty-icon">⚠️</div>Couldn\\'t load reports. See toast for details.</div>';
        showToast('Couldn\\'t load reports', friendlyApiError(e), 'err');
      });
  }

  // ── Inquiries ──
  // User-initiated inquiries from the mobile app — typically "the
  // title is wrong" or "please update the address".
  function renderInquiry(it) {
    return renderThreadCard({
      kind: 'inquiries',
      item: it,
      headlineHtml:
        '<h3 class="title" style="margin:0;font-size:15px;">' + escapeHtml(it.subject) + '</h3>' +
        '<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,0.85);white-space:pre-wrap;">' + escapeHtml(it.body) + '</div>',
      meta: it.created_at,
    });
  }

  // ── Shared thread-card renderer used by both reports & inquiries ──
  //
  // Renders the pill + meta + headline + reporter info + place-context
  // banner + thread-toggle button + reply input (when open).
  //
  // The thread itself is lazy-loaded on first expand — fetch
  // /api/{kind}/{id}/messages and render bubbles. POST a reply.
  // On open we ALSO mark-read so the unread badge resets.
  function renderThreadCard(opts) {
    var kind = opts.kind; // 'reports' | 'inquiries'
    var it = opts.item;
    var meta = opts.meta;
    var headlineHtml = opts.headlineHtml;

    // Reporter / inquirer info (the "from" line).
    var fromUid = kind === 'reports' ? it.reported_by_uid : it.user_uid;
    var fromEmail = kind === 'reports' ? it.reported_by_email : it.user_email;
    var fromName = kind === 'reports' ? null : it.user_name;
    var fromLine = fromEmail
        ? '<a href="mailto:' + escapeHtml(fromEmail) + '" class="url">' + escapeHtml(fromEmail) + '</a>'
        : escapeHtml(fromUid || '(unknown user)');

    // Place context (when the report/inquiry is about a place).
    // Renders the full denormalised snapshot — title, type, slug,
    // address, phone, website, rating, photo + creator chain — so the
    // admin sees everything they need to triage WITHOUT clicking
    // through to the place detail page. Snapshot was captured at
    // report/inquiry write time; falls back to live place data if
    // the entry pre-dates the snapshot field.
    var placeBlock = '';
    if (it.place_id) {
      var snap = it.place_snapshot || {};
      var creator = '';
      if (it.place_created_by_uid) {
        var who = it.place_creator_email
            ? escapeHtml(it.place_creator_email)
            : escapeHtml(it.place_created_by_uid);
        creator =
          '<div style="margin-top:6px;font-size:11.5px;color:rgba(255,255,255,0.6);">' +
            'Added by user ' + who +
            (it.place_creator_name
              ? ' <span style="color:rgba(255,255,255,0.45);">(' + escapeHtml(it.place_creator_name) + ')</span>'
              : '') +
            ' via <span class="pill pill-ghost" style="font-size:10px;">' + escapeHtml(it.place_created_via || 'scraper') + '</span>' +
            (it.place_submission_id
              ? ' <span style="color:rgba(255,255,255,0.45);font-family:ui-monospace,monospace;font-size:10px;">· submission ' + escapeHtml(it.place_submission_id) + '</span>'
              : '') +
          '</div>';
      } else if (it.place_created_via) {
        creator =
          '<div style="margin-top:6px;font-size:11.5px;color:rgba(255,255,255,0.6);">' +
            'Source: <span class="pill pill-ghost" style="font-size:10px;">' + escapeHtml(it.place_created_via) + '</span>' +
          '</div>';
      }

      // Build the optional rows (only show fields that have values).
      var rows = '';
      function row(label, value, opts) {
        if (value == null || value === '') return;
        opts = opts || {};
        var rendered;
        if (opts.link) {
          rendered = '<a class="url" href="' + escapeHtml(opts.link) + '" target="_blank" rel="noopener">' + escapeHtml(String(value)) + '</a>';
        } else if (opts.mono) {
          rendered = '<span style="font-family:ui-monospace,monospace;font-size:11px;">' + escapeHtml(String(value)) + '</span>';
        } else {
          rendered = escapeHtml(String(value));
        }
        rows += '<div style="font-size:11.5px;line-height:1.45;"><span style="color:rgba(255,255,255,0.5);">' + label + ':</span> ' + rendered + '</div>';
      }
      row('Type', snap.type);
      row('Address', snap.address);
      if (snap.phone) row('Phone', snap.phone, { link: 'tel:' + snap.phone });
      if (snap.website) row('Website', snap.website, { link: snap.website });
      if (snap.rating != null) {
        row('Rating', snap.rating + ' ★ (' + (snap.reviews || 0) + ' reviews)');
      }
      if (typeof snap.lat === 'number' && typeof snap.lon === 'number') {
        var ll = snap.lat.toFixed(6) + ', ' + snap.lon.toFixed(6);
        var mapUrl = 'https://maps.google.com/?q=' + snap.lat + ',' + snap.lon;
        row('Coords', ll, { link: mapUrl });
      }
      if (Array.isArray(snap.source_categories) && snap.source_categories.length) {
        row('Categories', snap.source_categories.join(', '));
      }

      // Thumbnail strip (small inline image when present).
      var thumb = '';
      if (snap.thumbnail) {
        thumb =
          '<img src="' + escapeHtml(snap.thumbnail) + '" alt="" referrerpolicy="no-referrer" loading="lazy" ' +
            'style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.10);flex-shrink:0;">';
      }

      placeBlock =
        '<div style="margin-top:10px;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);">' +
          '<div style="display:flex;gap:10px;align-items:flex-start;">' +
            thumb +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:13px;font-weight:700;">' +
                (it.place_title ? escapeHtml(it.place_title) : '(place not yet in catalogue)') +
                (it.place_primary_slug
                  ? ' <span class="pill pill-ghost" style="font-size:10px;margin-left:6px;vertical-align:middle;">' + escapeHtml(it.place_primary_slug) + '</span>'
                  : '') +
              '</div>' +
              '<div style="margin-top:2px;font-size:10.5px;font-family:ui-monospace,monospace;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(it.place_id) + '</div>' +
              (rows
                ? '<div style="margin-top:6px;display:flex;flex-direction:column;gap:2px;">' + rows + '</div>'
                : '') +
              creator +
            '</div>' +
          '</div>' +
        '</div>';
    }

    // Thread summary line (last message preview + unread badge).
    var unread = it.admin_unread_count || 0;
    var threadSummary = '';
    if (it.last_message_preview) {
      threadSummary =
        '<div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.7);">' +
          '<b>' + (it.last_message_author === 'admin' ? 'You' : 'User') + ':</b> ' +
          escapeHtml(it.last_message_preview) +
          (it.last_message_at
            ? ' <span style="color:rgba(255,255,255,0.4);">— ' + fmtDate(it.last_message_at) + '</span>'
            : '') +
        '</div>';
    }

    // Resolved-by-prior-singleton-admin_response (legacy single-line
    // response field, kept for back-compat).
    var responseLine = it.admin_response
      ? '<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.55);"><b>Admin response:</b> ' + escapeHtml(it.admin_response) + '</div>'
      : '';

    // Reopen-request banner — only shown when the user has used
    // their one-shot reopen request AND the thread is still
    // resolved (so the admin sees an actionable prompt).
    var reopenBanner = '';
    if (it.reopen_requested && it.status === 'resolved') {
      reopenBanner =
        '<div style="margin-top:10px;padding:10px 12px;background:rgba(255,200,50,0.10);border-left:3px solid rgba(255,200,50,0.6);border-radius:8px;">' +
          '<div style="font-size:11px;font-weight:800;letter-spacing:0.3px;color:#ffd060;">' +
            '↻ REOPEN REQUESTED' +
            (it.reopen_requested_at
              ? ' <span style="color:rgba(255,255,255,0.5);font-weight:600;letter-spacing:0;"> · ' + fmtDate(it.reopen_requested_at) + '</span>'
              : '') +
          '</div>' +
          (it.reopen_request_body
            ? '<div style="margin-top:4px;font-size:12.5px;color:rgba(255,255,255,0.85);white-space:pre-wrap;">' + escapeHtml(it.reopen_request_body) + '</div>'
            : '') +
        '</div>';
    }

    // Action buttons.
    // - Always: Open thread (with unread badge)
    // - Open status: Mark resolved
    // - Resolved status: Reopen thread (sets status back to open)
    // - Always: Mail link to user
    // Note: admin can ALSO post messages inside a resolved thread
    // without flipping status back to open — that capability lives
    // inside the thread expansion, not here.
    var resolveBtnCls = kind === 'reports' ? 'resolve-btn' : 'inq-resolve-btn';
    var actions =
      '<div style="margin-top:14px;display:flex;gap:6px;flex-wrap:wrap;">' +
        '<button class="btn btn-ghost thread-open-btn" data-thread-kind="' + kind + '" data-thread-id="' + escapeHtml(it.id) + '">' +
          'Open thread' +
          (unread > 0 ? ' <span class="pill pill-pending" style="font-size:10px;margin-left:6px;">' + unread + ' new</span>' : '') +
        '</button>' +
        (it.status === 'open'
          ? '<button class="btn btn-primary ' + resolveBtnCls + '" data-id="' + escapeHtml(it.id) + '">Mark resolved</button>'
          : '<button class="btn btn-primary thread-reopen-btn" data-thread-kind="' + kind + '" data-thread-id="' + escapeHtml(it.id) + '">' +
              (it.reopen_requested ? 'Reopen thread' : 'Reopen anyway') +
            '</button>') +
        (fromEmail
          ? '<a class="btn btn-ghost" href="mailto:' + escapeHtml(fromEmail) + '" target="_blank" rel="noopener">Mail</a>'
          : '') +
      '</div>';

    return '<div class="glass-strong card">' +
      '<div class="head"><span class="pill pill-' + it.status + '">' + it.status.toUpperCase() + '</span>' +
      '<span class="meta">' + fmtDate(meta) + '</span></div>' +
      headlineHtml +
      '<div style="margin-top:8px;font-size:11.5px;color:rgba(255,255,255,0.55);">from ' + fromLine +
        (fromName ? ' <span style="color:rgba(255,255,255,0.45);">(' + escapeHtml(fromName) + ')</span>' : '') +
      '</div>' +
      placeBlock +
      reopenBanner +
      threadSummary +
      responseLine +
      actions +
      '<div class="thread-mount" data-mount-kind="' + kind + '" data-mount-id="' + escapeHtml(it.id) + '" style="display:none;"></div>' +
    '</div>';
  }

  // Admin clicks "Reopen thread" — POST /reopen on the matching
  // collection. The live-store picks up the status flip; we just
  // reload the list view to refresh the pill + actions.
  function reopenThreadFromCard(btn) {
    var kind = btn.dataset.threadKind;
    var id = btn.dataset.threadId;
    btn.disabled = true;
    var origLabel = btn.textContent;
    btn.textContent = 'Reopening…';
    fetch('/omar-dash/api/' + kind + '/' + encodeURIComponent(id) + '/reopen', {
      method: 'POST', credentials: 'same-origin',
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        showToast('Thread reopened',
            'User can post in this thread again.', 'ok');
        if (kind === 'reports') loadReports();
        else loadInquiries();
      })
      .catch(function(e) {
        showToast('Reopen failed', friendlyApiError(e), 'err');
        btn.disabled = false;
        btn.textContent = origLabel;
      });
  }

  // Lazy-render the thread under a card. Fetches messages, draws
  // chat bubbles, wires the reply form. Idempotent — clicking
  // Open thread again collapses.
  function toggleThread(btn) {
    var kind = btn.dataset.threadKind;
    var id = btn.dataset.threadId;
    var mount = document.querySelector('.thread-mount[data-mount-kind="' + kind + '"][data-mount-id="' + id + '"]');
    if (!mount) return;
    if (mount.style.display === 'block') {
      mount.style.display = 'none';
      btn.textContent = 'Open thread';
      return;
    }
    btn.disabled = true;
    var origLabel = btn.textContent;
    btn.textContent = 'Loading…';
    mount.innerHTML = '<div style="padding:8px 0;color:rgba(255,255,255,0.5);font-size:12px;">Loading messages…</div>';
    mount.style.display = 'block';
    Promise.all([
      fetch('/omar-dash/api/' + kind + '/' + encodeURIComponent(id) + '/messages', { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
      fetch('/omar-dash/api/' + kind + '/' + encodeURIComponent(id) + '/mark-read', { method: 'POST', credentials: 'same-origin' }).then(function(r) { return r.json(); }),
    ])
      .then(function(results) {
        var d = results[0];
        if (!d.ok) throw new Error(d.error || 'failed');
        mount.innerHTML = renderThreadInside(d.items, kind, id);
        wireThreadReply(mount, kind, id);
      })
      .catch(function(e) {
        mount.innerHTML = '<div class="err">Couldn\\'t load thread: ' + escapeHtml(e.message) + '</div>';
      })
      .finally(function() {
        btn.disabled = false;
        btn.textContent = 'Close thread';
      });
  }

  function renderThreadInside(messages, kind, id) {
    var bubbles = messages.length
      ? messages.map(function(m) {
          var isAdmin = m.author === 'admin';
          var who = isAdmin ? 'You (admin)' : 'User';
          var align = isAdmin ? 'flex-end' : 'flex-start';
          // Reopen-request user messages get a yellow tint + chip so
          // the admin instantly spots which message is the request
          // rather than a regular reply.
          var isReopenReq = m.kind === 'reopen_request';
          var bg = isReopenReq
              ? 'rgba(255,200,50,0.14)'
              : (isAdmin
                  ? 'rgba(255,149,85,0.18)'
                  : 'rgba(255,255,255,0.06)');
          var border = isReopenReq
              ? 'rgba(255,200,50,0.40)'
              : 'rgba(255,255,255,0.08)';
          var chip = isReopenReq
              ? '<span style="display:inline-block;margin-right:6px;padding:1px 6px;border-radius:99px;background:rgba(255,200,50,0.20);color:#ffd060;font-size:9.5px;font-weight:800;letter-spacing:0.3px;vertical-align:middle;">↻ REQUESTED TO REOPEN</span>'
              : '';
          return '<div style="display:flex;justify-content:' + align + ';">' +
            '<div style="max-width:78%;padding:8px 12px;border-radius:12px;background:' + bg + ';border:1px solid ' + border + ';">' +
              '<div style="font-size:10.5px;color:rgba(255,255,255,0.55);margin-bottom:2px;">' + chip + escapeHtml(who) + ' · ' + fmtDate(m.created_at) + '</div>' +
              '<div style="font-size:12.5px;white-space:pre-wrap;">' + escapeHtml(m.body) + '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div style="color:rgba(255,255,255,0.5);font-size:12px;text-align:center;padding:12px 0;">No messages yet. Send the first reply below.</div>';
    return '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed rgba(255,255,255,0.10);">' +
      '<div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;">' + bubbles + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:6px;">' +
        '<textarea class="thread-input" placeholder="Reply…" rows="2" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:8px 10px;font-size:13px;color:white;resize:vertical;font-family:inherit;"></textarea>' +
        '<button class="btn btn-primary thread-send-btn" style="align-self:flex-end;">Send</button>' +
      '</div>' +
      '<div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.45);">' +
        'Admin replies are allowed even on resolved threads — the user just can\\'t send new messages until you reopen.' +
      '</div>' +
      '<div class="thread-status status-msg full"></div>' +
    '</div>';
  }

  function wireThreadReply(mount, kind, id) {
    var input = mount.querySelector('.thread-input');
    var btn = mount.querySelector('.thread-send-btn');
    var status = mount.querySelector('.thread-status');
    if (!btn || !input) return;
    btn.addEventListener('click', function() {
      var body = (input.value || '').trim();
      if (!body) { status.textContent = 'Type a reply first.'; status.className = 'status-msg full err'; return; }
      btn.disabled = true;
      var origLabel = btn.textContent;
      btn.textContent = 'Sending…';
      fetch('/omar-dash/api/' + kind + '/' + encodeURIComponent(id) + '/messages', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body }),
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          input.value = '';
          status.textContent = '';
          // Reload the thread + list so unread/preview update on the
          // card. Slight delay so the listener catches up.
          return new Promise(function(resolve) {
            setTimeout(function() {
              fetch('/omar-dash/api/' + kind + '/' + encodeURIComponent(id) + '/messages', { credentials: 'same-origin' })
                .then(function(r) { return r.json(); })
                .then(function(d2) {
                  if (d2 && d2.ok) {
                    mount.innerHTML = renderThreadInside(d2.items, kind, id);
                    wireThreadReply(mount, kind, id);
                  }
                  resolve();
                });
            }, 400);
          });
        })
        .catch(function(e) {
          status.textContent = 'Send failed: ' + e.message;
          status.className = 'status-msg full err';
        })
        .finally(function() {
          btn.disabled = false;
          btn.textContent = origLabel;
        });
    });
  }

  function loadInquiries() {
    var list = $('#inquiries-list');
    list.innerHTML = '<div class="empty">Loading…</div>';
    fetch('/omar-dash/api/inquiries?status=' + inqStatus + '&limit=200', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error);
        if (inqStatus === 'open') $('#count-inq-open').textContent = '(' + b.count + ')';
        list.innerHTML = b.items.length
          ? b.items.map(renderInquiry).join('')
          : '<div class="glass-strong empty"><div class="empty-icon">💬</div>No inquiries here.</div>';
        $$('.inq-resolve-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var response = prompt('Optional note to record (visible only on dashboard):') || '';
            btn.disabled = true; btn.textContent = '…';
            fetch('/omar-dash/api/inquiries/' + btn.dataset.id + '/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ response: response }),
              credentials: 'same-origin'
            })
              .then(function(r) { return r.json(); })
              .then(function(d) { if (!d.ok) throw new Error(d.error); loadInquiries(); })
              .catch(function(e) { showToast('Resolve failed', friendlyApiError(e), 'err'); btn.disabled = false; btn.textContent = 'Mark resolved'; });
          });
        });
        $$('.thread-open-btn').forEach(function(btn) {
          btn.addEventListener('click', function() { toggleThread(btn); });
        });
        $$('.thread-reopen-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            if (!confirm('Reopen this thread? The user will be able to send messages again.')) return;
            reopenThreadFromCard(btn);
          });
        });
      })
      .catch(function(e) {
        list.innerHTML = '<div class="glass-strong empty"><div class="empty-icon">⚠️</div>Couldn\\'t load inquiries. See toast for details.</div>';
        showToast('Couldn\\'t load inquiries', friendlyApiError(e), 'err');
      });
  }

  // ── Send (admin → user notifications) ──
  //
  // Renders a form with subject + body + optional place_id deep link
  // plus a multi-select user picker that's fetched lazily on first
  // open. "Send to all users" hides the picker and dispatches to
  // everyone in users/. Selected uids persist across re-renders of
  // this view while the dashboard is open.
  var sendUsers = [];           // [{ uid, display_name, email, photo_url }]
  var sendSelectedUids = new Set();
  var sendUsersLoaded = false;

  function loadSendView() {
    var statusEl = $('#send-status'); if (statusEl) { statusEl.textContent = ''; statusEl.className = 'status-msg full'; }
    // Lazy-fetch user list — Users tab already has the data, but we
    // can't assume the user opened it first. Cache once per session.
    if (!sendUsersLoaded) {
      sendUsersLoaded = true;
      var listEl = $('#send-user-list');
      if (listEl) listEl.innerHTML = '<div style="padding:10px;font-size:12px;color:rgba(255,255,255,0.5);">Loading users…</div>';
      fetch('/omar-dash/api/users?limit=500', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(b) {
          if (!b.ok) throw new Error(b.error || 'failed');
          sendUsers = b.items || [];
          renderUserPicker();
        })
        .catch(function(e) {
          if (listEl) listEl.innerHTML = '<div class="err">Couldn\\'t load users: ' + escapeHtml(e.message) + '</div>';
          sendUsersLoaded = false; // allow retry on next view open
        });
    } else {
      renderUserPicker();
    }
  }

  function renderUserPicker() {
    var listEl = $('#send-user-list');
    var filter = ($('#send-user-filter').value || '').trim().toLowerCase();
    var rows = sendUsers
      .filter(function(u) {
        if (!filter) return true;
        return (u.display_name || '').toLowerCase().includes(filter) ||
               (u.email || '').toLowerCase().includes(filter);
      });
    if (rows.length === 0) {
      listEl.innerHTML = '<div style="padding:14px;font-size:12px;color:rgba(255,255,255,0.5);text-align:center;">No users match.</div>';
    } else {
      listEl.innerHTML = rows.map(function(u) {
        var checked = sendSelectedUids.has(u.uid);
        var avatar = u.photo_url
          ? '<img src="' + escapeHtml(u.photo_url) + '" class="avatar" alt="">'
          : '<span class="avatar-placeholder"></span>';
        return '<div class="user-list-row' + (checked ? ' checked' : '') + '" data-uid="' + escapeHtml(u.uid) + '">' +
          '<input type="checkbox"' + (checked ? ' checked' : '') + ' />' +
          avatar +
          '<div style="flex:1;min-width:0;">' +
            '<div class="uname" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(u.display_name || '(no name)') + '</div>' +
            '<div class="uemail" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(u.email || u.uid) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');
      $$('.user-list-row', listEl).forEach(function(row) {
        row.addEventListener('click', function(e) {
          // Don't double-toggle if the checkbox was the direct target.
          if (e.target.tagName === 'INPUT') return;
          var uid = row.dataset.uid;
          if (sendSelectedUids.has(uid)) sendSelectedUids.delete(uid);
          else sendSelectedUids.add(uid);
          updateSelectedCount();
          renderUserPicker();
        });
        var cb = row.querySelector('input[type="checkbox"]');
        if (cb) cb.addEventListener('change', function() {
          var uid = row.dataset.uid;
          if (cb.checked) sendSelectedUids.add(uid);
          else sendSelectedUids.delete(uid);
          updateSelectedCount();
          row.classList.toggle('checked', cb.checked);
        });
      });
    }
    updateSelectedCount();
  }

  function updateSelectedCount() {
    var n = sendSelectedUids.size;
    var el = $('#send-user-count');
    if (el) el.textContent = n === 1 ? '1 user selected' : (n + ' users selected');
  }

  function wireSendOnce() {
    if (wireSendOnce.done) return; wireSendOnce.done = true;

    var filterInput = $('#send-user-filter');
    if (filterInput) filterInput.addEventListener('input', renderUserPicker);

    var allBox = $('#send-all-users');
    var picker = $('#send-user-picker');
    if (allBox && picker) {
      allBox.addEventListener('change', function() {
        picker.hidden = allBox.checked;
      });
    }

    var sendBtn = $('#send-btn');
    if (sendBtn) sendBtn.addEventListener('click', function() {
      var subject = ($('#send-subject').value || '').trim();
      var body = ($('#send-body').value || '').trim();
      var placeId = ($('#send-place-id').value || '').trim();
      var statusEl = $('#send-status');
      var setStatus = function(text, cls) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.className = 'status-msg full ' + (cls || '');
      };
      if (!subject || !body) { setStatus('Subject and body are required.', 'err'); return; }
      var allChecked = $('#send-all-users').checked === true;
      var uids = allChecked ? null : Array.from(sendSelectedUids);
      if (!allChecked && uids.length === 0) {
        setStatus('Pick at least one user (or check "Send to all users").', 'err');
        return;
      }
      sendBtn.disabled = true;
      var origLabel = sendBtn.textContent;
      sendBtn.textContent = 'Sending…';
      setStatus('Sending…');
      var payload = { subject: subject, body: body };
      if (placeId) payload.place_id = placeId;
      if (allChecked) payload.all_users = true;
      else payload.uids = uids;
      fetch('/omar-dash/api/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.ok) throw new Error(d.error || 'send failed');
          setStatus('Sent to ' + d.sent + ' of ' + d.total + ' users' + (d.skipped ? ' (' + d.skipped + ' failed)' : '') + '.', 'ok');
          // Don't auto-clear: the admin may want to tweak + send to another batch.
        })
        .catch(function(e) { setStatus('Send failed: ' + e.message, 'err'); })
        .finally(function() {
          sendBtn.disabled = false;
          sendBtn.textContent = origLabel;
        });
    });

    var clearBtn = $('#send-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', function() {
      $('#send-subject').value = '';
      $('#send-body').value = '';
      $('#send-place-id').value = '';
      $('#send-all-users').checked = false;
      $('#send-user-picker').hidden = false;
      sendSelectedUids.clear();
      $('#send-status').textContent = '';
      $('#send-status').className = 'status-msg full';
      if (sendUsersLoaded) renderUserPicker();
    });
  }

  // ── Stats ──
  //
  // State management rule: the stats fetch is decoupled from the
  // section's UI shell. The shell — including the Catalogue
  // maintenance + Reconcile button — is rendered up front in a
  // single call to renderStatsShell() each time the user opens the
  // tab. The data fetch then PATCHES individual numbers into the
  // shell on success, or shows a toast + leaves '—' placeholders on
  // failure (typical case: 8 RESOURCE_EXHAUSTED). Earlier the whole
  // section disappeared on any /api/stats failure, taking the
  // Reconcile button with it.
  //
  // Reconcile button state: re-rendered fresh every time the tab is
  // opened. Click handler updates the CURRENT button via querySelector
  // inside .then/.finally rather than a captured DOM reference, so a
  // re-render during an in-flight request can't leave a stale
  // disabled button behind.
  function loadStats() {
    renderStatsShell();
    hydrateReconcileStatus();
    fetchStatsCounters();
  }

  // ── Reconcile helpers — shared across button + GET hydration ──
  function formatReconcileSummary(d, opts) {
    var msg = 'Reconciled ' + d.reconciled + ' of ' + d.missing_count +
      ' missing places (places=' + d.places_total + ', bucketed=' + d.bucketed_total + ').';
    if (d.skipped_rejected > 0) {
      msg += ' ' + d.skipped_rejected + ' skipped (not in Port Said / no coords).';
    }
    if (opts && opts.cached) {
      msg += ' Last run ' + agoLabel(d.seconds_since) + '.';
    }
    return msg;
  }
  function agoLabel(sec) {
    if (typeof sec !== 'number' || sec < 0) return 'just now';
    if (sec < 5) return 'just now';
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  }

  // Render the stats section skeleton — cards as '—' placeholders +
  // the Catalogue maintenance section + button. ALWAYS runs to
  // completion, regardless of network state. Re-runnable on every
  // tab open without leaking handlers (we use querySelector inside
  // the click handler, so stale closures aren't a problem).
  function renderStatsShell() {
    var grid = $('#stats-grid');
    var detail = $('#stats-detail');

    var cardLabels = [
      'Places', 'Users', 'Pending submissions', 'Open reports', 'Open inquiries'
    ];
    grid.innerHTML = cardLabels.map(function(label, i) {
      return '<div class="glass-strong stat-card" data-stat-card="' + i + '">' +
        '<div class="stat-label">' + escapeHtml(label) + '</div>' +
        '<div class="stat-num" data-stat-num="' + i + '">—</div></div>';
    }).join('');

    detail.innerHTML =
      '<div class="glass-strong stat-detail"><h3>Submissions</h3><div class="row cols-4">' +
        '<div class="item">Pending<span class="big big-yellow" data-stat="sub-pending">—</span></div>' +
        '<div class="item">Approved<span class="big big-green" data-stat="sub-approved">—</span></div>' +
        '<div class="item">Rejected<span class="big big-red" data-stat="sub-rejected">—</span></div>' +
        '<div class="item">Duplicates<span class="big big-blue" data-stat="sub-duplicate">—</span></div>' +
      '</div></div>' +
      '<div class="glass-strong stat-detail"><h3>Reports</h3><div class="row">' +
        '<div class="item">Open<span class="big big-red" data-stat="rep-open">—</span></div>' +
        '<div class="item">Resolved<span class="big big-green" data-stat="rep-resolved">—</span></div>' +
      '</div></div>' +
      '<div class="glass-strong stat-detail"><h3>Inquiries</h3><div class="row">' +
        '<div class="item">Open<span class="big big-yellow" data-stat="inq-open">—</span></div>' +
        '<div class="item">Resolved<span class="big big-green" data-stat="inq-resolved">—</span></div>' +
      '</div></div>' +
      // ── Catalogue maintenance ──
      // Reconcile is a recovery + safety net. Use it after fixing a
      // bug in approve/hot-insert, after a direct Firestore edit to
      // source_categories, or just to verify health periodically.
      '<div class="glass-strong stat-detail">' +
        '<h3>Catalogue maintenance</h3>' +
        '<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:10px;">' +
          'Approved places that didn\\'t make it into the buckets (because the hot-insert failed or pre-dated this code) get spliced in. 60-second cooldown.' +
        '</div>' +
        '<button id="reconcile-btn" class="btn btn-primary">Reconcile catalogue</button>' +
        '<div id="reconcile-status" class="status-msg" style="margin-top:10px;"></div>' +
      '</div>';

    // Wire the reconcile button. Note: the click handler resolves
    // the button + status DOM nodes via querySelector EACH TIME a
    // response lands. That means if the user navigates away mid-
    // request and back (which re-runs renderStatsShell), the
    // previous request's .then/.finally writes to a DOM node that
    // no longer exists (silent no-op via the btnNow guard) instead
    // of stranding the NEW button in a disabled state.
    var rcBtn = $('#reconcile-btn');
    if (rcBtn) {
      rcBtn.addEventListener('click', function() {
        rcBtn.disabled = true;
        rcBtn.textContent = 'Reconciling…';
        var rs = $('#reconcile-status');
        if (rs) { rs.textContent = 'Scanning places ↔ buckets…'; rs.className = 'status-msg'; }
        fetch('/omar-dash/api/catalogue/reconcile', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (!d.ok) throw new Error(d.error || 'failed');
            // Resolve the live nodes again — the user may have
            // navigated away and the original rcBtn/rcStatus may
            // be detached.
            var btnNow = $('#reconcile-btn');
            var statusNow = $('#reconcile-status');
            if (statusNow) {
              statusNow.textContent = formatReconcileSummary(d, { cached: !!d.cached });
              statusNow.className = 'status-msg ok';
            }
            if (btnNow) {
              btnNow.disabled = false;
              btnNow.textContent = 'Reconcile catalogue';
            }
            showToast('Reconcile complete',
                'Spliced ' + d.reconciled + ' place(s) into buckets.', 'ok');
          })
          .catch(function(e) {
            var btnNow = $('#reconcile-btn');
            var statusNow = $('#reconcile-status');
            if (statusNow) {
              statusNow.textContent = 'Reconcile failed: ' + e.message;
              statusNow.className = 'status-msg err';
            }
            if (btnNow) {
              btnNow.disabled = false;
              btnNow.textContent = 'Reconcile catalogue';
            }
            showToast('Reconcile failed', friendlyApiError(e), 'err');
          });
      });
    }
  }

  // Fetch the cached reconcile summary from the server-side memory
  // store (no Firestore reads). Runs on every Stats tab open so the
  // status line shows the last run's outcome — even after a tab
  // switch + return.
  function hydrateReconcileStatus() {
    var rs = $('#reconcile-status');
    if (!rs) return;
    fetch('/omar-dash/api/catalogue/reconcile', {
      method: 'GET',
      credentials: 'same-origin',
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var statusNow = $('#reconcile-status');
        if (statusNow && d && d.summary) {
          var s = Object.assign({}, d.summary, { seconds_since: d.seconds_since });
          statusNow.textContent = formatReconcileSummary(s, { cached: true });
          statusNow.className = 'status-msg ok';
        }
      })
      .catch(function() { /* silent — first run, fresh server */ });
  }

  // Fetch the live counters and PATCH them into the shell. Failure
  // here MUST NOT replace the shell — that was the bug that made the
  // Reconcile button vanish whenever /api/stats hit a quota error.
  function fetchStatsCounters() {
    fetch('/omar-dash/api/stats', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(b) {
        if (!b.ok) throw new Error(b.error || 'failed');
        // Patch top cards in order.
        var nums = [
          b.places, b.users,
          (b.submissions && b.submissions.pending) || 0,
          (b.reports && b.reports.open) || 0,
          (b.inquiries && b.inquiries.open) || 0
        ];
        nums.forEach(function(n, i) {
          var el = document.querySelector('[data-stat-num="' + i + '"]');
          if (el) el.textContent = n;
        });
        // Patch detail rows.
        function setStat(key, value) {
          var el = document.querySelector('[data-stat="' + key + '"]');
          if (el) el.textContent = value;
        }
        if (b.submissions) {
          setStat('sub-pending', b.submissions.pending || 0);
          setStat('sub-approved', b.submissions.approved || 0);
          setStat('sub-rejected', b.submissions.rejected || 0);
          setStat('sub-duplicate', b.submissions.duplicate || 0);
        }
        if (b.reports) {
          setStat('rep-open', b.reports.open || 0);
          setStat('rep-resolved', b.reports.resolved || 0);
        }
        if (b.inquiries) {
          setStat('inq-open', b.inquiries.open || 0);
          setStat('inq-resolved', b.inquiries.resolved || 0);
        }
      })
      .catch(function(e) {
        // Leave the '—' placeholders in place. Show a toast so the
        // admin knows something went wrong AND the reconcile button
        // stays usable.
        showToast(
          'Couldn\\'t load stats',
          friendlyApiError(e),
          'err',
        );
      });
  }

  // Translate the technical API errors that bubble out of fetch() +
  // .then() into something an admin can act on. We keep the original
  // message in parens for debugging.
  function friendlyApiError(e) {
    var raw = (e && e.message) || String(e || '');
    if (/RESOURCE_EXHAUSTED|Quota exceeded/i.test(raw)) {
      return 'Daily Firestore quota exhausted. Counts will refresh when the quota resets (midnight Pacific). Other admin actions still work.';
    }
    if (/permission-denied|UNAUTHENTICATED/i.test(raw)) {
      return 'Permission denied. Re-authenticate the basic-auth challenge.';
    }
    if (/network|fetch|Failed to fetch/i.test(raw)) {
      return 'Network issue. Check your connection and try again.';
    }
    return raw;
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
  $$('[data-inq-status]').forEach(function(t) {
    t.addEventListener('click', function() { setInqStatus(t.dataset.inqStatus); });
  });
  $('#refreshBtn').addEventListener('click', function() { load(currentView); });
  // Search / filter actions reset to page 1 — a new query shouldn't
  // leave the table mid-pagination on an unrelated slice.
  $('#places-search-btn').addEventListener('click', function() {
    loadPlaces({ resetOffset: true });
  });
  $('#places-search').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadPlaces({ resetOffset: true });
  });

  setSubStatus('pending');
  setRepStatus('open');
  setInqStatus('open');
  wireSendOnce();
  wirePlaceModalOnce();
  setView('submissions');
</script>
</body>
</html>`;
}
