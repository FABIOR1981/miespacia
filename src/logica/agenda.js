'use strict';
/**
 * Lógica de la agenda de miEspacia. Solo conoce la interfaz de persistencia (profesionales, clientes y turnos);
 * no sabe si los datos están en memoria, en una base o en otro lado.
 *
 * Reglas: los turnos empiezan en punto o y media, duran lo que tenga configurado el profesional
 * (60 minutos por defecto, entre 30 y 240 de a 30) y no se pueden superponer.
 */

const { fechaLocal, fechaDeInstante } = require('../fechas');

class ErrorDeNegocio extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

const DURACION_POR_DEFECTO = 60;
const HORARIO_POR_DEFECTO = { desde: '08:00', hasta: '21:00' };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function textoObligatorio(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new ErrorDeNegocio(`${campo} es obligatorio`);
  return texto;
}

function validarFecha(fecha) {
  const texto = String(fecha ?? '');
  const [a, m, d] = FECHA.test(texto) ? texto.split('-').map(Number) : [];
  const real = a !== undefined && new Date(Date.UTC(a, m - 1, d)).getUTCDate() === d && m >= 1 && m <= 12;
  if (!real) throw new ErrorDeNegocio('La fecha debe ser una fecha real con formato AAAA-MM-DD');
  return fecha;
}

function validarHora(hora) {
  if (!HORA.test(String(hora ?? ''))) throw new ErrorDeNegocio('La hora debe tener formato HH:MM');
  if (aMinutos(hora) % 30 !== 0) throw new ErrorDeNegocio('Los turnos empiezan en punto o y media (HH:00 o HH:30)');
  return hora;
}

function validarDuracion(duracion) {
  const n = Number(duracion);
  if (!Number.isInteger(n) || n < 30 || n > 240 || n % 30 !== 0) {
    throw new ErrorDeNegocio('La duración debe ser de 30 a 240 minutos, de a 30');
  }
  return n;
}

/**
 * Duración que rige para una fecha: la del cambio más reciente que empiece en esa fecha o antes.
 * Los turnos guardan su propia duración, así que un cambio no toca los que ya existen.
 */
function duracionVigente(cuenta, fecha) {
  const aplicables = (cuenta?.duraciones ?? []).filter((d) => d.desde <= fecha);
  if (!aplicables.length) return DURACION_POR_DEFECTO;
  return aplicables.sort((a, b) => a.desde.localeCompare(b.desde)).at(-1).minutos;
}

function horarioVigente(cuenta) {
  return cuenta?.horario ?? HORARIO_POR_DEFECTO;
}

function validarHorario(desde, hasta) {
  const d = validarHora(desde);
  const h = validarHora(hasta);
  if (aMinutos(d) >= aMinutos(h)) throw new ErrorDeNegocio('El horario tiene que empezar antes de terminar');
  return { desde: d, hasta: h };
}

function aMinutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

/**
 * @param {{ profesionales: object, clientes: object, turnos: object }} persistencia la interfaz de persistencia
 */
// Cómo llama cada profesional a sus clientes en la interfaz.
const ETIQUETAS_CLIENTES = ['cliente', 'paciente'];

function etiquetaDe(cuenta) {
  return ETIQUETAS_CLIENTES.includes(cuenta.etiquetaClientes) ? cuenta.etiquetaClientes : 'cliente';
}

