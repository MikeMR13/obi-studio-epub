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

test('Revisiones rápidas: cada búsqueda corrige lo que dice', async () => {
  const { REVISIONES } = await import('../revisiones.js');
  const { reemplazar } = await import('../buscar.js');
  const casos: Record<string, [string, string]> = {
    espacios: ['Hola   mundo', 'Hola mundo'],
    'antes-signo': ['Hola , mundo !', 'Hola, mundo!'],
    'despues-signo': ['uno,dos;tres', 'uno, dos; tres'],
    'guion-dialogo': ['- Hola —dijo.', '—Hola —dijo.'],
    'comillas-rectas': ['Dijo "hola" y "adiós"', 'Dijo «hola» y «adiós»'],
    'tres-puntos': ['Bueno...', 'Bueno…'],
    'apertura-pregunta': ['Llegó. Qué hora es?', 'Llegó. ¿Qué hora es?'],
  };
  for (const r of REVISIONES) {
    const [antes, despues] = casos[r.id];
    const l = libroNuevo('R', 'A');
    const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
    cap.bloques = [parrafo(antes)];
    reemplazar(l, { consulta: r.consulta, regex: true, mayusculas: true }, r.reemplazo);
    const b = cap.bloques[0];
    assert.equal(b.tipo === 'parrafo' && b.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join(''), despues, r.id);
  }
});

test('CSS propio y fuentes ofuscadas: EPUB válido', async () => {
  const { revisarCss } = await import('../css-propio.js');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { claveOfuscacion, ofuscarFuente } = await import('../compilar.js');
  const l = libroNuevo('CSS', 'A');
  l.recursos.push({ id: 'fondo', nombre: 'fondo.png', tipoMime: 'image/png', datos: (await import('./fixtures.js')).pngSolido(20, 20), ancho: 20, alto: 20 });
  assert.deepEqual(revisarCss('p { color: red; }', l), []);
  const malos = revisarCss('p { direction: rtl; }\n@import "x.css";\ndiv { background: url(https://x.com/a.png); position: fixed; }\nh1 {', l).map((x) => [x.linea, x.plantilla]);
  assert.ok(malos.some(([n, m]) => n === 1 && String(m).includes('EPUBCheck no admite la propiedad')));
  assert.ok(malos.some(([n, m]) => n === 2 && String(m).includes('@import')));
  assert.ok(malos.some(([n, m]) => n === 3 && String(m).includes('remotos')));
  assert.ok(malos.some(([, m]) => String(m).includes('position: fixed')));
  assert.ok(malos.some(([, m]) => String(m).includes('Falta cerrar')));
  assert.ok(revisarCss('div { background: url(img/otra.png) }', l).some((x) => x.plantilla.includes('no está en el libro')));
  l.cssPropio = 'p.cuerpo-especial { letter-spacing: 0.02em; }\ndiv.recuadro-sistema { background-image: url(img/fondo.png); }';
  const regular = new Uint8Array(readFileSync(join(import.meta.dirname, 'fuentes', 'CrimsonText-Regular.ttf')));
  l.fuentesPropias = [{ id: 'fp1', familia: 'Crimson Text', generica: 'serif', ofuscar: true, caras: [{ peso: 400, estilo: 'normal', formato: 'ttf', fsType: 0, origen: 'x', datos: regular }] }];
  l.tema = { ...l.tema, fuenteTexto: 'propia-fp1' };
  const datos = await compilar(l);
  const r = await validarDatos(datos);
  assert.equal(r.mensajes.length, 0, JSON.stringify(r.mensajes));
  const zip = await JSZip.loadAsync(datos);
  assert.match(await zip.file('EPUB/estilos.css')!.async('string'), /letter-spacing: 0\.02em/);
  assert.ok(zip.file('EPUB/img/fondo.png'), 'la imagen del CSS entra en el EPUB');
  const enc = await zip.file('META-INF/encryption.xml')!.async('string');
  assert.match(enc, /http:\/\/www\.idpf\.org\/2008\/embedding/);
  const ruta = enc.match(/URI="([^"]+)"/)![1];
  const ofuscada = await zip.file(ruta)!.async('uint8array');
  const original = ofuscarFuente(ofuscada, claveOfuscacion(l.metadatos.identificador));
  assert.deepEqual([...original.slice(0, 4)], [0, 1, 0, 0], 'al desofuscar vuelve a ser una TrueType');
  assert.notDeepEqual([...ofuscada.slice(0, 4)], [0, 1, 0, 0]);
});

