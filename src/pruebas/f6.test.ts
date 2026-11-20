import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { Jimp } from 'jimp';
import { libroNuevo, nuevaSeccion, parrafo, type Libro, type Recurso } from '../model.js';
import { compilarParaTienda, revisarTienda, TIENDAS } from '../tiendas.js';
import { girar, recortar, reducir } from '../procesar-imagen.js';
import { validarDatos } from '../validar.js';

async function imagen(ancho: number, alto: number, tipo: 'image/jpeg' | 'image/png' = 'image/jpeg', id = 'img'): Promise<Recurso> {
  const img = new Jimp({ width: ancho, height: alto, color: 0x3366ccff });
  // Un poco de ruido para que el JPEG no sea trivial.
  for (let k = 0; k < 2000; k++) img.setPixelColor(0xffffffff, (k * 7919) % ancho, (k * 104729) % alto);
  const datos = new Uint8Array(tipo === 'image/jpeg' ? await img.getBuffer('image/jpeg', { quality: 90 }) : await img.getBuffer('image/png'));
  return { id, nombre: `${id}.${tipo === 'image/jpeg' ? 'jpg' : 'png'}`, tipoMime: tipo, datos, ancho, alto };
}

async function libroTienda(): Promise<Libro> {
  const l = libroNuevo('Libro para tiendas', 'Autora');
  l.metadatos.descripcion = 'Una sinopsis.';
  l.recursos.push(await imagen(1600, 2560, 'image/jpeg', 'portada'));
  l.metadatos.portada = 'portada';
  l.recursos.push(await imagen(3000, 2000, 'image/png', 'grande'));
  const ilus = nuevaSeccion('ilustracion', '');
  ilus.bloques = [{ tipo: 'imagen', recurso: 'grande', alt: 'Ilustración grande' }];
  ilus.paginaFija = true;
  l.secciones.push(ilus);
  l.secciones.find((s) => s.tipo === 'capitulo')!.bloques = [parrafo('Texto del capítulo.')];
  return l;
}

test('Imágenes: reducir, girar y recortar', async () => {
  const r = await imagen(3000, 2000, 'image/png');
  const p = await reducir(r, { maxPixeles: 3_200_000 });
  assert.ok(p.ancho! * p.alto! <= 3_200_000, `${p.ancho}×${p.alto}`);
  assert.ok(Math.abs(p.ancho! / p.alto! - 1.5) < 0.01, 'conserva la proporción');
  assert.equal(await reducir(r, { maxPixeles: 10_000_000 }), r, 'sin cambios si cumple');
  const j = await imagen(2000, 1500, 'image/jpeg');
  const ligera = await reducir(j, { maxBytes: 60_000 });
  assert.ok(ligera.datos.length <= 60_000, String(ligera.datos.length));
  const g = await girar(r, 90);
  assert.deepEqual([g.ancho, g.alto], [2000, 3000]);
  const c = await recortar(r, 0.1, 0.25, 0.5, 0.5);
  assert.deepEqual([c.ancho, c.alto], [1500, 1000]);
  await assert.rejects(recortar(r, 0.8, 0, 0.5, 0.5), /fuera de la imagen/);
});

