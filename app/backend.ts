// Operaciones de la app sobre el libro abierto. La interfaz solo habla con esto.

import JSZip from 'jszip';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Bloque, CaraFuentePropia, Comentario, Credito, Cubierta, FuentePropia, Imagen, Impresion, Inline, Libro, Nota, Metadatos, Recurso, Seccion, Tema, TipoSeccion, Tipografia } from '../src/model.js';
import { ajustesImpresion, TAMANOS_IMPRESION, temaCompleto, validarTema } from '../src/model.js';
import { TEMAS } from '../src/temas.js';
import { libroMuestra, sitioMuestra as crearSitioMuestra, type OpcionesMuestra } from '../src/muestra.js';
import { TIENDAS, compilarParaTienda, revisarTienda, type AvisoTienda, type IdTienda } from '../src/tiendas.js';
import { buscarGhostscript } from '../src/pdfx.js';
import { ErrorFuente, PREFIJO, leerFuentePropia, permisoFuente, type PermisoFuente } from '../src/fuentes-propias.js';
import { buscarFuentesSistema, type FamiliaSistema } from '../src/fuentes-sistema.js';
import { ErrorImagen, girar, libroConImagenesOptimizadas, recortar, reducir, sePuedeProcesar } from '../src/procesar-imagen.js';
import { esVertical } from '../src/model.js';
import { revisarCss, type ProblemaCss } from '../src/css-propio.js';
import { aplicarDisenoDocx, asignadorEstilos, detectorSaltos, disenoDeDocx, disenoDeEpub, pareceSeparador, type DisenoOriginal } from '../src/diseno-original.js';
import { PAPELES_KDP, archivosCubierta, cubiertaCompleta, medidasCubierta, posprocesarCubierta, revisarCubierta, type AvisoCubierta, type MedidasCubierta } from '../src/cubierta.js';
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
import { libroNuevo, nuevaSeccion, nuevoId, contarPalabras, inlinesBloque, parrafo, textoPlano } from '../src/model.js';
import { compilar, compilarArchivos, archivoSeccion, rutaImagen, cssLibro, CONTAINER } from '../src/compilar.js';
import { importarEpub } from '../src/formatos/epub.js';
import { importarDocx } from '../src/formatos/docx.js';
import { epubDeOtroFormato, esFormatoOtro } from '../src/formatos/otros.js';
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

/** Qué conservar del original en la conversión sencilla. */
export interface OpcionesConversionSencilla {
  parrafos: boolean;
  espacioParrafos: boolean;
  espacioPorParrafo: boolean;
  lineasEnBlanco: boolean;
  espacioTitulos: boolean;
  espaciadoLetras: boolean;
  titulos: boolean;
  /** Otros tipos de párrafo del original (citas, cartas…) como estilos propios del libro. */
  estilosParrafo: boolean;
  /** Tamaño, color y fondo de fragmentos que vienen de las clases CSS. */
  aspectos: boolean;
  /** Separador de escena del original (ornamento o imagen). */
  separadores: boolean;
  /** Letra capitular y primera línea destacada del original. */
  capitular: boolean;
  fuentesArchivo: boolean;
  fuentesSistema: boolean;
  optimizarImagenes: boolean;
  /** Limpieza tipográfica (cambia el texto del original, por eso viene desactivada). */
  raya: boolean;
  comillas: boolean;
  suspensivos: boolean;
  espaciosSignos: boolean;
}

export const OPCIONES_CONVERSION: OpcionesConversionSencilla = {
  parrafos: true,
  espacioParrafos: true,
  espacioPorParrafo: true,
  lineasEnBlanco: true,
  espacioTitulos: true,
  espaciadoLetras: true,
  titulos: true,
  estilosParrafo: true,
  aspectos: true,
  separadores: true,
  capitular: true,
  fuentesArchivo: true,
  fuentesSistema: true,
  optimizarImagenes: false,
  raya: false,
  comillas: false,
  suspensivos: false,
  espaciosSignos: false,
};

/** Casos que la limpieza tipográfica corregiría en el original. */
export interface TipografiaOriginal {
  /** Párrafos de diálogo que empiezan con guion en lugar de raya. */
  guiones: number;
  comillasRectas: number;
  tresPuntos: number;
  /** Espacios dobles y espacios antes de un signo de puntuación. */
  espacios: number;
}

/** Imagen del libro con su descripción, para revisarla (opcionalmente) en el asistente. */
export interface ImagenConversion {
  nombre: string;
  alt: string;
  decorativa: boolean;
  /** Miniatura como data: URL. */
  miniatura?: string;
}

/** Descripción elegida en el asistente para cada imagen (por nombre de archivo). */
export type DescripcionesConversion = Record<string, { alt: string; decorativa?: boolean }>;

/** Cuenta lo que corregiría la limpieza tipográfica. */
export function tipografiaOriginal(libro: Libro): TipografiaOriginal {
  const r: TipografiaOriginal = { guiones: 0, comillasRectas: 0, tresPuntos: 0, espacios: 0 };
  const ver = (l: Inline[]) => {
    const t = l.map((i) => (i.tipo === 'texto' ? i.texto : ' ')).join('');
    if (/^\s*[-–]\s?\S/.test(t)) r.guiones++;
    r.comillasRectas += (t.match(/"/g) ?? []).length;
    r.tresPuntos += (t.match(/\.{3}/g) ?? []).length;
    r.espacios += (t.match(/\S {2,}\S| +[,.;:!?…»)\]]/g) ?? []).length;
  };
  for (const s of libro.secciones) {
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
      if (b.tipo === 'lista') b.elementos.forEach(ver);
      if (b.tipo === 'recuadro') b.lineas.forEach((x) => ver(x.contenido));
    }
    s.notas.forEach((n) => ver(n.contenido));
  }
  return r;
}

export interface AnalisisConversion {
  nombre: string;
  tipo: 'epub' | 'docx' | 'odt' | 'html' | 'htm' | 'xhtml' | 'md' | 'markdown' | 'txt';
  titulo: string;
  diseno?: Omit<DisenoOriginal, 'fuentes'>;
  fuentesArchivo: { familia: string; archivo: string; permiso: PermisoFuente }[];
  /** Letras que usa el original y de dónde saldrían. */
  letras: { familia: string; origen: 'archivo' | 'sistema' | 'falta' }[];
  secciones: number;
  ilustraciones: number;
  imagenes: number;
  notas: number;
  /** Serie del libro (para recordar las opciones elegidas en sus otros volúmenes). */
  serie?: string;
  /** Metadatos del original, para revisarlos en el asistente. */
  metadatos: DatosLibroConversion;
  /** Portada del original como data: URL (si no es enorme). */
  portada?: string;
  tipografia: TipografiaOriginal;
  /** Imágenes interiores con su descripción actual. */
  listaImagenes: ImagenConversion[];
}

/** Metadatos que se pueden revisar en el asistente (todo menos la portada, que va aparte). */
export type DatosLibroConversion = Omit<Metadatos, 'portada' | 'resumenAccesibilidad'>;

/** Dónde empieza cada capítulo en la conversión sencilla. */
export type CorteCapitulos = 'h1' | 'h2' | 'saltos';

/** Cambios en la lista de capítulos hechos en el asistente (por posición en la lista convertida). */
export interface CambioCapitulo {
  indice: number;
  titulo?: string;
  tituloIndice?: string;
  enIndice?: boolean;
  unirConSiguiente?: boolean;
}

export interface CapitulosConversion {
  cortar: CorteCapitulos;
  /** Número de secciones que vio el asistente (si no coincide, los cambios no se aplican). */
  total?: number;
  cambios?: CambioCapitulo[];
  profundidad?: 1 | 2;
  paginaIndice?: boolean;
}

