// Diseño del archivo de origen (EPUB o Word): letra, sangría, interlineado, espacio entre párrafos,
// alineación y títulos, y las fuentes que trae el EPUB. Lo usa la conversión sencilla para que el
// EPUB nuevo se parezca al original sin tener que elegir un tema.

import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import type { Tema } from './model.js';
import { claveOfuscacion, ofuscarFuente } from './compilar.js';
import { resolverRuta } from './formatos/epub.js';

export interface FuenteOriginal {
  familia: string;
  nombre: string;
  datos: Uint8Array;
}

export interface DisenoOriginal {
  tema: Partial<Tema>;
  familiaTexto?: string;
  familiaTitulos?: string;
  fuentes: FuenteOriginal[];
  avisos: string[];
}

const GENERICAS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', 'ui-serif', 'ui-sans-serif']);

export function primeraFamilia(valor?: string): string | undefined {
  if (!valor) return undefined;
  for (const f of valor.split(',')) {
    const n = f.trim().replace(/^["']|["']$/g, '').trim();
    if (n && !GENERICAS.has(n.toLowerCase())) return n;
  }
  return undefined;
}

/** Valor CSS de longitud en em (16 px = 1 em, 12 pt = 1 em). */
function enEm(v?: string): number | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(-?\d*\.?\d+)(em|rem|px|pt|%)?$/i);
  if (!m) return v.trim() === '0' ? 0 : undefined;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'em':
    case 'rem':
      return n;
    case 'px':
      return n / 16;
    case 'pt':
      return n / 12;
    case '':
      return n === 0 ? 0 : undefined;
    default:
      return undefined;
  }
}

function interlineado(v?: string): number | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (t === 'normal') return 1.2;
  const m = t.match(/^(\d*\.?\d+)(em|%|px|pt)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const r = !m[2] || m[2] === 'em' ? n : m[2] === '%' ? n / 100 : m[2] === 'px' ? n / 16 : n / 12;
  return Math.min(2.2, Math.max(1.1, Math.round(r * 100) / 100));
}

function colorHex(v?: string): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + [...t.slice(1)].map((c) => c + c).join('');
  const m = t.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  return { black: '#000000', white: '#ffffff' }[t];
}

interface Regla {
  selector: string;
  decl: Record<string, string>;
}

function reglas(css: string): Regla[] {
  const sin = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const salida: Regla[] = [];
  for (const m of sin.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl: Record<string, string> = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).replace(/!important/i, '').trim();
    }
    for (const sel of m[1].split(',')) salida.push({ selector: sel.trim(), decl });
  }
  return salida;
}

/** Declaraciones que afectan a un elemento con esa etiqueta y clases (aproximado: selectores simples). */
function estiloDe(rs: Regla[], etiqueta: string, clases: string[]): Record<string, string> {
  const r: Record<string, string> = {};
  const simples = (sel: string) => {
    const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i);
    if (!m) return false;
    const et = m[1].toLowerCase();
    const cl = m[2].split('.').filter(Boolean);
    return (!et || et === etiqueta) && cl.every((c) => clases.includes(c)) && (et || cl.length > 0);
  };
  // Orden: body, luego la etiqueta, luego clases (más específico después).
  const aplicables = rs.filter((x) => x.selector.toLowerCase() === 'body' || x.selector.toLowerCase() === 'html' || simples(x.selector));
  aplicables.sort((a, b) => peso(a.selector) - peso(b.selector));
  for (const x of aplicables) Object.assign(r, x.decl);
  return r;
}

function peso(sel: string): number {
  const s = sel.toLowerCase();
  if (s === 'html') return 0;
  if (s === 'body') return 1;
  return 2 + (sel.match(/\./g) ?? []).length * 10 + (/^[a-z]/i.test(sel) ? 1 : 0);
}

function margenesParrafo(e: Record<string, string>): number | undefined {
  let arriba = enEm(e['margin-top']);
  let abajo = enEm(e['margin-bottom']);
  if (e.margin) {
    const partes = e.margin.split(/\s+/);
    arriba ??= enEm(partes[0]);
    abajo ??= enEm(partes[2] ?? partes[0]);
  }
  if (arriba === undefined && abajo === undefined) return undefined;
  return Math.min(2, Math.max(0, Math.round(Math.max(arriba ?? 0, abajo ?? 0) * 100) / 100));
}

