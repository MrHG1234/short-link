'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function hostOf(req) {
  const raw = req.headers['x-forwarded-host'] || req.headers['host'] || '';
  return String(raw).split(',')[0].trim();
}

function protoOf(req) {
  const raw = req.headers['x-forwarded-proto'] || '';
  const p = String(raw).split(',')[0].trim();
  return p || 'https';
}

function baseOf(req) {
  const host = hostOf(req);
  if (!host) return '';
  return protoOf(req) + '://' + host;
}

function log(req, status, bytes) {
  const ua = String(req.headers['user-agent'] || '-').slice(0, 400);
  const line = [
    new Date().toISOString(),
    req.method,
    req.url,
    status,
    bytes,
    'host=' + hostOf(req),
    'ref=' + String(req.headers['referer'] || '-').slice(0, 200),
    'ua=' + ua
  ].join(' | ');
  console.log(line);
}

function send(req, res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Probe-Build': 'dycloud-v2'
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function servePage(req, res, file) {
  fs.readFile(path.join(ROOT, file), (err, buf) => {
    if (err) {
      send(req, res, 500, 'text/plain; charset=utf-8', Buffer.from('page missing'));
      log(req, 500, 0);
      return;
    }
    const html = buf.toString('utf8').split('__BASE__').join(baseOf(req));
    const out = Buffer.from(html, 'utf8');
    send(req, res, 200, MIME['.html'], out);
    log(req, 200, out.length);
  });
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function absUrl(req, v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(weixin|alipays|tel|mailto):/i.test(raw)) return raw;
  const base = baseOf(req);
  return base + (raw.charAt(0) === '/' ? raw : '/' + raw);
}

// 卡片页：/ 带 t / d / i / u 任一参数时渲染，服务端直出 og，供抖音抓取
function renderCard(req, res, q) {
  fs.readFile(path.join(ROOT, 'card.html'), (err, buf) => {
    if (err) {
      send(req, res, 500, 'text/plain; charset=utf-8', Buffer.from('card template missing'));
      log(req, 500, 0);
      return;
    }
    const title = (q.get('t') || '星链客谷').slice(0, 60);
    const desc = (q.get('d') || '点击查看完整内容').slice(0, 120);
    const image = absUrl(req, q.get('i') || '/og-user.jpg');
    const target = absUrl(req, q.get('u') || '');
    const self = baseOf(req) + req.url;

    const html = buf.toString('utf8')
      .split('{{TITLE}}').join(escHtml(title))
      .split('{{DESC}}').join(escHtml(desc))
      .split('{{IMAGE}}').join(escHtml(image))
      .split('{{TARGET}}').join(escHtml(target))
      .split('{{SELF}}').join(escHtml(self));

    const out = Buffer.from(html, 'utf8');
    send(req, res, 200, MIME['.html'], out);
    log(req, 200, out.length);
  });
}

function serveStatic(req, res, rel) {
  const clean = rel.replace(/^\/+/, '');
  if (!clean || clean.indexOf('..') !== -1) {
    send(req, res, 404, 'text/plain; charset=utf-8', Buffer.from('not found'));
    log(req, 404, 0);
    return;
  }
  const full = path.join(ROOT, clean);
  if (full.indexOf(ROOT) !== 0) {
    send(req, res, 404, 'text/plain; charset=utf-8', Buffer.from('not found'));
    log(req, 404, 0);
    return;
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      send(req, res, 404, 'text/plain; charset=utf-8', Buffer.from('not found'));
      log(req, 404, 0);
      return;
    }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    fs.readFile(full, (e2, buf) => {
      if (e2) {
        send(req, res, 500, 'text/plain; charset=utf-8', Buffer.from('read error'));
        log(req, 500, 0);
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': buf.length,
        'Cache-Control': type.startsWith('image/') ? 'public, max-age=3600' : 'no-store',
        'X-Probe-Build': 'dycloud-v2'
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
      log(req, 200, buf.length);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const qIndex = url.indexOf('?');
  let pathname = qIndex === -1 ? url : url.slice(0, qIndex);

  if (pathname === '/v1/ping') {
    send(req, res, 200, 'text/plain; charset=utf-8', Buffer.from('pong'));
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const q = new URL(url, 'http://placeholder').searchParams;
    if (q.has('t') || q.has('d') || q.has('i') || q.has('u')) {
      renderCard(req, res, q);
      return;
    }
    servePage(req, res, 'index.html');
    return;
  }

  if (pathname === '/probe' || pathname === '/probe/' || pathname === '/probe.html') {
    servePage(req, res, 'probe.html');
    return;
  }

  if (pathname === '/favicon.ico' || pathname === '/apple-touch-icon.png') {
    serveStatic(req, res, 'og-user.jpg');
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('dycloud shell listening on ' + PORT);
});
