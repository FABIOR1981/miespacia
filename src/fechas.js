'use strict';
/** Fechas en hora de Montevideo, para que de noche "hoy" no salte al día siguiente. Sirve en Node y en Workers. */
const ZONA = 'America/Montevideo';
const formato = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha 'AAAA-MM-DD' de hoy en Montevideo, desplazada n días. */
function fechaLocal(desplazamientoDias = 0) {
  return formato.format(new Date(Date.now() + desplazamientoDias * 86400000));
}

/** Fecha 'AAAA-MM-DD' en Montevideo de un instante ISO. */
function fechaDeInstante(iso) {
  return formato.format(new Date(iso));
}

module.exports = { fechaLocal, fechaDeInstante };
