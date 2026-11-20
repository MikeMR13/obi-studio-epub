import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bloque, Metadatos, Nota, Seccion, Tema, Tipografia } from '../../src/model';
import { TIPOS_SECCION } from '../../src/model';
import { api, descargar, ErrorApi, type Estado, type Resultado } from './api';
import { Dialogos, aviso, confirmar, informar, pedirDatos } from './dialogos';
import { Editor } from './editor/Editor';
import { Estructura } from './paneles/Estructura';
import { Inspector } from './paneles/Inspector';
import { VistaPrevia } from './paneles/VistaPrevia';
import { Codigo } from './paneles/Codigo';
import { Ilustracion } from './paneles/Ilustracion';
import { PanelImpresion, VistaImpresion } from './paneles/Impresion';
import { PanelTema } from './paneles/Tema';
import { Comentarios, nombreRevisor } from './paneles/Comentarios';
import { Cambios } from './paneles/Cambios';
import { Plugins } from './paneles/Plugins';
import { Buscar } from './paneles/Buscar';
import { Versiones } from './paneles/Versiones';
import { Colaborar } from './paneles/Colaborar';
import { Configuracion } from './paneles/Configuracion';
import { Publicar } from './paneles/Publicar';
import { Muestra } from './paneles/Muestra';
import type { Pestana } from './paneles/Inspector';
import { cambiarIdioma, idiomaInterfaz, t } from './i18n';

type Vista = 'editor' | 'codigo' | 'vista' | 'impresion';

