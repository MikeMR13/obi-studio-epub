import { useEffect, useRef, useState } from 'react';
import { api, type AnalisisConversion, type DatosLibroConversion, type OpcionesConversionSencilla, type PortadaConversion } from '../api';
import { ROLES, type Credito } from '../../../src/model';
import { t } from '../i18n';

interface Props {
  analisis: AnalisisConversion;
  ocupado: boolean;
  onCancelar: () => void;
  onConvertir: (o: OpcionesConversionSencilla & { metadatos?: DatosLibroConversion; portada?: PortadaConversion }) => void;
}

type Clave = keyof OpcionesConversionSencilla;

interface Opcion {
  clave: Clave;
  titulo: string;
  /** Lo que se encontró en el original; vacío = no hay nada que conservar. */
  detalle?: string;
  disponible: boolean;
  ayuda?: string;
}

const em = (v?: number) => (v === undefined ? '' : `${Math.round(v * 100) / 100} em`);

const CLAVE_SERIE = 'obi-conversion-serie:';
const CLAVE_DATOS_SERIE = 'obi-conversion-datos-serie:';

/** Datos que suelen repetirse en todos los volúmenes de una serie. */
type DatosSerie = Pick<DatosLibroConversion, 'editorial' | 'derechos' | 'idioma'> & { creditos?: Credito[] };

function datosRecordados(serie?: string): DatosSerie | undefined {
  if (!serie?.trim()) return undefined;
  try {
    const v = localStorage.getItem(CLAVE_DATOS_SERIE + serie.trim().toLowerCase());
    return v ? (JSON.parse(v) as DatosSerie) : undefined;
  } catch {
    return undefined;
  }
}

