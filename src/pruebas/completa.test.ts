// Versión completa: tablas editables, glosario, estadísticas, avance y configuración del corrector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { estadisticasLibro, libroNuevo, nuevaSeccion, parrafo, type Bloque, type Libro, type Tabla } from '../model.js';
import { compilar } from '../compilar.js';
import { htmlImpresion } from '../impresion.js';
import { importarEpub } from '../formatos/epub.js';
import { validarDatos } from '../validar.js';
import { claveTermino, glosarioACsv, glosarioDeCsv, glosarioValido, revisarGlosario, bloquesGlosario } from '../glosario.js';
import { serializarProyecto, deserializarProyecto } from '../proyecto.js';

const tx = (texto: string) => [{ tipo: 'texto' as const, texto }];

function tablaPrueba(): Tabla {
  return {
    tipo: 'tabla',
    titulo: 'Estadísticas de Aria',
    filas: [
      [{ contenido: tx('Atributo'), encabezado: true }, { contenido: tx('Valor'), encabezado: true }],
      [{ contenido: tx('Fuerza'), encabezado: true }, { contenido: [{ tipo: 'texto', texto: '120', marcas: ['negrita'] }], alinear: 'derecha' }],
      [{ contenido: tx('Magia'), encabezado: true }, { contenido: tx('S+'), alinear: 'centro' }],
      [{ contenido: tx('Habilidad única: «Ojo del dragón»'), columnas: 2 }],
    ],
  };
}

function libroTabla(): Libro {
  const l = libroNuevo('Tablas', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.titulo = 'Capítulo 1';
  cap.bloques = [parrafo('Antes de la tabla.'), tablaPrueba(), parrafo('Después.')];
  return l;
}

test('Tabla editable: EPUB válido, accesible e ida y vuelta sin pérdidas', async () => {
  const l = libroTabla();
  const cap = l.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  const datos = await compilar(l);
  const v = await validarDatos(datos);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  const xhtml = await (await JSZip.loadAsync(datos)).file(`EPUB/${cap.id}.xhtml`)!.async('string');
  assert.match(xhtml, /<table class="tabla"><caption>Estadísticas de Aria<\/caption><thead><tr><th scope="col">Atributo<\/th>/);
  assert.match(xhtml, /<th scope="row">Fuerza<\/th><td class="al-derecha"><b>120<\/b><\/td>|<th scope="row">Fuerza<\/th><td class="al-derecha"><strong>120<\/strong><\/td>/);
  assert.match(xhtml, /<td colspan="2">Habilidad única/);
  const { libro } = await importarEpub(datos);
  assert.deepEqual(libro.secciones.find((s) => s.titulo === 'Capítulo 1')!.bloques, cap.bloques);
});

test('Tabla en el editor, el PDF y el Word de corrección', async () => {
  const l = libroTabla();
  const cap = l.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  const { bloquesAPM, pmABloques } = await import('../editor-modelo.js');
  assert.deepEqual(pmABloques(bloquesAPM(cap.bloques)), cap.bloques);
  const html = htmlImpresion(l, { digital: true } as never);
  assert.match(html, /<table class="tabla"><caption>Estadísticas de Aria/);
  const { exportarWord, importarCorrecciones } = await import('../formatos/word.js');
  const docx = await exportarWord(l);
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:gridSpan w:val="2"\/>/);
  const copia = structuredClone(l);
  const r = await importarCorrecciones(copia, docx);
  assert.equal(r.avisos.length, 0, r.avisos.join());
  assert.deepEqual(copia.secciones.find((s) => s.id === cap.id)!.bloques, cap.bloques, 'sin cambios en Word, la tabla vuelve igual');
  // Una corrección dentro de una celda: cambia el texto y se conserva la estructura.
  const zip = await JSZip.loadAsync(docx);
  zip.file('word/document.xml', xml.replace('>S+<', '>SS<'));
  const corregida = structuredClone(l);
  await importarCorrecciones(corregida, await zip.generateAsync({ type: 'uint8array' }));
  const t = corregida.secciones.find((s) => s.id === cap.id)!.bloques.find((b) => b.tipo === 'tabla') as Tabla;
  assert.deepEqual(t.filas[2][1], { contenido: tx('SS'), alinear: 'centro' });
  assert.equal(t.titulo, 'Estadísticas de Aria');
});

