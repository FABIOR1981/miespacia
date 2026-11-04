'use strict';
/** Cuentas de profesionales en memoria. Detalle interno de interface_persistencia.js. */

function crearProfesionalesEnMemoria() {
  let registros = [];
  let secuencia = 1;
  const copia = (x) => structuredClone(x);
  const buscar = (id) => registros.find((x) => x.id === id);

  return {
    listar: async () => registros.map(copia),

    obtener: async (id) => {
      const r = buscar(id);
      return r ? copia(r) : null;
    },

    porEmail: async (email) => {
      if (!email) return null;
      const r = registros.find((x) => x.email === String(email).toLowerCase());
      return r ? copia(r) : null;
    },

    porUsuario: async (usuario) => {
      const r = registros.find((x) => x.usuario === String(usuario).toLowerCase());
      return r ? copia(r) : null;
    },

    crear: async ({ email, usuario, nombre, rol, claveHash = null, requiereCambioClave = false, duracionTurno = 60 }) => {
      const nuevo = {
        id: secuencia++,
        email: email ? String(email).toLowerCase() : null,
        usuario: String(usuario).toLowerCase(),
        nombre,
        rol,
        claveHash,
        requiereCambioClave,
        duracionTurno,
        activo: true,
      };
      registros.push(nuevo);
      return copia(nuevo);
    },

    actualizar: async (id, cambios) => {
      const r = buscar(id);
      if (!r) return null;
      Object.assign(r, structuredClone(cambios));
      return copia(r);
    },

    desactivar: async (id) => {
      const r = buscar(id);
      if (!r) return null;
      r.activo = false;
      return copia(r);
    },
  };
}

module.exports = { crearProfesionalesEnMemoria };
