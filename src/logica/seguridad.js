'use strict';
/**
 * Contraseñas y sesiones con WebCrypto: funciona igual en Node y en Cloudflare Workers.
 * - Clave: PBKDF2-SHA256 con sal propia por usuario. Formato guardado: pbkdf2$iteraciones$sal$hash
 * - Sesión: token firmado con HMAC-SHA256 y con vencimiento (exp, en segundos).
 */

const ITERACIONES = 100000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // sin 0/O, 1/l/I

function aBase64Url(bytes) {
  let texto = '';
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto) {
  const binario = atob(String(texto).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

async function derivar(clave, sal, iteraciones) {
  const material = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, material, 256);
  return new Uint8Array(bits);
}

async function hashearClave(clave) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(String(clave), sal, ITERACIONES);
  return ['pbkdf2', ITERACIONES, aBase64Url(sal), aBase64Url(hash)].join('$');
}

async function verificarClave(clave, almacenado) {
  const partes = String(almacenado ?? '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const hash = await derivar(String(clave), deBase64Url(partes[2]), Number(partes[1]));
  return iguales(hash, deBase64Url(partes[3]));
}

/** Clave temporal legible, para dar de alta o reiniciar. Se muestra una sola vez. */
function claveTemporal(largo = 12) {
  const valores = crypto.getRandomValues(new Uint8Array(largo));
  return Array.from(valores, (v) => ALFABETO[v % ALFABETO.length]).join('');
}

async function claveHmac(secreto) {
  return crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function firmarSesion(datos, secreto, segundos) {
  const cuerpo = { ...datos, exp: Math.floor(Date.now() / 1000) + segundos };
  const parte = aBase64Url(enc.encode(JSON.stringify(cuerpo)));
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', await claveHmac(secreto), enc.encode(parte)));
  return `${parte}.${aBase64Url(firma)}`;
}

async function leerSesion(token, secreto) {
  const [parte, firma] = String(token ?? '').split('.');
  if (!parte || !firma) return null;
  let valida = false;
  try {
    valida = await crypto.subtle.verify('HMAC', await claveHmac(secreto), deBase64Url(firma), enc.encode(parte));
  } catch {
    return null;
  }
  if (!valida) return null;
  try {
    const cuerpo = JSON.parse(dec.decode(deBase64Url(parte)));
    if (!cuerpo.exp || cuerpo.exp < Math.floor(Date.now() / 1000)) return null;
    return cuerpo;
  } catch {
    return null;
  }
}

module.exports = { hashearClave, verificarClave, claveTemporal, firmarSesion, leerSesion };
