import { descargar, type ResultadoLote } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  total: number;
  resultados: ResultadoLote[];
  enCurso: boolean;
  onInicio: () => void;
}

/** Progreso y resultado de una conversión de varios volúmenes. */
export function Lote({ total, resultados, enCurso, onInicio }: Props) {
  const correctos = resultados.filter((r) => r.ok).length;
  return (
    <div className="sencillo">
      <div className="caja-sencillo">
        <header>
          <h1>{t('Conversión de varios volúmenes')}</h1>
          {!enCurso && <button className="enlace" onClick={onInicio}>{t('Volver al inicio')}</button>}
        </header>
        <div className="progreso-lote" role="status">
          <progress max={total} value={resultados.length} aria-label={t('Volúmenes convertidos')} />
          <span>
            {enCurso ? t('Convirtiendo {0} de {1}…', { 0: Math.min(resultados.length + 1, total), 1: total }) : t('{0} de {1} volúmenes convertidos y validados.', { 0: correctos, 1: total })}
          </span>
        </div>
        <ol className="resultados-lote">
          {resultados.map((r, k) => (
            <li key={k} className={r.ok ? 'ok' : 'error'}>
              <strong>{r.ok ? '✓' : '✕'} {r.titulo}</strong>
              <small>{r.ok ? r.archivo : r.nombre}</small>
              {r.errores.length > 0 && (
                <ul>
                  {r.errores.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              )}
              {r.avisos.length > 0 && (
                <details>
                  <summary>{t('Avisos: {0}', { 0: r.avisos.length })}</summary>
                  <ul>
                    {r.avisos.map((e, j) => (
                      <li key={j}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>
        {!enCurso && correctos > 0 && (
          <div className="botones-sencillo">
            <button
              className="principal grande"
              onClick={async () => {
                try {
                  await descargar('/api/lote/descargar');
                } catch (e) {
                  aviso((e as Error).message, 'error');
                }
              }}
            >
              {t('Descargar los EPUB (.zip)')}
            </button>
          </div>
        )}
        {!enCurso && correctos < resultados.length && <p className="ayuda">{t('Los volúmenes con errores se pueden convertir uno a uno para revisarlos en el editor.')}</p>}
      </div>
    </div>
  );
}
