import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { entradasIndice, libroNuevo, nuevaSeccion, nuevoId, parrafo, type Bloque, type Libro } from '../model.js';
import { compilar } from '../compilar.js';
import { htmlImpresion } from '../impresion.js';
import { importarEpub } from '../formatos/epub.js';
import { validarDatos } from '../validar.js';

const sub = (texto: string, fuera = false): Bloque => ({ tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto }], ...(fuera ? { fueraDeIndice: true } : {}) });

function libroIndice(): Libro {
  const l = libroNuevo('Índices', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.titulo = 'Capítulo 1: El gremio de aventureros';
  cap.tituloIndice = 'Capítulo 1';
  cap.bloques = [parrafo('Uno.'), sub('La prueba'), parrafo('Dos.'), { tipo: 'saltoPagina' }, parrafo('Tres.'), sub('Interludio secreto', true), parrafo('Cuatro.')];
  const oculta = nuevaSeccion('capitulo', 'Notas de la traducción');
  oculta.enIndice = false;
  oculta.mostrarTitulo = true;
  oculta.bloques = [parrafo('Notas.')];
  const indice = nuevaSeccion('indice', 'Índice');
  l.secciones.splice(1, 0, indice);
  l.secciones.push(oculta);
  l.profundidadIndice = 2;
  return l;
}

test('Índice de dos niveles, texto propio, toc.ncx y salto de página: EPUB válido e ida y vuelta', async () => {
  const l = libroIndice();
  const cap = l.secciones.find((s) => s.titulo.startsWith('Capítulo 1'))!;
  const e = entradasIndice(l);
  assert.deepEqual(
    e.map((x) => [x.texto, x.hijos.map((h) => [h.texto, h.ancla])]),
    l.secciones
      .filter((s) => s.enIndice && s.titulo && s.tipo !== 'portada' && s.tipo !== 'indice')
      .map((s) => (s === cap ? ['Capítulo 1', [['La prueba', 'st-1']]] : [s.titulo, []])),
  );
  const datos = await compilar(l);
  const v = await validarDatos(datos);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  const zip = await JSZip.loadAsync(datos);
  const nav = await zip.file('EPUB/nav.xhtml')!.async('string');
  assert.match(nav, /<nav epub:type="toc" id="toc" class="dos-niveles">/);
  assert.match(nav, new RegExp(`<a href="${cap.id}\\.xhtml">Capítulo 1</a>\\n<ol>\\n<li><a href="${cap.id}\\.xhtml#st-1">La prueba</a></li>\\n</ol>`));
  assert.ok(!nav.includes('Interludio secreto') && !nav.includes('Notas de la traducción'));
  const ncx = await zip.file('EPUB/toc.ncx')!.async('string');
  assert.match(ncx, /<navPoint id="np-\d+" playOrder="\d+"><navLabel><text>Capítulo 1<\/text><\/navLabel><content src="[^"]+"\/><navPoint[^>]*><navLabel><text>La prueba<\/text>/);
  assert.match(await zip.file('EPUB/package.opf')!.async('string'), /<spine toc="ncx">/);
  const xhtml = await zip.file(`EPUB/${cap.id}.xhtml`)!.async('string');
  assert.match(xhtml, /<h2 id="st-1">La prueba<\/h2>/);
  assert.match(xhtml, /<h2 id="st-2" class="fuera-indice">Interludio secreto<\/h2>/);
  assert.match(xhtml, /<div class="salto-pagina"><\/div>/);
  const pagina = await zip.file(`EPUB/${l.secciones[1].id}.xhtml`)!.async('string');
  assert.match(pagina, /<ol class="indice">[\s\S]*#st-1">La prueba/);

  // Ida y vuelta.
  const { libro } = await importarEpub(datos);
  assert.equal(libro.profundidadIndice, 2);
  const vc = libro.secciones.find((s) => s.titulo === cap.titulo)!;
  assert.equal(vc.tituloIndice, 'Capítulo 1');
  assert.deepEqual(vc.bloques, cap.bloques);
  assert.equal(libro.secciones.find((s) => s.titulo === 'Notas de la traducción')?.enIndice, false);
  // Un libro de un nivel conserva los subtítulos fuera del índice (por su clase) y no pasa a dos niveles.
  const uno = libroIndice();
  delete uno.profundidadIndice;
  const { libro: l1 } = await importarEpub(await compilar(uno));
  assert.equal(l1.profundidadIndice, undefined);
  assert.deepEqual(l1.secciones.find((s) => s.titulo === cap.titulo)!.bloques, cap.bloques);
});

test('Índice y salto de página en el PDF, el editor y el Word de corrección', async () => {
  const l = libroIndice();
  const cap = l.secciones.find((s) => s.titulo.startsWith('Capítulo 1'))!;
  const html = htmlImpresion(l, { digital: true } as never);
  const k = l.secciones.indexOf(cap);
  assert.match(html, new RegExp(`<a href="#s-${cap.id}">Capítulo 1</a><ol><li><a href="#p${k}-st-1">La prueba</a>`));
  assert.match(html, new RegExp(`<h2 id="p${k}-st-1">La prueba</h2>`));
  assert.match(html, /<div class="salto-pagina"><\/div>/);
  const { bloquesAPM, pmABloques } = await import('../editor-modelo.js');
  assert.deepEqual(pmABloques(bloquesAPM(cap.bloques)), cap.bloques);
  const { exportarWord, importarCorrecciones } = await import('../formatos/word.js');
  const docx = await exportarWord(l);
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
  assert.match(xml, /⟦Salto de página — no editar esta línea⟧/);
  assert.match(xml, /<w:br w:type="page"\/>/);
  const copia = structuredClone(l);
  const r = await importarCorrecciones(copia, docx);
  assert.equal(r.avisos.length, 0, r.avisos.join());
  assert.ok(copia.secciones.find((s) => s.id === cap.id)!.bloques.some((b) => b.tipo === 'saltoPagina'));
});

test('Partir y unir secciones', async () => {
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-partir-')));
  b.nuevo('Partir', 'Autora');
  const cap = b.libro.secciones.find((s) => s.tipo === 'capitulo')!;
  const n1 = nuevoId('n');
  const n2 = nuevoId('n');
  cap.titulo = 'Capítulo 1';
  cap.bloques = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'Primera parte' }, { tipo: 'nota', id: n1 }] },
    sub('Capítulo 2'),
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'Segunda parte', comentarios: ['c1'] }, { tipo: 'nota', id: n2 }] },
  ];
  cap.notas = [
    { id: n1, contenido: [{ tipo: 'texto', texto: 'Nota uno' }] },
    { id: n2, contenido: [{ tipo: 'texto', texto: 'Nota dos' }] },
  ];
  cap.comentarios = [{ id: 'c1', autor: 'Ana', fecha: '2026-01-01', texto: 'Revisar' }];
  assert.throws(() => b.partirSeccion(cap.id, 0), /no en el primero/);
  const id = b.partirSeccion(cap.id, 1);
  const nueva = b.seccion(id);
  assert.equal(nueva.titulo, 'Capítulo 2', 'el subtítulo pasa a ser el título');
  assert.ok(nueva.mostrarTitulo && nueva.enIndice);
  assert.equal(nueva.bloques.length, 1);
  assert.deepEqual(nueva.notas.map((x) => x.id), [n2]);
  assert.deepEqual(cap.notas.map((x) => x.id), [n1]);
  assert.deepEqual(nueva.comentarios?.map((x) => x.id), ['c1']);
  assert.equal(cap.comentarios, undefined);
  assert.equal(b.libro.secciones[b.libro.secciones.indexOf(cap) + 1], nueva);
  assert.ok(b.libro.versiones?.some((v) => v.nombre.startsWith('Antes de partir')));

  b.unirConSiguiente(cap.id);
  assert.ok(!b.libro.secciones.includes(nueva));
  assert.deepEqual(cap.bloques.map((x) => x.tipo), ['parrafo', 'subtitulo', 'parrafo']);
  assert.deepEqual(cap.notas.map((x) => x.id), [n1, n2]);
  assert.deepEqual((cap as { comentarios?: { id: string }[] }).comentarios?.map((x) => x.id), ['c1']);
  const portada = b.libro.secciones.find((s) => s.tipo === 'portada');
  if (portada) assert.throws(() => b.unirConSiguiente(portada.id), /portada/);
  assert.throws(() => b.unirConSiguiente(b.libro.secciones[b.libro.secciones.length - 1].id), /última/);

  // Texto del índice y niveles desde la API.
  b.actualizarSeccion(cap.id, { tituloIndice: '  Cap. 1  ' });
  assert.equal(cap.tituloIndice, 'Cap. 1');
  b.actualizarSeccion(cap.id, { tituloIndice: 'Capítulo 1' });
  assert.equal(cap.tituloIndice, undefined, 'igual que el título: no hace falta');
  b.profundidadIndice(2);
  assert.equal(b.libro.profundidadIndice, 2);
  b.profundidadIndice(1);
  assert.equal(b.libro.profundidadIndice, undefined);
});