/** Sección tal como saldría de la conversión, para revisarla en el asistente. */
export interface CapituloVista {
  indice: number;
  tipo: TipoSeccion;
  titulo: string;
  enIndice: boolean;
  palabras: number;
  inicio: string;
  subtitulos: number;
}

/** Volumen de una conversión por lotes. */
export interface VolumenLote {
  nombre: string;
  volumen?: number;
}

/** Datos comunes de la serie para la conversión por lotes. */
export interface DatosLote {
  serie?: string;
  editorial?: string;
  derechos?: string;
  idioma?: string;
  creditos?: Credito[];
  /** Volumen de cada archivo, en el orden en que se subieron. */
  volumenes?: (number | undefined)[];
  tienda?: string;
  cortar?: CorteCapitulos;
  profundidad?: 1 | 2;
  paginaIndice?: boolean;
}

export interface ResultadoLote {
  nombre: string;
  titulo: string;
  archivo?: string;
  ok: boolean;
  avisos: string[];
  errores: string[];
}

/** Volumen que sugiere el nombre del archivo («Vol. 3», «v03», «Tomo 2», «… 05.epub»). */
export function volumenDeNombre(nombre: string): number | undefined {
  const base = nombre.replace(/\.[^.]+$/, '');
  const m = base.match(/(?:vol(?:umen|ume)?|tomo|v|libro|book)[\s._-]*(\d{1,3}(?:[.,]5)?)/i) ?? base.match(/(?:^|[\s._-])(\d{1,3})(?:[\s._-]*$)/);
  return m ? Number(m[1].replace(',', '.')) : undefined;
}

/** Nueva portada elegida en el asistente. */
export interface PortadaConversion {
  nombre: string;
  /** Imagen en base64. */
  datos: string;
}

const CAMPOS_TEXTO: (keyof DatosLibroConversion)[] = ['titulo', 'subtitulo', 'idioma', 'identificador', 'fecha', 'editorial', 'descripcion', 'serie', 'derechos'];
const LARGO_MAXIMO: Partial<Record<keyof DatosLibroConversion, number>> = { descripcion: 4000, derechos: 2000 };

/** Limpia los metadatos que llegan del asistente: solo campos conocidos, textos acotados y roles válidos. */
export function metadatosValidos(x: unknown): Partial<DatosLibroConversion> {
  if (!x || typeof x !== 'object') return {};
  const o = x as Record<string, unknown>;
  const r: Partial<DatosLibroConversion> = {};
  for (const k of CAMPOS_TEXTO) {
    if (!(k in o)) continue;
    const v = typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, LARGO_MAXIMO[k] ?? 300) : '';
    (r as Record<string, unknown>)[k] = v;
  }
  if (r.fecha && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(r.fecha)) r.fecha = '';
  if (r.idioma !== undefined && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.idioma)) delete r.idioma;
  if (r.identificador !== undefined && !r.identificador) delete r.identificador;
  if ('volumen' in o) {
    const n = Number(o.volumen);
    (r as Record<string, unknown>).volumen = o.volumen === '' || o.volumen === null || !Number.isFinite(n) || n <= 0 ? '' : Math.min(9999, Math.round(n * 10) / 10);
  }
  if (Array.isArray(o.creditos)) {
    const roles = new Set(['aut', 'ill', 'trl', 'edt']);
    r.creditos = o.creditos
      .filter((c): c is { nombre: string; rol: string } => !!c && typeof c === 'object' && typeof (c as { nombre?: unknown }).nombre === 'string' && roles.has((c as { rol?: string }).rol ?? ''))
      .map((c) => ({ nombre: c.nombre.trim().slice(0, 200), rol: c.rol as Credito['rol'] }))
      .filter((c) => c.nombre)
      .slice(0, 30);
  }
  return r;
}

export interface ResumenConversion {
  estado: Estado;
  capitulos: number;
  ilustraciones: number;
  imagenes: number;
  notas: number;
  /** Lo que se conservó del diseño original. */
  conservado: string[];
  /** Lo que se corrigió (tipografía, descripciones). */
  corregido: string[];
  avisos: string[];
}

/** Fuente propia sin los datos binarios (lo que ve la interfaz). */
export interface FuentePublica extends Omit<FuentePropia, 'caras'> {
  caras: (Omit<CaraFuentePropia, 'datos'> & { bytes: number })[];
}

export interface Estado {
  libro: Omit<Libro, 'recursos' | 'fuentesPropias'> & { recursos: RecursoPublico[]; fuentesPropias?: FuentePublica[] };
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
    const { versiones: _v, recursosVersiones: _rv, fuentesPropias, ...libro } = this.libro;
    const propias = fuentesPropias?.map((f) => ({ ...f, caras: f.caras.map(({ datos, ...c }) => ({ ...c, bytes: datos.length })) }));
    return {
      libro: { ...libro, recursos, ...(propias ? { fuentesPropias: propias } : {}) },
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
      } else if (esFormatoOtro(ext)) {
        // Un plugin instalado para ese formato tiene preferencia (arriba).
        const o = await epubDeOtroFormato(nombre, datos);
        const r = await importarEpub(o.epub);
        libro = r.libro;
        avisos = [...o.avisos, ...r.avisos.map((a) => a.mensaje)];
      } else if (ext === 'doc' || ext === 'rtf') {
        throw new ErrorUsuario('Abre el archivo en Word o LibreOffice y guárdalo como .docx para importarlo.');
      } else throw new ErrorUsuario('Formato no admitido. Usa .epub, .docx, .odt, .html, .md, .txt u .obi, o instala un plugin que lo importe.');
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
    const validos = validarTema(cambios, (this.libro.fuentesPropias ?? []).map((f) => PREFIJO + f.id));
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
    if ('tituloIndice' in (cambios as object)) {
      const v = typeof s.tituloIndice === 'string' ? s.tituloIndice.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      if (v && v !== s.titulo) s.tituloIndice = v;
      else delete s.tituloIndice;
    }
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
  // ----- Fuentes propias -----

  private sistema?: Promise<FamiliaSistema[]>;

  /** Fuentes instaladas en el sistema (se buscan una vez por sesión). */
  async fuentesSistema(): Promise<FamiliaSistema[]> {
    this.sistema ??= buscarFuentesSistema();
    return this.sistema;
  }

  private agregarCara(datos: Uint8Array, origen: string, familiaEsperada?: string): { familia: string; permiso: PermisoFuente } {
    let info;
    try {
      info = leerFuentePropia(datos);
    } catch (e) {
      throw e instanceof ErrorFuente ? new ErrorUsuario(e.message) : e;
    }
    const permiso = permisoFuente(info.fsType);
    if (!permiso.incrustable) {
      throw new ErrorUsuario(
        permiso.tipo === 'mapa-de-bits'
          ? `La licencia de «${info.nombreCompleto}» solo permite incrustarla como mapa de bits: no sirve para un libro.`
          : `La licencia de «${info.nombreCompleto}» no permite incrustarla en documentos.`,
      );
    }
    const familia = familiaEsperada ?? info.familia;
    const lista = (this.libro.fuentesPropias ??= []);
    let f = lista.find((x) => x.familia === familia);
    if (!f) {
      f = { id: nuevoId('fp'), familia, generica: /sans|gothic|grotesk|helvetica|arial/i.test(familia) ? 'sans-serif' : 'serif', caras: [] };
      lista.push(f);
    }
    const cara: CaraFuentePropia = { peso: info.peso, estilo: info.estilo, formato: info.formato, fsType: info.fsType, origen, datos };
    const i = f.caras.findIndex((c) => c.peso === cara.peso && c.estilo === cara.estilo);
    if (i >= 0) f.caras[i] = cara;
    else f.caras.push(cara);
    f.caras.sort((a, b) => a.peso - b.peso || (a.estilo === b.estilo ? 0 : a.estilo === 'normal' ? -1 : 1));
    return { familia, permiso };
  }

