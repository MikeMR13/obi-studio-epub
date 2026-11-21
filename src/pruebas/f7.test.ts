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
  assert.equal(t.tituloEspacioDebajo, 0.83, 'el h2 sin margen propio usa el del navegador');
  assert.equal(t.tituloTamano, 1.5, 'h2 sin tamaño propio: 1,5 em');
  assert.equal(t.sangriaTrasTitulo, true, 'el original sangra también el primer párrafo');
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
  const nada = Object.fromEntries(Object.keys(r).length ? ['parrafos', 'espacioParrafos', 'espacioPorParrafo', 'lineasEnBlanco', 'espacioTitulos', 'espaciadoLetras', 'titulos', 'estilosParrafo', 'aspectos', 'separadores', 'capitular', 'fuentesArchivo', 'fuentesSistema'].map((x) => [x, false]) : []);
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

test('Estilos propios, tamaño y color de fragmentos, subtítulos y separador de texto: EPUB, ida y vuelta, editor y Word', async () => {
  const { bloquesAPM, pmABloques } = await import('../editor-modelo.js');
  const { exportarWord, importarCorrecciones } = await import('../formatos/word.js');
  const l = libroNuevo('Estilos', 'A');
  l.tema = {
    ...l.tema,
    separador: 'texto',
    separadorTexto: '◆◆◆',
    subtitulo: { alinear: 'derecha', color: '#884422', tamano: 1.3 },
    estilosParrafo: [{ id: 'carta', nombre: 'Original: carta', cursiva: true, izquierda: 2, derecha: 2, sangria: 0, tamano: 0.9, color: '#553311' }],
  };
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'Texto con ' }, { tipo: 'texto', texto: 'GRITO', aspecto: { tamano: 1.5, color: '#cc0000' } }, { tipo: 'texto', texto: ' y ' }, { tipo: 'texto', texto: 'subrayado amarillo', aspecto: { fondo: '#ffee00' } }, { tipo: 'texto', texto: '.' }] },
    { tipo: 'separador' },
    { tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Parte dos' }] },
    { tipo: 'parrafo', estilo: 'cuerpo', clase: 'carta', contenido: [{ tipo: 'texto', texto: 'Querida Hina: te escribo.' }] },
  ];
  const datos = await compilar(l);
  const v = await validarDatos(datos);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  const zip = await JSZip.loadAsync(datos);
  const css = await zip.file('EPUB/estilos.css')!.async('string');
  assert.match(css, /p\.ep-carta \{ text-indent: 0em; margin-left: 2em; margin-right: 2em; font-size: 0\.9em; font-style: italic; color: #553311; \}/);
  assert.match(css, /h2 \{ text-align: right; color: #884422; font-size: 1\.3em; \}/);
  const xhtml = (await Promise.all(Object.keys(zip.files).filter((x) => x.endsWith('.xhtml')).map((x) => zip.file(x)!.async('string')))).find((x) => x.includes('GRITO'))!;
  assert.match(xhtml, /<span style="font-size: 1\.5em; color: #cc0000">GRITO<\/span>/);
  assert.match(xhtml, /<div class="escena texto" role="separator">◆◆◆<\/div>/);
  assert.match(xhtml, /<p class="ep-carta">Querida/);
  // Ida y vuelta.
  const { libro } = await importarEpub(datos);
  const vuelta = libro.secciones.find((s) => s.tipo === 'capitulo')!.bloques;
  assert.deepEqual(vuelta[0], cap.bloques[0]);
  assert.deepEqual(vuelta[3], cap.bloques[3]);
  // Editor.
  assert.deepEqual(pmABloques(bloquesAPM(cap.bloques)), cap.bloques);
  // Word: estilo propio con nombre, tamaño y color; al volver se conservan aunque se corrija otro párrafo.
  const w = await JSZip.loadAsync(await exportarWord(l));
  const estilos = await w.file('word/styles.xml')!.async('string');
  assert.match(estilos, /w:styleId="EP-carta"/);
  let doc = await w.file('word/document.xml')!.async('string');
  assert.match(doc, /<w:color w:val="cc0000"\/>/);
  doc = doc.replace('te escribo', 'te escribo hoy');
  w.file('word/document.xml', doc);
  const copia = structuredClone(l);
  await importarCorrecciones(copia, await w.generateAsync({ type: 'uint8array' }));
  const c2 = copia.secciones.find((s) => s.tipo === 'capitulo')!.bloques;
  assert.deepEqual(c2[0], cap.bloques[0], 'el párrafo sin cambios se queda igual, con su tamaño y color');
  assert.ok(c2[3].tipo === 'parrafo' && c2[3].clase === 'carta' && JSON.stringify(c2[3]).includes('hoy'));
});

test('Conversión sencilla fiel: tipos de párrafo, unidades, fragmentos, separadores, capitular, subtítulos, WOFF2 y fuentes de Adobe', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { Backend } = await import('../../app/backend.js');
  const { temaDeCss, desofuscarAdobe, asignadorEstilos } = await import('../diseno-original.js');
  const { woff2ASfnt } = await import('../woff2.js');
  const { hojaDeCss, firmaParrafo } = await import('../estilo-calculado.js');
  const { analizarXhtml, todos, nombre } = await import('../formatos/dom.js');

  // WOFF2 (con glyf, loca y hmtx transformadas) → TrueType con las mismas tablas básicas.
  const woff2 = new Uint8Array(readFileSync(join(import.meta.dirname, 'fuentes', 'CrimsonText-Bold.woff2')));
  const ttf = woff2ASfnt(woff2)!;
  assert.ok(ttf, 'se lee el WOFF2');
  const { leerFuentePropia } = await import('../fuentes-propias.js');
  const info = leerFuentePropia(ttf);
  assert.equal(info.familia, 'Crimson Text');
  assert.equal(woff2ASfnt(new Uint8Array(40)), undefined);

  // Ofuscación de Adobe: XOR de 1024 bytes con el UUID.
  const regular = new Uint8Array(readFileSync(join(import.meta.dirname, 'fuentes', 'CrimsonText-Regular.ttf')));
  const uuid = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const clave = Uint8Array.from(uuid.match(/../g)!.map((x) => parseInt(x, 16)));
  const adobe = regular.slice();
  for (let i = 0; i < 1024; i++) adobe[i] ^= clave[i % 16];
  assert.deepEqual(desofuscarAdobe(adobe, ['ffffffffffffffffffffffffffffffff', uuid]), regular);
  assert.equal(desofuscarAdobe(adobe, ['ffffffffffffffffffffffffffffffff']), undefined);

  // Cascada: tamaño base en px, porcentajes, descendientes, especificidad y medidas en em del propio párrafo.
  const hoja = hojaDeCss('html { font-size: 20px; } p { text-indent: 2em; margin: 0; } .cita p { margin-left: 10%; font-style: italic; } p#x.y { text-indent: 0; } p.peq { font-size: 15px; text-indent: 30px; } .a { margin-top: 5vh; }');
  const doc = analizarXhtml('<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="cita"><p>Uno</p></div><p id="x" class="y">Dos</p><p class="peq a">Tres</p></body></html>').documento;
  const ps = todos(doc, (n) => nombre(n) === 'p');
  const [f1, f2, f3] = ps.map((p) => firmaParrafo(hoja, p));
  assert.equal(f1.izquierda, 3);
  assert.equal(f1.cursiva, true);
  assert.equal(f1.sangria, 2);
  assert.equal(f2.sangria, 0, 'gana el selector más específico');
  assert.equal(f3.tamano, 0.75, '15 px con base de 20 px');
  assert.equal(f3.sangria, 2, '30 px en em del párrafo (15 px)');
  assert.ok(hoja.ignoradas.has('vh'));

  // Análisis: estilo general por aspecto (no por clase), otros tipos, separador, capitular y subtítulos.
  const css = `p, p.normal { text-indent: 1em; } p.carta { font-style: italic; text-indent: 0; margin-left: 2em; } p.firma { text-align: right; font-size: 0.9em; color: #555555; }
.escena { text-align: center; } h2 { color: #aa3300; text-align: center; font-size: 1.4em; } p.ini::first-letter { float: left; font-size: 3em; } span.cap { float: left; font-size: 2.5em; }
span.rojo { color: #cc0000; } p.ini::first-line { font-variant: small-caps; }`;
  const cuerpo = (x: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${x}</body></html>`;
  const capitulo = cuerpo(
    `<h1>Uno</h1><p class="ini"><span class="cap">E</span>ra una vez.</p><p class="normal">Dos.</p><p>Tres <span class="rojo">rojo</span>.</p><p class="normal">Cuatro.</p><p class="escena">✽ ✽ ✽</p><p class="carta">Querido diario.</p><p class="carta">Sigo.</p><h2>Parte</h2><p class="firma">El autor</p><p><img src="../Images/orn.png" alt=""/></p><p>Cinco.</p><p><img src="../Images/orn.png" alt=""/></p>`,
  );
  const d = temaDeCss(css, [capitulo]);
  assert.equal(d.tema.sangria, 1, 'p y p.normal tienen el mismo aspecto: un solo estilo general');
  const nombres = d.estilos!.map((e) => e.nombre);
  assert.ok(nombres.includes('Original: carta') && nombres.includes('Original: firma'), nombres.join());
  const carta = d.estilos!.find((e) => e.nombre === 'Original: carta')!;
  assert.equal(carta.cursiva, true);
  assert.equal(carta.sangria, 0);
  assert.equal(carta.izquierda, 2);
  const firma = d.estilos!.find((e) => e.nombre === 'Original: firma')!;
  assert.deepEqual([firma.alinear, firma.tamano, firma.color], ['derecha', 0.9, '#555555']);
  assert.deepEqual(d.subtitulo, { alinear: 'centro', color: '#aa3300', tamano: 1.4 });
  assert.equal(d.capitular, true);
  assert.equal(d.primeraLinea, true);
  assert.deepEqual(d.clasesCapitular, ['cap']);
  assert.deepEqual(d.separador, { imagen: 'orn.png', veces: 2 }, 'la imagen repetida gana al ornamento usado una vez');
  assert.equal(d.fragmentosConAspecto, 1, 'el span rojo (la capitular no cuenta)');
  const asignar = asignadorEstilos(css, d.estilos!);
  const pCarta = todos(analizarXhtml(capitulo).documento, (n) => nombre(n) === 'p').find((p) => p.textContent === 'Sigo.')!;
  assert.equal(asignar(pCarta), carta.id);

  // Conversión completa de un EPUB con estas reglas.
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0</dc:identifier><dc:title>Fiel</dc:title><dc:language>es</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="Text/uno.xhtml" media-type="application/xhtml+xml"/><item id="css" href="Styles/e.css" media-type="text/css"/><item id="o" href="Images/orn.png" media-type="image/png"/><item id="f" href="Fonts/negrita.woff2" media-type="font/woff2"/><item id="g" href="Fonts/libro.ttf" media-type="font/ttf"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  );
  z.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol><li><a href="Text/uno.xhtml">Uno</a></li></ol></nav></body></html>`);
  z.file('OEBPS/Text/uno.xhtml', capitulo.replace('<head><title>x</title>', '<head><title>x</title><link rel="stylesheet" href="../Styles/e.css"/>'));
  z.file('OEBPS/Styles/e.css', `@font-face { font-family: "Libro"; src: url(../Fonts/libro.ttf); } @font-face { font-family: "Libro"; font-weight: bold; src: url(../Fonts/negrita.woff2); } body { font-family: "Libro"; }\n${css}`);
  const { pngSolido } = await import('./fixtures.js');
  z.file('OEBPS/Images/orn.png', pngSolido(200, 40, [0, 0, 0]));
  z.file('OEBPS/Fonts/negrita.woff2', woff2);
  z.file('OEBPS/Fonts/libro.ttf', adobe);
  z.file('META-INF/encryption.xml', `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/><enc:CipherData><enc:CipherReference URI="OEBPS/Fonts/libro.ttf"/></enc:CipherData></enc:EncryptedData></encryption>`);
  const datos = await z.generateAsync({ type: 'uint8array' });
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-fiel-')));
  const a = await b.analizarConversion('fiel.epub', datos);
  assert.equal(a.fuentesArchivo.length, 2, JSON.stringify(a.fuentesArchivo));
  assert.equal((a.diseno as Record<string, unknown>).css, undefined, 'el CSS no va a la interfaz');
  // Vista previa: original y resultado servidos en /muestra/, sin tocar el libro abierto ni gastar el análisis.
  const vp = await b.vistaPreviaConversion({});
  const archivo = (u: string) => {
    const [, , ver, ...resto] = u.split('/');
    return b.archivoMuestra(ver, decodeURIComponent(resto.join('/')));
  };
  assert.ok(vp.original?.endsWith('OEBPS/Text/uno.xhtml'), String(vp.original));
  assert.ok(new TextDecoder().decode(archivo(vp.original!) as unknown as Uint8Array<ArrayBuffer>).includes('Querido diario'));
  assert.ok(String(archivo(vp.convertido)).includes('Querido diario'));
  assert.equal(b.libro.metadatos.titulo, 'Libro sin título');
  const r = await b.conversionSencilla();
  const t = b.libro.tema;
  assert.equal(t.separador, 'imagen');
  assert.ok(b.libro.recursos.some((x) => x.id === t.separadorImagen));
  assert.equal(t.capitular, 'letra');
  assert.equal(t.primeraLinea, true);
  assert.equal(t.subtitulo?.color, '#aa3300');
  assert.ok((t.estilosParrafo ?? []).length >= 2);
  const cap = b.libro.secciones.find((s) => s.bloques.some((x) => x.tipo === 'parrafo'))!;
  const pc = cap.bloques.find((x) => x.tipo === 'parrafo' && JSON.stringify(x).includes('Querido'));
  assert.ok(pc?.tipo === 'parrafo' && pc.clase === t.estilosParrafo!.find((e) => e.nombre === 'Original: carta')!.id, JSON.stringify(pc));
  assert.equal(cap.bloques.filter((x) => x.tipo === 'separador').length, 3, 'el ornamento de texto y las dos imágenes');
  assert.ok(JSON.stringify(cap.bloques).includes('"color":"#cc0000"'), 'el color del span');
  assert.ok(!JSON.stringify(cap.bloques).includes('"tamano":2.5'), 'la capitular hecha con un span no agranda la letra');
  const libro = b.libro.fuentesPropias?.find((f) => f.familia === 'Libro');
  assert.ok(libro && libro.caras.length === 2, `la fuente de Adobe y la negrita en WOFF2: ${JSON.stringify(b.libro.fuentesPropias)?.slice(0, 300)}`);
  assert.ok(r.conservado.some((x) => x.includes('estilos de párrafo')), r.conservado.join());
  const { datos: epub } = await b.exportar();
  const v = await validarDatos(epub);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  const { libro: vuelta } = await importarEpub(epub);
  const pv = vuelta.secciones.flatMap((s) => s.bloques).find((x) => x.tipo === 'parrafo' && JSON.stringify(x).includes('Querido'));
  assert.ok(pv?.tipo === 'parrafo' && pv.clase === carta.id, 'la clase vuelve en la ida y vuelta');
});

test('Conversión sencilla de Word: estilos propios, espacio de cada párrafo y fuentes incrustadas', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { Backend } = await import('../../app/backend.js');
  const { disenoDeDocx } = await import('../diseno-original.js');
  const { Document, Packer, Paragraph, HeadingLevel, AlignmentType, TextRun } = await import('docx');
  const regular = new Uint8Array(readFileSync(join(import.meta.dirname, 'fuentes', 'CrimsonText-Regular.ttf')));
  const docx = new Document({
    fonts: [{ name: 'Crimson Text', data: Buffer.from(regular), characterSet: '00' as never }],
    styles: {
      default: { document: { run: { font: 'Crimson Text', size: 24 }, paragraph: { indent: { firstLine: 360 }, spacing: { after: 120 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', run: { size: 32 } },
        { id: 'DialogoInterior', name: 'Diálogo interior', basedOn: 'Normal', run: { italics: true, color: '335577' }, paragraph: { indent: { left: 720, firstLine: 0 } } },
        { id: 'Firma', name: 'Firma', basedOn: 'Normal', run: { size: 20 }, paragraph: { alignment: AlignmentType.RIGHT } },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ text: 'Capítulo', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('Texto normal.'),
          new Paragraph({ children: [new TextRun('Pienso en voz baja.')], style: 'DialogoInterior' }),
          new Paragraph({ text: 'Mucho después.', spacing: { before: 480 } }),
          new Paragraph({ text: 'La autora', style: 'Firma' }),
        ],
      },
    ],
  });
  const datos = new Uint8Array(await Packer.toBuffer(docx));
  const d = await disenoDeDocx(datos);
  assert.deepEqual(
    d.estilos?.map(({ clave: _c, ...e }) => e),
    [
      { id: 'word-1', nombre: 'Word: Diálogo interior', parrafos: 1, sangria: 0, cursiva: true, color: '#335577', izquierda: 3 },
      { id: 'word-2', nombre: 'Word: Firma', parrafos: 1, sangria: 1.8, alinear: 'derecha', tamano: 0.83 }, // misma sangría física en em de su letra más pequeña
    ],
  );
  assert.equal(d.parrafosConEspacio, 2, '«Mucho después» y la firma (el mismo espacio en puntos es más em con su letra menor)');
  assert.equal(d.fuentes.length, 1, 'la fuente incrustada');
  assert.deepEqual([...d.fuentes[0].datos.slice(0, 4)], [0, 1, 0, 0], 'sin la ofuscación de Office');

  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-word-')));
  const a = await b.analizarConversion('libro.docx', datos);
  assert.deepEqual(a.letras, [{ familia: 'Crimson Text', origen: 'archivo' }]);
  const r = await b.conversionSencilla();
  const bloques = b.libro.secciones.flatMap((s) => s.bloques);
  const busca = (t: string) => bloques.find((x) => x.tipo === 'parrafo' && JSON.stringify(x.contenido).includes(t));
  const pi = busca('voz baja');
  assert.ok(pi?.tipo === 'parrafo' && pi.clase === 'word-1', JSON.stringify(pi));
  const pd = busca('Mucho después');
  assert.ok(pd?.tipo === 'parrafo' && pd.espacioAntes === 2 && pd.espacioDespues === undefined, JSON.stringify(pd));
  assert.ok(bloques.filter((x) => x.tipo === 'parrafo' && x.espacioAntes !== undefined).length === 1);
  assert.equal(b.libro.tema.estilosParrafo?.length, 2);
  assert.ok(b.libro.fuentesPropias?.some((f) => f.familia === 'Crimson Text'));
  assert.ok(r.conservado.some((x) => x.includes('estilos de párrafo')), r.conservado.join());
  const { datos: epub } = await b.exportar();
  const v = await validarDatos(epub);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
});

test('Otros formatos: texto, Markdown, HTML y OpenDocument se importan y conservan su diseño', async () => {
  const { join } = await import('node:path');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { Backend } = await import('../../app/backend.js');
  const { epubDeOtroFormato, decodificarTexto } = await import('../formatos/otros.js');
  const { pngSolido } = await import('./fixtures.js');
  const cod = (t: string) => new TextEncoder().encode(t);
  const parrafos = (l: Libro) => l.secciones.flatMap((s) => s.bloques).filter((b) => b.tipo === 'parrafo');

  // Texto: un párrafo por línea, capítulos por su título y la línea en blanco como espacio de escena.
  const txt = 'Prólogo\n　Era de noche.\n　Llovía.\n\nCapítulo 1: El gremio\nEntró en el gremio.\n';
  const { libro: lt } = await importarEpub((await epubDeOtroFormato('novela.txt', cod(txt))).epub);
  assert.deepEqual(lt.secciones.map((s) => s.titulo), ['Prólogo', 'Capítulo 1: El gremio']);
  assert.equal(parrafos(lt).length, 3, 'sin la sangría de espacios ideográficos');
  // Por bloques: las líneas sueltas dentro de un párrafo son saltos de línea.
  const { libro: lb } = await importarEpub((await epubDeOtroFormato('b.txt', cod('Uno\nsigue.\n\nDos.\n\nTres.\n'))).epub);
  assert.equal(parrafos(lb).length, 3);
  assert.ok(JSON.stringify(parrafos(lb)[0]).includes('"salto"'));
  // Codificaciones: Windows-1252 y Shift_JIS.
  assert.equal(decodificarTexto(Uint8Array.from([0x43, 0x61, 0x66, 0xe9])), 'Café');
  assert.equal(decodificarTexto(Uint8Array.from([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4])), 'あいう');

  // Markdown.
  const md = '# Capítulo uno\n\nTexto con *cursiva* y **negrita**.\n\n***\n\nOtra escena.\n';
  const { libro: lm } = await importarEpub((await epubDeOtroFormato('libro.md', cod(md))).epub);
  assert.equal(lm.secciones[0].titulo, 'Capítulo uno');
  assert.ok(JSON.stringify(lm).includes('"cursiva"') && JSON.stringify(lm).includes('"negrita"'));
  assert.ok(lm.secciones[0].bloques.some((b) => b.tipo === 'separador'));

  // HTML (no XML) con <style> e imagen incrustada.
  const png = Buffer.from(pngSolido(40, 20, [200, 0, 0])).toString('base64');
  const html = `<html><head><title>Mi libro</title><style>p { text-indent: 2em; } p.carta { font-style: italic; text-indent: 0; }</style></head><body><h1>Uno</h1><p>Hola<br>mundo</p><p class=carta>Querida amiga.</p><p><img src="data:image/png;base64,${png}" alt="Rojo"></p><script>alert(1)</script></body></html>`;
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-otros-')));
  const a = await b.analizarConversion('mi.html', cod(html));
  assert.equal(a.tipo, 'html');
  assert.equal(a.titulo, 'Mi libro');
  assert.equal(a.diseno?.tema.sangria, 2);
  assert.equal(a.diseno?.estilos?.[0].nombre, 'Original: carta');
  await b.conversionSencilla();
  assert.equal(b.libro.recursos.length, 1);
  assert.ok(!JSON.stringify(b.libro).includes('alert'));
  assert.ok(parrafos(b.libro).some((p) => p.tipo === 'parrafo' && p.clase === 'orig-1'));

  // OpenDocument: estilos con nombre y automáticos, nota al pie, imagen y título del documento.
  const z = new JSZip();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  z.file(
    'styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ns}><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:text-align="justify"/></style:default-style><style:style style:name="Standard" style:family="paragraph"><style:paragraph-properties fo:text-indent="1.5em" fo:margin-top="0cm" fo:margin-bottom="0cm"/></style:style><style:style style:name="Diario" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="2em" fo:text-indent="0em"/><style:text-properties fo:font-style="italic" fo:color="#225588"/></style:style></office:styles></office:document-styles>`,
  );
  z.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns}><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style></office:automatic-styles><office:body><office:text>
<text:h text:outline-level="1">Capítulo 1</text:h>
<text:p text:style-name="Standard">Primer párrafo con <text:span text:style-name="T1">negrita</text:span> y nota<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>La nota.</text:p></text:note-body></text:note>.</text:p>
<text:p text:style-name="Standard">Segundo<text:s/>párrafo.</text:p>
<text:p text:style-name="Diario">Querido diario.</text:p>
<text:p text:style-name="P1">◆◆◆</text:p>
<text:p text:style-name="Standard"><draw:frame><draw:image xlink:href="Pictures/foto.png"/><svg:title>Una foto</svg:title></draw:frame></text:p>
</office:text></office:body></office:document-content>`,
  );
  z.file('meta.xml', '<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Novela ODT</dc:title></office:meta></office:document-meta>');
  z.file('Pictures/foto.png', pngSolido(300, 200, [0, 100, 200]));
  const odt = await z.generateAsync({ type: 'uint8array' });
  const ao = await b.analizarConversion('novela.odt', odt);
  assert.equal(ao.tipo, 'odt');
  assert.equal(ao.titulo, 'Novela ODT');
  assert.equal(ao.notas, 1);
  assert.equal(ao.imagenes, 1);
  assert.deepEqual([ao.diseno?.tema.sangria, ao.diseno?.tema.alinear], [1.5, 'justificado']);
  const diario = ao.diseno?.estilos?.find((e) => e.nombre === 'Original: odf-diario');
  assert.ok(diario && diario.cursiva && diario.color === '#225588' && diario.izquierda === 2, JSON.stringify(ao.diseno?.estilos));
  assert.deepEqual(ao.diseno?.separador, { texto: '◆◆◆', veces: 1 });
  await b.conversionSencilla();
  assert.equal(b.libro.tema.separadorTexto, '◆◆◆');
  assert.ok(JSON.stringify(b.libro).includes('"negrita"'));
  const { datos: epub } = await b.exportar();
  const v = await validarDatos(epub);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));
  // Importación normal (sin el asistente).
  await b.importar('novela.odt', odt);
  assert.equal(b.libro.metadatos.titulo, 'Novela ODT');
});
