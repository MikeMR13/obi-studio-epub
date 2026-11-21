// Diseño del archivo de origen (EPUB o Word): letra, sangría, interlineado, espacio entre párrafos,
// alineación y títulos, y las fuentes que trae el EPUB. Lo usa la conversión sencilla para que el
// EPUB nuevo se parezca al original sin tener que elegir un tema.

import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import type { EstiloPropio, EstiloSubtitulo, Libro, Tema } from './model.js';
import { aplicarWord, espaciosDeWord, estilosDeWord, fuentesDeWord, lectorWord } from './diseno-word.js';
import { ELEMENTO, analizarXhtml, attr, buscar, clases, hijos, nombre, texto, todos, type Nodo } from './formatos/dom.js';
import { calcular, claveFirma, familia, firmaParrafo, hojaDeCss, longitud, propias, type Calculado, type FirmaParrafo } from './estilo-calculado.js';
import { claveOfuscacion, ofuscarFuente } from './compilar.js';
import { resolverRuta } from './formatos/epub.js';
import { woff2ASfnt } from './woff2.js';

export interface FuenteOriginal {
  familia: string;
  nombre: string;
  datos: Uint8Array;
}

export interface DisenoOriginal {
  /** Párrafo: sangría, interlineado y alineación. */
  tema: Partial<Tema>;
  /** Espacio entre párrafos del original (el general) y sus márgenes arriba y abajo, en em. */
  espacio?: { general: number; arriba: number; abajo: number };
  /** Espacio sobre y bajo los títulos de capítulo, en em (del título). */
  espacioTitulos?: number;
  espacioBajoTitulos?: number;
  espaciadoLetras?: number;
  espaciadoPalabras?: number;
  /** Títulos: alineación, color y mayúsculas. */
  titulos: Partial<Tema>;
  /** Párrafos con un espacio distinto del general y líneas en blanco. */
  parrafosConEspacio: number;
  lineasEnBlanco: number;
  familiaTexto?: string;
  familiaTitulos?: string;
  /** Otros tipos de párrafo del original (citas, cartas, notas del autor…). */
  estilos?: EstiloOriginal[];
  subtitulo?: EstiloSubtitulo;
  /** Separador de escena del original: el ornamento de texto o el nombre de la imagen. */
  separador?: { texto?: string; imagen?: string; veces: number };
  capitular?: boolean;
  primeraLinea?: boolean;
  /** Clases de las capitulares hechas con un span flotante (el importador no convierte su tamaño). */
  clasesCapitular?: string[];
  /** CSS del original (lo usa el importador para asignar los estilos; no se envía a la interfaz). */
  css?: string;
  avisosCss?: string[];
  /** Fragmentos (span, em…) con tamaño, color o fondo propios. */
  fragmentosConAspecto?: number;
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

function colorHex(v?: string): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + [...t.slice(1)].map((c) => c + c).join('');
  const m = t.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  return { black: '#000000', white: '#ffffff' }[t];
}

/** Estilo de párrafo del original distinto del general (se convierte en un estilo propio del libro). */
export interface EstiloOriginal extends EstiloPropio {
  /** Clave de la firma calculada: la usa el importador para asignar el estilo a cada párrafo. */
  clave: string;
  /** Familia de letra del original, si es distinta de la del texto. */
  familia?: string;
  parrafos: number;
}

/** Texto visible de un párrafo (sin etiquetas), para saber si está vacío o es un separador. */
function plano(n: Nodo): string {
  return texto(n).replace(/[ \s]+/g, ' ').trim();
}

/** ¿Es un separador de escena hecho de símbolos (◆◆◆, ✽ ✽ ✽, ＊＊＊…)? */
export function pareceSeparador(t: string): boolean {
  const x = t.replace(/\s+/g, '');
  return x.length > 0 && x.length <= 12 && !/[\p{L}\p{N}]/u.test(x);
}

function soloImagen(n: Nodo): Nodo | undefined {
  if (plano(n)) return undefined;
  const imgs = todos(n, (x) => nombre(x) === 'img' || nombre(x) === 'image');
  return imgs.length === 1 ? imgs[0] : undefined;
}

const NOMBRE_PROPIEDAD: Record<string, string> = {
  sangria: 'sangría',
  alinear: 'alineación',
  interlineado: 'interlineado',
  tamano: 'tamaño',
  cursiva: 'cursiva',
  negrita: 'negrita',
  versalitas: 'versalitas',
  mayusculas: 'mayúsculas',
  color: 'color',
  familia: 'letra',
  izquierda: 'margen',
  derecha: 'margen',
};

