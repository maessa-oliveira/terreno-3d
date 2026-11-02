// Núcleo de cálculo do Terreno 3D — sem dependência de navegador (testado com `node --test`).
import Delaunator from 'delaunator';

/**
 * Lê pontos de um texto CSV/TXT. Aceita:
 *   - "P,N,E,Z,D" (padrão de coletora/Civil 3D, ordem informada em `ordem`)
 *   - "E;N;Z" com vírgula decimal
 *   - separadores ; , tab ou espaço; linhas de cabeçalho e comentários (#) são ignoradas
 * @param {string} texto
 * @param {{ordem?: 'ENZ'|'NEZ'|'PENZ'|'PNEZ'|'auto'}} [opcoes]
 * @returns {{pontos: {id:string,e:number,n:number,z:number}[], ignoradas:number[]}}
 */
export function lerPontos(texto, opcoes = {}) {
  const ordem = (opcoes.ordem || 'auto').toUpperCase();
  const linhas = texto.split(/\r?\n/);
  const pontos = [];
  const ignoradas = [];
  const sep = detectarSeparador(linhas.find((l) => l.trim() && !l.trim().startsWith('#')) || '');

  linhas.forEach((bruta, i) => {
    const l = bruta.trim();
    if (!l || l.startsWith('#')) return;
    const campos = l.split(sep).map((c) => c.trim()).filter((c) => c !== '');
    const nums = campos.map((c) => numero(c, sep));
    let r = null;
    const o = ordem === 'AUTO' ? adivinharOrdem(nums) : ordem;
    if (o) r = montar(o, campos, nums, pontos.length + 1);
    if (r && Number.isFinite(r.e) && Number.isFinite(r.n) && Number.isFinite(r.z)) pontos.push(r);
    else ignoradas.push(i + 1);
  });
  return { pontos, ignoradas };
}

function detectarSeparador(l) {
  if (l.includes(';')) return ';';
  if (l.includes('\t')) return '\t';
  // vírgula como separador só quando há >= 2 vírgulas (senão é decimal)
  if ((l.match(/,/g) || []).length >= 2) return ',';
  return /\s+/;
}

