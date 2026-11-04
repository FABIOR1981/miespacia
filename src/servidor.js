'use strict';
/**
 * Servidor local de miEspacia para probar sin Cloudflare. Usa la misma API (src/api.mjs).
 * Variables de entorno: PORT (3000 por defecto), ADMIN_EMAIL.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const LIMITE_BODY = 100 * 1024;
const CABECERA_EMAIL = 'cf-access-authenticated-user-email';

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const partes = [];
    req.on('data', (parte) => {
      total += parte.length;
      if (total > LIMITE_BODY) {
        rechazar(new Error('El cuerpo es demasiado grande'));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolver(Buffer.concat(partes)));
    req.on('error', rechazar);
  });
}

function crearServidor() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');

      if (url.pathname.startsWith('/api/')) {
        const { manejarApi } = await import('./api.mjs');
        const sinCuerpo = req.method === 'GET' || req.method === 'HEAD';
        const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
        if (req.headers[CABECERA_EMAIL]) headers[CABECERA_EMAIL] = req.headers[CABECERA_EMAIL];
        const request = new Request(url.href, {
          method: req.method,
          headers,
          body: sinCuerpo ? undefined : await leerCuerpo(req),
        });
        const respuesta = await manejarApi(request, process.env);
        res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers.entries()));
        return res.end(Buffer.from(await respuesta.arrayBuffer()));
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
    } catch (error) {
      console.error(error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Error interno' }));
    }
  });
}

if (require.main === module) {
  const puerto = Number(process.env.PORT) || 3000;
  crearServidor().listen(puerto, () => {
    console.log(`miEspacia escuchando en http://localhost:${puerto}`);
  });
}

module.exports = { crearServidor };