/** Diferencias de un tipo de párrafo respecto al general, como estilo propio. */
function diferencias(f: FirmaParrafo, g: FirmaParrafo): Partial<EstiloOriginal> {
  const e: Partial<EstiloOriginal> = {};
  if (Math.abs(f.sangria - g.sangria) > 0.05) e.sangria = Math.min(4, Math.max(-4, f.sangria));
  if (f.alinear !== g.alinear) e.alinear = f.alinear;
  if ((f.interlineado ?? 1.2) !== (g.interlineado ?? 1.2) && f.interlineado !== undefined) e.interlineado = Math.min(2.2, Math.max(0.9, f.interlineado));
  if (Math.abs(f.tamano / g.tamano - 1) > 0.03) e.tamano = Math.round(Math.min(3, Math.max(0.5, f.tamano / g.tamano)) * 100) / 100;
  if (f.cursiva !== g.cursiva) e.cursiva = f.cursiva;
  if (f.negrita !== g.negrita) e.negrita = f.negrita;
  if (f.versalitas && !g.versalitas) e.versalitas = true;
  if (f.mayusculas && !g.mayusculas) e.mayusculas = true;
  if (f.color && f.color !== g.color) e.color = f.color;
  if (f.familia && f.familia !== g.familia) e.familia = f.familia;
  if (Math.abs(f.izquierda - g.izquierda) > 0.05) e.izquierda = Math.min(10, f.izquierda);
  if (Math.abs(f.derecha - g.derecha) > 0.05) e.derecha = Math.min(10, f.derecha);
  return e;
}

