/**
 * STP 智能运输管理平台 · 前端静态服务器（零依赖，Node 14+）
 * - 静态文件：frontend/ 目录
 * - API 代理：/api/* → http://localhost:3000/api/*（同源部署，免跨域）
 *
 * 启动：node server.js [端口]   默认 8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3000);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 把 /api/* 请求原样转发给后端 */
function proxy(req, res) {
  const options = {
    host: BACKEND_HOST,
    port: BACKEND_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
  };
  const up = http.request(options, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: `后端服务不可达 (${BACKEND_HOST}:${BACKEND_PORT})，请先启动 backend` }));
  });
  req.pipe(up);
}

/** 静态文件 */
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) proxy(req, res);
  else serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`[STP] 前端已启动: http://localhost:${PORT}/index.html`);
  console.log(`[STP] API 代理 → http://${BACKEND_HOST}:${BACKEND_PORT}/api`);
});
