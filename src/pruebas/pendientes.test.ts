import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libroNuevo, nuevaSeccion, parrafo, type Libro } from '../model.js';
import { buscar, reemplazar } from '../buscar.js';

function libroBusqueda(): Libro {
  const l = libroNuevo('Búsquedas', 'Autora');
  const cap = nuevaSeccion('capitulo', 'Capítulo 1');
  cap.bloques = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'Aria vio la ' }, { tipo: 'texto', texto: 'casa', marcas: ['negrita'] }, { tipo: 'texto', texto: ' y la Casa vieja.' }] },
    parrafo('Casamiento en casa de Aria.'),
    { tipo: 'lista', ordenada: false, elementos: [[{ tipo: 'texto', texto: 'una casa' }]] },
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'El ' }, { tipo: 'ruby', base: '勇者', lectura: 'ゆうしゃ' }, { tipo: 'texto', texto: ' llegó a casa' }, { tipo: 'nota', id: 'n1' }] },
  ];
  cap.notas = [{ id: 'n1', contenido: [{ tipo: 'texto', texto: 'La casa era de Aria.' }] }];
  l.secciones.push(cap);
  return l;
}

test('Buscar: mayúsculas, palabra completa, regex, notas y listas', () => {
  const l = libroBusqueda();
  assert.equal(buscar(l, { consulta: 'casa' }).total, 7);
  assert.equal(buscar(l, { consulta: 'casa', palabraCompleta: true }).total, 6);
  assert.equal(buscar(l, { consulta: 'Casa', mayusculas: true }).total, 2);
  const r = buscar(l, { consulta: 'la casa' });
  assert.deepEqual(r.coincidencias.map((c) => [c.lugar, c.texto]), [['b0', 'la casa'], ['b0', 'la Casa'], ['n0', 'La casa']]);
  assert.equal(r.coincidencias[0].antes, 'Aria vio ');
  assert.equal(buscar(l, { consulta: 'c(a|o)sa\\b', regex: true }).total, 6);
  assert.throws(() => buscar(l, { consulta: '(', regex: true }), /Expresión regular no válida/);
  assert.throws(() => buscar(l, { consulta: 'x*', regex: true }), /texto vacío/);
  // No cruza el furigana.
  assert.equal(buscar(l, { consulta: 'El  llegó' }).total, 0);
});

test('Reemplazar: conserva formato, furigana y notas; uno o todos', () => {
  const l = libroBusqueda();
  const cap = l.secciones.at(-1)!;
  const una = buscar(l, { consulta: 'la casa' }).coincidencias[0];
  assert.equal(reemplazar(l, { consulta: 'la casa' }, 'el hogar', una).n, 1);
  assert.deepEqual(cap.bloques[0].tipo === 'parrafo' && cap.bloques[0].contenido, [
    { tipo: 'texto', texto: 'Aria vio el hogar y la Casa vieja.' },
  ]);
  const r = reemplazar(l, { consulta: 'casa', palabraCompleta: true }, 'morada');
  assert.equal(r.n, 5);
  assert.deepEqual(r.secciones, [cap.id]);
  const b3 = cap.bloques[3];
  assert.ok(b3.tipo === 'parrafo');
  assert.deepEqual(b3.contenido.map((i) => i.tipo), ['texto', 'ruby', 'texto', 'nota']);
  assert.match(JSON.stringify(cap.bloques), /Casamiento en morada de Aria/);
  assert.match(JSON.stringify(cap.notas), /La morada era/);
  // Regex con grupos.
  reemplazar(l, { consulta: '(\\p{Lu})ria', regex: true }, '$1rya');
  assert.match(JSON.stringify(cap.bloques), /Arya vio/);
  // Negrita: el reemplazo toma el formato del inicio de la coincidencia.
  const l2 = libroBusqueda();
  reemplazar(l2, { consulta: 'casa y', mayusculas: true }, 'mansión y');
  const p = l2.secciones.at(-1)!.bloques[0];
  assert.ok(p.tipo === 'parrafo');
  assert.deepEqual(p.contenido, [{ tipo: 'texto', texto: 'Aria vio la ' }, { tipo: 'texto', texto: 'mansión y', marcas: ['negrita'] }, { tipo: 'texto', texto: ' la Casa vieja.' }]);
});

// ---------------------------------------------------------------------------
// Versiones.

import { compararVersion, crearVersion, eliminarVersion, restaurarVersion } from '../versiones.js';
import { deserializarProyecto, serializarProyecto } from '../proyecto.js';
import { compilar } from '../compilar.js';
import { pngSolido } from './fixtures.js';

