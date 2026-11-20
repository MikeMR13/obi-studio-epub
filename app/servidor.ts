// Servidor local de Obi Studio: la misma API para la app de escritorio (Electron) y para el navegador en desarrollo.
// Solo escucha en 127.0.0.1 y, fuera de desarrollo, exige un token por sesión.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Colaboracion } from './colaboracion.js';
import { Backend, ErrorUsuario } from './backend.js';
import { resolverImpresion } from '../src/servicio-impresion.js';
import { rutaRecurso } from '../src/recursos.js';

const aqui = dirname(fileURLToPath(import.meta.url));

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

async function cuerpo(req: IncomingMessage, limite = 300 * 1024 * 1024): Promise<Uint8Array> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const t of req) {
    total += (t as Buffer).length;
    if (total > limite) throw new ErrorUsuario('El archivo es demasiado grande.', 413);
    trozos.push(t as Buffer);
  }
  return new Uint8Array(Buffer.concat(trozos));
}

async function json<T = any>(req: IncomingMessage): Promise<T> {
  const d = await cuerpo(req, 50 * 1024 * 1024);
  if (!d.length) return {} as T;
  try {
    return JSON.parse(new TextDecoder().decode(d));
  } catch {
    throw new ErrorUsuario('Petición mal formada.');
  }
}

function enviar(res: ServerResponse, estado: number, datos: unknown) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

