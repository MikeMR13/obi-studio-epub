import { useEffect, useRef, useState } from 'react';
import { api, type Coincidencia, type Estado } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  seccionActual?: string;
  /** Abrir con el campo de reemplazo visible. */
  conReemplazo: boolean;
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
  onIr: (c: Coincidencia) => void;
}

/** Barra de buscar y reemplazar en todo el libro (Ctrl+F / Ctrl+H). */
export function Buscar({ estado, seccionActual, conReemplazo, onCerrar, onEstado, onIr }: Props) {
  const [consulta, setConsulta] = useState('');
  const [reemplazo, setReemplazo] = useState('');
  const [mayusculas, setMayusculas] = useState(false);
  const [palabra, setPalabra] = useState(false);
  const [regex, setRegex] = useState(false);
  const [soloSeccion, setSoloSeccion] = useState(false);
  const [verReemplazo, setVerReemplazo] = useState(conReemplazo);
  const [resultado, setResultado] = useState<{ coincidencias: Coincidencia[]; total: number }>();
  const [error, setError] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => setVerReemplazo((v) => v || conReemplazo), [conReemplazo]);
  useEffect(() => campo.current?.focus(), [conReemplazo]);

  const opciones = () => ({ consulta, mayusculas, palabraCompleta: palabra, regex, ...(soloSeccion && seccionActual ? { seccion: seccionActual } : {}) });

  // Buscar mientras se escribe (con una pequeña espera).
  useEffect(() => {
    if (!consulta) {
      setResultado(undefined);
      setError('');
      return;
    }
    const t = window.setTimeout(() => {
      api
        .buscar(opciones())
        .then((r) => {
          setResultado(r);
          setError('');
        })
        .catch((e) => {
          setResultado(undefined);
          setError((e as Error).message);
        });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, mayusculas, palabra, regex, soloSeccion, seccionActual, estado.libro]);

  const reemplazarUno = async (c: Coincidencia) => {
    try {
      const r = await api.reemplazar(opciones(), reemplazo, { seccion: c.seccion, lugar: c.lugar, orden: c.orden });
      onEstado(r.estado);
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const reemplazarTodo = async () => {
    try {
      const r = await api.reemplazar(opciones(), reemplazo);
      onEstado(r.estado);
      aviso(r.n ? t('{0} reemplazo{1}.', { 0: r.n, 1: r.n === 1 ? '' : 's' }) : t('No había nada que reemplazar.'));
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const titulo = (id: string) => {
    const s = estado.libro.secciones.find((x) => x.id === id);
    return s?.titulo || s?.tipo || '';
  };

  return (
    <div className="panel-buscar" role="search" onKeyDown={(e) => e.key === 'Escape' && onCerrar()}>
      <div className="fila-buscar">
        <button className="alternar" aria-label={verReemplazo ? t('Ocultar reemplazar') : t('Mostrar reemplazar')} aria-expanded={verReemplazo} onClick={() => setVerReemplazo(!verReemplazo)}>
          {verReemplazo ? '▾' : '▸'}
        </button>
        <input ref={campo} aria-label={t('Buscar')} placeholder={t('Buscar en el libro')} value={consulta} onChange={(e) => setConsulta(e.target.value)} />
        <button className={`opcion${mayusculas ? ' activo' : ''}`} aria-pressed={mayusculas} title={t('Distinguir mayúsculas')} onClick={() => setMayusculas(!mayusculas)}>{t('Aa')}</button>
        <button className={`opcion${palabra ? ' activo' : ''}`} aria-pressed={palabra} title={t('Palabra completa')} onClick={() => setPalabra(!palabra)}>ab</button>
        <button className={`opcion${regex ? ' activo' : ''}`} aria-pressed={regex} title={t('Expresión regular')} onClick={() => setRegex(!regex)}>.*</button>
        <button className="cerrar" aria-label={t('Cerrar búsqueda')} onClick={onCerrar}>✕</button>
      </div>
      {verReemplazo && (
        <div className="fila-buscar">
          <span className="alternar" />
          <input aria-label={t('Reemplazar con')} placeholder={regex ? t('Reemplazar con ($1 para grupos)') : t('Reemplazar con')} value={reemplazo} onChange={(e) => setReemplazo(e.target.value)} />
          <button disabled={!resultado?.total} onClick={reemplazarTodo}>{t('Reemplazar todo')}</button>
        </div>
      )}
      <div className="fila-buscar opciones-buscar">
        <label className="casilla">
          <input type="checkbox" checked={soloSeccion} onChange={(e) => setSoloSeccion(e.target.checked)} />
          {t('Solo esta sección')}
        </label>
        <span className="cuenta" role="status">
          {error ? <span className="error">{error}</span> : resultado ? (resultado.total === 1 ? t('1 resultado') : t('{0} resultados', { 0: resultado.total })) : ''}
        </span>
      </div>
      {resultado && resultado.coincidencias.length > 0 && (
        <ul className="resultados-buscar">
          {resultado.coincidencias.map((c, k) => (
            <li key={`${c.seccion}-${c.lugar}-${c.orden}-${k}`}>
              <button className="resultado" onClick={() => onIr(c)}>
                <span className="donde">{titulo(c.seccion)}{c.lugar.startsWith('n') ? ' · nota' : ''}</span>
                <span className="contexto">
                  …{c.antes}<mark>{c.texto}</mark>{c.despues}…
                </span>
              </button>
              {verReemplazo && (
                <button className="reemplazar-uno" title={t('Reemplazar este')} onClick={() => reemplazarUno(c)}>
                  {t('Reemplazar')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
