import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { libroNuevo, nuevaSeccion, parrafo, textoPlano } from '../model.js';
import { Colaboracion } from '../../app/colaboracion.js';

function esperar(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  return new Promise((ok, mal) => {
    const mirar = () => (cond() ? ok() : Date.now() - t0 > ms ? mal(new Error('Tiempo agotado')) : setTimeout(mirar, 25));
    mirar();
  });
}

function textoDoc(doc: Y.Doc): string {
  return doc.getXmlFragment('contenido').toString().replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
}

test('Colaboración: dos personas escriben a la vez y el texto llega al libro', async () => {
  const libro = libroNuevo('Libro compartido', 'Autora');
  const cap = libro.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [parrafo('Primer párrafo.')];
  const portada = nuevaSeccion('ilustracion', '');
  libro.secciones.push(portada);
  let guardados = 0;
  const colab = new Colaboracion(
    {
      secciones: () => libro.secciones,
      titulo: () => libro.metadatos.titulo,
      guardar: (id, bloques, notas) => {
        const s = libro.secciones.find((x) => x.id === id)!;
        s.bloques = bloques;
        s.notas = notas;
        guardados++;
      },
    },
    {},
  );
  const e = await colab.iniciar();
  try {
    const url = `ws://127.0.0.1:${e.puerto}`;
    assert.match(e.enlaces[0], new RegExp(`:${e.puerto}/colaborar\\.html\\?c=${e.codigo}$`));

    // /estado y archivos: solo con el código y solo la página de invitados.
    assert.equal((await fetch(`http://127.0.0.1:${e.puerto}/estado?c=malo`)).status, 403);
    const estado = await (await fetch(`http://127.0.0.1:${e.puerto}/estado?c=${e.codigo}`)).json();
    assert.equal(estado.titulo, 'Libro compartido');
    assert.equal(estado.secciones.find((s: { id: string }) => s.id === portada.id).editable, false);
    for (const ruta of ['/api/estado', '/../package.json', '/%2e%2e/package.json', '/colaborar.html/../../package.json'])
      assert.equal((await fetch(`http://127.0.0.1:${e.puerto}${ruta}`)).status, 404, ruta);

    // Sin código o en una sección que no es de texto, la sala se rechaza.
    for (const [sala, c] of [[cap.id, 'malo'], [portada.id, e.codigo!]]) {
      const ws = new WebSocket(`${url}/${sala}?c=${c}`);
      await assert.rejects(new Promise((ok, mal) => (ws.on('open', ok), ws.on('error', mal))), /403/);
    }

    const conectar = (nombre: string) => {
      const doc = new Y.Doc();
      const p = new WebsocketProvider(url, cap.id, doc, { params: { c: e.codigo! }, WebSocketPolyfill: WebSocket as never });
      p.awareness.setLocalStateField('user', { name: nombre, color: '#123456' });
      return { doc, p };
    };
    const a = conectar('Ana');
    const b = conectar('Beto');
    await esperar(() => a.p.synced && b.p.synced);
    assert.match(textoDoc(a.doc), /Primer párrafo\./, 'la sala se siembra con el texto del libro');

    // Ana escribe un párrafo; Beto lo ve; el libro lo guarda.
    const nuevo = new Y.XmlElement('paragraph');
    nuevo.setAttribute('estilo', 'cuerpo');
    nuevo.insert(0, [new Y.XmlText('Hola desde Ana.')]);
    a.doc.getXmlFragment('contenido').push([nuevo]);
    // Beto, a la vez, escribe al principio del primer párrafo.
    const primero = b.doc.getXmlFragment('contenido').get(0) as Y.XmlElement;
    (primero.get(0) as Y.XmlText).insert(0, '¡');
    await esperar(() => textoDoc(b.doc).includes('Hola desde Ana.') && textoDoc(a.doc).includes('¡Primer'));
    await esperar(() => cap.bloques.length === 2);
    assert.deepEqual(cap.bloques.map((x) => (x.tipo === 'parrafo' ? textoPlano(x.contenido) : '')), ['¡Primer párrafo.', 'Hola desde Ana.']);
    assert.ok(guardados >= 1);
    await esperar(() => colab.estado().personas.length === 2);
    assert.deepEqual(colab.estado().personas.map((p) => p.nombre).sort(), ['Ana', 'Beto']);

    // El libro cambia por otra vía (p. ej. buscar y reemplazar): las salas toman el texto nuevo.
    colab.guardarPendiente();
    cap.bloques = [parrafo('Texto reemplazado.')];
    colab.sincronizar();
    await esperar(() => textoDoc(a.doc).includes('Texto reemplazado.') && !textoDoc(b.doc).includes('Hola desde Ana'));

    for (const x of [a, b]) {
      x.p.destroy();
      x.p.awareness.destroy();
      x.doc.destroy();
    }
  } finally {
    await colab.detener();
  }
  assert.equal(colab.estado().activa, false);
});
