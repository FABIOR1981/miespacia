'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let worker;
before(async () => { worker = (await import('../src/worker.mjs')).default; });

const ENV = {
  ADMIN_EMAIL: 'admin@w.test', ADMIN_CLAVE_INICIAL: 'ClaveInicial-1', SESION_SECRETO: 'secreto-de-prueba-largo',
  ASSETS: { fetch: async () => new Response('pagina') },
};

async function cookieAdmin() {
  const ingreso = await worker.fetch(new Request('http://x/api/ingresar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ENV.ADMIN_EMAIL, clave: ENV.ADMIN_CLAVE_INICIAL }),
  }), ENV);
  const cookie = ingreso.headers.get('set-cookie').split(';')[0];
  await worker.fetch(new Request('http://x/api/clave', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ actual: ENV.ADMIN_CLAVE_INICIAL, nueva: 'NuevaClave-2' }),
  }), ENV);
  return cookie;
}

test('el Worker sirve la página para rutas que no son API', async () => {
  const r = await worker.fetch(new Request('http://x/'), ENV);
  assert.equal(await r.text(), 'pagina');
});

test('flujo de API en el Worker, con sesión, validaciones y conflictos', async () => {
  const cookie = await cookieAdmin();
  const pedir = (ruta, metodo = 'GET', cuerpo) =>
    worker.fetch(new Request('http://x' + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    }), ENV);

  assert.equal((await worker.fetch(new Request('http://x/api/clientes'), ENV)).status, 401);

  let r = await pedir('/api/clientes', 'POST', { nombre: 'Ana' });
  assert.equal(r.status, 201);
  const cliente = await r.json();

  r = await pedir('/api/clientes', 'POST', { nombre: '' });
  assert.equal(r.status, 400);

  r = await pedir('/api/turnos', 'POST', { clienteId: cliente.id, fecha: '2026-11-04', hora: '10:00' });
  assert.equal(r.status, 201);
  const turno = await r.json();

  r = await pedir('/api/turnos', 'POST', { clienteId: cliente.id, fecha: '2026-11-04', hora: '10:00' });
  assert.equal(r.status, 409);

  r = await pedir('/api/turnos/' + turno.id + '/cancelar', 'POST');
  assert.equal((await r.json()).cancelado, true);

  r = await pedir('/api/turnos?desde=2026-13-01');
  assert.equal(r.status, 400);

  r = await pedir('/api/otra');
  assert.equal(r.status, 404);
});
