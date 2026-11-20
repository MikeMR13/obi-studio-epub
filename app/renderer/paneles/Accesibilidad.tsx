import { useState } from 'react';
import { api, descargar, type InformeAccesibilidad } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

const IMPACTO: Record<string, string> = { critical: t('Crítico'), serious: t('Grave'), moderate: t('Moderado'), minor: t('Menor') };

/** Revisión de accesibilidad (axe-core + EPUB Accessibility 1.1), dentro de la pestaña Validación. */
export function Accesibilidad({ onIrA }: { onIrA: (seccion: string) => void }) {
  const [informe, setInforme] = useState<InformeAccesibilidad>();
  const [revisando, setRevisando] = useState(false);

  const revisar = async () => {
    setRevisando(true);
    try {
      setInforme(await api.accesibilidad());
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setRevisando(false);
    }
  };

  return (
    <section className="accesibilidad" aria-label={t('Accesibilidad')}>
      <h3>{t('Accesibilidad')}</h3>
      <p className="ayuda">{t('Revisa cada página del libro con axe-core (WCAG 2.1 AA) y las reglas de EPUB Accessibility 1.1.')}</p>
      <div className="fila-botones">
        <button onClick={revisar} disabled={revisando}>{revisando ? t('Revisando…') : t('Revisar accesibilidad')}</button>
        {informe && (
          <button onClick={() => descargar('/api/accesibilidad/informe').catch((e) => aviso((e as Error).message, 'error'))}>{t('Guardar informe')}</button>
        )}
      </div>
      {informe && (
        <div className="resultado-validacion">
          {informe.conforme ? (
            <p className="ok">{t('✓ Sin problemas graves: puede declarar EPUB Accessibility 1.1 – WCAG 2.1 AA.')}</p>
          ) : (
            <p className="error">{t('✕ Hay problemas que corregir antes de declarar la accesibilidad.')}</p>
          )}
          <ul className="mensajes">
            {informe.comprobaciones
              .filter((c) => !c.ok)
              .map((c) => (
                <li key={c.nombre} className="error">
                  <strong>{c.nombre}</strong> {c.detalle}
                  {c.seccion && (
                    <button className="enlace" onClick={() => onIrA(c.seccion!)}>
                      {t('Ir a la sección')}
                    </button>
                  )}
                </li>
              ))}
            {informe.incidencias.map((x, k) => (
              <li key={k} className={x.impacto === 'critical' || x.impacto === 'serious' ? 'error' : 'aviso'}>
                <strong>{IMPACTO[x.impacto]}</strong> {x.ayuda}
                {x.cantidad > 1 ? ` (${x.cantidad} casos)` : ''}
                {x.nodos[0] && <code className="nodo-axe">{x.nodos[0]}</code>}
                {x.seccion && (
                  <button className="enlace" onClick={() => onIrA(x.seccion!)}>
                    {t("Ir a «{0}»", { 0: x.tituloSeccion })}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="ayuda">
            {t('{0} páginas revisadas con axe-core {1}. {2} comprobaciones del libro correctas.', { 0: informe.documentos, 1: informe.version, 2: informe.comprobaciones.filter((c) => c.ok).length })}
          </p>
        </div>
      )}
    </section>
  );
}
