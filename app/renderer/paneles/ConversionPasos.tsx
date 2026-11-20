import { useState } from 'react';
import type { AnalisisConversion, OpcionesConversionSencilla } from '../api';
import { t } from '../i18n';

interface Props {
  analisis: AnalisisConversion;
  ocupado: boolean;
  onCancelar: () => void;
  onConvertir: (o: OpcionesConversionSencilla) => void;
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
  ].filter(Boolean);
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
      titulo: t('Espaciado'),
      opciones: [
        { clave: 'espacioParrafos', titulo: t('Espacio entre párrafos'), detalle: d?.espacio ? (d.espacio.general ? em(d.espacio.general) : t('ninguno (párrafos seguidos)')) : '', disponible: !!d?.espacio },
        {
          clave: 'espacioPorParrafo',
          titulo: t('Espacio propio de cada párrafo'),
          detalle: d?.parrafosConEspacio ? t('{0} párrafos con un espacio distinto', { 0: d.parrafosConEspacio }) : '',
          disponible: !!d?.parrafosConEspacio,
          ayuda: analisis.tipo === 'docx' ? t('De un Word solo se puede leer el espacio general.') : undefined,
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

  const [op, setOp] = useState<OpcionesConversionSencilla>(() => {
    const o = {} as OpcionesConversionSencilla;
    for (const p of pasos) for (const x of p.opciones) o[x.clave] = x.clave === 'optimizarImagenes' ? false : x.disponible;
    return o;
  });
  const [paso, setPaso] = useState(0);
  const total = pasos.length + 1;
  const todas = pasos.flatMap((p) => p.opciones);
  const conservar = todas.filter((x) => x.disponible && op[x.clave] && x.clave !== 'optimizarImagenes');
  const noConservar = todas.filter((x) => x.disponible && !op[x.clave] && x.clave !== 'optimizarImagenes');
  const nombres = [...pasos.map((p) => p.titulo), t('Confirmar')];

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
        ) : (
          <div className="confirmar-asistente">
            <h2>{t('Se conservará')}</h2>
            <ul>
              <li>{t('El texto, los formatos (negrita, cursiva, alineaciones…), las notas, la portada y las imágenes.')}</li>
              {conservar.map((x) => (
                <li key={x.clave}>{x.titulo}{x.detalle ? ` (${x.detalle})` : ''}</li>
              ))}
              <li>{op.optimizarImagenes ? t('Las imágenes, reducidas para el EPUB.') : t('Las imágenes originales, sin recomprimir.')}</li>
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
          </div>
        )}

        <div className="botones-sencillo">
          {paso > 0 && <button disabled={ocupado} onClick={() => setPaso(paso - 1)}>{t('Atrás')}</button>}
          {paso < total - 1 ? (
            <button className="principal" onClick={() => setPaso(paso + 1)}>{t('Siguiente')}</button>
          ) : (
            <button className="principal grande" disabled={ocupado} onClick={() => onConvertir(op)}>{ocupado ? t('Convirtiendo…') : t('Convertir')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
