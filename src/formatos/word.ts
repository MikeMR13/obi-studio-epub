// Word de ida y vuelta para corrección: se exporta el texto con estilos que el importador reconoce
// y, al volver, las correcciones se funden capítulo a capítulo en el proyecto sin tocar ilustraciones,
// tema, metadatos ni bloques XHTML.

import {
  AlignmentType, CommentRangeEnd, CommentRangeStart, CommentReference, Document, ExternalHyperlink, FootnoteReferenceRun, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, TextRun,
  type IRunOptions, type ParagraphChild,
} from 'docx';
import JSZip from 'jszip';
import type { Bloque, Inline, Libro, Nota, Recurso, Seccion } from '../model.js';
import { proponerCambios } from '../cambios.js';
import { anclarComentario, fundirComentarios, leerComentariosWord, textosComentados } from '../comentarios.js';
import { TIPOS_SECCION, normalizarInlines, nuevoId } from '../model.js';
import { importarDocx } from './docx.js';
export { rubiesDeTexto } from './docx.js';

/** Secciones que se exportan a Word (las de texto). */
export function seccionesDeTexto(libro: Libro): Seccion[] {
  return libro.secciones.filter((s) => !['portada', 'ilustracion', 'indice'].includes(s.tipo));
}

const MARCADOR_XHTML = /^⟦XHTML (\d+)[^⟧]*⟧$/;
const MARCADOR_IMAGEN = /^⟦Imagen (\d+)[^⟧]*⟧$/;

function encabezadoSeccion(s: Seccion): string {
  if (s.titulo) return s.titulo;
  return `⟦${TIPOS_SECCION.find((t) => t.id === s.tipo)?.nombre ?? 'Sección'}⟧`;
}

/** Números de comentario de Word por id del modelo; `cerrados` evita repetir un rango. */
interface ContextoComentarios {
  numeros: Map<string, number>;
  cerrados: Set<string>;
}

function runs(lista: Inline[], notas: Map<string, number>, cc?: ContextoComentarios): ParagraphChild[] {
  const salida: ParagraphChild[] = [];
  const abiertos: string[] = [];
  const cerrar = (id: string) => {
    const n = cc!.numeros.get(id)!;
    salida.push(new CommentRangeEnd(n), new TextRun({ children: [new CommentReference(n)] }));
    abiertos.splice(abiertos.indexOf(id), 1);
    cc!.cerrados.add(id);
  };
  for (const i of lista) {
    if (cc) {
      const ids = (i.tipo === 'texto' ? i.comentarios ?? [] : abiertos).filter((id) => cc.numeros.has(id));
      for (const id of [...abiertos]) if (!ids.includes(id)) cerrar(id);
      for (const id of ids)
        if (!abiertos.includes(id) && !cc.cerrados.has(id)) {
          salida.push(new CommentRangeStart(cc.numeros.get(id)!));
          abiertos.push(id);
        }
    }
    if (i.tipo === 'salto') salida.push(new TextRun({ text: '', break: 1 }));
    else if (i.tipo === 'nota') {
      const n = notas.get(i.id);
      if (n) salida.push(new FootnoteReferenceRun(n));
    } else {
      const m = i.marcas ?? [];
      // La furigana viaja como ｜base《lectura》 (convención de Aozora Bunko), legible en Word.
      const texto = i.tipo === 'ruby' ? `｜${i.base}《${i.lectura}》` : i.texto;
      const opciones: IRunOptions = {
        text: texto,
        bold: m.includes('negrita') || undefined,
        italics: m.includes('cursiva') || undefined,
        underline: m.includes('subrayado') ? {} : undefined,
        strike: m.includes('tachado') || undefined,
        smallCaps: m.includes('versalitas') || undefined,
        superScript: m.includes('superindice') || undefined,
        subScript: m.includes('subindice') || undefined,
        style: m.includes('enfasis') ? 'Enfasis' : undefined,
      };
      if (i.tipo === 'texto' && i.enlace) salida.push(new ExternalHyperlink({ link: i.enlace, children: [new TextRun({ ...opciones, style: 'Hyperlink' })] }));
      else salida.push(new TextRun(opciones));
    }
  }
  for (const id of [...abiertos]) cerrar(id);
  return salida;
}

