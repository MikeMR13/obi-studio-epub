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

test('Saltos de página de Word: dentro del texto, «salto antes» y cortar capítulos por ellos', async () => {
  const { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel } = await import('docx');
  const { importarDocx, contarSaltosWord } = await import('../formatos/docx.js');
  const { Backend } = await import('../../app/backend.js');
  const docx = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Capítulo 1', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun('Antes del salto.'), new PageBreak(), new TextRun('Después del salto.')] }),
          new Paragraph({ text: 'Página nueva por estilo directo.', pageBreakBefore: true }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ text: 'Capítulo 2', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('Fin.'),
        ],
      },
    ],
  });
  const datos = new Uint8Array(await Packer.toBuffer(docx));
  const JSZip = (await import('jszip')).default;
  assert.equal(contarSaltosWord(await (await JSZip.loadAsync(datos)).file('word/document.xml')!.async('string')), 3);
  const { libro } = await importarDocx(datos);
  const c1 = libro.secciones.find((s) => s.titulo === 'Capítulo 1')!;
  assert.deepEqual(
    c1.bloques.map((b) => (b.tipo === 'parrafo' ? textoPlano(b.contenido) : b.tipo)),
    ['Antes del salto.', 'saltoPagina', 'Después del salto.', 'saltoPagina', 'Página nueva por estilo directo.'],
    'el salto antes del capítulo 2 sobra y se quita',
  );
  const { libro: sin } = await importarDocx(datos, { saltos: false });
  assert.ok(!sin.secciones.some((s) => s.bloques.some((b) => b.tipo === 'saltoPagina')));

  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-saltos-word-')));
  const a = await b.analizarConversion('saltos.docx', datos);
  assert.equal(a.diseno?.cortes?.saltos, 3);
  const caps = await b.capitulosConversion({ cortar: 'saltos' });
  assert.deepEqual(caps.filter((c) => c.palabras).map((c) => c.inicio.slice(0, 12)), ['Antes del sa', 'Después del ', 'Página nueva', 'Fin.']);
});

test('Conversión de varios volúmenes: mismas opciones, datos de la serie, numeración y ZIP', async () => {
  const { Backend, volumenDeNombre } = await import('../../app/backend.js');
  const JSZip = (await import('jszip')).default;
  assert.equal(volumenDeNombre('Mi serie Vol. 3.epub'), 3);
  assert.equal(volumenDeNombre('mi-serie-v02.docx'), 2);
  assert.equal(volumenDeNombre('Tomo 4.5.html'), 4.5);
  assert.equal(volumenDeNombre('Serie 07.epub'), 7);
  assert.equal(volumenDeNombre('portada.epub'), undefined);
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-lote-')));
  b.nuevoLote();
  const vol = (n: number) => cod(`<html><head><title>La serie ${n}</title></head><body><h1>Capítulo 1</h1><p>- Hola ${n}...</p><h2>Parte</h2><p>Texto.</p></body></html>`);
  const r1 = await b.anadirAlLote('La serie 01.html', vol(1));
  assert.equal(r1.volumen, 1);
  assert.ok(r1.analisis, 'el primero se analiza para el asistente');
  const r2 = await b.anadirAlLote('La serie 02.html', vol(2));
  assert.equal(r2.analisis, undefined);
  await assert.rejects(() => b.anadirAlLote('notas.pdf', cod('x')), /formato/);
  const datos = { serie: 'La serie', editorial: 'Saitou TL', creditos: [{ nombre: 'Mike', rol: 'trl' as const }], volumenes: [1, 2], cortar: 'h2' as const, paginaIndice: true };
  const res = [await b.convertirDelLote(0, { raya: true, suspensivos: true, lote: datos }), await b.convertirDelLote(1, { raya: true, suspensivos: true, lote: datos })];
  assert.ok(res.every((r) => r.ok), JSON.stringify(res));
  assert.ok(res[0].archivo?.startsWith('01 - ') && res[1].archivo?.startsWith('02 - '), res.map((r) => r.archivo).join());
  assert.equal(b.libro.metadatos.titulo, 'Libro sin título', 'el libro abierto no cambia');
  const { nombre, datos: zip } = await b.descargarLote();
  assert.match(nombre, /\.zip$/);
  const z = await JSZip.loadAsync(zip);
  const archivos = Object.keys(z.files).sort();
  assert.equal(archivos.length, 2);
  assert.ok(archivos[0].startsWith('01 - ') && archivos[1].startsWith('02 - '), archivos.join());
  const { importarEpub } = await import('../formatos/epub.js');
  const { libro } = await importarEpub(await z.file(archivos[1])!.async('uint8array'));
  assert.equal(libro.metadatos.serie, 'La serie');
  assert.equal(libro.metadatos.volumen, 2);
  assert.equal(libro.metadatos.editorial, 'Saitou TL');
  assert.ok(libro.metadatos.creditos.some((c) => c.nombre === 'Mike' && c.rol === 'trl'));
  assert.ok(libro.secciones.some((s) => s.titulo === 'Parte'), 'cortado también en los h2');
  assert.ok(libro.secciones.some((s) => s.tipo === 'indice'));
  const texto = libro.secciones.flatMap((s) => s.bloques).map((x) => (x.tipo === 'parrafo' ? textoPlano(x.contenido) : '')).join(' ');
  assert.ok(texto.includes('—Hola 2…'), texto);
});
