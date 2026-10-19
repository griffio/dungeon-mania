// Cloudflare Pages Functions: /api/* on the game's own site goes to the oracle's Worker
// (worker/src/index.js), with the Pages project's bindings (wrangler.toml: Workers AI).
import worker from '../../worker/src/index.js';

export const onRequest = ({ request, env }) => worker.fetch(request, env);
