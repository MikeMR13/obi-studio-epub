// Operaciones de la app sobre el libro abierto. La interfaz solo habla con esto.

import JSZip from 'jszip';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Bloque, Comentario, Impresion, Libro, Nota, Metadatos, Recurso, Seccion, Tema, TipoSeccion, Tipografia } from '../src/model.js';
import { ajustesImpresion, TAMANOS_IMPRESION, temaCompleto, validarTema } from '../src/model.js';
import { TEMAS } from '../src/temas.js';
import { libroMuestra, sitioMuestra as crearSitioMuestra, type OpcionesMuestra } from '../src/muestra.js';
import { TIENDAS, compilarParaTienda, revisarTienda, type AvisoTienda, type IdTienda } from '../src/tiendas.js';
import { buscarGhostscript } from '../src/pdfx.js';
import { ErrorImagen, girar, libroConImagenesOptimizadas, recortar } from '../src/procesar-imagen.js';
import { ArchivoConfiguracion } from '../src/configuracion.js';
import { CATALOGO_INTEGRADO, ListaCatalogos, archivoCatalogos, leerCatalogo, normalizarUrlCatalogo, paqueteDeCatalogo, versionMayor, type EntradaCatalogo } from '../src/catalogo.js';
import { ErrorCambio, aceptarCambio, aceptarTodos, rechazarCambio } from '../src/cambios.js';
import { ErrorVersion, compararVersion, crearVersion, eliminarVersion, restaurarVersion, resumenVersiones, type DiferenciaSeccion, type ResumenVersion } from '../src/versiones.js';
import { ErrorBusqueda, buscar, reemplazar, type Coincidencia, type OpcionesBusqueda } from '../src/buscar.js';
import { evaluadorChrome, informeHtml, revisarAccesibilidad, type Evaluador, type InformeAccesibilidad } from '../src/accesibilidad.js';
import {
  AlmacenPlugins,
  ErrorPlugin,
  ejecutarPlugin,
  leerPlugin,
  libroParaPlugin,
  validarExportacion,
  validarHallazgos,
  validarLibroPlugin,
  type Hallazgo,
  type Manifiesto,
  type PluginInstalado,
} from '../src/plugins.js';
import { compilarKepub } from '../src/kepub.js';
import { exportarWord, importarCorrecciones, type ResumenCorrecciones } from '../src/formatos/word.js';
import { archivosImpresion, margenInteriorAutomatico } from '../src/impresion.js';
import { generarPdf, renderizadorChrome, urlVisor, type Renderizador, type TipoPdf } from '../src/pdf.js';
import { libroParaImprimir } from '../src/servicio-impresion.js';
import { revisarImpresion, type AvisoImpresion } from '../src/preflight.js';
import { libroNuevo, nuevaSeccion, nuevoId, contarPalabras } from '../src/model.js';
import { compilar, compilarArchivos, archivoSeccion, rutaImagen, cssLibro, CONTAINER } from '../src/compilar.js';
import { importarEpub } from '../src/formatos/epub.js';
import { importarDocx } from '../src/formatos/docx.js';
import { errorXhtml } from '../src/formatos/dom.js';
import { deserializarProyecto, guardarProyecto, serializarProyecto } from '../src/proyecto.js';
import { validarDatos, type Resultado } from '../src/validar.js';
import { aplicarTipografiaLibro, aplicarTipografiaSeccion } from '../src/tipografia.js';
import { tamanoImagen, tipoPorContenido, extension } from '../src/imagen.js';

/** Acepta solo comentarios con la forma esperada. */
function limpiarComentarios(v: unknown): Comentario[] {
  if (!Array.isArray(v)) return [];
  const txt = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  return v
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.texto === 'string')
    .map((c) => ({
      id: c.id.slice(0, 40),
      autor: txt(c.autor, 120) || 'Anónimo',
      fecha: txt(c.fecha, 40) || new Date().toISOString(),
      texto: txt(c.texto, 10_000),
      ...(c.resuelto ? { resuelto: true } : {}),
      ...(c.cita ? { cita: txt(c.cita, 500) } : {}),
      ...(Array.isArray(c.respuestas) && c.respuestas.length
        ? { respuestas: c.respuestas.filter((r: unknown) => r && typeof r === 'object').map((r: Record<string, unknown>) => ({ autor: txt(r.autor, 120) || 'Anónimo', fecha: txt(r.fecha, 40), texto: txt(r.texto, 10_000) })) }
        : {}),
    }));
}

let ghostscript: boolean | undefined;
function hayGhostscript(): boolean {
  return (ghostscript ??= !!buscarGhostscript());
}

export class ErrorUsuario extends Error {
  constructor(mensaje: string, public estado = 400, public datos?: unknown) {
    super(mensaje);
  }
}

export interface RecursoPublico extends Omit<Recurso, 'datos'> {
  bytes: number;
}

export interface Estado {
  libro: Omit<Libro, 'recursos'> & { recursos: RecursoPublico[] };
  nombreArchivo: string;
  cambiado: boolean;
  palabras: Record<string, number>;
  avisos: string[];
  /** Nombre del plugin cuya transformación se puede deshacer. */
  deshacerPlugin?: string;
  versiones: ResumenVersion[];
  /** Colaboración activa en la red local: el editor se conecta a esta sala. */
  colaboracion?: { puerto: number; codigo: string };
  /** Hay Ghostscript para el PDF/X-1a. */
  ghostscript: boolean;
}

