import { useEffect, useState } from 'react';
import { api } from '../api';
import { aviso } from '../dialogos';
import type { Estado } from '../api';

interface Props {
  seccionId: string;
  version: number;
  onAplicado: (estado: Estado, secciones: string[]) => void;
}

export function Codigo({ seccionId, version, onAplicado }: Props) {
  const [original, setOriginal] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.codigo(seccionId).then(({ xhtml }) => {
      if (!vivo) return;
      setOriginal(xhtml);
      setTexto(xhtml);
      setError('');
    });
    return () => {
      vivo = false;
    };
  }, [seccionId, version]);

  const aplicar = async () => {
    setAplicando(true);
    try {
      const r = await api.aplicarCodigo(seccionId, texto);
      setError('');
      aviso(r.secciones.length > 1 ? `Código aplicado: la sección se dividió en ${r.secciones.length}.` : 'Código aplicado.');
      onAplicado(r.estado, r.secciones);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAplicando(false);
    }
  };

  const cambiado = texto !== original;
  return (
    <div className="codigo">
      <div className="barra-codigo">
        <span className="ayuda">XHTML de esta sección. Al aplicar, vuelve al editor visual. Un nuevo &lt;h1&gt; divide la sección.</span>
        <button onClick={() => setTexto(original)} disabled={!cambiado}>Descartar</button>
        <button className="principal" onClick={aplicar} disabled={!cambiado || aplicando}>{aplicando ? 'Aplicando…' : 'Aplicar cambios'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <textarea
        className="area-codigo"
        spellCheck={false}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Código XHTML de la sección"
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const i = el.selectionStart;
            setTexto(texto.slice(0, i) + '  ' + texto.slice(el.selectionEnd));
            requestAnimationFrame(() => el.setSelectionRange(i + 2, i + 2));
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (cambiado) void aplicar();
          }
        }}
      />
    </div>
  );
}
