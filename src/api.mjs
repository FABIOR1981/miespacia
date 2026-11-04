import { crearPersistencia } from './persistencia/interface_persistencia.js';
import { crearAgenda, ErrorDeNegocio, duracionVigente, horarioVigente } from './logica/agenda.js';
import { identificar, ingresar, cookieDeSesion, cookieParaBorrar, exigirAdmin, agendaObjetivo, ErrorDeAcceso } from './logica/acceso.js';
import { hashearClave, verificarClave, claveTemporal } from './logica/seguridad.js';
import { sembrarDatosDePrueba } from './datos/prueba.js';
import { fechaLocal } from './fechas.js';

/**
 * Rutas /api/* de miEspacia. Las usan Cloudflare Workers (src/worker.mjs), Cloudflare Pages
 * (functions/api/[[ruta]].js) y el servidor local (src/servidor.js).
 *
 * Usuarios y roles dentro de la app: el administrador da de alta profesionales y les entrega una
 * clave temporal; cada profesional ve y administra solo su agenda. El administrador ve la de todos.
 *
 * Variables: SESION_SECRETO (obligatoria), ADMIN_EMAIL y ADMIN_CLAVE_INICIAL (primer administrador),
 * DATOS_DE_PRUEBA=1 (datos de ejemplo, solo para pruebas).
 *
 * Aviso: la persistencia en memoria vive dentro de cada instancia. Los datos no son confiables
 * hasta conectar una base.
 */

const LIMITE_BODY = 100 * 1024;
let contexto = null;

function iniciar() {
  if (!contexto) {
    const persistencia = crearPersistencia({ modo: 'memoria' });
    contexto = { persistencia, agenda: crearAgenda(persistencia), listo: false };
  }
  return contexto;
}

async function inicializar(ctx, env) {
  if (ctx.listo) return;
  ctx.listo = true;
  const profesionales = ctx.persistencia.profesionales;
  if (env.ADMIN_EMAIL && env.ADMIN_CLAVE_INICIAL && !(await profesionales.porEmail(env.ADMIN_EMAIL))) {
    await profesionales.crear({
      email: env.ADMIN_EMAIL,
      usuario: usuarioDesdeEmail(env.ADMIN_EMAIL),
      nombre: 'Administrador',
      rol: 'admin',
      claveHash: await hashearClave(env.ADMIN_CLAVE_INICIAL),
      requiereCambioClave: false,
    });
  }
  if (env.DATOS_DE_PRUEBA === '1') await sembrarDatosDePrueba(ctx.persistencia, ctx.agenda);
}

function json(estado, cuerpo, cabeceras = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabeceras },
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

/** Datos de una cuenta que sí se pueden mostrar (nunca la clave). */
function resumen(cuenta) {
  return {
    id: cuenta.id,
    nombre: cuenta.nombre,
    email: cuenta.email,
    usuario: cuenta.usuario,
    rol: cuenta.rol,
    requiereCambioClave: cuenta.requiereCambioClave === true,
    activo: cuenta.activo !== false,
    duracionTurno: duracionVigente(cuenta, fechaLocal()),
    horario: horarioVigente(cuenta),
    etiquetaClientes: cuenta.etiquetaClientes === 'paciente' ? 'paciente' : 'cliente',
  };
}

async function cambiarClave(ctx, actor, datos) {
  const actual = String(datos.actual ?? '');
  const nueva = String(datos.nueva ?? '');
  if (!(await verificarClave(actual, actor.claveHash))) throw new ErrorDeNegocio('La clave actual no es correcta', 401);
  if (nueva.length < 8 || nueva.length > 128) throw new ErrorDeNegocio('La clave nueva debe tener entre 8 y 128 caracteres');
  if (nueva === actual) throw new ErrorDeNegocio('La clave nueva tiene que ser distinta de la actual');
  await ctx.persistencia.profesionales.actualizar(actor.id, { claveHash: await hashearClave(nueva), requiereCambioClave: false });
}