export class Backend {
  libro: Libro = libroNuevo();
  nombreArchivo = 'libro-sin-titulo.obi';
  cambiado = false;
  avisos: string[] = [];
  ultimaValidacion?: Resultado;
  private temporizador?: NodeJS.Timeout;
  /** Dirección del servidor local y clave de las rutas de impresión (la fija el servidor). */
  base = '';
  clave = '-';
  /** Cómo se imprime a PDF: Electron inyecta el suyo; si no, Chrome/Edge del sistema. */
  renderizador: Renderizador = renderizadorChrome();
  /** Navegador para el informe de accesibilidad (Electron usa una ventana oculta). */
  evaluador: Evaluador = evaluadorChrome();
  private ultimoInforme?: InformeAccesibilidad;
  ultimasPaginas?: number;
  /** Páginas a color del último PDF de imprenta. */
  ultimasPaginasColor?: number[];
  private paquetes = new Map<string, Map<string, string | Uint8Array>>();
  private contadorImpresion = 0;

  /** Lo pone el servidor cuando la colaboración en la red local está activa. */
  datosColaboracion?: () => { puerto: number; codigo: string } | undefined;

  /** Texto que llega de una sala de colaboración. */
  guardarDesdeColaboracion(id: string, bloques: Bloque[], notas: Nota[]) {
    const s = this.libro.secciones.find((x) => x.id === id);
    if (!s) return;
    s.bloques = bloques;
    s.notas = notas;
    this.marcar();
  }

  /** Plugins instalados (Electron usa la carpeta de datos de la app). */
  plugins = new AlmacenPlugins(process.env.OBI_PLUGINS || join(homedir(), '.obi-studio', 'plugins'));
  /** Libro antes de la última transformación de un plugin, para deshacerla. */
  private antesDePlugin?: { libro: Libro; plugin: string };

  /** Configuración de la app (Electron la guarda en la carpeta de datos). */
  configuracion = new ArchivoConfiguracion(process.env.OBI_CONFIGURACION || join(homedir(), '.obi-studio', 'configuracion.json'));

  constructor(private carpetaRecuperacion = join(homedir(), '.obi-studio')) {}

  estado(): Estado {
    const recursos = this.libro.recursos.map(({ datos, ...r }) => ({ ...r, bytes: datos.length }));
    const palabras: Record<string, number> = {};
    for (const s of this.libro.secciones) palabras[s.id] = contarPalabras(s);
    const { versiones: _v, recursosVersiones: _rv, ...libro } = this.libro;
    return {
      libro: { ...libro, recursos },
      versiones: resumenVersiones(this.libro),
      ghostscript: hayGhostscript(),
      ...(this.datosColaboracion?.() ? { colaboracion: this.datosColaboracion()! } : {}),
      nombreArchivo: this.nombreArchivo,
      cambiado: this.cambiado,
      palabras,
      avisos: this.avisos,
      ...(this.antesDePlugin ? { deshacerPlugin: this.antesDePlugin.plugin } : {}),
    };
  }