/** Tema a partir del CSS de un EPUB y de la clase de párrafo más usada en sus XHTML. */
export function temaDeCss(css: string, xhtmls: string[]): { tema: Partial<Tema>; familiaTexto?: string; familiaTitulos?: string } {
  const rs = reglas(css);
  const cuentas = new Map<string, number>();
  for (const x of xhtmls) {
    for (const m of x.matchAll(/<p\b([^>]*)>/g)) {
      const clase = m[1].match(/\bclass\s*=\s*["']([^"']*)["']/)?.[1].trim() ?? '';
      cuentas.set(clase, (cuentas.get(clase) ?? 0) + 1);
    }
  }
  const dominante = [...cuentas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const p = estiloDe(rs, 'p', dominante.split(/\s+/).filter(Boolean));
  // Títulos: los h1 o, si el libro no los usa, los h2 (Sigil y Calibre usan mucho h2 con clase).
  // Se toma el primer título que aparece en el libro (sin contar la navegación).
  const primero = xhtmls
    .filter((x) => !/<nav\b/.test(x))
    .map((x) => x.match(/<(h[12])\b([^>]*)>/))
    .find(Boolean);
  const titulo = primero?.[1] ?? 'h1';
  const claseTitulo = primero?.[2].match(/\bclass\s*=\s*["']([^"']*)["']/)?.[1] ?? '';
  const h = estiloDe(rs, titulo, claseTitulo.split(/\s+/).filter(Boolean));
  const tema: Partial<Tema> = {};
  const sangria = enEm(p['text-indent']);
  if (sangria !== undefined) tema.sangria = Math.min(4, Math.max(0, Math.round(sangria * 100) / 100));
  const li = interlineado(p['line-height']);
  if (li !== undefined) tema.interlineado = li;
  const esp = margenesParrafo(p);
  if (esp !== undefined) tema.espacioParrafos = esp;
  const al = (p['text-align'] ?? '').toLowerCase();
  if (al === 'justify') tema.alinear = 'justificado';
  else if (al === 'left' || al === 'start') tema.alinear = 'izquierda';
  const alh = (h['text-align'] ?? '').toLowerCase();
  if (alh === 'left' || alh === 'start') tema.tituloEstilo = 'izquierda';
  else if (alh === 'center') tema.tituloEstilo = 'centrado';
  const color = colorHex(h.color);
  if (color) tema.colorTitulos = color;
  if (/small-caps/i.test(h['font-variant'] ?? '') || /uppercase/i.test(h['text-transform'] ?? '')) tema.tituloMayusculas = true;
  return { tema, familiaTexto: primeraFamilia(p['font-family']), familiaTitulos: primeraFamilia(h['font-family']) };
}

/** WOFF 1.0 → TrueType/OpenType (las tablas van comprimidas con zlib). */
export function woffASfnt(d: Uint8Array): Uint8Array | undefined {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (d.length < 44 || v.getUint32(0) !== 0x774f4646) return undefined;
  const sabor = v.getUint32(4);
  const n = v.getUint16(12);
  const tablas: { tag: number; datos: Uint8Array; suma: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = 44 + i * 20;
    const desde = v.getUint32(p + 4);
    const comp = v.getUint32(p + 8);
    const orig = v.getUint32(p + 12);
    const crudo = d.subarray(desde, desde + comp);
    tablas.push({ tag: v.getUint32(p), datos: comp < orig ? new Uint8Array(inflateSync(crudo)) : crudo.slice(), suma: v.getUint32(p + 16) });
  }
  let largo = 12 + 16 * n;
  for (const t of tablas) largo += (t.datos.length + 3) & ~3;
  const salida = new Uint8Array(largo);
  const w = new DataView(salida.buffer);
  const pot = 2 ** Math.floor(Math.log2(Math.max(1, n)));
  w.setUint32(0, sabor);
  w.setUint16(4, n);
  w.setUint16(6, pot * 16);
  w.setUint16(8, Math.log2(pot));
  w.setUint16(10, n * 16 - pot * 16);
  let pos = 12 + 16 * n;
  tablas.forEach((t, i) => {
    const e = 12 + i * 16;
    w.setUint32(e, t.tag);
    w.setUint32(e + 4, t.suma);
    w.setUint32(e + 8, pos);
    w.setUint32(e + 12, t.datos.length);
    salida.set(t.datos, pos);
    pos += (t.datos.length + 3) & ~3;
  });
  return salida;
}

/** Diseño de un EPUB: tema, familias y fuentes incrustadas (desofuscadas si usan el algoritmo del IDPF). */
export async function disenoDeEpub(datos: Uint8Array): Promise<DisenoOriginal> {
  const zip = await JSZip.loadAsync(datos);
  const avisos: string[] = [];
  const leer = async (r: string) => zip.file(r)?.async('string');
  const contenedor = (await leer('META-INF/container.xml')) ?? '';
  const rutaOpf = contenedor.match(/full-path\s*=\s*["']([^"']+)["']/)?.[1] ?? '';
  const opf = (await leer(rutaOpf)) ?? '';
  const items = [...opf.matchAll(/<item\b[^>]*>/g)].map((m) => ({
    href: m[0].match(/\bhref\s*=\s*["']([^"']+)["']/)?.[1] ?? '',
    tipo: m[0].match(/\bmedia-type\s*=\s*["']([^"']+)["']/)?.[1] ?? '',
  }));
  const hojas: string[] = [];
  const xhtmls: string[] = [];
  for (const it of items) {
    const ruta = resolverRuta(rutaOpf, it.href);
    if (it.tipo === 'text/css') hojas.push((await leer(ruta)) ?? '');
    else if (it.tipo === 'application/xhtml+xml') xhtmls.push((await leer(ruta)) ?? '');
  }
  const css = hojas.join('\n');
  const { tema, familiaTexto, familiaTitulos } = temaDeCss(css, xhtmls);

  // Fuentes: familia según los @font-face que las citan.
  const familiaDe = new Map<string, string>();
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const fam = primeraFamilia(m[1].match(/font-family\s*:\s*([^;]+)/i)?.[1]);
    for (const u of m[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) if (fam) familiaDe.set(u[1].split('/').pop()!.toLowerCase(), fam);
  }
  const identificadorUnico = (() => {
    const id = opf.match(/unique-identifier\s*=\s*["']([^"']+)["']/)?.[1];
    const re = id ? new RegExp(`<dc:identifier[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>([^<]*)<`) : /<dc:identifier[^>]*>([^<]*)</;
    return opf.match(re)?.[1].trim() ?? '';
  })();
  const cifrado = (await leer('META-INF/encryption.xml')) ?? '';
  const fuentes: FuenteOriginal[] = [];
  for (const [ruta, f] of Object.entries(zip.files)) {
    if (f.dir || !/\.(ttf|otf|woff)$/i.test(ruta)) continue;
    let d: Uint8Array | undefined = await f.async('uint8array');
    const entrada = [...cifrado.matchAll(/<(?:enc:)?EncryptedData\b[\s\S]*?<\/(?:enc:)?EncryptedData>/g)].map((x) => x[0]).find((x) => x.includes(`URI="${ruta}"`));
    if (entrada) {
      if (entrada.includes('http://www.idpf.org/2008/embedding')) d = ofuscarFuente(d, claveOfuscacion(identificadorUnico));
      else {
        avisos.push(`La fuente «${ruta.split('/').pop()}» está protegida de una forma que no se puede leer; se usará otra.`);
        continue;
      }
    }
    if (/\.woff$/i.test(ruta)) d = woffASfnt(d);
    if (!d) continue;
    const nombre = ruta.split('/').pop()!;
    fuentes.push({ familia: familiaDe.get(nombre.toLowerCase()) ?? '', nombre, datos: d });
  }
  return { tema, familiaTexto, familiaTitulos, fuentes, avisos };
}

function atributo(xml: string, etiqueta: string, attr: string): string | undefined {
  return xml.match(new RegExp(`<w:${etiqueta}\\b[^>]*\\bw:${attr}="([^"]*)"`))?.[1];
}

/** Diseño de un Word: el estilo Normal (letra, sangría, interlineado, espacio, alineación) y Título 1. */
export async function disenoDeDocx(datos: Uint8Array): Promise<DisenoOriginal> {
  const zip = await JSZip.loadAsync(datos);
  const estilos = (await zip.file('word/styles.xml')?.async('string')) ?? '';
  const defecto = estilos.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? '';
  const estilo = (id: string) => estilos.match(new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0] ?? '';
  const normal = estilo('Normal');
  const titulo = estilo('Heading1') || estilo('Ttulo1') || estilo('Titulo1');
  const de = (xml: string, et: string, a: string) => atributo(xml, et, a);
  const tamano = Number(de(normal, 'sz', 'val') ?? de(defecto, 'sz', 'val') ?? 24) / 2; // medios puntos → pt
  const tema: Partial<Tema> = {};
  const primera = de(normal, 'ind', 'firstLine') ?? de(defecto, 'ind', 'firstLine');
  if (primera !== undefined) tema.sangria = Math.min(4, Math.max(0, Math.round((Number(primera) / 20 / tamano) * 100) / 100));
  const linea = de(normal, 'spacing', 'line') ?? de(defecto, 'spacing', 'line');
  const regla = de(normal, 'spacing', 'lineRule') ?? de(defecto, 'spacing', 'lineRule') ?? 'auto';
  if (linea && regla === 'auto') tema.interlineado = Math.min(2.2, Math.max(1.1, Math.round((Number(linea) / 240) * 1.15 * 100) / 100));
  const despues = de(normal, 'spacing', 'after') ?? de(defecto, 'spacing', 'after');
  if (despues !== undefined) tema.espacioParrafos = Math.min(2, Math.max(0, Math.round((Number(despues) / 20 / tamano) * 100) / 100));
  const jc = de(normal, 'jc', 'val');
  if (jc === 'both' || jc === 'distribute') tema.alinear = 'justificado';
  else if (jc === 'left' || jc === 'start') tema.alinear = 'izquierda';
  const jch = de(titulo, 'jc', 'val');
  if (jch === 'center') tema.tituloEstilo = 'centrado';
  else if (jch === 'left' || jch === 'start') tema.tituloEstilo = 'izquierda';
  const color = de(titulo, 'color', 'val');
  if (color && /^[0-9a-f]{6}$/i.test(color)) tema.colorTitulos = `#${color.toLowerCase()}`;
  const familiaTexto = de(normal, 'rFonts', 'ascii') ?? de(defecto, 'rFonts', 'ascii');
  const familiaTitulos = de(titulo, 'rFonts', 'ascii');
  return { tema, familiaTexto: primeraFamilia(familiaTexto), familiaTitulos: primeraFamilia(familiaTitulos), fuentes: [], avisos: [] };
}