function crearAgenda(persistencia) {
  const { profesionales, clientes, turnos } = persistencia;

  async function configuracionDe(profesionalId) {
    const cuenta = await profesionales.obtener(profesionalId);
    if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
    return {
      duracionTurno: duracionVigente(cuenta, fechaLocal()),
      historial: [...(cuenta.duraciones ?? [])].sort((a, b) => b.desde.localeCompare(a.desde)),
      horario: horarioVigente(cuenta),
      etiquetaClientes: etiquetaDe(cuenta),
    };
  }

  return {
    async listarClientes(profesionalId) {
      return clientes.listar(profesionalId);
    },

    async editarCliente(profesionalId, id, datos = {}) {
      const cambios = {
        nombre: textoObligatorio(datos.nombre, 'El nombre'),
        telefono: String(datos.telefono ?? '').trim(),
        notas: String(datos.notas ?? '').trim(),
      };
      if (typeof datos.activo === 'boolean') cambios.activo = datos.activo;
      const cliente = await clientes.actualizar(profesionalId, Number(id), cambios);
      if (!cliente) throw new ErrorDeNegocio('El cliente no existe', 404);
      return cliente;
    },

    async crearCliente(profesionalId, datos = {}) {
      return clientes.crear(profesionalId, {
        activo: true,
        nombre: textoObligatorio(datos.nombre, 'El nombre'),
        telefono: String(datos.telefono ?? '').trim(),
        notas: String(datos.notas ?? '').trim(),
      });
    },

    async listarTurnos(profesionalId, desde, hasta) {
      validarFecha(desde);
      validarFecha(hasta);
      if (desde > hasta) throw new ErrorDeNegocio('"desde" no puede ser posterior a "hasta"');
      const lista = await turnos.listarRango(profesionalId, desde, hasta);
      // El nombre que se muestra es el actual del cliente, aunque se haya editado después de reservar.
      const nombres = new Map((await clientes.listar(profesionalId)).map((c) => [c.id, c.nombre]));
      return lista.map((t) => ({ ...t, clienteNombre: nombres.get(t.clienteId) ?? t.clienteNombre }));
    },

    async obtenerConfiguracion(profesionalId) {
      return configuracionDe(profesionalId);
    },

    /** Desde `desde` (AAAA-MM-DD, por defecto hoy) los turnos nuevos duran `duracion` minutos. */
    async cambiarDuracion(profesionalId, duracion, desde = fechaLocal()) {
      const minutos = validarDuracion(duracion);
      validarFecha(desde);
      if (desde < fechaLocal()) throw new ErrorDeNegocio('La duración no puede regir desde una fecha pasada');
      const cuenta = await profesionales.obtener(profesionalId);
      if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
      const historial = (cuenta.duraciones ?? []).filter((d) => d.desde !== desde);
      historial.push({ desde, minutos });
      await profesionales.actualizar(profesionalId, { duraciones: historial });
      return configuracionDe(profesionalId);
    },

    /** Horario de la agenda: desde y hasta (HH:MM). Los turnos empiezan dentro de ese rango y terminan antes de `hasta`. */
    async cambiarHorario(profesionalId, desde, hasta) {
      const horario = validarHorario(desde, hasta);
      const cuenta = await profesionales.obtener(profesionalId);
      if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
      await profesionales.actualizar(profesionalId, { horario });
      return configuracionDe(profesionalId);
    },

    async cambiarEtiquetaClientes(profesionalId, valor) {
      if (!ETIQUETAS_CLIENTES.includes(valor)) throw new ErrorDeNegocio('Elegí cliente o paciente', 400);
      const cuenta = await profesionales.obtener(profesionalId);
      if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
      await profesionales.actualizar(profesionalId, { etiquetaClientes: valor });
      return configuracionDe(profesionalId);
    },

    async agendarTurno(profesionalId, datos = {}) {
      const fecha = validarFecha(datos.fecha);
      const hora = validarHora(datos.hora);

      const cliente = await clientes.obtener(profesionalId, Number(datos.clienteId));
      if (!cliente) throw new ErrorDeNegocio('El cliente no existe', 404);
      if (cliente.activo === false) throw new ErrorDeNegocio('Ese cliente está dado de baja. Reactivalo para reservarle', 409);

      const cuenta = await profesionales.obtener(profesionalId);
      const duracion = duracionVigente(cuenta, fecha);
      const { desde, hasta } = horarioVigente(cuenta);
      const inicio = aMinutos(hora);
      const fin = inicio + duracion;
      if (inicio < aMinutos(desde) || inicio >= aMinutos(hasta)) {
        throw new ErrorDeNegocio(`Los turnos empiezan entre ${desde} y ${hasta}`);
      }
      if (fin > aMinutos(hasta)) throw new ErrorDeNegocio(`El turno tiene que terminar antes de las ${hasta}`);

      const delDia = await turnos.listarRango(profesionalId, fecha, fecha);
      const choca = delDia.some((t) => {
        if (t.cancelado) return false;
        const ti = aMinutos(t.hora);
        return inicio < ti + t.duracion && ti < fin;
      });
      if (choca) throw new ErrorDeNegocio('Ese horario se superpone con otro turno', 409);

      return turnos.crear(profesionalId, {
        fecha, hora, duracion, clienteId: cliente.id, clienteNombre: cliente.nombre,
      });
    },

    /** Comentario interno de una reserva. `autor` es quien lo escribe. */
    async agregarComentario(profesionalId, id, { texto, autor }) {
      const turno = await turnos.obtener(profesionalId, Number(id));
      if (!turno) throw new ErrorDeNegocio('El turno no existe', 404);
      const limpio = textoObligatorio(texto, 'El comentario');
      if (limpio.length > 500) throw new ErrorDeNegocio('El comentario tiene como máximo 500 caracteres');
      const comentarios = [...(turno.comentarios ?? []), {
        id: Date.now() + Math.random(), texto: limpio, por: String(autor ?? '').trim() || 'Sin nombre', en: new Date().toISOString(),
      }];
      await turnos.actualizar(profesionalId, Number(id), { comentarios });
      return comentarios;
    },

    async quitarComentario(profesionalId, id, comentarioId) {
      const turno = await turnos.obtener(profesionalId, Number(id));
      if (!turno) throw new ErrorDeNegocio('El turno no existe', 404);
      const comentarios = (turno.comentarios ?? []).filter((c) => String(c.id) !== String(comentarioId));
      if (comentarios.length === (turno.comentarios ?? []).length) throw new ErrorDeNegocio('El comentario no existe', 404);
      await turnos.actualizar(profesionalId, Number(id), { comentarios });
      return comentarios;
    },

    async cancelarTurno(profesionalId, id, datos = {}) {
      const motivo = String(datos.motivo ?? '').trim();
      if (motivo.length > 300) throw new ErrorDeNegocio('El motivo tiene como máximo 300 caracteres');
      const cancelacion = { motivo, en: new Date().toISOString(), por: datos.autor || 'Sin nombre' };
      const cancelado = await turnos.cancelar(profesionalId, Number(id), { cancelacion });
      if (!cancelado) throw new ErrorDeNegocio('El turno no existe', 404);
      return cancelado;
    },

    /** Reservas canceladas cuya fecha de cancelación cae entre desde y hasta (en Montevideo). */
    async listarCancelaciones(profesionalId, desde, hasta) {
      validarFecha(desde);
      validarFecha(hasta);
      if (desde > hasta) throw new ErrorDeNegocio('"desde" no puede ser posterior a "hasta"');
      const todos = await turnos.listarRango(profesionalId, '0000-01-01', '9999-12-31');
      const nombres = new Map((await clientes.listar(profesionalId)).map((c) => [c.id, c.nombre]));
      return todos
        .filter((t) => t.cancelado && t.cancelacion)
        .filter((t) => fechaDeInstante(t.cancelacion.en) >= desde && fechaDeInstante(t.cancelacion.en) <= hasta)
        .sort((a, b) => b.cancelacion.en.localeCompare(a.cancelacion.en))
        .map((t) => ({
          id: t.id,
          fecha: t.fecha,
          hora: t.hora,
          clienteNombre: nombres.get(t.clienteId) ?? t.clienteNombre,
          motivo: t.cancelacion.motivo,
          en: t.cancelacion.en,
          por: t.cancelacion.por,
        }));
    },
  };
}

module.exports = { crearAgenda, ErrorDeNegocio, duracionVigente, horarioVigente };
