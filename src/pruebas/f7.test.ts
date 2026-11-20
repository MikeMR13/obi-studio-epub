import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { libroNuevo, nuevoId, parrafo, type Bloque, type Libro } from '../model.js';
import { compilar } from '../compilar.js';
import { importarEpub } from '../formatos/epub.js';
import { validarDatos } from '../validar.js';
import { recuadrosDePrueba } from './fixtures.js';


function libroRecuadros(): Libro {
  const l = libroNuevo('Recuadros', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const n = nuevoId('n');
  cap.bloques = [parrafo('Antes.'), ...recuadrosDePrueba(n), parrafo('Después.')];
  cap.notas = [{ id: n, contenido: [{ tipo: 'texto', texto: 'Nota en una ventana.' }] }];
  return l;
}

test('Recuadros de novela ligera: EPUB válido e ida y vuelta sin pérdidas', async () => {
  const l = libroRecuadros();
  const datos = await compilar(l);
  const r = await validarDatos(datos);
  assert.equal(r.mensajes.length, 0, JSON.stringify(r.mensajes));
  const zip = await JSZip.loadAsync(datos);
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const xhtml = await zip.file(`EPUB/${cap.id}.xhtml`)?.async('string') ?? (await Promise.all(Object.keys(zip.files).filter((x) => x.endsWith('.xhtml')).map((x) => zip.file(x)!.async('string')))).find((x) => x.includes('recuadro'))!;
  assert.match(xhtml, /class="recuadro recuadro-sistema" role="group" aria-label="Ventana de sistema: Bienvenido a Eldoria"/);
  assert.match(xhtml, /<p class="mensaje der"><span class="emisor">Yo<\/span> <span class="globo">/);
  const { libro } = await importarEpub(datos);
  const vuelta = libro.secciones.find((s) => s.tipo === 'capitulo')!;
  const sinIds = (b: unknown) => JSON.stringify(b).replace(/"id":"n[^"]+"/g, '"id":"N"');
  assert.equal(sinIds(vuelta.bloques), sinIds(cap.bloques));
  assert.deepEqual(vuelta.notas.map((x) => x.contenido), cap.notas.map((x) => x.contenido));
});

test('Recuadros: editor, Word de ida y vuelta, búsqueda y tipografía', async () => {
  const { bloquesAPM, pmABloques } = await import('../editor-modelo.js');
  const { exportarWord, importarCorrecciones } = await import('../formatos/word.js');
  const { buscar, reemplazar } = await import('../buscar.js');
  const { aplicarTipografiaLibro } = await import('../tipografia.js');
  const l = libroRecuadros();
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  assert.deepEqual(pmABloques(bloquesAPM(cap.bloques)), cap.bloques);

  // Word: el corrector cambia texto dentro de la ventana de estado y del chat; los recuadros vuelven como recuadros.
  const docx = await exportarWord(l);
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /⟦Recuadro 3: Ventana de estado · Kaito Aizawa/);
  xml = xml.replace('120/120', '150/150').replace('Ahí estaré', 'Allí estaré');
  zip.file('word/document.xml', xml);
  const corregido = await zip.generateAsync({ type: 'uint8array' });
  const copia = structuredClone(l);
  const r = await importarCorrecciones(copia, corregido);
  assert.equal(r.avisos.length, 0, r.avisos.join());
  const vuelta = copia.secciones.find((s) => s.tipo === 'capitulo')!.bloques.filter((b) => b.tipo === 'recuadro');
  assert.equal(vuelta.length, 6);
  const estado = vuelta[2];
  assert.ok(estado.tipo === 'recuadro' && estado.lineas[1].etiqueta === 'PV' && JSON.stringify(estado.lineas[1].contenido) === JSON.stringify([{ tipo: 'texto', texto: '150/150' }]));
  const chat = vuelta[3];
  assert.ok(chat.tipo === 'recuadro' && chat.lineas[1].lado === 'der' && chat.lineas[1].etiqueta === 'Yo');
  assert.match(JSON.stringify(chat), /Allí estaré/);
  assert.equal(JSON.stringify(vuelta[0]).includes('"id"'), true, 'la nota sigue en la ventana');

  // Buscar y reemplazar, y tipografía española dentro de los recuadros.
  assert.equal(buscar(l, { consulta: 'azotea' }).total, 1);
  reemplazar(l, { consulta: 'azotea' }, 'terraza');
  assert.match(JSON.stringify(cap.bloques), /terraza/);
  const diario = cap.bloques.find((b) => b.tipo === 'recuadro' && b.variante === 'diario')!;
  if (diario.tipo === 'recuadro') diario.lineas[0].contenido = [{ tipo: 'texto', texto: 'Hoy... "por fin"' }];
  aplicarTipografiaLibro(l);
  assert.match(JSON.stringify(diario), /Hoy… «por fin»/);
});

