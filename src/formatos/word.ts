// Word de ida y vuelta para corrección: se exporta el texto con estilos que el importador reconoce
// y, al volver, las correcciones se funden capítulo a capítulo en el proyecto sin tocar ilustraciones,
// tema, metadatos ni bloques XHTML.

import {
  AlignmentType, CommentRangeEnd, CommentRangeStart, CommentReference, Document, ExternalHyperlink, FootnoteReferenceRun, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, TextRun,
  type IRunOptions, type ParagraphChild,
} from 'docx';
import JSZip from 'jszip';
import type { Bloque, Inline, Libro, Nota, Recuadro, Recurso, Seccion } from '../model.js';
import { proponerCambios } from '../cambios.js';
import { anclarComentario, fundirComentarios, leerComentariosWord, textosComentados } from '../comentarios.js';
import { TIPOS_SECCION, VARIANTES_RECUADRO, normalizarInlines, nuevoId, temaCompleto } from '../model.js';
import { importarDocx } from './docx.js';
export { rubiesDeTexto } from './docx.js';

/** Secciones que se exportan a Word (las de texto). */
export function seccionesDeTexto(libro: Libro): Seccion[] {
  return libro.secciones.filter((s) => !['portada', 'ilustracion', 'indice'].includes(s.tipo));
}

const MARCADOR_XHTML = /^⟦XHTML (\d+)[^⟧]*⟧$/;
const MARCADOR_IMAGEN = /^⟦Imagen (\d+)[^⟧]*⟧$/;
const MARCADOR_RECUADRO = /^⟦Recuadro (\d+)[^⟧]*⟧$/;
const MARCADOR_FIN_RECUADRO = /^⟦Fin del recuadro (\d+)[^⟧]*⟧$/;

