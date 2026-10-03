// Metro config: Expo defaults plus development-only relays for NVIDIA and Gemini.
//
// Why: NVIDIA's API (integrate.api.nvidia.com) doesn't allow calls from web pages (no CORS
// headers), so the *web* version of the app sends AI requests to this local dev server at
// /__nvidia/..., which forwards them to NVIDIA. Gemini web requests similarly use
// /__gemini/... . Android calls both APIs directly. These relays only exist while
// `npx expo start` runs and do not store keys or responses.
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

function geminiProxy(req, res, next) {
  if (!req.url || !req.url.startsWith('/__gemini/')) return next();
  if (!/^\/__gemini\/v1beta\/models\/[A-Za-z0-9._-]+:generateContent$/.test(req.url) || req.method !== 'POST') {
    res.statusCode = 404;
    return res.end();
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const upstream = await fetch(`https://generativelanguage.googleapis.com${req.url.slice('/__gemini'.length)}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(req.headers['x-goog-api-key'] ? { 'x-goog-api-key': req.headers['x-goog-api-key'] } : {}),
        },
        body: Buffer.concat(chunks),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      if (res.destroyed) return;
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
      res.end(body);
    } catch {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Could not reach Gemini.' } }));
    }
  });
}

const previous = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const inner = previous ? previous(middleware, server) : middleware;
  return (req, res, next) => nvidiaProxy(req, res, () => geminiProxy(req, res, () => inner(req, res, next)));
};

module.exports = config;
