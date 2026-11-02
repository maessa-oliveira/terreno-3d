// Interface 3D (three.js). Toda a geometria vem de ./terreno.js (testado em Node).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import {
  lerPontos, triangular, sugerirLadoMax, curvasDeNivel, estatisticas,
  curvasParaDXF, terrenoExemplo, pontosParaCSV,
} from './terreno.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, c = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });

// ---------- cena ----------
const cena = new THREE.Scene();
cena.background = new THREE.Color(0x0f1716);
cena.fog = new THREE.Fog(0x0f1716, 1500, 4000);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 10000);
const render = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
render.setPixelRatio(Math.min(devicePixelRatio, 2));
render.setSize(innerWidth, innerHeight);
$('cena').appendChild(render.domElement);
const controles = new OrbitControls(camera, render.domElement);
controles.enableDamping = true;
controles.autoRotateSpeed = 0.8;
controles.maxPolarAngle = Math.PI * 0.49;

cena.add(new THREE.HemisphereLight(0xdfeee8, 0x2a2219, 1.1));
const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.position.set(-1, 1.4, -0.6);
cena.add(sol);

const grupo = new THREE.Group();
cena.add(grupo);

// ---------- estado ----------
const estado = { pontos: [], nome: '', tri: null, curvas: [], origem: { e: 0, n: 0, z: 0 } };

// Rampa hipsométrica (verde → amarelo → marrom → claro)
const RAMPA = [[0, 0x2f6b4f], [0.3, 0x6f9d4a], [0.55, 0xd8c370], [0.8, 0x9b6b43], [1, 0xefe9df]].map(([t, c]) => [t, new THREE.Color(c)]);
function cor(t) {
  for (let i = 1; i < RAMPA.length; i++) {
    if (t <= RAMPA[i][0]) {
      const [t0, c0] = RAMPA[i - 1], [t1, c1] = RAMPA[i];
      return c0.clone().lerp(c1, (t - t0) / (t1 - t0));
    }
  }
  return RAMPA.at(-1)[1].clone();
}
$('legenda').style.background = `linear-gradient(to top, ${RAMPA.map(([t, c]) => `#${c.getHexString()} ${t * 100}%`).join(',')})`;

function mensagem(txt, erro = false) {
  $('msg').textContent = txt;
  $('msg').classList.toggle('erro', erro);
}

// ---------- montagem ----------
function carregar(pontos, nome) {
  if (pontos.length < 3) { mensagem('Arquivo sem pontos suficientes (mínimo 3).', true); return; }
  estado.pontos = pontos;
  estado.nome = nome;
  const e = pontos.reduce((s, p) => s + p.e, 0) / pontos.length;
  const n = pontos.reduce((s, p) => s + p.n, 0) / pontos.length;
  const z = Math.min(...pontos.map((p) => p.z));
  estado.origem = { e, n, z };
  $('lado').value = 0;
  reconstruir(true);
}

function ladoMax() {
  const v = Number($('lado').value);
  if (v > 0) { $('oLado').textContent = `${v} m`; return v; }
  const auto = sugerirLadoMax(estado.pontos);
  $('oLado').textContent = `auto (${fmt(auto, 0)} m)`;
  return auto;
}

function reconstruir(enquadrar = false) {
  if (!estado.pontos.length) return;
  const t0 = performance.now();
  try {
    estado.tri = triangular(estado.pontos, ladoMax());
  } catch (err) { mensagem(err.message, true); return; }
  desenhar();
  if (enquadrar) enquadrarCamera();
  const ms = performance.now() - t0;
  mensagem(`${estado.nome}: ${estado.pontos.length.toLocaleString('pt-BR')} pontos processados em ${fmt(ms, 0)} ms.`);
}

function limpar() {
  for (const o of [...grupo.children]) { o.geometry?.dispose(); o.material?.dispose(); grupo.remove(o); }
}

function desenhar() {
  limpar();
  const { pontos, tri, origem } = estado;
  const ex = Number($('exagero').value);
  const intervalo = Number($('intervalo').value);
  $('oExagero').textContent = `${fmt(ex, 1)}×`;
  $('oIntervalo').textContent = `${fmt(intervalo, intervalo % 1 ? 2 : 0)} m`;

  const zs = pontos.map((p) => p.z);
  const zmin = Math.min(...zs), zmax = Math.max(...zs), dz = zmax - zmin || 1;
  const pos = new Float32Array(pontos.length * 3);
  const cores = new Float32Array(pontos.length * 3);
  pontos.forEach((p, i) => {
    pos.set([p.e - origem.e, (p.z - origem.z) * ex, -(p.n - origem.n)], i * 3);
    const c = cor((p.z - zmin) / dz);
    cores.set([c.r, c.g, c.b], i * 3);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  geo.setIndex(new THREE.BufferAttribute(tri, 1));
  geo.computeVertexNormals();
  grupo.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  if ($('vMalha').checked) {
    grupo.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x0b1110, transparent: true, opacity: 0.35 })));
  }
  if ($('vPontos').checked) {
    grupo.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false })));
  }

  estado.curvas = curvasDeNivel(pontos, tri, intervalo);
  if ($('vCurvas').checked) {
    const segs = { true: [], false: [] };
    const elev = 0.08 * ex; // levemente acima da superfície
    for (const c of estado.curvas) {
      const y = (c.cota - origem.z) * ex + elev;
      for (const l of c.linhas) {
        for (let i = 1; i < l.length; i++) {
          segs[c.mestra].push(l[i - 1][0] - origem.e, y, -(l[i - 1][1] - origem.n), l[i][0] - origem.e, y, -(l[i][1] - origem.n));
        }
      }
    }
    for (const mestra of [false, true]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs[mestra], 3));
      grupo.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: mestra ? 0x3b2410 : 0x5a3d22, transparent: true, opacity: mestra ? 0.95 : 0.55,
      })));
    }
  }

  const s = estatisticas(pontos, tri);
  const nCurvas = estado.curvas.reduce((k, c) => k + c.linhas.length, 0);
  $('stats').innerHTML = `
    <dt>Pontos</dt><dd>${s.n.toLocaleString('pt-BR')}</dd>
    <dt>Triângulos</dt><dd>${s.triangulos.toLocaleString('pt-BR')}</dd>
    <dt>Cota mín. / máx.</dt><dd>${fmt(s.zmin)} / ${fmt(s.zmax)} m</dd>
    <dt>Desnível</dt><dd>${fmt(s.zmax - s.zmin)} m</dd>
    <dt>Área (plana)</dt><dd>${fmt(s.area / 10000, 3)} ha</dd>
    <dt>Volume acima da mín.</dt><dd>${fmt(s.volumeAcima, 0)} m³</dd>
    <dt>Curvas de nível</dt><dd>${estado.curvas.length} cotas · ${nCurvas} linhas</dd>`;
  $('legenda').dataset.max = `${fmt(zmax, 1)} m`;
  $('legenda').dataset.min = `${fmt(zmin, 1)} m`;
  $('btnDXF').disabled = !estado.curvas.length;
}

