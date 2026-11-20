// Colaboración en tiempo real en la red local (Yjs).
//
// El anfitrión abre un segundo servidor, escuchando en la red local solo mientras la colaboración está activa.
// Ese servidor solo expone, con un código de invitación:
//   - la página de invitados (colaborar.html) y sus archivos,
//   - /estado: título del libro y lista de secciones,
//   - una sala WebSocket (protocolo de y-websocket) por sección de texto.
// No expone la API de Obi Studio ni ningún archivo del ordenador.
//
// El texto de cada sala se guarda en el modelo del libro (el EPUB y el PDF salen como siempre). Si el libro
// cambia por otra vía (código, buscar y reemplazar, plugins…), el servidor sustituye el contenido de la sala.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join } from 'node:path';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocketServer, type WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { Bloque, Nota, Seccion } from '../src/model.js';
import { bloquesAPM, pmABloques } from '../src/editor-modelo.js';
import { extensiones } from './renderer/editor/extensiones.js';

const MENSAJE_SYNC = 0;
const MENSAJE_PRESENCIA = 1;
const DEL_SERVIDOR = Symbol('servidor');
/** Secciones que no se editan como texto. */
const NO_TEXTO = new Set(['portada', 'ilustracion', 'indice']);

export interface AccesoLibro {
  secciones(): Seccion[];
  titulo(): string;
  /** Guarda en el modelo el texto que llega de la sala. */
  guardar(id: string, bloques: Bloque[], notas: Nota[]): void;
}

export interface Persona {
  nombre: string;
  color: string;
  seccion: string;
}

let esquema: ReturnType<typeof getSchema> | undefined;
function esquemaEditor() {
  esquema ??= getSchema(extensiones({ colaborativo: true }) as Parameters<typeof getSchema>[0]);
  return esquema;
}

class Sala {
  doc = new Y.Doc();
  presencia = new awarenessProtocol.Awareness(this.doc);
  conexiones = new Map<WebSocket, Set<number>>();
  /** Último contenido guardado o sembrado, para saber si el modelo cambió por otra vía. */
  ultimo = '';
  private temporizador?: NodeJS.Timeout;

