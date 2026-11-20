/**
 * Páginas a color de un PDF: las imprentas cobran distinto el color y el blanco y negro,
 * así que se avisa de qué páginas llevan tinta de color (ilustraciones o texto).
 * Se mira el PDF final: los colores de relleno y trazo y los píxeles de cada imagen.
 */
import { inflateSync } from 'node:zlib';
import { Jimp } from 'jimp';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from 'pdf-lib';

/** Diferencia mínima entre canales (0–1) para considerar un color «de color» y no un gris. */
const TOLERANCIA = 0.08;
/** Parte mínima de los píxeles de una imagen que tienen que ser de color. */
const PARTE_COLOR = 0.005;

function datosFlujo(s: PDFRawStream): Uint8Array | undefined {
  const filtro = s.dict.get(PDFName.of('Filter'));
  const nombres = filtro instanceof PDFArray ? filtro.asArray().map(String) : filtro ? [String(filtro)] : [];
  let datos: Uint8Array = s.contents;
  for (const f of nombres) {
    if (f === '/FlateDecode') datos = inflateSync(datos);
    else return f === '/DCTDecode' && nombres.at(-1) === f ? datos : undefined;
  }
  return datos;
}

function esColor(c: number[]): boolean {
  if (c.length === 3) return Math.max(...c) - Math.min(...c) > TOLERANCIA;
  // CMYK: color si hay cian, magenta o amarillo distintos entre sí (C=M=Y es un gris «rico»).
  if (c.length === 4) return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) > TOLERANCIA;
  return false;
}

/** ¿Algún operador de color del flujo pinta en color? */
function contenidoConColor(texto: string): boolean {
  const num = String.raw`(-?\d*\.?\d+)`;
  const rgb = new RegExp(String.raw`(?:^|\s)${num}\s+${num}\s+${num}\s+(?:rg|RG)(?=\s)`, 'g');
  const cmyk = new RegExp(String.raw`(?:^|\s)${num}\s+${num}\s+${num}\s+${num}\s+(?:k|K)(?=\s)`, 'g');
  const sc = new RegExp(String.raw`(?:^|\s)${num}\s+${num}\s+${num}\s+(?:sc|SC|scn|SCN)(?=\s)`, 'g');
  for (const re of [rgb, cmyk, sc]) for (const m of texto.matchAll(re)) if (esColor(m.slice(1).map(Number))) return true;
  return false;
}

async function imagenConColor(s: PDFRawStream, doc: PDFDocument): Promise<boolean> {
  const d = s.dict;
  const espacio = doc.context.lookup(d.get(PDFName.of('ColorSpace')));
  let n = 3;
  if (espacio instanceof PDFName) {
    if (espacio === PDFName.of('DeviceGray') || espacio === PDFName.of('CalGray')) return false;
    if (espacio === PDFName.of('DeviceCMYK')) n = 4;
  } else if (espacio instanceof PDFArray) {
    const tipo = String(espacio.get(0));
    if (tipo === '/ICCBased') {
      const perfil = doc.context.lookup(espacio.get(1));
      const N = perfil instanceof PDFRawStream ? (perfil.dict.get(PDFName.of('N')) as PDFNumber | undefined)?.asNumber() : 3;
      if (N === 1) return false;
      n = N ?? 3;
    } else if (tipo === '/CalGray') return false;
    else if (tipo === '/Indexed') return true; // paletas: raras en Chromium; se cuentan como color por prudencia
  } else if (d.get(PDFName.of('ImageMask'))) return false;

  const ancho = (d.get(PDFName.of('Width')) as PDFNumber).asNumber();
  const alto = (d.get(PDFName.of('Height')) as PDFNumber).asNumber();
  const filtro = d.get(PDFName.of('Filter'));
  const esJpeg = String(filtro instanceof PDFArray ? filtro.get(filtro.size() - 1) : filtro) === '/DCTDecode';
  const crudo = datosFlujo(s);
  if (!crudo) return true;
  const paso = Math.max(1, Math.floor(Math.sqrt((ancho * alto) / 40_000)));
  let color = 0;
  let total = 0;
  if (esJpeg) {
    let img;
    try {
      img = await Jimp.read(Buffer.from(crudo));
    } catch {
      return true;
    }
    const b = img.bitmap.data;
    for (let y = 0; y < img.bitmap.height; y += paso)
      for (let x = 0; x < img.bitmap.width; x += paso) {
        const i = (y * img.bitmap.width + x) * 4;
        total++;
        if (Math.max(b[i], b[i + 1], b[i + 2]) - Math.min(b[i], b[i + 1], b[i + 2]) > TOLERANCIA * 255) color++;
      }
  } else {
    const bpc = (d.get(PDFName.of('BitsPerComponent')) as PDFNumber | undefined)?.asNumber() ?? 8;
    if (bpc !== 8 || crudo.length < ancho * alto * n) return true;
    for (let y = 0; y < alto; y += paso)
      for (let x = 0; x < ancho; x += paso) {
        const i = (y * ancho + x) * n;
        const c = Array.from(crudo.subarray(i, i + n), (v) => v / 255);
        total++;
        if (esColor(c)) color++;
      }
  }
  return total > 0 && color / total > PARTE_COLOR;
}

/** ¿Lleva color un flujo de contenido con sus recursos (incluidos los formularios anidados)? */
async function hayColor(contenidos: PDFRawStream[], recursos: PDFDict | undefined, doc: PDFDocument, vistos: Map<PDFObject, boolean>): Promise<boolean> {
  const texto = contenidos.map((c) => {
    const d = datosFlujo(c);
    return d ? Buffer.from(d).toString('latin1') : '';
  }).join('\n');
  if (contenidoConColor(texto)) return true;
  const xobjetos = recursos && doc.context.lookup(recursos.get(PDFName.of('XObject')));
  if (!(xobjetos instanceof PDFDict)) return false;
  for (const [nombre, ref] of xobjetos.entries()) {
    // Solo los objetos que se pintan de verdad en este contenido.
    if (!new RegExp(String.raw`${nombre.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s+Do\b`).test(texto)) continue;
    if (vistos.has(ref)) {
      if (vistos.get(ref)) return true;
      continue;
    }
    const x = doc.context.lookup(ref);
    let r = false;
    if (x instanceof PDFRawStream) {
      const sub = String(x.dict.get(PDFName.of('Subtype')));
      if (sub === '/Image') r = await imagenConColor(x, doc);
      else if (sub === '/Form') {
        vistos.set(ref, false);
        const rec = doc.context.lookup(x.dict.get(PDFName.of('Resources')));
        r = await hayColor([x], rec instanceof PDFDict ? rec : recursos, doc, vistos);
      }
    }
    vistos.set(ref, r);
    if (r) return true;
  }
  return false;
}

/** Números de página (desde 1) que llevan color. */
export async function paginasColor(pdf: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const vistos = new Map<PDFObject, boolean>();
  const res: number[] = [];
  const paginas = doc.getPages();
  for (let k = 0; k < paginas.length; k++) {
    const nodo = paginas[k].node;
    const c = nodo.get(PDFName.of('Contents'));
    const lista = (c instanceof PDFArray ? c.asArray() : c ? [c] : []).map((x) => doc.context.lookup(x)).filter((x): x is PDFRawStream => x instanceof PDFRawStream);
    const recursos = nodo.Resources();
    if (await hayColor(lista, recursos, doc, vistos)) res.push(k + 1);
  }
  return res;
}
