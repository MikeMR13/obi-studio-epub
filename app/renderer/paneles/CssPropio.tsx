import { useEffect, useMemo, useState } from 'react';
import { revisarCss } from '../../../src/css-propio';
import { api, type Estado } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

/** CSS propio del libro (avanzado): se revisa mientras se escribe y solo se guarda si no tiene problemas. */
export function CssPropio({ estado, onEstado }: { estado: Estado; onEstado: (e: Estado) => void }) {
  const guardado = estado.libro.cssPropio ?? '';
  const [css, setCss] = useState(guardado);
  useEffect(() => setCss(guardado), [guardado]);
  const problemas = useMemo(() => revisarCss(css, estado.libro as never), [css, estado.libro.recursos]);
  const aplicar = async () => {
    try {
      const r = await api.cssPropio(css);
      onEstado(r.estado);
      if (!r.problemas.length) aviso(t('CSS propio aplicado.'));
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };
  return (
    <details className="seccion-tema">
      <summary>{t('CSS propio (avanzado)')}</summary>
      <p className="ayuda">{t('Se añade después del tema, en el EPUB y en el PDF. Las imágenes se citan como url(img/nombre.png). Se revisa con las reglas de EPUBCheck.')}</p>
      <textarea className="area-css" rows={8} spellCheck={false} aria-label={t('CSS propio')} value={css} onChange={(e) => setCss(e.target.value)} placeholder="p.carta { font-family: serif; }" />
      {problemas.length > 0 && (
        <ul className="mensajes">
          {problemas.map((p, k) => (
            <li key={k} className="error">
              <strong>{t('Línea {0}', { 0: p.linea })}</strong> {t(p.plantilla, p.valores)}
            </li>
          ))}
        </ul>
      )}
      <button disabled={problemas.length > 0 || css === guardado} onClick={aplicar}>{t('Aplicar CSS')}</button>
    </details>
  );
}
