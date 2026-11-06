const http = require('node:http');

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function formatUptime(totalSeconds) {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor((totalSeconds / 3600) % 24);
  const d = Math.floor(totalSeconds / 86400);
  if (d > 0) return `${d}g ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function renderPage(info) {
  const rows = [
    ['Bot', info.botTag || '—'],
    ['Stato', info.ready ? 'online' : 'in avvio'],
    ['Server', info.servers],
    ['Battaglie in corso', info.battles],
    ['Pokémon in cache', info.pokemonCached],
    ['Versione', info.version],
    ['Node', info.node],
    ['Uptime', formatUptime(info.uptimeSeconds)],
  ];

  const body = rows
    .map(
      ([k, v]) =>
        `<tr><th>${esc(k)}</th><td${k === 'Stato' ? ` class="${info.ready ? 'ok' : 'wait'}"` : ''}>${esc(v)}</td></tr>`,
    )
    .join('\n        ');

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Pokémon Battle Bot · stato</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
      background: #1e1f26; color: #eef0f6;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: 100%; max-width: 500px; padding: 32px 36px; border-radius: 22px;
      background: #262933; box-shadow: 0 20px 50px rgba(0, 0, 0, .35);
    }
    h1 { margin: 0 0 4px; font-size: 26px; }
    .sub { margin: 0 0 24px; color: #8f98b3; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #333747; }
    tr:last-child { border-bottom: 0; }
    th, td { padding: 11px 4px; font-size: 16px; }
    th { text-align: left; font-weight: 600; color: #8f98b3; }
    td { text-align: right; }
    td.ok { color: #57d68d; }
    td.wait { color: #f4c542; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Pokémon Battle Bot</h1>
    <p class="sub">Bot di battaglie Pokémon per Discord · pagina di stato</p>
    <table>
      <tbody>
        ${body}
      </tbody>
    </table>
  </main>
</body>
</html>
`;
}

/**
 * Server HTTP minimale:
 *  - `/`       pagina di stato (sempre 200: tiene sveglio il servizio su Render)
 *  - `/health` JSON, 200 se il bot è connesso a Discord, 503 altrimenti
 * `getInfo` ritorna lo stato corrente.
 */
function createStatusServer(getInfo) {
  return http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const headers = { 'Cache-Control': 'no-store' };

    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderPage(getInfo()));
    }

    if (path === '/health') {
      const info = getInfo();
      res.writeHead(info.ready ? 200 : 503, { ...headers, 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({ status: info.ready ? 'ok' : 'starting', uptime: Math.floor(info.uptimeSeconds) }),
      );
    }

    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
}

module.exports = { createStatusServer, renderPage, formatUptime };