  private marcar() {
    // Cualquier cambio posterior a una transformación hace que ya no se pueda deshacer de golpe.
    this.antesDePlugin = undefined;
    this.cambiado = true;
    this.ultimaValidacion = undefined;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.guardarRecuperacion(), 60_000);
  }

  async guardarRecuperacion(): Promise<string> {
    await mkdir(this.carpetaRecuperacion, { recursive: true });
    const ruta = join(this.carpetaRecuperacion, 'recuperacion.obi');
    await guardarProyecto(ruta, this.libro);
    return ruta;
  }

  seccion(id: string): Seccion {
    const s = this.libro.secciones.find((x) => x.id === id);
    if (!s) throw new ErrorUsuario('La sección no existe.', 404);
    return s;
  }

  nuevo(titulo?: string, autor?: string) {
    this.libro = libroNuevo(titulo || 'Libro sin título', autor || '');
    this.nombreArchivo = nombreDeArchivo(this.libro.metadatos.titulo) + '.obi';
    this.cambiado = false;
    this.avisos = [];
    this.ultimasPaginas = this.ultimasPaginasColor = undefined;
  }

  async importar(nombre: string, datos: Uint8Array) {
    const ext = nombre.toLowerCase().split('.').pop();
    let libro: Libro;
    let avisos: string[] = [];
    try {
      if (ext === 'obi') libro = await deserializarProyecto(datos);
      else if (ext === 'epub') {
        const r = await importarEpub(datos);
        libro = r.libro;
        avisos = r.avisos.map((a) => (a.archivo ? `${a.mensaje} (${a.archivo})` : a.mensaje));
      } else if (ext === 'docx') {
        const r = await importarDocx(datos);
        libro = r.libro;
        avisos = r.avisos.map((a) => a.mensaje);
      } else if (ext && (await this.importadorPara(ext))) {
        const p = (await this.importadorPara(ext))!;
        const plugin = await this.plugins.obtener(p.id);
        const base = libroNuevo(nombre.replace(/\.[^.]+$/, ''), '');
        base.secciones = [];
        const r = await ejecutarPlugin(plugin, 'importador', [datos, nombre]);
        libro = validarLibroPlugin(r.resultado, { ...base, recursos: [] }, p.permisos);
        avisos = [`Importado con el plugin «${p.nombre}».`];
      } else if (ext === 'doc' || ext === 'rtf') {
        throw new ErrorUsuario('Abre el archivo en Word o LibreOffice y guárdalo como .docx para importarlo.');
      } else throw new ErrorUsuario('Formato no admitido. Usa .epub, .docx u .obi, o instala un plugin que lo importe.');
    } catch (e) {
      if (e instanceof ErrorUsuario) throw e;
      throw new ErrorUsuario(`No se pudo abrir el archivo: ${(e as Error).message}`);
    }
    this.libro = libro;
    this.avisos = avisos;
    this.antesDePlugin = undefined;
    this.nombreArchivo = ext === 'obi' ? nombre : nombreDeArchivo(libro.metadatos.titulo || nombre.replace(/\.[^.]+$/, '')) + '.obi';
    this.cambiado = ext !== 'obi';
    this.ultimaValidacion = undefined;
    this.ultimasPaginas = this.ultimasPaginasColor = undefined;
  }

  metadatos(cambios: Partial<Metadatos>) {
    this.libro.metadatos = { ...this.libro.metadatos, ...cambios };
    for (const [k, v] of Object.entries(this.libro.metadatos)) {
      if (v === '' || v === null || v === undefined) delete (this.libro.metadatos as unknown as Record<string, unknown>)[k];
    }
    if (!this.libro.metadatos.titulo) this.libro.metadatos.titulo = 'Libro sin título';
    this.marcar();
  }

  tema(cambios: Partial<Tema> | Record<string, unknown>) {
    const validos = validarTema(cambios);
    if ('separadorImagen' in validos && validos.separadorImagen && !this.libro.recursos.some((r) => r.id === validos.separadorImagen)) {
      delete validos.separadorImagen;
    }
    // Un cambio manual convierte el tema en personalizado (salvo que llegue con nombre: galería o archivo).
    const nombre = typeof (cambios as Record<string, unknown>).nombre === 'string' ? validos.nombre : 'Personalizado';
    this.libro.tema = { ...temaCompleto(this.libro), ...validos, nombre };
    this.marcar();
  }

  aplicarTemaGaleria(id: string) {
    const t = TEMAS.find((x) => x.id === id);
    if (!t) throw new ErrorUsuario('Ese tema no existe.');
    this.libro.tema = { ...t.tema };
    this.marcar();
  }

  /** Libro de muestra con el tema actual: un capítulo corto para ver el tema en vivo. */
  private libroMuestra(): Libro {
    const conCabecera = this.libro.secciones.find((s) => s.imagenCabecera);
    const p = (texto: string, estilo: 'cuerpo' | 'pensamiento' = 'cuerpo') => ({ tipo: 'parrafo' as const, estilo, contenido: [{ tipo: 'texto' as const, texto }] });
    const muestra: Seccion = {
      id: 'muestra',
      tipo: 'capitulo',
      titulo: 'Capítulo 1: El despertar',
      mostrarTitulo: true,
      enIndice: true,
      imagenCabecera: conCabecera?.imagenCabecera,
      notas: [],
      bloques: [
        p('La madrugada sorprendió a los mercenarios atravesando el desfiladero. Nadie hablaba; solo se oía el crujido de la nieve bajo las botas y, de vez en cuando, el relincho nervioso de algún caballo.'),
        p('—¿De verdad crees que el gremio nos aceptará? —preguntó Aria, sin apartar la vista del camino.'),
        p('—Si no lo hace, tendremos que inventarnos otro oficio —respondió Kael con una media sonrisa.'),
        p('No puede ser tan difícil, pensó ella.', 'pensamiento'),
        { tipo: 'separador' },
        p('Cuando por fin alcanzaron las murallas, el sol ya teñía de naranja los tejados de la ciudad. Las banderas ondeaban sobre la puerta principal y los guardias observaban con desconfianza a cada viajero que se acercaba.'),
        p('El mercado seguía abierto. Entre los puestos de especias y las tiendas de armas, un cartel anunciaba con letras doradas: «Se buscan aventureros».'),
      ],
    };
    return { ...this.libro, secciones: [muestra], metadatos: { ...this.libro.metadatos, portada: undefined } };
  }

  private muestras = new Map<string, Map<string, string | Uint8Array>>();

  /** URL de la muestra del tema: el XHTML real del EPUB (lector) o la página compaginada (impresión). */
  async muestraTema(modo: 'lector' | 'pagina'): Promise<string> {
    const libro = this.libroMuestra();
    if (modo === 'pagina') {
      const v = String(++this.contadorImpresion);
      const a = ajustesImpresion(libro);
      this.paquetes.set(v, archivosImpresion(await libroParaImprimir({ ...libro, impresion: { ...a, capituloEnImpar: false } }), { interior: margenInteriorAutomatico(200), digital: false }));
      return urlVisor(this.base, this.clave, Number(v)).replace('spread=false', 'spread=false&zoom=fit');
    }
    const v = String(Date.now());
    this.muestras.clear();
    this.muestras.set(v, compilarArchivos(libro));
    return `/muestra/${v}/muestra.xhtml`;
  }

  archivoMuestra(version: string, ruta: string): string | Uint8Array | undefined {
    return this.muestras.get(version)?.get(ruta);
  }

  tipografia(cambios: Partial<Tipografia>) {
    this.libro.tipografia = { ...this.libro.tipografia, ...cambios };
    this.marcar();
  }

  aplicarTipografia(seccionId?: string): number {
    const n = seccionId ? aplicarTipografiaSeccion(this.seccion(seccionId), this.libro.tipografia) : aplicarTipografiaLibro(this.libro);
    if (n) this.marcar();
    return n;
  }

  anadirSeccion(tipo: TipoSeccion, titulo: string, despuesDe?: string): Seccion {
    const s = nuevaSeccion(tipo, titulo);
    s.bloques = tipo === 'ilustracion' || tipo === 'portada' || tipo === 'indice' ? [] : [{ tipo: 'parrafo', estilo: 'cuerpo', contenido: [] }];
    const i = despuesDe ? this.libro.secciones.findIndex((x) => x.id === despuesDe) : -1;
    if (i >= 0) this.libro.secciones.splice(i + 1, 0, s);
    else this.libro.secciones.push(s);
    this.marcar();
    return s;
  }

  actualizarSeccion(id: string, cambios: Partial<Seccion> | Record<string, unknown>) {
    const s = this.seccion(id);
    const { id: _id, ...resto } = cambios as Partial<Seccion>;
    Object.assign(s, resto);
    // null quita un campo opcional (imagen de cabecera, doble página).
    if ('comentarios' in (cambios as object)) s.comentarios = limpiarComentarios((cambios as { comentarios?: unknown }).comentarios);
    if (!s.comentarios?.length) delete s.comentarios;
    for (const k of ['imagenCabecera', 'doblePagina', 'paginaFija'] as const) if ((s as unknown as Record<string, unknown>)[k] === null || s[k] === undefined) delete s[k];
    if (s.imagenCabecera && !this.libro.recursos.some((r) => r.id === s.imagenCabecera)) delete s.imagenCabecera;
    this.marcar();
  }

  eliminarSeccion(id: string) {
    if (this.libro.secciones.length <= 1) throw new ErrorUsuario('El libro necesita al menos una sección.');
    this.seccion(id);
    this.libro.secciones = this.libro.secciones.filter((s) => s.id !== id);
    this.marcar();
  }

  ordenar(ids: string[]) {
    const mapa = new Map(this.libro.secciones.map((s) => [s.id, s]));
    if (ids.length !== mapa.size || ids.some((i) => !mapa.has(i))) throw new ErrorUsuario('El nuevo orden no coincide con las secciones del libro.');
    this.libro.secciones = ids.map((i) => mapa.get(i)!);
    this.marcar();
  }

  anadirRecurso(nombre: string, datos: Uint8Array): RecursoPublico {
    const tipo = tipoPorContenido(datos);
    if (!tipo) throw new ErrorUsuario('Formato de imagen no admitido. Usa JPG, PNG, GIF, WebP o SVG.');
    const base = nombre
      .replace(/\.[^.]+$/, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'imagen';
    let archivo = `${base}.${extension(tipo)}`;
    let k = 2;
    while (this.libro.recursos.some((r) => r.nombre.toLowerCase() === archivo.toLowerCase())) archivo = `${base}-${k++}.${extension(tipo)}`;
    const tam = tamanoImagen(datos);
    const r: Recurso = { id: nuevoId('i'), nombre: archivo, tipoMime: tipo, datos, ancho: tam?.ancho, alto: tam?.alto };
    this.libro.recursos.push(r);
    this.marcar();
    const { datos: _d, ...pub } = r;
    return { ...pub, bytes: datos.length };
  }

  reemplazarRecurso(id: string, datos: Uint8Array) {
    const r = this.libro.recursos.find((x) => x.id === id);
    if (!r) throw new ErrorUsuario('La imagen no existe.', 404);
    const tipo = tipoPorContenido(datos);
    if (!tipo) throw new ErrorUsuario('Formato de imagen no admitido.');
    r.datos = datos;
    if (tipo !== r.tipoMime) {
      r.tipoMime = tipo;
      r.nombre = r.nombre.replace(/\.[^.]+$/, '') + '.' + extension(tipo);
    }
    const tam = tamanoImagen(datos);
    r.ancho = tam?.ancho;
    r.alto = tam?.alto;
    this.marcar();
  }

  recurso(id: string): Recurso {
    const r = this.libro.recursos.find((x) => x.id === id);
    if (!r) throw new ErrorUsuario('La imagen no existe.', 404);
    return r;
  }

  /** Archivos del EPUB para la vista previa (misma salida que la exportación). */
  archivosVista(): Map<string, string | Uint8Array> {
    return compilarArchivos(this.libro);
  }

  codigo(id: string): string {
    const s = this.seccion(id);
    return compilarArchivos({ ...this.libro, secciones: this.libro.secciones }).get(archivoSeccion(s)) as string;
  }

  /** Aplica XHTML editado a mano: se vuelve a importar con el mismo importador, así el código y el editor no se desincronizan. */
  async aplicarCodigo(id: string, xhtml: string): Promise<Seccion[]> {
    const s = this.seccion(id);
    const cuerpo = xhtml.replace(/^<\?xml[^>]*>\s*/, '').replace(/<!DOCTYPE[^>]*>\s*/i, '');
    const error = errorXhtml(cuerpo);
    if (error) throw new ErrorUsuario(`El XHTML no está bien formado: ${error}`);
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', CONTAINER);
    const imgs = this.libro.recursos.map((r) => `<item id="${r.id}" href="${rutaImagen(r.nombre)}" media-type="${r.tipoMime}"/>`).join('');
    for (const r of this.libro.recursos) zip.file(`EPUB/${rutaImagen(r.nombre)}`, r.datos);
    zip.file('EPUB/estilos.css', cssLibro(this.libro));
    zip.file('EPUB/s.xhtml', xhtml);
    zip.file(
      'EPUB/package.opf',
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="u">x</dc:identifier><dc:title>x</dc:title><dc:language>${this.libro.metadatos.idioma}</dc:language></metadata><manifest><item id="s" href="s.xhtml" media-type="application/xhtml+xml"/><item id="css" href="estilos.css" media-type="text/css"/>${imgs}</manifest><spine><itemref idref="s"/></spine></package>`,
    );
    const { libro } = await importarEpub(await zip.generateAsync({ type: 'uint8array' }));
    // Las imágenes vuelven con ids nuevos: se mapean por nombre a las del libro.
    const porNombre = new Map(this.libro.recursos.map((r) => [r.nombre, r.id]));
    const idNuevo = new Map(libro.recursos.map((r) => [r.id, porNombre.get(r.nombre) ?? r.id]));
    for (const r of libro.recursos) if (!porNombre.has(r.nombre)) this.libro.recursos.push(r);
    const nuevas = libro.secciones.map((x, k) => {
      for (const b of x.bloques) if (b.tipo === 'imagen') b.recurso = idNuevo.get(b.recurso) ?? b.recurso;
      if (x.imagenCabecera) x.imagenCabecera = idNuevo.get(x.imagenCabecera) ?? x.imagenCabecera;
      if (k === 0 && s.doblePagina) x.doblePagina = s.doblePagina;
      if (k === 0) return { ...x, id: s.id, tipo: s.tipo === x.tipo || x.tipo === 'otro' || x.tipo === 'capitulo' ? s.tipo : x.tipo };
      return { ...x, tipo: x.tipo === 'otro' ? s.tipo : x.tipo };
    });
    if (!nuevas.length) nuevas.push({ ...s, bloques: [] });
    const i = this.libro.secciones.findIndex((x) => x.id === id);
    this.libro.secciones.splice(i, 1, ...nuevas);
    this.marcar();
    return nuevas;
  }

  async validar(): Promise<Resultado> {
    const r = await validarDatos(await compilar(this.libro));
    this.ultimaValidacion = r;
    return r;
  }

  /** Exportar valida primero y bloquea si hay errores. */
  /** El libro tal como va al EPUB: con las imágenes optimizadas si se pidió. */
  private async libroEpub(libro = this.libro): Promise<Libro> {
    return libro.optimizarImagenes ? (await libroConImagenesOptimizadas(libro)).libro : libro;
  }

  optimizarImagenes(activo: boolean) {
    if (activo) this.libro.optimizarImagenes = true;
    else delete this.libro.optimizarImagenes;
    this.marcar();
  }

  /** Gira o recorta una imagen del libro. Antes guarda una versión para poder volver a la original. */
  async editarImagen(id: string, op: { girar?: number; recorte?: { x: number; y: number; ancho: number; alto: number } }) {
    const r = this.recurso(id);
    let nuevo: Recurso;
    try {
      if (op.girar !== undefined) {
        if (![90, 180, 270].includes(op.girar)) throw new ErrorUsuario('Solo se puede girar 90, 180 o 270 grados.');
        nuevo = await girar(r, op.girar as 90 | 180 | 270);
      } else if (op.recorte) {
        const c = op.recorte;
        nuevo = await recortar(r, Number(c.x), Number(c.y), Number(c.ancho), Number(c.alto));
      } else throw new ErrorUsuario('Indica cómo girar o recortar la imagen.');
    } catch (e) {
      if (e instanceof ErrorImagen) throw new ErrorUsuario(e.message);
      throw e;
    }
    this.conVersion(() => crearVersion(this.libro, op.girar !== undefined ? `Antes de girar «${r.nombre}»` : `Antes de recortar «${r.nombre}»`));
    // El nombre puede cambiar (GIF → PNG): se actualizan las citas en bloques XHTML.
    if (nuevo.nombre !== r.nombre) {
      for (const s of this.libro.secciones) for (const b of s.bloques) if (b.tipo === 'crudo') b.xhtml = b.xhtml.split(`img/${r.nombre}`).join(`img/${nuevo.nombre}`);
    }
    Object.assign(r, nuevo);
    this.marcar();
  }

  async exportar(): Promise<{ nombre: string; datos: Uint8Array }> {
    const datos = await compilar(await this.libroEpub());
    const r = await validarDatos(datos);
    this.ultimaValidacion = r;
    if (!r.valido) throw new ErrorUsuario('El EPUB tiene errores. Corrígelos antes de exportar.', 409, r);
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + '.epub', datos };
  }

  impresion(cambios: Partial<Impresion>) {
    const actual = ajustesImpresion(this.libro);
    const nuevo = { ...actual, ...cambios };
    const tam = TAMANOS_IMPRESION.find((t) => t.id === nuevo.tamano);
    if (cambios.tamano && tam) {
      nuevo.ancho = tam.ancho;
      nuevo.alto = tam.alto;
    }
    if (cambios.ancho !== undefined || cambios.alto !== undefined) {
      const coincide = TAMANOS_IMPRESION.find((t) => Math.abs(t.ancho - nuevo.ancho) < 0.1 && Math.abs(t.alto - nuevo.alto) < 0.1);
      nuevo.tamano = coincide?.id ?? 'libre';
    }
    if (nuevo.ancho < 76 || nuevo.alto < 101 || nuevo.ancho > 216 || nuevo.alto > 297) {
      throw new ErrorUsuario('Tamaño fuera de lo que admiten las imprentas (entre 7,6 × 10,1 cm y 21,6 × 29,7 cm).');
    }
    this.libro.impresion = nuevo;
    this.marcar();
  }

  revisionImpresion(): AvisoImpresion[] {
    return revisarImpresion(this.libro, this.ultimasPaginas, this.ultimasPaginasColor);
  }

  /** Archivos de impresión de una versión ya preparada (los pide el visor). */
  async paqueteImpresion(version: string): Promise<Map<string, string | Uint8Array>> {
    return this.paquetes.get(version) ?? new Map();
  }

  private async prepararVersion(interior: number, digital: boolean): Promise<string> {
    const v = String(++this.contadorImpresion);
    this.paquetes.set(v, archivosImpresion(await libroParaImprimir(this.libro), { interior, digital }));
    // Solo se guardan las últimas versiones.
    for (const k of [...this.paquetes.keys()]) if (Number(k) < this.contadorImpresion - 4) this.paquetes.delete(k);
    return urlVisor(this.base, this.clave, Number(v));
  }

  /** URL del visor para la vista previa de impresión. */
  async vistaImpresion(): Promise<string> {
    const a = ajustesImpresion(this.libro);
    const interior = a.margenInterior > 0 ? a.margenInterior : margenInteriorAutomatico(this.ultimasPaginas ?? 200);
    return (await this.prepararVersion(interior, false)).replace('spread=false', 'spread=auto');
  }

  async exportarPdf(tipo: TipoPdf): Promise<{ nombre: string; datos: Uint8Array; paginas: number; avisos: AvisoImpresion[] }> {
    const errores = revisarImpresion(this.libro, this.ultimasPaginas).filter((a) => a.gravedad === 'error' && !a.seccion);
    if (errores.length) throw new ErrorUsuario(`No se puede crear el PDF: ${errores.map((e) => e.mensaje).join(' ')}`);
    let r;
    try {
      r = await generarPdf(this.libro, tipo, (interior) => this.prepararVersion(interior, tipo === 'digital'), this.renderizador);
    } catch (e) {
      throw new ErrorUsuario(`No se pudo crear el PDF: ${(e as Error).message}`);
    }
    if (tipo === 'impresion') {
      this.ultimasPaginas = r.paginas;
      this.ultimasPaginasColor = r.paginasColor;
    }
    const sufijo = tipo === 'impresion' ? '-impresion' : '-digital';
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + sufijo + '.pdf', datos: r.datos, paginas: r.paginas, avisos: revisarImpresion(this.libro, r.paginas, this.ultimasPaginasColor) };
  }

  // ----- Control de cambios -----

  private seccionConCambios(id: string): Seccion {
    const s = this.libro.secciones.find((x) => x.id === id);
    if (!s) throw new ErrorUsuario('Sección no encontrada.', 404);
    return s;
  }

  resolverCambio(seccion: string, cambio: string, aceptar: boolean) {
    const s = this.seccionConCambios(seccion);
    try {
      if (aceptar) aceptarCambio(s, cambio);
      else rechazarCambio(s, cambio);
    } catch (e) {
      if (e instanceof ErrorCambio) throw new ErrorUsuario(e.message);
      throw e;
    }
    this.marcar();
  }

  /** Acepta o rechaza todos los cambios (de una sección o del libro). Devuelve los que no se pudieron aplicar. */
  resolverTodos(aceptar: boolean, seccion?: string): string[] {
    const fallos: string[] = [];
    for (const s of seccion ? [this.seccionConCambios(seccion)] : this.libro.secciones) {
      if (!s.cambios?.length) continue;
      if (aceptar) fallos.push(...aceptarTodos(s).map((f) => `«${s.titulo}»: ${f}`));
      else delete s.cambios;
    }
    this.marcar();
    return fallos;
  }

  // ----- Versiones -----

  private conVersion<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      if (e instanceof ErrorVersion) throw new ErrorUsuario(e.message);
      throw e;
    }
  }

  crearVersion(nombre: string): ResumenVersion {
    const v = this.conVersion(() => crearVersion(this.libro, nombre));
    this.cambiado = true;
    return v;
  }

  compararVersion(id: string): DiferenciaSeccion[] {
    return this.conVersion(() => compararVersion(this.libro, id));
  }

  restaurarVersion(id: string): string[] {
    const r = this.conVersion(() => restaurarVersion(this.libro, id));
    this.libro = r.libro;
    this.marcar();
    return r.avisos;
  }

  eliminarVersion(id: string) {
    this.conVersion(() => eliminarVersion(this.libro, id));
    this.cambiado = true;
  }

  // ----- Buscar y reemplazar -----

  buscar(o: OpcionesBusqueda): { coincidencias: Coincidencia[]; total: number } {
    try {
      return buscar(this.libro, o);
    } catch (e) {
      if (e instanceof ErrorBusqueda) throw new ErrorUsuario(e.message);
      throw e;
    }
  }

  reemplazar(o: OpcionesBusqueda, reemplazo: string, solo?: { seccion: string; lugar: string; orden: number }): { n: number } {
    try {
      const r = reemplazar(this.libro, o, reemplazo, solo);
      if (r.n) this.marcar();
      return { n: r.n };
    } catch (e) {
      if (e instanceof ErrorBusqueda) throw new ErrorUsuario(e.message);
      throw e;
    }
  }

  // ----- Accesibilidad -----

  async accesibilidad(): Promise<InformeAccesibilidad> {
    try {
      this.ultimoInforme = await revisarAccesibilidad(this.libro, this.evaluador);
    } catch (e) {
      throw new ErrorUsuario(`No se pudo revisar la accesibilidad: ${(e as Error).message}`);
    }
    return this.ultimoInforme;
  }

  informeAccesibilidad(): { nombre: string; datos: Uint8Array } {
    if (!this.ultimoInforme) throw new ErrorUsuario('Primero revisa la accesibilidad.');
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + '-accesibilidad.html', datos: new TextEncoder().encode(informeHtml(this.ultimoInforme)) };
  }

  // ----- Plugins -----

  private async importadorPara(ext: string): Promise<PluginInstalado | undefined> {
    return (await this.plugins.listar()).find((p) => p.tipos.includes('importador') && p.extensiones?.includes(ext));
  }

  async listarPlugins(): Promise<PluginInstalado[]> {
    return this.plugins.listar();
  }

  /** Lee un paquete sin instalarlo, para mostrar sus permisos antes de aceptar. */
  async inspeccionarPlugin(datos: Uint8Array): Promise<Manifiesto> {
    return (await this.conPlugin(() => leerPlugin(datos))).manifiesto;
  }

  async instalarPlugin(datos: Uint8Array): Promise<PluginInstalado> {
    return this.conPlugin(() => this.plugins.instalar(datos));
  }

  async eliminarPlugin(id: string) {
    await this.conPlugin(() => this.plugins.eliminar(id));
  }

  private async conPlugin<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof ErrorPlugin) throw new ErrorUsuario(e.message);
      throw e;
    }
  }

  async revisarConPlugin(id: string): Promise<{ hallazgos: Hallazgo[]; registros: string[] }> {
    return this.conPlugin(async () => {
      const p = await this.plugins.obtener(id);
      const r = await ejecutarPlugin(p, 'revision', [libroParaPlugin(this.libro, p.manifiesto.permisos)]);
      return { hallazgos: validarHallazgos(r.resultado, this.libro), registros: r.registros };
    });
  }

  async transformarConPlugin(id: string): Promise<{ registros: string[] }> {
    return this.conPlugin(async () => {
      const p = await this.plugins.obtener(id);
      const r = await ejecutarPlugin(p, 'transformacion', [libroParaPlugin(this.libro, p.manifiesto.permisos)]);
      const nuevo = validarLibroPlugin(r.resultado, this.libro, p.manifiesto.permisos);
      const antes = this.libro;
      this.libro = nuevo;
      this.marcar();
      this.antesDePlugin = { libro: antes, plugin: p.manifiesto.nombre };
      return { registros: r.registros };
    });
  }

  // Catálogos de plugins.

  private catalogos() {
    return new ListaCatalogos(archivoCatalogos(this.plugins.carpeta));
  }

  async listarCatalogo(): Promise<{
    catalogos: string[];
    plugins: (EntradaCatalogo & { estado: 'nuevo' | 'instalado' | 'actualizable' })[];
    errores: string[];
  }> {
    const urls = await this.catalogos().leer();
    const instalados = await this.plugins.listar();
    const errores: string[] = [];
    const plugins: (EntradaCatalogo & { estado: 'nuevo' | 'instalado' | 'actualizable' })[] = [];
    for (const origen of [CATALOGO_INTEGRADO, ...urls]) {
      try {
        for (const e of await leerCatalogo(origen)) {
          if (plugins.some((x) => x.id === e.id && !versionMayor(e.version, x.version))) continue;
          const i = instalados.find((x) => x.id === e.id);
          const estado = !i ? 'nuevo' : versionMayor(e.version, i.version) ? 'actualizable' : 'instalado';
          const previo = plugins.findIndex((x) => x.id === e.id);
          if (previo >= 0) plugins.splice(previo, 1);
          plugins.push({ ...e, estado });
        }
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
    return { catalogos: urls, plugins, errores };
  }

  async agregarCatalogo(url: string) {
    return this.conPlugin(async () => {
      const u = normalizarUrlCatalogo(url);
      const entradas = await leerCatalogo(u);
      const lista = await this.catalogos().leer();
      await this.catalogos().guardar([...lista, u]);
      return entradas.length;
    });
  }

  async quitarCatalogo(url: string) {
    const lista = await this.catalogos().leer();
    await this.catalogos().guardar(lista.filter((x) => x !== url));
  }

  async instalarDesdeCatalogo(origen: string, id: string): Promise<PluginInstalado> {
    return this.conPlugin(async () => {
      const urls = await this.catalogos().leer();
      if (origen !== CATALOGO_INTEGRADO && !urls.includes(origen)) throw new ErrorPlugin('Ese catálogo no está en la lista.');
      const e = (await leerCatalogo(origen)).find((x) => x.id === id);
      if (!e) throw new ErrorPlugin('El plugin ya no está en el catálogo.');
      return this.plugins.instalar(await paqueteDeCatalogo(e));
    });
  }

  deshacerPlugin() {
    if (!this.antesDePlugin) throw new ErrorUsuario('No hay ninguna transformación que deshacer.');
    this.libro = this.antesDePlugin.libro;
    this.antesDePlugin = undefined;
    this.marcar();
  }

  async exportarConPlugin(id: string): Promise<{ nombre: string; datos: Uint8Array; tipoMime: string }> {
    return this.conPlugin(async () => {
      const p = await this.plugins.obtener(id);
      const r = await ejecutarPlugin(p, 'exportador', [libroParaPlugin(this.libro, p.manifiesto.permisos)]);
      return validarExportacion(r.resultado, p.manifiesto, nombreDeArchivo(this.libro.metadatos.titulo));
    });
  }

  escritura(valor: 'horizontal' | 'vertical') {
    if (valor === 'vertical') this.libro.escritura = 'vertical';
    else delete this.libro.escritura;
    this.marcar();
  }

  /** KEPUB para Kobo: valida igual que el EPUB y bloquea si hay errores. */
  async exportarKepub(): Promise<{ nombre: string; datos: Uint8Array }> {
    const datos = await compilarKepub(await this.libroEpub());
    const r = await validarDatos(datos);
    if (!r.valido) throw new ErrorUsuario('El KEPUB tiene errores. Corrígelos antes de exportar (pestaña Validación).', 409, r);
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + '.kepub.epub', datos };
  }

  // ----- Tiendas -----

  private idTienda(id: string): IdTienda {
    if (!TIENDAS.some((t) => t.id === id)) throw new ErrorUsuario('Tienda desconocida.', 404);
    return id as IdTienda;
  }

  async revisarTienda(id: string): Promise<AvisoTienda[]> {
    return revisarTienda(this.libro, this.idTienda(id));
  }

  /** EPUB ajustado a la tienda; se valida con EPUBCheck antes de entregarlo. */
  async exportarTienda(id: string): Promise<{ nombre: string; datos: Uint8Array }> {
    const t = this.idTienda(id);
    const { datos } = await compilarParaTienda(this.libro, t);
    const r = await validarDatos(datos);
    if (!r.valido) throw new ErrorUsuario('El EPUB tiene errores. Corrígelos antes de exportar (pestaña Validación).', 409, r);
    return { nombre: `${nombreDeArchivo(this.libro.metadatos.titulo)}-${t}.epub`, datos };
  }

  /** Imagen de portada original, para subirla aparte a la tienda. */
  portadaOriginal(): { nombre: string; datos: Uint8Array; tipoMime: string } {
    const r = this.libro.recursos.find((x) => x.id === this.libro.metadatos.portada);
    if (!r) throw new ErrorUsuario('El libro no tiene portada.');
    return { nombre: `${nombreDeArchivo(this.libro.metadatos.titulo)}-portada.${r.nombre.split('.').pop()}`, datos: r.datos, tipoMime: r.tipoMime };
  }

  // ----- Muestra gratuita -----

  private opcionesMuestra(op: OpcionesMuestra): OpcionesMuestra {
    const ids = new Set(this.libro.secciones.map((s) => s.id));
    const secciones = (Array.isArray(op.secciones) ? op.secciones : []).filter((x) => typeof x === 'string' && ids.has(x));
    if (!secciones.length) throw new ErrorUsuario('Elige al menos una sección para la muestra.');
    return { secciones, enlace: typeof op.enlace === 'string' ? op.enlace : undefined };
  }

  /** EPUB de muestra, validado con EPUBCheck. */
  async exportarMuestra(op: OpcionesMuestra): Promise<{ nombre: string; datos: Uint8Array }> {
    let libro: Libro;
    try {
      libro = libroMuestra(this.libro, this.opcionesMuestra(op));
    } catch (e) {
      throw e instanceof ErrorUsuario ? e : new ErrorUsuario((e as Error).message);
    }
    const datos = await compilar(await this.libroEpub(libro));
    const r = await validarDatos(datos);
    if (!r.valido) throw new ErrorUsuario('El EPUB tiene errores. Corrígelos antes de exportar (pestaña Validación).', 409, r);
    return { nombre: `${nombreDeArchivo(this.libro.metadatos.titulo)}-muestra.epub`, datos };
  }

  /** Página web de una sola pieza con la muestra. */
  sitioMuestra(op: OpcionesMuestra): { nombre: string; datos: Uint8Array } {
    let html: string;
    try {
      html = crearSitioMuestra(this.libro, this.opcionesMuestra(op));
    } catch (e) {
      throw e instanceof ErrorUsuario ? e : new ErrorUsuario((e as Error).message);
    }
    return { nombre: `${nombreDeArchivo(this.libro.metadatos.titulo)}-muestra.html`, datos: new TextEncoder().encode(html) };
  }

  async exportarWord(): Promise<{ nombre: string; datos: Uint8Array }> {
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + '-correccion.docx', datos: await exportarWord(this.libro) };
  }

  async importarCorrecciones(nombre: string, datos: Uint8Array, revisar = false): Promise<ResumenCorrecciones> {
    if (!nombre.toLowerCase().endsWith('.docx')) throw new ErrorUsuario('Las correcciones se importan desde un archivo .docx.');
    let r: ResumenCorrecciones;
    // Versión automática para poder volver atrás si las correcciones no convencen.
    crearVersion(this.libro, `Antes de importar «${nombre}»`);
    try {
      r = await importarCorrecciones(this.libro, datos, { revisar });
    } catch (e) {
      throw new ErrorUsuario(`No se pudo leer el Word: ${(e as Error).message}`);
    }
    if (r.actualizadas.length || r.nuevas.length || r.comentarios) this.marcar();
    return r;
  }

  async proyecto(): Promise<{ nombre: string; datos: Uint8Array }> {
    const datos = await serializarProyecto(this.libro);
    this.cambiado = false;
    return { nombre: this.nombreArchivo, datos };
  }
}

export function nombreDeArchivo(titulo: string): string {
  return (
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'libro'
  );
}
