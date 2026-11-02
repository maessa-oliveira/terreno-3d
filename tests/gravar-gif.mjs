// Gera docs/demo.gif (terreno girando) — node tests/gravar-gif.mjs  (requer ffmpeg)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const raiz = resolve(new URL('..', import.meta.url).pathname);
const srv = createServer(async (req, res) => {
  try {
    const p = join(raiz, new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const pasta = await mkdtemp(join(tmpdir(), 'gif-'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 676 } });
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForFunction(() => window.__terreno?.tri?.length > 0);
await page.locator('#vGirar').uncheck();
const quadros = 72;
for (let i = 0; i < quadros; i++) {
  await page.evaluate((a) => window.__girar(a), (2 * Math.PI) / quadros);
  await page.waitForTimeout(30);
  await page.screenshot({ path: join(pasta, `q${String(i).padStart(3, '0')}.png`) });
}
await browser.close();
srv.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '18', '-i', join(pasta, 'q%03d.png'),
  '-vf', 'scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
  join(raiz, 'docs', 'demo.gif')]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', join(pasta, 'q%03d.png'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '20', join(raiz, 'docs', 'demo.mp4')]);
console.log('docs/demo.gif e docs/demo.mp4 gerados');
