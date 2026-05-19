// Server-side HTML render for /omar-dash. No template engine — just
// template literals so the deployment stays zero-build. Dark glass
// theme matches the mobile app's aesthetic (sunset gradient over
// dark canvas, frosted-glass cards). Tailwind via CDN handles
// utility classes; Lucide icons inlined where helpful.

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
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .aurora {
      position: fixed; inset: 0; z-index: -1; overflow: hidden;
      background: radial-gradient(circle at 20% 30%, rgba(255, 140, 90, 0.18), transparent 50%),
                  radial-gradient(circle at 80% 60%, rgba(80, 180, 220, 0.18), transparent 50%),
                  radial-gradient(circle at 50% 100%, rgba(200, 100, 220, 0.12), transparent 60%),
                  #0a0e1a;
    }
    .glass {
      background: rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .glass-strong {
      background: rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
      border: 1px solid rgba(255, 255, 255, 0.10);
    }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
    .pill-pending  { background: rgba(255, 200, 50, 0.18); color: #ffd060; }
    .pill-approved { background: rgba(80, 220, 130, 0.18); color: #6cf09a; }
    .pill-rejected { background: rgba(255, 110, 100, 0.18); color: #ff8a82; }
    .pill-duplicate{ background: rgba(120, 160, 255, 0.18); color: #97b6ff; }
    .btn-primary {
      background: linear-gradient(135deg, #ff9555, #ff6b9d);
      color: white; padding: 8px 18px; border-radius: 10px;
      font-weight: 700; font-size: 13px; transition: transform 0.15s;
    }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255, 130, 130, 0.30); }
    .btn-ghost {
      background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.85);
      padding: 8px 16px; border-radius: 10px; font-weight: 600; font-size: 13px;
      border: 1px solid rgba(255, 255, 255, 0.10);
    }
    .btn-ghost:hover { background: rgba(255, 255, 255, 0.10); }
    .btn-danger {
      background: rgba(255, 70, 70, 0.16); color: #ff8a82;
      padding: 8px 16px; border-radius: 10px; font-weight: 700; font-size: 13px;
      border: 1px solid rgba(255, 100, 100, 0.30);
    }
    .btn-danger:hover { background: rgba(255, 70, 70, 0.22); }
    a.url { color: #97b6ff; text-decoration: none; word-break: break-all; }
    a.url:hover { text-decoration: underline; }
    .scroll-hide::-webkit-scrollbar { display: none; }
  </style>
</head>
<body class="text-white">
  <div class="aurora"></div>

  <div class="max-w-6xl mx-auto px-4 md:px-8 py-8">
    <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight">
          <span style="background: linear-gradient(135deg, #ff9555, #ff6b9d); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">PortSaid Guide</span>
          <span class="text-white/70">— Admin</span>
        </h1>
        <p class="text-sm text-white/50 mt-1">Pending submissions, approve / reject, audit history.</p>
      </div>
      <button id="refreshBtn" class="btn-ghost flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
        Refresh
      </button>
    </header>

    <!-- Tabs -->
    <div class="glass rounded-2xl p-2 mb-6 flex gap-2 overflow-x-auto scroll-hide">
      <button data-status="pending"   class="tab btn-ghost whitespace-nowrap">Pending <span id="count-pending" class="opacity-60 text-xs ml-1"></span></button>
      <button data-status="approved"  class="tab btn-ghost whitespace-nowrap">Approved</button>
      <button data-status="rejected"  class="tab btn-ghost whitespace-nowrap">Rejected</button>
      <button data-status="duplicate" class="tab btn-ghost whitespace-nowrap">Duplicates</button>
      <button data-status="all"       class="tab btn-ghost whitespace-nowrap">All</button>
    </div>

    <!-- Listing -->
    <div id="listingArea">
      <div id="emptyState" class="glass-strong rounded-2xl p-16 text-center hidden">
        <div class="text-white/40 mb-3">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
        </div>
        <p class="text-white/60">Nothing here yet.</p>
      </div>
      <div id="loadingState" class="glass-strong rounded-2xl p-16 text-center">
        <p class="text-white/60">Loading submissions…</p>
      </div>
      <div id="items" class="space-y-3"></div>
    </div>

    <footer class="mt-12 text-center text-xs text-white/30">
      PortSaid Guide admin — protected by basic auth. v1.
    </footer>
  </div>

  <script>
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    let currentStatus = 'pending';

    function statusPill(s) {
      const cls = {
        pending: 'pill-pending',
        approved: 'pill-approved',
        rejected: 'pill-rejected',
        duplicate: 'pill-duplicate',
      }[s] || 'pill-ghost';
      return '<span class="pill ' + cls + '">' + s.toUpperCase() + '</span>';
    }

    function fmtDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function escapeHtml(s) {
      if (!s) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderItem(item) {
      const verdict = item.ai_verdict || {};
      const confidence = typeof verdict.confidence === 'number'
        ? (verdict.confidence * 100).toFixed(0) + '%'
        : '—';
      const aiBlock = item.ai_verdict
        ? '<div class="mt-3 text-xs text-white/50 space-y-1">' +
          '<div><span class="text-white/70">AI:</span> ' +
            escapeHtml(verdict.primary_slug || '—') +
            ' <span class="ml-2 text-white/40">conf: ' + confidence + '</span></div>' +
          (verdict.reasoning
            ? '<div class="text-white/40 italic">"' + escapeHtml(verdict.reasoning).slice(0, 220) + '"</div>'
            : '') +
          '</div>'
        : '';
      const noteBlock = item.admin_note
        ? '<div class="mt-2 text-xs text-white/50"><span class="text-white/70">Note:</span> ' + escapeHtml(item.admin_note) + '</div>'
        : '';
      const isPending = item.status === 'pending';
      const actions = isPending
        ? '<div class="flex flex-wrap gap-2 mt-4">' +
          '<button class="btn-primary approve-btn" data-id="' + item.id + '">Approve & add</button>' +
          '<button class="btn-danger reject-btn" data-id="' + item.id + '">Reject</button>' +
          '</div>'
        : '<div class="mt-3 text-xs text-white/40">Resolved ' + fmtDate(item.resolved_at) +
          (item.resolved_by ? ' by ' + escapeHtml(item.resolved_by) : '') + '</div>';
      return '<div class="glass-strong rounded-2xl p-5">' +
        '<div class="flex items-start justify-between gap-3 mb-2">' +
          '<div class="min-w-0 flex-1">' +
            '<div class="flex items-center gap-3 flex-wrap">' +
              statusPill(item.status) +
              '<span class="text-xs text-white/50">' + fmtDate(item.submitted_at) + '</span>' +
            '</div>' +
            '<h3 class="text-base md:text-lg font-bold mt-2 truncate">' + escapeHtml(item.extracted_title || '(no extracted title)') + '</h3>' +
            (item.extracted_place_id
              ? '<div class="text-xs text-white/50 mt-1 font-mono">place_id: ' + escapeHtml(item.extracted_place_id) + '</div>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="text-xs">' +
          '<a class="url" href="' + escapeHtml(item.submitted_url) + '" target="_blank" rel="noopener">' + escapeHtml(item.submitted_url) + '</a>' +
        '</div>' +
        aiBlock + noteBlock + actions +
        '</div>';
    }

    async function loadSubmissions() {
      $('#loadingState').classList.remove('hidden');
      $('#emptyState').classList.add('hidden');
      $('#items').innerHTML = '';
      try {
        const res = await fetch('/omar-dash/api/submissions?status=' + currentStatus + '&limit=200', { credentials: 'same-origin' });
        const body = await res.json();
        $('#loadingState').classList.add('hidden');
        if (!body.ok) throw new Error(body.error || 'load failed');
        if (currentStatus === 'pending') $('#count-pending').textContent = '(' + body.count + ')';
        if (!body.items.length) {
          $('#emptyState').classList.remove('hidden');
          return;
        }
        $('#items').innerHTML = body.items.map(renderItem).join('');
        wireActions();
      } catch (e) {
        $('#loadingState').classList.add('hidden');
        $('#items').innerHTML = '<div class="glass-strong rounded-2xl p-6 text-center text-red-300">Error: ' + escapeHtml(e.message) + '</div>';
      }
    }

    function wireActions() {
      $$('.approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const note = prompt('Optional note for this approval:') || '';
          btn.disabled = true; btn.textContent = 'Approving…';
          try {
            const res = await fetch('/omar-dash/api/submissions/' + id + '/approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note }),
              credentials: 'same-origin',
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error);
            await loadSubmissions();
          } catch (e) {
            alert('Approve failed: ' + e.message);
            btn.disabled = false; btn.textContent = 'Approve & add';
          }
        });
      });
      $$('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const reason = prompt('Reason for rejection (visible to submitter):') || '';
          if (!reason.trim()) return;
          btn.disabled = true; btn.textContent = 'Rejecting…';
          try {
            const res = await fetch('/omar-dash/api/submissions/' + id + '/reject', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason }),
              credentials: 'same-origin',
            });
            const body = await res.json();
            if (!body.ok) throw new Error(body.error);
            await loadSubmissions();
          } catch (e) {
            alert('Reject failed: ' + e.message);
            btn.disabled = false; btn.textContent = 'Reject';
          }
        });
      });
    }

    function setActiveTab() {
      $$('.tab').forEach(t => {
        t.style.background = t.dataset.status === currentStatus
          ? 'rgba(255, 149, 85, 0.18)'
          : '';
        t.style.borderColor = t.dataset.status === currentStatus
          ? 'rgba(255, 149, 85, 0.50)'
          : '';
      });
    }

    $$('.tab').forEach(t => {
      t.addEventListener('click', () => {
        currentStatus = t.dataset.status;
        setActiveTab();
        loadSubmissions();
      });
    });
    $('#refreshBtn').addEventListener('click', loadSubmissions);

    setActiveTab();
    loadSubmissions();
  </script>
</body>
</html>`;
}