/** Quita «Etiqueta: » del principio de una línea de recuadro que vuelve de Word y devuelve la etiqueta. */
function separarEtiqueta(l: Inline[]): { etiqueta?: string; contenido: Inline[] } {
  const plano = l.map((i) => (i.tipo === 'texto' ? i.texto : i.tipo === 'ruby' ? i.base : '\u0000')).join('');
  const m = plano.match(/^([^\u0000:]{1,40}):\s/);
  if (!m) return { contenido: l };
  let quitar = m[0].length;
  const contenido: Inline[] = [];
  for (const i of l) {
    if (quitar > 0 && i.tipo === 'texto') {
      if (i.texto.length <= quitar) {
        quitar -= i.texto.length;
        continue;
      }
      contenido.push({ ...i, texto: i.texto.slice(quitar) });
      quitar = 0;
      continue;
    }
    contenido.push(i);
  }
  return { etiqueta: m[1].trim(), contenido: normalizarInlines(contenido) };
}

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
        // Tamaño (12 pt de base, en medios puntos), color y fondo propios del fragmento.
        ...(i.tipo === 'texto' && i.aspecto?.tamano ? { size: Math.round(24 * i.aspecto.tamano) } : {}),
        ...(i.tipo === 'texto' && i.aspecto?.color ? { color: i.aspecto.color.slice(1) } : {}),
        ...(i.tipo === 'texto' && i.aspecto?.fondo ? { shading: { fill: i.aspecto.fondo.slice(1) } } : {}),
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
  const estilosLibro = temaCompleto(libro).estilosParrafo ?? [];
  const propios = new Set(estilosLibro.map((e) => e.id));
  // 1 em = 12 pt = 240 vigésimos de punto = 24 medios puntos.
  const propiosWord = estilosLibro.map((e) => ({
    id: `EP-${e.id}`,
    name: e.nombre,
    basedOn: 'Normal',
    run: {
      ...(e.cursiva !== undefined ? { italics: e.cursiva } : {}),
      ...(e.negrita !== undefined ? { bold: e.negrita } : {}),
      ...(e.versalitas ? { smallCaps: true } : {}),
      ...(e.mayusculas ? { allCaps: true } : {}),
      ...(e.tamano ? { size: Math.round(24 * e.tamano) } : {}),
      ...(e.color ? { color: e.color.slice(1) } : {}),
    },
    paragraph: {
      ...(e.alinear ? { alignment: { izquierda: AlignmentType.LEFT, centro: AlignmentType.CENTER, derecha: AlignmentType.RIGHT, justificado: AlignmentType.JUSTIFIED }[e.alinear] } : {}),
      indent: { firstLine: Math.max(0, Math.round((e.sangria ?? 1.5) * 240)), ...(e.izquierda ? { left: Math.round(e.izquierda * 240) } : {}), ...(e.derecha ? { right: Math.round(e.derecha * 240) } : {}) },
      ...(e.antes !== undefined || e.despues !== undefined ? { spacing: { ...(e.antes !== undefined ? { before: Math.round(e.antes * 240) } : {}), ...(e.despues !== undefined ? { after: Math.round(e.despues * 240) } : {}) } } : {}),
    },
  }));
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
    let recuadros = 0;
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') registrar(b.contenido);
      if (b.tipo === 'lista') b.elementos.forEach(registrar);
      if (b.tipo === 'recuadro') b.lineas.forEach((l) => registrar(l.contenido));
      switch (b.tipo) {
        case 'parrafo': {
          const estilo = b.clase && propios.has(b.clase) ? `EP-${b.clase}` : ESTILO_WORD[b.estilo];
          hijos.push(
            new Paragraph({
              style: estilo,
              alignment: b.estilo === 'centrado' ? AlignmentType.CENTER : b.estilo === 'derecha' ? AlignmentType.RIGHT : undefined,
              // 1 em = 12 pt = 240 vigésimos de punto (el tamaño del texto del Word de corrección).
              ...(b.espacioAntes !== undefined || b.espacioDespues !== undefined
                ? { spacing: { ...(b.espacioAntes !== undefined ? { before: Math.round(b.espacioAntes * 240) } : {}), ...(b.espacioDespues !== undefined ? { after: Math.round(b.espacioDespues * 240) } : {}) } }
                : {}),
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
        case 'recuadro': {
          recuadros++;
          const nombre = VARIANTES_RECUADRO.find((v) => v.id === b.variante)?.nombre ?? 'Recuadro';
          const gris = { color: '808080' };
          hijos.push(new Paragraph({ children: [new TextRun({ text: `⟦Recuadro ${recuadros}: ${nombre}${b.titulo ? ` · ${b.titulo}` : ''} — no editar esta línea⟧`, ...gris })] }));
          for (const l of b.lineas) {
            const prefijo = (b.variante === 'estado' || b.variante === 'chat') && l.etiqueta ? [new TextRun({ text: `${l.etiqueta}: `, bold: true })] : [];
            hijos.push(new Paragraph({ style: 'Recuadro', children: [...prefijo, ...runs(l.contenido, numeros, cc)] }));
          }
          hijos.push(new Paragraph({ children: [new TextRun({ text: `⟦Fin del recuadro ${recuadros} — no editar esta línea⟧`, ...gris })] }));
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
        // Estilos de párrafo propios del libro.
        ...propiosWord,
        { id: 'Recuadro', name: 'Recuadro', basedOn: 'Normal', run: { font: 'Arial', size: 22 }, paragraph: { indent: { left: 567, right: 567, firstLine: 0 }, shading: { fill: 'EEF2F7' } } },
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
    b.tipo === 'parrafo' || b.tipo === 'subtitulo'
      ? { ...b, contenido: limpiar(b.contenido) }
      : b.tipo === 'lista'
        ? { ...b, elementos: b.elementos.map(limpiar) }
        : b.tipo === 'recuadro'
          ? { ...b, lineas: b.lineas.map((l) => ({ ...l, contenido: limpiar(l.contenido) })) }
          : b,
  );
}

const normalizar = (t: string) => t.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function textoDe(b: Bloque): string {
  return b.tipo === 'parrafo' ? b.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join('').trim() : '';
}

/** Funde en el libro las correcciones hechas en un Word exportado con exportarWord. Modifica `libro`. */
export async function importarCorrecciones(libro: Libro, datos: Uint8Array, opciones: { revisar?: boolean } = {}): Promise<ResumenCorrecciones> {
  // Con los párrafos vacíos: las líneas en blanco del libro vuelven igual.
  const { libro: corregido } = await importarDocx(datos, { vacios: true });
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
    const recuadrosOriginales = s.bloques.filter((b): b is Recuadro => b.tipo === 'recuadro');
    let indiceImagen = 0;
    const bloques: Bloque[] = [];
    let recuadro: { original: Recuadro; lineas: Inline[][] } | null = null;
    const cerrarRecuadro = () => {
      if (!recuadro) return;
      const { original, lineas } = recuadro;
      const conEtiqueta = original.variante === 'estado' || original.variante === 'chat';
      bloques.push({
        ...original,
        lineas: (lineas.length ? lineas : [[]]).map((c, j) => {
          const previa = original.lineas[j] ?? original.lineas[original.lineas.length - 1];
          const sep = conEtiqueta ? separarEtiqueta(c) : { contenido: c };
          const etiqueta = sep.etiqueta ?? previa?.etiqueta;
          return { ...(etiqueta && conEtiqueta ? { etiqueta } : {}), ...(previa?.lado ? { lado: previa.lado } : {}), contenido: sep.contenido };
        }),
      });
      recuadro = null;
    };
    for (const b of nueva.bloques) {
      const t = textoDe(b);
      const mr = t.match(MARCADOR_RECUADRO);
      if (mr) {
        cerrarRecuadro();
        const original = recuadrosOriginales[Number(mr[1]) - 1];
        if (original) recuadro = { original, lineas: [] };
        else resumen.avisos.push(`«${s.titulo}»: no se encontró el recuadro ${mr[1]}.`);
        continue;
      }
      if (MARCADOR_FIN_RECUADRO.test(t)) {
        cerrarRecuadro();
        continue;
      }
      if (recuadro) {
        if (b.tipo === 'parrafo') {
          if (b.contenido.length) recuadro.lineas.push(b.contenido);
          continue;
        }
        cerrarRecuadro();
      }
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
    cerrarRecuadro();
    // Lo que no viaja por el importador de Word (espacio propio, estilo propio, tamaño y color de fragmentos)
    // se recupera por orden: si el párrafo no cambió se queda el original entero; si cambió, su espacio y estilo.
    const sinAspecto = (b: Bloque) => {
      const [x] = sinComentarios([b]);
      return JSON.stringify(x.tipo === 'parrafo' ? { ...x, espacioAntes: undefined, espacioDespues: undefined, clase: undefined, contenido: normalizarInlines(x.contenido.map((i) => (i.tipo === 'texto' ? { ...i, aspecto: undefined } : i))) } : x);
    };
    const vacioP = (b: Bloque) => b.tipo === 'parrafo' && !b.contenido.length;
    const originales = { lleno: s.bloques.filter((b) => b.tipo === 'parrafo' && !vacioP(b)), vacio: s.bloques.filter(vacioP) };
    const cuenta = { lleno: 0, vacio: 0 };
    for (let k = 0; k < bloques.length; k++) {
      const b = bloques[k];
      if (b.tipo !== 'parrafo') continue;
      const tipo = vacioP(b) ? 'vacio' : 'lleno';
      const o = originales[tipo][cuenta[tipo]++];
      if (o?.tipo !== 'parrafo') continue;
      if (sinAspecto(o) === sinAspecto(b)) {
        bloques[k] = o;
        continue;
      }
      if (o.espacioAntes !== undefined) b.espacioAntes = o.espacioAntes;
      if (o.espacioDespues !== undefined) b.espacioDespues = o.espacioDespues;
      if (o.clase) b.clase = o.clase;
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
