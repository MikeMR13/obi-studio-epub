import { useEffect, useState } from 'react';
import type { Bloque, Seccion } from '../../../src/model';
import { TIPOS_SECCION, entradasIndice, subtitulosSeccion } from '../../../src/model';
import type { Estado } from '../api';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onSeccion: (id: string, cambios: Partial<Seccion>) => void;
  onProfundidad: (p: 1 | 2) => void;
  onUnir: (id: string) => void;
  onIrA: (id: string) => void;
  onPaginaIndice: () => void;
}

/** Tabla de contenido: qué sale en el índice, con qué texto y con cuántos niveles, y cómo queda. */
export function IndiceLibro({ estado, onCerrar, onSeccion, onProfundidad, onUnir, onIrA, onPaginaIndice }: Props) {
  const { libro } = estado;
  const dos = libro.profundidadIndice === 2;
  const [textos, setTextos] = useState<Record<string, string>>({});

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const entradas = entradasIndice(libro, { conPaginaIndice: true });
  const paginaIndice = libro.secciones.find((s) => s.tipo === 'indice');
  const sinTitulo = libro.secciones.filter((s) => s.enIndice && !s.titulo && s.tipo !== 'portada').length;

  const guardarTexto = (s: Seccion) => {
    const v = textos[s.id];
    if (v === undefined) return;
    onSeccion(s.id, { tituloIndice: v });
    setTextos(({ [s.id]: _, ...resto }) => resto);
  };

  const cambiarSubtitulo = (s: Seccion, bloque: number, enIndice: boolean) => {
    const bloques: Bloque[] = s.bloques.map((b, i) => {
      if (i !== bloque || b.tipo !== 'subtitulo') return b;
      const { fueraDeIndice: _f, ...resto } = b;
      return enIndice ? resto : { ...resto, fueraDeIndice: true };
    });
    onSeccion(s.id, { bloques });
  };

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins panel-indice" role="dialog" aria-modal="true" aria-labelledby="titulo-indice">
        <div className="cabecera-plugins">
          <h2 id="titulo-indice">{t('Tabla de contenido')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <p className="ayuda">
          {t('El índice del lector (el menú de capítulos) se crea solo con lo que marques aquí. El texto del índice puede ser distinto del título de la página.')}
        </p>
        <div className="opciones-indice">
          <fieldset className="niveles-indice">
            <legend>{t('Niveles')}</legend>
            <label>
              <input type="radio" name="niveles" checked={!dos} onChange={() => onProfundidad(1)} /> {t('Solo secciones')}
            </label>
            <label>
              <input type="radio" name="niveles" checked={dos} onChange={() => onProfundidad(2)} /> {t('Secciones y subtítulos')}
            </label>
          </fieldset>
          {paginaIndice ? (
            <button className="pequeno" onClick={() => onIrA(paginaIndice.id)}>{t('Ir a la página de índice')}</button>
          ) : (
            <button className="pequeno" onClick={onPaginaIndice}>{t('Añadir página de índice al libro')}</button>
          )}
        </div>
        <div className="rejilla-indice">
          <ol className="lista-indice">
            {libro.secciones.map((s, k) => {
              const subtitulos = dos ? subtitulosSeccion(s) : [];
              const sig = libro.secciones[k + 1];
              const unible = sig && !['portada', 'indice'].includes(s.tipo) && !['portada', 'indice'].includes(sig.tipo);
              const tipo = t(TIPOS_SECCION.find((x) => x.id === s.tipo)?.nombre ?? '');
              return (
                <li key={s.id} className={s.enIndice && s.titulo ? '' : 'fuera'}>
                  <div className="fila-indice">
                    <input
                      type="checkbox"
                      checked={s.enIndice}
                      disabled={s.tipo === 'portada'}
                      aria-label={t('«{0}» en el índice', { 0: s.titulo || tipo })}
                      onChange={(e) => onSeccion(s.id, { enIndice: e.target.checked })}
                    />
                    <span className="tipo-indice">{tipo}</span>
                    <input
                      className="texto-indice"
                      value={textos[s.id] ?? s.tituloIndice ?? ''}
                      placeholder={s.titulo || t('(sin título: no sale en el índice)')}
                      aria-label={t('Texto en el índice de «{0}»', { 0: s.titulo || tipo })}
                      disabled={!s.titulo}
                      onChange={(e) => setTextos({ ...textos, [s.id]: e.target.value })}
                      onBlur={() => guardarTexto(s)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <button className="pequeno" title={t('Ir a la sección')} aria-label={t('Ir a «{0}»', { 0: s.titulo || tipo })} onClick={() => onIrA(s.id)}>↗</button>
                    <button
                      className="pequeno"
                      disabled={!unible}
                      title={t('Unir con la sección siguiente')}
                      aria-label={t('Unir «{0}» con la siguiente', { 0: s.titulo || tipo })}
                      onClick={() => onUnir(s.id)}
                    >
                      ⤵
                    </button>
                    {s.tituloIndice && <small className="titulo-en-pagina">{t('En la página: {0}', { 0: s.titulo })}</small>}
                  </div>
                  {subtitulos.length > 0 && (
                    <ol className="subtitulos-indice">
                      {subtitulos.map((x) => (
                        <li key={x.ancla}>
                          <label>
                            <input type="checkbox" checked={x.enIndice} disabled={!s.enIndice} onChange={(e) => cambiarSubtitulo(s, x.bloque, e.target.checked)} />
                            {x.texto || t('(subtítulo vacío)')}
                          </label>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="vista-indice" aria-label={t('Así se verá el índice')}>
            <h3>{t('Así se verá')}</h3>
            {entradas.length ? (
              <ol>
                {entradas.map((e) => (
                  <li key={e.seccion}>
                    {e.texto}
                    {e.hijos.length > 0 && (
                      <ol>
                        {e.hijos.map((h) => (
                          <li key={h.ancla}>{h.texto}</li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ayuda">{t('El índice está vacío: el lector mostrará solo el comienzo del libro.')}</p>
            )}
            {sinTitulo > 0 && <p className="ayuda">{t('{0} secciones marcadas no tienen título y no salen en el índice.', { 0: sinTitulo })}</p>}
            <p className="ayuda">{t('{0} entradas', { 0: entradas.reduce((n, e) => n + 1 + e.hijos.length, 0) })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