  /** Añade una cara desde un archivo .ttf u .otf que sube el usuario. */
  anadirFuente(nombre: string, datos: Uint8Array): { familia: string; permiso: PermisoFuente } {
    if (datos.length > 30 * 1024 * 1024) throw new ErrorUsuario('La fuente pesa demasiado (más de 30 MB).');
    const r = this.agregarCara(datos, nombre.replace(/[/\\]/g, '').slice(0, 120));
    this.marcar();
    return r;
  }

  /** Añade una familia instalada en el sistema (todas sus caras, como mucho 8). */
  async anadirFuenteSistema(familia: string): Promise<{ familia: string; permiso: PermisoFuente }> {
    const f = (await this.fuentesSistema()).find((x) => x.familia === familia);
    if (!f) throw new ErrorUsuario('Esa fuente no está instalada.', 404);
    const caras = f.caras.filter((c) => c.permiso.incrustable);
    if (!caras.length) throw new ErrorUsuario(`La licencia de «${familia}» no permite incrustarla en documentos.`);
    let r: { familia: string; permiso: PermisoFuente } | undefined;
    for (const c of caras.slice(0, 8)) r = this.agregarCara(new Uint8Array(await readFile(c.ruta)), basename(c.ruta), familia);
    this.marcar();
    return r!;
  }

  ofuscarFuente(id: string, ofuscar: boolean) {
    const f = (this.libro.fuentesPropias ?? []).find((x) => x.id === id);
    if (!f) throw new ErrorUsuario('Esa fuente no existe.', 404);
    if (ofuscar) f.ofuscar = true;
    else delete f.ofuscar;
    this.marcar();
  }

  /** Guarda el CSS propio si no tiene problemas; devuelve los problemas. */
  cssPropio(css: string): ProblemaCss[] {
    const texto = String(css ?? '');
    const problemas = revisarCss(texto, this.libro);
    if (problemas.length) return problemas;
    if (texto.trim()) this.libro.cssPropio = texto;
    else delete this.libro.cssPropio;
    this.marcar();
    return [];
  }

  // ----- Conversión sencilla -----

  private conversionPendiente?: { nombre: string; datos: Uint8Array; diseno?: DisenoOriginal; original: string };

  private async leerDiseno(nombre: string, datos: Uint8Array): Promise<DisenoOriginal | undefined> {
    const ext = nombre.toLowerCase().split('.').pop();
    try {
      if (ext === 'epub') return await disenoDeEpub(datos);
      if (ext === 'docx') return await disenoDeDocx(datos);
    } catch {
      /* sin diseño legible: se ofrece convertir con el tema predeterminado */
    }
    return undefined;
  }

  /** Primer paso de la conversión sencilla: qué trae el archivo y qué se puede conservar. No cambia el libro abierto. */
  async analizarConversion(nombreOriginal: string, datosOriginales: Uint8Array): Promise<AnalisisConversion> {
    let nombre = nombreOriginal;
    let datos = datosOriginales;
    const extOriginal = nombre.toLowerCase().split('.').pop();
    const avisosPrevios: string[] = [];
    // HTML, Markdown, texto y OpenDocument pasan antes a un EPUB con su HTML y su CSS.
    if (esFormatoOtro(extOriginal)) {
      try {
        const o = await epubDeOtroFormato(nombre, datos);
        datos = o.epub;
        avisosPrevios.push(...o.avisos);
        nombre = nombre.replace(/\.[^.]+$/, '') + '.epub';
      } catch (e) {
        throw new ErrorUsuario(`No se pudo abrir el archivo: ${(e as Error).message}`);
      }
    }
    const ext = nombre.toLowerCase().split('.').pop();
    if (ext !== 'epub' && ext !== 'docx') throw new ErrorUsuario('La conversión sencilla admite archivos .epub, .docx, .odt, .html, .md y .txt.');
    let libro: Libro;
    try {
      libro = (ext === 'epub' ? await importarEpub(datos) : await importarDocx(datos)).libro;
    } catch (e) {
      throw new ErrorUsuario(`No se pudo abrir el archivo: ${(e as Error).message}`);
    }
    const diseno = await this.leerDiseno(nombre, datos);
    if (diseno) diseno.avisos.unshift(...avisosPrevios);
    this.conversionPendiente = { nombre, datos, diseno, original: nombreOriginal };
    const fuentesArchivo = (diseno?.fuentes ?? []).map((f) => {
      try {
        const info = leerFuentePropia(f.datos);
        return { familia: f.familia || info.familia, archivo: f.nombre, permiso: permisoFuente(info.fsType) };
      } catch {
        return { familia: f.familia, archivo: f.nombre, permiso: { incrustable: false, subconjunto: false, tipo: 'restringida' as const } };
      }
    });
    const familias = [...new Set([diseno?.familiaTexto, diseno?.familiaTitulos, ...(diseno?.estilos ?? []).map((e) => e.familia)].filter((x): x is string => !!x))];
    const sistema = await this.fuentesSistema().catch(() => [] as FamiliaSistema[]);
    const letras = familias.map((familia) => {
      const igual = (x: string) => x.toLowerCase() === familia.toLowerCase();
      const archivo = fuentesArchivo.find((f) => igual(f.familia) && f.permiso.incrustable);
      const instalada = sistema.find((f) => igual(f.familia) && f.caras.some((c) => c.permiso.incrustable));
      return { familia, origen: archivo ? ('archivo' as const) : instalada ? ('sistema' as const) : ('falta' as const) };
    });
    const { fuentes: _f, css: _c, ...resto } = diseno ?? { fuentes: [] };
    const portada = libro.recursos.find((x) => x.id === libro.metadatos.portada);
    return {
      nombre: nombreOriginal,
      tipo: esFormatoOtro(extOriginal) ? (extOriginal as AnalisisConversion['tipo']) : ext,
      diseno: diseno ? (resto as Omit<DisenoOriginal, 'fuentes'>) : undefined,
      fuentesArchivo,
      letras,
      secciones: libro.secciones.filter((x) => !['portada', 'ilustracion', 'indice'].includes(x.tipo)).length,
      ilustraciones: libro.secciones.filter((x) => x.tipo === 'ilustracion').length,
      imagenes: libro.recursos.length,
      notas: libro.secciones.reduce((n, x) => n + x.notas.length, 0),
      titulo: libro.metadatos.titulo,
      ...(libro.metadatos.serie ? { serie: libro.metadatos.serie } : {}),
      metadatos: (({ portada: _p, resumenAccesibilidad: _r, ...m }) => m)(libro.metadatos),
      ...(portada && portada.datos.length <= 4_000_000 ? { portada: `data:${portada.tipoMime};base64,${Buffer.from(portada.datos).toString('base64')}` } : {}),
      tipografia: tipografiaOriginal(libro),
      listaImagenes: await this.imagenesParaDescribir(libro),
    };
  }

