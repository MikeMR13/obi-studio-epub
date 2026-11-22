// Errores encontrados en la auditoría de funcionamiento (noviembre de 2026), para que no vuelvan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx';
import { libroNuevo, parrafo, textoPlano, type Bloque, type Libro } from '../model.js';
import { importarEpub } from '../formatos/epub.js';
import { importarDocx } from '../formatos/docx.js';
import { epubDeOtroFormato } from '../formatos/otros.js';
import { exportarWord, importarCorrecciones } from '../formatos/word.js';
import { compilar } from '../compilar.js';
import { validarDatos } from '../validar.js';
import { pngSolido } from './fixtures.js';

const cod = (t: string) => new TextEncoder().encode(t);
const textoLibro = (l: Libro) => l.secciones.flatMap((s) => s.bloques).map((b) => ('contenido' in b && Array.isArray(b.contenido) ? textoPlano(b.contenido) : '')).join('\n');

/** EPUB 2 como los de pandoc o Calibre: notas sin epub:type, con enlace de vuelta «1» delante del texto. */
async function epub2ConNotas(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:9c1f8a3e-2b4d-4c7e-9f00-123456789abc</dc:identifier><dc:title>Notas EPUB 2</dc:title><dc:language>es</dc:language></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`,
  );
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Notas</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Capítulo 1</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>');
  z.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><div class="section level1"><h1>Capítulo 1</h1>
<p>Primer párrafo sin nota.</p>
<p>Llevaba la espada sagrada<a href="#fn1" class="footnote-ref" id="fnref1">1</a>.</p>
<p>Último párrafo.</p></div>
<div class="footnotes footnotes-end-of-document"><hr/><div id="fn1"><p><a href="#fnref1" class="footnote-back">1</a>. Nota del traductor: «聖剣» (seiken).</p></div></div></body></html>`,
  );
  return new Uint8Array(await z.generateAsync({ type: 'uint8array' }));
}

test('EPUB 2 sin epub:type: el párrafo con la llamada no se pierde y la nota queda limpia', async () => {
  const { libro } = await importarEpub(await epub2ConNotas());
  const cap = libro.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  assert.equal(cap.bloques.length, 3, 'los tres párrafos siguen ahí');
  const p = cap.bloques[1];
  assert.ok(p.tipo === 'parrafo' && textoPlano(p.contenido).includes('espada sagrada'));
  assert.ok(p.tipo === 'parrafo' && p.contenido.some((i) => i.tipo === 'nota'));
  assert.equal(cap.notas.length, 1);
  assert.equal(textoPlano(cap.notas[0].contenido), 'Nota del traductor: «聖剣» (seiken).');
});

test('Markdown: cabecera YAML, notas al pie e idioma', async () => {
  const md = `---
title: "La espada"
subtitle: Volumen 2
author: Haruka Mizuno
lang: es-MX
rights: © 2026 Ox Mr
---

# Capítulo 1

Texto con nota[^a] y otra[^b].

* * *

Fin.

[^a]: Primera nota.
[^b]: Segunda nota,
    que sigue aquí.
`;
  const { epub } = await epubDeOtroFormato('libro.md', cod(md));
  const { libro } = await importarEpub(epub);
  assert.equal(libro.metadatos.titulo, 'La espada');
  assert.equal(libro.metadatos.subtitulo, 'Volumen 2');
  assert.equal(libro.metadatos.idioma, 'es-MX');
  assert.deepEqual(libro.metadatos.creditos, [{ nombre: 'Haruka Mizuno', rol: 'aut' }]);
  assert.equal(libro.metadatos.derechos, '© 2026 Ox Mr');
  const cap = libro.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  assert.deepEqual(cap.notas.map((n) => textoPlano(n.contenido)), ['Primera nota.', 'Segunda nota, que sigue aquí.']);
  assert.ok(cap.bloques.some((b) => b.tipo === 'separador'));
  assert.ok(!textoLibro(libro).includes('title:'), 'la cabecera no sale como texto');
});

