import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { libroNuevo, nuevoId, parrafo, type Libro, type Seccion } from '../model.js';
import { compilar, compilarArchivos } from '../compilar.js';
import { importarEpub } from '../formatos/epub.js';
import { importarDocx } from '../formatos/docx.js';
import { errorXhtml } from '../formatos/dom.js';
import { validarDatos, rutaEpubcheck } from '../validar.js';
import { serializarProyecto, deserializarProyecto } from '../proyecto.js';
import { aplicarTipografiaLibro } from '../tipografia.js';
import { bloquesAPM, pmABloques } from '../editor-modelo.js';
import { docxDePrueba, epubAjeno, pngSolido } from './fixtures.js';

const hayEpubcheck = !!rutaEpubcheck();

function libroCompleto(): Libro {
  const l = libroNuevo('La espada del alba', 'Autora');
  l.metadatos.creditos.push({ nombre: 'Mike', rol: 'trl' });
  l.metadatos.serie = 'Alba';
  l.metadatos.volumen = 2;
  const img = { id: nuevoId('i'), nombre: 'portada.png', tipoMime: 'image/png', datos: pngSolido(30, 45), ancho: 30, alto: 45 };
  const ilu = { id: nuevoId('i'), nombre: 'ilu.png', tipoMime: 'image/png', datos: pngSolido(45, 30), ancho: 45, alto: 30 };
  l.recursos.push(img, ilu);
  l.metadatos.portada = img.id;
  const portada: Seccion = { id: nuevoId('s'), tipo: 'portada', titulo: 'Portada', mostrarTitulo: false, enIndice: false, bloques: [], notas: [] };
  const ilustracion: Seccion = {
    id: nuevoId('s'), tipo: 'ilustracion', titulo: '', mostrarTitulo: false, enIndice: false,
    bloques: [{ tipo: 'imagen', recurso: ilu.id, alt: 'Aria en el mercado' }], notas: [],
  };
  const indice: Seccion = { id: nuevoId('s'), tipo: 'indice', titulo: 'Índice', mostrarTitulo: true, enIndice: false, bloques: [], notas: [] };
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const n1 = nuevoId('n');
  cap.bloques = [
    parrafo('—Hola —dijo.'),
    { tipo: 'parrafo', estilo: 'pensamiento', contenido: [{ tipo: 'texto', texto: 'Qué raro' }, { tipo: 'nota', id: n1 }] },
    { tipo: 'separador' },
    { tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Parte dos' }] },
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'ruby', base: '勇者', lectura: 'ゆうしゃ' }, { tipo: 'texto', texto: ' y ' }, { tipo: 'texto', texto: 'japonés', idioma: 'ja' }] },
    { tipo: 'lista', ordenada: false, elementos: [[{ tipo: 'texto', texto: 'Fuerza: 10' }]] },
    { tipo: 'crudo', xhtml: '<table><tr><td>HP</td><td>100</td></tr></table>' },
  ];
  cap.notas = [{ id: n1, contenido: [{ tipo: 'texto', texto: 'Nota.' }] }];
  l.secciones = [portada, ilustracion, indice, ...l.secciones];
  return l;
}

test('compila un EPUB con OCF correcto (mimetype primero y sin comprimir)', async () => {
  const epub = await compilar(libroCompleto());
  const zip = await JSZip.loadAsync(epub);
  assert.equal(Object.keys(zip.files)[0], 'mimetype');
  assert.equal(new TextDecoder().decode(epub.slice(30, 38)), 'mimetype');
  assert.equal(await zip.file('mimetype')!.async('string'), 'application/epub+zip');
});

