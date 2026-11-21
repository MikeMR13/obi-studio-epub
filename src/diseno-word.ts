// Diseño de un Word párrafo a párrafo: estilos de párrafo propios (los que no son Normal ni títulos),
// el espacio antes y después que cada párrafo tiene distinto del general y las fuentes incrustadas (.odttf).
// mammoth no da esos datos, así que se leen de document.xml y se casan con los párrafos convertidos por su texto.

import JSZip from 'jszip';
import type { Bloque, EstiloPropio, Libro } from './model.js';
import { textoPlano } from './model.js';
import { analizarXml, attr, hijos, nombre, todos, type Nodo } from './formatos/dom.js';

interface EstiloWord {
  id: string;
  nombre: string;
  tipo: string;
  basadoEn?: string;
  pPr?: Nodo;
  rPr?: Nodo;
}

export interface LectorWord {
  estilos: Map<string, EstiloWord>;
  defPPr?: Nodo;
  defRPr?: Nodo;
  /** Párrafos de document.xml en orden: texto normalizado, estilo y propiedades directas. */
  parrafos: { texto: string; estilo: string; pPr?: Nodo }[];
}

// nombre() da la etiqueta en minúsculas y sin prefijo.
const hijo = (n: Nodo | undefined, et: string) => (n ? hijos(n).find((x) => nombre(x) === et.toLowerCase()) : undefined);
const val = (n: Nodo | undefined, a: string) => (n ? attr(n, `w:${a}`) || undefined : undefined);

/** Texto para casar párrafos: sin espacios, sin la furigana de Aozora (｜base《lectura》). */
export function textoComparable(t: string): string {
  return t.replace(/《[^》]*》/g, '').replace(/[｜\s ]/g, '');
}

export async function lectorWord(zip: JSZip): Promise<LectorWord> {
  const estilosXml = (await zip.file('word/styles.xml')?.async('string')) ?? '<w:styles/>';
  const documento = (await zip.file('word/document.xml')?.async('string')) ?? '<w:document/>';
  const st = analizarXml(estilosXml);
  const estilos = new Map<string, EstiloWord>();
  for (const s of todos(st, (n) => nombre(n) === 'style')) {
    const id = attr(s, 'w:styleId');
    if (!id) continue;
    estilos.set(id, {
      id,
      nombre: val(hijo(s, 'name'), 'val') ?? id,
      tipo: attr(s, 'w:type'),
      basadoEn: val(hijo(s, 'basedOn'), 'val'),
      pPr: hijo(s, 'pPr'),
      rPr: hijo(s, 'rPr'),
    });
  }
  const def = todos(st, (n) => nombre(n) === 'docdefaults')[0];
  const defPPr = hijo(hijo(def, 'pPrDefault'), 'pPr');
  const defRPr = hijo(hijo(def, 'rPrDefault'), 'rPr');
  const doc = analizarXml(documento);
  const cuerpo = todos(doc, (n) => nombre(n) === 'body')[0];
  const parrafos: LectorWord['parrafos'] = [];
  if (cuerpo) {
    for (const p of todos(cuerpo, (n) => nombre(n) === 'p')) {
      const pPr = hijo(p, 'pPr');
      // Solo el texto propio del párrafo (no el de los cuadros de texto que lleve dentro).
      const textos: string[] = [];
      const recorrer = (n: Nodo) => {
        for (const h of hijos(n)) {
          const et = nombre(h);
          if (et === 'txbxcontent' || et === 'ppr' || et === 'del' || et === 'instrtext') continue;
          if (et === 't') textos.push(h.textContent ?? '');
          else recorrer(h);
        }
      };
      recorrer(p);
      parrafos.push({ texto: textoComparable(textos.join('')), estilo: val(hijo(pPr, 'pStyle'), 'val') ?? '', pPr });
    }
  }
  return { estilos, defPPr, defRPr, parrafos };
}