  constructor(
    readonly id: string,
    private libro: AccesoLibro,
  ) {
    this.presencia.setLocalState(null);
    this.sembrar();
    this.doc.on('update', (actualizacion: Uint8Array, origen: unknown) => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MENSAJE_SYNC);
      syncProtocol.writeUpdate(e, actualizacion);
      this.difundir(encoding.toUint8Array(e));
      if (origen !== DEL_SERVIDOR) this.programarGuardado();
    });
    this.presencia.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origen: unknown) => {
      const conexion = origen as WebSocket | null;
      const ids = conexion ? this.conexiones.get(conexion) : undefined;
      if (ids) {
        added.forEach((c) => ids.add(c));
        removed.forEach((c) => ids.delete(c));
      }
      const cambiados = [...added, ...updated, ...removed];
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MENSAJE_PRESENCIA);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.presencia, cambiados));
      this.difundir(encoding.toUint8Array(e));
    });
  }

  private seccion(): Seccion | undefined {
    return this.libro.secciones().find((s) => s.id === this.id);
  }

  private clave(s: Seccion): string {
    return JSON.stringify([s.bloques, s.notas]);
  }

  /** Copia el texto del modelo en la sala (al crearla o si el libro cambió por otra vía). */
  sembrar() {
    const s = this.seccion();
    if (!s) return;
    this.doc.transact(() => {
      const fragmento = this.doc.getXmlFragment('contenido');
      fragmento.delete(0, fragmento.length);
      prosemirrorJSONToYXmlFragment(esquemaEditor(), bloquesAPM(s.bloques), fragmento);
      const notas = this.doc.getMap<string>('notas');
      for (const k of [...notas.keys()]) if (!s.notas.some((n) => n.id === k)) notas.delete(k);
      for (const n of s.notas) {
        const v = JSON.stringify(n.contenido);
        if (notas.get(n.id) !== v) notas.set(n.id, v);
      }
    }, DEL_SERVIDOR);
    this.ultimo = this.clave(s);
  }

  private programarGuardado() {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.guardar(), 300);
  }

  /** Guarda en el modelo lo pendiente de la sala. */
  guardar() {
    if (!this.temporizador) return;
    clearTimeout(this.temporizador);
    this.temporizador = undefined;
    const json = yXmlFragmentToProsemirrorJSON(this.doc.getXmlFragment('contenido'));
    const bloques = pmABloques(json as Parameters<typeof pmABloques>[0]);
    const mapa = this.doc.getMap<string>('notas');
    // Las notas, en el orden de sus llamadas en el texto; una nota sin llamada desaparece, como en el editor.
    const ids: string[] = [];
    const ver = (l: { tipo: string; id?: string }[]) => l.forEach((i) => i.tipo === 'nota' && i.id && !ids.includes(i.id) && ids.push(i.id));
    for (const b of bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
      if (b.tipo === 'lista') b.elementos.forEach(ver);
      if (b.tipo === 'recuadro') b.lineas.forEach((l) => ver(l.contenido));
    }
    const notas: Nota[] = ids.map((id) => {
      let contenido: Nota['contenido'] = [];
      try {
        contenido = JSON.parse(mapa.get(id) ?? '[]');
      } catch {
        // Nota ilegible: queda vacía.
      }
      return { id, contenido };
    });
    this.libro.guardar(this.id, bloques, notas);
    const s = this.seccion();
    if (s) this.ultimo = this.clave(s);
  }

  /** Si el modelo cambió por otra vía, la sala toma el texto nuevo. */
  sincronizar() {
    const s = this.seccion();
    if (s && this.clave(s) !== this.ultimo) this.sembrar();
  }

  difundir(datos: Uint8Array) {
    for (const c of this.conexiones.keys()) if (c.readyState === c.OPEN) c.send(datos);
  }

  conectar(ws: WebSocket) {
    this.conexiones.set(ws, new Set());
    ws.binaryType = 'arraybuffer';
    ws.on('message', (datos: ArrayBuffer) => {
      try {
        const d = decoding.createDecoder(new Uint8Array(datos));
        const tipo = decoding.readVarUint(d);
        if (tipo === MENSAJE_SYNC) {
          const e = encoding.createEncoder();
          encoding.writeVarUint(e, MENSAJE_SYNC);
          syncProtocol.readSyncMessage(d, e, this.doc, ws);
          if (encoding.length(e) > 1) ws.send(encoding.toUint8Array(e));
        } else if (tipo === MENSAJE_PRESENCIA) {
          awarenessProtocol.applyAwarenessUpdate(this.presencia, decoding.readVarUint8Array(d), ws);
        }
      } catch {
        ws.close(1003, 'Mensaje no válido');
      }
    });
    ws.on('close', () => {
      const ids = this.conexiones.get(ws);
      this.conexiones.delete(ws);
      if (ids?.size) awarenessProtocol.removeAwarenessStates(this.presencia, [...ids], null);
      if (!this.conexiones.size) this.guardar();
    });
    // Paso 1 de la sincronización y presencia actual.
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MENSAJE_SYNC);
    syncProtocol.writeSyncStep1(e, this.doc);
    ws.send(encoding.toUint8Array(e));
    const estados = [...this.presencia.getStates().keys()];
    if (estados.length) {
      const p = encoding.createEncoder();
      encoding.writeVarUint(p, MENSAJE_PRESENCIA);
      encoding.writeVarUint8Array(p, awarenessProtocol.encodeAwarenessUpdate(this.presencia, estados));
      ws.send(encoding.toUint8Array(p));
    }
  }

  personas(): Persona[] {
    return [...this.presencia.getStates().values()]
      .map((e) => (e as { user?: { name?: string; color?: string } }).user)
      .filter((u): u is { name: string; color: string } => !!u?.name)
      .map((u) => ({ nombre: String(u.name).slice(0, 60), color: String(u.color ?? '#888').slice(0, 20), seccion: this.id }));
  }

  cerrar() {
    this.guardar();
    for (const c of this.conexiones.keys()) c.close(1001, 'Colaboración terminada');
    this.presencia.destroy();
    this.doc.destroy();
  }
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface EstadoColaboracion {
  activa: boolean;
  codigo?: string;
  puerto?: number;
  /** Enlaces para invitar (uno por cada dirección de la red local). */
  enlaces: string[];
  personas: Persona[];
}

export class Colaboracion {
  private servidor?: Server;
  private wss?: WebSocketServer;
  private salas = new Map<string, Sala>();
  codigo = '';
  puerto = 0;

  constructor(
    private libro: AccesoLibro,
    private estaticos: { raiz?: string; vite?: { middlewares: (q: IncomingMessage, r: ServerResponse) => void } },
  ) {}

  get activa() {
    return !!this.servidor;
  }