/** Tema a partir del CSS de un EPUB y del estilo calculado de sus párrafos. */
export function temaDeCss(css: string, xhtmls: string[]): Omit<DisenoOriginal, 'fuentes' | 'avisos'> {
  const hoja = hojaDeCss(css);
  const cache = new Map<Nodo, Calculado>();
  const docs = xhtmls
    .map((x) => {
      try {
        return analizarXhtml(x).documento;
      } catch {
        return undefined;
      }
    })
    .filter((d): d is Nodo => !!d && !buscar(d, (n) => nombre(n) === 'nav'));

  // Párrafos con texto, agrupados por su aspecto calculado.
  const grupos = new Map<string, { firma: FirmaParrafo; nodos: Nodo[]; clases: Map<string, number> }>();
  const separadoresTexto = new Map<string, number>();
  const imagenesSolas = new Map<string, number>();
  let lineasEnBlanco = 0;
  const todosP: { n: Nodo; f: FirmaParrafo }[] = [];
  for (const d of docs) {
    for (const p of todos(d, (n) => nombre(n) === 'p')) {
      const t = plano(p);
      const img = soloImagen(p);
      if (img) {
        const src = attr(img, 'src') || attr(img, 'xlink:href') || attr(img, 'href');
        if (src) imagenesSolas.set(src.split('/').pop()!, (imagenesSolas.get(src.split('/').pop()!) ?? 0) + 1);
        continue;
      }
      if (!t) {
        if (!todos(p, (x) => nombre(x) === 'img').length) lineasEnBlanco++;
        continue;
      }
      if (pareceSeparador(t)) {
        separadoresTexto.set(t, (separadoresTexto.get(t) ?? 0) + 1);
        continue;
      }
      const f = firmaParrafo(hoja, p, cache);
      todosP.push({ n: p, f });
      const k = claveFirma(f);
      const g = grupos.get(k) ?? { firma: f, nodos: [] as Nodo[], clases: new Map<string, number>() };
      g.nodos.push(p);
      const c = clases(p).join(' ');
      if (c) g.clases.set(c, (g.clases.get(c) ?? 0) + 1);
      grupos.set(k, g);
    }
  }
  const ordenados = [...grupos.entries()].sort((a, b) => b[1].nodos.length - a[1].nodos.length);
  const general: FirmaParrafo = ordenados[0]?.[1].firma ?? { sangria: 0, alinear: 'izquierda', arriba: 0, abajo: 0, izquierda: 0, derecha: 0, tamano: 1, cursiva: false, negrita: false, versalitas: false, mayusculas: false };

  // Los demás tipos de párrafo visibles: estilos propios (como mucho 12, los más usados).
  const estilos: EstiloOriginal[] = [];
  const usadosNombres = new Set<string>();
  for (const [clave, g] of ordenados.slice(1)) {
    if (estilos.length >= 12) break;
    const dif = diferencias(g.firma, general);
    if (!Object.keys(dif).length) continue;
    const claseComun = [...g.clases].sort((a, b) => b[1] - a[1])[0]?.[0];
    let nombreEstilo = claseComun ? `Original: ${claseComun}` : `Original: ${Object.keys(dif).map((k) => NOMBRE_PROPIEDAD[k] ?? k).filter((x, i, a) => a.indexOf(x) === i).join(', ')}`;
    while (usadosNombres.has(nombreEstilo)) nombreEstilo += ' ·';
    usadosNombres.add(nombreEstilo);
    estilos.push({ id: `orig-${estilos.length + 1}`, nombre: nombreEstilo.slice(0, 60), clave, parrafos: g.nodos.length, ...dif } as EstiloOriginal);
  }

  const tema: Partial<Tema> = {};
  tema.sangria = Math.min(4, Math.max(0, general.sangria));
  if (general.interlineado !== undefined) tema.interlineado = Math.min(2.2, Math.max(1.1, general.interlineado));
  if (general.alinear === 'justificado') tema.alinear = 'justificado';
  else if (general.alinear === 'izquierda') tema.alinear = 'izquierda';

  // Títulos: el primer h1 o, si el libro no los usa, el primer h2 (Sigil y Calibre usan mucho h2 con clase).
  let tituloNodo: Nodo | undefined;
  for (const d of docs) {
    tituloNodo = buscar(d, (n) => nombre(n) === 'h1') ?? buscar(d, (n) => nombre(n) === 'h2');
    if (tituloNodo) break;
  }
  const etTitulo = tituloNodo ? nombre(tituloNodo) : 'h1';
  const titulos: Partial<Tema> = {};
  let espacioTitulos: number | undefined;
  let espacioBajoTitulos: number | undefined;
  let familiaTitulos: string | undefined;
  if (tituloNodo) {
    const c = calcular(hoja, tituloNodo, cache);
    const h = c.decl;
    const pr = propias(hoja, tituloNodo);
    // Sin text-align (ni heredado), el navegador alinea el título a la izquierda.
    const alh = (h['text-align'] ?? 'left').toLowerCase();
    if (alh === 'left' || alh === 'start' || alh === 'justify') titulos.tituloEstilo = 'izquierda';
    else if (alh === 'center') titulos.tituloEstilo = 'centrado';
    const color = colorHex(pr.color);
    if (color) titulos.colorTitulos = color;
    if (/small-caps/i.test(h['font-variant'] ?? '')) titulos.tituloMayusculas = true;
    if (/uppercase/i.test(h['text-transform'] ?? '')) titulos.tituloEnMayusculas = true;
    if (c.tamano >= 1 && c.tamano <= 3) titulos.tituloTamano = Math.round(c.tamano * 100) / 100;
    // Márgenes en em del propio título (si el CSS no los da, los del navegador: 0,67 em en h1 y 0,83 em en h2).
    const enEmTitulo = (k: string) => {
      const l = longitud(hoja, pr[k], c.tamano);
      return l === undefined ? undefined : l / c.tamano;
    };
    const arriba = enEmTitulo('margin-top') ?? (etTitulo === 'h2' ? 0.83 : 0.67);
    espacioTitulos = Math.min(12, Math.round(arriba * 100) / 100);
    const abajo = enEmTitulo('margin-bottom');
    espacioBajoTitulos = Math.min(6, Math.round((abajo ?? (etTitulo === 'h2' ? 0.83 : 0.67)) * 100) / 100);
    familiaTitulos = familia(h['font-family']);
    // Primer párrafo tras el título: ¿lleva sangría en el original?
    if (tema.sangria) {
      const hermanos = tituloNodo.parentNode ? hijos(tituloNodo.parentNode).filter((x) => x.nodeType === ELEMENTO) : [];
      const sig = hermanos[hermanos.indexOf(tituloNodo) + 1];
      if (sig && nombre(sig) === 'p') tema.sangriaTrasTitulo = firmaParrafo(hoja, sig, cache).sangria > 0;
    }
  }

  // Subtítulos (h2/h3 que no hacen de título de capítulo).
  let subtitulo: EstiloSubtitulo | undefined;
  for (const d of docs) {
    const h = todos(d, (n) => (nombre(n) === 'h2' || nombre(n) === 'h3') && n !== tituloNodo && etTitulo !== nombre(n))[0];
    if (!h) continue;
    const c = calcular(hoja, h, cache);
    const pr = propias(hoja, h);
    const al = (c.decl['text-align'] ?? '').toLowerCase();
    subtitulo = {
      ...(al === 'center' ? { alinear: 'centro' as const } : al === 'right' ? { alinear: 'derecha' as const } : al === 'left' || al === 'start' ? { alinear: 'izquierda' as const } : {}),
      ...(colorHex(pr.color) ? { color: colorHex(pr.color) } : {}),
      ...(c.tamano >= 0.8 && c.tamano <= 3 ? { tamano: Math.round(c.tamano * 100) / 100 } : {}),
      ...(/uppercase/i.test(c.decl['text-transform'] ?? '') ? { mayusculas: true } : {}),
    };
    break;
  }

  // Capitular y primera línea del original (::first-letter / ::first-line, o un span flotante grande).
  let capitular = false;
  let primeraLinea = false;
  const clasesCapitular: string[] = [];
  for (const r of hoja.reglas) {
    if (r.pseudo === 'first-letter' && (r.decl.float || (longitud(hoja, r.decl['font-size']) ?? 1) >= 1.5)) capitular = true;
    if (r.pseudo === 'first-line' && /small-caps|uppercase/i.test(`${r.decl['font-variant'] ?? ''} ${r.decl['text-transform'] ?? ''}`)) primeraLinea = true;
    const cls = r.selector.match(/^(?:span)?\.([\w-]+)$/)?.[1];
    if (!r.pseudo && cls && /left/i.test(r.decl.float ?? '') && (nuevoTamanoAprox(r.decl['font-size']) ?? 1) >= 1.5) {
      capitular = true;
      clasesCapitular.push(cls);
    }
  }

  // Separador de escena: el ornamento de texto o la imagen que más se repite sola en un párrafo.
  const sepTexto = [...separadoresTexto].sort((a, b) => b[1] - a[1])[0];
  const sepImagen = [...imagenesSolas].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  const separador: DisenoOriginal['separador'] = sepImagen && (!sepTexto || sepImagen[1] > sepTexto[1]) ? { imagen: sepImagen[0], veces: sepImagen[1] } : sepTexto ? { texto: sepTexto[0], veces: sepTexto[1] } : undefined;

  // Fragmentos con tamaño, color o fondo propios (los que no son capitulares).
  let fragmentosConAspecto = 0;
  const EN_LINEA = new Set(['span', 'em', 'strong', 'i', 'b', 'small', 'big', 'font', 'a', 'sup', 'sub']);
  for (const d of docs) {
    for (const n of todos(d, (x) => EN_LINEA.has(nombre(x)))) {
      if (clases(n).some((c) => clasesCapitular.includes(c))) continue;
      const pr = propias(hoja, n);
      if ((pr['font-size'] && !/^(1em|100%|inherit|medium)$/i.test(pr['font-size'])) || (pr.color && colorHex(pr.color) && !/^#(0{6}|1{6}|2{6})$/.test(colorHex(pr.color)!)) || pr['background-color']) fragmentosConAspecto++;
    }
  }

  // Espaciado general y párrafos con espacio propio.
  const espacio = ordenados.length ? { general: Math.min(2, Math.max(0, Math.round(Math.max(general.arriba, general.abajo) * 100) / 100)), arriba: general.arriba, abajo: general.abajo } : undefined;
  let parrafosConEspacio = 0;
  for (const { f } of todosP) if (Math.abs(f.arriba - general.arriba) > 0.05 || Math.abs(f.abajo - general.abajo) > 0.05) parrafosConEspacio++;
  const avisos: string[] = [];
  if (hoja.ignoradas.size) avisos.push(`El original usa medidas que dependen de la pantalla (${[...hoja.ignoradas].join(', ')}); esas medidas no se conservan.`);
  return {
    tema,
    titulos,
    ...(espacio ? { espacio } : {}),
    ...(espacioTitulos !== undefined ? { espacioTitulos } : {}),
    ...(espacioBajoTitulos !== undefined ? { espacioBajoTitulos } : {}),
    ...(general.letras ? { espaciadoLetras: general.letras } : {}),
    ...(general.palabras ? { espaciadoPalabras: general.palabras } : {}),
    parrafosConEspacio,
    lineasEnBlanco,
    familiaTexto: general.familia,
    familiaTitulos,
    estilos,
    ...(subtitulo && Object.keys(subtitulo).length ? { subtitulo } : {}),
    ...(separador ? { separador } : {}),
    ...(capitular ? { capitular: true } : {}),
    ...(primeraLinea ? { primeraLinea: true } : {}),
    ...(clasesCapitular.length ? { clasesCapitular } : {}),
    css,
    avisosCss: avisos,
    fragmentosConAspecto,
  };
}

function nuevoTamanoAprox(v?: string): number | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(\d*\.?\d+)(em|rem|%)$/i);
  if (!m) return undefined;
  return m[2] === '%' ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
}

