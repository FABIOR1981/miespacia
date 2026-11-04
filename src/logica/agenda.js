'use strict';
/**
 * Lógica de la agenda de miEspacia. Solo conoce la interfaz de persistencia (profesionales, clientes y turnos);
 * no sabe si los datos están en memoria, en una base o en otro lado.
 *
 * Reglas: los turnos empiezan en punto o y media, duran lo que tenga configurado el profesional
 * (60 minutos por defecto, entre 30 y 240 de a 30) y no se pueden superponer.
 */

class ErrorDeNegocio extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

const DURACION_POR_DEFECTO = 60;
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

function aMinutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

/**
 * @param {{ profesionales: object, clientes: object, turnos: object }} persistencia la interfaz de persistencia
 */
function crearAgenda(persistencia) {
  const { profesionales, clientes, turnos } = persistencia;

  async function duracionDe(profesionalId) {
    const cuenta = await profesionales.obtener(profesionalId);
    return cuenta?.duracionTurno ?? DURACION_POR_DEFECTO;
  }

  return {
    async listarClientes(profesionalId) {
      return clientes.listar(profesionalId);
    },

    async crearCliente(profesionalId, datos = {}) {
      return clientes.crear(profesionalId, {
        nombre: textoObligatorio(datos.nombre, 'El nombre'),
        telefono: String(datos.telefono ?? '').trim(),
        notas: String(datos.notas ?? '').trim(),
      });
    },

    async listarTurnos(profesionalId, desde, hasta) {
      validarFecha(desde);
      validarFecha(hasta);
      if (desde > hasta) throw new ErrorDeNegocio('"desde" no puede ser posterior a "hasta"');
      return turnos.listarRango(profesionalId, desde, hasta);
    },

    async obtenerConfiguracion(profesionalId) {
      return { duracionTurno: await duracionDe(profesionalId) };
    },

    async cambiarDuracion(profesionalId, duracion) {
      const cuenta = await profesionales.actualizar(profesionalId, { duracionTurno: validarDuracion(duracion) });
      if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
      return { duracionTurno: cuenta.duracionTurno };
    },

    async agendarTurno(profesionalId, datos = {}) {
      const fecha = validarFecha(datos.fecha);
      const hora = validarHora(datos.hora);

      const cliente = await clientes.obtener(profesionalId, Number(datos.clienteId));
      if (!cliente) throw new ErrorDeNegocio('El cliente no existe', 404);

      const duracion = await duracionDe(profesionalId);
      const inicio = aMinutos(hora);
      const fin = inicio + duracion;

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

    async cancelarTurno(profesionalId, id) {
      const cancelado = await turnos.cancelar(profesionalId, Number(id));
      if (!cancelado) throw new ErrorDeNegocio('El turno no existe', 404);
      return cancelado;
    },
  };
}

module.exports = { crearAgenda, ErrorDeNegocio };
