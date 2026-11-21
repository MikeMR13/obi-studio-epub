// HTML, Markdown, texto plano y OpenDocument (.odt): se convierten en un EPUB mínimo con su HTML y su CSS,
// y ese EPUB pasa por el mismo camino que cualquier otro (importador y lectura del diseño original).

import JSZip from 'jszip';
import { marked } from 'marked';
import { esc, escAttr } from '../xml.js';
import { tipoPorContenido, extension } from '../imagen.js';
import { analizarXml, attr, hijos, nombre, todos, ELEMENTO, TEXTO, type Nodo } from './dom.js';

export const FORMATOS_OTROS = ['html', 'htm', 'xhtml', 'md', 'markdown', 'txt', 'odt'] as const;

export function esFormatoOtro(ext?: string): boolean {
  return !!ext && (FORMATOS_OTROS as readonly string[]).includes(ext);
}

interface Contenido {
  titulo: string;
  /** Cuerpo en XHTML (bien formado). */
  cuerpo: string;
  css: string;
  /** Archivos de imagen por su nombre en Images/. */
  imagenes: Map<string, Uint8Array>;
  avisos: string[];
}

/** Empaqueta un único documento XHTML en un EPUB 3 mínimo. */
export async function epubDeContenido(c: Contenido): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const imgs = [...c.imagenes.entries()].map(([n, d], k) => ({ id: `img${k + 1}`, n, tipo: tipoPorContenido(d) }));
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${esc(c.titulo)}</dc:title><dc:language>es</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="texto" href="Text/texto.xhtml" media-type="application/xhtml+xml"/><item id="css" href="Styles/estilo.css" media-type="text/css"/>${imgs
      .filter((i) => i.tipo)
      .map((i) => `<item id="${i.id}" href="Images/${escAttr(i.n)}" media-type="${i.tipo}"/>`)
      .join('')}</manifest><spine><itemref idref="texto"/></spine></package>`,
  );
  z.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol><li><a href="Text/texto.xhtml">${esc(c.titulo)}</a></li></ol></nav></body></html>`);
  z.file(
    'OEBPS/Text/texto.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(c.titulo)}</title><link rel="stylesheet" href="../Styles/estilo.css"/></head><body>${c.cuerpo}</body></html>`,
  );
  z.file('OEBPS/Styles/estilo.css', c.css);
  for (const i of imgs) if (i.tipo) z.file(`OEBPS/Images/${i.n}`, c.imagenes.get(i.n)!);
  return z.generateAsync({ type: 'uint8array' });
}

/** Texto con la codificación correcta: UTF-8 (con o sin BOM), UTF-16 o, si no es UTF-8 válido, Shift_JIS o Windows-1252. */
export function decodificarTexto(d: Uint8Array): string {
  if (d[0] === 0xff && d[1] === 0xfe) return new TextDecoder('utf-16le').decode(d.subarray(2));
  if (d[0] === 0xfe && d[1] === 0xff) return new TextDecoder('utf-16be').decode(d.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(d).replace(/^\ufeff/, '');
  } catch {
    // Bytes de Shift_JIS típicos (0x81–0x9f seguidos de un segundo byte): novela japonesa.
    let sjis = 0;
    for (let i = 0; i + 1 < d.length; i++) if (d[i] >= 0x81 && d[i] <= 0x9f && d[i + 1] >= 0x40) sjis++;
    return new TextDecoder(sjis > d.length / 50 ? 'shift_jis' : 'windows-1252').decode(d);
  }
}

