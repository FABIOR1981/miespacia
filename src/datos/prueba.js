'use strict';
/**
 * Datos de ejemplo para probar la app: un administrador y dos profesionales con clientes y turnos.
 * Solo se cargan si DATOS_DE_PRUEBA=1. La clave es de prueba: no usar en uso real.
 */

const { hashearClave } = require('../logica/seguridad');
const { fechaLocal } = require('../fechas');

const CLAVE_DE_PRUEBA = 'PruebaPro-2026';

const PROFESIONALES = [
  { email: 'ana@miespacia.test', nombre: 'Ana Pérez', clientes: ['Marcelo Rey', 'Lucía Batlle', 'Sofía Núñez', 'Diego Acosta', 'Valentina Silva'] },
  { email: 'luis@miespacia.test', nombre: 'Luis Gómez', clientes: ['Federico Ruiz', 'Carolina Vidal', 'Martín Olivera', 'Julia Pereira'] },
];

async function sembrarDatosDePrueba(persistencia, agenda) {
  const claveHash = await hashearClave(CLAVE_DE_PRUEBA);
  for (const datos of PROFESIONALES) {
    if (await persistencia.profesionales.porEmail(datos.email)) continue;
    const cuenta = await persistencia.profesionales.crear({
      email: datos.email, usuario: datos.email.split('@')[0], nombre: datos.nombre, rol: 'profesional', claveHash, requiereCambioClave: false,
    });
    const clientes = [];
    for (const [i, nombre] of datos.clientes.entries()) {
      clientes.push(await agenda.crearCliente(cuenta.id, { nombre, telefono: '099' + String(i + 1).padStart(6, '0') }));
    }
    await agenda.agendarTurno(cuenta.id, { clienteId: clientes[0].id, fecha: fechaLocal(1), hora: '09:00' });
    await agenda.agendarTurno(cuenta.id, { clienteId: clientes[1].id, fecha: fechaLocal(2), hora: '10:00' });
  }
}

module.exports = { sembrarDatosDePrueba, CLAVE_DE_PRUEBA, PROFESIONALES };
