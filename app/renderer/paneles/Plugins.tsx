import { useEffect, useRef, useState } from 'react';
import { api, descargar, type Estado, type Hallazgo, type PluginInstalado } from '../api';
import { aviso, confirmar } from '../dialogos';

const TIPOS: Record<string, string> = { revision: 'Revisión', transformacion: 'Transformación', exportador: 'Exportador', importador: 'Importador' };
const PERMISOS: Record<string, string> = { recursos: 'leer y cambiar las imágenes del libro', red: 'conectarse a internet' };

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
  onIrA: (seccion: string) => void;
}

/** Gestor de plugins: instalar, quitar y ejecutar. */
export function Plugins({ estado, onCerrar, onEstado, onIrA }: Props) {
  const [lista, setLista] = useState<PluginInstalado[]>();
  const [ocupado, setOcupado] = useState('');
  const [revision, setRevision] = useState<{ plugin: string; hallazgos: Hallazgo[]; registros: string[] }>();
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.plugins().then(setLista).catch((e) => aviso((e as Error).message, 'error'));
  }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const conEspera = async (texto: string, f: () => Promise<void>) => {
    setOcupado(texto);
    try {
      await f();
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const instalar = (archivo: File) =>
    conEspera('Leyendo el plugin…', async () => {
      const m = await api.inspeccionarPlugin(archivo);
      const permisos = m.permisos.length ? `Pide permiso para: ${m.permisos.map((p) => PERMISOS[p] ?? p).join(' y ')}.` : 'No pide permisos: solo ve el texto del libro.';
      const yaEsta = lista?.some((p) => p.id === m.id);
      const ok = await confirmar(
        yaEsta ? `Actualizar «${m.nombre}»` : `Instalar «${m.nombre}»`,
        `${m.nombre} ${m.version}, de ${m.autor}.\n${m.descripcion}\nTipo: ${m.tipos.map((t) => TIPOS[t]).join(', ')}.\n${permisos}\nLos plugins se ejecutan aislados: no pueden leer tus archivos.`,
        yaEsta ? 'Actualizar' : 'Instalar',
      );
      if (!ok) return;
      setLista(await api.instalarPlugin(archivo));
      aviso(`«${m.nombre}» instalado.`);
    });

  const quitar = (p: PluginInstalado) =>
    conEspera('', async () => {
      if (!(await confirmar('Quitar plugin', `¿Quitar «${p.nombre}»?`, 'Quitar', true))) return;
      setLista(await api.eliminarPlugin(p.id));
      if (revision?.plugin === p.nombre) setRevision(undefined);
    });

  const revisar = (p: PluginInstalado) =>
    conEspera(`Ejecutando «${p.nombre}»…`, async () => {
      const r = await api.revisarPlugin(p.id);
      setRevision({ plugin: p.nombre, ...r });
    });

  const transformar = (p: PluginInstalado) =>
    conEspera(`Aplicando «${p.nombre}»…`, async () => {
      if (!(await confirmar(`Aplicar «${p.nombre}»`, `${p.descripcion}\nPodrás deshacerlo justo después.`, 'Aplicar'))) return;
      const r = await api.transformarPlugin(p.id);
      onEstado(r.estado);
      aviso(`«${p.nombre}» aplicado.${r.registros.length ? ' ' + r.registros.join(' ') : ''}`);
    });

  const exportar = (p: PluginInstalado) => conEspera(`Exportando con «${p.nombre}»…`, () => descargar(`/api/plugins/${p.id}/exportar`).then(() => aviso('Archivo exportado.')));

  const deshacer = () =>
    conEspera('', async () => {
      onEstado(await api.deshacerPlugin());
      aviso('Transformación deshecha.');
    });

  const seccion = (id?: string) => estado.libro.secciones.find((s) => s.id === id);

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins" role="dialog" aria-modal="true" aria-labelledby="titulo-plugins">
        <div className="cabecera-plugins">
          <h2 id="titulo-plugins">Plugins</h2>
          <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <p className="ayuda">
          Los plugins añaden revisiones, transformaciones e importadores o exportadores. Se ejecutan en un proceso aislado y solo ven el libro, nunca tus archivos.
        </p>
        {estado.deshacerPlugin && (
          <div className="barra-deshacer">
            Se aplicó «{estado.deshacerPlugin}».
            <button onClick={deshacer}>Deshacer</button>
          </div>
        )}
        {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
        <ul className="lista-plugins">
          {lista?.length === 0 && <li className="vacio">No hay plugins instalados.</li>}
          {lista?.map((p) => (
            <li key={p.id}>
              <div className="cabecera-plugin">
                <strong>{p.nombre}</strong> <span>{p.version} · {p.autor}</span>
              </div>
              <p>{p.descripcion}</p>
              <div className="etiquetas">
                {p.tipos.map((t) => (
                  <span key={t} className="etiqueta">{TIPOS[t]}</span>
                ))}
                {p.permisos.map((x) => (
                  <span key={x} className="etiqueta permiso" title={PERMISOS[x]}>⚠ {x === 'red' ? 'Internet' : 'Imágenes'}</span>
                ))}
                {p.extensiones && <span className="etiqueta">Abre .{p.extensiones.join(', .')} desde «Importar»</span>}
              </div>
              <div className="acciones-comentario">
                {p.tipos.includes('revision') && <button disabled={!!ocupado} onClick={() => revisar(p)}>Revisar</button>}
                {p.tipos.includes('transformacion') && <button disabled={!!ocupado} onClick={() => transformar(p)}>Aplicar</button>}
                {p.tipos.includes('exportador') && <button disabled={!!ocupado} onClick={() => exportar(p)}>Exportar .{p.salida?.extension}</button>}
                <button className="peligro-texto" disabled={!!ocupado} onClick={() => quitar(p)}>Quitar</button>
              </div>
            </li>
          ))}
        </ul>
        {revision && (
          <div className="resultado-validacion">
            <h3>{revision.plugin}: {revision.hallazgos.length ? `${revision.hallazgos.length} hallazgos` : 'sin hallazgos'}</h3>
            <ul className="mensajes">
              {revision.hallazgos.map((h, k) => {
                const s = seccion(h.seccion);
                return (
                  <li key={k} className={h.gravedad === 'error' ? 'error' : 'aviso'}>
                    {h.mensaje}
                    {s && (
                      <button className="enlace" onClick={() => { onIrA(s.id); onCerrar(); }}>
                        Ir a «{s.titulo || s.tipo}»
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {revision.registros.length > 0 && <p className="ayuda">{revision.registros.join(' ')}</p>}
          </div>
        )}
        <div className="botones-dialogo">
          <button className="principal" onClick={() => entrada.current?.click()} disabled={!!ocupado}>Instalar plugin…</button>
          <input ref={entrada} type="file" hidden accept=".obiplugin" onChange={(e) => { const f = e.target.files?.[0]; if (f) void instalar(f); e.target.value = ''; }} />
        </div>
      </div>
    </div>
  );
}