function enquadrarCamera() {
  const caixa = new THREE.Box3().setFromObject(grupo);
  const centro = caixa.getCenter(new THREE.Vector3());
  const tam = caixa.getSize(new THREE.Vector3()).length();
  controles.target.copy(centro);
  camera.position.copy(centro).add(new THREE.Vector3(-0.5, 0.5, 0.7).multiplyScalar(tam * (camera.aspect < 1 ? 1.7 : 0.95)));
  camera.near = tam / 200; camera.far = tam * 20; camera.updateProjectionMatrix();
  cena.fog.near = tam * 1.5; cena.fog.far = tam * 5;
}

// ---------- arquivos ----------
async function abrirArquivo(arquivo) {
  if (!arquivo) return;
  const texto = await arquivo.text();
  const { pontos, ignoradas } = lerPontos(texto, { ordem: $('ordem').value });
  carregar(pontos, arquivo.name);
  if (ignoradas.length) mensagem(`${$('msg').textContent} ${ignoradas.length} linha(s) ignorada(s) (cabeçalho ou texto).`);
}

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const base = () => estado.nome.replace(/\.[^.]+$/, '') || 'terreno';

$('arquivo').addEventListener('change', (e) => abrirArquivo(e.target.files[0]));
const zona = $('soltar');
for (const ev of ['dragenter', 'dragover']) addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('ativo'); });
for (const ev of ['dragleave', 'drop']) addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('ativo'); });
addEventListener('drop', (e) => abrirArquivo(e.dataTransfer.files[0]));
$('btnExemplo').addEventListener('click', () => carregar(terrenoExemplo(), 'terreno-exemplo (fictício)'));
$('btnDXF').addEventListener('click', () => baixar(`${base()}_curvas.dxf`, curvasParaDXF(estado.curvas), 'application/dxf'));
$('btnCSV').addEventListener('click', () => baixar(`${base()}_pontos.csv`, pontosParaCSV(estado.pontos), 'text/csv'));
$('ordem').addEventListener('change', () => $('arquivo').files[0] && abrirArquivo($('arquivo').files[0]));

for (const id of ['exagero', 'intervalo', 'vCurvas', 'vMalha', 'vPontos']) $(id).addEventListener('input', () => estado.tri && desenhar());
$('lado').addEventListener('input', () => reconstruir());
$('vGirar').addEventListener('change', () => { controles.autoRotate = $('vGirar').checked; });
controles.autoRotate = $('vGirar').checked;

// Desloca o centro da imagem para a área livre ao lado (ou acima) do painel.
function ajustarTela() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  const painel = $('painel').getBoundingClientRect();
  if (w > 720) camera.setViewOffset(w, h, -(painel.right) / 2, 0, w, h);
  else camera.setViewOffset(w, h, 0, (h - painel.top) / 2, w, h);
  camera.updateProjectionMatrix();
  render.setSize(w, h);
}
addEventListener('resize', ajustarTela);
ajustarTela();

const bussola = $('bussola');
(function animar() {
  requestAnimationFrame(animar);
  controles.update();
  // bússola: ângulo do norte (-Z do mundo) na tela
  const az = Math.atan2(camera.position.x - controles.target.x, camera.position.z - controles.target.z);
  bussola.style.transform = `rotate(${az}rad)`;
  render.render(cena, camera);
})();

// Abre já com o exemplo (permite ?exemplo=0 para começar vazio)
if (new URLSearchParams(location.search).get('exemplo') !== '0') carregar(terrenoExemplo(), 'terreno-exemplo (fictício)');
window.__terreno = estado; // usado pelos testes de ponta a ponta
// gira a câmera em torno do alvo (usado para gravar o GIF de demonstração)
window.__girar = (ang) => {
  const v = camera.position.clone().sub(controles.target);
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
  camera.position.copy(controles.target).add(v);
  controles.update();
  render.render(cena, camera);
};