/** Usuario a partir del email: la parte antes del @, en minúsculas y sin caracteres raros. */
function usuarioDesdeEmail(email) {
  const base = String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return base.length >= 3 ? base.slice(0, 30) : 'usuario';
}

/** Valida nombre, email y usuario; el email y el usuario no pueden repetirse (salvo en la misma cuenta). */
async function validarIdentidad(ctx, datos, idActual = null) {
  const nombre = String(datos.nombre ?? '').trim();
  if (!nombre) throw new ErrorDeNegocio('El nombre es obligatorio');
  const email = String(datos.email ?? '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorDeNegocio('El email no es válido');
  const usuario = String(datos.usuario ?? '').trim().toLowerCase();
  if (!usuario) throw new ErrorDeNegocio('El usuario es obligatorio');
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    throw new ErrorDeNegocio('El usuario tiene de 3 a 30 caracteres: letras, números, punto, guion o guion bajo');
  }
  const p = ctx.persistencia.profesionales;
  const otroEmail = email ? await p.porEmail(email) : null;
  if (otroEmail && otroEmail.id !== idActual) throw new ErrorDeNegocio('Ya existe un profesional con ese email', 409);
  const otroUsuario = await p.porUsuario(usuario);
  if (otroUsuario && otroUsuario.id !== idActual) throw new ErrorDeNegocio('Ya existe un profesional con ese usuario', 409);
  return { nombre, email: email || null, usuario };
}

async function altaProfesional(ctx, datos) {
  const identidad = await validarIdentidad(ctx, datos);
  const clave = claveTemporal();
  const cuenta = await ctx.persistencia.profesionales.crear({
    ...identidad, rol: 'profesional', claveHash: await hashearClave(clave), requiereCambioClave: true,
  });
  return { profesional: resumen(cuenta), claveTemporal: clave };
}

/** Edita nombre, usuario, email, duración y horario. Lo que cambia de horario o duración vale desde hoy. */
async function editarProfesional(ctx, id, datos) {
  const identidad = await validarIdentidad(ctx, datos, id);
  const actual = await ctx.persistencia.profesionales.obtener(id);
  if (!actual) throw new ErrorDeNegocio('El profesional no existe', 404);
  if (datos.horario) await ctx.agenda.cambiarHorario(id, datos.horario.desde, datos.horario.hasta);
  const duracion = Number(datos.duracionTurno);
  if (datos.duracionTurno !== undefined && duracion !== duracionVigente(actual, fechaLocal())) {
    await ctx.agenda.cambiarDuracion(id, duracion);
  }
  const cuenta = await ctx.persistencia.profesionales.actualizar(id, identidad);
  return resumen(cuenta);
}

async function rutaProfesionales(ctx, request, partes, actor) {
  const metodo = request.method;
  const p = ctx.persistencia.profesionales;

  if (partes.length === 2 && metodo === 'GET') return json(200, (await p.listar()).map(resumen));
  if (partes.length === 2 && metodo === 'POST') return json(201, await altaProfesional(ctx, await leerBody(request)));

  if (partes.length === 4 && metodo === 'POST') {
    const id = Number(partes[2]);
    if (partes[3] === 'reiniciar-clave') {
      const clave = claveTemporal();
      const cuenta = await p.actualizar(id, { claveHash: await hashearClave(clave), requiereCambioClave: true });
      if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
      return json(200, { claveTemporal: clave });
    }
    if (partes[3] === 'editar') return json(200, await editarProfesional(ctx, id, await leerBody(request)));
    if (partes[3] === 'desactivar') {
      if (id === actor.id) throw new ErrorDeNegocio('No podés desactivar tu propia cuenta');
      const cuenta = await p.desactivar(id);
      if (!cuenta) throw new ErrorDeNegocio('El profesional no existe', 404);
      return json(200, resumen(cuenta));
    }
  }
  return json(404, { error: 'Ruta no encontrada' });
}

