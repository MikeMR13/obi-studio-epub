// Word de ida y vuelta para corrección: se exporta el texto con estilos que el importador reconoce
// y, al volver, las correcciones se funden capítulo a capítulo en el proyecto sin tocar ilustraciones,
// tema, metadatos ni bloques XHTML.

import {
  AlignmentType, Document, ExternalHyperlink, FootnoteReferenceRun, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, TextRun,
  type IRunOptions, type ParagraphChild,
} from 'docx';
import type { Bloque, Inline, Libro, Nota, Recurso, Seccion } from '../model.js';
import { TIPOS_SECCION, nuevoId } from '../model.js';
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

function runs(lista: Inline[], notas: Map<string, number>): ParagraphChild[] {
  const salida: ParagraphChild[] = [];
  for (const i of lista) {
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
              children: runs(b.contenido, numeros),
            }),
          );
          break;
        }
        case 'subtitulo':
          hijos.push(new Paragraph({ heading: b.nivel === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(b.contenido, numeros) }));
          break;
        case 'separador':
          hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('* * *')] }));
          break;
        case 'lista':
          for (const e of b.elementos) {
            hijos.push(
              new Paragraph({
                ...(b.ordenada ? { numbering: { reference: 'numerada', level: 0 } } : { bullet: { level: 0 } }),
                children: runs(e, numeros),
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
    sections: [{ children: hijos }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export interface ResumenCorrecciones {
  actualizadas: string[];
  nuevas: string[];
  sinCambios: number;
  avisos: string[];
}

const normalizar = (t: string) => t.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function textoDe(b: Bloque): string {
  return b.tipo === 'parrafo' ? b.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join('').trim() : '';
}

/** Funde en el libro las correcciones hechas en un Word exportado con exportarWord. Modifica `libro`. */
export async function importarCorrecciones(libro: Libro, datos: Uint8Array): Promise<ResumenCorrecciones> {
  const { libro: corregido } = await importarDocx(datos);
  const resumen: ResumenCorrecciones = { actualizadas: [], nuevas: [], sinCambios: 0, avisos: [] };
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
    const antes = JSON.stringify({ b: sinVacios(s.bloques), n: s.notas.map((n) => n.contenido) }).replace(/"id":"n[^"]+"/g, '');
    const despues = JSON.stringify({ b: sinVacios(bloques), n: notas.map((n) => n.contenido) }).replace(/"id":"n[^"]+"/g, '');
    const tituloNuevo = esMarcador ? s.titulo : titulo;
    if (antes === despues && tituloNuevo === s.titulo) {
      resumen.sinCambios++;
      return;
    }
    s.bloques = bloques;
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