test('semántica EPUB y accesibilidad en el paquete', () => {
  const l = libroCompleto();
  const archivos = compilarArchivos(l);
  const opf = archivos.get('package.opf') as string;
  assert.match(opf, /properties="cover-image"/);
  assert.match(opf, /schema:accessibilitySummary/);
  assert.match(opf, /rubyAnnotations/);
  assert.match(opf, /belongs-to-collection/);
  assert.match(opf, /marc:relators">trl/);
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const x = archivos.get(`${cap.id}.xhtml`) as string;
  assert.match(x, /epub:type="chapter" role="doc-chapter"/);
  assert.match(x, /role="doc-noteref"/);
  assert.match(x, /role="doc-footnote"/);
  assert.match(x, /<ruby>勇者<rp>\(<\/rp><rt>ゆうしゃ<\/rt>/);
  assert.match(x, /lang="ja" xml:lang="ja"/);
  const nav = archivos.get('nav.xhtml') as string;
  assert.match(nav, /epub:type="landmarks"/);
  for (const [ruta, contenido] of archivos) {
    if (ruta.endsWith('.xhtml')) assert.equal(errorXhtml((contenido as string).replace(/^<\?xml[^>]*>\s*<!DOCTYPE html>/, '')), null, ruta);
  }
});

test('EPUBCheck: libro completo sin errores ni avisos', { skip: !hayEpubcheck }, async () => {
  const r = await validarDatos(await compilar(libroCompleto()));
  assert.deepEqual(r.mensajes.map((m) => `${m.codigo} ${m.original}`), []);
});

test('ida y vuelta: compilar e importar no pierde contenido', async () => {
  const original = libroCompleto();
  const { libro } = await importarEpub(await compilar(original));
  const cap = libro.secciones.find((s) => s.tipo === 'capitulo')!;
  const capOrig = original.secciones.find((s) => s.tipo === 'capitulo')!;
  const sinIds = (s: Seccion) => JSON.stringify(s.bloques).replace(/"id":"n[^"]+"/g, '"id":"N"');
  assert.equal(sinIds(cap), sinIds(capOrig));
  assert.deepEqual(cap.notas.map((n) => n.contenido), capOrig.notas.map((n) => n.contenido));
  assert.deepEqual(libro.secciones.map((s) => s.tipo), original.secciones.map((s) => s.tipo));
  assert.deepEqual(libro.secciones.map((s) => s.titulo), original.secciones.map((s) => s.titulo));
  assert.equal(libro.metadatos.serie, 'Alba');
  assert.equal(libro.metadatos.volumen, 2);
  assert.deepEqual(libro.metadatos.creditos, original.metadatos.creditos);
  assert.ok(libro.metadatos.portada);
  const ilu = libro.secciones.find((s) => s.tipo === 'ilustracion')!;
  assert.deepEqual(ilu.bloques.map((b) => b.tipo === 'imagen' && b.alt), ['Aria en el mercado']);
});

test('importa un EPUB ajeno (Sigil/Calibre): notas en otro archivo, clases CSS, portada SVG', async () => {
  const { libro } = await importarEpub(await epubAjeno());
  assert.equal(libro.metadatos.titulo, 'Mi vida en otro mundo');
  assert.equal(libro.metadatos.serie, 'Otro mundo');
  assert.equal(libro.metadatos.volumen, 3);
  assert.deepEqual(libro.secciones.map((s) => s.tipo), ['portada', 'capitulo', 'ilustracion']);
  const cap = libro.secciones[1];
  assert.equal(cap.titulo, 'Capítulo 1 – La llegada');
  assert.equal(cap.notas.length, 1);
  assert.match(JSON.stringify(cap.notas[0].contenido), /Bosque de los elfos/);
  const texto = JSON.stringify(cap.bloques);
  assert.match(texto, /"cursiva"/);
  assert.match(texto, /"negrita"/);
  assert.match(texto, /"versalitas"/);
  assert.match(texto, /"ruby"/);
  assert.doesNotMatch(texto, /oculto/);
  assert.ok(cap.bloques.some((b) => b.tipo === 'separador'));
  assert.ok(cap.bloques.some((b) => b.tipo === 'parrafo' && b.estilo === 'centrado'));
  // Las tablas sencillas de un EPUB ajeno se vuelven editables.
  assert.ok(cap.bloques.some((b) => b.tipo === 'tabla' && JSON.stringify(b.filas).includes('Fuerza')));
  assert.equal(libro.recursos.length, 2);
});

test('EPUBCheck: el EPUB ajeno reexportado es válido', { skip: !hayEpubcheck }, async () => {
  const { libro } = await importarEpub(await epubAjeno());
  const r = await validarDatos(await compilar(libro));
  assert.deepEqual(r.mensajes.map((m) => `${m.codigo} ${m.original}`), []);
});

test('importa Word: capítulos, estilos, alineación, notas e imágenes', async () => {
  const { libro } = await importarDocx(await docxDePrueba());
  assert.equal(libro.metadatos.titulo, 'La espada del alba');
  assert.deepEqual(libro.metadatos.creditos, [{ nombre: 'Autora de Prueba', rol: 'aut' }]);
  assert.deepEqual(libro.secciones.map((s) => [s.tipo, s.titulo]), [['prologo', 'Prólogo'], ['capitulo', 'Capítulo 1: El despertar']]);
  const [pro, cap] = libro.secciones;
  assert.equal(pro.notas.length, 1);
  assert.ok(pro.bloques.some((b) => b.tipo === 'separador'));
  assert.ok(pro.bloques.some((b) => b.tipo === 'parrafo' && b.estilo === 'pensamiento'));
  assert.ok(cap.bloques.some((b) => b.tipo === 'parrafo' && b.estilo === 'centrado'));
  assert.ok(cap.bloques.some((b) => b.tipo === 'subtitulo'));
  const img = cap.bloques.find((b) => b.tipo === 'imagen');
  assert.ok(img && img.tipo === 'imagen' && img.alt.includes('Aria'));
  const r = hayEpubcheck ? await validarDatos(await compilar(libro)) : undefined;
  if (r) assert.deepEqual(r.mensajes.map((m) => m.codigo), []);
});

test('proyecto .obi: guardar y abrir conserva todo', async () => {
  const l = libroCompleto();
  const copia = await deserializarProyecto(await serializarProyecto(l));
  assert.deepEqual(copia, l);
});

test('tipografía española', () => {
  const l = libroNuevo();
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [parrafo('- Hola -dijo-. ¿Vienes...?'), parrafo('Dijo "basta" y se fue.'), parrafo('Un medio-día  raro.')];
  aplicarTipografiaLibro(l);
  const textos = cap.bloques.map((b) => (b.tipo === 'parrafo' ? b.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join('') : ''));
  assert.deepEqual(textos, ['—Hola —dijo—. ¿Vienes…?', 'Dijo «basta» y se fue.', 'Un medio-día raro.']);
});

test('editor visual: bloques → ProseMirror → bloques sin pérdidas', () => {
  const cap = libroCompleto().secciones.find((s) => s.tipo === 'capitulo')!;
  assert.deepEqual(pmABloques(bloquesAPM(cap.bloques)), cap.bloques);
});

test('temas: galería, validación y tema aplicado al EPUB (fuentes, títulos, capitular, ornamentos, cabecera)', async () => {
  const { TEMAS } = await import('../temas.js');
  const { validarTema, partesTitulo } = await import('../model.js');
  assert.ok(TEMAS.length >= 8);
  assert.deepEqual(validarTema({ interlineado: 9, colorTitulos: 'rojo', fuenteTexto: 'cinzel', capitular: 'letra', otro: 1 }), { interlineado: 2.2, capitular: 'letra' });
  assert.deepEqual(partesTitulo('Capítulo 3: El gremio'), { etiqueta: 'Capítulo 3', sep: ': ', nombre: 'El gremio' });
  assert.equal(partesTitulo('El gremio'), null);

  const l = libroCompleto();
  const fantasia = TEMAS.find((t) => t.id === 'fantasia')!.tema;
  const cab = { id: nuevoId('i'), nombre: 'cabecera.png', tipoMime: 'image/png', datos: pngSolido(300, 60), ancho: 300, alto: 60 };
  const orn = { id: nuevoId('i'), nombre: 'ornamento.png', tipoMime: 'image/png', datos: pngSolido(40, 12), ancho: 40, alto: 12 };
  l.recursos.push(cab, orn);
  l.tema = { ...fantasia, separador: 'imagen', separadorImagen: orn.id };
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.imagenCabecera = cab.id;
  cap.titulo = 'Capítulo 1: El despertar';
  const archivos = compilarArchivos(l);
  const opf = archivos.get('package.opf') as string;
  assert.match(opf, /href="fuentes\/eb-garamond-latin-400-normal\.woff2" media-type="font\/woff2"/);
  assert.match(opf, /href="fuentes\/cinzel-latin-700-normal\.woff2"/);
  assert.doesNotMatch(opf, /cinzel-latin-400-italic/);
  const css = archivos.get('estilos.css') as string;
  assert.match(css, /@font-face \{ font-family: 'EB Garamond'/);
  assert.match(css, /::first-letter/);
  assert.match(css, /::first-line/);
  assert.match(css, /h1 \.etiqueta \{ display: block/);
  const x = archivos.get(`${cap.id}.xhtml`) as string;
  assert.match(x, /<div class="cabecera-capitulo"><img src="img\/cabecera\.png" alt="" role="presentation"\/><\/div>/);
  assert.match(x, /<h1 id="t-[^"]+"><span class="etiqueta">Capítulo 1<\/span><span class="sep">: <\/span><span class="nombre">El despertar<\/span><\/h1>/);
  assert.match(x, /<div class="escena imagen" role="separator"><img src="img\/ornamento\.png"/);
  if (hayEpubcheck) {
    const r = await validarDatos(await compilar(l));
    assert.deepEqual(r.mensajes.map((m) => `${m.codigo} ${m.original}`), []);
  }
  // Ida y vuelta: título completo e imagen de cabecera.
  const { libro } = await importarEpub(await compilar(l));
  const c2 = libro.secciones.find((s) => s.tipo === 'capitulo')!;
  assert.equal(c2.titulo, 'Capítulo 1: El despertar');
  assert.equal(libro.recursos.find((r) => r.id === c2.imagenCabecera)?.nombre, 'cabecera.png');
  assert.equal(c2.bloques.length, cap.bloques.length);
});

test('EPUBCheck: cada tema de la galería da un EPUB sin errores ni avisos', { skip: !hayEpubcheck, timeout: 300_000 }, async () => {
  const { TEMAS } = await import('../temas.js');
  for (const g of TEMAS) {
    const l = libroCompleto();
    l.tema = g.tema;
    const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
    cap.titulo = 'Capítulo 1: El despertar';
    const r = await validarDatos(await compilar(l));
    assert.deepEqual(r.mensajes.map((m) => `${g.id}: ${m.codigo} ${m.original}`), []);
  }
});