test('Dividir una ilustración horizontal en dos páginas', async () => {
  const { Backend } = await import('../../app/backend.js');
  const { Jimp } = await import('jimp');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const img = new Jimp({ width: 800, height: 500, color: 0xff0000ff });
  for (let x = 400; x < 800; x++) for (let y = 0; y < 500; y++) img.setPixelColor(0x0000ffff, x, y);
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-div-')));
  b.libro = libroNuevo('Doble', 'A');
  b.libro.recursos.push({ id: 'doble', nombre: 'doble.png', tipoMime: 'image/png', datos: new Uint8Array(await img.getBuffer('image/png')), ancho: 800, alto: 500 });
  const s = { id: nuevoId('s'), tipo: 'ilustracion' as const, titulo: '', mostrarTitulo: false, enIndice: false, bloques: [{ tipo: 'imagen' as const, recurso: 'doble', alt: 'Batalla' }], notas: [], doblePagina: true };
  b.libro.secciones.push(s);
  const otra = await b.dividirIlustracion(s.id);
  const k = b.libro.secciones.findIndex((x) => x.id === s.id);
  assert.equal(b.libro.secciones[k + 1].id, otra);
  const [a, c] = [b.libro.secciones[k], b.libro.secciones[k + 1]].map((x) => x.bloques[0]);
  assert.ok(a.tipo === 'imagen' && c.tipo === 'imagen' && a.alt === 'Batalla (1 de 2)' && c.alt === 'Batalla (2 de 2)');
  const izq = b.libro.recursos.find((r) => a.tipo === 'imagen' && r.id === a.recurso)!;
  assert.deepEqual([izq.ancho, izq.alto], [400, 500]);
  const pix = (await Jimp.read(Buffer.from(izq.datos))).getPixelColor(10, 10);
  assert.equal(pix, 0xff0000ff, 'la primera página es la mitad izquierda');
  assert.ok(!b.libro.recursos.some((r) => r.id === 'doble') && !s.doblePagina);
  await assert.rejects(b.dividirIlustracion(otra), /no es horizontal/);
  const r = await validarDatos(await compilar(b.libro));
  assert.equal(r.mensajes.length, 0, JSON.stringify(r.mensajes));
});

test('Cubierta de imprenta: lomo de KDP, zona del código de barras, avisos y HTML', async () => {
  const { medidasCubierta, revisarCubierta, htmlCubierta, CODIGO_BARRAS } = await import('../cubierta.js');
  const l = libroNuevo('La espada del alba', 'Aiko');
  l.recursos.push({ id: 'p', nombre: 'portada.jpg', tipoMime: 'image/jpeg', datos: new Uint8Array(10), ancho: 900, alto: 1400 });
  l.metadatos.portada = 'p';
  l.metadatos.descripcion = 'Sinopsis del libro.';
  // 5,5 × 8,5 in, 240 páginas en crema: 240 × 0,0025 in = 0,6 in = 15,24 mm.
  const m = medidasCubierta(l, 240);
  assert.equal(m.lomo, 15.24);
  assert.equal(m.anchoTotal, Math.round((2 * 3.175 + 2 * 139.7 + 15.24) * 100) / 100);
  assert.equal(m.altoTotal, Math.round((2 * 3.175 + 215.9) * 100) / 100);
  l.cubierta = { imprenta: 'kdp', papel: 'blanco', colorFondo: '#000000', colorTexto: '#ffffff', codigoBarras: true };
  assert.equal(medidasCubierta(l, 100).lomo, Math.round(100 * 0.002252 * 25.4 * 100) / 100);
  assert.equal(medidasCubierta(l, 79).textoLomo, false);
  const avisos = revisarCubierta(l, 240).map((a) => a.plantilla);
  assert.ok(avisos.some((a) => a.startsWith('La portada mide')), 'portada de poca resolución');
  l.cubierta = { ...l.cubierta, imprenta: 'otra' };
  assert.ok(revisarCubierta(l, 240).some((a) => a.gravedad === 'error' && a.plantilla.startsWith('Escribe el ancho del lomo')));
  l.cubierta.lomoManual = 13.5;
  assert.equal(medidasCubierta(l, 240).lomo, 13.5);
  const html = htmlCubierta(l, 240);
  assert.match(html, /@page \{ size: 2\d\d\.\d+mm 222\.25mm; margin: 0; \}/);
  assert.match(html, /class="codigo-barras"/);
  assert.match(html, /La espada del alba/);
  assert.match(html, /Sinopsis del libro\./);
  assert.equal(CODIGO_BARRAS.ancho, 50.8);
});
