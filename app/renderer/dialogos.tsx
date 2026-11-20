// Diálogos propios (Electron no admite window.prompt) y avisos breves.

import { useEffect, useRef, useState } from 'react';

export interface Campo {
  nombre: string;
  etiqueta: string;
  valor?: string;
  tipo?: 'texto' | 'area';
  ayuda?: string;
}

interface Peticion {
  titulo: string;
  campos: Campo[];
  aceptar: string;
  peligro?: boolean;
  mensaje?: string;
  soloAceptar?: boolean;
  resolver: (v: Record<string, string> | null) => void;
}

let mostrar: ((p: Peticion) => void) | undefined;
let notificar: ((t: string, tipo: 'ok' | 'error') => void) | undefined;

export function pedirDatos(titulo: string, campos: Campo[], aceptar = 'Aceptar', mensaje?: string): Promise<Record<string, string> | null> {
  return new Promise((resolver) => mostrar?.({ titulo, campos, aceptar, mensaje, resolver }));
}

export async function confirmar(titulo: string, mensaje: string, aceptar = 'Continuar', peligro = false): Promise<boolean> {
  const r = await new Promise<Record<string, string> | null>((resolver) => mostrar?.({ titulo, campos: [], aceptar, mensaje, peligro, resolver }));
  return r !== null;
}

/** Mensaje informativo con un único botón. */
export async function informar(titulo: string, mensaje: string, aceptar = 'Entendido'): Promise<void> {
  await new Promise<Record<string, string> | null>((resolver) => mostrar?.({ titulo, campos: [], aceptar, mensaje, soloAceptar: true, resolver }));
}

export function aviso(texto: string, tipo: 'ok' | 'error' = 'ok') {
  notificar?.(texto, tipo);
}

export function Dialogos() {
  const [p, setP] = useState<Peticion | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<{ id: number; texto: string; tipo: 'ok' | 'error' }[]>([]);
  const primero = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const botonAceptar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mostrar = (x) => {
      setP(x);
      setValores(Object.fromEntries(x.campos.map((c) => [c.nombre, c.valor ?? ''])));
    };
    notificar = (texto, tipo) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, texto, tipo }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'error' ? 7000 : 3500);
    };
  }, []);
  useEffect(() => {
    if (p) setTimeout(() => (primero.current ?? botonAceptar.current)?.focus(), 30);
  }, [p]);

  const cerrar = (v: Record<string, string> | null) => {
    p?.resolver(v);
    setP(null);
  };

  return (
    <>
      {p && (
        <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && cerrar(null)}>
          <form
            className="dialogo"
            role="dialog"
            aria-modal="true"
            aria-label={p.titulo}
            onSubmit={(e) => {
              e.preventDefault();
              cerrar(valores);
            }}
            onKeyDown={(e) => e.key === 'Escape' && cerrar(null)}
          >
            <h2>{p.titulo}</h2>
            {p.mensaje && <p className="mensaje-dialogo" style={{ whiteSpace: 'pre-line' }}>{p.mensaje}</p>}
            {p.campos.map((c, k) => (
              <label key={c.nombre} className="campo">
                <span>{c.etiqueta}</span>
                {c.tipo === 'area' ? (
                  <textarea
                    ref={k === 0 ? primero : undefined}
                    rows={4}
                    value={valores[c.nombre] ?? ''}
                    onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })}
                  />
                ) : (
                  <input
                    ref={k === 0 ? primero : undefined}
                    value={valores[c.nombre] ?? ''}
                    onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })}
                  />
                )}
                {c.ayuda && <small>{c.ayuda}</small>}
              </label>
            ))}
            <div className="botones-dialogo">
              {!p.soloAceptar && (
                <button type="button" onClick={() => cerrar(null)}>
                  Cancelar
                </button>
              )}
              <button ref={botonAceptar} type="submit" className={p.peligro ? 'peligro' : 'principal'}>
                {p.aceptar}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`}>
            {t.texto}
          </div>
        ))}
      </div>
    </>
  );
}
