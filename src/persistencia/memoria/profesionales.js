'use strict';
/** Cuentas de profesionales en memoria. Detalle interno de interface_persistencia.js. */

function crearProfesionalesEnMemoria() {
  let registros = [];
  let secuencia = 1;
  const copia = (x) => structuredClone(x);

  return {
    listar: async () => registros.map(copia),

    obtener: async (id) => {
      const r = registros.find((x) => x.id === id);
      return r ? copia(r) : null;
    },

    porEmail: async (email) => {
      const r = registros.find((x) => x.email === String(email).toLowerCase());
      return r ? copia(r) : null;
    },

    crear: async ({ email, nombre, rol }) => {
      const nuevo = { id: secuencia++, email: String(email).toLowerCase(), nombre, rol, activo: true };
      registros.push(nuevo);
      return copia(nuevo);
    },

    desactivar: async (id) => {
      const r = registros.find((x) => x.id === id);
      if (!r) return null;
      r.activo = false;
      return copia(r);
    },
  };
}

module.exports = { crearProfesionalesEnMemoria };