function recordarDatos(m: DatosLibroConversion) {
  if (!m.serie?.trim()) return;
  try {
    const d: DatosSerie = { editorial: m.editorial, derechos: m.derechos, idioma: m.idioma, creditos: m.creditos };
    localStorage.setItem(CLAVE_DATOS_SERIE + m.serie.trim().toLowerCase(), JSON.stringify(d));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

/** Completa con los datos de la serie lo que el original no trae (nunca pisa lo que sí trae). */
function completarConSerie(m: DatosLibroConversion, d?: DatosSerie): { datos: DatosLibroConversion; usados: boolean } {
  if (!d) return { datos: m, usados: false };
  const r = { ...m };
  let usados = false;
  if (!r.editorial && d.editorial) (r.editorial = d.editorial), (usados = true);
  if (!r.derechos && d.derechos) (r.derechos = d.derechos), (usados = true);
  // Traductores, ilustradores y editores de la serie que el original no nombra.
  const faltan = (d.creditos ?? []).filter((c) => c.rol !== 'aut' && !r.creditos.some((x) => x.rol === c.rol));
  if (faltan.length) (r.creditos = [...r.creditos, ...faltan]), (usados = true);
  return { datos: r, usados };
}


/** Opciones elegidas antes para otro volumen de la misma serie. */
function recordadas(serie?: string): Partial<OpcionesConversionSencilla> | undefined {
  if (!serie) return undefined;
  try {
    const v = localStorage.getItem(CLAVE_SERIE + serie.toLowerCase());
    return v ? (JSON.parse(v) as Partial<OpcionesConversionSencilla>) : undefined;
  } catch {
    return undefined;
  }
}

function recordar(serie: string | undefined, o: OpcionesConversionSencilla) {
  if (!serie) return;
  try {
    localStorage.setItem(CLAVE_SERIE + serie.toLowerCase(), JSON.stringify(o));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

/** Asistente de la conversión sencilla: el usuario confirma paso a paso qué conservar del original. */
export function ConversionPasos({ analisis, ocupado, onCancelar, onConvertir }: Props) {
  const d = analisis.diseno;
  const alineacion = d?.tema.alinear === 'justificado' ? t('justificado') : d?.tema.alinear === 'izquierda' ? t('a la izquierda') : '';
  const detallesParrafo = [
    d?.tema.sangria !== undefined ? t('sangría {0}', { 0: em(d.tema.sangria) }) : '',
    d?.tema.interlineado !== undefined ? t('interlineado {0}', { 0: d.tema.interlineado }) : '',
    alineacion,
    d?.tema.sangriaTrasTitulo === true ? t('sangría también tras el título') : d?.tema.sangriaTrasTitulo === false ? t('sin sangría tras el título') : '',
  ].filter(Boolean);
  const detallesTitulos = [
    d?.titulos.tituloEstilo === 'izquierda' ? t('a la izquierda') : d?.titulos.tituloEstilo === 'centrado' ? t('centrados') : '',
    d?.titulos.colorTitulos ? t('color {0}', { 0: d.titulos.colorTitulos }) : '',
    d?.titulos.tituloEnMayusculas ? t('en mayúsculas') : d?.titulos.tituloMayusculas ? t('en versalitas') : '',
    d?.titulos.tituloTamano ? t('tamaño {0}', { 0: em(d.titulos.tituloTamano) }) : '',
    d?.subtitulo ? t('y subtítulos') : '',
  ].filter(Boolean);
  const estilos = d?.estilos ?? [];
  const sep = d?.separador;
  const letrasArchivo = [...new Set(analisis.fuentesArchivo.filter((f) => f.permiso.incrustable).map((f) => f.familia).filter(Boolean))];
  const bloqueadas = analisis.fuentesArchivo.filter((f) => !f.permiso.incrustable);
  const instaladas = analisis.letras.filter((l) => l.origen === 'sistema').map((l) => l.familia);
  const faltan = analisis.letras.filter((l) => l.origen === 'falta').map((l) => l.familia);
  const espaciado = [d?.espaciadoLetras ? t('letras {0}', { 0: em(d.espaciadoLetras) }) : '', d?.espaciadoPalabras ? t('palabras {0}', { 0: em(d.espaciadoPalabras) }) : ''].filter(Boolean);

  const pasos: { titulo: string; opciones: Opcion[] }[] = [
    {
      titulo: t('Párrafos y títulos'),
      opciones: [
        { clave: 'parrafos', titulo: t('Forma de los párrafos'), detalle: detallesParrafo.join(' · '), disponible: detallesParrafo.length > 0 },
        { clave: 'titulos', titulo: t('Estilo de los títulos'), detalle: detallesTitulos.join(' · '), disponible: detallesTitulos.length > 0 },
      ],
    },
    {
      titulo: t('Estilos y adornos'),
      opciones: [
        {
          clave: 'estilosParrafo',
          titulo: t('Otros tipos de párrafo'),
          detalle: estilos.length ? t('{0} tipos (citas, cartas, notas…): {1}', { 0: estilos.length, 1: estilos.slice(0, 4).map((e) => e.nombre.replace(/^Original: /, '')).join(', ') + (estilos.length > 4 ? '…' : '') }) : '',
          disponible: estilos.length > 0,
          ayuda: t('Se guardan como estilos del libro: puedes cambiarlos después en Diseño.'),
        },
        { clave: 'aspectos', titulo: t('Tamaño y color del texto'), detalle: d?.fragmentosConAspecto ? t('{0} fragmentos con tamaño, color o fondo propios', { 0: d.fragmentosConAspecto }) : '', disponible: !!d?.fragmentosConAspecto },
        {
          clave: 'separadores',
          titulo: t('Separador de escena'),
          detalle: sep ? (sep.texto ? t('«{0}»', { 0: sep.texto }) : t('imagen {0}', { 0: sep.imagen ?? '' })) + ' · ' + (sep.veces === 1 ? t('una vez') : t('{0} veces', { 0: sep.veces })) : '',
          disponible: !!sep,
        },
        {
          clave: 'capitular',
          titulo: t('Letra capitular y primera línea'),
          detalle: [d?.capitular ? t('capitular') : '', d?.primeraLinea ? t('primera línea destacada') : ''].filter(Boolean).join(' · '),
          disponible: !!(d?.capitular || d?.primeraLinea),
        },
      ],
    },
    {
      titulo: t('Espaciado'),
      opciones: [
        { clave: 'espacioParrafos', titulo: t('Espacio entre párrafos'), detalle: d?.espacio ? (d.espacio.general ? em(d.espacio.general) : t('ninguno (párrafos seguidos)')) : '', disponible: !!d?.espacio },
        {
          clave: 'espacioPorParrafo',
          titulo: t('Espacio propio de cada párrafo'),
          detalle: d?.parrafosConEspacio ? t('{0} párrafos con un espacio distinto', { 0: d.parrafosConEspacio }) : '',
          disponible: !!d?.parrafosConEspacio,
        },
        { clave: 'lineasEnBlanco', titulo: t('Líneas en blanco'), detalle: d?.lineasEnBlanco ? t('{0} líneas en blanco', { 0: d.lineasEnBlanco }) : '', disponible: !!d?.lineasEnBlanco },
        {
          clave: 'espacioTitulos',
          titulo: t('Espacio antes y después de los títulos'),
          detalle: [d?.espacioTitulos !== undefined ? t('encima {0}', { 0: em(d.espacioTitulos) }) : '', d?.espacioBajoTitulos !== undefined ? t('debajo {0}', { 0: em(d.espacioBajoTitulos) }) : ''].filter(Boolean).join(' · '),
          disponible: d?.espacioTitulos !== undefined || d?.espacioBajoTitulos !== undefined,
        },
        { clave: 'espaciadoLetras', titulo: t('Espaciado entre letras y palabras'), detalle: espaciado.join(' · '), disponible: espaciado.length > 0 },
      ],
    },
    {
      titulo: t('Letras e imágenes'),
      opciones: [
        {
          clave: 'fuentesArchivo',
          titulo: t('Letras que trae el archivo'),
          detalle: letrasArchivo.join(', '),
          disponible: letrasArchivo.length > 0,
          ayuda: bloqueadas.length ? t('{0} fuente(s) con una licencia que no permite incrustarlas se quedan fuera.', { 0: bloqueadas.length }) : undefined,
        },
        {
          clave: 'fuentesSistema',
          titulo: t('Letras instaladas en este equipo'),
          detalle: instaladas.join(', '),
          disponible: instaladas.length > 0,
          ayuda: faltan.length ? t('No se encontró: {0}. Se usará Literata.', { 0: faltan.join(', ') }) : undefined,
        },
        {
          clave: 'optimizarImagenes',
          titulo: t('Reducir el peso de las imágenes'),
          detalle: t('{0} imágenes', { 0: analisis.imagenes }),
          disponible: analisis.imagenes > 0,
          ayuda: t('Sin marcar, las imágenes van tal cual en el original.'),
        },
      ],
    },
  ];

  const previas = recordadas(analisis.serie);
  const [op, setOp] = useState<OpcionesConversionSencilla>(() => {
    const o = {} as OpcionesConversionSencilla;
    for (const p of pasos) for (const x of p.opciones) o[x.clave] = x.clave === 'optimizarImagenes' ? !!previas?.optimizarImagenes : x.disponible && (previas?.[x.clave] ?? true);
    return o;
  });
  const [vista, setVista] = useState<{ original?: string; convertido: string } | 'cargando' | 'error'>();
  const [inicial] = useState(() => completarConSerie(analisis.metadatos, datosRecordados(analisis.metadatos.serie)));
  const [meta, setMeta] = useState<DatosLibroConversion>(inicial.datos);
  const [portada, setPortada] = useState<{ vista: string; nueva?: PortadaConversion } | undefined>(analisis.portada ? { vista: analisis.portada } : undefined);
  const [paso, setPaso] = useState(0);
  const pasoMeta = pasos.length;
  const entradaPortada = useRef<HTMLInputElement>(null);
  const idiomas: [string, string][] = [
    ['es', t('Español')],
    ['es-MX', t('Español (México)')],
    ['es-ES', t('Español (España)')],
    ['en', t('Inglés')],
    ['pt-BR', t('Portugués (Brasil)')],
    ['ja', t('Japonés')],
  ];
  const total = pasos.length + 2;
  const cambiar = <K extends keyof DatosLibroConversion>(k: K, v: DatosLibroConversion[K]) => setMeta({ ...meta, [k]: v });
  const elegirPortada = (f?: File) => {
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      const url = String(lector.result);
      setPortada({ vista: url, nueva: { nombre: f.name, datos: url.slice(url.indexOf(',') + 1) } });
    };
    lector.readAsDataURL(f);
  };
  const todas = pasos.flatMap((p) => p.opciones);
  const conservar = todas.filter((x) => x.disponible && op[x.clave] && x.clave !== 'optimizarImagenes');
  const noConservar = todas.filter((x) => x.disponible && !op[x.clave] && x.clave !== 'optimizarImagenes');
  const nombres = [...pasos.map((p) => p.titulo), t('Metadatos'), t('Confirmar')];
  const enConfirmar = paso === pasos.length + 1;
  // Vista previa del original y del resultado al llegar a «Confirmar» (y cada vez que cambian las opciones).
  const claveOp = JSON.stringify(op);
  useEffect(() => {
    if (!enConfirmar) return;
    let vivo = true;
    setVista('cargando');
    api.vistaConversion(op).then((r) => vivo && setVista(r)).catch(() => vivo && setVista('error'));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enConfirmar, claveOp]);

  return (
    <div className="sencillo">
      <div className="caja-sencillo asistente">
        <header>
          <h1>{t('Conversión sencilla')}</h1>
          <button className="enlace" onClick={onCancelar}>{t('Cancelar')}</button>
        </header>
        <p className="ayuda">
          {t('«{0}» (secciones de texto: {1} · imágenes: {2} · notas: {3}). Elige qué conservar del diseño original.', {
            0: analisis.titulo,
            1: analisis.secciones,
            2: analisis.imagenes,
            3: analisis.notas,
          })}
        </p>
        {previas && analisis.serie && <p className="nota-serie">{t('Se usan las opciones que elegiste para la serie «{0}».', { 0: analisis.serie })}</p>}
        <ol className="pasos-asistente">
          {nombres.map((n, k) => (
            <li key={n} className={k === paso ? 'actual' : k < paso ? 'hecho' : ''} aria-current={k === paso ? 'step' : undefined}>
              <span>{k + 1}</span> {n}
            </li>
          ))}
        </ol>

        {paso < pasos.length ? (
          <fieldset className="opciones-asistente">
            <legend>{pasos[paso].titulo}</legend>
            {pasos[paso].opciones.map((x) => (
              <label key={x.clave} className={`opcion-asistente${x.disponible ? '' : ' no-disponible'}`}>
                <input type="checkbox" disabled={!x.disponible} checked={!!op[x.clave]} onChange={(e) => setOp({ ...op, [x.clave]: e.target.checked })} />
                <span>
                  <strong>{x.titulo}</strong>
                  <small>{x.disponible ? x.detalle : t('No se encontró en el original.')}</small>
                  {x.ayuda && <small className="ayuda-opcion">{x.ayuda}</small>}
                </span>
              </label>
            ))}
          </fieldset>
        ) : paso === pasoMeta ? (
          <fieldset className="opciones-asistente metadatos-asistente">
            <legend>{t('Metadatos')}</legend>
            <p className="ayuda">{t('Vienen del original; revísalos o corrígelos antes de convertir.')}</p>
            {inicial.usados && <p className="nota-serie">{t('Se completaron con los datos del volumen anterior de la serie «{0}».', { 0: meta.serie ?? '' })}</p>}
            <div className="rejilla-metadatos">
              <div className="campos-metadatos">
                <label>
                  <span>{t('Título')}</span>
                  <input value={meta.titulo} onChange={(e) => cambiar('titulo', e.target.value)} />
                </label>
                <label>
                  <span>{t('Subtítulo')}</span>
                  <input value={meta.subtitulo ?? ''} onChange={(e) => cambiar('subtitulo', e.target.value)} />
                </label>
                <div className="fila-metadatos">
                  <label>
                    <span>{t('Serie')}</span>
                    <input value={meta.serie ?? ''} onChange={(e) => cambiar('serie', e.target.value)} />
                  </label>
                  <label className="corto">
                    <span>{t('Volumen')}</span>
                    <input type="number" min={0} step={0.5} value={meta.volumen ?? ''} onChange={(e) => cambiar('volumen', e.target.value ? Number(e.target.value) : undefined)} />
                  </label>
                </div>
                <div className="creditos-metadatos">
                  <span>{t('Créditos')}</span>
                  {meta.creditos.map((c, k) => (
                    <div key={k} className="fila-credito">
                      <input aria-label={t('Nombre')} value={c.nombre} onChange={(e) => cambiar('creditos', meta.creditos.map((x, j) => (j === k ? { ...x, nombre: e.target.value } : x)))} />
                      <select aria-label={t('Rol')} value={c.rol} onChange={(e) => cambiar('creditos', meta.creditos.map((x, j) => (j === k ? { ...x, rol: e.target.value as Credito['rol'] } : x)))}>
                        {ROLES.map((r) => (
                          <option key={r.id} value={r.id}>{r.nombre}</option>
                        ))}
                      </select>
                      <button className="pequeno" aria-label={t('Quitar crédito')} onClick={() => cambiar('creditos', meta.creditos.filter((_, j) => j !== k))}>✕</button>
                    </div>
                  ))}
                  <button className="pequeno" onClick={() => cambiar('creditos', [...meta.creditos, { nombre: '', rol: meta.creditos.length ? 'trl' : 'aut' }])}>{t('Añadir crédito')}</button>
                </div>
                <div className="fila-metadatos">
                  <label>
                    <span>{t('Idioma')}</span>
                    <select value={meta.idioma} onChange={(e) => cambiar('idioma', e.target.value)}>
                      {!idiomas.some(([c]) => c === meta.idioma) && <option value={meta.idioma}>{meta.idioma}</option>}
                      {idiomas.map(([c, n]) => (
                        <option key={c} value={c}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t('Fecha')}</span>
                    <input type="date" value={meta.fecha ?? ''} onChange={(e) => cambiar('fecha', e.target.value)} />
                  </label>
                </div>
                <label>
                  <span>{t('ISBN o identificador')}</span>
                  <input value={meta.identificador} onChange={(e) => cambiar('identificador', e.target.value)} />
                </label>
                <label>
                  <span>{t('Editorial')}</span>
                  <input value={meta.editorial ?? ''} onChange={(e) => cambiar('editorial', e.target.value)} />
                </label>
                <label>
                  <span>{t('Descripción')}</span>
                  <textarea rows={3} value={meta.descripcion ?? ''} onChange={(e) => cambiar('descripcion', e.target.value)} />
                </label>
                <label>
                  <span>{t('Derechos')}</span>
                  <input value={meta.derechos ?? ''} onChange={(e) => cambiar('derechos', e.target.value)} />
                </label>
              </div>
              <div className="portada-metadatos">
                <span>{t('Portada')}</span>
                {portada ? <img src={portada.vista} alt={t('Portada')} /> : <div className="sin-portada">{t('Sin portada')}</div>}
                <input ref={entradaPortada} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => elegirPortada(e.target.files?.[0])} />
                <button className="pequeno" onClick={() => entradaPortada.current?.click()}>{portada ? t('Cambiar portada…') : t('Elegir portada…')}</button>
                {portada?.nueva && (
                  <button className="enlace" onClick={() => setPortada(analisis.portada ? { vista: analisis.portada } : undefined)}>{t('Volver a la del original')}</button>
                )}
              </div>
            </div>
          </fieldset>
        ) : (
          <div className="confirmar-asistente">
            <h2>{t('Se conservará')}</h2>
            <ul>
              <li>{t('El texto, los formatos (negrita, cursiva, alineaciones…), las notas, la portada y las imágenes.')}</li>
              {conservar.map((x) => (
                <li key={x.clave}>{x.titulo}{x.detalle ? `: ${x.detalle}` : ''}</li>
              ))}
              <li>{op.optimizarImagenes ? t('Las imágenes, reducidas para el EPUB.') : t('Las imágenes originales, sin recomprimir.')}</li>
              <li>
                {t('Metadatos: «{0}»', { 0: meta.titulo || analisis.titulo })}
                {meta.creditos.filter((c) => c.nombre.trim()).length ? ` · ${meta.creditos.filter((c) => c.nombre.trim()).map((c) => c.nombre).join(', ')}` : ''}
                {meta.serie ? ` · ${meta.serie}${meta.volumen ? ` ${meta.volumen}` : ''}` : ''}
                {portada?.nueva ? ` · ${t('portada nueva')}` : ''}
              </li>
            </ul>
            {noConservar.length > 0 && (
              <>
                <h2>{t('No se conservará (se usa el tema de Obi Studio)')}</h2>
                <ul>
                  {noConservar.map((x) => (
                    <li key={x.clave}>{x.titulo}</li>
                  ))}
                </ul>
              </>
            )}
            <h2>{t('Vista previa')}</h2>
            {vista === 'cargando' && <p className="ayuda">{t('Preparando la vista previa…')}</p>}
            {vista === 'error' && <p className="ayuda">{t('No se pudo preparar la vista previa.')}</p>}
            {vista && typeof vista === 'object' && (
              <div className={`comparar-conversion${vista.original ? '' : ' solo'}`}>
                {vista.original && (
                  <figure>
                    <figcaption>{t('Original')}</figcaption>
                    <iframe key={vista.original} src={vista.original} title={t('Original')} sandbox="allow-same-origin" />
                  </figure>
                )}
                <figure>
                  <figcaption>{t('Resultado')}</figcaption>
                  <iframe key={vista.convertido} src={vista.convertido} title={t('Resultado')} sandbox="allow-same-origin" />
                </figure>
              </div>
            )}
            {vista && typeof vista === 'object' && !vista.original && <p className="ayuda">{t('Del Word solo se muestra el resultado.')}</p>}
          </div>
        )}

        <div className="botones-sencillo">
          {paso > 0 && <button disabled={ocupado} onClick={() => setPaso(paso - 1)}>{t('Atrás')}</button>}
          {paso < total - 1 ? (
            <button className="principal" onClick={() => setPaso(paso + 1)}>{t('Siguiente')}</button>
          ) : (
            <button className="principal grande" disabled={ocupado} onClick={() => {
                const serie = meta.serie?.trim() || analisis.serie;
                recordar(serie, op);
                recordarDatos(meta);
                onConvertir({ ...op, metadatos: { ...meta, creditos: meta.creditos.filter((c) => c.nombre.trim()) }, ...(portada?.nueva ? { portada: portada.nueva } : {}) });
              }}>{ocupado ? t('Convirtiendo…') : t('Convertir')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
