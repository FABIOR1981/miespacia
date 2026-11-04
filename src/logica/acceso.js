'use strict';
/**
 * Identidad y permisos de miEspacia.
 *
 * La identidad llega en la cabecera que pone Cloudflare Access (email ya verificado por Access).
 * Sin Access delante de la app, cualquiera puede mandar esa cabecera: por eso no hay que publicar
 * la app sin Access configurado.
 */

class ErrorDeAcceso extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Devuelve la cuenta del email si existe y está activa. */
async function identificar(email, profesionales) {
  if (!email) throw new ErrorDeAcceso('Iniciá sesión para continuar', 401);
  const cuenta = await profesionales.porEmail(email);
  if (!cuenta || !cuenta.activo) throw new ErrorDeAcceso('Tu cuenta no está habilitada', 403);
  return cuenta;
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

module.exports = { identificar, exigirAdmin, agendaObjetivo, ErrorDeAcceso };
