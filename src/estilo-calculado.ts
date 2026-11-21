// Cascada CSS reducida para leer el diseño de un EPUB ajeno: selectores simples y de descendiente,
// especificidad, herencia de las propiedades de texto y tamaños relativos. No pretende ser un navegador:
// basta para saber qué sangría, márgenes, tamaño, color o letra tiene cada párrafo.

import { ELEMENTO, attr, clases, nombre, type Nodo } from './formatos/dom.js';

export interface Regla {
  selector: string;
  decl: Record<string, string>;
  /** [ids, clases, etiquetas] */
  especificidad: [number, number, number];
  orden: number;
  /** Pseudo-elemento (first-letter, first-line) si lo tiene. */
  pseudo?: string;
}

export interface Hoja {
  reglas: Regla[];
  /** Píxeles por em del texto (16 o el tamaño de html/body en px). */
  base: number;
  /** Medidas que no se pudieron pasar a em (vh, vw…). */
  ignoradas: Set<string>;
}

const HEREDADAS = new Set([
  'font-family',
  'font-style',
  'font-weight',
  'font-variant',
  'font-variant-caps',
  'color',
  'line-height',
  'text-align',
  'text-indent',
  'letter-spacing',
  'word-spacing',
  'text-transform',
]);

function declaraciones(texto: string): Record<string, string> {
  const decl: Record<string, string> = {};
  for (const d of texto.split(';')) {
    const i = d.indexOf(':');
    if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).replace(/!important/i, '').trim();
  }
  // Atajos: margin y font.
  if (decl.margin) {
    const p = decl.margin.split(/\s+/);
    const [a, d = a, b = a, i = d] = p;
    decl['margin-top'] ??= a;
    decl['margin-right'] ??= d;
    decl['margin-bottom'] ??= b;
    decl['margin-left'] ??= i;
  }
  return decl;
}