/** Niveles donde buscar una propiedad: el párrafo, su estilo y los estilos en que se basa, y los valores del documento. */
function niveles(w: LectorWord, id: string | undefined, donde: 'pPr' | 'rPr', directo?: Nodo): (Nodo | undefined)[] {
  const r: (Nodo | undefined)[] = [directo];
  const vistos = new Set<string>();
  let actual = id ? w.estilos.get(id) : w.estilos.get(normalDe(w));
  while (actual && !vistos.has(actual.id)) {
    vistos.add(actual.id);
    r.push(actual[donde]);
    actual = actual.basadoEn ? w.estilos.get(actual.basadoEn) : undefined;
  }
  r.push(donde === 'pPr' ? w.defPPr : w.defRPr);
  return r;
}

function normalDe(w: LectorWord): string {
  for (const e of w.estilos.values()) if (e.tipo === 'paragraph' && /^normal$/i.test(e.nombre)) return e.id;
  return 'Normal';
}

const activo = (n: Nodo | undefined) => !!n && !/^(0|false|off)$/i.test(attr(n, 'w:val'));

interface Aspecto {
  tamano: number;
  sangria: number;
  izquierda: number;
  derecha: number;
  alinear: EstiloPropio['alinear'];
  interlineado?: number;
  cursiva: boolean;
  negrita: boolean;
  versalitas: boolean;
  mayusculas: boolean;
  color?: string;
  familia?: string;
  antes?: number;
  despues?: number;
}

