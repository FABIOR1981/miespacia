'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let manejarApi;
before(async () => { ({ manejarApi } = await import('../src/api.mjs')); });

const ENV = { DATOS_DE_PRUEBA: '1', ADMIN_EMAIL: 'admin@p.test', ADMIN_CLAVE_INICIAL: 'ClaveInicial-1', SESION_SECRETO: 'secreto-de-prueba-largo' };

async function ingresar(email, clave) {
  const r = await manejarApi(new Request('http://x/api/ingresar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, clave }),
  }), ENV);
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null };
}
const pedir = (ruta, cookie) => manejarApi(new Request('http://x' + ruta, { headers: { Cookie: cookie } }), ENV);

test('con DATOS_DE_PRUEBA, Ana y Luis entran y cada uno ve sus clientes', async () => {
  const { CLAVE_DE_PRUEBA, PROFESIONALES } = require('../src/datos/prueba');
  const claveLuis = PROFESIONALES.find((p) => p.usuario === 'luisg').clave;
  const ana = await ingresar('ana@miespacia.test', CLAVE_DE_PRUEBA);
  const luis = await ingresar('luis@miespacia.test', claveLuis);
  assert.equal(ana.status, 200);
  assert.equal(luis.status, 200);
  assert.equal((await (await pedir('/api/clientes', ana.cookie)).json()).length, 5);
  assert.equal((await (await pedir('/api/clientes', luis.cookie)).json()).length, 4);
});

test('los datos de prueba incluyen turnos para cada profesional', async () => {
  const ana = await ingresar('ana@miespacia.test', require('../src/datos/prueba').CLAVE_DE_PRUEBA);
  const r = await pedir('/api/turnos?desde=2000-01-01&hasta=2100-12-31', ana.cookie);
  assert.equal((await r.json()).length, 2);
});

test('Rita (ritam) está en los datos de prueba y entra con su usuario', async () => {
  const { PROFESIONALES } = require('../src/datos/prueba');
  const rita = PROFESIONALES.find((p) => p.usuario === 'ritam');
  const r = await ingresar('ritam', rita.clave);
  assert.equal(r.status, 200);
  assert.equal((await (await pedir('/api/clientes', r.cookie)).json()).length, 3);
});