  /** Imágenes interiores (no la portada) con su descripción y una miniatura, para el asistente. */
  private async imagenesParaDescribir(libro: Libro): Promise<ImagenConversion[]> {
    const vistas = new Map<string, ImagenConversion>();
    for (const s of libro.secciones) {
      if (s.tipo === 'portada') continue;
      for (const b of s.bloques) {
        if (b.tipo !== 'imagen' || b.recurso === libro.metadatos.portada) continue;
        const r = libro.recursos.find((x) => x.id === b.recurso);
        if (!r || vistas.has(r.nombre) || vistas.size >= 300) continue;
        let miniatura: string | undefined;
        try {
          const m = sePuedeProcesar(r.tipoMime) ? await reducir(r, { maxLado: 160 }) : r.datos.length < 200_000 ? r : undefined;
          if (m) miniatura = `data:${m.tipoMime};base64,${Buffer.from(m.datos).toString('base64')}`;
        } catch {
          /* sin miniatura */
        }
        vistas.set(r.nombre, { nombre: r.nombre, alt: b.alt, decorativa: !!b.decorativa, ...(miniatura ? { miniatura } : {}) });
      }
    }
    return [...vistas.values()];
  }

  /**
   * Vista previa de la conversión con estas opciones, sin cambiar el libro abierto: un capítulo del original
   * (si es un EPUB) y el mismo capítulo convertido, como páginas servidas en /muestra/.
   */
  async vistaPreviaConversion(o: Partial<OpcionesConversionSencilla> & { capitulos?: CapitulosConversion } = {}): Promise<{ original?: string; convertido: string }> {
    const p = this.conversionPendiente;
    if (!p) throw new ErrorUsuario('Elige primero el archivo que quieres convertir.');
    const otro = new Backend(this.carpetaRecuperacion);
    otro.sistema = this.sistema;
    otro.conversionPendiente = { ...p };
    await otro.conversionSencilla(o);
    clearTimeout(otro.temporizador);
    const libro = otro.libro;
    const conTexto = (s: Seccion) => s.bloques.filter((b) => b.tipo === 'parrafo' && b.contenido.length).length;
    const cap = libro.secciones.find((s) => s.tipo === 'capitulo' && conTexto(s) >= 3) ?? [...libro.secciones].sort((a, b) => conTexto(b) - conTexto(a))[0];
    const v = Date.now();
    this.muestras.clear();
    this.muestras.set(String(v + 1), compilarArchivos(libro));
    const convertido = `/muestra/${v + 1}/${archivoSeccion(cap)}`;
    if (!p.nombre.toLowerCase().endsWith('.epub')) return { convertido };
    // Original: el documento del capítulo (el que contiene su título o, si no, el que tiene más párrafos).
    const zip = await JSZip.loadAsync(p.datos);
    const archivos = new Map<string, Uint8Array>();
    for (const [ruta, f] of Object.entries(zip.files)) if (!f.dir) archivos.set(ruta, await f.async('uint8array'));
    const docs = [...archivos.keys()].filter((r) => /\.x?html?$/i.test(r));
    const textoDe = (r: string) => new TextDecoder().decode(archivos.get(r));
    const titulo = cap.titulo.trim();
    const sinEtiquetas = (r: string) => textoDe(r).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const elegido =
      (titulo && docs.find((r) => !/<nav\b/.test(textoDe(r)) && sinEtiquetas(r).includes(titulo))) ||
      docs.filter((r) => !/<nav\b/.test(textoDe(r))).sort((a, b) => (textoDe(b).match(/<p\b/g)?.length ?? 0) - (textoDe(a).match(/<p\b/g)?.length ?? 0))[0];
    if (!elegido) return { convertido };
    this.muestras.set(String(v), archivos as Map<string, string | Uint8Array>);
    return { original: `/muestra/${v}/${elegido.split('/').map(encodeURIComponent).join('/')}`, convertido };
  }

