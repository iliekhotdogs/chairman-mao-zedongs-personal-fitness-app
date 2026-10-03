// Metro config: Expo defaults plus a tiny development-only proxy for NVIDIA's API.
//
// Why: NVIDIA's API (integrate.api.nvidia.com) doesn't allow calls from web pages (no CORS
// headers), so the *web* version of the app sends AI requests to this local dev server at
// /__nvidia/..., which forwards them to NVIDIA. The Android app calls NVIDIA directly and
// doesn't need this. The proxy only exists while `npx expo start` is running; it stores
// nothing and only forwards to NVIDIA.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const PREFIX = '/__nvidia/';
const TARGET = 'https://integrate.api.nvidia.com/';

function nvidiaProxy(req, res, next) {
  if (!req.url || !req.url.startsWith(PREFIX)) return next();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    // Log model, status and time (never the key) so slow or failing requests are easy to diagnose.
    const started = Date.now();
    let model = '?';
    try {
      model = JSON.parse(Buffer.concat(chunks).toString('utf8')).model || '?';
    } catch {
      // not JSON; keep "?"
    }
    const log = (status) => console.log(`[nvidia] ${model} -> ${status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.on('close', () => {
      if (!res.writableFinished) log('cancelled by app');
    });
    try {
      const upstream = await fetch(TARGET + req.url.slice(PREFIX.length), {
        method: req.method,
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          accept: 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      log(upstream.status);
      if (res.destroyed) return;
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
      res.end(body);
    } catch (e) {
      log(`network error: ${e && e.message ? e.message : e}`);
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: `Could not reach NVIDIA: ${e && e.message ? e.message : e}` } }));
    }
  });
}

const previous = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const inner = previous ? previous(middleware, server) : middleware;
  return (req, res, next) => nvidiaProxy(req, res, () => inner(req, res, next));
};

module.exports = config;