function especificidad(sel: string): [number, number, number] {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (sel.replace(/::?[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, cls, tags];
}

export function hojaDeCss(css: string): Hoja {
  const sin = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas: Regla[] = [];
  let orden = 0;
  for (const m of sin.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    const decl = declaraciones(m[2]);
    for (const s of sel.split(',')) {
      const t = s.trim();
      if (!t || t.startsWith('@')) continue;
      const pseudo = t.match(/::?(first-letter|first-line)\s*$/i)?.[1].toLowerCase();
      reglas.push({ selector: pseudo ? t.replace(/::?(first-letter|first-line)\s*$/i, '').trim() : t, decl, especificidad: especificidad(t), orden: orden++, ...(pseudo ? { pseudo } : {}) });
    }
  }
  const hoja: Hoja = { reglas, base: 16, ignoradas: new Set() };
  // Tamaño base: el de html o body en px (o pt).
  for (const r of reglas) {
    if (!/^(html|body|:root)$/i.test(r.selector) || !r.decl['font-size']) continue;
    const m = r.decl['font-size'].match(/^(\d*\.?\d+)(px|pt)$/i);
    if (m) hoja.base = m[2].toLowerCase() === 'px' ? parseFloat(m[1]) : (parseFloat(m[1]) * 4) / 3;
  }
  return hoja;
}

/** ¿Encaja el nodo con un selector compuesto simple (etiqueta, .clase, #id; atributos y pseudoclases se ignoran)? */
function encajaSimple(n: Nodo, sel: string): boolean {
  const limpio = sel.replace(/\[[^\]]*\]/g, '').replace(/:[\w-]+(\([^)]*\))?/g, '');
  const m = limpio.match(/^([a-z*][\w-]*)?((?:[.#][\w-]+)*)$/i);
  if (!m) return false;
  const et = m[1]?.toLowerCase();
  if (et && et !== '*' && et !== nombre(n)) return false;
  const partes = m[2].match(/[.#][\w-]+/g) ?? [];
  const cls = clases(n);
  for (const p of partes) {
    if (p[0] === '.' && !cls.includes(p.slice(1))) return false;
    if (p[0] === '#' && attr(n, 'id') !== p.slice(1)) return false;
  }
  return !!(et || partes.length);
}

function padre(n: Nodo): Nodo | undefined {
  const p = n.parentNode;
  return p && p.nodeType === ELEMENTO ? p : undefined;
}

/** Selectores con descendiente ( ) e hijo (>); los de hermanos (+, ~) solo para «h1 + p». */
export function encaja(n: Nodo, selector: string): boolean {
  const partes = selector.trim().split(/\s*(>|\+|~)\s*|\s+/).filter((x) => x !== undefined && x !== '');
  if (!partes.length) return false;
  let k = partes.length - 1;
  if (!encajaSimple(n, partes[k])) return false;
  let actual: Nodo | undefined = n;
  k--;
  while (k >= 0) {
    const comb = partes[k] === '>' || partes[k] === '+' || partes[k] === '~' ? partes[k--] : ' ';
    const sel = partes[k--];
    if (!sel) return false;
    if (comb === '>') {
      actual = padre(actual!);
      if (!actual || !encajaSimple(actual, sel)) return false;
    } else if (comb === '+' || comb === '~') {
      let h = anterior(actual!);
      if (comb === '~') while (h && !encajaSimple(h, sel)) h = anterior(h);
      if (!h || !encajaSimple(h, sel)) return false;
      actual = h;
    } else {
      let a = padre(actual!);
      while (a && !encajaSimple(a, sel)) a = padre(a);
      if (!a) return false;
      actual = a;
    }
  }
  return true;
}

function anterior(n: Nodo): Nodo | undefined {
  const p = n.parentNode;
  if (!p) return undefined;
  const hs = Array.from(p.childNodes).filter((x) => x.nodeType === ELEMENTO);
  const i = hs.indexOf(n);
  return i > 0 ? hs[i - 1] : undefined;
}

function comparar(a: Regla, b: Regla): number {
  for (let i = 0; i < 3; i++) if (a.especificidad[i] !== b.especificidad[i]) return a.especificidad[i] - b.especificidad[i];
  return a.orden - b.orden;
}

/** Declaraciones propias del nodo (reglas que encajan + atributo style), sin herencia. */
export function propias(hoja: Hoja, n: Nodo, pseudo?: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const x of hoja.reglas.filter((x) => (x.pseudo ?? undefined) === pseudo && encaja(n, x.selector)).sort(comparar)) Object.assign(r, x.decl);
  if (!pseudo) {
    const st = attr(n, 'style');
    if (st) Object.assign(r, declaraciones(st));
  }
  return r;
}

/** Longitud CSS en em del contexto (`em` = tamaño del elemento); `ancho` para los porcentajes (en em). */
export function longitud(hoja: Hoja, v: string | undefined, tamano = 1, ancho = 30): number | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (t === '0' || t === 'auto' || t === 'none' || t === 'normal') return t === '0' ? 0 : undefined;
  const m = t.match(/^(-?\d*\.?\d+)(em|rem|px|pt|%|ex|ch|vh|vw|cm|mm|in)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'em':
      return n * tamano;
    case 'rem':
      return n;
    case 'px':
      return n / hoja.base;
    case 'pt':
      return (n * 4) / 3 / hoja.base;
    case '%':
      return (n / 100) * ancho;
    case 'ex':
    case 'ch':
      return n * 0.5 * tamano;
    case 'cm':
      return (n * 96) / 2.54 / hoja.base;
    case 'mm':
      return (n * 9.6) / 2.54 / hoja.base;
    case 'in':
      return (n * 96) / hoja.base;
    case undefined:
      return n === 0 ? 0 : undefined;
    default:
      hoja.ignoradas.add(m[2]);
      return undefined;
  }
}

/** Tamaño de letra nuevo (em del texto) a partir del del padre. */
function nuevoTamano(hoja: Hoja, v: string | undefined, padreTam: number): number {
  if (!v) return padreTam;
  const t = v.trim().toLowerCase();
  const palabras: Record<string, number> = { 'xx-small': 0.6, 'x-small': 0.75, small: 0.89, medium: 1, large: 1.2, 'x-large': 1.5, 'xx-large': 2, smaller: padreTam * 0.83, larger: padreTam * 1.2 };
  if (t in palabras) return t === 'smaller' || t === 'larger' ? palabras[t] : palabras[t];
  if (t.endsWith('%')) return (parseFloat(t) / 100) * padreTam;
  if (t.endsWith('em') && !t.endsWith('rem')) return parseFloat(t) * padreTam;
  const l = longitud(hoja, t, padreTam);
  return l ?? padreTam;
}

const TAMANO_ETIQUETA: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67, small: 0.83 };

export interface Calculado {
  /** Declaraciones heredadas + propias (valores CSS tal cual). */
  decl: Record<string, string>;
  /** Tamaño de letra en em del texto del libro. */
  tamano: number;
}

/** Estilo calculado del nodo: herencia desde la raíz y tamaño de letra acumulado. */
export function calcular(hoja: Hoja, n: Nodo, cache = new Map<Nodo, Calculado>()): Calculado {
  const c = cache.get(n);
  if (c) return c;
  const p = padre(n);
  const base: Calculado = p ? calcular(hoja, p, cache) : { decl: {}, tamano: 1 };
  const decl: Record<string, string> = {};
  for (const [k, v] of Object.entries(base.decl)) if (HEREDADAS.has(k)) decl[k] = v;
  const pr = propias(hoja, n);
  Object.assign(decl, pr);
  const et = nombre(n);
  const tamano = pr['font-size'] ? nuevoTamano(hoja, pr['font-size'], base.tamano) : base.tamano * (TAMANO_ETIQUETA[et] ?? 1);
  const r = { decl, tamano };
  cache.set(n, r);
  return r;
}

/** Lo que importa del aspecto de un párrafo: tamaño en em del texto del libro y medidas en em del propio párrafo. */
export interface FirmaParrafo {
  sangria: number;
  alinear: 'izquierda' | 'centro' | 'derecha' | 'justificado';
  arriba: number;
  abajo: number;
  izquierda: number;
  derecha: number;
  interlineado?: number;
  tamano: number;
  cursiva: boolean;
  negrita: boolean;
  versalitas: boolean;
  mayusculas: boolean;
  color?: string;
  familia?: string;
  letras?: number;
  palabras?: number;
}

function hex(v?: string): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + [...t.slice(1)].map((x) => x + x).join('');
  const m = t.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  return ({ black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', gray: '#808080', grey: '#808080', navy: '#000080', maroon: '#800000' } as Record<string, string>)[t];
}

export function familia(v?: string): string | undefined {
  if (!v) return undefined;
  const genericas = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', 'ui-serif', 'ui-sans-serif']);
  for (const f of v.split(',')) {
    const x = f.trim().replace(/^["']|["']$/g, '').trim();
    if (x && !genericas.has(x.toLowerCase())) return x;
  }
  return undefined;
}

export function firmaParrafo(hoja: Hoja, n: Nodo, cache = new Map<Nodo, Calculado>()): FirmaParrafo {
  const { decl: d, tamano } = calcular(hoja, n, cache);
  const al = (d['text-align'] ?? '').toLowerCase();
  const li = d['line-height'];
  let interlineado: number | undefined;
  if (li) {
    const t = li.trim().toLowerCase();
    if (t === 'normal') interlineado = 1.2;
    else if (/^\d*\.?\d+$/.test(t)) interlineado = parseFloat(t);
    else if (t.endsWith('%')) interlineado = parseFloat(t) / 100;
    else {
      const l = longitud(hoja, t, tamano);
      if (l !== undefined) interlineado = l / tamano;
    }
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  // Las medidas van en em del propio párrafo (como las escribe el CSS del libro nuevo).
  const enPropio = (k: string) => {
    const l = longitud(hoja, d[k], tamano);
    return l === undefined ? undefined : l / tamano;
  };
  const lon = (k: string) => r2(Math.max(0, enPropio(k) ?? 0));
  const peso = d['font-weight'] ?? '';
  const color = hex(d.color);
  const firma: FirmaParrafo = {
    sangria: r2(enPropio('text-indent') ?? 0),
    alinear: al === 'center' ? 'centro' : al === 'right' || al === 'end' ? 'derecha' : al === 'justify' ? 'justificado' : 'izquierda',
    arriba: lon('margin-top'),
    abajo: lon('margin-bottom'),
    izquierda: lon('margin-left'),
    derecha: lon('margin-right'),
    ...(interlineado !== undefined ? { interlineado: r2(Math.min(3, Math.max(0.8, interlineado))) } : {}),
    tamano: r2(tamano),
    cursiva: /italic|oblique/i.test(d['font-style'] ?? ''),
    negrita: peso === 'bold' || peso === 'bolder' || parseInt(peso) >= 600,
    versalitas: /small-caps/i.test(d['font-variant'] ?? d['font-variant-caps'] ?? ''),
    mayusculas: /uppercase/i.test(d['text-transform'] ?? ''),
    ...(color ? { color } : {}),
    ...(familia(d['font-family']) ? { familia: familia(d['font-family']) } : {}),
  };
  const letras = enPropio('letter-spacing');
  const palabras = enPropio('word-spacing');
  if (letras) firma.letras = Math.round(letras * 1000) / 1000;
  if (palabras) firma.palabras = Math.round(palabras * 1000) / 1000;
  return firma;
}

/** Clave del aspecto visible de un párrafo (sin los márgenes de arriba y abajo, que van aparte). */
export function claveFirma(f: FirmaParrafo): string {
  const { arriba: _a, abajo: _b, ...resto } = f;
  return JSON.stringify(resto);
}