test('Versiones: guardar, comparar, restaurar con imágenes borradas y guardar en el .obi', async () => {
  const l = libroBusqueda();
  l.recursos.push({ id: 'img', nombre: 'img.png', tipoMime: 'image/png', datos: pngSolido(30, 30), ancho: 30, alto: 30 });
  const cap = l.secciones.at(-1)!;
  cap.bloques.push({ tipo: 'imagen', recurso: 'img', alt: 'Un cuadro' });
  assert.throws(() => crearVersion(l, '  '), /nombre/);
  const v1 = crearVersion(l, 'Primer borrador');
  assert.equal(v1.nombre, 'Primer borrador');
  // Cambios: se edita el capítulo, se borra la imagen y se añade una sección.
  reemplazar(l, { consulta: 'casa' }, 'hogar');
  cap.bloques = cap.bloques.filter((b) => b.tipo !== 'imagen');
  l.recursos = [];
  l.secciones.push(nuevaSeccion('epilogo', 'Epílogo'));
  const dif = compararVersion(l, v1.id);
  assert.deepEqual(dif.filter((d) => d.estado !== 'igual').map((d) => [d.titulo, d.estado]), [['Capítulo 1', 'cambiada'], ['Epílogo', 'nueva']]);

  // Se guarda el proyecto: la imagen borrada viaja para la versión.
  const recargado = await deserializarProyecto(await serializarProyecto(l));
  assert.equal(recargado.versiones!.length, 1);
  assert.equal(recargado.recursosVersiones!.length, 1);
  const r = restaurarVersion(recargado, v1.id);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.libro.recursos.length, 1);
  assert.match(JSON.stringify(r.libro.secciones), /casa/);
  assert.ok(!r.libro.secciones.some((s) => s.titulo === 'Epílogo'));
  assert.deepEqual(r.libro.versiones!.map((v) => v.nombre), ['Primer borrador', 'Antes de restaurar «Primer borrador»']);
  assert.ok((await compilar(r.libro)).length > 1000);
  // La versión «Antes de restaurar» devuelve el estado con el epílogo.
  const atras = restaurarVersion(r.libro, r.libro.versiones![1].id);
  assert.ok(atras.libro.secciones.some((s) => s.titulo === 'Epílogo'));

  // Borrar versiones poda las imágenes que ya nadie usa.
  const l2 = r.libro;
  for (const v of [...l2.versiones!]) eliminarVersion(l2, v.id);
  assert.equal(l2.versiones, undefined);
  assert.equal(l2.recursosVersiones, undefined);
  // Sin versiones, el .obi no duplica imágenes.
  const zip = await (await import('jszip')).default.loadAsync(await serializarProyecto(l2));
  assert.deepEqual(Object.keys(zip.files).filter((f) => f.endsWith('.png')), ['recursos/img-img.png']);
});

// ---------------------------------------------------------------------------
// Control de cambios.

import { aceptarCambio, aceptarTodos, rechazarCambio } from '../cambios.js';
import { diferenciaPalabras, textoBloques } from '../diferencias.js';
import { exportarWord, importarCorrecciones } from '../formatos/word.js';

function libroRevision(): Libro {
  const l = libroNuevo('Revisión', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.titulo = 'Capítulo 1';
  cap.bloques = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'Primer párrafo.' }, { tipo: 'nota', id: 'n1' }] },
    parrafo('Segundo párrafo.'),
    parrafo('Tercer parrafo con herrores.'),
    parrafo('Cuarto párrafo.'),
  ];
  cap.notas = [{ id: 'n1', contenido: [{ tipo: 'texto', texto: 'Nota original.' }] }];
  return l;
}

test('Diferencias palabra por palabra', () => {
  assert.deepEqual(diferenciaPalabras('Tercer parrafo con herrores.', 'Tercer párrafo con errores.'), [
    { tipo: 'igual', texto: 'Tercer ' },
    { tipo: 'borrado', texto: 'parrafo' },
    { tipo: 'insertado', texto: 'párrafo' },
    { tipo: 'igual', texto: ' con ' },
    { tipo: 'borrado', texto: 'herrores' },
    { tipo: 'insertado', texto: 'errores' },
    { tipo: 'igual', texto: '.' },
  ]);
});