/** Un HTML cualquiera (puede no ser XML) a XHTML bien formado, con su CSS de <style>. */
async function deHtml(html: string, nombreArchivo: string): Promise<Contenido> {
  const { parseHTML } = await import('linkedom');
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
  const avisos: string[] = [];
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  if (document.querySelector('link[rel="stylesheet"]')) avisos.push('Las hojas de estilo enlazadas desde el HTML no se pueden leer; solo se usa el CSS que va dentro del archivo.');
  const imagenes = new Map<string, Uint8Array>();
  let k = 0;
  for (const img of [...document.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    const m = src.match(/^data:([^;,]+);base64,(.*)$/);
    if (m) {
      const d = Uint8Array.from(Buffer.from(m[2], 'base64'));
      const tipo = tipoPorContenido(d);
      if (tipo) {
        const n = `imagen-${++k}.${extension(tipo)}`;
        imagenes.set(n, d);
        img.setAttribute('src', `../Images/${n}`);
        continue;
      }
    }
    if (!avisos.some((a) => a.includes('imágenes'))) avisos.push('Las imágenes enlazadas desde el HTML no se pueden leer (solo las que van dentro, en base64); se quitan.');
    img.remove();
  }
  for (const s of [...document.querySelectorAll('script, style, link, meta, iframe, object, embed, form')]) s.remove();
  const titulo = document.querySelector('title')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || nombreArchivo.replace(/\.[^.]+$/, '');
  const cuerpo = document.querySelector('body');
  return { titulo, cuerpo: xhtmlDe(cuerpo as unknown as Nodo), css, imagenes, avisos };
}

const VACIOS = new Set(['br', 'hr', 'img', 'wbr', 'col', 'area', 'source', 'track']);

/** Serializa los hijos de un nodo de linkedom como XHTML bien formado. */
function xhtmlDe(n: Nodo | null | undefined): string {
  if (!n) return '';
  let r = '';
  for (const h of hijos(n)) {
    if (h.nodeType === TEXTO) r += esc(h.nodeValue ?? '');
    else if (h.nodeType === ELEMENTO) {
      const et = nombre(h);
      if (!/^[a-z][a-z0-9]*$/.test(et)) {
        r += xhtmlDe(h);
        continue;
      }
      const atributos = Array.from(h.attributes ?? [])
        .filter((a) => /^[a-z][\w:-]*$/i.test(a.name) && !/^on/i.test(a.name) && a.name !== 'xmlns')
        .map((a) => ` ${a.name.toLowerCase()}="${escAttr(a.value)}"`)
        .join('');
      r += VACIOS.has(et) ? `<${et}${atributos}/>` : `<${et}${atributos}>${xhtmlDe(h)}</${et}>`;
    }
  }
  return r;
}

/** Markdown (CommonMark con GFM) → HTML → EPUB. */
async function deMarkdown(md: string, nombreArchivo: string): Promise<Contenido> {
  const html = await marked.parse(md, { gfm: true, breaks: false });
  const c = await deHtml(`<!DOCTYPE html><html><head><title></title></head><body>${html}</body></html>`, nombreArchivo);
  // Markdown no tiene estilo: sangría y párrafos seguidos, como un libro.
  return { ...c, titulo: md.match(/^#\s+(.+)$/m)?.[1].trim() ?? c.titulo, css: '' };
}

const CAPITULO_TXT = /^\s*(cap[ií]tulo|chapter|pr[oó]logo|prologue|ep[ií]logo|epilogue|interludio|interlude|parte|part|第[0-9０-９一二三四五六七八九十百千]+[章話部幕]|序章|終章|あとがき)\b.{0,80}$/i;

/** Texto plano: un párrafo por línea (o por bloque si el texto separa párrafos con líneas en blanco), capítulos por su título. */
function deTexto(txt: string, nombreArchivo: string): Contenido {
  const lineas = txt.replace(/\r\n?/g, '\n').split('\n');
  const llenas = lineas.filter((l) => l.trim()).length;
  const blancas = lineas.length - llenas;
  // Con párrafos separados por líneas en blanco, una línea sola dentro de un párrafo es un salto de línea.
  const porBloques = blancas >= llenas * 0.6;
  const bloques: string[][] = [];
  let actual: string[] = [];
  for (const l of lineas) {
    if (!l.trim()) {
      if (actual.length) bloques.push(actual);
      actual = [];
      if (!porBloques) bloques.push([]);
      continue;
    }
    if (porBloques) actual.push(l.trim());
    else bloques.push([l.replace(/^[ \u3000]+/, '').trimEnd()]);
  }
  if (actual.length) bloques.push(actual);
  // En texto por líneas, las líneas en blanco sueltas son espacios entre escenas: se conservan como párrafos vacíos.
  const cuerpo = bloques
    .map((b) => {
      if (!b.length) return '<p>&#160;</p>';
      const t = b.map((x) => esc(x.trim())).join('<br/>');
      if (b.length === 1 && CAPITULO_TXT.test(b[0])) return `<h1>${t}</h1>`;
      return `<p>${t}</p>`;
    })
    .join('\n')
    .replace(/^(<p>&#160;<\/p>\n)+/, '');
  return { titulo: nombreArchivo.replace(/\.[^.]+$/, ''), cuerpo, css: '', imagenes: new Map(), avisos: [] };
}

// ---------- OpenDocument ----------

const PROPIEDADES_ODF: [string, string][] = [
  ['fo:text-align', 'text-align'],
  ['fo:text-indent', 'text-indent'],
  ['fo:margin-top', 'margin-top'],
  ['fo:margin-bottom', 'margin-bottom'],
  ['fo:margin-left', 'margin-left'],
  ['fo:margin-right', 'margin-right'],
  ['fo:line-height', 'line-height'],
  ['fo:font-style', 'font-style'],
  ['fo:font-weight', 'font-weight'],
  ['fo:font-size', 'font-size'],
  ['fo:color', 'color'],
  ['fo:background-color', 'background-color'],
  ['fo:font-variant', 'font-variant'],
  ['fo:text-transform', 'text-transform'],
  ['fo:letter-spacing', 'letter-spacing'],
  ['fo:font-family', 'font-family'],
];

function cssDeEstilo(s: Nodo, fuentes: Map<string, string>): Record<string, string> {
  const d: Record<string, string> = {};
  for (const p of hijos(s)) {
    if (p.nodeType !== ELEMENTO || !/properties$/.test(nombre(p))) continue;
    for (const [odf, css] of PROPIEDADES_ODF) {
      let v = attr(p, odf);
      if (!v) continue;
      if (css === 'text-align') v = v === 'start' ? 'left' : v === 'end' ? 'right' : v;
      if (css === 'background-color' && v === 'transparent') continue;
      if (css === 'letter-spacing' && v === 'normal') continue;
      d[css] = v;
    }
    const fuente = attr(p, 'style:font-name');
    if (fuente) d['font-family'] = `"${fuentes.get(fuente) ?? fuente}"`;
    if (attr(p, 'style:text-underline-style') && attr(p, 'style:text-underline-style') !== 'none') d['text-decoration'] = 'underline';
    if (attr(p, 'style:text-line-through-style') && attr(p, 'style:text-line-through-style') !== 'none') d['text-decoration'] = 'line-through';
    const pos = attr(p, 'style:text-position');
    if (/^super/.test(pos)) d['vertical-align'] = 'super';
    else if (/^sub/.test(pos)) d['vertical-align'] = 'sub';
  }
  return d;
}

function claseOdf(nombreEstilo: string): string {
  return 'odf-' + nombreEstilo.replace(/_20_/g, '-').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function deOdt(datos: Uint8Array, nombreArchivo: string): Promise<Contenido> {
  const zip = await JSZip.loadAsync(datos);
  const contenido = await zip.file('content.xml')?.async('string');
  if (!contenido) throw new Error('El archivo .odt no tiene content.xml.');
  const estilosXml = (await zip.file('styles.xml')?.async('string')) ?? '';
  const meta = (await zip.file('meta.xml')?.async('string')) ?? '';
  const c = analizarXml(contenido);
  const st = estilosXml ? analizarXml(estilosXml) : undefined;
  const fuentes = new Map<string, string>();
  for (const raiz of [c, st]) {
    if (!raiz) continue;
    for (const f of todos(raiz, (n) => nombre(n) === 'font-face')) fuentes.set(attr(f, 'style:name'), (attr(f, 'svg:font-family') || attr(f, 'style:name')).replace(/^['"]|['"]$/g, ''));
  }
  // Estilos con nombre y automáticos; cada uno se aplana con su padre.
  const estilos = new Map<string, { padre?: string; familia: string; decl: Record<string, string> }>();
  const predeterminado: Record<string, Record<string, string>> = {};
  for (const raiz of [st, c]) {
    if (!raiz) continue;
    for (const s of todos(raiz, (n) => nombre(n) === 'style' || nombre(n) === 'default-style')) {
      const fam = attr(s, 'style:family');
      if (nombre(s) === 'default-style') predeterminado[fam] = cssDeEstilo(s, fuentes);
      else estilos.set(attr(s, 'style:name'), { padre: attr(s, 'style:parent-style-name') || undefined, familia: fam, decl: cssDeEstilo(s, fuentes) });
    }
  }
  const aplanado = (n: string, vistos = new Set<string>()): Record<string, string> => {
    const e = estilos.get(n);
    if (!e || vistos.has(n)) return {};
    vistos.add(n);
    return { ...(e.padre ? aplanado(e.padre, vistos) : {}), ...e.decl };
  };
  const usados = new Set<string>();
  const imagenes = new Map<string, Uint8Array>();
  const notas: string[] = [];
  const avisos: string[] = [];

  const enLinea = (n: Nodo): string => {
    let r = '';
    for (const h of hijos(n)) {
      if (h.nodeType === TEXTO) {
        r += esc(h.nodeValue ?? '');
        continue;
      }
      if (h.nodeType !== ELEMENTO) continue;
      const et = nombre(h);
      if (et === 's') r += ' '.repeat(Math.max(1, Number(attr(h, 'text:c')) || 1));
      else if (et === 'tab') r += ' ';
      else if (et === 'line-break') r += '<br/>';
      else if (et === 'span') {
        const s = attr(h, 'text:style-name');
        if (s) usados.add(s);
        r += s ? `<span class="${claseOdf(s)}">${enLinea(h)}</span>` : enLinea(h);
      } else if (et === 'a') r += `<a href="${escAttr(attr(h, 'xlink:href'))}">${enLinea(h)}</a>`;
      else if (et === 'note') {
        const k = notas.length + 1;
        const cuerpoNota = todos(h, (x) => nombre(x) === 'note-body')[0];
        notas.push(`<aside epub:type="footnote" id="nota-${k}"><p>${cuerpoNota ? todos(cuerpoNota, (x) => nombre(x) === 'p').map(enLinea).join('<br/>') : ''}</p></aside>`);
        r += `<a epub:type="noteref" href="#nota-${k}" id="ref-${k}">${k}</a>`;
      } else if (et === 'frame') r += imagen(h);
      else if (et === 'ruby') {
        const base = todos(h, (x) => nombre(x) === 'ruby-base')[0];
        const texto = todos(h, (x) => nombre(x) === 'ruby-text')[0];
        r += `<ruby>${base ? enLinea(base) : ''}<rt>${texto ? enLinea(texto) : ''}</rt></ruby>`;
      } else if (et !== 'soft-page-break' && et !== 'bookmark' && et !== 'bookmark-start' && et !== 'bookmark-end' && et !== 'annotation') r += enLinea(h);
    }
    return r;
  };
  const imagen = (frame: Nodo): string => {
    const img = todos(frame, (x) => nombre(x) === 'image')[0];
    const ruta = img ? attr(img, 'xlink:href') : '';
    const archivo = ruta ? zip.file(ruta) : null;
    if (!archivo) return '';
    const n = ruta.split('/').pop()!;
    imagenes.set(n, new Uint8Array()); // se rellena después (lectura asíncrona)
    const alt = todos(frame, (x) => nombre(x) === 'title' || nombre(x) === 'desc')[0]?.textContent ?? '';
    return `<img src="../Images/${escAttr(n)}" alt="${escAttr(alt)}"/>`;
  };
  const bloques = (n: Nodo): string => {
    let r = '';
    for (const h of hijos(n)) {
      if (h.nodeType !== ELEMENTO) continue;
      const et = nombre(h);
      const s = attr(h, 'text:style-name');
      if (s) usados.add(s);
      const clase = s ? ` class="${claseOdf(s)}"` : '';
      if (et === 'h') {
        const nivel = Math.min(3, Math.max(1, Number(attr(h, 'text:outline-level')) || 1));
        r += `<h${nivel}${clase}>${enLinea(h)}</h${nivel}>\n`;
      } else if (et === 'p') r += `<p${clase}>${enLinea(h)}</p>\n`;
      else if (et === 'list') r += `<ul>${todos(h, (x) => nombre(x) === 'list-item').map((li) => `<li>${todos(li, (x) => nombre(x) === 'p' || nombre(x) === 'h').map(enLinea).join('<br/>')}</li>`).join('')}</ul>\n`;
      else if (et === 'section' || et === 'table-of-content' || et === 'index-body') {
        if (et === 'section') r += bloques(h);
      } else if (et === 'table') {
        r += `<table>${todos(h, (x) => nombre(x) === 'table-row')
          .map((fila) => `<tr>${hijos(fila).filter((x) => nombre(x) === 'table-cell').map((celda) => `<td>${todos(celda, (x) => nombre(x) === 'p').map(enLinea).join('<br/>')}</td>`).join('')}</tr>`)
          .join('')}</table>\n`;
      }
    }
    return r;
  };
  const texto = todos(c, (n) => nombre(n) === 'text' && !!n.parentNode && nombre(n.parentNode) === 'body')[0];
  if (!texto) throw new Error('El archivo .odt no tiene texto.');
  let cuerpo = bloques(texto);
  if (notas.length) cuerpo += `<section epub:type="footnotes">${notas.join('')}</section>`;
  for (const n of imagenes.keys()) {
    const archivo = Object.keys(zip.files).find((k) => k.split('/').pop() === n);
    if (archivo) imagenes.set(n, await zip.file(archivo)!.async('uint8array'));
  }
  for (const [n, d] of imagenes) if (!d.length || !tipoPorContenido(d)) {
    imagenes.delete(n);
    avisos.push(`Se omitió la imagen «${n}» (formato que EPUB no admite).`);
    cuerpo = cuerpo.replace(new RegExp(`<img src="\\.\\./Images/${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g'), '');
  }
  // CSS: el párrafo predeterminado y cada estilo usado, aplanado con sus padres.
  const decl = (d: Record<string, string>) => Object.entries(d).map(([k, v]) => `${k}: ${v};`).join(' ');
  const reglas = [`p { ${decl({ ...predeterminado.paragraph, ...aplanado('Standard'), ...aplanado('Text_20_body') })} }`];
  for (const n of usados) {
    const e = estilos.get(n);
    if (!e) continue;
    const d = aplanado(n);
    if (Object.keys(d).length) reglas.push(`.${claseOdf(n)} { ${decl(d)} }`);
  }
  const titulo = meta.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1].trim() || nombreArchivo.replace(/\.[^.]+$/, '');
  return { titulo, cuerpo, css: reglas.join('\n'), imagenes, avisos };
}

/** Convierte HTML, Markdown, texto plano u OpenDocument en un EPUB para importarlo. */
export async function epubDeOtroFormato(nombreArchivo: string, datos: Uint8Array): Promise<{ epub: Uint8Array; avisos: string[] }> {
  const ext = nombreArchivo.toLowerCase().split('.').pop();
  let c: Contenido;
  if (ext === 'odt') c = await deOdt(datos, nombreArchivo);
  else {
    const t = decodificarTexto(datos);
    if (ext === 'md' || ext === 'markdown') c = await deMarkdown(t, nombreArchivo);
    else if (ext === 'txt') c = deTexto(t, nombreArchivo);
    else c = await deHtml(t, nombreArchivo);
  }
  return { epub: await epubDeContenido(c), avisos: c.avisos };
}
