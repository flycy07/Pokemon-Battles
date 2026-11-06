const test = require('node:test');
const assert = require('node:assert');
const { createStatusServer, renderPage, formatUptime } = require('../src/status');

const info = (over = {}) => ({
  ready: true,
  botTag: 'Poke#0001',
  servers: 2,
  battles: 1,
  pokemonCached: 42,
  version: 'abc1234',
  node: 'v22.0.0',
  uptimeSeconds: 840,
  ...over,
});

test('formatUptime', () => {
  assert.strictEqual(formatUptime(840), '14m 0s');
  assert.strictEqual(formatUptime(3725), '1h 2m 5s');
  assert.strictEqual(formatUptime(90000), '1g 1h 0m');
});

test('la pagina mostra i dati ed esegue l\'escape', () => {
  const html = renderPage(info({ botTag: '<script>x</script>' }));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('online') && html.includes('14m 0s') && html.includes('abc1234'));
});

test('server: / sempre 200, /health 503 finché il bot non è pronto, HEAD ok', async () => {
  let current = info({ ready: false });
  const server = createStatusServer(() => current).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.strictEqual((await fetch(`${base}/`)).status, 200);
    assert.strictEqual((await fetch(`${base}/health`)).status, 503);
    current = info();
    const h = await fetch(`${base}/health`);
    assert.strictEqual(h.status, 200);
    assert.strictEqual((await h.json()).status, 'ok');
    assert.strictEqual((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
    assert.strictEqual((await fetch(`${base}/nope`)).status, 404);
  } finally {
    server.close();
  }
});