  /**
   * Segundo paso: abre el archivo analizado y conserva del original lo que se haya elegido
   * (párrafos, espaciado, líneas en blanco, títulos, fuentes e imágenes).
   */
  async conversionSencilla(
    entrada: Partial<OpcionesConversionSencilla> & { metadatos?: unknown; portada?: PortadaConversion; capitulos?: CapitulosConversion; descripciones?: DescripcionesConversion } = {},
  ): Promise<ResumenConversion> {
    const p = this.conversionPendiente;
    if (!p) throw new ErrorUsuario('Elige primero el archivo que quieres convertir.');
    const { metadatos: metadatosNuevos, portada: portadaNueva, capitulos, descripciones, ...o } = entrada;
    const cortar: CorteCapitulos = capitulos?.cortar === 'h2' || capitulos?.cortar === 'saltos' ? capitulos.cortar : 'h1';
    const op: OpcionesConversionSencilla = { ...OPCIONES_CONVERSION, ...o };
    const d = p.diseno;
    const ext = p.nombre.toLowerCase().split('.').pop();
    const avisos: string[] = [];
    let r;
    try {
      r =
        ext === 'epub'
          ? await importarEpub(p.datos, {
              vacios: op.lineasEnBlanco,
              ...(op.espacioPorParrafo && d?.espacio ? { espaciado: { arriba: d.espacio.arriba, abajo: d.espacio.abajo } } : {}),
              ...(op.aspectos ? { aspectos: true } : {}),
              ...(op.estilosParrafo && d?.css && d.estilos?.length ? { estiloPropio: asignadorEstilos(d.css, d.estilos) } : {}),
              ...(op.separadores ? { esSeparador: pareceSeparador, ...(d?.separador?.imagen ? { separadorImagen: d.separador.imagen } : {}) } : {}),
              ...(d?.clasesCapitular?.length ? { ignorarClases: d.clasesCapitular } : {}),
              ...(cortar === 'h2' ? { cortarEnH2: true } : {}),
              ...(cortar === 'saltos' ? { saltoPagina: detectorSaltos(d?.css ?? '') } : {}),
            })
          : await importarDocx(p.datos, { vacios: op.lineasEnBlanco, ...(cortar === 'h2' ? { cortarEnH2: true } : {}), ...(cortar === 'saltos' ? { cortarEnSaltos: true } : {}) });
      if (ext === 'docx' && d && ((op.espacioPorParrafo && d.parrafosConEspacio) || (op.estilosParrafo && d.estilos?.length))) {
        await aplicarDisenoDocx(r.libro, p.datos, { espacio: op.espacioPorParrafo, ...(op.estilosParrafo ? { estilos: d.estilos } : {}) });
      }
    } catch (e) {
      throw new ErrorUsuario(`No se pudo abrir el archivo: ${(e as Error).message}`);
    }
    this.libro = r.libro;
    this.avisos = r.avisos.map((a) => (a.archivo ? `${a.mensaje} (${a.archivo})` : a.mensaje));
    avisos.push(...this.avisos);
    this.antesDePlugin = undefined;
    this.nombreArchivo = nombreDeArchivo(this.libro.metadatos.titulo || p.original.replace(/\.[^.]+$/, '')) + '.obi';
    this.ultimaValidacion = undefined;
    this.ultimasPaginas = this.ultimasPaginasColor = undefined;

    const conservado: string[] = [];
    const corregido: string[] = [];
    if (d) {
      avisos.push(...d.avisos);
      const cambios: Partial<Tema> = {};
      if (op.parrafos && Object.keys(d.tema).length) {
        Object.assign(cambios, d.tema);
        conservado.push('sangría, interlineado y alineación');
      }
      if (op.espacioParrafos && d.espacio) {
        cambios.espacioParrafos = d.espacio.general;
        conservado.push('espacio entre párrafos');
      }
      if (op.espacioTitulos && (d.espacioTitulos !== undefined || d.espacioBajoTitulos !== undefined)) {
        if (d.espacioTitulos !== undefined) cambios.tituloEspacio = d.espacioTitulos;
        if (d.espacioBajoTitulos !== undefined) cambios.tituloEspacioDebajo = d.espacioBajoTitulos;
        conservado.push('espacio antes y después de los títulos');
      }
      if (op.espaciadoLetras && (d.espaciadoLetras || d.espaciadoPalabras)) {
        if (d.espaciadoLetras) cambios.espaciadoLetras = d.espaciadoLetras;
        if (d.espaciadoPalabras) cambios.espaciadoPalabras = d.espaciadoPalabras;
        conservado.push('espaciado entre letras y palabras');
      }
      if (op.titulos && Object.keys(d.titulos).length) {
        Object.assign(cambios, d.titulos);
        conservado.push('estilo de los títulos');
      }
      if (op.titulos && d.subtitulo) {
        cambios.subtitulo = d.subtitulo;
        conservado.push('estilo de los subtítulos');
      }
      if (op.estilosParrafo && d.estilos?.length) {
        cambios.estilosParrafo = d.estilos.map(({ clave: _k, familia: _f, parrafos: _p, ...e }) => e);
        conservado.push(d.estilos.length === 1 ? 'un estilo de párrafo propio' : `${d.estilos.length} estilos de párrafo propios`);
      }
      if (op.separadores && d.separador?.texto) {
        cambios.separador = 'texto';
        cambios.separadorTexto = d.separador.texto;
        conservado.push(`separador de escena «${d.separador.texto}»`);
      } else if (op.separadores && d.separador?.imagen && this.libro.tema.separador === 'imagen') conservado.push('imagen del separador de escena');
      if (op.capitular && (d.capitular || d.primeraLinea)) {
        if (d.capitular) cambios.capitular = 'letra';
        if (d.primeraLinea) cambios.primeraLinea = true;
        conservado.push(d.capitular && d.primeraLinea ? 'letra capitular y primera línea' : d.capitular ? 'letra capitular' : 'primera línea destacada');
      }
      if (op.aspectos) conservado.push('tamaño y color del texto');
      if (Object.keys(cambios).length) this.libro.tema = { ...temaCompleto(this.libro), ...validarTema(cambios), nombre: 'Diseño original' };
      if (op.espacioPorParrafo && d.parrafosConEspacio) conservado.push('espacio propio de cada párrafo');
      if (op.lineasEnBlanco && d.lineasEnBlanco) conservado.push('líneas en blanco');

      // Fuentes: las del archivo y, si faltan, las instaladas.
      if (op.fuentesArchivo) {
        for (const f of d.fuentes) {
          try {
            this.agregarCara(f.datos, f.nombre, f.familia || undefined);
          } catch (e) {
            avisos.push(`«${f.nombre}»: ${(e as Error).message}`);
          }
        }
      }
      const elegir = async (familia: string | undefined, campo: 'fuenteTexto' | 'fuenteTitulos' | ((id: string) => void)) => {
        if (!familia || (!op.fuentesArchivo && !op.fuentesSistema)) return;
        const igual = (x: string) => x.toLowerCase() === familia.toLowerCase();
        let f = op.fuentesArchivo ? this.libro.fuentesPropias?.find((x) => igual(x.familia)) : undefined;
        if (!f && op.fuentesSistema) {
          const sistema = (await this.fuentesSistema().catch(() => [] as FamiliaSistema[])).find((x) => igual(x.familia));
          if (sistema?.caras.some((c) => c.permiso.incrustable)) {
            try {
              await this.anadirFuenteSistema(sistema.familia);
              f = this.libro.fuentesPropias?.find((x) => igual(x.familia));
            } catch (e) {
              avisos.push((e as Error).message);
            }
          }
        }
        if (f && typeof campo === 'function') campo(PREFIJO + f.id);
        else if (f) {
          this.libro.tema = { ...temaCompleto(this.libro), [campo as 'fuenteTexto' | 'fuenteTitulos']: PREFIJO + f.id };
          if (!conservado.includes(`letra «${f.familia}»`)) conservado.push(`letra «${f.familia}»`);
        } else avisos.push(`La letra «${familia}» no se pudo usar: se usa Literata.`);
      };
      await elegir(d.familiaTexto, 'fuenteTexto');
      await elegir(d.familiaTitulos ?? d.familiaTexto, 'fuenteTitulos');
      // Letras de los estilos de párrafo propios.
      if (op.estilosParrafo) {
        for (const e of d.estilos ?? []) {
          if (!e.familia) continue;
          await elegir(e.familia, (fuente) => {
            const t = temaCompleto(this.libro);
            this.libro.tema = { ...t, estilosParrafo: (t.estilosParrafo ?? []).map((x) => (x.id === e.id ? { ...x, fuente } : x)) };
          });
        }
      }
    }
    if (op.optimizarImagenes) this.libro.optimizarImagenes = true;
    else conservado.push('imágenes originales');
    // Limpieza tipográfica elegida (raya, comillas latinas, puntos suspensivos, espacios).
    if (op.raya || op.comillas || op.suspensivos) {
      const t: Tipografia = { raya: op.raya, comillas: op.comillas ? 'latinas' : 'sin-cambio', suspensivos: op.suspensivos };
      this.libro.tipografia = { ...this.libro.tipografia, ...t };
      const n = this.libro.secciones.reduce((k, s) => k + aplicarTipografiaSeccion(s, t), 0);
      if (n) corregido.push(`tipografía en ${n} fragmentos`);
    }
    if (op.espaciosSignos) {
      const n = reemplazar(this.libro, { consulta: ' {2,}', regex: true }, ' ').n + reemplazar(this.libro, { consulta: ' +([,.;:!?…»)\\]])', regex: true }, '$1').n;
      if (n) corregido.push(n === 1 ? 'un espacio de más' : `${n} espacios de más`);
    }
    // Descripciones de las imágenes (opcionales).
    if (descripciones && typeof descripciones === 'object') {
      let n = 0;
      for (const s of this.libro.secciones) {
        for (const b of s.bloques) {
          if (b.tipo !== 'imagen') continue;
          const r = this.libro.recursos.find((x) => x.id === b.recurso);
          const d = r ? descripciones[r.nombre] : undefined;
          if (!d || typeof d.alt !== 'string') continue;
          const alt = d.alt.replace(/\s+/g, ' ').trim().slice(0, 1000);
          if (alt === b.alt && !!d.decorativa === !!b.decorativa) continue;
          b.alt = alt;
          if (d.decorativa) b.decorativa = true;
          else delete b.decorativa;
          n++;
        }
      }
      if (n) corregido.push(n === 1 ? 'la descripción de una imagen' : `las descripciones de ${n} imágenes`);
    }
    if (capitulos) this.aplicarCapitulos(capitulos, avisos);
    // Metadatos y portada revisados en el asistente.
    if (metadatosNuevos) this.metadatos(metadatosValidos(metadatosNuevos) as Partial<Metadatos>);
    if (portadaNueva?.datos) this.cambiarPortada(portadaNueva);
    this.nombreArchivo = nombreDeArchivo(this.libro.metadatos.titulo || p.original.replace(/\.[^.]+$/, '')) + '.obi';
    this.cambiado = true;
    this.marcar();
    this.conversionPendiente = undefined;
    return {
      estado: this.estado(),
      capitulos: this.libro.secciones.filter((x) => !['portada', 'ilustracion', 'indice'].includes(x.tipo)).length,
      ilustraciones: this.libro.secciones.filter((x) => x.tipo === 'ilustracion').length,
      imagenes: this.libro.recursos.length,
      notas: this.libro.secciones.reduce((n, x) => n + x.notas.length, 0),
      conservado,
      corregido,
      avisos,
    };
  }

  // ---------- Conversión por lotes (varios volúmenes con las mismas opciones) ----------

  private lote: { nombre: string; datos: Uint8Array }[] = [];
  private loteHecho = new Map<number, { nombre: string; datos: Uint8Array }>();

