/**
 * Entrada de miEspacia en Cloudflare Workers. Las rutas /api/* las atiende este código;
 * todo lo demás (la página) lo sirve el binding ASSETS desde public/.
 *
 * Aviso: la persistencia en memoria vive dentro de cada instancia del Worker. Cloudflare puede
 * tener varias instancias y reiniciarlas, así que los datos no son confiables hasta conectar una base.
 */

import { crearPersistencia } from './persistencia/interface_persistencia.js';
import { crearAgenda, ErrorDeNegocio } from './logica/agenda.js';
import { fechaLocal } from './fechas.js';

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

async function rutaApi(request, env, url) {
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
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await rutaApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof ErrorDeNegocio) return json(error.estado, { error: error.message });
      console.error(error);
      return json(500, { error: 'Error interno' });
    }
  },
};
