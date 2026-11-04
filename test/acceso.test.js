'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let manejarApi;
before(async () => { ({ manejarApi } = await import('../src/api.mjs')); });

const ADMIN = 'admin@t.test';
const ADMIN_CLAVE = 'NuevaClave-2';
const ENV = { ADMIN_EMAIL: ADMIN, ADMIN_CLAVE_INICIAL: 'ClaveInicial-1', SESION_SECRETO: 'secreto-de-prueba-largo' };

const pedir = (ruta, cookie, metodo = 'GET', cuerpo) =>
  manejarApi(new Request('http://x' + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }), ENV);

async function ingresar(email, clave) {
  const r = await manejarApi(new Request('http://x/api/ingresar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, clave }),
  }), ENV);
  const cookie = r.headers.get('set-cookie');
  return { status: r.status, cookie: cookie ? cookie.split(';')[0] : null, datos: await r.json() };
}

/** Entra y, si la clave es temporal, la cambia. Devuelve la cookie de sesión. */
async function entrarListo(email, clave, claveNueva) {
  const r = await ingresar(email, clave);
  assert.equal(r.status, 200, `ingreso de ${email}`);
  if (r.datos.sesion.requiereCambioClave) {
    const cambio = await pedir('/api/clave', r.cookie, 'POST', { actual: clave, nueva: claveNueva });
    assert.equal(cambio.status, 200);
  }
  return r.cookie;
}

/** El administrador ya cambió su clave en la primera prueba: entra con la nueva. */
async function admin() {
  const r = await ingresar(ADMIN, ADMIN_CLAVE);
  assert.equal(r.status, 200);
  return r.cookie;
}

test('sin sesión no se puede usar la API', async () => {
  assert.equal((await pedir('/api/clientes')).status, 401);
});

test('el administrador entra con su clave inicial sin tener que cambiarla', async () => {
  const r = await ingresar(ADMIN, ENV.ADMIN_CLAVE_INICIAL);
  assert.equal(r.status, 200);
  assert.equal(r.datos.sesion.requiereCambioClave, false);
  assert.equal((await pedir('/api/clientes', r.cookie)).status, 200);
});

test('el administrador puede cambiar su clave cuando quiera', async () => {
  const r = await ingresar(ADMIN, ENV.ADMIN_CLAVE_INICIAL);
  assert.equal((await pedir('/api/clave', r.cookie, 'POST', { actual: ENV.ADMIN_CLAVE_INICIAL, nueva: ADMIN_CLAVE })).status, 200);
  assert.equal((await ingresar(ADMIN, ADMIN_CLAVE)).status, 200);
});

test('clave incorrecta no entra, y un email que no existe da el mismo error', async () => {
  assert.equal((await ingresar(ADMIN, 'otra-clave')).status, 401);
  const inexistente = await ingresar('nadie@t.test', 'otra-clave');
  assert.equal(inexistente.status, 401);
  assert.equal(inexistente.datos.error, 'Email o clave incorrectos');
});

test('el administrador da de alta profesionales; cada uno ve solo su agenda', async () => {
  const cookieAdmin = await admin();

  let r = await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'ana@t.test', usuario: 'ana', nombre: 'Ana' });
  assert.equal(r.status, 201);
  const altaAna = await r.json();
  assert.ok(altaAna.claveTemporal);
  const anaId = altaAna.profesional.id;

  r = await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'luis@t.test', usuario: 'luis', nombre: 'Luis' });
  const altaLuis = await r.json();

  const cookieAna = await entrarListo('ana@t.test', altaAna.claveTemporal, 'ClaveAna-2026');
  const cookieLuis = await entrarListo('luis@t.test', altaLuis.claveTemporal, 'ClaveLuis-2026');

  r = await pedir('/api/clientes', cookieAna, 'POST', { nombre: 'Paciente de Ana' });
  assert.equal(r.status, 201);

  r = await pedir('/api/clientes', cookieLuis);
  assert.deepEqual(await r.json(), []);

  r = await pedir(`/api/clientes?profesional=${anaId}`, cookieLuis);
  assert.equal(r.status, 403);

  r = await pedir(`/api/clientes?profesional=${anaId}`, cookieAdmin);
  assert.equal((await r.json()).length, 1);
});

