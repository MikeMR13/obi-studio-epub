// Validación de la conversión sencilla, opción por opción.
// Crea un EPUB «ajeno» con un diseño conocido, lo convierte con cada opción activada y desactivada,
// y compara lo que guarda el modelo y lo que pinta el navegador (estilos calculados) frente al original.
//   npx tsx scripts/validar-conversion.mts [carpeta-de-salida]
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { chromium } from 'playwright-core';
import { buscarNavegador } from '../src/pdf.ts';
import { Backend, OPCIONES_CONVERSION, type OpcionesConversionSencilla } from '../app/backend.ts';
import { compilarArchivos } from '../src/compilar.ts';
import { validarDatos } from '../src/validar.ts';
import { pngSolido } from '../src/pruebas/fixtures.ts';

const salida = process.argv[2] ?? '/tmp/validar-conversion';
await mkdir(salida, { recursive: true });
const regular = new Uint8Array(readFileSync('src/pruebas/fuentes/CrimsonText-Regular.ttf'));

const CSS = `@font-face { font-family: "Libro"; src: url(../Fonts/libro.ttf); }
body { font-family: "Libro", serif; }
p { text-indent: 1.5em; margin: 0 0 0.4em; line-height: 1.6; text-align: justify; letter-spacing: 0.02em; word-spacing: 0.1em; }
p.aparte { margin-top: 2em; }
h1 { font-family: "Crimson Text", serif; text-align: left; color: #336699; margin-top: 3em; text-transform: uppercase; }
img { max-width: 100%; }`;

const CAPITULO = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es"><head><title>Uno</title><link rel="stylesheet" href="../Styles/estilo.css"/></head>
<body><h1>Capítulo uno</h1>
<p>Primer párrafo con el diseño general del libro original.</p>
<p>Segundo párrafo, seguido del primero.</p>
<p>&#160;</p>
<p class="aparte">Párrafo que en el original va más separado.</p>
<p>Último <b>párrafo</b> con <i>formato</i>.</p>
<p><img src="../Images/foto.png" alt="Una foto"/></p>
</body></html>`;

async function epubOrigen(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  z.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:11111111-2222-4333-8444-555555555555</dc:identifier><dc:title>Validación</dc:title><dc:creator>Prueba</dc:creator><dc:language>es</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="Text/uno.xhtml" media-type="application/xhtml+xml"/><item id="css" href="Styles/estilo.css" media-type="text/css"/><item id="f" href="Fonts/libro.ttf" media-type="font/ttf"/><item id="img" href="Images/foto.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol><li><a href="Text/uno.xhtml">Capítulo uno</a></li></ol></nav></body></html>`);
  z.file('OEBPS/Text/uno.xhtml', CAPITULO);
  z.file('OEBPS/Styles/estilo.css', CSS);
  z.file('OEBPS/Fonts/libro.ttf', regular);
  z.file('OEBPS/Images/foto.png', pngSolido(1200, 800, [40, 120, 200]));
  return z.generateAsync({ type: 'uint8array' });
}

const datos = await epubOrigen();
const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-val-')));

async function convertir(o: Partial<OpcionesConversionSencilla>) {
  await b.analizarConversion('origen.epub', datos);
  const r = await b.conversionSencilla(o);
  return { libro: structuredClone(b.libro), r };
}

const analisis = await b.analizarConversion('origen.epub', datos);
console.log('ANÁLISIS:', JSON.stringify({ diseno: analisis.diseno, letras: analisis.letras, fuentesArchivo: analisis.fuentesArchivo.map((f) => [f.familia, f.permiso.tipo]), imagenes: analisis.imagenes }, null, 1));

const todo = await convertir(OPCIONES_CONVERSION);
const ninguno = await convertir(Object.fromEntries(Object.keys(OPCIONES_CONVERSION).map((k) => [k, false])));