test('Control de cambios: las correcciones de Word quedan propuestas y se aceptan o rechazan una a una', async () => {
  const corregido = libroRevision();
  const c = corregido.secciones.find((s) => s.tipo === 'capitulo')!;
  c.titulo = 'Capítulo 1: El inicio';
  c.notas[0].contenido = [{ tipo: 'texto', texto: 'Nota corregida.' }];
  c.bloques[2] = parrafo('Tercer párrafo con errores.');
  c.bloques.push(parrafo('Quinto párrafo nuevo.'));
  const docx = await exportarWord(corregido);

  const l = libroRevision();
  const s = l.secciones.find((x) => x.tipo === 'capitulo')!;
  const antes = JSON.stringify(s.bloques);
  const r = await importarCorrecciones(l, docx, { revisar: true });
  assert.equal(r.cambios, 4);
  assert.equal(JSON.stringify(s.bloques), antes, 'el texto no cambia hasta aceptar');
  const [titulo, nota, tercero, quinto] = s.cambios!;
  assert.deepEqual(titulo.titulo, { antes: 'Capítulo 1', despues: 'Capítulo 1: El inicio' });
  assert.equal(textoBloques(tercero.antes), 'Tercer parrafo con herrores.');
  assert.equal(textoBloques(tercero.despues), 'Tercer párrafo con errores.');
  assert.equal(quinto.antes.length, 0);
  assert.equal(nota.notas?.length, 1);

  // Si el original se editó después, ese cambio no se aplica a ciegas.
  const editado = structuredClone(s);
  editado.bloques[2] = parrafo('Lo reescribí yo.');
  assert.throws(() => aceptarCambio(editado, tercero.id), /se editó después/);

  aceptarCambio(s, tercero.id);
  rechazarCambio(s, nota.id);
  aceptarCambio(s, quinto.id);
  aceptarCambio(s, titulo.id);
  assert.equal(s.cambios, undefined);
  assert.equal(s.titulo, 'Capítulo 1: El inicio');
  assert.deepEqual(s.bloques.map((b) => textoBloques([b])), ['Primer párrafo.', 'Segundo párrafo.', 'Tercer párrafo con errores.', 'Cuarto párrafo.', 'Quinto párrafo nuevo.']);
  assert.equal(textoBloques([]) , '');
  assert.match(JSON.stringify(s.notas), /Nota original/);

  // Aceptar todo con la nota: la nota nueva sustituye a la vieja.
  const l2 = libroRevision();
  await importarCorrecciones(l2, docx, { revisar: true });
  const s2 = l2.secciones.find((x) => x.tipo === 'capitulo')!;
  assert.deepEqual(aceptarTodos(s2), []);
  assert.equal(s2.notas.length, 1);
  assert.match(JSON.stringify(s2.notas), /Nota corregida/);
  assert.ok((await compilar(l2)).length > 1000);
});

// ---------------------------------------------------------------------------
// Fuente japonesa.

import { archivosJaponeses } from '../fuentes.js';
import { compilarArchivos, cssLibro } from '../compilar.js';
import { validarDatos } from '../validar.js';

test('Fuente japonesa: solo los subconjuntos que usa el libro, en EPUB válido', async () => {
  const sinJapones = libroBusqueda();
  sinJapones.secciones.at(-1)!.bloques = [parrafo('Solo texto en español.')];
  assert.deepEqual(archivosJaponeses(sinJapones), []);
  assert.doesNotMatch(cssLibro(sinJapones), /Noto Serif JP/);

  const l = libroBusqueda();
  const jp = archivosJaponeses(l);
  assert.ok(jp.length >= 2 && jp.length <= 12, `${jp.length} archivos para 勇者 y ゆうしゃ`);
  assert.ok(jp.every((a) => /^noto-serif-jp-\d+-(400|700)-normal\.woff2$/.test(a.archivo)));
  assert.match(cssLibro(l), /font-family: 'Noto Serif JP', serif|font-family: serif/);
  assert.match(cssLibro(l), /body \{ margin: 0 5%; font-family: 'Noto Serif JP', serif;/);
  const archivos = compilarArchivos(l);
  assert.ok([...archivos.keys()].some((k) => k.startsWith('fuentes/noto-serif-jp-')));

  l.escritura = 'vertical';
  l.tema = { ...l.tema, fuenteTexto: 'literata' };
  assert.match(cssLibro(l), /body \{ margin: 0 5%; font-family: 'Noto Serif JP', 'Literata', serif;/);
  l.escritura = undefined;
  assert.match(cssLibro(l), /body \{ margin: 0 5%; font-family: 'Literata', 'Noto Serif JP', serif;/);
  const r = await validarDatos(await compilar(l));
  assert.ok(r.valido, JSON.stringify(r.mensajes.slice(0, 3)));
  assert.equal(r.mensajes.length, 0);
});

// ---------------------------------------------------------------------------
// PDF/X-1a.

import { buscarGhostscript } from '../pdfx.js';
import { buscarNavegador } from '../pdf.js';
import { pdfDesdeLibro } from '../servicio-impresion.js';

test('PDF/X-1a: CMYK, PDF 1.3, OutputIntent y cajas de corte', { skip: (!buscarGhostscript() || !buscarNavegador()) && 'sin Ghostscript o Chrome' }, async () => {
  const l = libroBusqueda();
  l.impresion = { ...(l.impresion ?? {}), sangrado: 'uniforme', pdfx: true } as Libro['impresion'];
  l.recursos.push({ id: 'roja', nombre: 'roja.png', tipoMime: 'image/png', datos: pngSolido(300, 200, [200, 40, 40]), ancho: 300, alto: 200 });
  l.secciones.at(-1)!.bloques.push({ tipo: 'imagen', recurso: 'roja', alt: 'Rojo' });
  const r = await pdfDesdeLibro(l, 'impresion');
  const texto = Buffer.from(r.datos).toString('latin1');
  assert.ok(texto.startsWith('%PDF-1.3'));
  assert.match(texto, /GTS_PDFXVersion \(PDF\/X-1a:2001\)/);
  assert.match(texto, /\/OutputIntents/);
  assert.match(texto, /\/S \/GTS_PDFX/);
  assert.doesNotMatch(texto, /\/DeviceRGB/);
  assert.match(texto, /\/TrimBox/);
  assert.match(texto, /\/BleedBox/);
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(r.datos);
  const p = doc.getPage(0);
  assert.ok(p.getTrimBox().width < p.getBleedBox().width, 'el sangrado se conserva');
});
