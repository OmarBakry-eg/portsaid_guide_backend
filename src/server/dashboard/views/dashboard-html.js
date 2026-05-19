// Server-rendered SPA shell for /omar-dash. Five views:
//   - Submissions   (pending queue + status filter)
//   - Places        (all catalogue places, filterable)
//   - Users         (signed-in users, submission count)
//   - Reports       (open issues users flagged)
//   - Stats         (totals + breakdown)
//
// Zero-build: Tailwind CDN + vanilla JS. The single HTML shell ships
// every section's markup hidden by default; the client toggles
// visibility and fetches the appropriate JSON endpoint on tab change.

export function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PortSaid Guide — Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; }
    .aurora {
      position: fixed; inset: 0; z-index: -1; overflow: hidden;
      background: radial-gradient(circle at 20% 30%, rgba(255, 140, 90, 0.18), transparent 50%),
                  radial-gradient(circle at 80% 60%, rgba(80, 180, 220, 0.18), transparent 50%),
                  radial-gradient(circle at 50% 100%, rgba(200, 100, 220, 0.12), transparent 60%),
                  #0a0e1a;
    }
    .glass { background: rgba(255, 255, 255, 0.04); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.08); }
    .glass-strong { background: rgba(255, 255, 255, 0.06); backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); border: 1px solid rgba(255, 255, 255, 0.10); }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; display: inline-block; }
    .pill-pending  { background: rgba(255, 200, 50, 0.18); color: #ffd060; }
    .pill-approved { background: rgba(80, 220, 130, 0.18); color: #6cf09a; }
    .pill-rejected { background: rgba(255, 110, 100, 0.18); color: #ff8a82; }
    .pill-duplicate{ background: rgba(120, 160, 255, 0.18); color: #97b6ff; }
    .pill-open     { background: rgba(255, 110, 100, 0.18); color: #ff8a82; }
    .pill-resolved { background: rgba(80, 220, 130, 0.18); color: #6cf09a; }
    .pill-ghost    { background: rgba(255, 255, 255, 0.10); color: rgba(255, 255, 255, 0.70); }
    .btn-primary { background: linear-gradient(135deg, #ff9555, #ff6b9d); color: white; padding: 8px 18px; border-radius: 10px; font-weight: 700; font-size: 13px; transition: transform 0.15s; }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255, 130, 130, 0.30); }
    .btn-ghost { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.85); padding: 8px 16px; border-radius: 10px; font-weight: 600; font-size: 13px; border: 1px solid rgba(255, 255, 255, 0.10); }
    .btn-ghost:hover { background: rgba(255, 255, 255, 0.10); }
    .btn-danger { background: rgba(255, 70, 70, 0.16); color: #ff8a82; padding: 8px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; border: 1px solid rgba(255, 100, 100, 0.30); }
    .btn-danger:hover { background: rgba(255, 70, 70, 0.22); }
    a.url { color: #97b6ff; text-decoration: none; word-break: break-all; }
    a.url:hover { text-decoration: underline; }
    .scroll-hide::-webkit-scrollbar { display: none; }
    .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; color: rgba(255,255,255,0.7); font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.15s; }
    .nav-item:hover { background: rgba(255,255,255,0.06); color: white; }
    .nav-item.active { background: rgba(255, 149, 85, 0.18); color: white; border: 1px solid rgba(255, 149, 85, 0.40); }
    .stat-card { padding: 18px 20px; border-radius: 16px; }
    .stat-num { font-size: 28px; font-weight: 800; line-height: 1; background: linear-gradient(135deg, #ff9555, #ff6b9d); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    table.tbl { width: 100%; border-collapse: collapse; }
    table.tbl th { padding: 10px; text-align: left; font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid rgba(255,255,255,0.08); }
    table.tbl td { padding: 12px 10px; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    table.tbl tr:hover td { background: rgba(255,255,255,0.03); }
  </style>
</head>
<body class="text-white">
  <div class="aurora"></div>

  <div class="max-w-7xl mx-auto px-4 md:px-6 py-6">
    <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight">
          <span style="background: linear-gradient(135deg, #ff9555, #ff6b9d); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">PortSaid Guide</span>
          <span class="text-white/70">— Admin</span>
        </h1>
        <p class="text-sm text-white/50 mt-1">Manage submissions, places, users, and reports.</p>
      </div>
      <button id="refreshBtn" class="btn-ghost flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
        Refresh
      </button>
    </header>

    <div class="flex flex-col md:flex-row gap-6">
      <!-- Side nav -->
      <aside class="md:w-56 flex-shrink-0">
        <div class="glass rounded-2xl p-2 sticky top-4 flex md:flex-col gap-1 overflow-x-auto scroll-hide">
          <div class="nav-item active" data-view="submissions"><span>📋</span><span>Submissions</span></div>
          <div class="nav-item" data-view="places"><span>🗺️</span><span>All places</span></div>
          <div class="nav-item" data-view="users"><span>👤</span><span>Users</span></div>
          <div class="nav-item" data-view="reports"><span>🚩</span><span>Reports</span></div>
          <div class="nav-item" data-view="stats"><span>📊</span><span>Stats</span></div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0">
        <!-- Submissions view -->
        <section data-view-section="submissions">
          <div class="glass rounded-2xl p-2 mb-4 flex gap-2 overflow-x-auto scroll-hide">
            <button data-sub-status="pending"   class="sub-tab btn-ghost whitespace-nowrap">Pending <span id="count-pending" class="opacity-60 text-xs ml-1"></span></button>
            <button data-sub-status="approved"  class="sub-tab btn-ghost whitespace-nowrap">Approved</button>
            <button data-sub-status="rejected"  class="sub-tab btn-ghost whitespace-nowrap">Rejected</button>
            <button data-sub-status="duplicate" class="sub-tab btn-ghost whitespace-nowrap">Duplicates</button>
            <button data-sub-status="all"       class="sub-tab btn-ghost whitespace-nowrap">All</button>
          </div>
          <div id="submissions-list" class="space-y-3"></div>
        </section>

        <!-- Places view -->
        <section data-view-section="places" style="display:none">
          <div class="glass-strong rounded-2xl p-4 mb-4">
            <div class="flex flex-wrap gap-2">
              <input id="places-search" placeholder="Search title…" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
              <input id="places-main" placeholder="main slug (food / shopping…)" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm w-[200px]" />
              <input id="places-sub" placeholder="sub slug (coffee / bank…)" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm w-[200px]" />
              <button id="places-search-btn" class="btn-primary">Search</button>
            </div>
            <p class="text-xs text-white/40 mt-2">Filtering 'main' surfaces all sub-slugs of that main. 'sub' is exact match.</p>
          </div>
          <div class="glass-strong rounded-2xl overflow-hidden">
            <table class="tbl" id="places-table">
              <thead>
                <tr><th>Title</th><th>Type</th><th>Primary</th><th>Rating</th><th>Source</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </section>

        <!-- Users view -->
        <section data-view-section="users" style="display:none">
          <div class="glass-strong rounded-2xl overflow-hidden">
            <table class="tbl" id="users-table">
              <thead>
                <tr><th>User</th><th>Email</th><th>Joined</th><th>Last login</th><th>Submissions</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </section>

        <!-- Reports view -->
        <section data-view-section="reports" style="display:none">
          <div class="glass rounded-2xl p-2 mb-4 flex gap-2 overflow-x-auto scroll-hide">
            <button data-rep-status="open"     class="rep-tab btn-ghost whitespace-nowrap">Open</button>
            <button data-rep-status="resolved" class="rep-tab btn-ghost whitespace-nowrap">Resolved</button>
            <button data-rep-status="all"      class="rep-tab btn-ghost whitespace-nowrap">All</button>
          </div>
          <div id="reports-list" class="space-y-3"></div>
        </section>

        <!-- Stats view -->
        <section data-view-section="stats" style="display:none">
          <div id="stats-grid" class="grid grid-cols-2 md:grid-cols-4 gap-4"></div>
          <div id="stats-detail" class="mt-6"></div>
        </section>
      </main>
    </div>

    <footer class="mt-12 text-center text-xs text-white/30">PortSaid Guide admin — protected by basic auth.</footer>
  </div>

  <script>
    const $ = (s, root) => (root || document).querySelector(s);
    const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));

    function escapeHtml(s) {
      if (s == null) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    }

    let currentView = 'submissions';
    let subStatus = 'pending';
    let repStatus = 'open';

    function setView(view) {
      currentView = view;
      $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
      $$('[data-view-section]').forEach(s => s.style.display = s.dataset.viewSection === view ? '' : 'none');
      load(view);
    }

    function setSubStatus(s) {
      subStatus = s;
      $$('.sub-tab').forEach(t => {
        t.style.background = t.dataset.subStatus === s ? 'rgba(255, 149, 85, 0.18)' : '';
        t.style.borderColor = t.dataset.subStatus === s ? 'rgba(255, 149, 85, 0.50)' : '';
      });
      loadSubmissions();
    }

    function setRepStatus(s) {
      repStatus = s;
      $$('.rep-tab').forEach(t => {
        t.style.background = t.dataset.repStatus === s ? 'rgba(255, 149, 85, 0.18)' : '';
        t.style.borderColor = t.dataset.repStatus === s ? 'rgba(255, 149, 85, 0.50)' : '';
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

    // ── Submissions ─────────────────────────────────────────────
    function submissionPill(s) {
      return '<span class="pill pill-' + s + '">' + s.toUpperCase() + '</span>';
    }
    function renderSubmission(it) {
      const v = it.ai_verdict || {};
      const conf = typeof v.confidence === 'number' ? (v.confidence * 100).toFixed(0) + '%' : '—';
      const aiBlock = it.ai_verdict
        ? '<div class="mt-3 text-xs text-white/50 space-y-1">' +
          '<div><span class="text-white/70">AI:</span> ' + escapeHtml(v.primary_slug || '—') + ' <span class="ml-2 text-white/40">conf: ' + conf + '</span></div>' +
          (v.reasoning ? '<div class="text-white/40 italic">"' + escapeHtml(v.reasoning).slice(0, 220) + '"</div>' : '') +
          '</div>'
        : '';
      const noteBlock = it.admin_note ? '<div class="mt-2 text-xs text-white/50"><span class="text-white/70">Note:</span> ' + escapeHtml(it.admin_note) + '</div>' : '';
      const actions = it.status === 'pending'
        ? '<div class="flex flex-wrap gap-2 mt-4"><button class="btn-primary approve-btn" data-id="' + it.id + '">Approve & add</button><button class="btn-danger reject-btn" data-id="' + it.id + '">Reject</button></div>'
        : '<div class="mt-3 text-xs text-white/40">Resolved ' + fmtDate(it.resolved_at) + (it.resolved_by ? ' by ' + escapeHtml(it.resolved_by) : '') + '</div>';
      return '<div class="glass-strong rounded-2xl p-5"><div class="flex items-start justify-between gap-3 mb-2"><div class="min-w-0 flex-1"><div class="flex items-center gap-3 flex-wrap">' + submissionPill(it.status) + '<span class="text-xs text-white/50">' + fmtDate(it.submitted_at) + '</span></div><h3 class="text-base md:text-lg font-bold mt-2 truncate">' + escapeHtml(it.extracted_title || '(no extracted title)') + '</h3>' + (it.extracted_place_id ? '<div class="text-xs text-white/50 mt-1 font-mono">place_id: ' + escapeHtml(it.extracted_place_id) + '</div>' : '') + '</div></div><div class="text-xs"><a class="url" href="' + escapeHtml(it.submitted_url) + '" target="_blank" rel="noopener">' + escapeHtml(it.submitted_url) + '</a></div>' + aiBlock + noteBlock + actions + '</div>';
    }
    async function loadSubmissions() {
      const list = $('#submissions-list');
      list.innerHTML = '<div class="text-white/40 p-4">Loading…</div>';
      try {
        const r = await fetch('/omar-dash/api/submissions?status=' + subStatus + '&limit=200', { credentials: 'same-origin' });
        const b = await r.json();
        if (!b.ok) throw new Error(b.error);
        if (subStatus === 'pending') $('#count-pending').textContent = '(' + b.count + ')';
        list.innerHTML = b.items.length ? b.items.map(renderSubmission).join('') : '<div class="glass-strong rounded-2xl p-12 text-center text-white/50">Nothing here yet.</div>';
        wireSubActions();
      } catch (e) { list.innerHTML = '<div class="text-red-300 p-4">Error: ' + escapeHtml(e.message) + '</div>'; }
    }
    function wireSubActions() {
      $$('.approve-btn').forEach(b => b.addEventListener('click', async () => {
        const note = prompt('Optional note for this approval:') || '';
        b.disabled = true; b.textContent = '…';
        try {
          const r = await fetch('/omar-dash/api/submissions/' + b.dataset.id + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }), credentials: 'same-origin' });
          const data = await r.json(); if (!data.ok) throw new Error(data.error);
          loadSubmissions();
        } catch (e) { alert('Approve failed: ' + e.message); b.disabled = false; b.textContent = 'Approve & add'; }
      }));
      $$('.reject-btn').forEach(b => b.addEventListener('click', async () => {
        const reason = prompt('Reason for rejection (visible to submitter):');
        if (!reason || !reason.trim()) return;
        b.disabled = true; b.textContent = '…';
        try {
          const r = await fetch('/omar-dash/api/submissions/' + b.dataset.id + '/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }), credentials: 'same-origin' });
          const data = await r.json(); if (!data.ok) throw new Error(data.error);
          loadSubmissions();
        } catch (e) { alert('Reject failed: ' + e.message); b.disabled = false; b.textContent = 'Reject'; }
      }));
    }

    // ── Places ──────────────────────────────────────────────────
    async function loadPlaces() {
      const search = $('#places-search').value.trim();
      const main = $('#places-main').value.trim();
      const sub = $('#places-sub').value.trim();
      const tbody = $('#places-table tbody');
      tbody.innerHTML = '<tr><td colspan="5" class="text-white/40">Loading…</td></tr>';
      const params = new URLSearchParams({ limit: '200' });
      if (search) params.set('search', search);
      if (main) params.set('main', main);
      if (sub) params.set('sub', sub);
      try {
        const r = await fetch('/omar-dash/api/places?' + params.toString(), { credentials: 'same-origin' });
        const b = await r.json();
        if (!b.ok) throw new Error(b.error);
        if (!b.items.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-white/40 text-center py-8">No places match.</td></tr>'; return; }
        tbody.innerHTML = b.items.map(p => '<tr><td><div class="font-semibold">' + escapeHtml(p.title) + '</div><div class="text-xs text-white/40 font-mono">' + escapeHtml(p.place_id) + '</div></td><td>' + escapeHtml(p.type || '—') + '</td><td>' + escapeHtml(p.primary_slug || '—') + '</td><td>' + (p.rating != null ? p.rating + ' ★ <span class="text-white/40">(' + (p.reviews || 0) + ')</span>' : '—') + '</td><td><span class="pill pill-ghost">' + (p.created_via || 'scraper') + '</span></td></tr>').join('');
      } catch (e) { tbody.innerHTML = '<tr><td colspan="5" class="text-red-300">Error: ' + escapeHtml(e.message) + '</td></tr>'; }
    }
    $('#places-search-btn').addEventListener('click', loadPlaces);
    $('#places-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPlaces(); });

    // ── Users ───────────────────────────────────────────────────
    async function loadUsers() {
      const tbody = $('#users-table tbody');
      tbody.innerHTML = '<tr><td colspan="5" class="text-white/40">Loading…</td></tr>';
      try {
        const r = await fetch('/omar-dash/api/users?limit=200', { credentials: 'same-origin' });
        const b = await r.json();
        if (!b.ok) throw new Error(b.error);
        if (!b.items.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-white/40 text-center py-8">No users yet.</td></tr>'; return; }
        tbody.innerHTML = b.items.map(u => {
          const avatar = u.photo_url ? '<img src="' + escapeHtml(u.photo_url) + '" class="w-7 h-7 rounded-full inline-block mr-2"/>' : '<div class="w-7 h-7 rounded-full bg-white/10 inline-block mr-2 align-middle"></div>';
          return '<tr><td>' + avatar + '<span class="align-middle font-semibold">' + escapeHtml(u.display_name || '(no name)') + '</span></td><td class="text-white/70">' + escapeHtml(u.email || '—') + '</td><td class="text-white/50">' + fmtDate(u.created_at) + '</td><td class="text-white/50">' + fmtDate(u.last_login_at) + '</td><td><span class="pill ' + (u.submission_count > 0 ? 'pill-approved' : 'pill-ghost') + '">' + u.submission_count + '</span></td></tr>';
        }).join('');
      } catch (e) { tbody.innerHTML = '<tr><td colspan="5" class="text-red-300">Error: ' + escapeHtml(e.message) + '</td></tr>'; }
    }

    // ── Reports ─────────────────────────────────────────────────
    function renderReport(it) {
      const noteBlock = it.note ? '<div class="mt-2 text-xs text-white/60">' + escapeHtml(it.note) + '</div>' : '';
      const action = it.status === 'open'
        ? '<button class="btn-primary resolve-btn mt-3" data-id="' + it.id + '">Mark resolved</button>'
        : '';
      return '<div class="glass-strong rounded-2xl p-5"><div class="flex items-center gap-3 flex-wrap mb-2"><span class="pill pill-' + it.status + '">' + it.status.toUpperCase() + '</span><span class="text-xs text-white/50">' + fmtDate(it.created_at) + '</span></div><div class="font-semibold text-sm">' + escapeHtml(it.reason) + ' <span class="text-white/40 text-xs">on</span> <span class="font-mono text-xs text-white/60">' + escapeHtml(it.place_id) + '</span></div>' + noteBlock + '<div class="mt-2 text-xs text-white/40">by ' + escapeHtml(it.reported_by_email || it.reported_by_uid) + '</div>' + action + '</div>';
    }
    async function loadReports() {
      const list = $('#reports-list');
      list.innerHTML = '<div class="text-white/40 p-4">Loading…</div>';
      try {
        const r = await fetch('/omar-dash/api/reports?status=' + repStatus + '&limit=200', { credentials: 'same-origin' });
        const b = await r.json();
        if (!b.ok) throw new Error(b.error);
        list.innerHTML = b.items.length ? b.items.map(renderReport).join('') : '<div class="glass-strong rounded-2xl p-12 text-center text-white/50">Nothing here.</div>';
        $$('.resolve-btn').forEach(btn => btn.addEventListener('click', async () => {
          btn.disabled = true; btn.textContent = '…';
          try {
            const r = await fetch('/omar-dash/api/reports/' + btn.dataset.id + '/resolve', { method: 'POST', credentials: 'same-origin' });
            const data = await r.json(); if (!data.ok) throw new Error(data.error);
            loadReports();
          } catch (e) { alert('Resolve failed: ' + e.message); btn.disabled = false; btn.textContent = 'Mark resolved'; }
        }));
      } catch (e) { list.innerHTML = '<div class="text-red-300 p-4">Error: ' + escapeHtml(e.message) + '</div>'; }
    }

    // ── Stats ───────────────────────────────────────────────────
    async function loadStats() {
      const grid = $('#stats-grid');
      const detail = $('#stats-detail');
      grid.innerHTML = '<div class="text-white/40 col-span-4">Loading…</div>';
      try {
        const r = await fetch('/omar-dash/api/stats', { credentials: 'same-origin' });
        const b = await r.json();
        if (!b.ok) throw new Error(b.error);
        const cards = [
          ['Places',  b.places],
          ['Users',   b.users],
          ['Pending submissions', b.submissions.pending],
          ['Open reports', b.reports.open],
        ];
        grid.innerHTML = cards.map(([k, v]) => '<div class="glass-strong stat-card"><div class="text-xs text-white/50 uppercase tracking-wide">' + escapeHtml(k) + '</div><div class="stat-num mt-2">' + v + '</div></div>').join('');
        detail.innerHTML = '<div class="glass-strong rounded-2xl p-5"><h3 class="text-base font-bold mb-3">Submissions</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-3"><div>Pending<br><span class="text-2xl font-extrabold text-yellow-300">' + b.submissions.pending + '</span></div><div>Approved<br><span class="text-2xl font-extrabold text-green-300">' + b.submissions.approved + '</span></div><div>Rejected<br><span class="text-2xl font-extrabold text-red-300">' + b.submissions.rejected + '</span></div><div>Duplicates<br><span class="text-2xl font-extrabold text-blue-300">' + b.submissions.duplicate + '</span></div></div></div><div class="glass-strong rounded-2xl p-5 mt-4"><h3 class="text-base font-bold mb-3">Reports</h3><div class="grid grid-cols-2 gap-3"><div>Open<br><span class="text-2xl font-extrabold text-red-300">' + b.reports.open + '</span></div><div>Resolved<br><span class="text-2xl font-extrabold text-green-300">' + b.reports.resolved + '</span></div></div></div>';
      } catch (e) { grid.innerHTML = '<div class="text-red-300 col-span-4">Error: ' + escapeHtml(e.message) + '</div>'; }
    }

    // ── Wire-up ─────────────────────────────────────────────────
    $$('.nav-item').forEach(n => n.addEventListener('click', () => setView(n.dataset.view)));
    $$('.sub-tab').forEach(t => t.addEventListener('click', () => setSubStatus(t.dataset.subStatus)));
    $$('.rep-tab').forEach(t => t.addEventListener('click', () => setRepStatus(t.dataset.repStatus)));
    $('#refreshBtn').addEventListener('click', () => load(currentView));

    setSubStatus('pending');
    setRepStatus('open');
    setView('submissions');
  </script>
</body>
</html>`;
}
