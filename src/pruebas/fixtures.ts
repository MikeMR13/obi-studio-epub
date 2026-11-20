import type { Bloque } from '../model.js';
// Documentos de prueba generados al vuelo.

import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import {
  AlignmentType, Document, FootnoteReferenceRun, HeadingLevel, ImageRun, Packer, Paragraph, TextRun,
} from 'docx';

function crc32(d: Uint8Array): number {
  let c = ~0;
  for (const b of d) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** PNG de un color, sin dependencias. */
export function pngSolido(ancho: number, alto: number, rgb: [number, number, number] = [200, 80, 80]): Uint8Array {
  const fila = new Uint8Array(1 + ancho * 3);
  for (let x = 0; x < ancho; x++) fila.set(rgb, 1 + x * 3);
  const crudo = new Uint8Array(fila.length * alto);
  for (let y = 0; y < alto; y++) crudo.set(fila, y * fila.length);
  const trozo = (tipo: string, datos: Uint8Array) => {
    const t = new TextEncoder().encode(tipo);
    const out = new Uint8Array(12 + datos.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, datos.length);
    out.set(t, 4);
    out.set(datos, 8);
    const c = new Uint8Array(t.length + datos.length);
    c.set(t);
    c.set(datos, t.length);
    v.setUint32(8 + datos.length, crc32(c));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, ancho);
  v.setUint32(4, alto);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const partes = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', new Uint8Array(deflateSync(crudo))),
    trozo('IEND', new Uint8Array()),
  ];
  const total = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) {
    total.set(p, o);
    o += p.length;
  }
  return total;
}