/** WOFF 1.0 a partir de una TrueType (para probar la lectura de fuentes WOFF). */
async function aWoff(ttf: Uint8Array): Promise<Uint8Array> {
  const { deflateSync } = await import('node:zlib');
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = v.getUint16(4);
  const tablas = Array.from({ length: n }, (_, i) => {
    const p = 12 + i * 16;
    const datos = ttf.slice(v.getUint32(p + 8), v.getUint32(p + 8) + v.getUint32(p + 12));
    const comp = new Uint8Array(deflateSync(datos));
    return { tag: v.getUint32(p), suma: v.getUint32(p + 4), datos, comp: comp.length < datos.length ? comp : datos };
  });
  let largo = 44 + 20 * n;
  for (const t of tablas) largo += (t.comp.length + 3) & ~3;
  const salida = new Uint8Array(largo);
  const w = new DataView(salida.buffer);
  w.setUint32(0, 0x774f4646);
  w.setUint32(4, v.getUint32(0));
  w.setUint32(8, largo);
  w.setUint16(12, n);
  let pos = 44 + 20 * n;
  tablas.forEach((t, i) => {
    const e = 44 + i * 20;
    w.setUint32(e, t.tag);
    w.setUint32(e + 4, pos);
    w.setUint32(e + 8, t.comp.length);
    w.setUint32(e + 12, t.datos.length);
    w.setUint32(e + 16, t.suma);
    salida.set(t.comp, pos);
    pos += (t.comp.length + 3) & ~3;
  });
  return salida;
}

test('Conversión sencilla: conserva el diseño y las fuentes del EPUB original', async () => {
  const { readFileSync } = await import('node:fs');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { epubAjeno } = await import('./fixtures.js');
  const { Backend } = await import('../../app/backend.js');
  const { claveOfuscacion, ofuscarFuente } = await import('../compilar.js');
  const { woffASfnt, disenoDeDocx } = await import('../diseno-original.js');
  const regular = new Uint8Array(readFileSync(join(import.meta.dirname, 'fuentes', 'CrimsonText-Regular.ttf')));
  const cursiva = new Uint8Array(readFileSync(join(import.meta.dirname, 'fuentes', 'CrimsonText-Italic.ttf')));
  const woff = await aWoff(regular);
  assert.deepEqual([...woffASfnt(woff)!.slice(0, 4)], [0, 1, 0, 0]);

  const zip = await JSZip.loadAsync(await epubAjeno());
  const opf = (await zip.file('OEBPS/content.opf')!.async('string'))
    .replace('<item id="css"', '<item id="f1" href="Fonts/libro.woff" media-type="font/woff"/><item id="f2" href="Fonts/libro-i.ttf" media-type="font/ttf"/><item id="css"');
  zip.file('OEBPS/content.opf', opf);
  zip.file('OEBPS/Fonts/libro.woff', woff);
  zip.file('OEBPS/Fonts/libro-i.ttf', ofuscarFuente(cursiva, claveOfuscacion('urn:uuid:12345678-1234-4234-8234-123456789abc')));
  zip.file('META-INF/encryption.xml', `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/Fonts/libro-i.ttf"/></enc:CipherData></enc:EncryptedData></encryption>`);
  zip.file(
    'OEBPS/Styles/style.css',
    `@font-face { font-family: "Libro"; src: url(../Fonts/libro.woff); }
@font-face { font-family: "Libro"; font-style: italic; src: url(../Fonts/libro-i.ttf); }
body { font-family: "Libro", serif; }
p { text-indent: 1.5em; margin: 0 0 0.3em; line-height: 1.5; text-align: justify; letter-spacing: 0.02em; }
p.aparte { margin-top: 2em; }
h2.titulo { text-align: left; color: #336699; margin-top: 3em; }
.centrar { text-align: center; text-indent: 0; }
.ital { font-style: italic; }
span.negr { font-weight: bold; }
.sc { font-variant: small-caps; }
.oculto { display: none; }`,
  );
  const cap1 = (await zip.file('OEBPS/Text/Section0001.xhtml')!.async('string')).replace(
    '<p class="ital">¿Dónde estoy?</p>',
    '<p class="ital">¿Dónde estoy?</p>\n<p>&#160;</p>\n<p class="aparte">Mucho después.</p>',
  );
  zip.file('OEBPS/Text/Section0001.xhtml', cap1);
  const datos = await zip.generateAsync({ type: 'uint8array' });
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-conv-')));
  const analisis = await b.analizarConversion('ajeno.epub', datos);
  assert.equal(analisis.diseno?.lineasEnBlanco, 1);
  assert.equal(analisis.diseno?.parrafosConEspacio, 1);
  assert.equal(analisis.diseno?.espacioTitulos, 3);
  assert.deepEqual(analisis.letras, [{ familia: 'Libro', origen: 'archivo' }]);
  assert.equal(b.libro.metadatos.titulo, 'Libro sin título', 'analizar no cambia el libro abierto');
  const r = await b.conversionSencilla();
  const t = b.libro.tema;
  assert.equal(t.nombre, 'Diseño original');
  assert.equal(t.sangria, 1.5);
  assert.equal(t.interlineado, 1.5);
  assert.equal(t.espacioParrafos, 0.3);
  assert.equal(t.alinear, 'justificado');
  assert.equal(t.tituloEstilo, 'izquierda');
  assert.equal(t.colorTitulos, '#336699');
  assert.equal(t.tituloEspacio, 3);
  assert.equal(t.espaciadoLetras, 0.02);
  const cap = b.libro.secciones.find((x) => x.bloques.some((y) => y.tipo === 'parrafo' && JSON.stringify(y).includes('Mucho después')))!;
  const k = cap.bloques.findIndex((y) => JSON.stringify(y).includes('Mucho después'));
  const aparte = cap.bloques[k];
  assert.ok(aparte.tipo === 'parrafo' && aparte.espacioAntes === 2, JSON.stringify(aparte));
  const blanca = cap.bloques[k - 1];
  assert.ok(blanca.tipo === 'parrafo' && blanca.contenido.length === 0, 'la línea en blanco se conserva');
  assert.ok(cap.bloques.filter((y) => y.tipo === 'parrafo' && (y.espacioAntes !== undefined || y.espacioDespues !== undefined)).length === 1, 'solo el párrafo distinto lleva espacio propio');
  const f = b.libro.fuentesPropias?.find((x) => x.familia === 'Libro');
  assert.ok(f && f.caras.length === 2, JSON.stringify(b.libro.fuentesPropias?.map((x) => [x.familia, x.caras.length])));
  assert.equal(t.fuenteTexto, `propia-${f!.id}`);
  assert.ok(r.conservado.some((x) => x.includes('Libro')), r.conservado.join());
  assert.ok(r.capitulos >= 1 && r.imagenes >= 1 && r.notas === 1);
  const { datos: epub } = await b.exportar();
  const v = await validarDatos(epub);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  // Ida y vuelta: el espacio propio vuelve al importar el EPUB generado.
  const { libro: vuelta } = await importarEpub(epub);
  assert.ok(JSON.stringify(vuelta).includes('"espacioAntes":2'));

  // Sin conservar nada: tema predeterminado, sin líneas en blanco ni espacios propios.
  await b.analizarConversion('ajeno.epub', datos);
  const nada = Object.fromEntries(Object.keys(r).length ? ['parrafos', 'espacioParrafos', 'espacioPorParrafo', 'lineasEnBlanco', 'espacioTitulos', 'espaciadoLetras', 'titulos', 'fuentesArchivo', 'fuentesSistema'].map((x) => [x, false]) : []);
  const r2 = await b.conversionSencilla(nada);
  assert.notEqual(b.libro.tema.nombre, 'Diseño original');
  assert.equal(b.libro.fuentesPropias, undefined);
  assert.ok(!JSON.stringify(b.libro.secciones).includes('espacioAntes'));
  assert.ok(!b.libro.secciones.some((x) => x.bloques.some((y) => y.tipo === 'parrafo' && !y.contenido.length)));
  assert.deepEqual(r2.conservado, ['imágenes originales']);

  // Word: el estilo Normal y el Título 1.
  const { Document, Packer, Paragraph, HeadingLevel, AlignmentType } = await import('docx');
  const docx = new Document({
    styles: {
      default: { document: { run: { font: 'Georgia', size: 24 }, paragraph: { indent: { firstLine: 360 }, spacing: { line: 360, after: 120 }, alignment: AlignmentType.JUSTIFIED } } },
      paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', run: { color: '884422', font: 'Georgia' }, paragraph: { alignment: AlignmentType.CENTER } }],
    },
    sections: [{ children: [new Paragraph({ text: 'Capítulo', heading: HeadingLevel.HEADING_1 }), new Paragraph('Texto.')] }],
  });
  const d = await disenoDeDocx(new Uint8Array(await Packer.toBuffer(docx)));
  assert.equal(d.tema.sangria, 1.5, JSON.stringify(d));
  assert.equal(d.espacio?.general, 0.5);
  assert.ok(d.lineasEnBlanco >= 0);
  assert.equal(d.familiaTexto, 'Georgia');
});