test('Glosario: claves, revisión de grafías, CSV y página del libro', () => {
  assert.equal(claveTermino('Satō'), claveTermino('Satou'));
  assert.equal(claveTermino('Ryūnosuke'), claveTermino('Ryuunosuke'));
  assert.equal(claveTermino('Kirito-kun'), claveTermino('Kirito kun'));
  const l = libroNuevo('Glosario', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [parrafo('Satō llegó tarde. Satou se disculpó.'), parrafo('El gremio de Aldebarán. La espada Excalibur brilla, la Escalibur no.')];
  l.glosario = glosarioValido([
    { id: 'g1', termino: 'Satō', tipo: 'personaje', lectura: 'Satō', original: '佐藤', descripcion: 'Protagonista.', enLibro: true },
    { id: 'g2', termino: 'Excalibur', tipo: 'objeto', variantes: ['Escalibur'] },
    { id: 'g3', termino: 'Aldebarán', tipo: 'lugar', enLibro: true },
    { tipo: 'nada' },
    'basura',
  ]);
  assert.equal(l.glosario.length, 3);
  const r = revisarGlosario(l);
  assert.equal(r.usos.g1, 1);
  assert.equal(r.usos.g2, 1);
  const variantes = r.hallazgos.map((h) => [h.encontrado, h.termino, h.tipo, h.veces]);
  assert.deepEqual(
    variantes.sort(),
    [
      ['Escalibur', 'Excalibur', 'variante', 1],
      ['Satou', 'Satō', 'parecido', 1],
    ].sort(),
  );
  assert.match(r.hallazgos.find((h) => h.encontrado === 'Satou')!.ejemplos[0].contexto, /Satou se disculpó/);
  // Una variante que solo cambia las mayúsculas no marca la grafía correcta.
  const may = revisarGlosario({ secciones: [{ ...cap, bloques: [parrafo('Un bosque. El Bosque.')] }], glosario: [{ id: 'b', termino: 'bosque', tipo: 'lugar', variantes: ['Bosque'] }] });
  assert.deepEqual(may.hallazgos.map((h) => h.encontrado), ['Bosque']);
  const csv = glosarioACsv(l.glosario);
  const vuelta = glosarioDeCsv(csv);
  assert.deepEqual(
    vuelta.map(({ id: _i, ...r }) => r),
    l.glosario.map(({ id: _i, ...r }) => r),
  );
  const b = bloquesGlosario(l.glosario);
  const texto = JSON.stringify(b);
  assert.ok(texto.includes('Satō') && texto.includes('Aldebarán') && !texto.includes('Excalibur'), 'solo las entradas «en el libro»');
});

test('Glosario en el backend: unificar, importar de otro volumen y página válida', async () => {
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-glosario-')));
  b.nuevo('Volumen 2', 'Autora');
  const cap = b.libro.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [parrafo('Satou miró a Satō. Satoukibi es otra palabra.')];
  b.guardarGlosario([{ id: 'g1', termino: 'Satō', tipo: 'personaje', enLibro: true, descripcion: 'Protagonista.' }]);
  assert.equal(b.revisionGlosario().hallazgos.length, 1);
  const n = b.unificarTermino('g1', 'Satou');
  assert.equal(n, 1);
  assert.equal(JSON.stringify(cap.bloques).includes('Satoukibi'), true, 'solo palabras completas');
  assert.equal(b.revisionGlosario().hallazgos.length, 0);
  assert.ok((b.libro.versiones ?? []).some((v) => v.nombre.includes('Satou')), 'guarda una versión antes');

  // Importar del .obi de otro volumen: añade lo que falta, no repite.
  const otro = libroNuevo('Volumen 1', 'Autora');
  otro.glosario = [
    { id: 'x1', termino: 'satō', tipo: 'personaje' },
    { id: 'x2', termino: 'Aldebarán', tipo: 'lugar', enLibro: true },
  ];
  const r = await b.importarGlosario('vol1.obi', await serializarProyecto(otro));
  assert.deepEqual(r, { nuevas: 1, total: 2 });
  const csv = await b.importarGlosario('mas.csv', new TextEncoder().encode('termino,tipo\nExcalibur,objeto\n'));
  assert.equal(csv.total, 3);
  await assert.rejects(b.importarGlosario('x.pdf', new Uint8Array(3)), /csv/);

  const id = b.paginaGlosario();
  const pag = b.seccion(id);
  assert.equal(pag.tipo, 'apendice');
  assert.equal(b.paginaGlosario(), id, 'la segunda vez actualiza la misma página');
  const v = await validarDatos(await compilar(b.libro));
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  const { nombre, datos } = b.exportarGlosario('json');
  assert.match(nombre, /glosario\.json$/);
  assert.equal(JSON.parse(new TextDecoder().decode(datos)).glosario.length, 3);

  // El glosario y el avance viajan en el proyecto .obi.
  cap.avance = 'revision';
  const p = await deserializarProyecto(await serializarProyecto(b.libro));
  assert.equal(p.glosario?.length, 3);
  assert.equal(p.secciones.find((s) => s.id === cap.id)?.avance, 'revision');
});

test('Estadísticas: palabras, japonés, diálogo y avance', () => {
  const l = libroNuevo('Cifras', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const bloques: Bloque[] = [parrafo('Uno dos tres cuatro.'), parrafo('—Cinco seis —dijo.'), parrafo('日本語の文。')];
  cap.bloques = bloques;
  cap.avance = 'listo';
  const otro = nuevaSeccion('capitulo', 'Capítulo 2');
  otro.bloques = [parrafo(Array.from({ length: 460 }, () => 'palabra').join(' '))];
  l.secciones.push(otro);
  const e = estadisticasLibro(l);
  const c1 = e.secciones.find((s) => s.id === cap.id)!;
  assert.equal(c1.palabras, 7);
  assert.equal(c1.cjk, 5);
  assert.equal(c1.parrafos, 3);
  assert.ok(c1.dialogos >= 1);
  assert.equal(e.palabras, 7 + 460 + e.secciones.filter((s) => s.id !== cap.id && s.id !== otro.id).reduce((a, s) => a + s.palabras, 0));
  assert.ok(e.minutos >= 2 && e.minutos < 3, String(e.minutos));
  assert.ok(e.porAvance.listo > 0 && e.porAvance.sin > 0);
});

test('Configuración del corrector: idiomas válidos y el idioma del libro', async () => {
  const { diccionariosPara, ArchivoConfiguracion } = await import('../configuracion.js');
  const disponibles = ['es', 'es-MX', 'en-US', 'en-GB', 'pt-BR', 'fr'];
  assert.deepEqual(diccionariosPara(['es', 'en', 'pt-BR', 'ja'], disponibles), ['es', 'es-MX', 'en-US', 'en-GB', 'pt-BR']);
  const carpeta = await mkdtemp(join(tmpdir(), 'obi-config-'));
  const archivo = new ArchivoConfiguracion(join(carpeta, 'c.json'));
  assert.deepEqual((await archivo.leer()).idiomasCorrector, ['es']);
  const c = await archivo.cambiar({ idiomasCorrector: ['es', 'en-US', '<script>', 3 as never], buscarActualizaciones: false });
  assert.deepEqual(c.idiomasCorrector, ['es', 'en-US']);
  assert.equal(c.buscarActualizaciones, false);
  assert.equal(c.corregirIdiomaLibro, true);
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(carpeta);
  b.configuracion = archivo;
  b.nuevo('Corrector', 'Autora');
  b.libro.metadatos.idioma = 'pt-BR';
  assert.deepEqual(await b.idiomasCorrector(), ['es', 'en-US', 'pt-BR']);
  b.libro.metadatos.idioma = 'en-GB';
  assert.deepEqual(await b.idiomasCorrector(), ['es', 'en-US'], 'el inglés ya está');
  await archivo.cambiar({ corregirIdiomaLibro: false });
  b.libro.metadatos.idioma = 'fr';
  assert.deepEqual(await b.idiomasCorrector(), ['es', 'en-US']);
});
