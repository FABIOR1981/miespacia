'use strict';
/**
 * Servidor HTTP de miEspacia, sin dependencias externas.
 * Por ahora usa persistencia en memoria: los datos se pierden al reiniciar.
 *
 * Variables de entorno:
 *   PORT                  puerto (por defecto 3000)
 *   MIESPACIA_PROFESIONAL identificador del profesional que usa la instancia (por defecto 'profesional')
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { crearPersistencia } = require('./persistencia/interface_persistencia');
const { crearAgenda, ErrorDeNegocio } = require('./logica/agenda');

const PUBLIC = path.join(__dirname, '..', 'public');
const LIMITE_BODY = 100 * 1024;

function enviarJson(res, estado, cuerpo) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
}

function leerBody(req) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const partes = [];
    req.on('data', (parte) => {
      total += parte.length;
      if (total > LIMITE_BODY) {
        rechazar(new ErrorDeNegocio('El cuerpo es demasiado grande', 413));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      try {
        const texto = Buffer.concat(partes).toString('utf8');
        resolver(texto ? JSON.parse(texto) : {});
      } catch {
        rechazar(new ErrorDeNegocio('El cuerpo debe ser JSON válido'));
      }
    });
    req.on('error', rechazar);
  });
}

function crearServidor({ profesionalId = process.env.MIESPACIA_PROFESIONAL || 'profesional' } = {}) {
  const agenda = crearAgenda(crearPersistencia({ modo: 'memoria' }));

  async function rutaApi(req, res, url) {
    const metodo = req.method;
    const partes = url.pathname.split('/').filter(Boolean); // ['api', ...]

    if (partes[1] === 'clientes' && metodo === 'GET' && partes.length === 2) {
      return enviarJson(res, 200, await agenda.listarClientes(profesionalId));
    }
    if (partes[1] === 'clientes' && metodo === 'POST' && partes.length === 2) {
      return enviarJson(res, 201, await agenda.crearCliente(profesionalId, await leerBody(req)));
    }
    if (partes[1] === 'turnos' && metodo === 'GET' && partes.length === 2) {
      const hoy = new Date().toISOString().slice(0, 10);
      const desde = url.searchParams.get('desde') || hoy;
      const hasta = url.searchParams.get('hasta') || desde;
      return enviarJson(res, 200, await agenda.listarTurnos(profesionalId, desde, hasta));
    }
    if (partes[1] === 'turnos' && metodo === 'POST' && partes.length === 2) {
      return enviarJson(res, 201, await agenda.agendarTurno(profesionalId, await leerBody(req)));
    }
    if (partes[1] === 'turnos' && metodo === 'POST' && partes.length === 4 && partes[3] === 'cancelar') {
      return enviarJson(res, 200, await agenda.cancelarTurno(profesionalId, partes[2]));
    }
    return enviarJson(res, 404, { error: 'Ruta no encontrada' });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');

      if (url.pathname.startsWith('/api/')) {
        return await rutaApi(req, res, url);
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
      }

      return enviarJson(res, 404, { error: 'Ruta no encontrada' });
    } catch (error) {
      if (error instanceof ErrorDeNegocio) return enviarJson(res, error.estado, { error: error.message });
      console.error(error);
      return enviarJson(res, 500, { error: 'Error interno' });
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
