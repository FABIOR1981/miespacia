'use strict';
/**
 * Ingreso, sesiones y permisos de miEspacia.
 * - La sesión viaja en una cookie HttpOnly (o en Authorization: Bearer, para pruebas).
 * - Tras 5 intentos fallidos, el email queda bloqueado 15 minutos.
 */

const { verificarClave, firmarSesion, leerSesion } = require('./seguridad');

const COOKIE = 'miespacia_sesion';
const DURACION_SEGUNDOS = 12 * 3600;
const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const fallos = new Map(); // email -> { cantidad, bloqueadoHasta }

class ErrorDeAcceso extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

function secretoDe(env) {
  if (!env.SESION_SECRETO) throw new ErrorDeAcceso('Falta configurar SESION_SECRETO en el servidor', 500);
  return env.SESION_SECRETO;
}

function leerToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  for (const parte of (request.headers.get('cookie') || '').split(';')) {
    const [nombre, ...valor] = parte.trim().split('=');
    if (nombre === COOKIE) return valor.join('=');
  }
  return null;
}

/** Cuenta de la sesión actual, si existe y sigue activa. */
async function identificar(request, env, profesionales) {
  const token = leerToken(request);
  if (!token) throw new ErrorDeAcceso('Iniciá sesión para continuar', 401);
  const sesion = await leerSesion(token, secretoDe(env));
  if (!sesion) throw new ErrorDeAcceso('Tu sesión venció, volvé a ingresar', 401);
  const cuenta = await profesionales.obtener(sesion.sub);
  if (!cuenta || !cuenta.activo) throw new ErrorDeAcceso('Tu cuenta no está habilitada', 403);
  return cuenta;
}

/** Valida email y clave. Devuelve la cuenta y el token de sesión. */
async function ingresar({ email, clave, env, profesionales, ahora = Date.now() }) {
  const correo = String(email ?? '').trim().toLowerCase();
  const registro = fallos.get(correo);
  if (registro && registro.bloqueadoHasta > ahora) {
    throw new ErrorDeAcceso('Demasiados intentos. Esperá unos minutos e intentá de nuevo.', 429);
  }

  const cuenta = correo ? await profesionales.porEmail(correo) : null;
  const ok = !!cuenta && cuenta.activo && (await verificarClave(String(clave ?? ''), cuenta.claveHash));
  if (!ok) {
    const bloqueoVencido = !!registro?.bloqueadoHasta && registro.bloqueadoHasta <= ahora;
    const cantidad = (bloqueoVencido ? 0 : (registro?.cantidad ?? 0)) + 1;
    fallos.set(correo, { cantidad, bloqueadoHasta: cantidad >= MAX_FALLOS ? ahora + BLOQUEO_MS : 0 });
    throw new ErrorDeAcceso('Email o clave incorrectos', 401);
  }

  fallos.delete(correo);
  const token = await firmarSesion({ sub: cuenta.id, rol: cuenta.rol }, secretoDe(env), DURACION_SEGUNDOS);
  return { cuenta, token };
}

function cookieDeSesion(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DURACION_SEGUNDOS}`;
}

function cookieParaBorrar() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function exigirAdmin(actor) {
  if (actor.rol !== 'admin') throw new ErrorDeAcceso('Solo el administrador puede hacer esto', 403);
}

/**
 * Qué agenda toca el pedido. Un profesional solo puede tocar la suya.
 * El administrador puede pedir la de cualquiera con ?profesional=ID.
 */
function agendaObjetivo(actor, pedido) {
  if (pedido === null || pedido === undefined || pedido === actor.id) return actor.id;
  if (!Number.isInteger(pedido)) throw new ErrorDeAcceso('Profesional inválido', 400);
  if (actor.rol === 'admin') return pedido;
  throw new ErrorDeAcceso('No podés ver la agenda de otro profesional', 403);
}

module.exports = {
  identificar, ingresar, cookieDeSesion, cookieParaBorrar, exigirAdmin, agendaObjetivo, ErrorDeAcceso,
};
