'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearPersistencia } = require('../src/persistencia/interface_persistencia');
const { crearAgenda, ErrorDeNegocio } = require('../src/logica/agenda');

const nueva = () => crearAgenda(crearPersistencia({ modo: 'memoria' }));

test('la interfaz rechaza modos no soportados', () => {
  assert.throws(() => crearPersistencia({ modo: 'supabase' }), /no soportado/);
});

test('un profesional no ve clientes ni turnos de otro', async () => {
  const agenda = nueva();
  const ana = await agenda.crearCliente('pro-1', { nombre: 'Ana' });
  await agenda.crearCliente('pro-2', { nombre: 'Luis' });
  assert.deepEqual((await agenda.listarClientes('pro-1')).map((c) => c.nombre), ['Ana']);

  await agenda.agendarTurno('pro-1', { clienteId: ana.id, fecha: '2026-11-04', hora: '10:00' });
  assert.equal((await agenda.listarTurnos('pro-1', '2026-11-01', '2026-11-30')).length, 1);
  assert.equal((await agenda.listarTurnos('pro-2', '2026-11-01', '2026-11-30')).length, 0);
});

test('no se puede agendar en un horario ocupado, pero sí tras cancelar', async () => {
  const agenda = nueva();
  const c = await agenda.crearCliente('pro-1', { nombre: 'Ana' });
  const turno = await agenda.agendarTurno('pro-1', { clienteId: c.id, fecha: '2026-11-04', hora: '10:00' });

  await assert.rejects(
    agenda.agendarTurno('pro-1', { clienteId: c.id, fecha: '2026-11-04', hora: '10:00' }),
    (e) => e instanceof ErrorDeNegocio && e.estado === 409,
  );

  await agenda.cancelarTurno('pro-1', turno.id);
  await agenda.agendarTurno('pro-1', { clienteId: c.id, fecha: '2026-11-04', hora: '10:00' });
});

test('valida datos de entrada', async () => {
  const agenda = nueva();
  await assert.rejects(agenda.crearCliente('pro-1', { nombre: '  ' }), /obligatorio/);
  const c = await agenda.crearCliente('pro-1', { nombre: 'Ana' });
  await assert.rejects(agenda.agendarTurno('pro-1', { clienteId: c.id, fecha: '04/11/2026', hora: '10:00' }), /AAAA-MM-DD/);
  await assert.rejects(agenda.agendarTurno('pro-1', { clienteId: c.id, fecha: '2026-11-04', hora: '25:00' }), /HH:MM/);
  await assert.rejects(agenda.agendarTurno('pro-1', { clienteId: 999, fecha: '2026-11-04', hora: '10:00' }), (e) => e.estado === 404);
});