function descarga(res: ServerResponse, nombre: string, tipo: string, datos: Uint8Array) {
  res.writeHead(200, {
    'Content-Type': tipo,
    'Content-Length': datos.length,
    'Content-Disposition': `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Cache-Control': 'no-store',
  });
  res.end(Buffer.from(datos));
}

export interface OpcionesServidor {
  puerto?: number;
  dev?: boolean;
  backend?: Backend;
  token?: string;
}

export async function iniciarServidor(op: OpcionesServidor = {}) {
  const backend = op.backend ?? new Backend();
  const token = op.dev ? '' : op.token ?? randomBytes(24).toString('hex');
  const raizRenderer = [resolve(aqui, '../dist/renderer'), resolve(aqui, '../renderer')].find((r) => existsSync(join(r, 'index.html')));

  let vite: any;
  if (op.dev) {
    const { createServer: crearVite } = await import('vite');
    vite = await crearVite({ configFile: resolve(aqui, '../vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
  }

  const colaboracion = new Colaboracion(
    {
      secciones: () => backend.libro.secciones,
      titulo: () => backend.libro.metadatos.titulo,
      guardar: (id, bloques, notas) => backend.guardarDesdeColaboracion(id, bloques, notas),
    },
    { raiz: raizRenderer, vite },
  );
  backend.datosColaboracion = () => (colaboracion.activa ? { puerto: colaboracion.puerto, codigo: colaboracion.codigo } : undefined);

  const rutas: [string, RegExp, (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => Promise<void>][] = [
    ['GET', /^\/api\/estado$/, async (_q, r) => enviar(r, 200, backend.estado())],
    ['POST', /^\/api\/nuevo$/, async (q, r) => {
      const d = await json(q);
      backend.nuevo(d.titulo, d.autor);
      enviar(r, 200, backend.estado());
    }],
    ['POST', /^\/api\/importar$/, async (q, r, _m, url) => {
      await backend.importar(url.searchParams.get('nombre') ?? 'archivo', await cuerpo(q));
      enviar(r, 200, backend.estado());
    }],
    ['PUT', /^\/api\/metadatos$/, async (q, r) => {
      backend.metadatos(await json(q));
      enviar(r, 200, backend.estado());
    }],
    ['PUT', /^\/api\/tema$/, async (q, r) => {
      backend.tema(await json(q));
      enviar(r, 200, backend.estado());
    }],
    ['POST', /^\/api\/tema\/galeria$/, async (q, r) => {
      backend.aplicarTemaGaleria((await json(q)).id);
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/tema\/muestra$/, async (_q, r, _m, url) => enviar(r, 200, { url: await backend.muestraTema(url.searchParams.get('modo') === 'pagina' ? 'pagina' : 'lector') })],
    ['GET', /^\/muestra\/(\d+)\/(.+)$/, async (_q, r, m) => {
      const d = backend.archivoMuestra(m[1], decodeURIComponent(m[2]));
      if (d === undefined) throw new ErrorUsuario('No encontrado', 404);
      r.writeHead(200, { 'Content-Type': TIPOS[extname(m[2])] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      r.end(typeof d === 'string' ? d : Buffer.from(d));
    }],
    ['PUT', /^\/api\/tipografia$/, async (q, r) => {
      backend.tipografia(await json(q));
      enviar(r, 200, backend.estado());
    }],
    ['POST', /^\/api\/tipografia\/aplicar$/, async (q, r) => {
      const d = await json(q);
      const cambios = backend.aplicarTipografia(d.seccion);
      enviar(r, 200, { cambios, estado: backend.estado() });
    }],
    ['POST', /^\/api\/secciones$/, async (q, r) => {
      const d = await json(q);
      const s = backend.anadirSeccion(d.tipo ?? 'capitulo', d.titulo ?? '', d.despuesDe);
      enviar(r, 200, { seccion: s.id, estado: backend.estado() });
    }],
    ['PUT', /^\/api\/secciones\/([\w-]+)$/, async (q, r, m) => {
      backend.actualizarSeccion(m[1], await json(q));
      enviar(r, 200, backend.estado());
    }],
    ['DELETE', /^\/api\/secciones\/([\w-]+)$/, async (_q, r, m) => {
      backend.eliminarSeccion(m[1]);
      enviar(r, 200, backend.estado());
    }],
    ['PUT', /^\/api\/orden$/, async (q, r) => {
      backend.ordenar((await json(q)).ids);
      enviar(r, 200, backend.estado());
    }],
    ['POST', /^\/api\/recursos$/, async (q, r, _m, url) => {
      const rec = backend.anadirRecurso(url.searchParams.get('nombre') ?? 'imagen', await cuerpo(q));
      enviar(r, 200, { recurso: rec, estado: backend.estado() });
    }],
    ['PUT', /^\/api\/recursos\/([\w-]+)$/, async (q, r, m) => {
      backend.reemplazarRecurso(m[1], await cuerpo(q));
      enviar(r, 200, backend.estado());
    }],
    ['POST', /^\/api\/recursos\/([\w-]+)\/editar$/, async (q, r, m) => {
      await backend.editarImagen(m[1], await json(q));
      enviar(r, 200, backend.estado());
    }],
    ['PUT', /^\/api\/optimizar-imagenes$/, async (q, r) => {
      backend.optimizarImagenes(!!(await json(q)).activo);
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/fuentes-sistema$/, async (_q, r) => {
      const lista = await backend.fuentesSistema();
      enviar(r, 200, lista.map((f) => ({ familia: f.familia, caras: f.caras.map(({ ruta: _r, ...c }) => c) })));
    }],
    ['POST', /^\/api\/fuentes-propias$/, async (q, r, _m, url) => {
      const res = backend.anadirFuente(url.searchParams.get('nombre') ?? 'fuente', await cuerpo(q));
      enviar(r, 200, { ...res, estado: backend.estado() });
    }],
    ['POST', /^\/api\/fuentes-propias\/sistema$/, async (q, r) => {
      const res = await backend.anadirFuenteSistema(String((await json(q)).familia ?? ''));
      enviar(r, 200, { ...res, estado: backend.estado() });
    }],
    ['DELETE', /^\/api\/fuentes-propias\/([\w-]+)$/, async (_q, r, m) => {
      backend.quitarFuente(m[1]);
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/recursos\/([\w-]+)$/, async (_q, r, m) => {
      const rec = backend.recurso(m[1]);
      r.writeHead(200, { 'Content-Type': rec.tipoMime, 'Cache-Control': 'no-cache' });
      r.end(Buffer.from(rec.datos));
    }],
    ['GET', /^\/api\/codigo\/([\w-]+)$/, async (_q, r, m) => enviar(r, 200, { xhtml: backend.codigo(m[1]) })],
    ['PUT', /^\/api\/codigo\/([\w-]+)$/, async (q, r, m) => {
      const nuevas = await backend.aplicarCodigo(m[1], (await json(q)).xhtml ?? '');
      enviar(r, 200, { secciones: nuevas.map((s) => s.id), estado: backend.estado() });
    }],
    ['POST', /^\/api\/validar$/, async (_q, r) => enviar(r, 200, await backend.validar())],
    ['GET', /^\/api\/exportar$/, async (_q, r) => {
      const { nombre, datos } = await backend.exportar();
      descarga(r, nombre, 'application/epub+zip', datos);
    }],
    ['PUT', /^\/api\/escritura$/, async (q, r) => {
      backend.escritura((await json(q)).escritura === 'vertical' ? 'vertical' : 'horizontal');
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/exportar-kepub$/, async (_q, r) => {
      const { nombre, datos } = await backend.exportarKepub();
      descarga(r, nombre, 'application/epub+zip', datos);
    }],
    ['GET', /^\/api\/tiendas\/(\w+)\/revision$/, async (_q, r, m) => enviar(r, 200, await backend.revisarTienda(m[1]))],
    ['GET', /^\/api\/tiendas\/(\w+)\/exportar$/, async (_q, r, m) => {
      const { nombre, datos } = await backend.exportarTienda(m[1]);
      descarga(r, nombre, 'application/epub+zip', datos);
    }],
    ['GET', /^\/api\/muestra\/(epub|web)$/, async (_q, r, m, url) => {
      const op = { secciones: (url.searchParams.get('secciones') ?? '').split(',').filter(Boolean), enlace: url.searchParams.get('enlace') ?? undefined };
      if (m[1] === 'epub') {
        const { nombre, datos } = await backend.exportarMuestra(op);
        descarga(r, nombre, 'application/epub+zip', datos);
      } else {
        const { nombre, datos } = backend.sitioMuestra(op);
        descarga(r, nombre, 'text/html; charset=utf-8', datos);
      }
    }],
    ['GET', /^\/api\/portada$/, async (_q, r) => {
      const { nombre, datos, tipoMime } = backend.portadaOriginal();
      descarga(r, nombre, tipoMime, datos);
    }],
    ['GET', /^\/api\/exportar-word$/, async (_q, r) => {
      const { nombre, datos } = await backend.exportarWord();
      descarga(r, nombre, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', datos);
    }],
    ['POST', /^\/api\/secciones\/([\w-]+)\/cambios\/([\w-]+)\/(aceptar|rechazar)$/, async (_q, r, m) => {
      backend.resolverCambio(m[1], m[2], m[3] === 'aceptar');
      enviar(r, 200, backend.estado());
    }],
    ['POST', /^\/api\/cambios\/(aceptar|rechazar)$/, async (_q, r, m, url) => {
      const fallos = backend.resolverTodos(m[1] === 'aceptar', url.searchParams.get('seccion') ?? undefined);
      enviar(r, 200, { fallos, estado: backend.estado() });
    }],
    ['POST', /^\/api\/versiones$/, async (q, r) => {
      backend.crearVersion(String((await json(q)).nombre ?? ''));
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/versiones\/([\w-]+)\/comparar$/, async (_q, r, m) => enviar(r, 200, backend.compararVersion(m[1]))],
    ['POST', /^\/api\/versiones\/([\w-]+)\/restaurar$/, async (_q, r, m) => {
      const avisos = backend.restaurarVersion(m[1]);
      enviar(r, 200, { avisos, estado: backend.estado() });
    }],
    ['DELETE', /^\/api\/versiones\/([\w-]+)$/, async (_q, r, m) => {
      backend.eliminarVersion(m[1]);
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/colaboracion$/, async (_q, r) => enviar(r, 200, colaboracion.estado())],
    ['POST', /^\/api\/colaboracion$/, async (_q, r) => {
      if (!(await backend.configuracion.leer()).colaboracion)
        throw new ErrorUsuario('La colaboración en la red local está desactivada. Actívala en Configuración.', 403);
      enviar(r, 200, { ...(await colaboracion.iniciar()), estado: backend.estado() });
    }],
    ['GET', /^\/api\/configuracion$/, async (_q, r) => enviar(r, 200, await backend.configuracion.leer())],
    ['PUT', /^\/api\/configuracion$/, async (q, r) => {
      const c = await backend.configuracion.cambiar(await json(q));
      // Al desactivar la colaboración se cierra la que estuviera abierta.
      if (!c.colaboracion && colaboracion.activa) await colaboracion.detener();
      enviar(r, 200, { configuracion: c, estado: backend.estado() });
    }],
    ['DELETE', /^\/api\/colaboracion$/, async (_q, r) => {
      await colaboracion.detener();
      enviar(r, 200, { ...colaboracion.estado(), estado: backend.estado() });
    }],
    ['POST', /^\/api\/buscar$/, async (q, r) => enviar(r, 200, backend.buscar(await json(q)))],
    ['POST', /^\/api\/reemplazar$/, async (q, r) => {
      const d = await json(q);
      const res = backend.reemplazar(d.opciones ?? {}, String(d.reemplazo ?? ''), d.solo);
      enviar(r, 200, { ...res, estado: backend.estado() });
    }],
    ['POST', /^\/api\/accesibilidad$/, async (_q, r) => enviar(r, 200, await backend.accesibilidad())],
    ['GET', /^\/api\/accesibilidad\/informe$/, async (_q, r) => {
      const { nombre, datos } = backend.informeAccesibilidad();
      descarga(r, nombre, 'text/html; charset=utf-8', datos);
    }],
    ['GET', /^\/api\/plugins$/, async (_q, r) => enviar(r, 200, await backend.listarPlugins())],
    ['GET', /^\/api\/catalogo$/, async (_q, r) => enviar(r, 200, await backend.listarCatalogo())],
    ['POST', /^\/api\/catalogo$/, async (q, r) => {
      const n = await backend.agregarCatalogo(String((await json(q)).url ?? ''));
      enviar(r, 200, { nuevos: n, ...(await backend.listarCatalogo()) });
    }],
    ['DELETE', /^\/api\/catalogo$/, async (_q, r, _m, url) => {
      await backend.quitarCatalogo(url.searchParams.get('url') ?? '');
      enviar(r, 200, await backend.listarCatalogo());
    }],
    ['POST', /^\/api\/catalogo\/instalar$/, async (q, r) => {
      const d = await json(q);
      await backend.instalarDesdeCatalogo(String(d.origen ?? ''), String(d.id ?? ''));
      enviar(r, 200, { instalados: await backend.listarPlugins(), ...(await backend.listarCatalogo()) });
    }],
    ['POST', /^\/api\/plugins\/inspeccionar$/, async (q, r) => enviar(r, 200, await backend.inspeccionarPlugin(await cuerpo(q, 5 * 1024 * 1024)))],
    ['POST', /^\/api\/plugins$/, async (q, r) => {
      await backend.instalarPlugin(await cuerpo(q, 5 * 1024 * 1024));
      enviar(r, 200, await backend.listarPlugins());
    }],
    ['DELETE', /^\/api\/plugins\/([a-z0-9._-]+)$/, async (_q, r, m) => {
      await backend.eliminarPlugin(m[1]);
      enviar(r, 200, await backend.listarPlugins());
    }],
    ['POST', /^\/api\/plugins\/([a-z0-9._-]+)\/revisar$/, async (_q, r, m) => enviar(r, 200, await backend.revisarConPlugin(m[1]))],
    ['POST', /^\/api\/plugins\/([a-z0-9._-]+)\/transformar$/, async (_q, r, m) => {
      const { registros } = await backend.transformarConPlugin(m[1]);
      enviar(r, 200, { registros, estado: backend.estado() });
    }],
    ['POST', /^\/api\/plugins\/deshacer$/, async (_q, r) => {
      backend.deshacerPlugin();
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/plugins\/([a-z0-9._-]+)\/exportar$/, async (_q, r, m) => {
      const { nombre, datos, tipoMime } = await backend.exportarConPlugin(m[1]);
      descarga(r, nombre, tipoMime, datos);
    }],
    ['POST', /^\/api\/correcciones$/, async (q, r, _m, url) => {
      const resumen = await backend.importarCorrecciones(url.searchParams.get('nombre') ?? '', await cuerpo(q), url.searchParams.get('revisar') === '1');
      enviar(r, 200, { resumen, estado: backend.estado() });
    }],
    ['GET', /^\/api\/proyecto$/, async (_q, r) => {
      const { nombre, datos } = await backend.proyecto();
      descarga(r, nombre, 'application/octet-stream', datos);
    }],
    ['PUT', /^\/api\/impresion$/, async (q, r) => {
      backend.impresion(await json(q));
      enviar(r, 200, backend.estado());
    }],
    ['GET', /^\/api\/impresion\/revision$/, async (_q, r) => enviar(r, 200, { avisos: backend.revisionImpresion(), paginas: backend.ultimasPaginas })],
    ['GET', /^\/api\/impresion\/visor$/, async (_q, r) => enviar(r, 200, { url: await backend.vistaImpresion() })],
    ['GET', /^\/api\/exportar-pdf$/, async (_q, r, _m, url) => {
      const tipo = url.searchParams.get('tipo') === 'digital' ? 'digital' : 'impresion';
      const { nombre, datos, paginas } = await backend.exportarPdf(tipo);
      r.setHeader('X-Obi-Paginas', String(paginas));
      descarga(r, nombre, 'application/pdf', datos);
    }],
    ['GET', /^\/vista\/(.+)$/, async (_q, r, m) => {
      const archivos = backend.archivosVista();
      const ruta = decodeURIComponent(m[1]);
      const d = archivos.get(ruta);
      if (d === undefined) throw new ErrorUsuario('No encontrado', 404);
      r.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      r.end(typeof d === 'string' ? d : Buffer.from(d));
    }],
  ];

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // Visor de Vivliostyle y libro de impresión: la clave va en la ruta (el visor no envía cabeceras).
      if (url.pathname.startsWith('/vivliostyle/') || url.pathname.startsWith('/impresion/')) {
        const respuesta = await resolverImpresion(url.pathname, backend.clave, (v) => backend.paqueteImpresion(v));
        if (!respuesta) return enviar(res, 404, { error: 'No encontrado' });
        res.writeHead(200, { 'Content-Type': respuesta.tipo, 'Cache-Control': 'no-store' });
        return res.end(typeof respuesta.datos === 'string' ? respuesta.datos : Buffer.from(respuesta.datos));
      }
      // Fuentes OFL para la galería de temas de la interfaz.
      if (url.pathname.startsWith('/fuentes/')) {
        const f = rutaRecurso('fuentes', decodeURIComponent(url.pathname.slice(9)).replace(/[/\\]/g, ''));
        if (!f) return enviar(res, 404, { error: 'No encontrado' });
        res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
        return res.end(await readFile(f));
      }
      const esApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/vista/') || url.pathname.startsWith('/muestra/');
      if (esApi && token) {
        const t = req.headers['x-obi-token'] ?? url.searchParams.get('t') ?? leerCookie(req.headers.cookie, 'obi');
        if (t !== token) return enviar(res, 403, { error: 'Acceso no autorizado.' });
      }
      if (esApi) {
        for (const [metodo, re, fn] of rutas) {
          const m = url.pathname.match(re);
          if (m && req.method === metodo) {
            // Con colaboración activa: lo que escriben los demás pasa al modelo antes del cambio,
            // y después las salas toman lo que cambió por otra vía.
            const cambia = req.method !== 'GET' && colaboracion.activa;
            if (cambia) colaboracion.guardarPendiente();
            await fn(req, res, m, url);
            if (cambia) colaboracion.sincronizar();
            return;
          }
        }
        return enviar(res, 404, { error: 'Ruta desconocida.' });
      }
      if (vite) return vite.middlewares(req, res);
      if (!raizRenderer) return enviar(res, 500, { error: 'Falta compilar la interfaz (npm run build).' });
      let ruta = join(raizRenderer, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!ruta.startsWith(raizRenderer) || !existsSync(ruta)) ruta = join(raizRenderer, 'index.html');
      const cabeceras: Record<string, string> = {
        'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream',
        'Content-Security-Policy':
          "default-src 'self'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; object-src 'none'",
      };
      if (token && url.searchParams.get('t') === token) cabeceras['Set-Cookie'] = `obi=${token}; HttpOnly; SameSite=Strict; Path=/`;
      res.writeHead(200, cabeceras);
      res.end(await readFile(ruta));
    } catch (e) {
      if (e instanceof ErrorUsuario) return enviar(res, e.estado, { error: e.message, datos: e.datos });
      console.error(e);
      enviar(res, 500, { error: `Error interno: ${(e as Error).message}` });
    }
  });

  await new Promise<void>((ok) => servidor.listen(op.puerto ?? 0, '127.0.0.1', ok));
  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
  backend.base = `http://127.0.0.1:${puerto}`;
  backend.clave = token || '-';
  return { servidor, puerto, token, backend, colaboracion, url: `http://127.0.0.1:${puerto}/${token ? `?t=${token}` : ''}` };
}

function leerCookie(cabecera: string | undefined, nombre: string): string | undefined {
  return cabecera?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === nombre)?.[1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev');
  const puerto = Number(process.env.PUERTO ?? 5180);
  const s = await iniciarServidor({ dev, puerto });
  console.log(`Obi Studio en ${s.url}`);
}
