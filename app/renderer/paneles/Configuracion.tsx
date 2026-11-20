import { useEffect, useState } from 'react';
import { api, type Estado } from '../api';
import { aviso } from '../dialogos';
import { cambiarIdioma, idiomaInterfaz, t } from '../i18n';

interface Props {
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
  onConfiguracion: (c: { colaboracion: boolean }) => void;
}

/** Configuración de la app: idioma de la interfaz y funciones opcionales. */
export function Configuracion({ onCerrar, onEstado, onConfiguracion }: Props) {
  const [c, setC] = useState<{ colaboracion: boolean }>();

  useEffect(() => {
    api.configuracion().then(setC).catch((e) => aviso((e as Error).message, 'error'));
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const cambiar = async (colaboracion: boolean) => {
    try {
      const r = await api.cambiarConfiguracion({ colaboracion });
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
            <input type="checkbox" checked={!!c?.colaboracion} disabled={!c} onChange={(e) => void cambiar(e.target.checked)} />
            {t('Permitir colaborar en la red local')}
          </label>
          <small className="ayuda">
            {t('Desactivada por defecto. Al activarla aparece «Colaborar en la red local…» en el menú «Más»: Obi Studio abre una conexión en tu red solo mientras compartes un libro. Al desactivarla se cierra cualquier colaboración abierta.')}
          </small>
        </fieldset>
      </div>
    </div>
  );
}
