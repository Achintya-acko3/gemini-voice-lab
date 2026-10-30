import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
import {liveConfig, MODEL, MODELS} from './public/protocol.js';

const port = Number(process.env.PORT || 8787);
const files = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/protocol.js', ['public/protocol.js', 'text/javascript']],
  ['/audio.js', ['public/audio.js', 'text/javascript']],
  ['/pcm-worklet.js', ['public/pcm-worklet.js', 'text/javascript']],
  ['/style.css', ['public/style.css', 'text/css']],
  ['/vendor/genai.js', ['public/vendor/genai.js', 'text/javascript']],
]);
function json(res, status, data) { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); }
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return json(res, 403, {error: 'Localhost only.'});
  try {
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, {serverKey: Boolean(process.env.GEMINI_API_KEY), model: MODEL, models: Object.keys(MODELS)});
    if (req.method === 'POST' && req.url === '/api/token') {
      if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, {error: 'Same-origin JSON requests only.'});
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 20000) return json(res, 413, {error: 'Request too large.'});
      }
      let input, config;
      try { input = JSON.parse(body); config = liveConfig(input); } catch (error) { return json(res, 400, {error: error.message}); }
      const model = input.model ?? MODEL;
      const apiKey = process.env.GEMINI_API_KEY || input.apiKey;
      if (!apiKey || typeof apiKey !== 'string') return json(res, 400, {error: 'Enter a Gemini API key or set GEMINI_API_KEY in .env.'});
      const client = new GoogleGenAI({apiKey, httpOptions: {apiVersion: 'v1beta', timeout: 30000}});
      const token = await client.authTokens.create({config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {model, config},
      }});
      if (!token.name) throw new Error('Google did not return a connection token.');
      return json(res, 200, {token: token.name, model, config});
    }
    if (req.method !== 'GET' || !files.has(req.url)) return json(res, 404, {error: 'Not found'});
    const [file, type] = files.get(req.url);
    const data = await readFile(new URL(file, import.meta.url));
    res.writeHead(200, {'Content-Type': `${type}; charset=utf-8`}); res.end(data);
  } catch (error) {
    // Do not echo SDK error objects: they may include credential-bearing request details.
    const status = Number(error.status || error.code);
    json(res, 502, {error: `Google connection setup failed${Number.isInteger(status) ? ` (${status})` : ''}. Check your API key, billing, and access to the selected model.`});
  }
}).listen(port, '127.0.0.1', () => console.log(`Gemini Voice Lab: http://localhost:${port}`));
