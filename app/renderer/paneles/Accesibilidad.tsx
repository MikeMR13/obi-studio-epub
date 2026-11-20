import { useState } from 'react';
import { api, descargar, type InformeAccesibilidad } from '../api';
import { aviso } from '../dialogos';

const IMPACTO: Record<string, string> = { critical: 'Crítico', serious: 'Grave', moderate: 'Moderado', minor: 'Menor' };

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
    <section className="accesibilidad" aria-label="Accesibilidad">
      <h3>Accesibilidad</h3>
      <p className="ayuda">Revisa cada página del libro con axe-core (WCAG 2.1 AA) y las reglas de EPUB Accessibility 1.1.</p>
      <div className="fila-botones">
        <button onClick={revisar} disabled={revisando}>{revisando ? 'Revisando…' : 'Revisar accesibilidad'}</button>
        {informe && (
          <button onClick={() => descargar('/api/accesibilidad/informe').catch((e) => aviso((e as Error).message, 'error'))}>Guardar informe</button>
        )}
      </div>
      {informe && (
        <div className="resultado-validacion">
          {informe.conforme ? (
            <p className="ok">✓ Sin problemas graves: puede declarar EPUB Accessibility 1.1 – WCAG 2.1 AA.</p>
          ) : (
            <p className="error">✕ Hay problemas que corregir antes de declarar la accesibilidad.</p>
          )}
          <ul className="mensajes">
            {informe.comprobaciones
              .filter((c) => !c.ok)
              .map((c) => (
                <li key={c.nombre} className="error">
                  <strong>{c.nombre}</strong> {c.detalle}
                  {c.seccion && (
                    <button className="enlace" onClick={() => onIrA(c.seccion!)}>
                      Ir a la sección
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
                    Ir a «{x.tituloSeccion}»
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="ayuda">
            {informe.documentos} páginas revisadas con axe-core {informe.version}. {informe.comprobaciones.filter((c) => c.ok).length} comprobaciones del libro correctas.
          </p>
        </div>
      )}
    </section>
  );
}
