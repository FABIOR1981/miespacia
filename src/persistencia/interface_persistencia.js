'use strict';
/**
 * Interfaz de persistencia de miEspacia: el ÚNICO módulo que sabe dónde se guardan los datos.
 *
 * La lógica recibe solo las piezas que devuelve crearPersistencia() y no importa nada más
 * de persistencia. Hoy el único modo es 'memoria' (pruebas). Cuando se conecte la base de
 * datos, se agrega un modo nuevo acá, sin tocar la lógica.
 *
 *   clientes → clientes/pacientes del profesional (listar, obtener, crear, actualizar, eliminar)
 *   turnos   → agenda del profesional (listarRango, obtener, crear, cancelar, eliminar)
 */

const { crearClientesEnMemoria } = require('./memoria/clientes');
const { crearTurnosEnMemoria } = require('./memoria/turnos');

const MODOS = {
  memoria: () => ({
    clientes: crearClientesEnMemoria(),
    turnos: crearTurnosEnMemoria(),
  }),
};

/**
 * @param {object} opciones
 * @param {string} opciones.modo 'memoria' por ahora
 * @returns {{ clientes: object, turnos: object }}
 */
function crearPersistencia({ modo } = {}) {
  const fabricar = MODOS[modo];
  if (!fabricar) {
    throw new Error(`Modo de persistencia no soportado: "${modo}". Modos disponibles: ${Object.keys(MODOS).join(', ')}`);
  }
  return fabricar();
}

module.exports = { crearPersistencia };
