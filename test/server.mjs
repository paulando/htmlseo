#!/usr/bin/env node
/*
 * Zero-dependency dev/test server. Serves the repo root statically plus a few
 * special routes that exercise the Indexing checks:
 *
 *   /robots.txt          disallows /test/fixtures/blocked.html, lists /sitemap.xml
 *   /sitemap.xml         lists fixture.html and clean.html
 *   /redirect-301        301 → /redirect-302 → 302 → /test/fixtures/clean.html
 *   /xrobots-noindex     clean.html with "X-Robots-Tag: noindex"
 *   /status/<code>       empty response with that status (e.g. /status/404)
 *   /img/<w>x<h>.png     generated PNG of that size (?noise → large, incompressible file)
 *
 * Usage: node test/server.mjs   (PORT env var, default 8765)
 */
import http from 'node:http';
import zlib from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8765;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
};

/* Minimal PNG encoder (RGB, no deps). noise=true makes it incompressible (large file). */
function makePng(width, height, noise) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const row = width * 3 + 1;
    const raw = Buffer.alloc(row * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * row + 1 + x * 3;
            raw[i] = noise ? Math.random() * 256 : 59;
            raw[i + 1] = noise ? Math.random() * 256 : 130;
            raw[i + 2] = noise ? Math.random() * 256 : 246;
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function send(req, res, status, body = '', headers = {}) {
    res.writeHead(status, { 'cache-control': 'no-store', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
}

async function serveFile(req, res, file, extraHeaders = {}) {
    const body = await readFile(file);
    send(req, res, 200, body, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', ...extraHeaders });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    const origin = url.origin;
    try {
        if (url.pathname === '/') return send(req, res, 302, '', { location: '/test/harness.html' });
        if (url.pathname === '/robots.txt') {
            return send(req, res, 200, [
                'User-agent: *',
                'Disallow: /test/fixtures/blocked',
                'Allow: /',
                '',
                'User-agent: SomeOtherBot',
                'Disallow: /',
                '',
                `Sitemap: ${origin}/sitemap.xml`,
            ].join('\n'), { 'content-type': TYPES['.txt'] });
        }
        if (url.pathname === '/sitemap.xml') {
            const locs = ['fixture.html', 'clean.html', 'images.html'].map((f) => `  <url><loc>${origin}/test/fixtures/${f}</loc></url>`);
            return send(req, res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.join('\n')}\n</urlset>`, { 'content-type': TYPES['.xml'] });
        }
        if (url.pathname === '/redirect-301') return send(req, res, 301, '', { location: '/redirect-302' });
        if (url.pathname === '/redirect-302') return send(req, res, 302, '', { location: '/test/fixtures/clean.html' });
        if (url.pathname === '/xrobots-noindex') {
            return serveFile(req, res, path.join(ROOT, 'test/fixtures/clean.html'), { 'x-robots-tag': 'noindex' });
        }
        const img = url.pathname.match(/^\/img\/(\d{1,4})x(\d{1,4})\.png$/);
        if (img) {
            const [w, h] = [Number(img[1]), Number(img[2])];
            if (!w || !h || w * h > 4_000_000) return send(req, res, 400, 'Bad size');
            return send(req, res, 200, makePng(w, h, url.searchParams.has('noise')), { 'content-type': TYPES['.png'] });
        }
        const status = url.pathname.match(/^\/status\/(\d{3})$/);
        if (status) return send(req, res, Number(status[1]), `HTTP ${status[1]}`, { 'content-type': TYPES['.txt'] });

        // Static files (no directory traversal outside ROOT).
        const file = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(ROOT + path.sep)) return send(req, res, 403, 'Forbidden');
        const info = await stat(file).catch(() => null);
        if (info?.isFile()) return serveFile(req, res, file);
        if (info?.isDirectory()) {
            const index = path.join(file, 'index.html');
            if (await stat(index).catch(() => null)) return serveFile(req, res, index);
        }
        return send(req, res, 404, 'Not found', { 'content-type': TYPES['.txt'] });
    } catch (e) {
        return send(req, res, 500, String(e), { 'content-type': TYPES['.txt'] });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`HTML SEO test server on http://localhost:${PORT}  (harness: /test/harness.html)`);
});
