import { useEffect, useState } from 'react';
import { api, type Estado } from '../api';
import { aviso } from '../dialogos';
import { cambiarIdioma, idiomaInterfaz, t } from '../i18n';
import type { Configuracion as DatosConfiguracion } from '../../../src/configuracion';
import { IDIOMAS_CORRECTOR } from '../../../src/idiomas-corrector';

interface Props {
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
  onConfiguracion: (c: DatosConfiguracion) => void;
  /** Es la app de escritorio (las actualizaciones solo existen ahí). */
  escritorio?: boolean;
}

/** Configuración de la app: idioma de la interfaz, corrector, actualizaciones y funciones opcionales. */
export function Configuracion({ onCerrar, onEstado, onConfiguracion, escritorio }: Props) {
  const [c, setC] = useState<DatosConfiguracion>();
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    api.configuracion().then(setC).catch((e) => aviso((e as Error).message, 'error'));
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const cambiar = async (cambios: Partial<DatosConfiguracion>) => {
    try {
      const r = await api.cambiarConfiguracion(cambios);
      setC(r.configuracion);
      onConfiguracion(r.configuracion);
      onEstado(r.estado);
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins" role="dialog" aria-modal="true" aria-labelledby="titulo-configuracion">
        <div className="cabecera-plugins">
          <h2 id="titulo-configuracion">{t('Configuración')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <label className="campo">
          <span>{t('Idioma de la interfaz')}</span>
          <select value={idiomaInterfaz()} onChange={(e) => cambiarIdioma(e.target.value as 'es' | 'en')}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
          <small>{t('El idioma del libro se elige en la pestaña Libro.')}</small>
        </label>
        <fieldset className="grupo">
          <legend>{t('Colaboración')}</legend>
          <label className="casilla">
            <input type="checkbox" checked={!!c?.colaboracion} disabled={!c} onChange={(e) => void cambiar({ colaboracion: e.target.checked })} />
            {t('Permitir colaborar en la red local')}
          </label>
          <small className="ayuda">
            {t('Desactivada por defecto. Al activarla aparece «Colaborar en la red local…» en el menú «Más»: Obi Studio abre una conexión en tu red solo mientras compartes un libro. Al desactivarla se cierra cualquier colaboración abierta.')}
          </small>
        </fieldset>
        <fieldset className="grupo">
          <legend>{t('Corrector ortográfico')}</legend>
          <div className="idiomas-corrector">
            {IDIOMAS_CORRECTOR.map((x) => (
              <label key={x.codigo} className="casilla">
                <input
                  type="checkbox"
                  disabled={!c}
                  checked={!!c?.idiomasCorrector.includes(x.codigo)}
                  onChange={(e) => c && void cambiar({ idiomasCorrector: e.target.checked ? [...c.idiomasCorrector, x.codigo] : c.idiomasCorrector.filter((y) => y !== x.codigo) })}
                />
                {t(x.nombre)}
              </label>
            ))}
          </div>
          <label className="casilla">
            <input type="checkbox" disabled={!c} checked={!!c?.corregirIdiomaLibro} onChange={(e) => void cambiar({ corregirIdiomaLibro: e.target.checked })} />
            {t('Añadir siempre el idioma del libro abierto')}
          </label>
          <small className="ayuda">{t('En Windows y macOS se usa el corrector del sistema, que reconoce el idioma solo; en Linux se usan estos diccionarios.')}</small>
        </fieldset>
        <fieldset className="grupo">
          <legend>{t('Actualizaciones')}</legend>
          <label className="casilla">
            <input type="checkbox" disabled={!c} checked={!!c?.buscarActualizaciones} onChange={(e) => void cambiar({ buscarActualizaciones: e.target.checked })} />
            {t('Buscar versiones nuevas al abrir la app')}
          </label>
          <small className="ayuda">{t('La versión nueva se descarga en segundo plano y se instala al cerrar la app. Solo en la app de escritorio instalada.')}</small>
          {escritorio && (
            <button
              className="pequeno"
              disabled={buscando}
              onClick={async () => {
                setBuscando(true);
                try {
                  const r = await api.comprobarActualizacion();
                  onEstado(r.estado);
                  aviso(r.version ? t('Hay una versión nueva: {0}. Se descarga en segundo plano.', { 0: r.version }) : t('Tienes la última versión.'));
                } catch (e) {
                  aviso((e as Error).message, 'error');
                } finally {
                  setBuscando(false);
                }
              }}
            >
              {buscando ? t('Buscando…') : t('Buscar ahora')}
            </button>
          )}
        </fieldset>
      </div>
    </div>
  );
}