  async iniciar(puerto = Number(process.env.OBI_PUERTO_COLABORACION ?? 0)): Promise<EstadoColaboracion> {
    if (this.servidor) return this.estado();
    this.codigo = randomBytes(6).toString('base64url');
    const servidor = createServer((q, r) => void this.atender(q, r));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
    servidor.on('upgrade', (q, socket, cabeza) => {
      const url = new URL(q.url ?? '/', 'http://x');
      const id = decodeURIComponent(url.pathname.slice(1));
      const s = this.libro.secciones().find((x) => x.id === id);
      if (url.searchParams.get('c') !== this.codigo || !s || NO_TEXTO.has(s.tipo)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(q, socket, cabeza, (ws) => this.sala(id).conectar(ws));
    });
    await new Promise<void>((ok, mal) => {
      servidor.once('error', mal);
      servidor.listen(puerto, '0.0.0.0', ok);
    });
    this.servidor = servidor;
    this.wss = wss;
    this.puerto = (servidor.address() as { port: number }).port;
    return this.estado();
  }

  async detener() {
    for (const s of this.salas.values()) s.cerrar();
    this.salas.clear();
    this.wss?.close();
    // Las conexiones abiertas (keep-alive, salas) no deben impedir el cierre.
    this.servidor?.closeAllConnections();
    await new Promise<void>((ok) => (this.servidor ? this.servidor.close(() => ok()) : ok()));
    this.servidor = undefined;
    this.wss = undefined;
    this.codigo = '';
    this.puerto = 0;
  }

  private sala(id: string): Sala {
    let s = this.salas.get(id);
    if (!s) {
      s = new Sala(id, this.libro);
      this.salas.set(id, s);
    }
    return s;
  }

  /** Antes de cada cambio por la API: lo pendiente de las salas pasa al modelo. */
  guardarPendiente() {
    for (const s of this.salas.values()) s.guardar();
  }

  /** Después de cada cambio por la API: las salas toman el texto que cambió por otra vía. */
  sincronizar() {
    for (const [id, s] of this.salas) {
      if (!this.libro.secciones().some((x) => x.id === id)) {
        s.cerrar();
        this.salas.delete(id);
      } else s.sincronizar();
    }
  }

  estado(): EstadoColaboracion {
    if (!this.servidor) return { activa: false, enlaces: [], personas: [] };
    const direcciones = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address);
    return {
      activa: true,
      codigo: this.codigo,
      puerto: this.puerto,
      enlaces: (direcciones.length ? direcciones : ['127.0.0.1']).map((d) => `http://${d}:${this.puerto}/colaborar.html?c=${this.codigo}`),
      personas: [...this.salas.values()].flatMap((s) => s.personas()),
    };
  }

  private async atender(q: IncomingMessage, r: ServerResponse) {
    const url = new URL(q.url ?? '/', 'http://x');
    const cabeceras = {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    };
    try {
      if (url.pathname === '/estado') {
        if (url.searchParams.get('c') !== this.codigo) {
          r.writeHead(403, { ...cabeceras, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Código de invitación no válido.' }));
          return;
        }
        const secciones = this.libro.secciones().map((s) => ({ id: s.id, titulo: s.titulo, tipo: s.tipo, editable: !NO_TEXTO.has(s.tipo) }));
        r.writeHead(200, { ...cabeceras, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ titulo: this.libro.titulo(), secciones }));
        return;
      }
      if (url.pathname === '/') {
        r.writeHead(302, { Location: `/colaborar.html${url.search}` }).end();
        return;
      }
      // En desarrollo, Vite sirve la página (solo para pruebas: no usar «npm run dev:web» en una red no confiable).
      if (this.estaticos.vite) {
        this.estaticos.vite.middlewares(q, r);
        return;
      }
      // En la app: solo la página de invitados y los archivos compilados de la interfaz.
      if (url.pathname !== '/colaborar.html' && !/^\/assets\/[\w.-]+$/.test(url.pathname)) {
        r.writeHead(404, cabeceras).end();
        return;
      }
      const raiz = this.estaticos.raiz;
      const ruta = raiz ? join(raiz, decodeURIComponent(url.pathname)) : '';
      if (!raiz || !ruta.startsWith(raiz) || !existsSync(ruta)) {
        r.writeHead(404, cabeceras).end();
        return;
      }
      r.writeHead(200, { ...cabeceras, 'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream' });
      r.end(await readFile(ruta));
    } catch (e) {
      r.writeHead(500, cabeceras).end(String((e as Error).message));
    }
  }
}
