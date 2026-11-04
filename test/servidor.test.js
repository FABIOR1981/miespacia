'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServidor, fechaLocal } = require('../src/servidor');

function arrancar() {
  const server = crearServidor({ profesionalId: 'pro-test' });
  return new Promise((resolver) => server.listen(0, () => resolver(server)));
}
const base = (s) => `http://localhost:${s.address().port}`;
const pedir = (s, ruta, metodo = 'GET', cuerpo) =>
  fetch(base(s) + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });

test('fechaLocal devuelve AAAA-MM-DD', () => {
  assert.match(fechaLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test('flujo completo por HTTP y códigos de error', async () => {
  const s = await arrancar();
  try {
    let r = await pedir(s, '/api/clientes', 'POST', { nombre: 'Ana' });
    assert.equal(r.status, 201);
    const cliente = await r.json();

    r = await pedir(s, '/api/clientes', 'POST', { nombre: '' });
    assert.equal(r.status, 400);

    r = await pedir(s, '/api/turnos', 'POST', { clienteId: cliente.id, fecha: '2026-11-04', hora: '10:00' });
    assert.equal(r.status, 201);
    const turno = await r.json();

    r = await pedir(s, '/api/turnos', 'POST', { clienteId: cliente.id, fecha: '2026-11-04', hora: '10:00' });
    assert.equal(r.status, 409);

    r = await pedir(s, '/api/turnos?desde=2026-11-01&hasta=2026-11-30');
    assert.equal((await r.json()).length, 1);

    r = await pedir(s, `/api/turnos/${turno.id}/cancelar`, 'POST');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).cancelado, true);

    r = await pedir(s, '/api/turnos?desde=2026-13-01');
    assert.equal(r.status, 400);

    r = await pedir(s, '/api/ruta-inexistente');
    assert.equal(r.status, 404);
  } finally {
    s.close();
  }
});
