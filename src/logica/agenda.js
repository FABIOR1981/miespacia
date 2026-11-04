'use strict';
/**
 * Lógica de la agenda de miEspacia. Solo conoce la interfaz de persistencia (clientes y turnos);
 * no sabe si los datos están en memoria, en una base o en otro lado.
 */

class ErrorDeNegocio extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function textoObligatorio(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new ErrorDeNegocio(`${campo} es obligatorio`);
  return texto;
}

function validarFecha(fecha) {
  if (!FECHA.test(String(fecha ?? ''))) throw new ErrorDeNegocio('La fecha debe tener formato AAAA-MM-DD');
  return fecha;
}

function validarHora(hora) {
  if (!HORA.test(String(hora ?? ''))) throw new ErrorDeNegocio('La hora debe tener formato HH:MM');
  return hora;
}

/**
 * @param {{ clientes: object, turnos: object }} persistencia la interfaz de persistencia
 */
function crearAgenda(persistencia) {
  const { clientes, turnos } = persistencia;

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

    async agendarTurno(profesionalId, datos = {}) {
      const fecha = validarFecha(datos.fecha);
      const hora = validarHora(datos.hora);

      const cliente = await clientes.obtener(profesionalId, Number(datos.clienteId));
      if (!cliente) throw new ErrorDeNegocio('El cliente no existe', 404);

      const ocupados = await turnos.listarRango(profesionalId, fecha, fecha);
      if (ocupados.some((t) => !t.cancelado && t.hora === hora)) {
        throw new ErrorDeNegocio('Ya hay un turno en ese horario', 409);
      }

      return turnos.crear(profesionalId, { fecha, hora, clienteId: cliente.id, clienteNombre: cliente.nombre });
    },

    async cancelarTurno(profesionalId, id) {
      const cancelado = await turnos.cancelar(profesionalId, Number(id));
      if (!cancelado) throw new ErrorDeNegocio('El turno no existe', 404);
      return cancelado;
    },
  };
}

module.exports = { crearAgenda, ErrorDeNegocio };
