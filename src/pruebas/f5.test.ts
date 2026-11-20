import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { libroNuevo, nuevaSeccion, parrafo, type Libro } from '../model.js';
import {
  AlmacenPlugins,
  ErrorPlugin,
  ejecutarPlugin,
  empaquetarPlugin,
  libroParaPlugin,
  validarLibroPlugin,
  validarManifiesto,
  type Manifiesto,
  type Plugin,
} from '../plugins.js';
import { compilar } from '../compilar.js';
import { pngSolido } from './fixtures.js';

const EJEMPLOS = join(import.meta.dirname, '..', '..', 'ejemplos', 'plugins');

async function ejemplo(id: string): Promise<Plugin> {
  const manifiesto = validarManifiesto(JSON.parse(await readFile(join(EJEMPLOS, id, 'manifiesto.json'), 'utf8')));
  return { manifiesto, codigo: await readFile(join(EJEMPLOS, id, 'principal.js'), 'utf8') };
}

function libroSucio(): Libro {
  const l = libroNuevo('Prueba de plugins', 'Autora');
  const cap = nuevaSeccion('capitulo', 'Capítulo 1');
  cap.bloques = [
    parrafo('Hola  mundo, dijo "Aria"...'),
    parrafo('¿Dónde estoy'),
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: '   ' }] },
    parrafo('  Texto con espacios al borde.  '),
  ];
  l.secciones.push(cap);
  return l;
}

const manifiestoPrueba = (tipos: Manifiesto['tipos'], permisos: Manifiesto['permisos'] = []): Manifiesto =>
  validarManifiesto({ id: 'prueba', nombre: 'Prueba', version: '1', autor: 'Pruebas', tipos, permisos });

test('Plugins: el manifiesto se valida con mensajes en español', () => {
  assert.throws(() => validarManifiesto({ id: 'X Y', nombre: 'a', version: '1', autor: 'a', tipos: ['revision'] }), /minúsculas/);
  assert.throws(() => validarManifiesto({ id: 'x', nombre: 'a', version: '1', autor: 'a', tipos: ['magia'] }), /tipos/);
  assert.throws(() => validarManifiesto({ id: 'x', nombre: 'a', version: '1', autor: 'a', tipos: ['revision'], permisos: ['disco'] }), /Permiso desconocido/);
  assert.throws(() => validarManifiesto({ id: 'x', nombre: 'a', version: '1', autor: 'a', tipos: ['importador'] }), /extensiones/);
  assert.throws(() => validarManifiesto({ id: 'x', nombre: 'a', version: '1', autor: 'a', tipos: ['exportador'] }), /salida/);
  assert.equal(manifiestoPrueba(['revision']).permisos.length, 0);
});

test('Plugins: el código corre aislado, sin Node, sin eval y con límite de tiempo', async () => {
  const codigo = `obi.registrar({ revisar(libro) {
    let escape;
    try { escape = typeof obi.registrar.constructor('return process')(); } catch (e) { escape = 'bloqueado'; }
    let escape2;
    try { escape2 = typeof ({}).constructor.constructor('return this')().process; } catch (e) { escape2 = 'bloqueado'; }
    return [{ mensaje: [typeof process, typeof require, typeof fetch, typeof Buffer, typeof setTimeout, escape, escape2].join(',') }];
  } })`;
  const r = await ejecutarPlugin<{ mensaje: string }[]>({ manifiesto: manifiestoPrueba(['revision']), codigo }, 'revision', [libroSucio()]);
  assert.equal(r.resultado[0].mensaje, 'undefined,undefined,undefined,undefined,undefined,bloqueado,bloqueado');

  const t0 = Date.now();
  await assert.rejects(
    ejecutarPlugin({ manifiesto: manifiestoPrueba(['revision']), codigo: 'obi.registrar({ revisar() { for (;;) {} } })' }, 'revision', [{}], 2000),
    /tardó más de 2 s/,
  );
  assert.ok(Date.now() - t0 < 6000);
  await assert.rejects(
    ejecutarPlugin({ manifiesto: manifiestoPrueba(['revision']), codigo: 'for (;;) {}' }, 'revision', [{}]),
    /falló: Script execution timed out/,
  );
  await assert.rejects(ejecutarPlugin({ manifiesto: manifiestoPrueba(['revision']), codigo: '1' }, 'revision', [{}]), /obi\.registrar/);
  await assert.rejects(ejecutarPlugin({ manifiesto: manifiestoPrueba(['revision']), codigo: 'obi.registrar({})' }, 'transformacion', [{}]), ErrorPlugin);
});

