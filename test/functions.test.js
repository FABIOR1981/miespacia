'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('la función de Pages responde la API con la sesión del administrador', async () => {
  const { onRequest } = await import('../functions/api/[[ruta]].js');
  const env = { ADMIN_EMAIL: 'admin@miespacia.test' };
  const headers = { 'Content-Type': 'application/json', 'Cf-Access-Authenticated-User-Email': 'admin@miespacia.test' };
  const r = await onRequest({ request: new Request('http://x/api/clientes', { method: 'POST', headers, body: JSON.stringify({ nombre: 'Ana' }) }), env });
  assert.equal(r.status, 201);
  const listado = await onRequest({ request: new Request('http://x/api/clientes', { headers }), env });
  assert.equal((await listado.json()).length, 1);
});