/**
 * Asigna a cada párrafo del original su estilo propio (por su aspecto calculado), para el importador.
 * Devuelve undefined en los párrafos con el aspecto general.
 */
export function asignadorEstilos(css: string, estilos: { id: string; clave: string }[]): (n: Nodo) => string | undefined {
  const hoja = hojaDeCss(css);
  const cache = new Map<Nodo, Calculado>();
  const porClave = new Map(estilos.map((e) => [e.clave, e.id]));
  return (n) => (porClave.size ? porClave.get(claveFirma(firmaParrafo(hoja, n, cache))) : undefined);
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
  const leido = temaDeCss(css, xhtmls);
  if (leido.avisosCss?.length) avisos.push(...leido.avisosCss);

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
    if (f.dir || !/\.(ttf|otf|woff2?)$/i.test(ruta)) continue;
    let d: Uint8Array | undefined = await f.async('uint8array');
    const entrada = [...cifrado.matchAll(/<(?:enc:)?EncryptedData\b[\s\S]*?<\/(?:enc:)?EncryptedData>/g)].map((x) => x[0]).find((x) => x.includes(`URI="${ruta}"`));
    if (entrada) {
      if (entrada.includes('http://www.idpf.org/2008/embedding')) d = ofuscarFuente(d, claveOfuscacion(identificadorUnico));
      else if (entrada.includes('http://ns.adobe.com/pdf/enc#RC')) {
        // Ofuscación de Adobe: los 1024 primeros bytes con la clave de 16 bytes del UUID del libro.
        const claro = desofuscarAdobe(d, uuidsDe(opf, identificadorUnico));
        if (!claro) {
          avisos.push(`La fuente «${ruta.split('/').pop()}» está protegida y no se pudo leer; se usará otra.`);
          continue;
        }
        d = claro;
      } else {
        avisos.push(`La fuente «${ruta.split('/').pop()}» está protegida de una forma que no se puede leer; se usará otra.`);
        continue;
      }
    }
    if (/\.woff$/i.test(ruta)) d = woffASfnt(d);
    else if (/\.woff2$/i.test(ruta)) {
      const sfnt = woff2ASfnt(d);
      if (!sfnt) avisos.push(`La fuente «${ruta.split('/').pop()}» (WOFF2) no se pudo leer; se usará otra.`);
      d = sfnt;
    }
    if (!d) continue;
    const nombre = ruta.split('/').pop()!;
    fuentes.push({ familia: familiaDe.get(nombre.toLowerCase()) ?? '', nombre, datos: d });
  }
  return { ...leido, fuentes, avisos };
}

