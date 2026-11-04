'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let worker;
before(async () => { worker = (await import('../src/worker.mjs')).default; });

const ADMIN = 'admin@miespacia.test';
const env = { ADMIN_EMAIL: ADMIN, ASSETS: { fetch: async () => new Response('pagina') } };
const pedir = (ruta, metodo = 'GET', cuerpo) =>
  worker.fetch(new Request('http://x' + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Authenticated-User-Email': ADMIN },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }), env);

test('el Worker sirve la página para rutas que no son API', async () => {
  const r = await worker.fetch(new Request('http://x/'), env);
  assert.equal(await r.text(), 'pagina');
});

test('flujo de API en el Worker, con validaciones y conflictos', async () => {
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