  /** Empieza un lote nuevo (borra el anterior). */
  nuevoLote() {
    this.lote = [];
    this.loteHecho.clear();
  }

  /** Añade un archivo al lote; el primero se analiza para el asistente. */
  async anadirAlLote(nombre: string, datos: Uint8Array): Promise<{ indice: number; volumen?: number; analisis?: AnalisisConversion }> {
    if (this.lote.length >= 60) throw new ErrorUsuario('Un lote admite como mucho 60 archivos.');
    const ext = nombre.toLowerCase().split('.').pop();
    if (ext !== 'epub' && ext !== 'docx' && !esFormatoOtro(ext)) throw new ErrorUsuario(`«${nombre}» no es un formato que admita la conversión sencilla.`);
    this.lote.push({ nombre, datos });
    const indice = this.lote.length - 1;
    const volumen = volumenDeNombre(nombre);
    if (indice === 0) return { indice, ...(volumen !== undefined ? { volumen } : {}), analisis: await this.analizarConversion(nombre, datos) };
    return { indice, ...(volumen !== undefined ? { volumen } : {}) };
  }

  /** Convierte un volumen del lote con las opciones elegidas, sin tocar el libro abierto, y lo valida. */
  async convertirDelLote(indice: number, entrada: Partial<OpcionesConversionSencilla> & { lote?: DatosLote } = {}): Promise<ResultadoLote> {
    const a = this.lote[indice];
    if (!a) throw new ErrorUsuario('Ese archivo no está en el lote.');
    const { lote: datosLote = {}, ...op } = entrada;
    const otro = new Backend(this.carpetaRecuperacion);
    otro.sistema = this.sistema;
    const r: ResultadoLote = { nombre: a.nombre, titulo: a.nombre, ok: false, avisos: [], errores: [] };
    try {
      const an = await otro.analizarConversion(a.nombre, a.datos);
      const m = an.metadatos;
      const volumen = datosLote.volumenes?.[indice] ?? m.volumen ?? volumenDeNombre(a.nombre);
      // Los datos de la serie completan lo que el volumen no trae (nunca reemplazan su título).
      const creditos = [...m.creditos];
      for (const c of datosLote.creditos ?? []) if (c?.nombre && !creditos.some((x) => x.rol === c.rol)) creditos.push(c);
      const metadatos = {
        ...m,
        ...(datosLote.serie ? { serie: datosLote.serie } : {}),
        ...(volumen !== undefined ? { volumen } : {}),
        ...(!m.editorial && datosLote.editorial ? { editorial: datosLote.editorial } : {}),
        ...(!m.derechos && datosLote.derechos ? { derechos: datosLote.derechos } : {}),
        ...(datosLote.idioma ? { idioma: datosLote.idioma } : {}),
        creditos,
      };
      const res = await otro.conversionSencilla({
        ...op,
        metadatos,
        capitulos: { cortar: datosLote.cortar ?? 'h1', ...(datosLote.profundidad === 2 ? { profundidad: 2 } : {}), ...(datosLote.paginaIndice ? { paginaIndice: true } : {}) },
      });
      clearTimeout(otro.temporizador);
      r.titulo = otro.libro.metadatos.titulo || a.nombre;
      r.avisos = res.avisos;
      const salida = datosLote.tienda ? await otro.exportarTienda(datosLote.tienda) : await otro.exportar();
      const base = salida.nombre.replace(/\.epub$/, '');
      const prefijo = volumen !== undefined ? `${String(volumen).padStart(2, '0')} - ` : '';
      this.loteHecho.set(indice, { nombre: `${prefijo}${base}.epub`, datos: salida.datos });
      r.archivo = `${prefijo}${base}.epub`;
      r.ok = true;
    } catch (e) {
      clearTimeout(otro.temporizador);
      const d = e instanceof ErrorUsuario ? (e.datos as { mensajes?: { mensaje: string }[] } | undefined) : undefined;
      r.errores = d?.mensajes?.length ? d.mensajes.slice(0, 5).map((x) => x.mensaje) : [(e as Error).message];
    }
    return r;
  }

  /** ZIP con los EPUB del lote ya convertidos. */
  async descargarLote(): Promise<{ nombre: string; datos: Uint8Array }> {
    if (!this.loteHecho.size) throw new ErrorUsuario('Todavía no hay volúmenes convertidos.');
    const zip = new JSZip();
    const usados = new Set<string>();
    for (const [, v] of [...this.loteHecho].sort((x, y) => x[0] - y[0])) {
      let n = v.nombre;
      for (let k = 2; usados.has(n); k++) n = v.nombre.replace(/\.epub$/, ` (${k}).epub`);
      usados.add(n);
      zip.file(n, v.datos, { compression: 'STORE' });
    }
    const serie = this.libro.metadatos.serie;
    return { nombre: `${nombreDeArchivo(serie || 'volumenes')}.zip`, datos: await zip.generateAsync({ type: 'uint8array' }) };
  }

  /** Cambios de la lista de capítulos del asistente: títulos, índice, uniones, niveles y página de índice. */
  private aplicarCapitulos(c: CapitulosConversion, avisos: string[]) {
    const secciones = this.libro.secciones;
    const cambios = Array.isArray(c.cambios) ? c.cambios.filter((x) => x && Number.isInteger(x.indice) && x.indice >= 0 && x.indice < secciones.length) : [];
    if (cambios.length && c.total !== undefined && c.total !== secciones.length) {
      avisos.push('La lista de capítulos cambió desde que la revisaste; los cambios de capítulos no se aplicaron.');
    } else {
      const ids = secciones.map((s) => s.id);
      for (const x of cambios) {
        const s = secciones[x.indice];
        if (typeof x.titulo === 'string' && x.titulo.trim()) {
          s.titulo = x.titulo.replace(/\s+/g, ' ').trim().slice(0, 300);
          if (!['portada', 'ilustracion'].includes(s.tipo)) s.mostrarTitulo = true;
        }
        if (typeof x.tituloIndice === 'string') {
          const v = x.tituloIndice.replace(/\s+/g, ' ').trim().slice(0, 300);
          if (v && v !== s.titulo) s.tituloIndice = v;
          else delete s.tituloIndice;
        }
        if (typeof x.enIndice === 'boolean') s.enIndice = x.enIndice;
      }
      // Uniones de atrás hacia delante, para que las posiciones sigan valiendo.
      for (const x of [...cambios].filter((x) => x.unirConSiguiente).sort((a, b) => b.indice - a.indice)) {
        try {
          this.unirSinVersion(ids[x.indice]);
        } catch (e) {
          avisos.push((e as Error).message);
        }
      }
    }
    if (c.profundidad === 2) this.libro.profundidadIndice = 2;
    if (c.paginaIndice && !this.libro.secciones.some((s) => s.tipo === 'indice')) {
      const s = nuevaSeccion('indice', 'Índice');
      s.enIndice = false;
      const k = Math.max(this.libro.secciones.findIndex((x) => x.tipo === 'creditos'), this.libro.secciones.findIndex((x) => x.tipo === 'portada'));
      this.libro.secciones.splice(k + 1, 0, s);
    }
  }