test('Conversión sencilla: dónde empiezan los capítulos, revisión de la lista e índice', async () => {
  const { Backend } = await import('../../app/backend.js');
  const { epubDeOtroFormato } = await import('../formatos/otros.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-capitulos-')));
  const html = `<html><head><title>Cortes</title><style>p.nuevo { page-break-before: always; }</style></head><body>
<h1>Capítulo 1</h1><p>Uno.</p><h2>Parte A</h2><p>Dos.</p><p class="nuevo">Tres empieza en página nueva.</p>
<h1>Capítulo 2</h1><p>Cuatro.</p><h2>Parte B</h2><p>Cinco.</p></body></html>`;
  const a = await b.analizarConversion('cortes.html', new TextEncoder().encode(html));
  assert.deepEqual(a.diseno?.cortes, { h2: 2, saltos: 1, sugerido: 'h1' });
  const titulos = async (cortar: 'h1' | 'h2' | 'saltos') => (await b.capitulosConversion({ cortar })).map((c) => c.titulo);
  assert.deepEqual(await titulos('h1'), ['Capítulo 1', 'Capítulo 2']);
  assert.deepEqual(await titulos('h2'), ['Capítulo 1', 'Parte A', 'Capítulo 2', 'Parte B']);
  const conSaltos = await b.capitulosConversion({ cortar: 'saltos' });
  assert.equal(conSaltos.length, 3);
  assert.equal(conSaltos[1].inicio.slice(0, 5), 'Tres ');
  assert.equal(b.libro.metadatos.titulo, 'Libro sin título', 'la lista no toca el libro abierto');

  await b.conversionSencilla({
    capitulos: {
      cortar: 'h2',
      total: 4,
      cambios: [
        { indice: 0, unirConSiguiente: true },
        { indice: 2, titulo: 'Capítulo 2: El regreso', tituloIndice: 'Capítulo 2' },
        { indice: 3, enIndice: false },
      ],
      profundidad: 2,
      paginaIndice: true,
    },
  });
  const s = b.libro.secciones;
  assert.deepEqual(
    s.map((x) => [x.tipo, x.titulo, x.enIndice]),
    [
      ['indice', 'Índice', false],
      ['capitulo', 'Capítulo 1', true],
      ['capitulo', 'Capítulo 2: El regreso', true],
      ['capitulo', 'Parte B', false],
    ],
  );
  assert.equal(s[2].tituloIndice, 'Capítulo 2');
  assert.ok(s[1].bloques.some((x) => x.tipo === 'subtitulo' && JSON.stringify(x).includes('Parte A')), 'la parte unida conserva su título como subtítulo');
  assert.equal(b.libro.profundidadIndice, 2);
  const { datos } = await b.exportar();
  const v = await validarDatos(datos);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));

  // Si la lista cambió desde que se revisó, los cambios no se aplican.
  await b.analizarConversion('cortes.html', new TextEncoder().encode(html));
  const r = await b.conversionSencilla({ capitulos: { cortar: 'h1', total: 9, cambios: [{ indice: 0, titulo: 'Otro' }] } });
  assert.ok(r.avisos.some((x) => x.includes('La lista de capítulos cambió')));
  assert.equal(b.libro.secciones[0].titulo, 'Capítulo 1');

  // Texto plano con salto de página (form feed) y OpenDocument con «salto antes».
  const { libro: txt } = await importarEpub((await epubDeOtroFormato('a.txt', new TextEncoder().encode('Capítulo 1\nUno.\n\fDos.\n'))).epub);
  assert.ok(txt.secciones[0].bloques.some((x) => x.tipo === 'saltoPagina'));
  const z = new JSZip();
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
  z.file('content.xml', `<?xml version="1.0"?><office:document-content ${ns}><office:automatic-styles><style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Uno</text:h><text:p>Texto.</text:p><text:p text:style-name="P1">Otra página.</text:p></office:text></office:body></office:document-content>`);
  const ao = await b.analizarConversion('a.odt', await z.generateAsync({ type: 'uint8array' }));
  assert.equal(ao.diseno?.cortes?.saltos, 1);
});