// Estilos calculados en el navegador: original frente a convertido.
const navegador = await chromium.launch({ executablePath: buscarNavegador(), args: ['--no-sandbox'] });
async function estilos(archivos: Map<string, string | Uint8Array>, capitulo: string, carpeta: string) {
  for (const [k, v] of archivos) {
    const r = join(carpeta, k);
    await mkdir(join(r, '..'), { recursive: true });
    await writeFile(r, v);
  }
  const p = await navegador.newPage({ viewport: { width: 600, height: 900 } });
  await p.goto('file://' + join(carpeta, capitulo));
  await p.waitForTimeout(400);
  // Como texto: esbuild añade ayudas (__name) que no existen en la página.
  const res = (await p.evaluate(`(() => {
    const ps = [...document.querySelectorAll('p')].filter((x) => !x.querySelector('img'));
    const cs = (e) => getComputedStyle(e);
    const px = (v) => Math.round(parseFloat(v) * 10) / 10;
    const general = ps[1];
    const aparte = ps.find((x) => x.textContent.includes('más separado'));
    const h = document.querySelector('h1');
    return {
      sangria: px(cs(general).textIndent),
      interlineado: Math.round((parseFloat(cs(general).lineHeight) / parseFloat(cs(general).fontSize)) * 100) / 100,
      alineacion: cs(general).textAlign,
      espacioEntre: Math.max(px(cs(general).marginTop), px(cs(ps[0]).marginBottom)),
      espacioAparte: px(cs(aparte).marginTop),
      lineasBlanco: ps.filter((x) => !x.textContent.replace(/ /g, '').trim()).length,
      letras: cs(general).letterSpacing,
      palabras: cs(general).wordSpacing,
      letraTexto: cs(general).fontFamily.split(',')[0].replace(/["']/g, ''),
      letraTitulo: cs(h).fontFamily.split(',')[0].replace(/["']/g, ''),
      tituloAlineacion: cs(h).textAlign,
      tituloColor: cs(h).color,
      tituloMayusculas: cs(h).textTransform,
      espacioTitulo: px(cs(h).marginTop),
      bajoTitulo: px(cs(h).marginBottom),
      sangriaTrasTitulo: px(cs(ps[0]).textIndent),
      fuenteCargada: document.fonts.check(\`16px "\${cs(general).fontFamily.split(',')[0].replace(/["']/g, '')}"\`),
    };
})()`)) as Record<string, string | number | boolean>;
  await p.screenshot({ path: join(carpeta, '..', `${carpeta.split('/').pop()}.png`) });
  await p.close();
  return res;
}
const origen = new Map<string, Uint8Array>(Object.entries((await JSZip.loadAsync(datos)).files).filter(([, f]) => !f.dir).map(([k]) => [k, new Uint8Array()]));
for (const k of origen.keys()) origen.set(k, await (await JSZip.loadAsync(datos)).file(k)!.async('uint8array'));
const vOrig = await estilos(origen, 'OEBPS/Text/uno.xhtml', join(salida, 'original'));
const cap = (l: typeof todo.libro) => l.secciones.find((s) => s.tipo === 'capitulo' || s.bloques.some((x) => x.tipo === 'parrafo'))!;
const vTodo = await estilos(new Map([...compilarArchivos(todo.libro)].map(([k, v]) => [`EPUB/${k}`, v])), `EPUB/${cap(todo.libro).id}.xhtml`, join(salida, 'convertido'));
const vNada = await estilos(new Map([...compilarArchivos(ninguno.libro)].map(([k, v]) => [`EPUB/${k}`, v])), `EPUB/${cap(ninguno.libro).id}.xhtml`, join(salida, 'sin-conservar'));
await navegador.close();

console.log('\nESTILOS CALCULADOS (original | con todo | sin conservar):');
for (const k of Object.keys(vOrig) as (keyof typeof vOrig)[]) console.log(`${k.padEnd(18)} ${String(vOrig[k]).padEnd(22)} ${String(vTodo[k]).padEnd(22)} ${String(vNada[k])}`);

// Cada opción por separado: solo esa activada.
console.log('\nCADA OPCIÓN SOLA:');
for (const clave of Object.keys(OPCIONES_CONVERSION) as (keyof OpcionesConversionSencilla)[]) {
  const o = Object.fromEntries(Object.keys(OPCIONES_CONVERSION).map((k) => [k, k === clave]));
  const { libro, r } = await convertir(o);
  const t = libro.tema;
  const bloques = cap(libro).bloques;
  const vacios = bloques.filter((x) => x.tipo === 'parrafo' && !x.contenido.length).length;
  const conEspacio = bloques.filter((x) => x.tipo === 'parrafo' && x.espacioAntes !== undefined).map((x) => (x.tipo === 'parrafo' ? x.espacioAntes : 0));
  const img = libro.recursos.find((x) => x.tipoMime.startsWith('image/'))!;
  console.log(
    `${clave.padEnd(18)} conservado=${JSON.stringify(r.conservado)} | sangría=${t.sangria} interl=${t.interlineado} alinear=${t.alinear} espPárr=${t.espacioParrafos} títuloEsp=${t.tituloEspacio} títuloEstilo=${t.tituloEstilo} color=${t.colorTitulos} mayús=${t.tituloMayusculas} letras=${t.espaciadoLetras ?? '-'} palabras=${t.espaciadoPalabras ?? '-'} | vacíos=${vacios} espacioPropio=${JSON.stringify(conEspacio)} | fuentes=${JSON.stringify(libro.fuentesPropias?.map((f) => f.familia) ?? [])} texto=${t.fuenteTexto} títulos=${t.fuenteTitulos} | optimizar=${!!libro.optimizarImagenes} img=${img.datos.length}B`,
  );
}

// El EPUB final pasa EPUBCheck.
const { datos: epub } = await (async () => {
  await convertir(OPCIONES_CONVERSION);
  return b.exportar();
})();
const v = await validarDatos(epub);
console.log(`\nEPUBCheck del EPUB convertido con todo: ${v.mensajes.length} mensajes`);
console.log(`Capturas en ${salida}`);
