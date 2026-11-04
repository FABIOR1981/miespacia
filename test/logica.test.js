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

test('el horario por defecto es de 08:00 a 21:00 y se puede cambiar por profesional', async () => {
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'h@t.test', nombre: 'H', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  const c = await a.crearCliente(cuenta.id, { nombre: 'C' });

  assert.deepEqual((await a.obtenerConfiguracion(cuenta.id)).horario, { desde: '08:00', hasta: '21:00' });
  await assert.rejects(a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-04', hora: '07:30' }), /entre 08:00 y 21:00/);
  await assert.rejects(a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-04', hora: '21:00' }), /entre 08:00 y 21:00/);
  await assert.rejects(a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-04', hora: '20:30' }), /terminar antes de las 21:00/);
  await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-04', hora: '20:00' });

  const cfg = await a.cambiarHorario(cuenta.id, '09:00', '18:00');
  assert.deepEqual(cfg.horario, { desde: '09:00', hasta: '18:00' });
  await assert.rejects(a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-05', hora: '08:30' }), /entre 09:00 y 18:00/);
  await assert.rejects(a.cambiarHorario(cuenta.id, '18:00', '09:00'), /empezar antes/);
  await assert.rejects(a.cambiarHorario(cuenta.id, '09:15', '18:00'), /punto o y media/);
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

test('los comentarios se agregan y quitan de una reserva, con un máximo de 500 caracteres', async () => {
  const agenda = nueva();
  const c = await agenda.crearCliente('pro-com', { nombre: 'Ana' });
  const turno = await agenda.agendarTurno('pro-com', { clienteId: c.id, fecha: '2026-11-05', hora: '10:00' });

  const lista = await agenda.agregarComentario('pro-com', turno.id, { texto: '  No cambiar  ', autor: 'Fabio' });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].texto, 'No cambiar');
  assert.equal(lista[0].por, 'Fabio');

  await assert.rejects(agenda.agregarComentario('pro-com', turno.id, { texto: 'x'.repeat(501), autor: 'Fabio' }), /500/);
  await assert.rejects(agenda.agregarComentario('pro-com', turno.id, { texto: '   ', autor: 'Fabio' }), /obligatorio/);
  await assert.rejects(agenda.agregarComentario('pro-otro', turno.id, { texto: 'hola', autor: 'X' }), (e) => e.estado === 404);

  const quitado = await agenda.quitarComentario('pro-com', turno.id, lista[0].id);
  assert.equal(quitado.length, 0);
  const [t] = await agenda.listarTurnos('pro-com', '2026-11-05', '2026-11-05');
  assert.equal(t.comentarios.length, 0);
});

test('cada profesional elige cómo llama a sus clientes: cliente o paciente', async () => {
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'e@t.test', nombre: 'E', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  assert.equal((await a.obtenerConfiguracion(cuenta.id)).etiquetaClientes, 'cliente');
  const cfg = await a.cambiarEtiquetaClientes(cuenta.id, 'paciente');
  assert.equal(cfg.etiquetaClientes, 'paciente');
  await assert.rejects(a.cambiarEtiquetaClientes(cuenta.id, 'usuario'), /cliente o paciente/);
});