/** Aspecto de un estilo de párrafo (o de un párrafo con sus propiedades directas), en em de su propio tamaño. */
function aspecto(w: LectorWord, estilo: string | undefined, directo?: Nodo): Aspecto {
  const nP = niveles(w, estilo, 'pPr', directo);
  const nR = niveles(w, estilo, 'rPr');
  // Elemento: el primero que aparece; atributo: el primero que lo da (Word hereda atributo a atributo).
  const de = (et: string, donde: 'pPr' | 'rPr' = 'pPr') => (donde === 'pPr' ? nP : nR).map((n) => hijo(n, et)).find(Boolean);
  const atr = (et: string, a: string) => {
    for (const n of nP) {
      const v = val(hijo(n, et), a);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const sz = Number(val(de('sz', 'rPr'), 'val') ?? 24) / 2;
  const em = (tw?: string) => (tw === undefined ? undefined : Math.round((Number(tw) / 20 / sz) * 100) / 100);
  const primera = atr('ind', 'firstLine');
  const colgante = atr('ind', 'hanging');
  const jc = val(de('jc'), 'val');
  const linea = atr('spacing', 'line');
  const regla = atr('spacing', 'lineRule') ?? 'auto';
  const color = val(de('color', 'rPr'), 'val');
  const antes = atr('spacing', 'before');
  const despues = atr('spacing', 'after');
  return {
    tamano: sz,
    sangria: colgante !== undefined ? -(em(colgante) ?? 0) : (em(primera) ?? 0),
    izquierda: em(atr('ind', 'left') ?? atr('ind', 'start')) ?? 0,
    derecha: em(atr('ind', 'right') ?? atr('ind', 'end')) ?? 0,
    alinear: jc === 'center' ? 'centro' : jc === 'right' || jc === 'end' ? 'derecha' : jc === 'both' || jc === 'distribute' ? 'justificado' : 'izquierda',
    ...(linea ? { interlineado: Math.round((regla === 'auto' ? (Number(linea) / 240) * 1.15 : Number(linea) / 20 / sz) * 100) / 100 } : {}),
    cursiva: activo(de('i', 'rPr')),
    negrita: activo(de('b', 'rPr')),
    versalitas: activo(de('smallCaps', 'rPr')),
    mayusculas: activo(de('caps', 'rPr')),
    ...(color && /^[0-9a-f]{6}$/i.test(color) && !/^0{6}$/.test(color) ? { color: `#${color.toLowerCase()}` } : {}),
    ...(val(de('rFonts', 'rPr'), 'ascii') ? { familia: val(de('rFonts', 'rPr'), 'ascii') } : {}),
    ...(antes !== undefined ? { antes: em(antes) } : {}),
    ...(despues !== undefined ? { despues: em(despues) } : {}),
  };
}

// Estilos que ya tienen equivalente en Obi Studio (títulos y estilos de novela ligera que traduce el importador).
const YA_CONVERTIDOS = /^(normal|heading|título|titulo|title|subtitle|subtítulo|toc|índice|footnote|endnote|nota|caption|epígrafe|list|lista|pensamiento|thought|onomatopeya|carta|letter|cita|quote|intense quote|sin sangría|sinsangria|obicentrado|obiderecha|header|footer|encabezado|pie|balloon|default|body text|texto independiente)/i;

export interface EstiloWordOriginal extends EstiloPropio {
  /** styleId de Word. */
  clave: string;
  familia?: string;
  parrafos: number;
}

/** Estilos de párrafo de Word usados en el documento que no son Normal ni títulos, como estilos propios. */
export function estilosDeWord(w: LectorWord): EstiloWordOriginal[] {
  const normal = aspecto(w, normalDe(w));
  const usos = new Map<string, number>();
  for (const p of w.parrafos) if (p.estilo && p.texto) usos.set(p.estilo, (usos.get(p.estilo) ?? 0) + 1);
  const r: EstiloWordOriginal[] = [];
  for (const [id, n] of [...usos].sort((a, b) => b[1] - a[1])) {
    const e = w.estilos.get(id);
    if (!e || e.tipo !== 'paragraph' || YA_CONVERTIDOS.test(e.nombre) || YA_CONVERTIDOS.test(id) || r.length >= 12) continue;
    const a = aspecto(w, id);
    const d: Partial<EstiloPropio> & { familia?: string } = {};
    if (Math.abs(a.sangria - normal.sangria) > 0.05) d.sangria = Math.max(-4, Math.min(4, a.sangria));
    if (a.alinear !== normal.alinear) d.alinear = a.alinear;
    if (a.interlineado !== undefined && a.interlineado !== normal.interlineado) d.interlineado = Math.min(2.2, Math.max(0.9, a.interlineado));
    if (Math.abs(a.tamano / normal.tamano - 1) > 0.03) d.tamano = Math.round(Math.min(3, Math.max(0.5, a.tamano / normal.tamano)) * 100) / 100;
    for (const k of ['cursiva', 'negrita'] as const) if (a[k] !== normal[k]) d[k] = a[k];
    if (a.versalitas && !normal.versalitas) d.versalitas = true;
    if (a.mayusculas && !normal.mayusculas) d.mayusculas = true;
    if (a.color && a.color !== normal.color) d.color = a.color;
    if (a.familia && a.familia !== normal.familia) d.familia = a.familia;
    if (Math.abs(a.izquierda - normal.izquierda) > 0.05) d.izquierda = Math.max(0, Math.min(10, a.izquierda));
    if (Math.abs(a.derecha - normal.derecha) > 0.05) d.derecha = Math.max(0, Math.min(10, a.derecha));
    if (!Object.keys(d).length) continue;
    r.push({ id: `word-${r.length + 1}`, nombre: `Word: ${e.nombre}`.slice(0, 60), clave: id, parrafos: n, ...d });
  }
  return r;
}

/** Párrafos de Word con un espacio antes o después distinto del general (directo o de su estilo). */
export function espaciosDeWord(w: LectorWord): { general: { antes: number; despues: number }; porParrafo: { antes: number; despues: number }[]; distintos: number } {
  const n = aspecto(w, normalDe(w));
  const general = { antes: n.antes ?? 0, despues: n.despues ?? 0 };
  let distintos = 0;
  const porParrafo = w.parrafos.map((p) => {
    const a = aspecto(w, p.estilo || undefined, p.pPr);
    const r = { antes: Math.max(0, a.antes ?? 0), despues: Math.max(0, a.despues ?? 0) };
    const titulo = /^(heading|t[íi]tulo|title|subt)/i.test(w.estilos.get(p.estilo)?.nombre ?? p.estilo);
    if (p.texto && !titulo && (Math.abs(r.antes - general.antes) > 0.05 || Math.abs(r.despues - general.despues) > 0.05)) distintos++;
    return r;
  });
  return { general, porParrafo, distintos };
}

/**
 * Lleva al libro importado de un Word el espacio propio de cada párrafo y los estilos propios,
 * casando cada párrafo del libro con el suyo de document.xml por el texto (en orden).
 */
export function aplicarWord(libro: Libro, w: LectorWord, o: { espacio: boolean; estilos?: EstiloWordOriginal[] }): number {
  const esp = o.espacio ? espaciosDeWord(w) : undefined;
  const porEstilo = new Map((o.estilos ?? []).map((e) => [e.clave, e.id]));
  let k = 0;
  let casados = 0;
  for (const s of libro.secciones) {
    for (const b of s.bloques as Bloque[]) {
      if (b.tipo !== 'parrafo' && b.tipo !== 'subtitulo') continue;
      const t = textoComparable(textoPlano(b.contenido));
      if (!t && b.tipo === 'parrafo' && b.contenido.length) continue;
      let j = k;
      while (j < w.parrafos.length && j < k + 60 && w.parrafos[j].texto !== t) j++;
      if (j >= w.parrafos.length || w.parrafos[j].texto !== t) continue;
      k = j + 1;
      casados++;
      if (b.tipo !== 'parrafo') continue;
      const p = w.parrafos[j];
      const clase = porEstilo.get(p.estilo);
      if (clase && t) b.clase = clase;
      if (esp) {
        const e = esp.porParrafo[j];
        if (Math.abs(e.antes - esp.general.antes) > 0.05) b.espacioAntes = Math.min(10, e.antes);
        if (Math.abs(e.despues - esp.general.despues) > 0.05) b.espacioDespues = Math.min(10, e.despues);
      }
    }
  }
  return casados;
}

/** Fuentes incrustadas en el Word (word/fonts/*.odttf), sin la ofuscación de Office (clave del fontKey). */
export async function fuentesDeWord(zip: JSZip): Promise<{ familia: string; nombre: string; datos: Uint8Array }[]> {
  const tabla = await zip.file('word/fontTable.xml')?.async('string');
  const rels = await zip.file('word/_rels/fontTable.xml.rels')?.async('string');
  if (!tabla || !rels) return [];
  const destino = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/\bId="([^"]+)"/)?.[1] ?? '', m[0].match(/\bTarget="([^"]+)"/)?.[1] ?? '']));
  const r: { familia: string; nombre: string; datos: Uint8Array }[] = [];
  for (const f of todos(analizarXml(tabla), (n) => nombre(n) === 'font')) {
    const familia = attr(f, 'w:name');
    for (const h of hijos(f)) {
      if (!/^embed(regular|bold|italic|bolditalic)$/.test(nombre(h))) continue;
      const id = attr(h, 'r:id');
      const clave = attr(h, 'w:fontKey').replace(/[^0-9a-f]/gi, '');
      const ruta = destino.get(id);
      if (!ruta || clave.length !== 32) continue;
      const archivo = zip.file('word/' + ruta.replace(/^\/?word\//, '').replace(/^\.\//, ''));
      if (!archivo) continue;
      const d = await archivo.async('uint8array');
      // La clave son los bytes del GUID al revés; se aplica con XOR a los 32 primeros bytes.
      const k = Array.from({ length: 16 }, (_, i) => parseInt(clave.slice(30 - i * 2, 32 - i * 2), 16));
      for (let i = 0; i < Math.min(32, d.length); i++) d[i] ^= k[i % 16];
      r.push({ familia, nombre: `${familia.replace(/[^\w-]+/g, '')}-${nombre(h).slice(5)}.ttf`, datos: d });
    }
  }
  return r;
}
