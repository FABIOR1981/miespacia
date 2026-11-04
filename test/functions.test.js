'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('la función de Pages atiende la API con sesión', async () => {
  const { onRequest } = await import('../functions/api/[[ruta]].js');
  const env = { ADMIN_EMAIL: 'admin@p.test', ADMIN_CLAVE_INICIAL: 'ClaveInicial-1', SESION_SECRETO: 'secreto-de-prueba-largo' };
  const ingreso = await onRequest({
    request: new Request('http://x/api/ingresar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.ADMIN_EMAIL, clave: env.ADMIN_CLAVE_INICIAL }) }),
    env,
  });
  assert.equal(ingreso.status, 200);
  const cookie = ingreso.headers.get('set-cookie').split(';')[0];
  const yo = await onRequest({ request: new Request('http://x/api/yo', { headers: { Cookie: cookie } }), env });
  assert.equal((await yo.json()).rol, 'admin');
  const sinSesion = await onRequest({ request: new Request('http://x/api/clientes'), env });
  assert.equal(sinSesion.status, 401);
});