function numero(c, sep) {
  const t = sep === ',' ? c : c.replace(',', '.');
  return /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

function adivinharOrdem(nums) {
  const k = nums.filter(Number.isFinite).length;
  if (k < 3) return null;
  // Com 4+ números assume P,N,E,Z (formato PNEZD); com 3, E,N,Z.
  if (nums.length >= 4 && Number.isFinite(nums[0]) && Number.isFinite(nums[3])) {
    // Se o 2º valor parece um Norte (> 1.000.000) e o 3º um Leste, é PNEZ; senão PENZ.
    return Math.abs(nums[1]) > Math.abs(nums[2]) ? 'PNEZ' : 'PENZ';
  }
  if (nums.length >= 4 && !Number.isFinite(nums[0])) return Math.abs(nums[1]) > Math.abs(nums[2]) ? 'PNEZ' : 'PENZ';
  return 'ENZ';
}

function montar(o, campos, nums, seq) {
  switch (o) {
    case 'ENZ': return { id: String(seq), e: nums[0], n: nums[1], z: nums[2] };
    case 'NEZ': return { id: String(seq), e: nums[1], n: nums[0], z: nums[2] };
    case 'PENZ': return { id: campos[0], e: nums[1], n: nums[2], z: nums[3] };
    case 'PNEZ': return { id: campos[0], e: nums[2], n: nums[1], z: nums[3] };
    default: return null;
  }
}

/**
 * Triangulação de Delaunay com descarte de triângulos de lado muito longo
 * (evita "pontes" na borda côncava do levantamento).
 * @param {{e:number,n:number,z:number}[]} pontos
 * @param {number} [ladoMax] metros; 0/undefined = sem limite
 * @returns {Uint32Array} índices (3 por triângulo)
 */
export function triangular(pontos, ladoMax = 0) {
  if (pontos.length < 3) throw new Error('São necessários pelo menos 3 pontos.');
  const d = Delaunator.from(pontos, (p) => p.e, (p) => p.n);
  if (!ladoMax) return d.triangles;
  const out = [];
  const L2 = ladoMax * ladoMax;
  const t = d.triangles;
  for (let i = 0; i < t.length; i += 3) {
    const a = pontos[t[i]], b = pontos[t[i + 1]], c = pontos[t[i + 2]];
    if (d2(a, b) <= L2 && d2(b, c) <= L2 && d2(c, a) <= L2) out.push(t[i], t[i + 1], t[i + 2]);
  }
  return Uint32Array.from(out);
}

const d2 = (a, b) => (a.e - b.e) ** 2 + (a.n - b.n) ** 2;

/** Sugere o lado máximo: 4x a mediana dos comprimentos de aresta. */
export function sugerirLadoMax(pontos) {
  const t = Delaunator.from(pontos, (p) => p.e, (p) => p.n).triangles;
  const L = [];
  for (let i = 0; i < t.length; i += 3) L.push(Math.sqrt(d2(pontos[t[i]], pontos[t[i + 1]])));
  L.sort((a, b) => a - b);
  return L.length ? 4 * L[Math.floor(L.length / 2)] : 0;
}

/**
 * Curvas de nível por interpolação linear nos triângulos.
 * @returns {{cota:number, mestra:boolean, linhas:number[][][]}[]} cada linha = [[e,n],[e,n],...]
 */
export function curvasDeNivel(pontos, triangulos, intervalo, mestraCada = 5) {
  if (!(intervalo > 0)) throw new Error('Intervalo deve ser > 0.');
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pontos) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
  const primeira = Math.ceil(zmin / intervalo) * intervalo;
  const resultado = [];
  for (let c = primeira; c <= zmax + 1e-9; c += intervalo) {
    const cota = Math.round(c * 1e6) / 1e6;
    const segs = [];
    for (let i = 0; i < triangulos.length; i += 3) {
      const tri = [pontos[triangulos[i]], pontos[triangulos[i + 1]], pontos[triangulos[i + 2]]];
      const s = cortarTriangulo(tri, cota);
      if (s) segs.push(s);
    }
    if (segs.length) {
      const idx = Math.round(cota / intervalo);
      resultado.push({ cota, mestra: idx % mestraCada === 0, linhas: unirSegmentos(segs) });
    }
  }
  return resultado;
}

function cortarTriangulo(tri, c) {
  // Regra consistente: vértice com z >= c conta como "acima". Assim um vértice exatamente
  // na cota vira ponto da curva sem gerar segmentos duplicados entre triângulos vizinhos.
  const pts = [];
  for (let k = 0; k < 3; k++) {
    const a = tri[k], b = tri[(k + 1) % 3];
    const acimaA = a.z >= c, acimaB = b.z >= c;
    if (acimaA === acimaB) continue;
    // interpola sempre do vértice de baixo para o de cima (mesmo resultado nos dois triângulos da aresta)
    const [lo, hi] = acimaA ? [b, a] : [a, b];
    const t = (c - lo.z) / (hi.z - lo.z);
    pts.push([lo.e + t * (hi.e - lo.e), lo.n + t * (hi.n - lo.n)]);
  }
  if (pts.length !== 2) return null;
  if (Math.abs(pts[0][0] - pts[1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[1][1]) < 1e-9) return null;
  return pts;
}

/** Junta segmentos soltos em polilinhas contínuas. */
export function unirSegmentos(segs) {
  const chave = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const mapa = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = chave(p);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(i);
    }
  });
  const usado = new Uint8Array(segs.length);
  const linhas = [];
  const proximo = (p) => (mapa.get(chave(p)) || []).find((j) => !usado[j]);

  for (let i = 0; i < segs.length; i++) {
    if (usado[i]) continue;
    usado[i] = 1;
    const linha = [segs[i][0], segs[i][1]];
    for (const ponta of ['fim', 'inicio']) {
      for (;;) {
        const p = ponta === 'fim' ? linha[linha.length - 1] : linha[0];
        const j = proximo(p);
        if (j === undefined) break;
        usado[j] = 1;
        const [a, b] = segs[j];
        const novo = chave(a) === chave(p) ? b : a;
        if (ponta === 'fim') linha.push(novo); else linha.unshift(novo);
      }
    }
    linhas.push(linha);
  }
  return linhas;
}