/** Identificadores UUID del libro (el único primero): la clave de Adobe sale de uno de ellos. */
function uuidsDe(opf: string, unico: string): string[] {
  const todos = [unico, ...[...opf.matchAll(/<dc:identifier\b[^>]*>([^<]*)</g)].map((m) => m[1].trim())];
  return [...new Set(todos.map((x) => x.replace(/^urn:uuid:/i, '').replace(/[-\s]/g, '').toLowerCase()).filter((x) => /^[0-9a-f]{32}$/.test(x)))];
}

const CABECERAS_SFNT = [0x00010000, 0x4f54544f, 0x74727565, 0x774f4646, 0x774f4632];

/** Quita la ofuscación de Adobe (XOR de los 1024 primeros bytes con el UUID); comprueba que salga una fuente. */
export function desofuscarAdobe(d: Uint8Array, uuids: string[]): Uint8Array | undefined {
  for (const u of uuids) {
    const clave = Uint8Array.from(u.match(/../g)!.map((x) => parseInt(x, 16)));
    const r = d.slice();
    for (let i = 0; i < Math.min(1024, r.length); i++) r[i] ^= clave[i % 16];
    if (r.length >= 4 && CABECERAS_SFNT.includes(new DataView(r.buffer).getUint32(0))) return r;
  }
  return undefined;
}

