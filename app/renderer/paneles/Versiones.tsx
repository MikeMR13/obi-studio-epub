import { useEffect, useState } from 'react';
import { api, type DiferenciaSeccion, type Estado } from '../api';
import { aviso, confirmar } from '../dialogos';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
}

const ESTADOS: Record<DiferenciaSeccion['estado'], string> = { igual: 'Sin cambios', cambiada: 'Cambiada', nueva: 'Nueva desde entonces', borrada: 'Borrada desde entonces' };

const fecha = (iso: string) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

/** Versiones con nombre del libro: guardar, comparar, restaurar y borrar. */
export function Versiones({ estado, onCerrar, onEstado }: Props) {
  const [nombre, setNombre] = useState('');
  const [comparacion, setComparacion] = useState<{ id: string; filas: DiferenciaSeccion[] }>();

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const intentar = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const guardar = () =>
    intentar(async () => {
      onEstado(await api.crearVersion(nombre));
      aviso(`Versión «${nombre.trim()}» guardada. Se conserva al guardar el proyecto.`);
      setNombre('');
    });

  const versiones = [...estado.versiones].reverse();

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins" role="dialog" aria-modal="true" aria-labelledby="titulo-versiones">
        <div className="cabecera-plugins">
          <h2 id="titulo-versiones">Versiones</h2>
          <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <p className="ayuda">
          Una versión guarda el libro tal como está ahora, con sus imágenes, dentro del proyecto. Antes de importar correcciones de Word se guarda una automáticamente.
        </p>
        <form className="fila-buscar" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
          <input aria-label="Nombre de la versión" placeholder="Por ejemplo: Enviado a corrección" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <button className="principal" type="submit" disabled={!nombre.trim()}>Guardar versión</button>
        </form>
        <ul className="lista-plugins">
          {!versiones.length && <li className="vacio">Todavía no hay versiones.</li>}
          {versiones.map((v) => (
            <li key={v.id}>
              <div className="cabecera-plugin">
                <strong>{v.nombre}</strong> <span>{fecha(v.fecha)} · {v.palabras.toLocaleString('es-MX')} palabras</span>
              </div>
              <div className="acciones-comentario">
                <button onClick={() => intentar(async () => setComparacion(comparacion?.id === v.id ? undefined : { id: v.id, filas: await api.compararVersion(v.id) }))}>
                  {comparacion?.id === v.id ? 'Ocultar comparación' : 'Comparar con ahora'}
                </button>
                <button
                  onClick={() =>
                    intentar(async () => {
                      if (!(await confirmar('Restaurar versión', `¿Volver a «${v.nombre}»? Antes se guarda el estado actual como otra versión, así que no se pierde nada.`, 'Restaurar'))) return;
                      const r = await api.restaurarVersion(v.id);
                      onEstado(r.estado);
                      setComparacion(undefined);
                      aviso(`Restaurada «${v.nombre}».${r.avisos.length ? ' ' + r.avisos.join(' ') : ''}`);
                    })
                  }
                >
                  Restaurar
                </button>
                <button
                  className="peligro-texto"
                  onClick={() =>
                    intentar(async () => {
                      if (!(await confirmar('Borrar versión', `¿Borrar la versión «${v.nombre}»?`, 'Borrar', true))) return;
                      onEstado(await api.eliminarVersion(v.id));
                      if (comparacion?.id === v.id) setComparacion(undefined);
                    })
                  }
                >
                  Borrar
                </button>
              </div>
              {comparacion?.id === v.id && (
                <table className="tabla-comparacion">
                  <thead>
                    <tr><th>Sección</th><th>Estado</th><th>Palabras entonces</th><th>Ahora</th></tr>
                  </thead>
                  <tbody>
                    {comparacion.filas.map((f, k) => (
                      <tr key={k} className={f.estado}>
                        <td>{f.titulo}</td>
                        <td>{ESTADOS[f.estado]}</td>
                        <td>{f.palabrasVersion}</td>
                        <td>{f.palabrasAhora}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
