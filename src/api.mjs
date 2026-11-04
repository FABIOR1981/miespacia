import { crearPersistencia } from './persistencia/interface_persistencia.js';
import { crearAgenda, ErrorDeNegocio } from './logica/agenda.js';
import { identificar, exigirAdmin, agendaObjetivo } from './logica/acceso.js';
import { fechaLocal } from './fechas.js';

/**
 * Rutas /api/* de miEspacia. Las usan Cloudflare Workers (src/worker.mjs), Cloudflare Pages
 * (functions/api/[[ruta]].js) y el servidor local (src/servidor.js).
 *
 * Cada pedido se identifica con la cabecera de Cloudflare Access. Los profesionales solo ven su agenda;
 * el administrador ve y administra todo.
 *
 * Aviso: la persistencia en memoria vive dentro de cada instancia. Los datos no son confiables
 * hasta conectar una base.
 */

const LIMITE_BODY = 100 * 1024;
const CABECERA_EMAIL = 'Cf-Access-Authenticated-User-Email';
let contexto = null;

function iniciar() {
  if (!contexto) {
    const persistencia = crearPersistencia({ modo: 'memoria' });
    contexto = { persistencia, agenda: crearAgenda(persistencia), adminSembrado: false };
  }
  return contexto;
}

async function sembrarAdmin(ctx, env) {
  if (ctx.adminSembrado) return;
  ctx.adminSembrado = true;
  if (!env.ADMIN_EMAIL) return;
  const existe = await ctx.persistencia.profesionales.porEmail(env.ADMIN_EMAIL);
  if (!existe) {
    await ctx.persistencia.profesionales.crear({ email: env.ADMIN_EMAIL, nombre: 'Administrador', rol: 'admin' });
  }
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

async function crearProfesional(ctx, datos) {
  const email = String(datos.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorDeNegocio('El email no es válido');
  const nombre = String(datos.nombre ?? '').trim();
  if (!nombre) throw new ErrorDeNegocio('El nombre es obligatorio');
  if (await ctx.persistencia.profesionales.porEmail(email)) {
    throw new ErrorDeNegocio('Ya existe un profesional con ese email', 409);
  }
  return ctx.persistencia.profesionales.crear({ email, nombre, rol: 'profesional' });
}

async function rutaProfesionales(ctx, request, partes) {
  const metodo = request.method;
  if (partes.length === 2 && metodo === 'GET') return json(200, await ctx.persistencia.profesionales.listar());
  if (partes.length === 2 && metodo === 'POST') {
    return json(201, await crearProfesional(ctx, await leerBody(request)));
  }
  if (partes.length === 4 && partes[3] === 'desactivar' && metodo === 'POST') {
    const cuenta = await ctx.persistencia.profesionales.desactivar(Number(partes[2]));
    if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
    return json(200, cuenta);
  }
  return json(404, { error: 'Ruta no encontrada' });
}

async function rutaAgenda(ctx, request, url, partes, profesionalId) {
  const metodo = request.method;
  const recurso = partes[1];

  if (recurso === 'clientes' && partes.length === 2) {
    if (metodo === 'GET') return json(200, await ctx.agenda.listarClientes(profesionalId));
    if (metodo === 'POST') return json(201, await ctx.agenda.crearCliente(profesionalId, await leerBody(request)));
  }
  if (recurso === 'turnos' && partes.length === 2) {
    if (metodo === 'GET') {
      const desde = url.searchParams.get('desde') || fechaLocal();
      const hasta = url.searchParams.get('hasta') || desde;
      return json(200, await ctx.agenda.listarTurnos(profesionalId, desde, hasta));
    }
    if (metodo === 'POST') return json(201, await ctx.agenda.agendarTurno(profesionalId, await leerBody(request)));
  }
  if (recurso === 'turnos' && partes.length === 4 && partes[3] === 'cancelar' && metodo === 'POST') {
    return json(200, await ctx.agenda.cancelarTurno(profesionalId, partes[2]));
  }
  return json(404, { error: 'Ruta no encontrada' });
}

export async function manejarApi(request, env = {}) {
  try {
    const ctx = iniciar();
    await sembrarAdmin(ctx, env);

    const url = new URL(request.url);
    const partes = url.pathname.split('/').filter(Boolean); // ['api', recurso, ...]
    const actor = await identificar(request.headers.get(CABECERA_EMAIL), ctx.persistencia.profesionales);

    if (partes[1] === 'yo' && partes.length === 2 && request.method === 'GET') {
      return json(200, { id: actor.id, nombre: actor.nombre, email: actor.email, rol: actor.rol });
    }

    if (partes[1] === 'profesionales') {
      exigirAdmin(actor);
      return await rutaProfesionales(ctx, request, partes);
    }

    const pedido = url.searchParams.get('profesional');
    const profesionalId = agendaObjetivo(actor, pedido === null ? null : Number(pedido));
    return await rutaAgenda(ctx, request, url, partes, profesionalId);
  } catch (error) {
    if (error.estado) return json(error.estado, { error: error.message });
    console.error(error);
    return json(500, { error: 'Error interno' });
  }
}