export async function docxDePrueba(): Promise<Uint8Array> {
  const doc = new Document({
    creator: 'Autora de Prueba',
    title: 'La espada del alba',
    styles: {
      paragraphStyles: [{ id: 'Pensamiento', name: 'Pensamiento', basedOn: 'Normal', run: { italics: true } }],
    },
    footnotes: { 1: { children: [new Paragraph('Nota de la traductora: juego de palabras.')] } },
    sections: [
      {
        children: [
          new Paragraph({ text: 'Prólogo', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun('—¿Quién anda ahí? —preguntó Aria.')] }),
          new Paragraph({ children: [new TextRun('Nadie respondió.'), new FootnoteReferenceRun(1)] }),
          new Paragraph({ text: '* * *', alignment: AlignmentType.CENTER }),
          new Paragraph({ text: 'No puede ser.', style: 'Pensamiento' }),
          new Paragraph({ text: 'Capítulo 1: El despertar', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun('Era un día '), new TextRun({ text: 'muy', bold: true }), new TextRun(' '), new TextRun({ text: 'extraño', italics: true }), new TextRun('.')],
          }),
          new Paragraph({ text: '¡BOOM!', alignment: AlignmentType.CENTER }),
          new Paragraph({ text: 'El mercado', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            children: [
              new ImageRun({
                type: 'png',
                data: Buffer.from(pngSolido(60, 90)),
                transformation: { width: 60, height: 90 },
                altText: { name: 'ilustracion', description: 'Aria sostiene la espada frente al mercado', title: 'Aria' },
              }),
            ],
          }),
          new Paragraph({ children: [new TextRun('Fin del capítulo.')] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** EPUB 3 al estilo de Sigil/Calibre: clases CSS, notas en archivo aparte, portada SVG, toc.ncx. */
export async function epubAjeno(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="BookId">urn:uuid:12345678-1234-4234-8234-123456789abc</dc:identifier>
<dc:title>Mi vida en otro mundo</dc:title>
<dc:creator id="cre">Hiroshi Tanaka</dc:creator>
<meta refines="#cre" property="role" scheme="marc:relators">aut</meta>
<dc:contributor id="trad">Mike</dc:contributor>
<meta refines="#trad" property="role" scheme="marc:relators">trl</meta>
<dc:language>es</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
<meta name="calibre:series" content="Otro mundo"/>
<meta name="calibre:series_index" content="3"/>
<meta name="cover" content="cover-img"/>
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="nav" href="Text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="Styles/style.css" media-type="text/css"/>
<item id="cover-img" href="Images/Portada%20Vol3.png" media-type="image/png" properties="cover-image"/>
<item id="ilu1" href="Images/ilu1.png" media-type="image/png"/>
<item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>
<item id="c1" href="Text/Section0001.xhtml" media-type="application/xhtml+xml"/>
<item id="ilu" href="Text/Section0002.xhtml" media-type="application/xhtml+xml"/>
<item id="notas" href="Text/notas.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine toc="ncx">
<itemref idref="cover"/><itemref idref="c1"/><itemref idref="ilu"/><itemref idref="notas"/>
</spine>
</package>`,
  );
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>x</text></docTitle><navMap>
<navPoint id="p1" playOrder="1"><navLabel><text>Capítulo 1 – La llegada</text></navLabel><content src="Text/Section0001.xhtml"/></navPoint>
</navMap></ncx>`,
  );
  zip.file(
    'OEBPS/Text/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol><li><a href="Section0001.xhtml">Capítulo 1 – La llegada</a></li></ol></nav></body></html>`,
  );
  zip.file(
    'OEBPS/Styles/style.css',
    `p { text-indent: 1em; margin: 0; }
.centrar { text-align: center; text-indent: 0; }
.ital { font-style: italic; }
span.negr { font-weight: bold; }
.sc { font-variant: small-caps; }
.oculto { display: none; }`,
  );
  zip.file('OEBPS/Images/Portada Vol3.png', pngSolido(40, 60, [20, 40, 160]));
  zip.file('OEBPS/Images/ilu1.png', pngSolido(80, 50, [40, 160, 40]));
  zip.file(
    'OEBPS/Text/cover.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body>
<div style="text-align:center"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 40 60"><image width="40" height="60" xlink:href="../Images/Portada%20Vol3.png"/></svg></div>
</body></html>`,
  );
  zip.file(
    'OEBPS/Text/Section0001.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="es"><head><title>Cap 1</title><link href="../Styles/style.css" rel="stylesheet" type="text/css"/></head><body>
<h2 class="titulo">Capítulo 1 – La llegada</h2>
<p>Desperté en un bosque<sup><a id="ref1" href="notas.xhtml#nota1">[1]</a></sup>.</p>
<p class="ital">¿Dónde estoy?</p>
<p>Vi un <span class="negr">dragón</span> y un cartel en <span lang="ja" xml:lang="ja">日本語</span>: <ruby>勇者<rt>ゆうしゃ</rt></ruby>.</p>
<p class="centrar">◇◇◇</p>
<p class="centrar">Fin de la escena.</p>
<p>Texto <span class="oculto">oculto</span>visible con <span class="sc">Versalitas</span>.</p>
<table><tr><td>Fuerza</td><td>10</td></tr></table>
</body></html>`,
  );
  zip.file(
    'OEBPS/Text/Section0002.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ilustración</title></head><body><div class="ilus"><img src="../Images/ilu1.png" alt="Un dragón sobre el castillo"/></div></body></html>`,
  );
  zip.file(
    'OEBPS/Text/notas.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Notas</title></head><body>
<h1>Notas</h1>
<p id="nota1"><a href="Section0001.xhtml#ref1">[1]</a> Bosque de los elfos, en el original.</p>
</body></html>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** Un recuadro de cada tipo (isekai y comedia romántica); `nota` = id de una nota llamada desde la ventana de sistema. */
export function recuadrosDePrueba(nota?: string): Bloque[] {
  return [
    { tipo: 'recuadro', variante: 'sistema', titulo: 'Bienvenido a Eldoria', lineas: [{ contenido: [{ tipo: 'texto', texto: 'Has sido invocado como ' }, { tipo: 'texto', texto: 'héroe', marcas: ['negrita'] }, ...(nota ? [{ tipo: 'nota' as const, id: nota }] : [])] }, { contenido: [{ tipo: 'texto', texto: '¿Aceptas la misión?' }] }] },
    { tipo: 'recuadro', variante: 'notificacion', lineas: [{ contenido: [{ tipo: 'texto', texto: '[Has obtenido la habilidad «Tasación»]' }] }] },
    { tipo: 'recuadro', variante: 'estado', titulo: 'Kaito Aizawa', lineas: [{ etiqueta: 'Nivel', contenido: [{ tipo: 'texto', texto: '1' }] }, { etiqueta: 'PV', contenido: [{ tipo: 'texto', texto: '120/120' }] }, { etiqueta: 'Habilidad', contenido: [{ tipo: 'ruby', base: '鑑定', lectura: 'かんてい' }] }] },
    { tipo: 'recuadro', variante: 'chat', titulo: 'Club de literatura', lineas: [{ etiqueta: 'Hina', lado: 'izq', contenido: [{ tipo: 'texto', texto: '¿Mañana a las cinco?' }] }, { etiqueta: 'Yo', lado: 'der', contenido: [{ tipo: 'texto', texto: 'Ahí estaré 😊' }] }] },
    { tipo: 'recuadro', variante: 'diario', titulo: '14 de febrero', lineas: [{ contenido: [{ tipo: 'texto', texto: 'Hoy por fin le di el chocolate.' }] }] },
    { tipo: 'recuadro', variante: 'nota', titulo: 'Para: Senpai', lineas: [{ contenido: [{ tipo: 'texto', texto: 'Te espero en la azotea.' }] }] },
  ];
}
