'use strict';
/**
 * Interfaz de persistencia de miEspacia: el ÚNICO módulo que sabe dónde se guardan los datos.
 *
 * La lógica recibe solo las piezas que devuelve crearPersistencia() y no importa nada más
 * de persistencia. Hoy el único modo es 'memoria'. Cuando se conecte la base de datos,
 * se agrega un modo nuevo acá, sin tocar la lógica.
 *
 *   profesionales → cuentas (email, nombre, rol admin|profesional, activo)
 *   clientes      → clientes/pacientes de cada profesional
 *   turnos        → agenda de cada profesional
 */

const { crearClientesEnMemoria } = require('./memoria/clientes');
const { crearTurnosEnMemoria } = require('./memoria/turnos');
const { crearProfesionalesEnMemoria } = require('./memoria/profesionales');

const MODOS = {
  memoria: () => ({
    profesionales: crearProfesionalesEnMemoria(),
    clientes: crearClientesEnMemoria(),
    turnos: crearTurnosEnMemoria(),
  }),
};

/**
 * @param {object} opciones
 * @param {string} opciones.modo 'memoria' por ahora
 */
function crearPersistencia({ modo } = {}) {
  const fabricar = MODOS[modo];
  if (!fabricar) {
    throw new Error(`Modo de persistencia no soportado: "${modo}". Modos disponibles: ${Object.keys(MODOS).join(', ')}`);
  }
  return fabricar();
}

module.exports = { crearPersistencia };
