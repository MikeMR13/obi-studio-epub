import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { textoPlano } from '../model.js';
import { pngSolido } from './fixtures.js';

const cod = (t: string) => new TextEncoder().encode(t);

test('Conversión sencilla: limpieza tipográfica opcional y descripciones de imágenes opcionales', async () => {
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-limpieza-')));
  const png = Buffer.from(pngSolido(300, 200, [10, 80, 160])).toString('base64');
  const html = `<html><head><title>Limpieza</title></head><body><h1>Uno</h1>
<p>- Hola -dijo ella-. ¿Vienes?</p><p>Dijo "ven"...  y se fue .</p>
<p><img src="data:image/png;base64,${png}" alt=""></p><p><img src="data:image/png;base64,${png.slice(0, -8)}AAAAAAA=" alt="Otra"></p></body></html>`;
  const a = await b.analizarConversion('limpieza.html', cod(html));
  assert.deepEqual(a.tipografia, { guiones: 1, comillasRectas: 2, tresPuntos: 1, espacios: 1 }, 'el espacio doble ya lo junta el HTML; queda el de antes del punto');
  assert.ok(a.listaImagenes.length >= 1);
  const primera = a.listaImagenes[0];
  assert.equal(primera.alt, '');
  assert.ok(primera.miniatura?.startsWith('data:image/'), 'miniatura para el asistente');

  // Por defecto no se toca el texto.
  const r0 = await b.conversionSencilla({});
  const texto0 = b.libro.secciones.flatMap((s) => s.bloques).map((x) => (x.tipo === 'parrafo' ? textoPlano(x.contenido) : '')).join('\n');
  assert.ok(texto0.includes('- Hola') && texto0.includes('"ven"...'));
  assert.deepEqual(r0.corregido, []);

  await b.analizarConversion('limpieza.html', cod(html));
  const r = await b.conversionSencilla({ raya: true, comillas: true, suspensivos: true, espaciosSignos: true, descripciones: { [primera.nombre]: { alt: '  Un paisaje azul  ' } } });
  const texto = b.libro.secciones.flatMap((s) => s.bloques).map((x) => (x.tipo === 'parrafo' ? textoPlano(x.contenido) : '')).join('\n');
  assert.ok(texto.includes('—Hola —dijo ella—. ¿Vienes?'), texto);
  assert.ok(texto.includes('Dijo «ven»… y se fue.'), texto);
  assert.equal(b.libro.tipografia.comillas, 'latinas');
  const img = b.libro.secciones.flatMap((s) => s.bloques).find((x) => x.tipo === 'imagen' && b.libro.recursos.find((y) => y.id === x.recurso)?.nombre === primera.nombre);
  assert.ok(img?.tipo === 'imagen' && img.alt === 'Un paisaje azul');
  assert.ok(r.corregido.some((x) => x.includes('tipografía')) && r.corregido.some((x) => x.includes('espacio')) && r.corregido.some((x) => x.includes('descripción')), r.corregido.join());
  // Sin descripción tampoco pasa nada: el EPUB se exporta igual.
  await b.analizarConversion('limpieza.html', cod(html));
  await b.conversionSencilla({});
  const { datos } = await b.exportar();
  assert.ok(datos.length > 0);
});