  /**
   * Lista de capítulos que saldría de la conversión con estas opciones y este corte, sin tocar el libro abierto.
   */
  async capitulosConversion(entrada: Partial<OpcionesConversionSencilla> & { cortar?: CorteCapitulos } = {}): Promise<CapituloVista[]> {
    const p = this.conversionPendiente;
    if (!p) throw new ErrorUsuario('Elige primero el archivo que quieres convertir.');
    const { cortar, ...o } = entrada;
    const otro = new Backend(this.carpetaRecuperacion);
    otro.sistema = this.sistema;
    otro.conversionPendiente = { ...p };
    await otro.conversionSencilla({ ...o, fuentesArchivo: false, fuentesSistema: false, capitulos: { cortar: cortar ?? 'h1' } });
    clearTimeout(otro.temporizador);
    return otro.libro.secciones.map((s, indice) => {
      const texto = s.bloques.map((b) => (b.tipo === 'parrafo' || b.tipo === 'subtitulo' ? textoPlano(b.contenido) : '')).join(' ').replace(/\s+/g, ' ').trim();
      return {
        indice,
        tipo: s.tipo,
        titulo: s.titulo,
        enIndice: s.enIndice,
        palabras: contarPalabras(s),
        inicio: texto.slice(0, 90),
        subtitulos: s.bloques.filter((b) => b.tipo === 'subtitulo' && b.nivel === 2).length,
      };
    });
  }

  /** Pone otra imagen como portada: la nueva se añade y, si no había página de portada, se crea al principio. */
  private cambiarPortada(nueva: PortadaConversion) {
    let datos: Uint8Array;
    try {
      datos = Uint8Array.from(Buffer.from(nueva.datos, 'base64'));
    } catch {
      throw new ErrorUsuario('La imagen de la portada no se pudo leer.');
    }
    const r = this.anadirRecurso(nueva.nombre || 'portada', datos);
    const anterior = this.libro.metadatos.portada;
    this.libro.metadatos.portada = r.id;
    const seccion = this.libro.secciones.find((x) => x.tipo === 'portada');
    if (seccion) {
      for (const b of seccion.bloques) if (b.tipo === 'imagen' && b.recurso === anterior) b.recurso = r.id;
    } else {
      const s = nuevaSeccion('portada', 'Portada');
      s.bloques = [];
      this.libro.secciones.unshift(s);
    }
    // La portada anterior se quita si ya no se usa en ninguna parte.
    if (anterior && anterior !== r.id && !JSON.stringify(this.libro.secciones).includes(`"${anterior}"`) && this.libro.tema.separadorImagen !== anterior) {
      this.libro.recursos = this.libro.recursos.filter((x) => x.id !== anterior);
    }
  }

  quitarFuente(id: string) {
    const lista = this.libro.fuentesPropias ?? [];
    if (!lista.some((f) => f.id === id)) throw new ErrorUsuario('Esa fuente no existe.', 404);
    this.libro.fuentesPropias = lista.filter((f) => f.id !== id);
    if (!this.libro.fuentesPropias.length) delete this.libro.fuentesPropias;
    // El tema vuelve a una fuente incluida si usaba la que se quita.
    const t = temaCompleto(this.libro);
    if (t.fuenteTexto === PREFIJO + id || t.fuenteTitulos === PREFIJO + id) {
      this.libro.tema = { ...t, ...(t.fuenteTexto === PREFIJO + id ? { fuenteTexto: 'literata' } : {}), ...(t.fuenteTitulos === PREFIJO + id ? { fuenteTitulos: 'literata' } : {}) };
    }
    this.marcar();
  }

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

  /**
   * Divide una ilustración horizontal en dos páginas (mitad izquierda y derecha), para lectores que
   * no muestran dobles páginas. En los libros verticales (de derecha a izquierda) va primero la derecha.
   */
  /**
   * Parte una sección en dos: los bloques desde `indice` pasan a una sección nueva justo después.
   * Si el primer bloque que pasa es un subtítulo, se convierte en el título de la nueva sección.
   * Las notas y los comentarios van con el texto que los cita.
   */
  partirSeccion(id: string, indice: number, actual?: { bloques?: unknown; notas?: unknown }): string {
    const s = this.seccion(id);
    if (actual?.bloques) this.actualizarSeccion(id, actual as Partial<Seccion>);
    if (s.cambios?.length) throw new ErrorUsuario('Acepta o rechaza antes los cambios propuestos de esta sección.');
    if (!Number.isInteger(indice) || indice <= 0 || indice >= s.bloques.length) throw new ErrorUsuario('Coloca el cursor en el párrafo donde debe empezar la nueva sección (no en el primero).');
    this.conVersion(() => crearVersion(this.libro, `Antes de partir «${s.titulo || 'sección'}»`));
    const movidos = s.bloques.slice(indice);
    s.bloques = s.bloques.slice(0, indice);
    let titulo = '';
    const primero = movidos[0];
    if (primero.tipo === 'subtitulo') {
      titulo = textoPlano(primero.contenido).replace(/\s+/g, ' ').trim();
      if (titulo) movidos.shift();
    }
    if (movidos[0]?.tipo === 'saltoPagina') movidos.shift();
    if (s.bloques[s.bloques.length - 1]?.tipo === 'saltoPagina') s.bloques.pop();
    const notasDe = new Set<string>();
    const comentariosDe = new Set<string>();
    for (const b of movidos) for (const l of inlinesBloque(b)) for (const i of l) {
      if (i.tipo === 'nota') notasDe.add(i.id);
      if (i.tipo === 'texto') i.comentarios?.forEach((c) => comentariosDe.add(c));
    }
    const nueva = nuevaSeccion(s.tipo === 'indice' || s.tipo === 'portada' ? 'capitulo' : s.tipo, titulo);
    nueva.mostrarTitulo = !!titulo;
    nueva.enIndice = !!titulo && s.enIndice;
    nueva.bloques = movidos.length ? movidos : [parrafo('')];
    nueva.notas = s.notas.filter((n) => notasDe.has(n.id));
    s.notas = s.notas.filter((n) => !notasDe.has(n.id));
    const comentarios = (s.comentarios ?? []).filter((c) => comentariosDe.has(c.id));
    if (comentarios.length) nueva.comentarios = comentarios;
    s.comentarios = (s.comentarios ?? []).filter((c) => !comentariosDe.has(c.id));
    if (!s.comentarios.length) delete s.comentarios;
    if (!s.bloques.length) s.bloques = [parrafo('')];
    this.libro.secciones.splice(this.libro.secciones.indexOf(s) + 1, 0, nueva);
    this.marcar();
    return nueva.id;
  }

  /** Niveles del índice: 1 (secciones) o 2 (también los subtítulos de nivel 2). */
  profundidadIndice(p: unknown) {
    if (p === 2) this.libro.profundidadIndice = 2;
    else delete this.libro.profundidadIndice;
    this.marcar();
  }

  /** Une una sección con la siguiente; el título de la siguiente queda como subtítulo para no perderlo. */
  unirConSiguiente(id: string): void {
    const s = this.seccion(id);
    const sig = this.libro.secciones[this.libro.secciones.indexOf(s) + 1];
    this.comprobarUnion(s, sig);
    this.conVersion(() => crearVersion(this.libro, `Antes de unir «${s.titulo || 'sección'}» y «${sig!.titulo || 'sección'}»`));
    this.unirSinVersion(id);
  }

  private comprobarUnion(s: Seccion, sig: Seccion | undefined): asserts sig is Seccion {
    if (!sig) throw new ErrorUsuario('Es la última sección: no hay ninguna después para unir.');
    if (s.cambios?.length || sig.cambios?.length) throw new ErrorUsuario('Acepta o rechaza antes los cambios propuestos de las dos secciones.');
    if (['portada', 'indice'].includes(s.tipo) || ['portada', 'indice'].includes(sig.tipo)) throw new ErrorUsuario('La portada y el índice no se pueden unir con otra sección.');
  }

