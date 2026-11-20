import { useEffect, useRef, useState } from 'react';
import { TIPOS_SECCION } from '../../../src/model';
import { api, descargar, type Catalogo, type Estado, type Hallazgo, type PluginInstalado } from '../api';
import { aviso, confirmar } from '../dialogos';
import { t } from '../i18n';

const TIPOS: Record<string, string> = { revision: t('Revisión'), transformacion: t('Transformación'), exportador: t('Exportador'), importador: t('Importador') };
const PERMISOS: Record<string, string> = { recursos: t('leer y cambiar las imágenes del libro'), red: 'conectarse a internet' };

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
  const [catalogo, setCatalogo] = useState<Catalogo>();
  const [urlCatalogo, setUrlCatalogo] = useState('');

  useEffect(() => {
    api.plugins().then(setLista).catch((e) => aviso((e as Error).message, 'error'));
    api.catalogo().then(setCatalogo).catch((e) => aviso((e as Error).message, 'error'));
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
    conEspera(t('Leyendo el plugin…'), async () => {
      const m = await api.inspeccionarPlugin(archivo);
      const permisos = m.permisos.length ? t('Pide permiso para: {0}.', { 0: m.permisos.map((p) => PERMISOS[p] ?? p).join(' y ') }) : t('No pide permisos: solo ve el texto del libro.');
      const yaEsta = lista?.some((p) => p.id === m.id);
      const ok = await confirmar(
        yaEsta ? t('Actualizar «{0}»', { 0: m.nombre }) : t('Instalar «{0}»', { 0: m.nombre }),
        t('{0} {1}, de {2}.\n{3}\nTipo: {4}.\n{5}\nLos plugins se ejecutan aislados: no pueden leer tus archivos.', { 0: m.nombre, 1: m.version, 2: m.autor, 3: m.descripcion, 4: m.tipos.map((t) => TIPOS[t]).join(', '), 5: permisos }),
        yaEsta ? t('Actualizar') : t('Instalar'),
      );
      if (!ok) return;
      setLista(await api.instalarPlugin(archivo));
      aviso(t('«{0}» instalado.', { 0: m.nombre }));
    });

  const instalarDeCatalogo = (e: Catalogo['plugins'][number]) =>
    conEspera(t('Instalando «{0}»…', { 0: e.nombre }), async () => {
      const permisos = e.permisos.length ? t('Pide permiso para: {0}.', { 0: e.permisos.map((x) => PERMISOS[x] ?? x).join(' y ') }) : t('No pide permisos: solo ve el texto del libro.');
      const ok = await confirmar(
        `${e.estado === 'actualizable' ? t('Actualizar') : t('Instalar')} «${e.nombre}»`,
        t('{0} {1}, de {2} (catálogo «{3}»).\n{4}\n{5}\nSe comprueba la huella del paquete antes de instalarlo.', { 0: e.nombre, 1: e.version, 2: e.autor, 3: e.nombreCatalogo, 4: e.descripcion, 5: permisos }),
        e.estado === 'actualizable' ? t('Actualizar') : t('Instalar'),
      );
      if (!ok) return;
      const r = await api.instalarDeCatalogo(e.origen, e.id);
      setLista(r.instalados);
      setCatalogo(r);
      aviso(t('«{0}» instalado.', { 0: e.nombre }));
    });

  const agregarCatalogo = () =>
    conEspera(t('Leyendo el catálogo…'), async () => {
      const r = await api.agregarCatalogo(urlCatalogo);
      setCatalogo(r);
      setUrlCatalogo('');
      aviso(t('Catálogo añadido con {0} plugins.', { 0: r.nuevos }));
    });

  const quitar = (p: PluginInstalado) =>
    conEspera('', async () => {
      if (!(await confirmar(t('Quitar plugin'), t('¿Quitar «{0}»?', { 0: p.nombre }), t('Quitar'), true))) return;
      setLista(await api.eliminarPlugin(p.id));
      setCatalogo(await api.catalogo());
      if (revision?.plugin === p.nombre) setRevision(undefined);
    });

  const revisar = (p: PluginInstalado) =>
    conEspera(t('Ejecutando «{0}»…', { 0: p.nombre }), async () => {
      const r = await api.revisarPlugin(p.id);
      setRevision({ plugin: p.nombre, ...r });
    });

  const transformar = (p: PluginInstalado) =>
    conEspera(t('Aplicando «{0}»…', { 0: p.nombre }), async () => {
      if (!(await confirmar(t('Aplicar «{0}»', { 0: p.nombre }), t('{0}\nPodrás deshacerlo justo después.', { 0: p.descripcion }), t('Aplicar')))) return;
      const r = await api.transformarPlugin(p.id);
      onEstado(r.estado);
      aviso(t('«{0}» aplicado.{1}', { 0: p.nombre, 1: r.registros.length ? ' ' + r.registros.join(' ') : '' }));
    });

  const exportar = (p: PluginInstalado) => conEspera(t('Exportando con «{0}»…', { 0: p.nombre }), () => descargar(`/api/plugins/${p.id}/exportar`).then(() => aviso(t('Archivo exportado.'))));

  const deshacer = () =>
    conEspera('', async () => {
      onEstado(await api.deshacerPlugin());
      aviso(t('Transformación deshecha.'));
    });

  const seccion = (id?: string) => estado.libro.secciones.find((s) => s.id === id);

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins" role="dialog" aria-modal="true" aria-labelledby="titulo-plugins">
        <div className="cabecera-plugins">
          <h2 id="titulo-plugins">{t('Plugins')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <p className="ayuda">
          {t('Los plugins añaden revisiones, transformaciones e importadores o exportadores. Se ejecutan en un proceso aislado y solo ven el libro, nunca tus archivos.')}
        </p>
        {estado.deshacerPlugin && (
          <div className="barra-deshacer">
            {t('Se aplicó «{0}».', { 0: estado.deshacerPlugin })}
            <button onClick={deshacer}>{t('Deshacer')}</button>
          </div>
        )}
        {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
        <ul className="lista-plugins">
          {lista?.length === 0 && <li className="vacio">{t('No hay plugins instalados.')}</li>}
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
                  <span key={x} className="etiqueta permiso" title={PERMISOS[x]}>⚠ {x === 'red' ? t('Internet') : t('Imágenes')}</span>
                ))}
                {p.extensiones && <span className="etiqueta">{t('Abre .{0} desde «Importar»', { 0: p.extensiones.join(', .') })}</span>}
              </div>
              <div className="acciones-comentario">
                {p.tipos.includes('revision') && <button disabled={!!ocupado} onClick={() => revisar(p)}>{t('Revisar')}</button>}
                {p.tipos.includes('transformacion') && <button disabled={!!ocupado} onClick={() => transformar(p)}>{t('Aplicar')}</button>}
                {p.tipos.includes('exportador') && <button disabled={!!ocupado} onClick={() => exportar(p)}>{t('Exportar .{0}', { 0: p.salida?.extension })}</button>}
                <button className="peligro-texto" disabled={!!ocupado} onClick={() => quitar(p)}>{t('Quitar')}</button>
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
                        {t('Ir a «{0}»', { 0: s.titulo || t(TIPOS_SECCION.find((x) => x.id === s.tipo)?.nombre ?? '') })}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {revision.registros.length > 0 && <p className="ayuda">{revision.registros.join(' ')}</p>}
          </div>
        )}
        <h3 className="titulo-catalogo">{t('Catálogo')}</h3>
        <ul className="lista-plugins">
          {catalogo?.plugins.map((e) => (
            <li key={e.id} className={`entrada-catalogo ${e.estado}`}>
              <div className="cabecera-plugin">
                <strong>{e.nombre}</strong> <span>{e.version} · {e.autor} · {e.nombreCatalogo}</span>
              </div>
              <p>{e.descripcion}</p>
              <div className="acciones-comentario">
                {e.estado === 'instalado' ? (
                  <span className="etiqueta">{t('Instalado')}</span>
                ) : (
                  <button disabled={!!ocupado} onClick={() => instalarDeCatalogo(e)}>{e.estado === 'actualizable' ? t('Actualizar') : t('Instalar')}</button>
                )}
                {e.permisos.map((x) => (
                  <span key={x} className="etiqueta permiso" title={PERMISOS[x]}>⚠ {x === 'red' ? t('Internet') : t('Imágenes')}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {catalogo?.errores.map((e) => (
          <p key={e} className="error ayuda">{e}</p>
        ))}
        <details className="otros-catalogos">
          <summary>{t('Otros catálogos ({0})', { 0: catalogo?.catalogos.length ?? 0 })}</summary>
          <p className="ayuda">{t('Un catálogo es una carpeta publicada en la web con catalogo.json (se crea con scripts/catalogo-plugins.mjs). Añade solo catálogos de autores en los que confíes.')}</p>
          {catalogo?.catalogos.map((u) => (
            <div key={u} className="fila-buscar">
              <code className="url-catalogo">{u}</code>
              <button onClick={() => conEspera('', async () => setCatalogo(await api.quitarCatalogo(u)))}>{t('Quitar')}</button>
            </div>
          ))}
          <form className="fila-buscar" onSubmit={(ev) => { ev.preventDefault(); void agregarCatalogo(); }}>
            <input aria-label={t('URL del catálogo')} placeholder="https://…/catalogo.json" value={urlCatalogo} onChange={(ev) => setUrlCatalogo(ev.target.value)} />
            <button type="submit" disabled={!urlCatalogo.trim() || !!ocupado}>{t('Añadir')}</button>
          </form>
        </details>
        <div className="botones-dialogo">
          <button className="principal" onClick={() => entrada.current?.click()} disabled={!!ocupado}>{t('Instalar desde archivo…')}</button>
          <input ref={entrada} type="file" hidden accept=".obiplugin" onChange={(e) => { const f = e.target.files?.[0]; if (f) void instalar(f); e.target.value = ''; }} />
        </div>
      </div>
    </div>
  );
}
