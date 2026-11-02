// Teste de ponta a ponta: abre a página num Chromium real, confere se o modelo foi montado
// e salva uma captura de tela. Uso: node tests/e2e.mjs [pasta-de-saida]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const raiz = resolve(new URL('..', import.meta.url).pathname);
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };
const srv = createServer(async (req, res) => {
  try {
    const p = join(raiz, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': tipos[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${srv.address().port}/`;
const saida = process.argv[2] || '.';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const erros = [];
try {
  for (const [nome, vp] of [['desktop', { width: 1366, height: 800 }], ['celular', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', (e) => erros.push(`${nome}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && erros.push(`${nome}: ${m.text()}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__terreno?.tri?.length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ n: __terreno.pontos.length, tri: __terreno.tri.length / 3, curvas: __terreno.curvas.length }));
    if (r.n !== 2500 || r.tri < 4000 || r.curvas < 20) throw new Error(`${nome}: modelo inesperado ${JSON.stringify(r)}`);
    // muda o intervalo e liga a malha
    await page.locator('#intervalo').fill('2');
    await page.locator('#vGirar').uncheck();
    await page.waitForTimeout(600);
    const r2 = await page.evaluate(() => __terreno.curvas.length);
    if (!(r2 < r.curvas)) throw new Error('intervalo não alterou as curvas');
    // download do DXF
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnDXF')]);
    const dxf = await readFile(await dl.path(), 'utf8');
    if (!dxf.includes('CURVA_MESTRA') || !dxf.trim().endsWith('EOF')) throw new Error('DXF inválido');
    await page.screenshot({ path: join(saida, `captura-${nome}.png`) });
    console.log(nome, 'ok', JSON.stringify(r), 'curvas@2m', r2, 'dxf', dxf.length, 'bytes');
    await page.close();
  }
  // upload de arquivo
  const page = await browser.newPage();
  page.on('pageerror', (e) => erros.push(`upload: ${e.message}`));
  await page.goto(url + '?exemplo=0');
  await page.setInputFiles('#arquivo', { name: 'teste.csv', mimeType: 'text/csv',
    buffer: Buffer.from('P;N;E;Z;D\n' + Array.from({ length: 400 }, (_, k) => {
      const i = k % 20, j = Math.floor(k / 20);
      return `${k + 1};${8600000 + j * 5};${510000 + i * 5};${(50 + Math.sin(i / 3) * 3 + j * 0.2).toFixed(3)};TN`;
    }).join('\n')) });
  await page.waitForFunction(() => window.__terreno?.pontos?.length === 400, null, { timeout: 10000 });
  console.log('upload ok', await page.locator('#msg').textContent());
} finally {
  await browser.close();
  srv.close();
}
if (erros.length) { console.error('ERROS NO CONSOLE:\n' + erros.join('\n')); process.exit(1); }