/** Lleva al libro importado de un Word el espacio propio de cada párrafo y sus estilos propios. */
export async function aplicarDisenoDocx(libro: Libro, datos: Uint8Array, o: { espacio: boolean; estilos?: EstiloOriginal[] }): Promise<void> {
  const w = await lectorWord(await JSZip.loadAsync(datos));
  aplicarWord(libro, w, o);
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
  const titulos: Partial<Tema> = {};
  const primera = de(normal, 'ind', 'firstLine') ?? de(defecto, 'ind', 'firstLine');
  if (primera !== undefined) tema.sangria = Math.min(4, Math.max(0, Math.round((Number(primera) / 20 / tamano) * 100) / 100));
  const linea = de(normal, 'spacing', 'line') ?? de(defecto, 'spacing', 'line');
  const regla = de(normal, 'spacing', 'lineRule') ?? de(defecto, 'spacing', 'lineRule') ?? 'auto';
  if (linea && regla === 'auto') tema.interlineado = Math.min(2.2, Math.max(1.1, Math.round((Number(linea) / 240) * 1.15 * 100) / 100));
  else if (linea && regla === 'exact') tema.interlineado = Math.min(2.2, Math.max(1.1, Math.round((Number(linea) / 20 / tamano) * 100) / 100));
  const enEmWord = (v?: string) => (v === undefined ? undefined : Math.round((Number(v) / 20 / tamano) * 100) / 100);
  const despues = enEmWord(de(normal, 'spacing', 'after') ?? de(defecto, 'spacing', 'after'));
  const antes = enEmWord(de(normal, 'spacing', 'before') ?? de(defecto, 'spacing', 'before'));
  const espacio = despues !== undefined || antes !== undefined ? { general: Math.min(2, Math.max(despues ?? 0, antes ?? 0)), arriba: antes ?? 0, abajo: despues ?? 0 } : undefined;
  const tamTitulo = Number(de(titulo, 'sz', 'val') ?? 32) / 2;
  const antesTitulo = de(titulo, 'spacing', 'before');
  const espacioTitulos = antesTitulo !== undefined ? Math.min(12, Math.round((Number(antesTitulo) / 20 / tamTitulo) * 100) / 100) : undefined;
  const letrasWord = normal.match(/<w:rPr>[\s\S]*?<w:spacing\b[^>]*w:val="(-?\d+)"/)?.[1];
  const espaciadoLetras = letrasWord ? Math.round((Number(letrasWord) / 20 / tamano) * 1000) / 1000 : undefined;
  const documento = (await zip.file('word/document.xml')?.async('string')) ?? '';
  const lineasEnBlanco = [...documento.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)].filter((m) => !/<w:t\b|<w:drawing|<w:pict/.test(m[1] ?? '')).length;
  const jc = de(normal, 'jc', 'val');
  if (jc === 'both' || jc === 'distribute') tema.alinear = 'justificado';
  else if (jc === 'left' || jc === 'start') tema.alinear = 'izquierda';
  const jch = de(titulo, 'jc', 'val');
  if (jch === 'center') titulos.tituloEstilo = 'centrado';
  else if (jch === 'left' || jch === 'start') titulos.tituloEstilo = 'izquierda';
  const color = de(titulo, 'color', 'val');
  if (color && /^[0-9a-f]{6}$/i.test(color)) titulos.colorTitulos = `#${color.toLowerCase()}`;
  if (/<w:smallCaps\b/.test(titulo)) titulos.tituloMayusculas = true;
  if (/<w:caps\b/.test(titulo)) titulos.tituloEnMayusculas = true;
  const tamTituloEm = Math.round((tamTitulo / tamano) * 100) / 100;
  if (tamTituloEm >= 1 && tamTituloEm <= 3) titulos.tituloTamano = tamTituloEm;
  const familiaTexto = de(normal, 'rFonts', 'ascii') ?? de(defecto, 'rFonts', 'ascii');
  const familiaTitulos = de(titulo, 'rFonts', 'ascii');
  const w = await lectorWord(zip);
  const estilosWord = estilosDeWord(w);
  const { distintos } = espaciosDeWord(w);
  const fuentes = await fuentesDeWord(zip).catch(() => []);
  return {
    tema,
    titulos,
    ...(espacio ? { espacio } : {}),
    ...(espacioTitulos !== undefined ? { espacioTitulos } : {}),
    ...(espaciadoLetras ? { espaciadoLetras } : {}),
    parrafosConEspacio: distintos,
    lineasEnBlanco,
    familiaTexto: primeraFamilia(familiaTexto),
    familiaTitulos: primeraFamilia(familiaTitulos),
    ...(estilosWord.length ? { estilos: estilosWord } : {}),
    fuentes,
    avisos: [],
  };
}