test('Texto plano japonés: idioma y capítulos 第一章', async () => {
  const { epub } = await epubDeOtroFormato('libro.txt', cod('前書き。\n\n第一章　帰還\n\n魔王の城は静かだった。\n\n第二章　図書館\n\n司書の仕事。\n'));
  const { libro } = await importarEpub(epub);
  assert.equal(libro.metadatos.idioma, 'ja');
  assert.deepEqual(
    libro.secciones.filter((s) => s.titulo.startsWith('第')).map((s) => s.titulo),
    ['第一章 帰還', '第二章 図書館'],
  );
});

test('HTML: idioma y autor del original; la portadilla de pandoc no se repite como texto', async () => {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta name="author" content="Ana Souza"><title>O livro</title></head><body>
<header id="title-block-header"><h1 class="title">O livro</h1><p class="author">Ana Souza</p></header><h1>Capítulo 1</h1><p>Texto.</p></body></html>`;
  const { epub } = await epubDeOtroFormato('livro.html', cod(html));
  const { libro } = await importarEpub(epub);
  assert.equal(libro.metadatos.idioma, 'pt-BR');
  assert.deepEqual(libro.metadatos.creditos, [{ nombre: 'Ana Souza', rol: 'aut' }]);
  assert.ok(!libro.secciones.some((s) => s.titulo === 'O livro'), 'sin capítulo con el título del libro');
});

async function odtPrueba(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  z.file('meta.xml', '<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:language>es-AR</dc:language></office:meta></office:document-meta>');
  z.file('styles.xml', '<?xml version="1.0"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:styles><style:style style:name="Horizontal_20_Line" style:family="paragraph"/><style:style style:name="Title" style:family="paragraph"/><style:style style:name="Subtitle" style:family="paragraph"/><style:style style:name="Author" style:family="paragraph"/><style:style style:name="Caption" style:family="paragraph"/></office:styles></office:document-styles>');
  const png = pngSolido(40, 30, [200, 30, 30]);
  z.file('Pictures/a.png', png);
  z.file(
    'content.xml',
    `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"><office:automatic-styles><style:style style:name="P9" style:family="paragraph" style:parent-style-name="Horizontal_20_Line"/></office:automatic-styles><office:body><office:text>
<text:p text:style-name="Title">El libro de prueba</text:p><text:p text:style-name="Subtitle">Volumen 1</text:p><text:p text:style-name="Author">Luis Pérez</text:p>
<text:h text:outline-level="1">Capítulo 1</text:h><text:p>Antes.</text:p><text:p text:style-name="P9"/><text:p>Después.</text:p>
<text:p><draw:frame svg:width="40pt" svg:height="30pt"><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p><text:p text:style-name="Caption">Aria frente al gremio</text:p>
</office:text></office:body></office:document-content>`,
  );
  return new Uint8Array(await z.generateAsync({ type: 'uint8array' }));
}

test('OpenDocument: portadilla a metadatos, línea horizontal como separador y pie de imagen', async () => {
  const { epub } = await epubDeOtroFormato('libro.odt', await odtPrueba());
  const { libro } = await importarEpub(epub);
  assert.equal(libro.metadatos.titulo, 'El libro de prueba');
  assert.equal(libro.metadatos.subtitulo, 'Volumen 1');
  assert.equal(libro.metadatos.idioma, 'es-AR');
  assert.deepEqual(libro.metadatos.creditos, [{ nombre: 'Luis Pérez', rol: 'aut' }]);
  const cap = libro.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  assert.deepEqual(cap.bloques.map((b) => b.tipo), ['parrafo', 'separador', 'parrafo', 'imagen']);
  const img = cap.bloques[3];
  assert.ok(img.tipo === 'imagen' && img.pie === 'Aria frente al gremio');
  assert.ok(!libro.secciones.some((s) => s.titulo === 'El libro de prueba'));
});

test('Word: línea horizontal como separador, idioma de los estilos y autor de la portadilla', async () => {
  const doc = new Document({
    styles: { paragraphStyles: [{ id: 'Author', name: 'Author', basedOn: 'Normal' }, { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal' }] },
    sections: [
      {
        children: [
          new Paragraph({ style: 'Author', children: [new TextRun('Luis Pérez')] }),
          new Paragraph({ style: 'Heading1', children: [new TextRun('Capítulo 1')] }),
          new Paragraph({ children: [new TextRun('Antes.')] }),
          new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } }, children: [] }),
          new Paragraph({ children: [new TextRun('Después.')] }),
        ],
      },
    ],
  });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const estilos = await zip.file('word/styles.xml')!.async('string');
  zip.file('word/styles.xml', estilos.replace(/<w:docDefaults>/, '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="es-MX"/></w:rPr></w:rPrDefault>'));
  const { libro } = await importarDocx(new Uint8Array(await zip.generateAsync({ type: 'uint8array' })));
  assert.equal(libro.metadatos.idioma, 'es-MX');
  assert.deepEqual(libro.metadatos.creditos, [{ nombre: 'Luis Pérez', rol: 'aut' }]);
  const cap = libro.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  assert.deepEqual(cap.bloques.map((b) => b.tipo), ['parrafo', 'separador', 'parrafo']);
  assert.ok(!textoLibro(libro).includes('Luis Pérez'), 'el autor no queda como texto');
});

test('Word de corrección: pie de imagen, idioma de fragmentos y notas vuelven intactos', async () => {
  const l = libroNuevo('Corrección', 'Autora');
  const r = { id: 'img1', nombre: 'a.png', tipoMime: 'image/png', datos: pngSolido(60, 40, [0, 0, 0]), ancho: 60, alto: 40 };
  l.recursos.push(r);
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.titulo = 'Capítulo 1';
  cap.notas = [{ id: 'n1', contenido: [{ tipo: 'texto', texto: 'Una nota.' }] }];
  const bloques: Bloque[] = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'Un cartel en ' }, { tipo: 'texto', texto: '日本語', idioma: 'ja' }, { tipo: 'texto', texto: ' y una nota' }, { tipo: 'nota', id: 'n1' }, { tipo: 'texto', texto: '.' }] },
    { tipo: 'imagen', recurso: 'img1', alt: 'Aria', pie: 'Aria frente al gremio' },
    parrafo('Fin.'),
  ];
  cap.bloques = structuredClone(bloques);
  const docx = await exportarWord(l);
  const res = await importarCorrecciones(l, docx);
  assert.equal(res.avisos.length, 0, res.avisos.join());
  const vuelta = l.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  const p0 = vuelta.bloques[0];
  assert.ok(p0.tipo === 'parrafo' && p0.contenido.some((i) => i.tipo === 'texto' && i.idioma === 'ja'), 'el idioma del fragmento sigue');
  const llamada = p0.tipo === 'parrafo' ? p0.contenido.find((i) => i.tipo === 'nota') : undefined;
  assert.ok(llamada && vuelta.notas.some((n) => n.id === (llamada as { id: string }).id), 'la llamada apunta a una nota que existe');
  assert.deepEqual(vuelta.bloques[1], bloques[1], 'el pie de la imagen vuelve');
  // Un pie corregido en Word se actualiza.
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file('word/document.xml')!.async('string');
  zip.file('word/document.xml', xml.replace('Aria frente al gremio', 'Aria ante el gremio'));
  const l2 = libroNuevo('x');
  Object.assign(l2, structuredClone({ ...l, secciones: l.secciones.map((s) => (s.id === cap.id ? { ...s, bloques: structuredClone(bloques) } : s)) }));
  await importarCorrecciones(l2, new Uint8Array(await zip.generateAsync({ type: 'uint8array' })));
  const img = l2.secciones.find((s) => s.id === cap.id)!.bloques[1];
  assert.ok(img.tipo === 'imagen' && img.pie === 'Aria ante el gremio');
});

test('Archivos dañados: mensajes claros en español y ZIP desmesurados rechazados', async () => {
  const { Backend, errorDeLectura, comprobarZip } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-danado-')));
  await assert.rejects(b.importar('libro.epub', crypto.getRandomValues(new Uint8Array(500))), /dañado o incompleto/);
  await assert.rejects(b.importar('libro.docx', new Uint8Array()), /dañado o incompleto/);
  assert.match(errorDeLectura(new TypeError('crudo.recursos is not iterable'), 'obi').message, /estructura esperada/);
  const z = new JSZip();
  for (let i = 0; i < 20001; i++) z.file(`x/${i}`, '');
  await assert.rejects(comprobarZip(new Uint8Array(await z.generateAsync({ type: 'uint8array' })), 'epub'), /desmesurado/);
  // Un capítulo que falta en el EPUB se avisa.
  const libro = libroNuevo('Falta', 'A');
  const epub = await JSZip.loadAsync(await compilar(libro));
  const cap = libro.secciones.find((s) => s.tipo === 'capitulo')!;
  epub.remove(`EPUB/${cap.id}.xhtml`);
  await b.importar('falta.epub', new Uint8Array(await epub.generateAsync({ type: 'uint8array' })));
  assert.ok(b.avisos.some((a) => a.includes('Falta en el EPUB')), b.avisos.join());
});

test('Guardar en la app de escritorio: cancelar el diálogo no da el libro por guardado', async () => {
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-guardar-')));
  b.guardadoConfirmado = true;
  b.nuevo('Guardar', 'A');
  b.metadatos({ titulo: 'Otro título' });
  assert.equal(b.cambiado, true);
  await b.proyecto();
  assert.equal(b.cambiado, true, 'descargado pero aún no escrito (el usuario puede cancelar)');
  const cambios = b.cambiosDescargados;
  b.metadatos({ subtitulo: 'Cambio después de descargar' });
  b.proyectoGuardado('/tmp/x/libro.obi', cambios);
  assert.equal(b.cambiado, true, 'hubo cambios después: sigue sin guardar');
  await b.proyecto();
  b.proyectoGuardado('/tmp/x/libro.obi', b.cambiosDescargados);
  assert.equal(b.cambiado, false);
  assert.equal(b.nombreArchivo, 'libro.obi');
  assert.equal(b.rutaProyecto, '/tmp/x/libro.obi');
  const ruta = join(await mkdtemp(join(tmpdir(), 'obi-guardar-como-')), 'copia.obi');
  b.metadatos({ subtitulo: 'Otro' });
  await b.guardarEn(ruta);
  assert.equal(b.cambiado, false);
  assert.equal(b.rutaProyecto, ruta);
  // En el navegador (sin confirmación) se da por guardado al descargar, como antes.
  const web = new Backend(await mkdtemp(join(tmpdir(), 'obi-guardar-web-')));
  web.nuevo('Web', 'A');
  web.metadatos({ titulo: 'Cambio' });
  await web.proyecto();
  assert.equal(web.cambiado, false);
});

test('Los backends auxiliares (vista previa, lotes) no escriben la copia de recuperación', async () => {
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-aux-')));
  b.copiaDeRecuperacion = false;
  b.nuevo('Aux', 'A');
  b.metadatos({ titulo: 'Cambio' });
  assert.equal((b as unknown as { temporizador?: unknown }).temporizador, undefined, 'no se programó ninguna copia');
});

test('EPUB de una conversión con notas de EPUB 2: válido tras exportar', async () => {
  const { libro } = await importarEpub(await epub2ConNotas());
  const v = await validarDatos(await compilar(libro));
  assert.equal(v.disponible, true, 'EPUBCheck tiene que estar disponible para las pruebas (npm run recursos)');
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
});

test('Sin EPUBCheck el libro no se da por válido', async () => {
  const v = await import('../validar.js');
  // El código de validación devuelve un error OBI-EPUBCHECK cuando no encuentra el .jar (antes daba «válido»).
  assert.match(String(v.validarArchivo), /valido:\s*false,\s*errores:\s*1[\s\S]*OBI-EPUBCHECK/);
});

test('Ida y vuelta: cada tipo de sección vuelve con su tipo (también «otro» e «interludio» con título)', async () => {
  const { TIPOS_SECCION, nuevaSeccion } = await import('../model.js');
  const l = libroNuevo('Tipos', 'A');
  l.secciones = TIPOS_SECCION.filter((t) => !['portada', 'ilustracion', 'indice'].includes(t.id)).map((t) => {
    const s = nuevaSeccion(t.id, `Sección ${t.nombre}`);
    s.bloques = [parrafo(`Texto de ${t.nombre}.`)];
    return s;
  });
  const { libro } = await importarEpub(await compilar(l));
  assert.deepEqual(
    libro.secciones.map((s) => s.tipo),
    l.secciones.map((s) => s.tipo),
  );
});