test('Espacio propio y líneas en blanco: editor, PDF y Word de corrección', async () => {
  const { bloquesAPM, pmABloques } = await import('../editor-modelo.js');
  const { exportarWord, importarCorrecciones } = await import('../formatos/word.js');
  const { htmlImpresion } = await import('../impresion.js');
  const l = libroNuevo('Espacios', 'A');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [parrafo('Uno.'), { tipo: 'parrafo', estilo: 'cuerpo', contenido: [] }, { ...parrafo('Dos, más abajo.'), espacioAntes: 2 }, parrafo('Tres.')];
  assert.deepEqual(pmABloques(bloquesAPM(cap.bloques)), cap.bloques);
  assert.match(htmlImpresion(l, { interior: 10 } as never), /<p style="margin-top: 2em">Dos, más abajo\.<\/p>/);
  const zip = await JSZip.loadAsync(await exportarWord(l));
  let xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /w:before="480"/);
  xml = xml.replace('Tres.', 'Tres, corregido.');
  zip.file('word/document.xml', xml);
  const copia = structuredClone(l);
  await importarCorrecciones(copia, await zip.generateAsync({ type: 'uint8array' }));
  const b = copia.secciones.find((s) => s.tipo === 'capitulo')!.bloques;
  assert.equal(b.length, 4, JSON.stringify(b));
  assert.ok(b[1].tipo === 'parrafo' && !b[1].contenido.length, 'la línea en blanco vuelve de Word');
  assert.ok(b[2].tipo === 'parrafo' && b[2].espacioAntes === 2, 'el espacio propio se recupera');
  assert.match(JSON.stringify(b[3]), /corregido/);
});
