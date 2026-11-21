import { useEffect, useMemo, useRef, useState } from 'react';
import { TIPOS_TERMINO, nuevoId, type EntradaGlosario, type TipoTermino } from '../../../src/model';
import { api, descargar, type Estado, type RevisionGlosario } from '../api';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  /** `texto`: el cambio toca el texto del libro (hay que recargar el editor). */
  onEstado: (e: Estado, texto?: boolean) => void;
  onIrA: (id: string) => void;
  onAviso: (texto: string) => void;
  llamar: (f: () => Promise<void>) => Promise<unknown>;
}

/** Glosario y fichas de personajes: grafías correctas, revisión del libro y página de glosario. */
export function Glosario({ estado, onCerrar, onEstado, onIrA, onAviso, llamar }: Props) {
  const [entradas, setEntradas] = useState<EntradaGlosario[]>(() => estado.libro.glosario ?? []);
  const [elegida, setElegida] = useState<string | null>(() => estado.libro.glosario?.[0]?.id ?? null);
  const [filtro, setFiltro] = useState('');
  const [tipo, setTipo] = useState<TipoTermino | ''>('');
  const [revision, setRevision] = useState<RevisionGlosario | null>(null);
  const entradaArchivo = useRef<HTMLInputElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendiente = useRef<EntradaGlosario[] | null>(null);

  const guardarYa = async () => {
    clearTimeout(temporizador.current);
    const g = pendiente.current;
    pendiente.current = null;
    if (g) onEstado(await api.glosario(g));
  };
  const cambiar = (nuevas: EntradaGlosario[]) => {
    setEntradas(nuevas);
    pendiente.current = nuevas;
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void guardarYa(), 500);
  };
  const irA = (id: string) => {
    void guardarYa().finally(() => onIrA(id));
  };
  const cerrar = () => {
    void guardarYa().finally(onCerrar);
  };

  useEffect(() => {
    const tecla = (x: KeyboardEvent) => x.key === 'Escape' && cerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return entradas
      .filter((e) => (!tipo || e.tipo === tipo) && (!f || [e.termino, e.original, e.lectura, ...(e.variantes ?? [])].some((x) => x?.toLowerCase().includes(f))))
      .sort((a, b) => a.termino.localeCompare(b.termino));
  }, [entradas, filtro, tipo]);
  const actual = entradas.find((e) => e.id === elegida);

  const editar = (cambios: Partial<EntradaGlosario>) => {
    if (!actual) return;
    cambiar(entradas.map((e) => (e.id === actual.id ? { ...e, ...cambios } : e)));
  };
  const nueva = () => {
    const e: EntradaGlosario = { id: nuevoId('g'), termino: filtro.trim() || t('Nuevo término'), tipo: tipo || 'personaje' };
    cambiar([...entradas, e]);
    setElegida(e.id);
    setFiltro('');
  };
  const borrar = () => {
    if (!actual) return;
    const resto = entradas.filter((e) => e.id !== actual.id);
    cambiar(resto);
    setElegida(resto[0]?.id ?? null);
  };

  const revisar = () =>
    llamar(async () => {
      await guardarYa();
      setRevision(await api.revisionGlosario());
    });
  const unificar = (entrada: string, encontrado: string) =>
    llamar(async () => {
      const r = await api.unificarTermino(entrada, encontrado);
      onEstado(r.estado, true);
      onAviso(t('{0} cambios hechos. Se guardó una versión antes por si quieres volver atrás.', { 0: r.cambios }));
      setRevision(await api.revisionGlosario());
    });
  const importar = (archivo: File) =>
    llamar(async () => {
      await guardarYa();
      const r = await api.importarGlosario(archivo);
      onEstado(r.estado);
      setEntradas(r.estado.libro.glosario ?? []);
      onAviso(t('{0} entradas nuevas; el glosario tiene {1}.', { 0: r.nuevas, 1: r.total }));
    });
  const exportar = (formato: 'csv' | 'json') =>
    llamar(async () => {
      await guardarYa();
      await descargar(`/api/glosario/exportar?formato=${formato}`);
    });
  const pagina = () =>
    llamar(async () => {
      await guardarYa();
      const r = await api.paginaGlosario();
      onEstado(r.estado, true);
      onAviso(t('Página «Glosario» actualizada en el libro.'));
      onIrA(r.seccion);
    });

  const usos = revision?.usos;
  const enLibro = entradas.filter((e) => e.enLibro).length;

  return (
    <div className="fondo-dialogo" onMouseDown={(x) => x.target === x.currentTarget && cerrar()}>
      <div className="dialogo panel-plugins panel-glosario" role="dialog" aria-modal="true" aria-labelledby="titulo-glosario">
        <div className="cabecera-plugins">
          <h2 id="titulo-glosario">{t('Glosario y personajes')}</h2>
          <button className="cerrar" onClick={cerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <p className="ayuda">{t('Apunta la grafía correcta de cada nombre y término. «Revisar el libro» avisa de las grafías distintas (acentos, guiones, vocales largas o las variantes que indiques).')}</p>
        <div className="glosario-cuerpo">
          <div className="glosario-lista">
            <div className="glosario-filtros">
              <input type="search" placeholder={t('Buscar…')} value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label={t('Buscar en el glosario')} />
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoTermino | '')} aria-label={t('Filtrar por tipo')}>
                <option value="">{t('Todos')}</option>
                {TIPOS_TERMINO.map((x) => (
                  <option key={x.id} value={x.id}>{t(x.plural)}</option>
                ))}
              </select>
            </div>
            <ul>
              {visibles.map((e) => (
                <li key={e.id}>
                  <button className={e.id === elegida ? 'activo' : ''} onClick={() => setElegida(e.id)}>
                    <span>{e.termino || t('(sin nombre)')}</span>
                    <small>
                      {t(TIPOS_TERMINO.find((x) => x.id === e.tipo)?.nombre ?? '')}
                      {usos && ` · ${(usos[e.id] ?? 0) === 1 ? t('1 uso') : t('{0} usos', { 0: usos[e.id] ?? 0 })}`}
                    </small>
                  </button>
                </li>
              ))}
              {!visibles.length && <li className="vacio">{entradas.length ? t('Nada coincide.') : t('El glosario está vacío.')}</li>}
            </ul>
            <button onClick={nueva}>{t('+ Nueva entrada')}</button>
          </div>
          <div className="glosario-ficha">
            {actual ? (
              <>
                <label>
                  {t('Término (grafía correcta)')}
                  <input value={actual.termino} onChange={(e) => editar({ termino: e.target.value })} />
                </label>
                <label>
                  {t('Tipo')}
                  <select value={actual.tipo} onChange={(e) => editar({ tipo: e.target.value as TipoTermino })}>
                    {TIPOS_TERMINO.map((x) => (
                      <option key={x.id} value={x.id}>{t(x.nombre)}</option>
                    ))}
                  </select>
                </label>
                <div className="fila-doble">
                  <label>
                    {t('Original')}
                    <input value={actual.original ?? ''} onChange={(e) => editar({ original: e.target.value || undefined })} placeholder="例: 佐藤" />
                  </label>
                  <label>
                    {t('Lectura')}
                    <input value={actual.lectura ?? ''} onChange={(e) => editar({ lectura: e.target.value || undefined })} placeholder="Satō" />
                  </label>
                </div>
                <label>
                  {t('Grafías que hay que evitar (separadas por comas)')}
                  <input
                    value={(actual.variantes ?? []).join(', ')}
                    onChange={(e) => editar({ variantes: e.target.value.split(',').map((x) => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) })}
                    onBlur={(e) => editar({ variantes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                  />
                </label>
                <label>
                  {t('Descripción o ficha')}
                  <textarea rows={3} value={actual.descripcion ?? ''} onChange={(e) => editar({ descripcion: e.target.value || undefined })} />
                </label>
                <label className="casilla">
                  <input type="checkbox" checked={!!actual.enLibro} onChange={(e) => editar({ enLibro: e.target.checked || undefined })} />
                  {t('En el libro (sale en la página de glosario)')}
                </label>
                <button className="peligro" onClick={borrar}>{t('Quitar entrada')}</button>
              </>
            ) : (
              <p className="ayuda">{t('Elige una entrada o crea una nueva.')}</p>
            )}
          </div>
        </div>
        {revision && (
          <div className="glosario-revision" aria-live="polite">
            <h3>{t('Grafías distintas en el libro')}</h3>
            {revision.hallazgos.length === 0 ? (
              <p className="ok">{t('Todo coincide con el glosario.')}</p>
            ) : (
              <ul>
                {revision.hallazgos.map((h) => (
                  <li key={`${h.entrada}-${h.encontrado}`}>
                    <div>
                      <strong>«{h.encontrado}»</strong> → «{h.termino}» <small>{h.tipo === 'variante' ? t('variante que evitar') : t('parecida')} · {h.veces === 1 ? t('1 vez') : t('{0} veces', { 0: h.veces })}</small>
                    </div>
                    {h.ejemplos.map((x, i) => (
                      <button key={i} className="ejemplo-glosario" onClick={() => irA(x.seccion)} title={t('Ir a «{0}»', { 0: x.titulo })}>
                        {x.contexto}
                      </button>
                    ))}
                    <button onClick={() => unificar(h.entrada, h.encontrado)}>{t('Cambiar todas por «{0}»', { 0: h.termino })}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="botones-dialogo">
          <button onClick={revisar} disabled={!entradas.length}>{t('Revisar el libro')}</button>
          <button onClick={pagina} disabled={!enLibro} title={enLibro ? '' : t('Marca «En el libro» en alguna entrada')}>
            {t('Añadir página de glosario ({0})', { 0: enLibro })}
          </button>
          <span className="espacio" />
          <button onClick={() => entradaArchivo.current?.click()} title={t('CSV, JSON o el proyecto .obi de otro volumen')}>{t('Importar…')}</button>
          <button onClick={() => exportar('csv')} disabled={!entradas.length}>{t('Exportar CSV')}</button>
          <button onClick={() => exportar('json')} disabled={!entradas.length}>{t('Exportar JSON')}</button>
          <input
            ref={entradaArchivo}
            type="file"
            hidden
            accept=".csv,.tsv,.json,.obi,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importar(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
