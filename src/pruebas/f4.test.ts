import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libroNuevo, nuevoId, parrafo, type Bloque, type Libro, type Seccion } from '../model.js';
import { compilar, compilarArchivos, tateChuYoko } from '../compilar.js';
import { importarEpub } from '../formatos/epub.js';
import { validarDatos, rutaEpubcheck } from '../validar.js';
import { pngSolido } from './fixtures.js';

const hayEpubcheck = !!rutaEpubcheck();

export function libroVertical(): Libro {
  const l = libroNuevo('剣の夜明け', '田中');
  l.metadatos.idioma = 'ja';
  l.escritura = 'vertical';
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.titulo = '第1章 目覚め';
  cap.bloques = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: '朝は12時に来た。本当に!?' }] },
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'ruby', base: '勇者', lectura: 'ゆうしゃ' }, { tipo: 'texto', texto: 'は' }, { tipo: 'texto', texto: '絶対', marcas: ['enfasis'] }, { tipo: 'texto', texto: 'に負けない。' }] },
    { tipo: 'separador' },
    parrafo('2026年の冬だった。'),
  ];
  const ilu = { id: nuevoId('i'), nombre: 'ilu.png', tipoMime: 'image/png', datos: pngSolido(60, 90), ancho: 60, alto: 90 };
  const doble = { id: nuevoId('i'), nombre: 'doble.png', tipoMime: 'image/png', datos: pngSolido(120, 90), ancho: 120, alto: 90 };
  l.recursos.push(ilu, doble);
  const pagina = (recurso: string, alt: string, extra: Partial<Seccion> = {}): Seccion => ({
    id: nuevoId('s'), tipo: 'ilustracion', titulo: '', mostrarTitulo: false, enIndice: false, notas: [], paginaFija: true,
    bloques: [{ tipo: 'imagen', recurso, alt }], ...extra,
  });
  l.secciones.splice(1, 0, pagina(ilu.id, '口絵'), pagina(doble.id, '見開きの口絵', { doblePagina: true }));
  return l;
}

test('tate-chū-yoko: números de una o dos cifras y «!?»', () => {
  assert.equal(tateChuYoko('12時、2026年、3人!?'), '<span class="tcy">12</span>時、2026年、<span class="tcy">3</span>人<span class="tcy">!?</span>');
});

test('escritura vertical: CSS, progresión rtl, tcy, énfasis y páginas fijas con doble página real', () => {
  const l = libroVertical();
  const archivos = compilarArchivos(l);
  const opf = archivos.get('package.opf') as string;
  assert.match(opf, /<spine toc="ncx" page-progression-direction="rtl">/);
  const [ilu, doble] = l.secciones.slice(1, 3);
  assert.match(opf, new RegExp(`<itemref idref="${ilu.id}" properties="rendition:layout-pre-paginated rendition:spread-none"/>`));
  // Vertical: la doble página empieza por la mitad derecha.
  assert.match(opf, new RegExp(`<itemref idref="${doble.id}" properties="rendition:layout-pre-paginated rendition:page-spread-right"/>\\n<itemref idref="${doble.id}-b" properties="rendition:layout-pre-paginated rendition:page-spread-left"/>`));
  const css = archivos.get('estilos.css') as string;
  assert.match(css, /writing-mode: vertical-rl/);
  assert.match(css, /text-combine-upright: all/);
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const x = archivos.get(`${cap.id}.xhtml`) as string;
  assert.match(x, /<span class="tcy">12<\/span>時/);
  assert.match(x, /<span class="tcy">!\?<\/span>/);
  assert.match(x, /2026年/);
  assert.match(x, /<span class="boten">絶対<\/span>/);
  const fija = archivos.get(`${ilu.id}.xhtml`) as string;
  assert.match(fija, /<meta name="viewport" content="width=60, height=90"\/>/);
  assert.match(archivos.get(`${doble.id}-b.xhtml`) as string, /<meta name="viewport" content="width=60, height=90"\/>/);
});

test('EPUBCheck: libro vertical con páginas fijas sin errores ni avisos', { skip: !hayEpubcheck }, async () => {
  const r = await validarDatos(await compilar(libroVertical()));
  assert.deepEqual(r.mensajes.map((m) => `${m.codigo} ${m.original}`), []);
});