export function App() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [actual, setActual] = useState('');
  const [vista, setVista] = useState<Vista>('editor');
  const [pestana, setPestana] = useState<Pestana>('seccion');
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [menuMas, setMenuMas] = useState(false);
  const [verPlugins, setVerPlugins] = useState(false);
  const [verVersiones, setVerVersiones] = useState(false);
  const [verColaborar, setVerColaborar] = useState(false);
  const [verConfiguracion, setVerConfiguracion] = useState(false);
  const [verPublicar, setVerPublicar] = useState(false);
  const [verMuestra, setVerMuestra] = useState(false);
  const [configuracion, setConfiguracion] = useState<{ colaboracion: boolean }>({ colaboracion: false });
  useEffect(() => {
    api.configuracion().then(setConfiguracion).catch(() => undefined);
  }, []);
  const [busqueda, setBusqueda] = useState<{ reemplazo: boolean } | null>(null);
  const entradaCorrecciones = useRef<HTMLInputElement>(null);
  const [validacion, setValidacion] = useState<Resultado | null>(null);
  const [validando, setValidando] = useState(false);
  const [version, setVersion] = useState(0);
  const [inicio, setInicio] = useState(() => {
    try {
      // Tras cambiar el idioma de la interfaz se sigue en el libro abierto.
      if (sessionStorage.getItem('obi.seguir')) {
        sessionStorage.removeItem('obi.seguir');
        return false;
      }
    } catch {
      // Sin almacenamiento de sesión.
    }
    return true;
  });
  const [ocupado, setOcupado] = useState('');
  const entradaArchivo = useRef<HTMLInputElement>(null);

  const aplicar = useCallback((e: Estado, cambioVisible = true) => {
    setEstado(e);
    if (cambioVisible) setVersion((v) => v + 1);
    setActual((a) => (e.libro.secciones.some((s) => s.id === a) ? a : e.libro.secciones[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    api.estado().then((e) => aplicar(e));
  }, [aplicar]);

  useEffect(() => {
    const salir = (ev: BeforeUnloadEvent) => {
      if (estado?.cambiado) ev.preventDefault();
    };
    window.addEventListener('beforeunload', salir);
    return () => window.removeEventListener('beforeunload', salir);
  }, [estado?.cambiado]);

  const seccion = estado?.libro.secciones.find((s) => s.id === actual);

  const llamar = async <T,>(fn: () => Promise<T>, mensaje?: string): Promise<T | undefined> => {
    try {
      if (mensaje) setOcupado(mensaje);
      return await fn();
    } catch (e) {
      aviso((e as Error).message, 'error');
      return undefined;
    } finally {
      if (mensaje) setOcupado('');
    }
  };

  const importar = async (archivo: File) => {
    if (estado?.cambiado && !(await confirmar(t('Abrir otro archivo'), t('Hay cambios sin guardar en el libro actual. ¿Abrir otro archivo de todos modos?'), t('Abrir')))) return;
    const e = await llamar(() => api.importar(archivo), t('Abriendo «{0}»…', { 0: archivo.name }));
    if (!e) return;
    aplicar(e);
    setActual(e.libro.secciones[0]?.id ?? '');
    setValidacion(null);
    setInicio(false);
    setVista('editor');
    aviso(t('Se abrió «{0}» con {1} secciones.', { 0: e.libro.metadatos.titulo, 1: e.libro.secciones.length }));
    if (e.avisos.length) setTimeout(() => aviso(t('{0} avisos al importar: {1}', { 0: e.avisos.length, 1: e.avisos.slice(0, 2).join(' · ') }), 'error'), 400);
  };

  const libroNuevo = async () => {
    const r = await pedirDatos(t('Libro nuevo'), [
      { nombre: 'titulo', etiqueta: t('Título'), valor: '' },
      { nombre: 'autor', etiqueta: t('Autor o autora'), valor: '' },
    ], t('Crear libro'), t('Se crea con créditos, prólogo y un primer capítulo. Puedes cambiar todo después.'));
    if (!r) return;
    const e = await llamar(() => api.nuevo(r.titulo.trim() || t('Libro sin título'), r.autor.trim()));
    if (!e) return;
    aplicar(e);
    setActual(e.libro.secciones.find((s) => s.tipo === 'capitulo')?.id ?? e.libro.secciones[0].id);
    setInicio(false);
    setValidacion(null);
  };

  const guardarProyecto = () => llamar(async () => {
    await descargar('/api/proyecto');
    const e = await api.estado();
    aplicar(e, false);
    aviso(t('Proyecto guardado.'));
  });

  const validar = async () => {
    setValidando(true);
    setPestana('validacion');
    const r = await llamar(() => api.validar());
    setValidando(false);
    if (r) setValidacion(r);
  };

  const exportar = async () => {
    setOcupado(t('Validando y exportando…'));
    try {
      await descargar('/api/exportar');
      aviso(t('EPUB exportado y validado sin errores.'));
      setValidacion(null);
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409) {
        setValidacion(e.datos as Resultado);
        setPestana('validacion');
        aviso(t('No se exportó: el EPUB tiene errores. Revisa la pestaña Validación.'), 'error');
      } else aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const descargarFormato = async (ruta: string, mensaje: string, espera: string) => {
    setMenuMas(false);
    setOcupado(espera);
    try {
      await descargar(ruta);
      aviso(mensaje);
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409) {
        setValidacion(e.datos as Resultado);
        setPestana('validacion');
      }
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const correcciones = async (archivo: File) => {
    const modo = await pedirDatos(
      t('Importar correcciones'),
      [
        {
          nombre: 'modo',
          etiqueta: t('¿Cómo quieres incorporar «{0}»?', { 0: archivo.name }),
          tipo: 'opciones',
          valor: 'revisar',
          opciones: [
            { valor: 'revisar', etiqueta: t('Revisar cambio por cambio'), ayuda: t('El texto no cambia hasta que aceptes cada corrección en la pestaña Revisión.') },
            { valor: 'aplicar', etiqueta: t('Aplicar todo'), ayuda: t('Sustituye el texto de cada capítulo corregido de una vez.') },
          ],
        },
      ],
      t('Importar'),
      t('Antes se guarda una versión del libro para poder volver atrás.'),
    );
    if (!modo) return;
    const revisar = modo.modo !== 'aplicar';
    const r = await llamar(() => api.correcciones(archivo, revisar), t('Fundiendo las correcciones…'));
    if (!r) return;
    aplicar(r.estado);
    const { actualizadas, nuevas, sinCambios, comentarios, cambios, avisos } = r.resumen;
    await informar(
      t('Correcciones importadas'),
      [
        revisar
          ? cambios
            ? t('Cambios propuestos: {0}, en {1}. Revísalos en la pestaña Revisión.', { 0: cambios, 1: actualizadas.join(', ') })
            : t('No hay cambios en el texto.')
          : actualizadas.length
            ? t('Actualizadas ({0}): {1}.', { 0: actualizadas.length, 1: actualizadas.join(', ') })
            : t('Ninguna sección cambió.'),
        nuevas.length ? t('Nuevas ({0}): {1}.', { 0: nuevas.length, 1: nuevas.join(', ') }) : '',
        sinCambios ? t('Sin cambios: {0}.', { 0: sinCambios }) : '',
        comentarios ? t('Comentarios y respuestas nuevos: {0} (pestaña Revisión).', { 0: comentarios }) : '',
        avisos.length ? t('Avisos: {0}', { 0: avisos.join(' ') }) : '',
        t('Las ilustraciones, el tema y los bloques XHTML se conservaron.'),
      ].filter(Boolean).join('\n'),
    );
    if (revisar && cambios) setPestana('comentarios');
  };

  const exportarPdf = async (tipo: 'impresion' | 'digital') => {
    setExportandoPdf(true);
    setOcupado(tipo === 'impresion' ? t('Compaginando el PDF para imprenta…') : t('Compaginando el PDF digital…'));
    try {
      await descargar(`/api/exportar-pdf?tipo=${tipo}`);
      aviso(tipo === 'impresion' ? t('PDF para imprenta creado.') : t('PDF digital creado.'));
      setVersion((v) => v + 1);
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setExportandoPdf(false);
      setOcupado('');
    }
  };

  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || inicio) return;
      if (e.key === 's' && !(e.target as HTMLElement).closest('.area-codigo')) {
        e.preventDefault();
        void guardarProyecto();
      }
      if (e.key === 'e') {
        e.preventDefault();
        void exportar();
      }
      if (e.key === 'o') {
        e.preventDefault();
        entradaArchivo.current?.click();
      }
      if ((e.key === 'f' || e.key === 'h') && !e.shiftKey && !(e.target as HTMLElement).closest('.area-codigo')) {
        e.preventDefault();
        setBusqueda((b) => ({ reemplazo: e.key === 'h' || !!b?.reemplazo }));
      }
    };
    window.addEventListener('keydown', teclas);
    return () => window.removeEventListener('keydown', teclas);
  });

  const cambiarSeccion = (cambios: Partial<Seccion>) =>
    seccion && llamar(async () => aplicar(await api.seccion(seccion.id, cambios), 'tipo' in cambios || 'titulo' in cambios || 'mostrarTitulo' in cambios));

  const guardarTexto = useCallback(
    (id: string, bloques: Bloque[], notas: Nota[]) => {
      setEstado((e) => (e ? { ...e, cambiado: true, libro: { ...e.libro, secciones: e.libro.secciones.map((s) => (s.id === id ? { ...s, bloques, notas } : s)) } } : e));
      api.seccion(id, { bloques, notas }).then((e) => aplicar(e, true)).catch((err) => aviso(err.message, 'error'));
    },
    [aplicar],
  );

  const avisosPorSeccion = useMemo(() => {
    const r: Record<string, number> = {};
    for (const m of validacion?.mensajes ?? []) if (m.seccion) r[m.seccion] = (r[m.seccion] ?? 0) + 1;
    for (const s of estado?.libro.secciones ?? []) {
      const faltan = s.bloques.filter((b) => b.tipo === 'imagen' && !b.decorativa && !b.alt.trim() && s.tipo !== 'portada').length;
      if (faltan) r[s.id] = (r[s.id] ?? 0) + faltan;
    }
    return r;
  }, [validacion, estado]);

  if (!estado) return <div className="cargando">{t('Cargando Obi Studio…')}</div>;

  const entrada = (
    <input
      ref={entradaArchivo}
      type="file"
      hidden
      accept=".epub,.docx,.obi"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void importar(f);
        e.target.value = '';
      }}
    />
  );

  if (inicio) {
    return (
      <div className="inicio">
        <Dialogos />
        {entrada}
        <div className="inicio-caja">
          <div className="marca-grande">
            <span className="obi" aria-hidden>帯</span>
            <div>
              <h1>{t('Obi Studio')}</h1>
              <p>{t('Maquetador de novelas ligeras · EPUB 3 válido y accesible')}</p>
            </div>
          </div>
          <div className="tarjetas-inicio">
            <button className="tarjeta" onClick={libroNuevo}>
              <span className="icono-tarjeta">✚</span>
              <strong>{t('Libro nuevo')}</strong>
              <span>{t('Empieza con la estructura de una novela ligera.')}</span>
            </button>
            <button className="tarjeta" onClick={() => entradaArchivo.current?.click()}>
              <span className="icono-tarjeta">⇪</span>
              <strong>{t('Importar o abrir')}</strong>
              <span>{t('EPUB, Word (.docx) o un proyecto de Obi Studio (.obi).')}</span>
            </button>
            {estado.cambiado && (
              <button className="tarjeta" onClick={() => setInicio(false)}>
                <span className="icono-tarjeta">↩</span>
                <strong>{t('Seguir con «{0}»', { 0: estado.libro.metadatos.titulo })}</strong>
                <span>{t('Volver al libro abierto.')}</span>
              </button>
            )}
          </div>
          {ocupado && <p className="ocupado">{ocupado}</p>}
          <p className="pie-inicio">{t('También puedes arrastrar un archivo a esta ventana.')}</p>
          <SelectorIdioma enInicio />
        </div>
        <ZonaSoltar onArchivo={importar} />
      </div>
    );
  }

  const nombreTipo = TIPOS_SECCION.find((x) => x.id === seccion?.tipo)?.nombre;
  const tipoSeccion = nombreTipo && t(nombreTipo);
  const esImagen = seccion && (seccion.tipo === 'ilustracion' || seccion.tipo === 'portada');

  return (
    <div className="app">
      {verPublicar && (
        <Publicar
          onCerrar={() => setVerPublicar(false)}
          onIrA={(id) => {
            setActual(id);
            setVista('editor');
          }}
          onErrores={(d) => {
            setValidacion(d as Resultado);
            setPestana('validacion');
          }}
        />
      )}
      {verMuestra && (
        <Muestra
          estado={estado}
          onCerrar={() => setVerMuestra(false)}
          onErrores={(d) => {
            setValidacion(d as Resultado);
            setPestana('validacion');
          }}
        />
      )}
      {verConfiguracion && <Configuracion onCerrar={() => setVerConfiguracion(false)} onEstado={(e) => aplicar(e)} onConfiguracion={setConfiguracion} />}
      {verColaborar && <Colaborar onCerrar={() => setVerColaborar(false)} onEstado={(e) => aplicar(e)} />}
      {verVersiones && <Versiones estado={estado} onCerrar={() => setVerVersiones(false)} onEstado={(e) => aplicar(e)} />}
      {verPlugins && (
        <Plugins
          estado={estado}
          onCerrar={() => setVerPlugins(false)}
          onEstado={(e) => aplicar(e)}
          onIrA={(id) => {
            setActual(id);
            setVista('editor');
          }}
        />
      )}
      <Dialogos />
      {entrada}
      <header className="cabecera">
        <button className="marca" onClick={() => setInicio(true)} title={t('Inicio')}>
          <span className="obi" aria-hidden>帯</span> {t('Obi Studio')}
        </button>
        <div className="titulo-libro">
          <strong>{estado.libro.metadatos.titulo}</strong>
          <span className={estado.cambiado ? 'sin-guardar' : 'guardado'}>{estado.cambiado ? t('● Cambios sin guardar') : t('✓ Guardado')}</span>
        </div>
        <div className="acciones">
          <button onClick={() => entradaArchivo.current?.click()} title={t('Abrir o importar (Ctrl+O)')}>{t('Abrir…')}</button>
          <button onClick={guardarProyecto} title={t('Guardar el proyecto .obi (Ctrl+S)')}>{t('Guardar')}</button>
          <button onClick={validar} disabled={validando}>{t('Validar')}</button>
          <button onClick={() => setPestana('impresion')} title={t('PDF para imprenta o digital')}>{t('PDF…')}</button>
          <button className="principal" onClick={exportar} title={t('Exportar EPUB (Ctrl+E)')}>{t('Exportar EPUB')}</button>
          <div className="menu-mas">
            <button onClick={() => setMenuMas(!menuMas)} aria-expanded={menuMas} aria-haspopup="menu" title={t('Más formatos')}>{t('Más ▾')}</button>
            {menuMas && (
              <ul className="desplegable" role="menu">
                <li><button role="menuitem" onClick={() => { setMenuMas(false); setVerPublicar(true); }}>{t('Publicar en tiendas…')}<small>{t('Kindle, Apple Books, Kobo, Google Play e IngramSpark')}</small></button></li>
                <li><button role="menuitem" onClick={() => { setMenuMas(false); setVerMuestra(true); }}>{t('Muestra gratuita…')}<small>{t('EPUB de muestra y página web')}</small></button></li>
                <li><button role="menuitem" onClick={() => descargarFormato('/api/exportar-kepub', t('KEPUB para Kobo exportado.'), t('Creando el KEPUB…'))}>{t('KEPUB para Kobo')}<small>{t('Estadísticas de lectura y subrayado preciso en Kobo')}</small></button></li>
                <li><button role="menuitem" onClick={() => { setMenuMas(false); setPestana('impresion'); }}>{t('PDF…')}<small>{t('Para imprenta o digital')}</small></button></li>
                <li><button role="menuitem" onClick={() => descargarFormato('/api/exportar-word', t('Word para corrección exportado.'), t('Creando el Word…'))}>{t('Word para corrección')}<small>{t('Para enviar a correctores; vuelve con «Importar correcciones»')}</small></button></li>
                <li><button role="menuitem" onClick={() => { setMenuMas(false); entradaCorrecciones.current?.click(); }}>{t('Importar correcciones de Word…')}<small>{t('Funde los cambios y los comentarios capítulo a capítulo')}</small></button></li>
                {configuracion.colaboracion && (
                  <li><button role="menuitem" onClick={() => { setMenuMas(false); setVerColaborar(true); }}>{t('Colaborar en la red local…')}<small>{t('Escribir a la vez con otras personas')}</small></button></li>
                )}
                <li><button role="menuitem" onClick={() => { setMenuMas(false); setVerVersiones(true); }}>{t('Versiones…')}<small>{t('Guardar, comparar y restaurar versiones del libro')}</small></button></li>
                <li><button role="menuitem" onClick={() => { setMenuMas(false); setVerPlugins(true); }}>{t('Plugins…')}<small>{t('Revisiones, transformaciones y otros formatos')}</small></button></li>
                <li className="separador-menu"><button role="menuitem" onClick={() => { setMenuMas(false); setVerConfiguracion(true); }}>{t('Configuración…')}<small>{t('Idioma de la interfaz y funciones opcionales')}</small></button></li>
              </ul>
            )}
            <input ref={entradaCorrecciones} type="file" hidden accept=".docx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void correcciones(f); e.target.value = ''; }} />
          </div>
        </div>
      </header>
      <Estructura
        estado={estado}
        actual={actual}
        version={version}
        avisosPorSeccion={avisosPorSeccion}
        onElegir={(id) => {
          setActual(id);
          setPestana((p) => (p === 'validacion' ? p : 'seccion'));
        }}
        onOrdenar={(ids) => llamar(async () => aplicar(await api.ordenar(ids)))}
        onAnadir={(tipo) =>
          llamar(async () => {
            const nombre = t(TIPOS_SECCION.find((x) => x.id === tipo)?.nombre ?? '');
            const n = estado.libro.secciones.filter((s) => s.tipo === tipo).length + 1;
            const titulo = tipo === 'capitulo' ? t('Capítulo {0}', { 0: n }) : ['ilustracion', 'portada'].includes(tipo) ? '' : nombre;
            const r = await api.anadirSeccion(tipo, titulo, actual);
            aplicar(r.estado);
            setActual(r.seccion);
          })
        }
        onEliminar={async (s) => {
          if (await confirmar(t('Eliminar sección'), t('¿Eliminar «{0}»? Se borra su texto.', { 0: s.titulo || t(TIPOS_SECCION.find((x) => x.id === s.tipo)?.nombre ?? '') }), t('Eliminar'), true)) {
            await llamar(async () => aplicar(await api.eliminarSeccion(s.id)));
          }
        }}
      />
      <main className="centro">
        <div className="pestanas-centro" role="tablist" aria-label={t('Modo')}>
          {(['editor', 'codigo', 'vista', 'impresion'] as Vista[]).map((v) => (
            <button key={v} role="tab" aria-selected={vista === v} className={vista === v ? 'activa' : ''} onClick={() => setVista(v)}>
              {v === 'editor' ? t('Escribir') : v === 'codigo' ? t('Código') : v === 'vista' ? t('Vista previa') : t('Impresión')}
            </button>
          ))}
          <span className="tipo-actual">{tipoSeccion}</span>
          <button className="boton-buscar" title={t('Buscar y reemplazar (Ctrl+F, Ctrl+H)')} aria-label={t('Buscar y reemplazar')} onClick={() => setBusqueda(busqueda ? null : { reemplazo: false })}>
            🔍
          </button>
        </div>
        {busqueda && (
          <Buscar
            estado={estado}
            seccionActual={seccion?.id}
            conReemplazo={busqueda.reemplazo}
            onCerrar={() => setBusqueda(null)}
            onEstado={(e) => aplicar(e, true)}
            onIr={(c) => {
              setActual(c.seccion);
              setVista('editor');
              if (c.lugar.startsWith('b'))
                window.setTimeout(
                  () => window.dispatchEvent(new CustomEvent('obi:seleccionar', { detail: { bloque: Number(c.lugar.slice(1).split('.')[0]), texto: c.texto } })),
                  120,
                );
            }}
          />
        )}
        {seccion && vista === 'editor' && (esImagen ? (
          <Ilustracion
            estado={estado}
            seccion={seccion}
            version={version}
            onEstado={(e) => aplicar(e)}
            onBloques={(bloques) => llamar(async () => aplicar(await api.seccion(seccion.id, { bloques })))}
            onPortada={(recurso) => llamar(async () => aplicar(await api.metadatos({ portada: recurso } as Partial<Metadatos>)))}
          />
        ) : (
          <Editor
            key={seccion.id + (estado.libro.escritura === 'vertical' ? '-v' : '') + (estado.colaboracion?.codigo ?? '')}
            seccion={seccion}
            sala={
              estado.colaboracion
                ? { url: `ws://127.0.0.1:${estado.colaboracion.puerto}`, codigo: estado.colaboracion.codigo, nombre: nombreRevisor() || t('Anfitrión'), color: '#b5341f' }
                : undefined
            }
            vertical={estado.libro.escritura === 'vertical'}
            idioma={estado.libro.metadatos.idioma}
            onCambio={(b, n) => guardarTexto(seccion.id, b, n)}
            onEstado={() => api.estado().then((e) => aplicar(e))}
            onComentar={(c) => {
              cambiarSeccion({ comentarios: [...(seccion.comentarios ?? []), { id: c.id, autor: c.autor, fecha: new Date().toISOString(), texto: c.texto }] });
              setPestana('comentarios');
            }}
          />
        ))}
        {seccion && vista === 'codigo' && (
          <Codigo
            seccionId={seccion.id}
            version={version}
            onAplicado={(e, ids) => {
              aplicar(e);
              setActual(ids[0]);
            }}
          />
        )}
        {vista === 'impresion' && <VistaImpresion version={version} />}
        {seccion && vista === 'vista' && <VistaPrevia libro={estado.libro} seccionId={seccion.id} version={version} onSeccion={setActual} />}
      </main>
      <Inspector
        estado={estado}
        seccion={seccion}
        pestana={pestana}
        onPestana={setPestana}
        onSeccion={cambiarSeccion}
        onMetadatos={(c) => llamar(async () => aplicar(await api.metadatos(c)))}
        onTema={(c: Partial<Tema>) => llamar(async () => aplicar(await api.tema(c)))}
        onTipografia={(c: Partial<Tipografia>) => llamar(async () => aplicar(await api.tipografia(c), false))}
        onAplicarTipografia={(todo) =>
          llamar(async () => {
            const r = await api.aplicarTipografia(todo ? undefined : seccion?.id);
            aplicar(r.estado);
            aviso(r.cambios ? t('Tipografía aplicada en {0} fragmentos.', { 0: r.cambios }) : t('No había nada que corregir.'));
          })
        }
        validacion={validacion}
        validando={validando}
        onValidar={validar}
        onIrA={(id) => {
          setActual(id);
          setVista('codigo');
        }}
        version={version}
        onEscritura={(v) => llamar(async () => aplicar(await api.escritura(v)))}
        onImagenCabecera={(archivo) =>
          seccion &&
          llamar(async () => {
            if (!archivo) return aplicar(await api.seccion(seccion.id, { imagenCabecera: null }));
            const r = await api.subirImagen(archivo);
            aplicar(await api.seccion(seccion.id, { imagenCabecera: r.recurso.id }));
          })
        }
        panelComentarios={
          <>
            <Cambios
              estado={estado}
              seccion={seccion}
              onEstado={(e) => aplicar(e)}
              onIrA={(id) => {
                setActual(id);
                setVista('editor');
              }}
            />
            <Comentarios seccion={seccion} onSeccion={cambiarSeccion} />
          </>
        }
        panelTema={
          <PanelTema
            estado={estado}
            version={version}
            onTema={(c) => llamar(async () => aplicar(await api.tema(c)))}
            onGaleria={(id) => llamar(async () => aplicar(await api.temaGaleria(id)))}
            onTipografia={(c) => llamar(async () => aplicar(await api.tipografia(c), false))}
            onAplicarTipografia={() =>
              llamar(async () => {
                const r = await api.aplicarTipografia();
                aplicar(r.estado);
                aviso(r.cambios ? t('Tipografía aplicada en {0} fragmentos.', { 0: r.cambios }) : t('No había nada que corregir.'));
              })
            }
            onEstado={(e) => aplicar(e)}
          />
        }
        panelImpresion={
          <PanelImpresion
            estado={estado}
            version={version}
            exportando={exportandoPdf}
            onCambiar={(c) => llamar(async () => aplicar(await api.impresion(c)))}
            onExportar={exportarPdf}
            onIrA={(id) => {
              setActual(id);
              setVista('editor');
            }}
          />
        }
      />
      {ocupado && <div className="ocupado-flotante" role="status">{ocupado}</div>}
      <ZonaSoltar onArchivo={importar} />
    </div>
  );
}

