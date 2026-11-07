const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, 'dist');
const port = Number(process.env.PORT || 4317);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8','.jpg':'image/jpeg','.svg':'image/svg+xml'};
http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(target,(error, stat) => {
    if(error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(target).pipe(res);
  });
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
