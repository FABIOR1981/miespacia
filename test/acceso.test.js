'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let manejarApi;
before(async () => { ({ manejarApi } = await import('../src/api.mjs')); });

const ADMIN = 'admin@miespacia.test';
const ENV = { ADMIN_EMAIL: ADMIN };

function pedir(ruta, email, metodo = 'GET', cuerpo) {
  const headers = { 'Content-Type': 'application/json' };
  if (email) headers['Cf-Access-Authenticated-User-Email'] = email;
  return manejarApi(new Request('http://x' + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined }), ENV);
}

test('sin sesión no se puede usar la API', async () => {
  const r = await pedir('/api/clientes');
  assert.equal(r.status, 401);
});

test('el administrador da de alta profesionales y cada uno ve solo lo suyo', async () => {
  let r = await pedir('/api/profesionales', ADMIN, 'POST', { email: 'ana@t.test', nombre: 'Ana' });
  assert.equal(r.status, 201);
  const ana = await r.json();
  await pedir('/api/profesionales', ADMIN, 'POST', { email: 'luis@t.test', nombre: 'Luis' });

  r = await pedir('/api/clientes', 'ana@t.test', 'POST', { nombre: 'Paciente de Ana' });
  assert.equal(r.status, 201);

  r = await pedir('/api/clientes', 'luis@t.test');
  assert.deepEqual(await r.json(), []);

  r = await pedir(`/api/clientes?profesional=${ana.id}`, 'luis@t.test');
  assert.equal(r.status, 403);

  r = await pedir(`/api/clientes?profesional=${ana.id}`, ADMIN);
  assert.equal((await r.json()).length, 1);
});

test('un profesional no puede gestionar profesionales', async () => {
  const r = await pedir('/api/profesionales', 'ana@t.test');
  assert.equal(r.status, 403);
});

test('no se duplican profesionales por email', async () => {
  const r = await pedir('/api/profesionales', ADMIN, 'POST', { email: 'ana@t.test', nombre: 'Otra' });
  assert.equal(r.status, 409);
});

test('desactivar un profesional le corta el acceso', async () => {
  const marta = await (await pedir('/api/profesionales', ADMIN, 'POST', { email: 'marta@t.test', nombre: 'Marta' })).json();
  assert.equal((await pedir('/api/yo', 'marta@t.test')).status, 200);
  assert.equal((await pedir(`/api/profesionales/${marta.id}/desactivar`, ADMIN, 'POST')).status, 200);
  assert.equal((await pedir('/api/yo', 'marta@t.test')).status, 403);
});

test('el administrador puede cancelar turnos de cualquier profesional', async () => {
  const ana = await (await pedir('/api/profesionales', ADMIN, 'POST', { email: 'rita@t.test', nombre: 'Rita' })).json();
  const cliente = await (await pedir('/api/clientes', 'rita@t.test', 'POST', { nombre: 'C' })).json();
  const turno = await (await pedir('/api/turnos', 'rita@t.test', 'POST', { clienteId: cliente.id, fecha: '2026-11-10', hora: '09:00' })).json();
  const r = await pedir(`/api/turnos/${turno.id}/cancelar?profesional=${ana.id}`, ADMIN, 'POST');
  assert.equal((await r.json()).cancelado, true);
});
