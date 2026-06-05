import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import fs from 'fs'
import path from 'path'

// Vite plugin — exposes /api/dev/read, /api/dev/write, /api/dev/list (dev only)
function devFileApiPlugin() {
  return {
    name: 'dev-file-api',
    configureServer(server) {
      const ROOT = process.cwd();
      const safe = (p) => {
        const r = path.resolve(ROOT, p);
        return r.startsWith(ROOT) ? r : null;
      };

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/dev/')) return next();
        const url = new URL(req.url, 'http://localhost');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

        const reply = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };

        if (url.pathname === '/api/dev/read' && req.method === 'GET') {
          const fp = url.searchParams.get('path');
          const full = fp && safe(fp);
          if (!full) return reply(400, { error: 'Invalid path' });
          try { reply(200, { content: fs.readFileSync(full, 'utf-8'), path: fp }); }
          catch (e) { reply(404, { error: e.message }); }

        } else if (url.pathname === '/api/dev/write' && req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => {
            try {
              const { path: fp, content } = JSON.parse(body);
              const full = fp && safe(fp);
              if (!full) return reply(400, { error: 'Invalid path' });
              fs.mkdirSync(path.dirname(full), { recursive: true });
              fs.writeFileSync(full, content, 'utf-8');
              reply(200, { success: true, path: fp });
            } catch (e) { reply(500, { error: e.message }); }
          });

        } else if (url.pathname === '/api/dev/list' && req.method === 'GET') {
          const dir = url.searchParams.get('dir') || 'src';
          const full = safe(dir);
          if (!full) return reply(400, { error: 'Invalid path' });
          try {
            const entries = fs.readdirSync(full, { withFileTypes: true });
            reply(200, { files: entries.map(e => ({ name: e.name, isDir: e.isDirectory() })), dir });
          } catch (e) { reply(404, { error: e.message }); }

        } else {
          reply(404, { error: 'Not found' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    logLevel: 'error',
    plugins: [
      base44({
        legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
        hmrNotifier: true,
        navigationNotifier: true,
        visualEditAgent: true
      }),
      react(),
      devFileApiPlugin(),
    ],
    server: {
      port: 3075,
      proxy: {
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace('/api/claude', ''),
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        },
      },
    },
  };
});