test('Tiendas: reglas de cada una y EPUB ajustado y válido', async () => {
  const l = await libroTienda();
  assert.deepEqual(TIENDAS.map((t) => t.id), ['kindle', 'apple', 'kobo', 'google', 'ingram']);

  const ingram = await revisarTienda(l, 'ingram');
  assert.ok(ingram.some((a) => /grande\.png.*se reducirá/.test(a.mensaje)));
  assert.ok(ingram.some((a) => /no acepta maquetación fija/.test(a.mensaje)));
  const ei = await compilarParaTienda(l, 'ingram');
  const zip = await JSZip.loadAsync(ei.datos);
  const opf = await zip.file('EPUB/package.opf')!.async('string');
  assert.doesNotMatch(opf, /pre-paginated/);
  const png = await zip.file(/grande\.png$/)[0].async('uint8array');
  const leida = await Jimp.read(Buffer.from(png));
  assert.ok(leida.width * leida.height <= 3_200_000);
  assert.equal(l.recursos.find((r) => r.id === 'grande')!.ancho, 3000, 'el libro original no cambia');
  assert.equal((await validarDatos(ei.datos)).mensajes.length, 0);

  // Apple: opciones para fuentes incrustadas, y EPUBCheck sigue limpio.
  l.tema = { ...l.tema, fuenteTexto: 'literata' };
  const ea = await compilarParaTienda(l, 'apple');
  const za = await JSZip.loadAsync(ea.datos);
  assert.match(await za.file('META-INF/com.apple.ibooks.display-options.xml')!.async('string'), /specified-fonts">true/);
  const ra = await validarDatos(ea.datos);
  assert.equal(ra.mensajes.length, 0, JSON.stringify(ra.mensajes.slice(0, 3)));

  // Kindle: portada pequeña.
  l.recursos[0] = await imagen(500, 800, 'image/jpeg', 'portada');
  const kindle = await revisarTienda(l, 'kindle');
  assert.ok(kindle.some((a) => a.gravedad === 'error' && /625 px en el lado corto/.test(a.mensaje)));
  l.metadatos.portada = undefined;
  assert.ok((await revisarTienda(l, 'google')).some((a) => a.gravedad === 'error' && /no tiene portada/.test(a.mensaje)));
});

test('Muestra gratuita: EPUB válido con página final y web de una sola pieza', async () => {
  const { libroMuestra, sitioMuestra, seccionesPredeterminadas, enlaceValido } = await import('../muestra.js');
  const { compilar } = await import('../compilar.js');
  const { importarEpub } = await import('../formatos/epub.js');
  const l = await libroTienda();
  const portada = nuevaSeccion('portada', 'Portada');
  portada.bloques = [{ tipo: 'imagen', recurso: 'portada', alt: 'Portada' }];
  l.secciones.unshift(portada);
  const c2 = nuevaSeccion('capitulo', 'Capítulo 2');
  c2.bloques = [parrafo('Esto no entra en la muestra.')];
  l.secciones.push(c2);
  const ids = seccionesPredeterminadas(l);
  assert.ok(ids.includes(portada.id) && !ids.includes(c2.id), 'portada y primer capítulo, sin el segundo');
  assert.equal(enlaceValido('javascript:alert(1)'), undefined);
  assert.equal(enlaceValido('https://tienda.example/libro'), 'https://tienda.example/libro');

  const m = libroMuestra(l, { secciones: ids, enlace: 'https://tienda.example/libro?a=1&b=2' });
  assert.equal(m.metadatos.titulo, 'Libro para tiendas (muestra)');
  assert.notEqual(m.metadatos.identificador, l.metadatos.identificador);
  assert.equal(m.secciones.at(-1)!.titulo, 'Fin de la muestra');
  assert.ok(!m.recursos.some((r) => r.id === 'grande'), 'la ilustración que no entra sale de los recursos');
  assert.equal(l.secciones.length, 6, 'el libro original no cambia');
  const datos = await compilar(m);
  const r = await validarDatos(datos);
  assert.equal(r.mensajes.length, 0, JSON.stringify(r.mensajes));
  const zip = await JSZip.loadAsync(datos);
  const textos = await Promise.all(Object.keys(zip.files).filter((n) => n.endsWith('.xhtml')).map((n) => zip.file(n)!.async('string')));
  assert.ok(textos.some((x) => x.includes('href="https://tienda.example/libro?a=1&amp;b=2"')));
  assert.ok(!textos.some((x) => x.includes('Esto no entra')));
  // Ida y vuelta: la página final (bloque crudo con el enlace) vuelve igual.
  const vuelta = await importarEpub(datos);
  assert.ok(JSON.stringify(vuelta.libro.secciones.at(-1)!.bloques).includes('Comprar el libro completo'));

  const html = sitioMuestra(l, { secciones: ids, enlace: 'https://tienda.example/libro' });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes('Texto del capítulo.') && !html.includes('Esto no entra'));
  assert.ok(html.includes('data:image/jpeg;base64,'), 'la portada va dentro');
  assert.ok(!/src="img\//.test(html) && !/url\('fuentes\//.test(html), 'sin referencias externas');
  assert.ok(html.includes('Una sinopsis.') && html.includes('Autora') && html.includes('href="https://tienda.example/libro"'));
  assert.throws(() => sitioMuestra(l, { secciones: [portada.id] }), /al menos una sección/);
});

test('Imágenes: girar y recortar desde la app, y EPUB con imágenes optimizadas', async () => {
  const { Backend } = await import('../../app/backend.js');
  const { optimizar, libroConImagenesOptimizadas } = await import('../procesar-imagen.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // PNG grande y opaco con ruido (no comprime bien): pasa a JPEG y se reduce a 4 Mpx.
  const ruido = new Jimp({ width: 2600, height: 1800, color: 0x000000ff });
  for (let i = 0; i < ruido.bitmap.data.length; i += 4) {
    ruido.bitmap.data[i] = (i * 2654435761) % 251;
    ruido.bitmap.data[i + 1] = (i * 40503) % 241;
    ruido.bitmap.data[i + 2] = (i * 9973) % 239;
  }
  const png: Recurso = { id: 'ruido', nombre: 'ruido.png', tipoMime: 'image/png', datos: new Uint8Array(await ruido.getBuffer('image/png')), ancho: 2600, alto: 1800 };
  const o = await optimizar(png);
  assert.equal(o.tipoMime, 'image/jpeg');
  assert.equal(o.nombre, 'ruido.jpg');
  assert.ok(o.ancho! * o.alto! <= 4_000_000 && o.datos.length < png.datos.length);
  assert.equal((await optimizar(png, false)).tipoMime, 'image/png', 'citada por nombre: no cambia de formato');
  const pequena = await imagen(400, 600, 'image/png');
  assert.equal(await optimizar(pequena), pequena, 'sin cambios si no se gana nada');

  const l = await libroTienda();
  l.recursos.push(png);
  l.secciones.find((s) => s.tipo === 'capitulo')!.bloques.push({ tipo: 'imagen', recurso: 'ruido', alt: 'Ruido' });
  const { libro: opt, ahorro } = await libroConImagenesOptimizadas(l);
  assert.ok(ahorro > 0);
  assert.equal(l.recursos.find((r) => r.id === 'ruido')!.tipoMime, 'image/png', 'el original no cambia');
  const datos = await (await import('../compilar.js')).compilar(opt);
  const v = await validarDatos(datos);
  assert.equal(v.mensajes.length, 0, JSON.stringify(v.mensajes));

  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-img-')));
  b.libro = l;
  const versiones = l.versiones?.length ?? 0;
  await b.editarImagen('grande', { girar: 90 });
  const g = l.recursos.find((r) => r.id === 'grande')!;
  assert.deepEqual([g.ancho, g.alto], [2000, 3000]);
  await b.editarImagen('grande', { recorte: { x: 0, y: 0.5, ancho: 0.5, alto: 0.5 } });
  assert.deepEqual([g.ancho, g.alto], [1000, 1500]);
  assert.equal(l.versiones!.length, versiones + 2, 'una versión antes de cada cambio');
  await assert.rejects(b.editarImagen('grande', { girar: 45 }), /90, 180 o 270/);
  await assert.rejects(b.editarImagen('grande', { recorte: { x: 0.8, y: 0, ancho: 0.5, alto: 1 } }), /fuera de la imagen/);
  b.optimizarImagenes(true);
  const { datos: epub } = await b.exportar();
  const zip = await JSZip.loadAsync(epub);
  assert.ok(zip.file('EPUB/img/ruido.jpg') && !zip.file('EPUB/img/ruido.png'));
});