test('EPUBCheck: libro horizontal con doble página fija', { skip: !hayEpubcheck }, async () => {
  const l = libroVertical();
  l.escritura = undefined;
  l.metadatos.idioma = 'es';
  const opf = compilarArchivos(l).get('package.opf') as string;
  assert.match(opf, /page-spread-left"\/>\n<itemref idref="[^"]+-b" properties="rendition:layout-pre-paginated rendition:page-spread-right"/);
  const r = await validarDatos(await compilar(l));
  assert.deepEqual(r.mensajes.map((m) => `${m.codigo} ${m.original}`), []);
});

test('ida y vuelta: escritura vertical, énfasis, páginas fijas y doble página', async () => {
  const original = libroVertical();
  const { libro } = await importarEpub(await compilar(original));
  assert.equal(libro.escritura, 'vertical');
  assert.deepEqual(
    libro.secciones.map((s) => [s.tipo, !!s.paginaFija, !!s.doblePagina]),
    original.secciones.map((s) => [s.tipo, !!s.paginaFija, !!s.doblePagina]),
  );
  const cap = libro.secciones.find((s) => s.tipo === 'capitulo')!;
  const capOrig = original.secciones.find((s) => s.tipo === 'capitulo')!;
  assert.deepEqual(cap.bloques, capOrig.bloques);
  assert.equal(cap.titulo, '第1章 目覚め');
  const doble = libro.secciones[2];
  assert.deepEqual(doble.bloques.map((b) => b.tipo === 'imagen' && b.alt), ['見開きの口絵']);
});

// ---------- KEPUB ----------
import JSZip from 'jszip';
import { compilarKepub, kepubXhtml } from '../kepub.js';
import { exportarWord, importarCorrecciones, rubiesDeTexto } from '../formatos/word.js';
import { importarDocx } from '../formatos/docx.js';

function libroTexto(): Libro {
  const l = libroNuevo('La espada del alba', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const n = nuevoId('n');
  const img = { id: nuevoId('i'), nombre: 'ilu.png', tipoMime: 'image/png', datos: pngSolido(80, 60), ancho: 80, alto: 60 };
  l.recursos.push(img);
  cap.bloques = [
    parrafo('—Hola. ¿Vienes? Bien…'),
    { tipo: 'parrafo', estilo: 'pensamiento', contenido: [{ tipo: 'texto', texto: 'Qué raro' }, { tipo: 'nota', id: n }] },
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [
      { tipo: 'texto', texto: 'Era ' }, { tipo: 'texto', texto: 'muy', marcas: ['negrita'] }, { tipo: 'texto', texto: ' ' },
      { tipo: 'texto', texto: 'extraño', marcas: ['cursiva'] }, { tipo: 'texto', texto: ', ' }, { tipo: 'texto', texto: 'Versalitas', marcas: ['versalitas'] },
      { tipo: 'texto', texto: ' y ' }, { tipo: 'ruby', base: '勇者', lectura: 'ゆうしゃ' }, { tipo: 'texto', texto: ' ' }, { tipo: 'texto', texto: 'énfasis', marcas: ['enfasis'] }, { tipo: 'texto', texto: '.' },
    ] },
    { tipo: 'separador' },
    parrafo('¡BOOM!', 'centrado'),
    parrafo('Firmado.', 'derecha'),
    { tipo: 'parrafo', estilo: 'onomatopeya', contenido: [{ tipo: 'texto', texto: 'Crash' }] },
    { tipo: 'parrafo', estilo: 'carta', contenido: [{ tipo: 'texto', texto: 'Querida Aria:' }] },
    { tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto: 'El mercado' }] },
    { tipo: 'imagen', recurso: img.id, alt: 'Aria en el mercado' },
    { tipo: 'lista', ordenada: false, elementos: [[{ tipo: 'texto', texto: 'Fuerza: 10' }], [{ tipo: 'texto', texto: 'Magia: 3' }]] },
    { tipo: 'crudo', xhtml: '<table><tr><td>HP</td><td>100</td></tr></table>' },
    parrafo('Fin del capítulo.'),
  ];
  cap.notas = [{ id: n, contenido: [{ tipo: 'texto', texto: 'Nota de la traductora.' }] }];
  return l;
}

test('KEPUB: frases en koboSpan, contenedores de Kobo y EPUBCheck sin errores', async () => {
  const x = kepubXhtml('<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><p>Hola. ¿Vienes? <b>Sí.</b></p></body></html>');
  assert.match(x, /<div id="book-columns"><div id="book-inner"><p><span class="koboSpan" id="kobo\.1\.1">Hola\. <\/span><span class="koboSpan" id="kobo\.1\.2">¿Vienes\? <\/span><b><span class="koboSpan" id="kobo\.1\.3">Sí\.<\/span><\/b><\/p><\/div><\/div>/);
  const l = libroTexto();
  const kepub = await compilarKepub(l);
  const zip = await JSZip.loadAsync(kepub);
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const xhtml = await zip.file(`EPUB/${cap.id}.xhtml`)!.async('string');
  assert.match(xhtml, /class="koboSpan" id="kobo\.\d+\.\d+"/);
  assert.match(xhtml, /<span class="koboSpan" id="kobo\.\d+\.\d+"><ruby>勇者/);
  if (hayEpubcheck) {
    const r = await validarDatos(kepub);
    assert.deepEqual(r.mensajes.map((m) => `${m.codigo} ${m.original}`), []);
  }
});

