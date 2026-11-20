// Operaciones de la app sobre el libro abierto. La interfaz solo habla con esto.

import JSZip from 'jszip';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Impresion, Libro, Metadatos, Recurso, Seccion, Tema, TipoSeccion, Tipografia } from '../src/model.js';
import { ajustesImpresion, TAMANOS_IMPRESION, temaCompleto, validarTema } from '../src/model.js';
import { TEMAS } from '../src/temas.js';
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
  ultimasPaginas?: number;
  private paquetes = new Map<string, Map<string, string | Uint8Array>>();
  private contadorImpresion = 0;

  constructor(private carpetaRecuperacion = join(homedir(), '.obi-studio')) {}

  estado(): Estado {
    const recursos = this.libro.recursos.map(({ datos, ...r }) => ({ ...r, bytes: datos.length }));
    const palabras: Record<string, number> = {};
    for (const s of this.libro.secciones) palabras[s.id] = contarPalabras(s);
    return { libro: { ...this.libro, recursos }, nombreArchivo: this.nombreArchivo, cambiado: this.cambiado, palabras, avisos: this.avisos };
  }

  private marcar() {
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
      } else if (ext === 'doc' || ext === 'rtf') {
        throw new ErrorUsuario('Abre el archivo en Word o LibreOffice y guárdalo como .docx para importarlo.');
      } else throw new ErrorUsuario('Formato no admitido. Usa .epub, .docx u .obi.');
    } catch (e) {
      if (e instanceof ErrorUsuario) throw e;
      throw new ErrorUsuario(`No se pudo abrir el archivo: ${(e as Error).message}`);
    }
    this.libro = libro;
    this.avisos = avisos;
    this.nombreArchivo = ext === 'obi' ? nombre : nombreDeArchivo(libro.metadatos.titulo || nombre.replace(/\.[^.]+$/, '')) + '.obi';
    this.cambiado = ext !== 'obi';
    this.ultimaValidacion = undefined;
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
    for (const k of ['imagenCabecera', 'doblePagina'] as const) if ((s as unknown as Record<string, unknown>)[k] === null || s[k] === undefined) delete s[k];
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
  async exportar(): Promise<{ nombre: string; datos: Uint8Array }> {
    const datos = await compilar(this.libro);
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
    return revisarImpresion(this.libro, this.ultimasPaginas);
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
    if (tipo === 'impresion') this.ultimasPaginas = r.paginas;
    const sufijo = tipo === 'impresion' ? '-impresion' : '-digital';
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + sufijo + '.pdf', datos: r.datos, paginas: r.paginas, avisos: revisarImpresion(this.libro, r.paginas) };
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