/** Estatísticas do modelo: extremos, área plana triangulada e volume acima de uma cota de referência. */
export function estatisticas(pontos, triangulos, cotaRef = null) {
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pontos) { zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); }
  const ref = cotaRef ?? zmin;
  let area = 0, corte = 0, aterro = 0;
  for (let i = 0; i < triangulos.length; i += 3) {
    const a = pontos[triangulos[i]], b = pontos[triangulos[i + 1]], c = pontos[triangulos[i + 2]];
    const A = Math.abs((b.e - a.e) * (c.n - a.n) - (c.e - a.e) * (b.n - a.n)) / 2;
    area += A;
    // Prisma: volume = área * média das alturas (exato quando o plano não cruza a referência).
    const h = (a.z + b.z + c.z) / 3 - ref;
    if (h > 0) corte += A * h; else aterro += -A * h;
  }
  return { n: pontos.length, triangulos: triangulos.length / 3, zmin, zmax, area, volumeAcima: corte, volumeAbaixo: aterro, cotaRef: ref };
}

/** Exporta curvas de nível em DXF R12 (POLYLINE com elevação = cota; layers CURVA_MESTRA / CURVA_INTERMEDIARIA). */
export function curvasParaDXF(curvas) {
  const L = ['0', 'SECTION', '2', 'ENTITIES'];
  for (const c of curvas) {
    const layer = c.mestra ? 'CURVA_MESTRA' : 'CURVA_INTERMEDIARIA';
    for (const linha of c.linhas) {
      const fechada = linha.length > 3 && Math.hypot(linha[0][0] - linha.at(-1)[0], linha[0][1] - linha.at(-1)[1]) < 1e-3;
      L.push('0', 'POLYLINE', '8', layer, '66', '1', '10', '0', '20', '0', '30', c.cota.toFixed(3), '70', fechada ? '1' : '0');
      for (const [e, n] of fechada ? linha.slice(0, -1) : linha) {
        L.push('0', 'VERTEX', '8', layer, '10', e.toFixed(3), '20', n.toFixed(3), '30', c.cota.toFixed(3));
      }
      L.push('0', 'SEQEND', '8', layer);
    }
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\n') + '\n';
}

/**
 * Gera um terreno fictício (morros, vale e um talude) com pontos irregulares —
 * imita um levantamento de campo. Determinístico (semente fixa).
 */
export function terrenoExemplo(qtd = 2500, semente = 7) {
  let s = semente >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const E0 = 512000, N0 = 8604000, W = 600, H = 420;
  const pts = [];
  for (let i = 0; i < qtd; i++) {
    const x = rnd() * W, y = rnd() * H;
    // levantamento irregular: recorta um canto para borda côncava
    if (x > 470 && y > 300) { i--; continue; }
    const z =
      60 +
      18 * Math.exp(-((x - 170) ** 2 + (y - 260) ** 2) / 9000) +
      11 * Math.exp(-((x - 430) ** 2 + (y - 120) ** 2) / 6000) -
      9 * Math.exp(-((y - 0.35 * x - 40) ** 2) / 900) +
      0.012 * x +
      1.5 * Math.sin(x / 37) * Math.cos(y / 53) +
      (rnd() - 0.5) * 0.1;
    pts.push({ id: String(i + 1), e: +(E0 + x).toFixed(3), n: +(N0 + y).toFixed(3), z: +z.toFixed(3) });
  }
  return pts;
}

export function pontosParaCSV(pontos) {
  return 'P;N;E;Z;D\n' + pontos.map((p) => `${p.id};${p.n.toFixed(3)};${p.e.toFixed(3)};${p.z.toFixed(3)};TN`).join('\n') + '\n';
}
