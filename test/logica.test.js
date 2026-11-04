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

test('los turnos duran 60 minutos y no se superponen', async () => {
  const agenda = nueva();
  const c = await agenda.crearCliente('pro-dur', { nombre: 'Ana' });
  await agenda.agendarTurno('pro-dur', { clienteId: c.id, fecha: '2026-11-05', hora: '10:00' });
  for (const hora of ['09:30', '10:30']) {
    await assert.rejects(agenda.agendarTurno('pro-dur', { clienteId: c.id, fecha: '2026-11-05', hora }), (e) => e.estado === 409, hora);
  }
  await agenda.agendarTurno('pro-dur', { clienteId: c.id, fecha: '2026-11-05', hora: '11:00' });
});

test('solo se agenda en punto o y media', async () => {
  const agenda = nueva();
  const c = await agenda.crearCliente('pro-min', { nombre: 'Ana' });
  await assert.rejects(agenda.agendarTurno('pro-min', { clienteId: c.id, fecha: '2026-11-05', hora: '10:15' }), /punto o y media/);
});

test('la duración rige desde la fecha del cambio; los turnos anteriores no cambian', async () => {
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'x@t.test', nombre: 'X', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  const c = await a.crearCliente(cuenta.id, { nombre: 'C' });

  // Antes del cambio: 60 minutos
  const antes = await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-04', hora: '10:00' });
  assert.equal(antes.duracion, 60);

  // Desde el 2026-11-10, 30 minutos
  const cfg = await a.cambiarDuracion(cuenta.id, 30, '2026-11-10');
  assert.equal(cfg.historial.length, 1);

  const despues = await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-10', hora: '10:00' });
  assert.equal(despues.duracion, 30);
  await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-10', hora: '10:30' });

  // El turno anterior conserva sus 60 minutos
  const dia4 = await a.listarTurnos(cuenta.id, '2026-11-04', '2026-11-04');
  assert.equal(dia4[0].duracion, 60);

  await assert.rejects(a.cambiarDuracion(cuenta.id, 45, '2026-11-10'), /30 a 240/);
  await assert.rejects(a.cambiarDuracion(cuenta.id, 30, '2001-01-01'), /fecha pasada/);
});
