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

test('cada profesional elige cómo llama a sus clientes: cliente, paciente o empresa', async () => {
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'e@t.test', nombre: 'E', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  assert.equal((await a.obtenerConfiguracion(cuenta.id)).etiquetaClientes, 'cliente');
  const cfg = await a.cambiarEtiquetaClientes(cuenta.id, 'paciente');
  assert.equal(cfg.etiquetaClientes, 'paciente');
  assert.equal((await a.cambiarEtiquetaClientes(cuenta.id, 'empresa')).etiquetaClientes, 'empresa');
  await assert.rejects(a.cambiarEtiquetaClientes(cuenta.id, 'usuario'), /cliente, paciente o empresa/);
});

test('al cancelar se puede dejar un motivo; el informe de cancelaciones lo muestra por fecha de cancelación', async () => {
  const { fechaLocal } = require('../src/fechas');
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'c@t.test', usuario: 'cancel', nombre: 'C', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  const c = await a.crearCliente(cuenta.id, { nombre: 'Ana' });
  const sinMotivo = await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-20', hora: '10:00' });
  const conMotivo = await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-21', hora: '11:00' });

  await a.cancelarTurno(cuenta.id, sinMotivo.id, { autor: 'C' });
  await a.cancelarTurno(cuenta.id, conMotivo.id, { motivo: '  Avisó que no puede  ', autor: 'C' });
  await assert.rejects(a.cancelarTurno(cuenta.id, sinMotivo.id, { motivo: 'x'.repeat(301) }), /300/);

  const hoy = fechaLocal();
  const lista = await a.listarCancelaciones(cuenta.id, hoy, hoy);
  assert.equal(lista.length, 2);
  const motivos = lista.map((x) => x.motivo).sort();
  assert.deepEqual(motivos, ['', 'Avisó que no puede']);
  assert.equal(lista[0].clienteNombre, 'Ana');
  assert.deepEqual(await a.listarCancelaciones(cuenta.id, '2020-01-01', '2020-01-02'), []);
});

test('un cliente dado de baja no se puede reservar, pero sigue en la lista; al reactivarlo se puede', async () => {
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'b@t.test', usuario: 'bajas', nombre: 'B', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  const c = await a.crearCliente(cuenta.id, { nombre: 'Marta' });
  await a.editarCliente(cuenta.id, c.id, { nombre: 'Marta', activo: false });
  await assert.rejects(a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-25', hora: '10:00' }), /dado de baja/);
  assert.equal((await a.listarClientes(cuenta.id)).find((x) => x.id === c.id).activo, false);
  await a.editarCliente(cuenta.id, c.id, { nombre: 'Marta', activo: true });
  await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-25', hora: '10:00' });
});

test('los objetos guardados tienen id entero incremental: comentarios y cambios de duración', async () => {
  const persistencia = crearPersistencia({ modo: 'memoria' });
  const cuenta = await persistencia.profesionales.crear({ email: 'i@t.test', usuario: 'ids', nombre: 'I', rol: 'profesional' });
  const a = crearAgenda(persistencia);
  const c = await a.crearCliente(cuenta.id, { nombre: 'Id' });
  const t = await a.agendarTurno(cuenta.id, { clienteId: c.id, fecha: '2026-11-26', hora: '10:00' });

  const uno = await a.agregarComentario(cuenta.id, t.id, { texto: 'uno', autor: 'X' });
  const dos = await a.agregarComentario(cuenta.id, t.id, { texto: 'dos', autor: 'X' });
  assert.deepEqual(dos.map((x) => x.id), [1, 2]);
  const quedan = await a.quitarComentario(cuenta.id, t.id, 1);
  const tres = await a.agregarComentario(cuenta.id, t.id, { texto: 'tres', autor: 'X' });
  assert.deepEqual(tres.map((x) => x.id), [2, 3]);
  assert.equal(uno.length, 1);
  assert.equal(quedan.length, 1);

  await a.cambiarDuracion(cuenta.id, 90, '2026-12-01');
  await a.cambiarDuracion(cuenta.id, 30, '2026-12-05');
  const historial = (await a.obtenerConfiguracion(cuenta.id)).historial;
  assert.deepEqual(historial.map((h) => h.id).sort(), [1, 2]);
});

test('reservas de un cliente en un período, con las canceladas y sin las de otros', async () => {
  const agenda = nueva();
  const ana = await agenda.crearCliente('pro-1', { nombre: 'Ana' });
  const luis = await agenda.crearCliente('pro-1', { nombre: 'Luis' });
  await agenda.agendarTurno('pro-1', { clienteId: ana.id, fecha: '2026-11-10', hora: '10:00' });
  const cancelada = await agenda.agendarTurno('pro-1', { clienteId: ana.id, fecha: '2026-11-03', hora: '09:00' });
  await agenda.cancelarTurno('pro-1', cancelada.id, { motivo: 'Viaje', autor: 'Luis' });
  await agenda.agendarTurno('pro-1', { clienteId: luis.id, fecha: '2026-11-05', hora: '11:00' });
  await agenda.agendarTurno('pro-1', { clienteId: ana.id, fecha: '2026-12-01', hora: '10:00' });

  const datos = await agenda.listarReservasDeCliente('pro-1', ana.id, '2026-11-01', '2026-11-30');
  assert.equal(datos.clienteNombre, 'Ana');
  assert.deepEqual(datos.reservas.map((r) => [r.fecha, r.cancelado, r.motivo]), [
    ['2026-11-03', true, 'Viaje'],
    ['2026-11-10', false, ''],
  ]);
  await assert.rejects(agenda.listarReservasDeCliente('pro-1', 999, '2026-11-01', '2026-11-30'), /no existe/);
  await assert.rejects(agenda.listarReservasDeCliente('pro-2', ana.id, '2026-11-01', '2026-11-30'), /no existe/);
});

test('no se puede cargar dos veces al mismo cliente: por nombre (sin acentos ni mayúsculas) o por teléfono', async () => {
  const agenda = nueva();
  const ana = await agenda.crearCliente('pro-1', { nombre: 'Ana Pérez', telefono: '099 000 001' });
  await assert.rejects(agenda.crearCliente('pro-1', { nombre: '  ana   perez ' }), /ya tenés un cliente con ese nombre/i);
  await assert.rejects(agenda.crearCliente('pro-1', { nombre: 'Otra', telefono: '099-000-001' }), /teléfono ya está cargado/i);
  // los teléfonos cortos no se comparan (podrían ser de cualquiera)
  await agenda.crearCliente('pro-1', { nombre: 'Juan', telefono: '1234' });
  await agenda.crearCliente('pro-1', { nombre: 'Lucía', telefono: '1234' });
  // al editar, un cliente puede guardarse a sí mismo, pero no tomar el nombre de otro
  await agenda.editarCliente('pro-1', ana.id, { nombre: 'Ana Pérez', telefono: '099000001', notas: 'x' });
  const luis = await agenda.crearCliente('pro-1', { nombre: 'Luis', telefono: '099000002' });
  await assert.rejects(agenda.editarCliente('pro-1', luis.id, { nombre: 'ANA PEREZ' }), /ya tenés un cliente/i);
  // otro profesional sí puede tener a una persona con el mismo nombre
  await agenda.crearCliente('pro-2', { nombre: 'Ana Pérez', telefono: '099 000 001' });
});
