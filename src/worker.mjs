import { manejarApi } from './api.mjs';

/**
 * Entrada en Cloudflare Workers. /api/* lo atiende src/api.mjs; el resto lo sirven los assets de public/.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return manejarApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
