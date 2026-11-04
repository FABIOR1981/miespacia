import { crearPersistencia } from './persistencia/interface_persistencia.js';
import { crearAgenda, ErrorDeNegocio } from './logica/agenda.js';
import { fechaLocal } from './fechas.js';

/**
 * Rutas /api/* de miEspacia. Lo usan Cloudflare Workers (src/worker.mjs) y Cloudflare Pages
 * (functions/api/[[ruta]].js), así que no depende de cómo se publique.
 *
 * Aviso: la persistencia en memoria vive dentro de cada instancia. Los datos no son confiables
 * hasta conectar una base.
 */

const LIMITE_BODY = 100 * 1024;
let agenda = null;

function obtenerAgenda() {
  if (!agenda) agenda = crearAgenda(crearPersistencia({ modo: 'memoria' }));
  return agenda;
}

function json(estado, cuerpo) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function leerBody(request) {
  const texto = await request.text();
  if (texto.length > LIMITE_BODY) throw new ErrorDeNegocio('El cuerpo es demasiado grande', 413);
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorDeNegocio('El cuerpo debe ser JSON válido');
  }
}

export async function manejarApi(request, env = {}) {
  try {
    const url = new URL(request.url);
    const profesionalId = env.MIESPACIA_PROFESIONAL || 'profesional';
    const a = obtenerAgenda();
    const metodo = request.method;
    const partes = url.pathname.split('/').filter(Boolean); // ['api', recurso, ...]

    if (partes[1] === 'clientes' && partes.length === 2) {
      if (metodo === 'GET') return json(200, await a.listarClientes(profesionalId));
      if (metodo === 'POST') return json(201, await a.crearCliente(profesionalId, await leerBody(request)));
    }
    if (partes[1] === 'turnos' && partes.length === 2) {
      if (metodo === 'GET') {
        const desde = url.searchParams.get('desde') || fechaLocal();
        const hasta = url.searchParams.get('hasta') || desde;
        return json(200, await a.listarTurnos(profesionalId, desde, hasta));
      }
      if (metodo === 'POST') return json(201, await a.agendarTurno(profesionalId, await leerBody(request)));
    }
    if (partes[1] === 'turnos' && partes.length === 4 && partes[3] === 'cancelar' && metodo === 'POST') {
      return json(200, await a.cancelarTurno(profesionalId, partes[2]));
    }
    return json(404, { error: 'Ruta no encontrada' });
  } catch (error) {
    if (error instanceof ErrorDeNegocio) return json(error.estado, { error: error.message });
    console.error(error);
    return json(500, { error: 'Error interno' });
  }
}
