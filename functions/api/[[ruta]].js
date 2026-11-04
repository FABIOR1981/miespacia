import { manejarApi } from '../../src/api.mjs';

/**
 * Cloudflare Pages Functions: todo /api/* pasa por manejarApi.
 * Con Pages, la carpeta de salida es public/ (ver README).
 */
export function onRequest(context) {
  return manejarApi(context.request, context.env);
}
