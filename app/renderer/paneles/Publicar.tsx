import { useEffect, useState } from 'react';
import { TIENDAS } from '../../../src/tiendas-lista';
import { api, descargar, ErrorApi, type AvisoTienda } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  onCerrar: () => void;
  onIrA: (seccion: string) => void;
  onErrores: (datos: unknown) => void;
}

const ICONO: Record<AvisoTienda['gravedad'], string> = { ok: '✓', info: 'ℹ', aviso: '⚠', error: '✕' };

/** Publicar en tiendas: revisión con las reglas de cada una y EPUB ajustado. */
export function Publicar({ onCerrar, onIrA, onErrores }: Props) {
  const [tienda, setTienda] = useState<string>(TIENDAS[0].id);
  const [avisos, setAvisos] = useState<AvisoTienda[]>();
  const [ocupado, setOcupado] = useState('');

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  useEffect(() => {
    setAvisos(undefined);
    let vigente = true;
    api
      .revisarTienda(tienda)
      .then((a) => vigente && setAvisos(a))
      .catch((e) => aviso((e as Error).message, 'error'));
    return () => {
      vigente = false;
    };
  }, [tienda]);

  const t0 = TIENDAS.find((x) => x.id === tienda)!;
  const errores = avisos?.filter((a) => a.gravedad === 'error').length ?? 0;

  const exportar = async () => {
    setOcupado(t('Creando el EPUB para {0}…', { 0: t0.nombre }));
    try {
      await descargar(`/api/tiendas/${tienda}/exportar`);
      aviso(t('EPUB para {0} exportado y validado.', { 0: t0.nombre }));
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409) onErrores(e.datos);
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins panel-publicar" role="dialog" aria-modal="true" aria-labelledby="titulo-publicar">
        <div className="cabecera-plugins">
          <h2 id="titulo-publicar">{t('Publicar en tiendas')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <div className="tiendas" role="radiogroup" aria-label={t('Tienda')}>
          {TIENDAS.map((x) => (
            <button key={x.id} role="radio" aria-checked={tienda === x.id} className={tienda === x.id ? 'activa' : ''} onClick={() => setTienda(x.id)}>
              {x.nombre}
            </button>
          ))}
        </div>
        <p className="ayuda">
          {t('Revisa el libro con las reglas de la tienda. El EPUB que se exporta reduce las imágenes que superan su límite; las de impresión y el proyecto no cambian.')}{' '}
          <a href={t0.ayuda} target="_blank" rel="noreferrer">{t('Requisitos oficiales')}</a>
        </p>
        {!avisos ? (
          <p className="ayuda" role="status">{t('Revisando…')}</p>
        ) : (
          <ul className="lista-tienda">
            {avisos.map((a, k) => (
              <li key={k} className={a.gravedad}>
                <span className="icono-tienda" aria-hidden="true">{ICONO[a.gravedad]}</span>
                <span>
                  {t(a.plantilla, a.valores)}
                  {a.seccion && (
                    <button className="enlace" onClick={() => { onIrA(a.seccion!); onCerrar(); }}>
                      {t('Ir a la sección')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
        <div className="botones-dialogo">
          <button onClick={() => descargar('/api/portada').catch((e) => aviso((e as Error).message, 'error'))}>{t('Descargar portada')}</button>
          <button className="principal" disabled={!avisos || !!ocupado || errores > 0} title={errores ? t('Corrige primero los errores marcados con ✕') : undefined} onClick={exportar}>
            {t('Exportar EPUB para {0}', { 0: t0.nombre })}
          </button>
        </div>
      </div>
    </div>
  );
}
