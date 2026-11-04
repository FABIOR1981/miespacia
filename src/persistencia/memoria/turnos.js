'use strict';
/**
 * Agenda de turnos en memoria. Cada operación recibe el profesionalId y solo ve sus propios turnos.
 * Las fechas se guardan como texto 'AAAA-MM-DD' para que comparen bien por rango.
 * Detalle interno de interface_persistencia.js: la lógica no lo importa.
 */

function crearTurnosEnMemoria() {
  let registros = [];
  let secuencia = 1;

  const copia = (x) => structuredClone(x);
  const delDueño = (profesionalId) => registros.filter((r) => r.profesionalId === profesionalId);

  return {
    listarRango: async (profesionalId, desde, hasta) =>
      delDueño(profesionalId)
        .filter((t) => t.fecha >= desde && t.fecha <= hasta)
        .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
        .map(copia),

    obtener: async (profesionalId, id) => {
      const t = delDueño(profesionalId).find((x) => x.id === id);
      return t ? copia(t) : null;
    },

    crear: async (profesionalId, datos) => {
      const nuevo = { ...copia(datos), id: secuencia++, profesionalId, cancelado: false };
      registros.push(nuevo);
      return copia(nuevo);
    },

    cancelar: async (profesionalId, id) => {
      const t = registros.find((x) => x.id === id && x.profesionalId === profesionalId);
      if (!t) return null;
      t.cancelado = true;
      return copia(t);
    },

    eliminar: async (profesionalId, id) => {
      const antes = registros.length;
      registros = registros.filter((x) => !(x.id === id && x.profesionalId === profesionalId));
      return registros.length < antes;
    },
  };
}

module.exports = { crearTurnosEnMemoria };