test('Plugins: sin el permiso «recursos» el plugin no ve los bytes de las imágenes', async () => {
  const l = libroSucio();
  l.recursos.push({ id: 'img', nombre: 'img.png', tipoMime: 'image/png', datos: pngSolido(20, 20) });
  const codigo = 'obi.registrar({ revisar(l) { return [{ mensaje: String(l.recursos[0].datos.length) }]; } })';
  const sin = await ejecutarPlugin<{ mensaje: string }[]>({ manifiesto: manifiestoPrueba(['revision']), codigo }, 'revision', [libroParaPlugin(l, [])]);
  assert.equal(sin.resultado[0].mensaje, '0');
  const con = await ejecutarPlugin<{ mensaje: string }[]>(
    { manifiesto: manifiestoPrueba(['revision'], ['recursos']), codigo },
    'revision',
    [libroParaPlugin(l, ['recursos'])],
  );
  assert.equal(con.resultado[0].mensaje, String(l.recursos[0].datos.length));
  // Y aunque el plugin las vacíe, se conservan si no tiene permiso.
  const t = validarLibroPlugin({ ...structuredClone(l), recursos: [] }, l, []);
  assert.equal(t.recursos[0].datos.length, l.recursos[0].datos.length);
});

test('Plugins: el libro devuelto se valida', () => {
  const l = libroSucio();
  const malo = structuredClone(l);
  (malo.secciones.at(-1)!.bloques[0] as { estilo: string }).estilo = 'gigante';
  assert.throws(() => validarLibroPlugin(malo, l, []), /estilo de párrafo desconocido/);
  const malo2 = structuredClone(l);
  malo2.secciones.at(-1)!.bloques.push({ tipo: 'crudo', xhtml: '<p>sin cerrar' });
  assert.throws(() => validarLibroPlugin(malo2, l, []), /XHTML mal formado/);
  const malo3 = structuredClone(l);
  malo3.secciones.at(-1)!.bloques.push({ tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'nota', id: 'no-existe' }] });
  assert.throws(() => validarLibroPlugin(malo3, l, []), /nota que no existe/);
});

test('Plugins de ejemplo: revisión, limpieza y texto plano', async () => {
  const l = libroSucio();
  const rev = await ejemplo('revision-ortotipografica');
  const r = await ejecutarPlugin<{ mensaje: string; seccion?: string }[]>(rev, 'revision', [libroParaPlugin(l, [])]);
  const mensajes = r.resultado.map((h) => h.mensaje).join('\n');
  assert.match(mensajes, /espacio doble/);
  assert.match(mensajes, /comillas rectas/);
  assert.match(mensajes, /tres puntos/);
  assert.match(mensajes, /falta el signo de cierre/);
  assert.deepEqual(r.registros, ['Revisadas 4 secciones.']);

  const limpieza = await ejemplo('limpieza-espacios');
  const t = await ejecutarPlugin(limpieza, 'transformacion', [libroParaPlugin(l, [])]);
  const limpio = validarLibroPlugin(t.resultado, l, []);
  const textos = limpio.secciones.at(-1)!.bloques.map((b) => (b.tipo === 'parrafo' ? b.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join('') : ''));
  assert.deepEqual(textos, ['Hola mundo, dijo "Aria"...', '¿Dónde estoy', 'Texto con espacios al borde.']);
  assert.ok((await compilar(limpio)).length > 1000);

  // Texto plano: importar y exportar con el Backend, como en la app.
  process.env.OBI_PLUGINS = await mkdtemp(join(tmpdir(), 'obi-plugins-'));
  const { Backend } = await import('../../app/backend.js');
  const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-rec-')));
  const txt = await ejemplo('texto-plano');
  const paquete = await empaquetarPlugin(txt.manifiesto, txt.codigo);
  assert.equal((await b.inspeccionarPlugin(paquete)).nombre, 'Texto plano (.txt)');
  await b.instalarPlugin(paquete);
  await b.instalarPlugin(await empaquetarPlugin(limpieza.manifiesto, limpieza.codigo));
  assert.deepEqual((await b.listarPlugins()).map((p) => p.id), ['limpieza-espacios', 'texto-plano']);
  const entrada = 'Prólogo\n\nEra de noche. Ñandú «sí».\n\nCapítulo 1: El viaje\n\nPrimer párrafo\ncon salto.\n\n***\n\nOtro.\n';
  await b.importar('mi novela.txt', new TextEncoder().encode(entrada));
  assert.equal(b.libro.metadatos.titulo, 'mi novela');
  assert.deepEqual(b.libro.secciones.map((s) => [s.tipo, s.titulo]), [['prologo', 'Prólogo'], ['capitulo', 'Capítulo 1: El viaje']]);
  assert.equal(b.libro.secciones[1].bloques[1].tipo, 'separador');
  assert.ok((await b.validar()).valido, 'el libro importado con el plugin es un EPUB válido');
  const exportado = await b.exportarConPlugin('texto-plano');
  assert.equal(exportado.nombre, 'mi novela.txt');
  assert.match(new TextDecoder().decode(exportado.datos), /Capítulo 1: El viaje\n\nPrimer párrafo con salto\.\n\n\* \* \*/);

  // Transformación con deshacer.
  b.libro.secciones[0].bloques.push(parrafo('dos  espacios'));
  await b.transformarConPlugin('limpieza-espacios');
  assert.equal(b.estado().deshacerPlugin, 'Limpieza de espacios');
  assert.match(JSON.stringify(b.libro.secciones[0].bloques), /dos espacios/);
  b.deshacerPlugin();
  assert.match(JSON.stringify(b.libro.secciones[0].bloques), /dos {2}espacios/);
  await b.eliminarPlugin('texto-plano');
  assert.deepEqual((await b.listarPlugins()).map((p) => p.id), ['limpieza-espacios']);
  assert.ok(new AlmacenPlugins(process.env.OBI_PLUGINS!));
});

