'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAIL = 'admin@s.test';
process.env.ADMIN_CLAVE_INICIAL = 'ClaveInicial-1';
process.env.SESION_SECRETO = 'secreto-de-prueba-largo';
const { crearServidor } = require('../src/servidor');

test('el servidor local exige sesión, permite entrar y sirve la página', async () => {
  const s = crearServidor();
  await new Promise((resolver) => s.listen(0, resolver));
  const base = `http://localhost:${s.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/clientes')).status, 401);
    const ingreso = await fetch(base + '/api/ingresar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, clave: process.env.ADMIN_CLAVE_INICIAL }),
    });
    assert.equal(ingreso.status, 200);
    const cookie = ingreso.headers.get('set-cookie').split(';')[0];
    const yo = await fetch(base + '/api/yo', { headers: { Cookie: cookie } });
    assert.equal((await yo.json()).requiereCambioClave, true);
    assert.equal((await fetch(base + '/')).status, 200);
  } finally {
    s.close();
  }
});
