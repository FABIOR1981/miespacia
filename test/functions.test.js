const { test } = require('node:test');
const assert = require('node:assert/strict');

test('la función de Pages responde la API', async () => {
  const { onRequest } = await import('../functions/api/[[ruta]].js');
  const env = { MIESPACIA_PROFESIONAL: 'pro-pages' };
  const r = await onRequest({ request: new Request('http://x/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Ana' }) }), env });
  assert.equal(r.status, 201);
  const listado = await onRequest({ request: new Request('http://x/api/clientes'), env });
  assert.equal((await listado.json()).length, 1);
});
