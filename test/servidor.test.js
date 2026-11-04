'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAIL = 'admin@miespacia.test';
const { crearServidor } = require('../src/servidor');

test('el servidor local exige sesión en la API y sirve la página', async () => {
  const s = crearServidor();
  await new Promise((resolver) => s.listen(0, resolver));
  const base = `http://localhost:${s.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/clientes')).status, 401);
    const yo = await fetch(base + '/api/yo', { headers: { 'Cf-Access-Authenticated-User-Email': 'admin@miespacia.test' } });
    assert.equal((await yo.json()).rol, 'admin');
    assert.equal((await fetch(base + '/')).status, 200);
  } finally {
    s.close();
  }
});