  private unirSinVersion(id: string): void {
    const s = this.seccion(id);
    const k = this.libro.secciones.indexOf(s);
    const sig = this.libro.secciones[k + 1];
    this.comprobarUnion(s, sig);
    const vacia = (b: Bloque[]) => b.length === 1 && b[0].tipo === 'parrafo' && !b[0].contenido.length;
    const base = vacia(s.bloques) ? [] : s.bloques;
    const titulo: Bloque[] = sig.titulo && sig.mostrarTitulo ? [{ tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto: sig.titulo }] }] : [];
    s.bloques = [...base, ...titulo, ...(vacia(sig.bloques) ? [] : sig.bloques)];
    if (!s.bloques.length) s.bloques = [parrafo('')];
    s.notas = [...s.notas, ...sig.notas];
    const comentarios = [...(s.comentarios ?? []), ...(sig.comentarios ?? [])];
    if (comentarios.length) s.comentarios = comentarios;
    if (!s.titulo && sig.titulo) {
      s.titulo = sig.titulo;
      s.mostrarTitulo = sig.mostrarTitulo;
      s.enIndice = sig.enIndice;
      s.bloques = s.bloques.filter((b) => !titulo.includes(b));
    }
    this.libro.secciones.splice(k + 1, 1);
    this.marcar();
  }

  async dividirIlustracion(id: string): Promise<string> {
    const s = this.seccion(id);
    const b = s.bloques.find((x): x is Imagen => x.tipo === 'imagen');
    const r = b && this.libro.recursos.find((x) => x.id === b.recurso);
    if (s.tipo !== 'ilustracion' || !b || !r) throw new ErrorUsuario('Solo se pueden dividir páginas de ilustración con imagen.');
    if (!r.ancho || !r.alto || r.ancho <= r.alto) throw new ErrorUsuario('La imagen no es horizontal.');
    let izq: Recurso;
    let der: Recurso;
    try {
      izq = await recortar(r, 0, 0, 0.5, 1);
      der = await recortar(r, 0.5, 0, 0.5, 1);
    } catch (e) {
      throw e instanceof ErrorImagen ? new ErrorUsuario(e.message) : e;
    }
    this.conVersion(() => crearVersion(this.libro, `Antes de dividir «${r.nombre}»`));
    const base = r.nombre.replace(/\.[^.]+$/, '');
    const nuevo = (x: Recurso, lado: string): Recurso => ({ ...x, id: nuevoId('i'), nombre: `${base}-${lado}.${x.nombre.split('.').pop()}` });
    const [primera, segunda] = esVertical(this.libro) ? [nuevo(der, 'der'), nuevo(izq, 'izq')] : [nuevo(izq, 'izq'), nuevo(der, 'der')];
    this.libro.recursos.push(primera, segunda);
    const alt = b.decorativa ? '' : b.alt;
    s.bloques = s.bloques.map((x) => (x === b ? { ...b, recurso: primera.id, alt: alt ? `${alt} (1 de 2)` : '' } : x));
    delete s.doblePagina;
    const otra: Seccion = { ...structuredClone(s), id: nuevoId('s'), bloques: [{ ...b, recurso: segunda.id, alt: alt ? `${alt} (2 de 2)` : '' }], notas: [], comentarios: undefined, cambios: undefined };
    this.libro.secciones.splice(this.libro.secciones.indexOf(s) + 1, 0, otra);
    // La imagen original se quita si ya nadie la usa (queda en la versión guardada).
    const enUso = JSON.stringify(this.libro.secciones).includes(`"${r.id}"`) || this.libro.metadatos.portada === r.id || this.libro.tema.separadorImagen === r.id;
    if (!enUso) this.libro.recursos = this.libro.recursos.filter((x) => x !== r);
    this.marcar();
    return otra.id;
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
    this.paquetes.set(v, archivosImpresion(await libroParaImprimir(this.libro, digital), { interior, digital }));
    // Solo se guardan las últimas versiones.
    for (const k of [...this.paquetes.keys()]) if (Number(k) < this.contadorImpresion - 4) this.paquetes.delete(k);
    return urlVisor(this.base, this.clave, Number(v));
  }

  // ----- Cubierta de imprenta -----

  private paginasCubierta(): number | undefined {
    return this.libro.cubierta?.paginas ?? this.ultimasPaginas;
  }

  cubierta(cambios: Record<string, unknown>) {
    const actual = cubiertaCompleta(this.libro);
    const n: Cubierta = { ...actual };
    const color = /^#[0-9a-f]{6}$/i;
    if (cambios.imprenta === 'kdp' || cambios.imprenta === 'otra') n.imprenta = cambios.imprenta;
    if (PAPELES_KDP.some((p) => p.id === cambios.papel)) n.papel = cambios.papel as Cubierta['papel'];
    const numero = (v: unknown, min: number, max: number) => (v === null || v === '' ? undefined : Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : undefined);
    if ('lomoManual' in cambios) n.lomoManual = numero(cambios.lomoManual, 0.5, 120);
    if ('paginas' in cambios) n.paginas = numero(cambios.paginas, 1, 3000) && Math.round(numero(cambios.paginas, 1, 3000)!);
    for (const k of ['portada', 'contraportada'] as const) {
      if (!(k in cambios)) continue;
      const v = cambios[k];
      if (!v) delete n[k];
      else if (typeof v === 'string' && this.libro.recursos.some((r) => r.id === v)) n[k] = v;
      else throw new ErrorUsuario('Esa imagen no está en el libro.');
    }
    if ('textoContraportada' in cambios) {
      const v = typeof cambios.textoContraportada === 'string' ? cambios.textoContraportada.slice(0, 3000) : '';
      if (v.trim()) n.textoContraportada = v;
      else delete n.textoContraportada;
    }
    if (typeof cambios.colorFondo === 'string' && color.test(cambios.colorFondo)) n.colorFondo = cambios.colorFondo;
    if (typeof cambios.colorTexto === 'string' && color.test(cambios.colorTexto)) n.colorTexto = cambios.colorTexto;
    if (typeof cambios.codigoBarras === 'boolean') n.codigoBarras = cambios.codigoBarras;
    for (const k of Object.keys(n) as (keyof Cubierta)[]) if (n[k] === undefined) delete n[k];
    this.libro.cubierta = n;
    this.marcar();
  }

  revisionCubierta(): { avisos: AvisoCubierta[]; medidas?: MedidasCubierta; paginas?: number } {
    const paginas = this.paginasCubierta();
    return { avisos: revisarCubierta(this.libro, paginas), ...(paginas ? { medidas: medidasCubierta(this.libro, paginas), paginas } : {}) };
  }

  private prepararCubierta(paginas: number): string {
    const v = String(++this.contadorImpresion);
    this.paquetes.set(v, archivosCubierta(this.libro, paginas));
    for (const k of [...this.paquetes.keys()]) if (Number(k) < this.contadorImpresion - 4) this.paquetes.delete(k);
    return urlVisor(this.base, this.clave, Number(v));
  }

  vistaCubierta(): string {
    const paginas = this.paginasCubierta();
    if (!paginas) throw new ErrorUsuario('Indica el número de páginas del interior.');
    return this.prepararCubierta(paginas);
  }

  async exportarCubierta(): Promise<{ nombre: string; datos: Uint8Array }> {
    const paginas = this.paginasCubierta();
    const errores = revisarCubierta(this.libro, paginas).filter((a) => a.gravedad === 'error');
    if (errores.length || !paginas) throw new ErrorUsuario(`No se puede crear la cubierta: ${errores.map((e) => e.plantilla).join(' ')}`);
    let datos;
    try {
      datos = await posprocesarCubierta(await this.renderizador(this.prepararCubierta(paginas)), this.libro, paginas);
    } catch (e) {
      throw new ErrorUsuario(`No se pudo crear la cubierta: ${(e as Error).message}`);
    }
    return { nombre: nombreDeArchivo(this.libro.metadatos.titulo) + '-cubierta.pdf', datos };
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
