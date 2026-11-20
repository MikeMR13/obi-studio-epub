/**
 * Muestra gratuita: un EPUB con las primeras secciones y una página final con el enlace de compra,
 * y una página web de una sola pieza (imágenes y fuentes dentro) para colgarla en cualquier sitio.
 */
import { cssLibro, seccionXhtml } from './compilar.js';
import { datosArchivoFuente, fuentesTema, MIME_FUENTE } from './fuentes.js';
import { ROLES, esVertical, nuevaSeccion, temaCompleto, parrafo, uuid, type Libro, type Seccion } from './model.js';

export interface OpcionesMuestra {
  /** Ids de las secciones que entran en la muestra, en el orden del libro. */
  secciones: string[];
  /** Enlace de compra (http o https). */
  enlace?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Solo enlaces web: nada de javascript: ni rutas locales. */
export function enlaceValido(enlace?: string): string | undefined {
  const e = enlace?.trim();
  if (!e) return undefined;
  try {
    const u = new URL(e);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Secciones propuestas: todo lo anterior al primer capítulo (sin índice) y el primer capítulo. */
export function seccionesPredeterminadas(libro: Libro): string[] {
  const ids: string[] = [];
  for (const s of libro.secciones) {
    if (s.tipo === 'indice') continue;
    ids.push(s.id);
    if (s.tipo === 'capitulo') break;
  }
  return ids;
}

function elegidas(libro: Libro, op: OpcionesMuestra): Seccion[] {
  const ids = new Set(op.secciones);
  const lista = libro.secciones.filter((s) => ids.has(s.id));
  if (!lista.some((s) => s.tipo !== 'portada')) throw new Error('Elige al menos una sección con texto para la muestra.');
  return lista;
}

/** Copia del libro con las secciones elegidas y la página «Fin de la muestra». Identificador propio para que las tiendas no la confundan con el libro. */
export function libroMuestra(libro: Libro, op: OpcionesMuestra): Libro {
  const copia: Libro = structuredClone(libro);
  const enlace = enlaceValido(op.enlace);
  copia.secciones = elegidas(copia, op).map((s) => ({ ...s, comentarios: undefined, cambios: undefined }));
  const fin = nuevaSeccion('otro', 'Fin de la muestra');
  fin.bloques = [
    parrafo(`Aquí termina la muestra gratuita de «${libro.metadatos.titulo}».`, 'centrado'),
    parrafo('Si te ha gustado, consigue el libro completo.', 'centrado'),
  ];
  if (enlace) fin.bloques.push({ tipo: 'crudo', xhtml: `<p class="centrado"><a href="${escAttr(enlace)}">Comprar el libro completo</a></p>` });
  copia.secciones.push(fin);
  copia.metadatos = {
    ...copia.metadatos,
    titulo: `${libro.metadatos.titulo} (muestra)`,
    identificador: `urn:uuid:${uuid()}`,
  };
  // Solo los recursos que siguen en uso (el compilador ignora el resto, pero así el modelo queda limpio).
  const usados = new Set<string>();
  if (copia.metadatos.portada) usados.add(copia.metadatos.portada);
  if (copia.tema.separadorImagen) usados.add(copia.tema.separadorImagen);
  for (const s of copia.secciones) {
    if (s.imagenCabecera) usados.add(s.imagenCabecera);
    for (const b of s.bloques) {
      if (b.tipo === 'imagen') usados.add(b.recurso);
      if (b.tipo === 'crudo') for (const r of copia.recursos) if (b.xhtml.includes(r.nombre)) usados.add(r.id);
    }
  }
  copia.recursos = copia.recursos.filter((r) => usados.has(r.id));
  return copia;
}

function base64(datos: Uint8Array): string {
  return Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength).toString('base64');
}

/** Página web de una sola pieza: portada, sinopsis, créditos, botón de compra y las secciones de la muestra. */
export function sitioMuestra(libro: Libro, op: OpcionesMuestra): string {
  const enlace = enlaceValido(op.enlace);
  const secciones = elegidas(libro, op).filter((s) => s.tipo !== 'portada' && s.tipo !== 'indice');
  const datosImg = new Map(libro.recursos.map((r) => [r.nombre, `data:${r.tipoMime};base64,${base64(r.datos)}`]));
  const conImagenes = (html: string) => html.replace(/(src|href)="img\/([^"]+)"/g, (todo, attr, nombre) => {
    const d = datosImg.get(decodeURIComponent(nombre));
    return d ? `${attr}="${d}"` : todo;
  });
  const fuentes = new Map(fuentesTema(temaCompleto(libro), false, libro).archivos.map((a) => [a.archivo, a]));
  const css = cssLibro(libro).replace(/url\('fuentes\/([^']+)'\)/g, (todo, archivo) => {
    const a = fuentes.get(archivo);
    const d = a && datosArchivoFuente(a);
    return d ? `url('data:${MIME_FUENTE[a.formato ?? 'woff2']};base64,${base64(d)}')` : todo;
  }).replace(/^@charset[^;]*;/, '');

  const m = libro.metadatos;
  const lang = escAttr(m.idioma || 'es');
  const portada = libro.recursos.find((r) => r.id === m.portada);
  const creditos = m.creditos
    .filter((c) => c.nombre.trim())
    .map((c) => `<li><span>${esc(ROLES.find((r) => r.id === c.rol)?.nombre ?? c.rol)}</span> ${esc(c.nombre)}</li>`)
    .join('');
  const boton = enlace ? `<p class="comprar"><a href="${escAttr(enlace)}" rel="noopener">Comprar el libro completo</a></p>` : '';
  const indice = secciones
    .filter((s) => s.titulo)
    .map((s) => `<li><a href="#${escAttr(s.id)}">${esc(s.titulo)}</a></li>`)
    .join('');
  const cuerpo = secciones
    .map((s) => {
      const x = seccionXhtml(libro, s).match(/<section[\s\S]*<\/section>/)?.[0] ?? '';
      // Atributos propios del EPUB que sobran en HTML.
      const html = x.replace(/ epub:type="[^"]*"/g, '');
      return `<article id="${escAttr(s.id)}" class="seccion-muestra">\n${conImagenes(html)}\n</article>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.titulo)} — muestra gratuita</title>
${m.descripcion ? `<meta name="description" content="${escAttr(m.descripcion.slice(0, 300))}">` : ''}
<meta name="generator" content="Obi Studio">
<style>
${css}
/* Página de la muestra */
body { max-width: 40em; margin: 0 auto; padding: 0 1.2em 4em; background: #fdfcf9; color: #222; }
.ficha { display: flex; gap: 1.5em; align-items: flex-start; padding: 2em 0; border-bottom: 1px solid #ddd; margin-bottom: 2em; }
.ficha img { width: 11em; max-width: 40%; height: auto; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
.ficha h1 { margin: 0 0 .3em; font-size: 1.8em; }
.ficha .subtitulo { margin: 0 0 1em; font-style: italic; text-indent: 0; }
.ficha ul { list-style: none; padding: 0; margin: 0 0 1em; }
.ficha li span { color: #666; font-size: .85em; }
.sinopsis p { text-indent: 0; }
.comprar { text-indent: 0; margin: 1.5em 0; }
.comprar a { display: inline-block; padding: .6em 1.4em; border-radius: 6px; background: #8a3b2e; color: #fff; text-decoration: none; font-family: sans-serif; }
nav.muestra ol { padding-left: 1.2em; }
.seccion-muestra { margin: 3em 0; padding-top: 2em; border-top: 1px solid #eee; }
.seccion-muestra img { max-width: 100%; height: auto; }
footer p { text-align: center; text-indent: 0; }
footer { margin-top: 3em; text-align: center; font-family: sans-serif; font-size: .9em; color: #666; }
${esVertical(libro) ? `html, body { writing-mode: horizontal-tb; -webkit-writing-mode: horizontal-tb; }
.seccion-muestra { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; height: min(36em, 85vh); overflow-x: auto; max-width: 100%; }
.seccion-muestra img { max-height: 100%; max-width: none; width: auto; }` : ''}
@media (max-width: 34em) { .ficha { flex-direction: column; } .ficha img { max-width: 60%; } }
</style>
</head>
<body>
<header class="ficha">
${portada ? `<img src="${datosImg.get(portada.nombre)}" alt="Portada de ${escAttr(m.titulo)}">` : ''}
<div>
<h1>${esc(m.titulo)}</h1>
${m.subtitulo ? `<p class="subtitulo">${esc(m.subtitulo)}</p>` : ''}
${creditos ? `<ul>${creditos}</ul>` : ''}
${m.descripcion ? `<div class="sinopsis">${m.descripcion.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
${boton}
</div>
</header>
<main>
${indice ? `<nav class="muestra" aria-label="Contenido de la muestra"><h2>Contenido de la muestra</h2><ol>${indice}</ol></nav>` : ''}
${cuerpo}
</main>
<footer>
<p>Fin de la muestra gratuita.</p>
${boton}
</footer>
</body>
</html>
`;
}
