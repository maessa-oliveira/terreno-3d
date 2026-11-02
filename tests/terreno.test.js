import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerPontos, triangular, sugerirLadoMax, curvasDeNivel, unirSegmentos,
  estatisticas, curvasParaDXF, terrenoExemplo, pontosParaCSV,
} from '../src/terreno.js';

// Plano inclinado z = 0,1*e  -> curvas são retas verticais em e = z/0,1
const grade = [];
for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) grade.push({ id: `${i}-${j}`, e: i * 10, n: j * 10, z: 0.1 * i * 10 });

test('lê PNEZD com ponto e vírgula e vírgula decimal', () => {
  const { pontos, ignoradas } = lerPontos('P;N;E;Z;D\n1;8604000,5;512000,25;61,3;TN\n2;8604010;512010;62;TN\n');
  assert.equal(pontos.length, 2);
  assert.deepEqual(ignoradas, [1]); // cabeçalho
  assert.deepEqual(pontos[0], { id: '1', e: 512000.25, n: 8604000.5, z: 61.3 });
});

test('lê PENZ separado por vírgula', () => {
  const { pontos } = lerPontos('A,512000,8604000,10\nB,512001,8604002,11');
  assert.equal(pontos[1].id, 'B');
  assert.equal(pontos[1].e, 512001);
  assert.equal(pontos[1].n, 8604002);
});

test('lê E N Z separado por espaço e ignora comentários', () => {
  const { pontos } = lerPontos('# levantamento teste\n100 200 5.5\n101  201   6\n\nlixo\n');
  assert.equal(pontos.length, 2);
  assert.equal(pontos[0].z, 5.5);
});

test('ordem forçada NEZ', () => {
  const { pontos } = lerPontos('200;100;5', { ordem: 'NEZ' });
  assert.deepEqual([pontos[0].e, pontos[0].n], [100, 200]);
});

test('triangulação: grade 11x11 gera 200 triângulos', () => {
  assert.equal(triangular(grade).length / 3, 200);
});

test('triangulação exige 3 pontos', () => {
  assert.throws(() => triangular(grade.slice(0, 2)));
});

test('lado máximo remove triângulos longos', () => {
  const pts = [...grade, { id: 'longe', e: 500, n: 50, z: 0 }];
  const sem = triangular(pts).length;
  const com = triangular(pts, 20).length;
  assert.ok(com < sem);
  assert.equal(com / 3, 200);
});

test('sugerirLadoMax é proporcional ao espaçamento', () => {
  const L = sugerirLadoMax(grade);
  assert.ok(L >= 40 && L <= 60, `L=${L}`);
});

test('curvas de um plano inclinado são retas na posição exata', () => {
  const tri = triangular(grade);
  const curvas = curvasDeNivel(grade, tri, 2);
  assert.deepEqual(curvas.map((c) => c.cota), [2, 4, 6, 8, 10]); // 0 fica fora (nenhum ponto abaixo)
  for (const c of curvas) {
    assert.equal(c.linhas.length, 1, `cota ${c.cota} deve virar 1 polilinha`);
    for (const [e] of c.linhas[0]) assert.ok(Math.abs(e - c.cota / 0.1) < 1e-6);
  }
});

test('curva mestra a cada 5 intervalos', () => {
  const tri = triangular(grade);
  const curvas = curvasDeNivel(grade, tri, 1);
  assert.deepEqual(curvas.filter((c) => c.mestra).map((c) => c.cota), [5, 10]);
});

test('intervalo inválido gera erro', () => {
  assert.throws(() => curvasDeNivel(grade, triangular(grade), 0));
});

test('morro gera curvas fechadas', () => {
  const pts = [];
  for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) pts.push({ e: i, n: j, z: 100 - (i * i + j * j) });
  const curvas = curvasDeNivel(pts, triangular(pts), 10);
  const c = curvas.find((x) => x.cota === 50);
  assert.equal(c.linhas.length, 1);
  const l = c.linhas[0];
  assert.ok(Math.hypot(l[0][0] - l.at(-1)[0], l[0][1] - l.at(-1)[1]) < 1e-6, 'curva fechada');
});

test('unirSegmentos junta segmentos fora de ordem', () => {
  const linhas = unirSegmentos([[[1, 0], [2, 0]], [[0, 0], [1, 0]], [[3, 0], [2, 0]]]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].length, 4);
});

test('estatísticas: área e volume de um prisma conhecido', () => {
  const pts = [{ e: 0, n: 0, z: 2 }, { e: 10, n: 0, z: 2 }, { e: 10, n: 10, z: 2 }, { e: 0, n: 10, z: 2 }];
  const s = estatisticas(pts, triangular(pts), 0);
  assert.equal(s.area, 100);
  assert.equal(s.volumeAcima, 200);
  assert.equal(s.volumeAbaixo, 0);
});

test('DXF contém polilinhas com elevação e layers', () => {
  const tri = triangular(grade);
  const dxf = curvasParaDXF(curvasDeNivel(grade, tri, 1));
  assert.match(dxf, /POLYLINE\n8\nCURVA_MESTRA/);
  assert.match(dxf, /\n30\n5\.000\n/);
  assert.ok(dxf.trim().endsWith('EOF'));
});

test('terreno de exemplo é determinístico e plausível', () => {
  const a = terrenoExemplo(500), b = terrenoExemplo(500);
  assert.deepEqual(a, b);
  const z = a.map((p) => p.z);
  assert.ok(Math.min(...z) > 40 && Math.max(...z) < 100);
});

test('CSV exportado relê igual', () => {
  const pts = terrenoExemplo(50);
  const { pontos } = lerPontos(pontosParaCSV(pts));
  assert.equal(pontos.length, 50);
  assert.deepEqual(pontos[10], pts[10]);
});