const ESTILO_WORD: Record<string, string | undefined> = {
  pensamiento: 'Pensamiento',
  onomatopeya: 'Onomatopeya',
  carta: 'Carta',
  cita: 'Cita',
  'sin-sangria': 'SinSangria',
};

function tipoImagen(r: Recurso): 'png' | 'jpg' | 'gif' | undefined {
  return r.tipoMime === 'image/png' ? 'png' : r.tipoMime === 'image/jpeg' ? 'jpg' : r.tipoMime === 'image/gif' ? 'gif' : undefined;
}

export async function exportarWord(libro: Libro): Promise<Uint8Array> {
  const notasWord: Record<number, { children: Paragraph[] }> = {};
  let siguienteNota = 1;
  const hijos: Paragraph[] = [];
  const cc: ContextoComentarios = { numeros: new Map(), cerrados: new Set() };
  const comentariosWord: { id: number; author: string; date: Date; children: Paragraph[]; parentId?: number; resolved?: boolean }[] = [];
  const parrafosComentario = (t: string) => t.split('\n').map((l) => new Paragraph({ children: [new TextRun(l)] }));
  const fechaValida = (f: string) => (isNaN(new Date(f).getTime()) ? new Date() : new Date(f));
  for (const s of seccionesDeTexto(libro)) {
    const anclados = textosComentados(s.bloques);
    for (const c of s.comentarios ?? []) {
      // Solo viajan los comentarios con su texto en la sección; los demás se quedan en el proyecto.
      if (!anclados.has(c.id)) continue;
      const n = comentariosWord.length;
      cc.numeros.set(c.id, n);
      comentariosWord.push({ id: n, author: c.autor, date: fechaValida(c.fecha), children: parrafosComentario(c.texto), ...(c.resuelto ? { resolved: true } : {}) });
      for (const r of c.respuestas ?? [])
        comentariosWord.push({ id: comentariosWord.length, author: r.autor, date: fechaValida(r.fecha), children: parrafosComentario(r.texto), parentId: n });
    }
  }
  seccionesDeTexto(libro).forEach((s, k) => {
    hijos.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: k > 0, children: [new TextRun(encabezadoSeccion(s))] }));
    const numeros = new Map<string, number>();
    const notasPorId = new Map(s.notas.map((n) => [n.id, n]));
    const registrar = (l: Inline[]) => {
      for (const i of l) {
        if (i.tipo !== 'nota' || numeros.has(i.id) || !notasPorId.has(i.id)) continue;
        const n = siguienteNota++;
        numeros.set(i.id, n);
        notasWord[n] = { children: [new Paragraph({ children: runs(notasPorId.get(i.id)!.contenido, new Map()) })] };
      }
    };
    let crudos = 0;
    let imagenes = 0;
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') registrar(b.contenido);
      if (b.tipo === 'lista') b.elementos.forEach(registrar);
      switch (b.tipo) {
        case 'parrafo': {
          const estilo = ESTILO_WORD[b.estilo];
          hijos.push(
            new Paragraph({
              style: estilo,
              alignment: b.estilo === 'centrado' ? AlignmentType.CENTER : b.estilo === 'derecha' ? AlignmentType.RIGHT : undefined,
              children: runs(b.contenido, numeros, cc),
            }),
          );
          break;
        }
        case 'subtitulo':
          hijos.push(new Paragraph({ heading: b.nivel === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(b.contenido, numeros, cc) }));
          break;
        case 'separador':
          hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('* * *')] }));
          break;
        case 'lista':
          for (const e of b.elementos) {
            hijos.push(
              new Paragraph({
                ...(b.ordenada ? { numbering: { reference: 'numerada', level: 0 } } : { bullet: { level: 0 } }),
                children: runs(e, numeros, cc),
              }),
            );
          }
          break;
        case 'imagen': {
          imagenes++;
          const r = libro.recursos.find((x) => x.id === b.recurso);
          const tipo = r && tipoImagen(r);
          if (r && tipo && r.ancho && r.alto) {
            const escala = Math.min(1, 560 / r.ancho, 700 / r.alto);
            hijos.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    type: tipo,
                    data: Buffer.from(r.datos),
                    transformation: { width: Math.round(r.ancho * escala), height: Math.round(r.alto * escala) },
                    altText: { name: r.nombre, description: b.alt, title: b.alt },
                  }),
                ],
              }),
            );
          } else {
            hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`⟦Imagen ${imagenes}: ${r?.nombre ?? ''} — no editar esta línea⟧`)] }));
          }
          break;
        }
        case 'crudo': {
          crudos++;
          const resumen = b.xhtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
          hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `⟦XHTML ${crudos}: ${resumen} — no editar esta línea⟧`, color: '808080' })] }));
          break;
        }
      }
    }
  });
  const doc = new Document({
    creator: libro.metadatos.creditos.find((c) => c.rol === 'aut')?.nombre ?? 'Obi Studio',
    lastModifiedBy: 'Obi Studio',
    title: libro.metadatos.titulo,
    description: 'Exportado desde Obi Studio para corrección. Vuelve a importarlo con «Importar correcciones de Word».',
    styles: {
      default: { document: { run: { font: 'Georgia', size: 24 }, paragraph: { indent: { firstLine: 360 }, spacing: { line: 336 } } } },
      paragraphStyles: [
        { id: 'Pensamiento', name: 'Pensamiento', basedOn: 'Normal', run: { italics: true } },
        { id: 'Onomatopeya', name: 'Onomatopeya', basedOn: 'Normal', run: { bold: true }, paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 } } },
        { id: 'Carta', name: 'Carta', basedOn: 'Normal', run: { italics: true }, paragraph: { indent: { left: 720, right: 720, firstLine: 0 } } },
        { id: 'Cita', name: 'Cita', basedOn: 'Normal', paragraph: { indent: { left: 720, right: 720, firstLine: 0 } } },
        { id: 'SinSangria', name: 'Sin sangría', basedOn: 'Normal', paragraph: { indent: { firstLine: 0 } } },
      ],
      characterStyles: [{ id: 'Enfasis', name: 'Énfasis', run: { emphasisMark: { type: 'dot' } } }],
    },
    numbering: { config: [{ reference: 'numerada', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] },
    footnotes: notasWord,
    ...(comentariosWord.length ? { comments: { children: comentariosWord } } : {}),
    sections: [{ children: hijos }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export interface ResumenCorrecciones {
  actualizadas: string[];
  nuevas: string[];
  sinCambios: number;
  /** Comentarios y respuestas nuevos del corrector. */
  comentarios: number;
  /** Cambios propuestos (al importar para revisar). */
  cambios: number;
  avisos: string[];
}

/** Bloques sin anclas de comentario, para comparar el texto. */
function sinComentarios(bloques: Bloque[]): Bloque[] {
  const limpiar = (l: Inline[]) => normalizarInlines(l.map((i) => (i.tipo === 'texto' && i.comentarios ? (({ comentarios: _c, ...r }) => r)(i) : i)));
  return bloques.map((b) =>
    b.tipo === 'parrafo' || b.tipo === 'subtitulo' ? { ...b, contenido: limpiar(b.contenido) } : b.tipo === 'lista' ? { ...b, elementos: b.elementos.map(limpiar) } : b,
  );
}

const normalizar = (t: string) => t.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function textoDe(b: Bloque): string {
  return b.tipo === 'parrafo' ? b.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join('').trim() : '';
}

/** Funde en el libro las correcciones hechas en un Word exportado con exportarWord. Modifica `libro`. */
export async function importarCorrecciones(libro: Libro, datos: Uint8Array, opciones: { revisar?: boolean } = {}): Promise<ResumenCorrecciones> {
  const { libro: corregido } = await importarDocx(datos);
  const resumen: ResumenCorrecciones = { actualizadas: [], nuevas: [], sinCambios: 0, comentarios: 0, cambios: 0, avisos: [] };
  const zipWord = await JSZip.loadAsync(datos);
  const core = (await zipWord.file('docProps/core.xml')?.async('string')) ?? '';
  // Si nadie guardó el Word después de exportarlo, no hay nombre de corrector.
  const quien = core.match(/<cp:lastModifiedBy>([^<]+)</)?.[1]?.trim();
  const autor = quien && quien !== 'Un-named' && quien !== 'Obi Studio' ? quien : 'Corrección';
  const fecha = new Date().toISOString();
  const deWord = await leerComentariosWord(datos);
  const comentariosDe = (k: number) => {
    const raices = deWord.filter((c) => c.seccion === k && !c.padre);
    const ids = new Set(raices.map((c) => c.wid));
    return [...raices, ...deWord.filter((c) => c.padre && ids.has(c.padre))];
  };
  const fundir = (s: Seccion, k: number) => {
    const r = fundirComentarios(s.bloques, s.comentarios ?? [], comentariosDe(k), deWord);
    resumen.comentarios += r.nuevos;
    if (r.comentarios.length) s.comentarios = r.comentarios;
    else delete s.comentarios;
  };
  const xml = zipWord.file('word/document.xml');
  const documento = xml ? await xml.async('string') : '';
  const marcas = (documento.match(/<w:(ins|del) /g) ?? []).length;
  if (marcas) resumen.avisos.push(`El Word tenía ${marcas} cambio${marcas === 1 ? '' : 's'} con control de cambios sin aceptar; se tomaron como aceptados.`);
  const destino = seccionesDeTexto(libro);
  const usadas = new Set<Seccion>();
  let ultimaPosicion = -1;

  corregido.secciones.forEach((nueva, k) => {
    const titulo = nueva.titulo;
    const esMarcador = /^⟦.+⟧$/.test(titulo);
    // Primero por título; si no, por posición.
    let s = destino.find((x) => !usadas.has(x) && normalizar(encabezadoSeccion(x)) === normalizar(titulo));
    if (!s && destino[k] && !usadas.has(destino[k])) s = destino[k];
    if (!s) {
      // Capítulo nuevo escrito en Word: se inserta después del último emparejado.
      const sec: Seccion = { ...nueva, id: nuevoId('s'), titulo: esMarcador ? '' : titulo };
      for (const b of sec.bloques) if (b.tipo === 'imagen') b.recurso = reutilizarImagen(libro, corregido, b.recurso);
      fundir(sec, k);
      const pos = ultimaPosicion >= 0 ? ultimaPosicion + 1 : libro.secciones.length;
      libro.secciones.splice(pos, 0, sec);
      ultimaPosicion = pos;
      resumen.nuevas.push(sec.titulo || TIPOS_SECCION.find((t) => t.id === sec.tipo)?.nombre || 'Sección');
      return;
    }
    usadas.add(s);
    ultimaPosicion = libro.secciones.indexOf(s);

    // Restaurar bloques XHTML e imágenes que viajaron como marcadores.
    const crudos = s.bloques.filter((b) => b.tipo === 'crudo');
    const imagenes = s.bloques.filter((b) => b.tipo === 'imagen');
    let indiceImagen = 0;
    const bloques: Bloque[] = [];
    for (const b of nueva.bloques) {
      const t = textoDe(b);
      const mx = t.match(MARCADOR_XHTML);
      const mi = t.match(MARCADOR_IMAGEN);
      if (mx) {
        const original = crudos[Number(mx[1]) - 1];
        if (original) bloques.push(original);
        else resumen.avisos.push(`«${s.titulo}»: no se encontró el bloque XHTML ${mx[1]}.`);
        continue;
      }
      if (mi) {
        const original = imagenes[Number(mi[1]) - 1];
        if (original) bloques.push(original);
        continue;
      }
      if (b.tipo === 'imagen') {
        // La imagen vuelve de Word: se reutiliza la del libro si es la misma, conservando su descripción si Word la perdió.
        const id = reutilizarImagen(libro, corregido, b.recurso);
        const previa = imagenes[indiceImagen++];
        bloques.push({ ...b, recurso: id, alt: b.alt || (previa?.tipo === 'imagen' ? previa.alt : ''), ...(previa?.tipo === 'imagen' && previa.decorativa ? { decorativa: true } : {}) });
        continue;
      }
      bloques.push(b);
    }
    const notas: Nota[] = nueva.notas;
    // Los párrafos vacíos no viajan por Word: no cuentan como cambio.
    const sinVacios = (l: Bloque[]) => l.filter((b) => !(b.tipo === 'parrafo' && !b.contenido.length));
    const antes = JSON.stringify({ b: sinVacios(sinComentarios(s.bloques)), n: s.notas.map((n) => n.contenido) }).replace(/"id":"n[^"]+"/g, '');
    const despues = JSON.stringify({ b: sinVacios(bloques), n: notas.map((n) => n.contenido) }).replace(/"id":"n[^"]+"/g, '');
    const tituloNuevo = esMarcador ? s.titulo : titulo;
    if (antes === despues && tituloNuevo === s.titulo) {
      resumen.sinCambios++;
      fundir(s, k);
      return;
    }
    if (opciones.revisar) {
      // Control de cambios: el texto no cambia; se proponen los cambios para aceptarlos o rechazarlos.
      fundir(s, k);
      if (s.cambios?.length) resumen.avisos.push(`«${encabezadoSeccion(s)}»: se sustituyeron ${s.cambios.length} cambios que seguían pendientes.`);
      const propuestos = proponerCambios(s, bloques, notas, autor, fecha, tituloNuevo);
      if (propuestos.length) {
        s.cambios = propuestos;
        resumen.cambios += propuestos.length;
        resumen.actualizadas.push(s.titulo || TIPOS_SECCION.find((t) => t.id === s!.tipo)?.nombre || 'Sección');
      } else {
        delete s.cambios;
        resumen.sinCambios++;
      }
      return;
    }
    // Los comentarios del proyecto se vuelven a anclar a su texto en la versión corregida.
    const anclas = textosComentados(s.bloques);
    s.bloques = bloques;
    for (const c of s.comentarios ?? []) {
      const texto = anclas.get(c.id);
      if (texto && !anclarComentario(s.bloques, c.id, texto)) c.cita = texto.slice(0, 500);
    }
    fundir(s, k);
    s.notas = notas;
    s.titulo = tituloNuevo;
    resumen.actualizadas.push(s.titulo || TIPOS_SECCION.find((t) => t.id === s!.tipo)?.nombre || 'Sección');
  });
  for (const s of destino) {
    if (!usadas.has(s)) resumen.avisos.push(`«${encabezadoSeccion(s)}» no estaba en el Word; se dejó como estaba.`);
  }
  return resumen;
}

function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function reutilizarImagen(libro: Libro, origen: Libro, id: string): string {
  const r = origen.recursos.find((x) => x.id === id);
  if (!r) return id;
  const existente = libro.recursos.find((x) => iguales(x.datos, r.datos));
  if (existente) return existente.id;
  if (!libro.recursos.some((x) => x.id === r.id)) {
    let nombre = r.nombre;
    let k = 2;
    while (libro.recursos.some((x) => x.nombre === nombre)) nombre = r.nombre.replace(/(\.[^.]+)$/, `-${k++}$1`);
    libro.recursos.push({ ...r, nombre });
  }
  return r.id;
}