test('un profesional no puede gestionar profesionales ni duplicar emails', async () => {
  const cookieAdmin = await admin();
  const altaAna = await (await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'dup@t.test', usuario: 'dup', nombre: 'Dup' })).json();
  const cookieDup = await entrarListo('dup@t.test', altaAna.claveTemporal, 'ClaveDup-2026');
  assert.equal((await pedir('/api/profesionales', cookieDup)).status, 403);
  assert.equal((await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'dup@t.test', usuario: 'dup', nombre: 'Otra' })).status, 409);
});

test('tras 5 intentos fallidos el email queda bloqueado un rato', async () => {
  const cookieAdmin = await admin();
  await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'bloq@t.test', usuario: 'bloq', nombre: 'Bloq' });
  for (let i = 0; i < 5; i++) assert.equal((await ingresar('bloq@t.test', 'mala-clave')).status, 401);
  const bloqueado = await ingresar('bloq@t.test', 'cualquiera');
  assert.equal(bloqueado.status, 429);
});

test('el administrador reinicia una clave y la anterior deja de servir', async () => {
  const cookieAdmin = await admin();
  const alta = await (await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'reinicio@t.test', usuario: 'reinicio', nombre: 'R' })).json();
  const profesional = alta.profesional;
  const nueva = await (await pedir(`/api/profesionales/${profesional.id}/reiniciar-clave`, cookieAdmin, 'POST')).json();
  assert.ok(nueva.claveTemporal);
  assert.notEqual(nueva.claveTemporal, alta.claveTemporal);
  assert.equal((await ingresar('reinicio@t.test', alta.claveTemporal)).status, 401);
  assert.equal((await ingresar('reinicio@t.test', nueva.claveTemporal)).status, 200);
});

test('desactivar un profesional le corta el acceso, incluso con sesión abierta', async () => {
  const cookieAdmin = await admin();
  const alta = await (await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'marta@t.test', usuario: 'marta', nombre: 'Marta' })).json();
  const cookieMarta = await entrarListo('marta@t.test', alta.claveTemporal, 'ClaveMarta-2026');
  assert.equal((await pedir('/api/yo', cookieMarta)).status, 200);

  assert.equal((await pedir(`/api/profesionales/${alta.profesional.id}/desactivar`, cookieAdmin, 'POST')).status, 200);
  assert.equal((await pedir('/api/yo', cookieMarta)).status, 403);
  assert.equal((await ingresar('marta@t.test', 'ClaveMarta-2026')).status, 401);
});

test('el administrador no puede desactivarse a sí mismo', async () => {
  const cookieAdmin = await admin();
  const yo = await (await pedir('/api/yo', cookieAdmin)).json();
  assert.equal((await pedir(`/api/profesionales/${yo.id}/desactivar`, cookieAdmin, 'POST')).status, 400);
});

test('el administrador puede cancelar un turno de cualquier profesional', async () => {
  const cookieAdmin = await admin();
  const alta = await (await pedir('/api/profesionales', cookieAdmin, 'POST', { email: 'rita@t.test', usuario: 'rita', nombre: 'Rita' })).json();
  const cookieRita = await entrarListo('rita@t.test', alta.claveTemporal, 'ClaveRita-2026');
  const cliente = await (await pedir('/api/clientes', cookieRita, 'POST', { nombre: 'C' })).json();
  const turno = await (await pedir('/api/turnos', cookieRita, 'POST', { clienteId: cliente.id, fecha: '2026-11-10', hora: '09:00' })).json();
  const cancelado = await (await pedir(`/api/turnos/${turno.id}/cancelar?profesional=${alta.profesional.id}`, cookieAdmin, 'POST')).json();
  assert.equal(cancelado.cancelado, true);
});