function ZonaSoltar({ onArchivo }: { onArchivo: (f: File) => void }) {
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    let contador = 0;
    const entra = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      contador++;
      setActiva(true);
    };
    const sale = () => {
      contador = Math.max(0, contador - 1);
      if (!contador) setActiva(false);
    };
    const sobre = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault();
    const suelta = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      contador = 0;
      setActiva(false);
      const f = e.dataTransfer.files[0];
      if (/\.(epub|docx|obi)$/i.test(f.name)) onArchivo(f);
    };
    window.addEventListener('dragenter', entra);
    window.addEventListener('dragleave', sale);
    window.addEventListener('dragover', sobre);
    window.addEventListener('drop', suelta);
    return () => {
      window.removeEventListener('dragenter', entra);
      window.removeEventListener('dragleave', sale);
      window.removeEventListener('dragover', sobre);
      window.removeEventListener('drop', suelta);
    };
  }, [onArchivo]);
  return activa ? <div className="zona-soltar">{t('Suelta aquí el EPUB, Word u .obi')}</div> : null;
}

/** Idioma de la interfaz (el del libro se elige en la pestaña Libro). */
function SelectorIdioma({ enInicio = false }: { enInicio?: boolean }) {
  return (
    <label className="selector-idioma">
      <span>{t('Idioma de la interfaz')}</span>
      <select value={idiomaInterfaz()} onChange={(e) => cambiarIdioma(e.target.value as 'es' | 'en', !enInicio)}>
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