// ---------------------------------------------------------------------------
// Comentarios.

import JSZip from 'jszip';
import { anclarComentario, leerComentariosWord, textosComentados } from '../comentarios.js';
import { exportarWord, importarCorrecciones, seccionesDeTexto } from '../formatos/word.js';
import { compilarArchivos } from '../compilar.js';

function libroComentado(): Libro {
  const l = libroNuevo('Comentarios', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.titulo = 'Capítulo 1';
  cap.bloques = [parrafo('Aria abrió la puerta del castillo.'), parrafo('Afuera llovía sin parar.'), parrafo('Nadie respondió.')];
  anclarComentario(cap.bloques, 'c1', 'la puerta');
  anclarComentario(cap.bloques, 'c2', 'llovía');
  cap.comentarios = [
    { id: 'c1', autor: 'Mike', fecha: '2026-11-20T10:00:00Z', texto: '¿Puerta o portón?', respuestas: [{ autor: 'Ana', fecha: '2026-11-20T11:00:00Z', texto: 'Portón suena mejor.' }] },
    { id: 'c2', autor: 'Mike', fecha: '2026-11-20T10:05:00Z', texto: 'Revisar el tiempo verbal.', resuelto: true },
  ];
  return l;
}

test('Comentarios: anclas en el modelo y nada en el EPUB', () => {
  const l = libroComentado();
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  assert.deepEqual(cap.bloques[0].tipo === 'parrafo' && cap.bloques[0].contenido, [
    { tipo: 'texto', texto: 'Aria abrió ' },
    { tipo: 'texto', texto: 'la puerta', comentarios: ['c1'] },
    { tipo: 'texto', texto: ' del castillo.' },
  ]);
  assert.deepEqual([...textosComentados(cap.bloques)], [['c1', 'la puerta'], ['c2', 'llovía']]);
  assert.equal(anclarComentario(cap.bloques, 'c3', 'no existe'), false);
  const xhtml = [...compilarArchivos(l).values()].filter((v) => typeof v === 'string').join('');
  assert.doesNotMatch(xhtml, /Portón|comentario|Revisar el tiempo/);
  assert.match(xhtml, /Aria abrió la puerta del castillo\./);
});

test('Comentarios: viajan a Word con su texto, respuestas y estado, y vuelven sin duplicarse', async () => {
  const l = libroComentado();
  const docx = await exportarWord(l);
  const w = await leerComentariosWord(docx);
  const indice = seccionesDeTexto(l).findIndex((x) => x.tipo === 'capitulo');
  assert.deepEqual(
    w.map((c) => [c.autor, c.texto, c.ancla, c.padre ? 'respuesta' : c.seccion, c.resuelto]),
    [
      ['Mike', '¿Puerta o portón?', 'la puerta', indice, false],
      ['Ana', 'Portón suena mejor.', w[1].ancla, 'respuesta', false],
      ['Mike', 'Revisar el tiempo verbal.', 'llovía', indice, true],
    ],
  );
  assert.equal(w[1].padre, w[0].wid);
  // El Word sin cambios no añade nada.
  const intacto = libroComentado();
  const r0 = await importarCorrecciones(intacto, docx);
  assert.equal(r0.comentarios, 0);
  assert.equal(intacto.secciones.find((s) => s.tipo === 'capitulo')!.comentarios!.length, 2);

  // La correctora cambia el texto, responde a Mike y deja un comentario nuevo.
  const corregido = libroComentado();
  const cap = corregido.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques[1] = parrafo('Afuera llovía a cántaros.');
  anclarComentario(cap.bloques, 'c2', 'llovía');
  cap.bloques[2] = parrafo('Nadie le respondió.');
  anclarComentario(cap.bloques, 'c9', 'le respondió');
  cap.comentarios![0].respuestas!.push({ autor: 'Correctora', fecha: '2026-11-21T09:00:00Z', texto: 'De acuerdo con Ana.' });
  cap.comentarios!.push({ id: 'c9', autor: 'Correctora', fecha: '2026-11-21T09:05:00Z', texto: 'Leísmo aceptable aquí.' });
  const original = libroComentado();
  const r = await importarCorrecciones(original, await exportarWord(corregido));
  assert.deepEqual(r.actualizadas, ['Capítulo 1']);
  assert.equal(r.comentarios, 2);
  const s = original.secciones.find((x) => x.tipo === 'capitulo')!;
  const anclas = textosComentados(s.bloques);
  assert.equal(anclas.get('c1'), 'la puerta');
  assert.equal(anclas.get('c2'), 'llovía');
  const nuevo = s.comentarios!.find((c) => c.autor === 'Correctora')!;
  assert.equal(nuevo.texto, 'Leísmo aceptable aquí.');
  assert.equal(anclas.get(nuevo.id), 'le respondió');
  assert.deepEqual(s.comentarios!.find((c) => c.id === 'c1')!.respuestas!.map((x) => x.autor), ['Ana', 'Correctora']);
  assert.equal(s.comentarios!.find((c) => c.id === 'c2')!.resuelto, true);
});

test('Comentarios: el control de cambios de Word se toma como aceptado y se avisa', async () => {
  const l = libroComentado();
  const zip = await JSZip.loadAsync(await exportarWord(l));
  let doc = await zip.file('word/document.xml')!.async('string');
  const fecha = 'w:author="Correctora" w:date="2026-11-21T10:00:00Z"';
  doc = doc.replace('<w:t xml:space="preserve">Nadie respondió.</w:t></w:r>', `<w:t xml:space="preserve">Nadie </w:t></w:r><w:del w:id="901" ${fecha}><w:r><w:delText>respondió</w:delText></w:r></w:del><w:ins w:id="902" ${fecha}><w:r><w:t>contestó</w:t></w:r></w:ins><w:r><w:t>.</w:t></w:r>`);
  assert.match(doc, /w:id="902"/, 'el documento de prueba se modificó');
  zip.file('word/document.xml', doc);
  const r = await importarCorrecciones(l, await zip.generateAsync({ type: 'uint8array' }));
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  assert.match(JSON.stringify(cap.bloques), /Nadie contestó\./);
  assert.match(r.avisos.join(' '), /2 cambios con control de cambios/);
});

// ---------------------------------------------------------------------------
// Accesibilidad.

import { buscarNavegador } from '../pdf.js';
import { evaluadorChrome, informeHtml, revisarAccesibilidad } from '../accesibilidad.js';

test('Accesibilidad: axe en cada página y comprobaciones del libro', { skip: !buscarNavegador() && 'sin Chrome' }, async () => {
  const bueno = libroComentado();
  const r = await revisarAccesibilidad(bueno, evaluadorChrome());
  assert.equal(r.incidencias.length, 0, JSON.stringify(r.incidencias));
  assert.ok(r.conforme);
  assert.ok(r.documentos >= 3);

  const malo = libroComentado();
  malo.recursos.push({ id: 'i', nombre: 'i.png', tipoMime: 'image/png', datos: pngSolido(30, 30), ancho: 30, alto: 30 });
  const cap = malo.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques.push({ tipo: 'imagen', recurso: 'i', alt: '' });
  cap.bloques.push({ tipo: 'crudo', xhtml: '<div><p style="color:#eee">Texto casi invisible</p><p><a href="https://example.com"></a></p></div>' });
  const r2 = await revisarAccesibilidad(malo, evaluadorChrome());
  assert.equal(r2.conforme, false);
  assert.deepEqual(r2.incidencias.map((i) => i.regla).sort(), ['color-contrast', 'link-name']);
  assert.equal(r2.incidencias[0].seccion, cap.id);
  assert.match(r2.incidencias.find((i) => i.regla === 'link-name')!.ayuda, /enlaces/i, 'mensajes en español');
  assert.equal(r2.comprobaciones.find((c) => c.nombre === 'Descripción de las imágenes')!.ok, false);
  const html = informeHtml(r2);
  assert.match(html, /<html lang="es">/);
  assert.match(html, /Hay problemas que corregir/);
});
