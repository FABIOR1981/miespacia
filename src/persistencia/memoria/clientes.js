'use strict';
/**
 * Clientes/pacientes en memoria. Cada operación recibe el profesionalId y solo ve sus propios datos.
 * Detalle interno de interface_persistencia.js: la lógica no lo importa.
 */

function crearClientesEnMemoria() {
  let registros = [];
  let secuencia = 1;

  const copia = (x) => structuredClone(x);
  const delDueño = (profesionalId) => registros.filter((r) => r.profesionalId === profesionalId);

  return {
    listar: async (profesionalId) => delDueño(profesionalId).map(copia),

    obtener: async (profesionalId, id) => {
      const r = delDueño(profesionalId).find((x) => x.id === id);
      return r ? copia(r) : null;
    },

    crear: async (profesionalId, datos) => {
      const nuevo = { ...copia(datos), id: secuencia++, profesionalId };
      registros.push(nuevo);
      return copia(nuevo);
    },

    actualizar: async (profesionalId, id, cambios) => {
      const r = registros.find((x) => x.id === id && x.profesionalId === profesionalId);
      if (!r) return null;
      Object.assign(r, copia(cambios), { id, profesionalId });
      return copia(r);
    },

    eliminar: async (profesionalId, id) => {
      const antes = registros.length;
      registros = registros.filter((x) => !(x.id === id && x.profesionalId === profesionalId));
      return registros.length < antes;
    },
  };
}

module.exports = { crearClientesEnMemoria };