async function rutaAgenda(ctx, request, url, partes, profesionalId, actor) {
  const metodo = request.method;
  const recurso = partes[1];

  if (recurso === 'clientes' && partes.length === 4 && partes[3] === 'editar' && metodo === 'POST') {
    return json(200, await ctx.agenda.editarCliente(profesionalId, partes[2], await leerBody(request)));
  }
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
  if (recurso === 'configuracion' && partes.length === 2) {
    if (metodo === 'GET') return json(200, await ctx.agenda.obtenerConfiguracion(profesionalId));
    if (metodo === 'POST') {
      const datos = await leerBody(request);
      if (datos.etiquetaClientes) return json(200, await ctx.agenda.cambiarEtiquetaClientes(profesionalId, datos.etiquetaClientes));
      if (datos.horario) return json(200, await ctx.agenda.cambiarHorario(profesionalId, datos.horario.desde, datos.horario.hasta));
      return json(200, await ctx.agenda.cambiarDuracion(profesionalId, datos.duracionTurno, datos.desde));
    }
  }
  if (recurso === 'turnos' && partes.length === 4 && partes[3] === 'cancelar' && metodo === 'POST') {
    return json(200, await ctx.agenda.cancelarTurno(profesionalId, partes[2], { ...(await leerBody(request)), autor: actor.nombre }));
  }
  if (recurso === 'seguimiento' && partes[2] === 'cancelaciones' && partes.length === 3 && metodo === 'GET') {
    const desde = url.searchParams.get('desde') || fechaLocal(-30);
    const hasta = url.searchParams.get('hasta') || fechaLocal();
    return json(200, await ctx.agenda.listarCancelaciones(profesionalId, desde, hasta));
  }
  if (recurso === 'turnos' && partes.length === 4 && partes[3] === 'comentarios' && metodo === 'POST') {
    const datos = await leerBody(request);
    return json(201, await ctx.agenda.agregarComentario(profesionalId, partes[2], { texto: datos.texto, autor: actor.nombre }));
  }
  if (recurso === 'turnos' && partes.length === 6 && partes[3] === 'comentarios' && partes[5] === 'quitar' && metodo === 'POST') {
    return json(200, await ctx.agenda.quitarComentario(profesionalId, partes[2], partes[4]));
  }
  return json(404, { error: 'Ruta no encontrada' });
}

export async function manejarApi(request, env = {}) {
  try {
    const ctx = iniciar();
    await inicializar(ctx, env);

    const url = new URL(request.url);
    const partes = url.pathname.split('/').filter(Boolean); // ['api', recurso, ...]
    const metodo = request.method;
    const recurso = partes[1];

    if (recurso === 'ingresar' && metodo === 'POST') {
      const datos = await leerBody(request);
      const { cuenta, token } = await ingresar({
        email: datos.email, clave: datos.clave, env, profesionales: ctx.persistencia.profesionales,
      });
      return json(200, { sesion: resumen(cuenta) }, { 'Set-Cookie': cookieDeSesion(token) });
    }
    if (recurso === 'salir' && metodo === 'POST') {
      return json(200, { ok: true }, { 'Set-Cookie': cookieParaBorrar() });
    }

    const actor = await identificar(request, env, ctx.persistencia.profesionales);

    if (recurso === 'yo' && metodo === 'GET') return json(200, resumen(actor));
    if (recurso === 'clave' && metodo === 'POST') {
      await cambiarClave(ctx, actor, await leerBody(request));
      return json(200, { ok: true });
    }

    if (actor.requiereCambioClave) throw new ErrorDeAcceso('Tenés que cambiar tu clave antes de continuar', 403);

    if (recurso === 'profesionales') {
      exigirAdmin(actor);
      return await rutaProfesionales(ctx, request, partes, actor);
    }

    const pedido = url.searchParams.get('profesional');
    const profesionalId = agendaObjetivo(actor, pedido === null ? null : Number(pedido));
    return await rutaAgenda(ctx, request, url, partes, profesionalId, actor);
  } catch (error) {
    if (error.estado) return json(error.estado, { error: error.message });
    console.error(error);
    return json(500, { error: 'Error interno' });
  }
}
