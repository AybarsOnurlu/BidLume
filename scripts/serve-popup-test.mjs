import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.UPLENS_TEST_PORT || 8765);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const relativePath = url.pathname === '/' ? 'popup/popup.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(root, relativePath);
    if (!target.startsWith(root + path.sep)) throw new Error('Path outside project root');

    let body = await readFile(target);
    if (relativePath === 'popup/popup.html') {
      body = Buffer.from(body.toString('utf8').replace(
        '<script type="module" src="popup.js"></script>',
        '<script src="/tests/browser/chrome-mock.js"></script>\n  <script type="module" src="popup.js"></script>'
      ));
    }

    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.message);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`BidLume popup test server: http://127.0.0.1:${port}/popup/popup.html`);
});