// ---------- Word de ida y vuelta ----------

test('furigana con la convención de Aozora Bunko', () => {
  assert.deepEqual(rubiesDeTexto([{ tipo: 'texto', texto: 'El ｜勇者《ゆうしゃ》 y 魔王《まおう》.' }]), [
    { tipo: 'texto', texto: 'El ' }, { tipo: 'ruby', base: '勇者', lectura: 'ゆうしゃ' }, { tipo: 'texto', texto: ' y ' }, { tipo: 'ruby', base: '魔王', lectura: 'まおう' }, { tipo: 'texto', texto: '.' },
  ]);
});

test('Word: exportar y volver a importar conserva estilos, marcas, furigana, notas, imágenes y bloques XHTML', async () => {
  const l = libroTexto();
  const docx = await exportarWord(l);
  const { libro: desdeWord } = await importarDocx(docx);
  const cap = desdeWord.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  const orig = l.secciones.find((s) => s.tipo === 'capitulo')!;
  // Sin marcadores, el texto y los estilos son iguales (la imagen vuelve como recurso nuevo, el XHTML como marcador).
  const simplificar = (b: Bloque[]) => b.filter((x) => x.tipo !== 'crudo' && x.tipo !== 'imagen' && !(x.tipo === 'parrafo' && /⟦/.test(JSON.stringify(x))));
  assert.deepEqual(JSON.stringify(simplificar(cap.bloques)).replace(/"id":"n[^"]+"/g, ''), JSON.stringify(simplificar(orig.bloques)).replace(/"id":"n[^"]+"/g, ''));
  // Sin cambios: la fusión no toca nada.
  const r = await importarCorrecciones(l, docx);
  assert.deepEqual(r.actualizadas, []);
  assert.deepEqual(r.nuevas, []);
  assert.equal(r.sinCambios, 3);
  assert.equal(l.recursos.length, 1);
});

test('Word: las correcciones se funden por capítulo sin perder ilustraciones, XHTML ni tema', async () => {
  const original = libroTexto();
  original.tema = { ...original.tema, nombre: 'Mío', capitular: 'letra' };
  const ilu = { id: nuevoId('s'), tipo: 'ilustracion' as const, titulo: '', mostrarTitulo: false, enIndice: false, notas: [], bloques: [{ tipo: 'imagen' as const, recurso: original.recursos[0].id, alt: 'Lámina' }] };
  original.secciones.splice(1, 0, ilu);
  // El corrector cambia una frase y añade un capítulo nuevo al final.
  const corregido: Libro = structuredClone(original);
  const capC = corregido.secciones.find((s) => s.tipo === 'capitulo')!;
  capC.bloques[0] = parrafo('—Hola. ¿Vienes conmigo? Bien…');
  corregido.secciones.push({ id: nuevoId('s'), tipo: 'capitulo', titulo: 'Capítulo 2', mostrarTitulo: true, enIndice: true, notas: [], bloques: [parrafo('Texto nuevo.')] });
  const r = await importarCorrecciones(original, await exportarWord(corregido));
  assert.deepEqual(r.actualizadas, ['Capítulo 1']);
  assert.deepEqual(r.nuevas, ['Capítulo 2']);
  const cap = original.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  assert.equal(cap.bloques[0].tipo === 'parrafo' && cap.bloques[0].contenido[0].tipo === 'texto' && cap.bloques[0].contenido[0].texto, '—Hola. ¿Vienes conmigo? Bien…');
  assert.ok(cap.bloques.some((b) => b.tipo === 'crudo' && b.xhtml.includes('<table>')));
  const img = cap.bloques.find((b) => b.tipo === 'imagen');
  assert.ok(img && img.tipo === 'imagen' && img.recurso === original.recursos[0].id && img.alt === 'Aria en el mercado');
  assert.equal(original.recursos.length, 1);
  assert.ok(original.secciones.some((s) => s.tipo === 'ilustracion'));
  assert.equal(original.tema.nombre, 'Mío');
  assert.equal(original.secciones.at(-1)!.titulo, 'Capítulo 2');
  if (hayEpubcheck) {
    const v = await validarDatos(await compilar(original));
    assert.deepEqual(v.mensajes.map((m) => m.codigo), []);
  }
});
