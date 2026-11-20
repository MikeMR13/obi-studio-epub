// PDF/X-1a:2001 para imprentas que lo piden (offset, IngramSpark en algunos formatos).
// Ghostscript (licencia AGPL) no se incluye en el instalador: se usa el que tenga instalado el usuario.
// La conversión pasa todo a CMYK (texto en negro puro, solo K), aplana transparencias (PDF 1.3),
// añade el OutputIntent con el perfil CMYK y conserva TrimBox y BleedBox.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

export class ErrorPdfX extends Error {}

/** Ruta de Ghostscript, o undefined si no está instalado. */
export function buscarGhostscript(): string | undefined {
  const candidatos: string[] = [];
  if (process.env.OBI_GHOSTSCRIPT) candidatos.push(process.env.OBI_GHOSTSCRIPT);
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\gs', 'C:\\Program Files (x86)\\gs']) {
      try {
        for (const v of readdirSync(base).sort().reverse()) candidatos.push(join(base, v, 'bin', 'gswin64c.exe'), join(base, v, 'bin', 'gswin32c.exe'));
      } catch {
        // No instalado en esa carpeta.
      }
    }
  } else {
    candidatos.push('/usr/bin/gs', '/usr/local/bin/gs', '/opt/homebrew/bin/gs', '/opt/local/bin/gs');
  }
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':'))
    if (dir) candidatos.push(join(dir, process.platform === 'win32' ? 'gswin64c.exe' : 'gs'));
  return candidatos.find((c) => existsSync(c));
}

function ejecutar(programa: string, args: string[]): Promise<{ salida: string }> {
  return new Promise((ok, mal) =>
    execFile(programa, args, { maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60_000 }, (e, salida, errores) =>
      e ? mal(new ErrorPdfX(`Ghostscript falló: ${(errores || e.message).trim().split('\n').slice(-3).join(' ')}`)) : ok({ salida }),
    ),
  );
}

/** Perfil CMYK: el que trae Ghostscript (SWOP de Artifex) salvo que se indique otro. */
function perfilCmyk(gs: string, perfil?: string): string {
  if (perfil) {
    if (!existsSync(perfil)) throw new ErrorPdfX(`No se encontró el perfil ICC «${perfil}».`);
    return perfil;
  }
  const candidatos = [join(dirname(dirname(gs)), 'iccprofiles', 'default_cmyk.icc')];
  for (const base of ['/usr/share/ghostscript', '/usr/local/share/ghostscript', '/opt/homebrew/share/ghostscript']) {
    try {
      for (const v of readdirSync(base)) candidatos.push(join(base, v, 'iccprofiles', 'default_cmyk.icc'));
    } catch {
      // Sin esa carpeta.
    }
  }
  const r = candidatos.find((c) => existsSync(c));
  if (!r) throw new ErrorPdfX('No se encontró un perfil CMYK (default_cmyk.icc). Indica uno con OBI_PERFIL_CMYK.');
  return r;
}

const ps = (t: string) => `(${t.replace(/[\\()]/g, '\\$&')})`;

export interface OpcionesPdfX {
  titulo: string;
  /** Perfil ICC CMYK de salida. */
  perfil?: string;
  /** Identificador de la condición de impresión del perfil (registro de color.org). */
  condicion?: string;
}

/** Convierte un PDF de impresión a PDF/X-1a:2001. */
export async function convertirPdfX(pdf: Uint8Array, o: OpcionesPdfX): Promise<Uint8Array> {
  const gs = buscarGhostscript();
  if (!gs) throw new ErrorPdfX('Para el PDF/X-1a hace falta Ghostscript instalado (gratuito: ghostscript.com). También puedes indicar su ruta con OBI_GHOSTSCRIPT.');
  const icc = perfilCmyk(gs, o.perfil ?? process.env.OBI_PERFIL_CMYK);
  const carpeta = await mkdtemp(join(tmpdir(), 'obi-pdfx-'));
  try {
    const entrada = join(carpeta, 'entrada.pdf');
    const salida = join(carpeta, 'salida.pdf');
    const definicion = join(carpeta, 'pdfx.ps');
    await writeFile(entrada, pdf);
    await writeFile(
      definicion,
      `%!
/ICCProfile ${ps(icc.replace(/\\/g, '/'))} def
[/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
[{icc_PDFX} <</N 4>> /PUT pdfmark
[{icc_PDFX} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[{OutputIntent_PDFX} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputCondition ${ps(o.condicion ?? 'CGATS TR 001 (SWOP)')}
  /OutputConditionIdentifier ${ps(o.condicion ?? 'CGATS TR 001')}
  /RegistryName (http://www.color.org)
  /Info ${ps(o.condicion ?? 'U.S. Web Coated (SWOP)')}
  /DestOutputProfile {icc_PDFX}
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFX} ]>> /PUT pdfmark
[ /Title ${ps(o.titulo.replace(/[^\x20-\x7e]/g, '?'))} /DOCINFO pdfmark
`,
    );
    await ejecutar(gs, [
      '-dPDFX',
      '-dBATCH',
      '-dNOPAUSE',
      '-dQUIET',
      '-dSAFER',
      `--permit-file-read=${icc.replace(/\\/g, '/')}`,
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.3',
      '-sColorConversionStrategy=CMYK',
      '-sProcessColorModel=DeviceCMYK',
      '-dBlackText',
      '-dBlackVector',
      '-dEmbedAllFonts=true',
      '-dSubsetFonts=true',
      '-dAutoRotatePages=/None',
      '-dPDFSETTINGS=/prepress',
      `-sOutputFile=${salida}`,
      definicion,
      entrada,
    ]);
    return await ajustar(new Uint8Array(await readFile(salida)), pdf, o.titulo);
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

/** Marca el resultado como PDF/X-1a:2001 y repone las cajas de corte y sangrado del original. */
async function ajustar(convertido: Uint8Array, original: Uint8Array, titulo: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(convertido, { updateMetadata: false });
  const orig = await PDFDocument.load(original, { updateMetadata: false });
  const paginas = doc.getPages();
  const fuentes = orig.getPages();
  if (paginas.length !== fuentes.length) throw new ErrorPdfX('La conversión cambió el número de páginas.');
  paginas.forEach((p, k) => {
    const f = fuentes[k];
    const m = f.getMediaBox();
    const t = f.getTrimBox();
    const b = f.getBleedBox();
    p.setMediaBox(m.x, m.y, m.width, m.height);
    p.setTrimBox(t.x, t.y, t.width, t.height);
    p.setBleedBox(b.x, b.y, b.width, b.height);
    p.node.delete(PDFName.of('CropBox'));
    p.node.delete(PDFName.of('ArtBox'));
  });
  doc.setTitle(titulo);
  // getInfoDict es privado en los tipos de pdf-lib, pero es la forma de añadir claves propias al diccionario Info.
  const info = (doc as unknown as { getInfoDict(): { set(k: PDFName, v: unknown): void } }).getInfoDict();
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-1a:2001'));
  info.set(PDFName.of('GTS_PDFXConformance'), PDFString.of('PDF/X-1a:2001'));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  doc.setProducer('Obi Studio EPUB (Vivliostyle + Chromium + Ghostscript)');
  // PDF/X-1a:2001 se basa en PDF 1.3: cabecera 1.3 y sin flujos de objetos (que son de PDF 1.5).
  // pdf-lib siempre escribe «%PDF-1.7»: se cambia por «%PDF-1.3» (misma longitud, no mueve los desplazamientos).
  const bytes = await doc.save({ useObjectStreams: false });
  bytes.set(new TextEncoder().encode('%PDF-1.3'), 0);
  return bytes;
}
