import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bloque, Metadatos, Nota, Seccion, Tema, Tipografia } from '../../src/model';
import { TIPOS_SECCION } from '../../src/model';
import { api, descargar, ErrorApi, type Estado, type Resultado } from './api';
import { Dialogos, aviso, confirmar, pedirDatos } from './dialogos';
import { Editor } from './editor/Editor';
import { Estructura } from './paneles/Estructura';
import { Inspector } from './paneles/Inspector';
import { VistaPrevia } from './paneles/VistaPrevia';
import { Codigo } from './paneles/Codigo';
import { Ilustracion } from './paneles/Ilustracion';
import { PanelImpresion, VistaImpresion } from './paneles/Impresion';
import type { Pestana } from './paneles/Inspector';

type Vista = 'editor' | 'codigo' | 'vista' | 'impresion';

export function App() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [actual, setActual] = useState('');
  const [vista, setVista] = useState<Vista>('editor');
  const [pestana, setPestana] = useState<Pestana>('seccion');
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [validacion, setValidacion] = useState<Resultado | null>(null);
  const [validando, setValidando] = useState(false);
  const [version, setVersion] = useState(0);
  const [inicio, setInicio] = useState(true);
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
    if (estado?.cambiado && !(await confirmar('Abrir otro archivo', 'Hay cambios sin guardar en el libro actual. ¿Abrir otro archivo de todos modos?', 'Abrir'))) return;
    const e = await llamar(() => api.importar(archivo), `Abriendo «${archivo.name}»…`);
    if (!e) return;
    aplicar(e);
    setActual(e.libro.secciones[0]?.id ?? '');
    setValidacion(null);
    setInicio(false);
    setVista('editor');
    aviso(`Se abrió «${e.libro.metadatos.titulo}» con ${e.libro.secciones.length} secciones.`);
    if (e.avisos.length) setTimeout(() => aviso(`${e.avisos.length} avisos al importar: ${e.avisos.slice(0, 2).join(' · ')}`, 'error'), 400);
  };

  const libroNuevo = async () => {
    const r = await pedirDatos('Libro nuevo', [
      { nombre: 'titulo', etiqueta: 'Título', valor: '' },
      { nombre: 'autor', etiqueta: 'Autor o autora', valor: '' },
    ], 'Crear libro', 'Se crea con créditos, prólogo y un primer capítulo. Puedes cambiar todo después.');
    if (!r) return;
    const e = await llamar(() => api.nuevo(r.titulo.trim() || 'Libro sin título', r.autor.trim()));
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
    aviso('Proyecto guardado.');
  });

  const validar = async () => {
    setValidando(true);
    setPestana('validacion');
    const r = await llamar(() => api.validar());
    setValidando(false);
    if (r) setValidacion(r);
  };

  const exportar = async () => {
    setOcupado('Validando y exportando…');
    try {
      await descargar('/api/exportar');
      aviso('EPUB exportado y validado sin errores.');
      setValidacion(null);
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409) {
        setValidacion(e.datos as Resultado);
        setPestana('validacion');
        aviso('No se exportó: el EPUB tiene errores. Revisa la pestaña Validación.', 'error');
      } else aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const exportarPdf = async (tipo: 'impresion' | 'digital') => {
    setExportandoPdf(true);
    setOcupado(tipo === 'impresion' ? 'Compaginando el PDF para imprenta…' : 'Compaginando el PDF digital…');
    try {
      await descargar(`/api/exportar-pdf?tipo=${tipo}`);
      aviso(tipo === 'impresion' ? 'PDF para imprenta creado.' : 'PDF digital creado.');
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

  if (!estado) return <div className="cargando">Cargando Obi Studio…</div>;

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
              <h1>Obi Studio</h1>
              <p>Maquetador de novelas ligeras · EPUB 3 válido y accesible</p>
            </div>
          </div>
          <div className="tarjetas-inicio">
            <button className="tarjeta" onClick={libroNuevo}>
              <span className="icono-tarjeta">✚</span>
              <strong>Libro nuevo</strong>
              <span>Empieza con la estructura de una novela ligera.</span>
            </button>
            <button className="tarjeta" onClick={() => entradaArchivo.current?.click()}>
              <span className="icono-tarjeta">⇪</span>
              <strong>Importar o abrir</strong>
              <span>EPUB, Word (.docx) o un proyecto de Obi Studio (.obi).</span>
            </button>
            {estado.cambiado && (
              <button className="tarjeta" onClick={() => setInicio(false)}>
                <span className="icono-tarjeta">↩</span>
                <strong>Seguir con «{estado.libro.metadatos.titulo}»</strong>
                <span>Volver al libro abierto.</span>
              </button>
            )}
          </div>
          {ocupado && <p className="ocupado">{ocupado}</p>}
          <p className="pie-inicio">También puedes arrastrar un archivo a esta ventana.</p>
        </div>
        <ZonaSoltar onArchivo={importar} />
      </div>
    );
  }

  const tipoSeccion = TIPOS_SECCION.find((t) => t.id === seccion?.tipo)?.nombre;
  const esImagen = seccion && (seccion.tipo === 'ilustracion' || seccion.tipo === 'portada');

  return (
    <div className="app">
      <Dialogos />
      {entrada}
      <header className="cabecera">
        <button className="marca" onClick={() => setInicio(true)} title="Inicio">
          <span className="obi" aria-hidden>帯</span> Obi Studio
        </button>
        <div className="titulo-libro">
          <strong>{estado.libro.metadatos.titulo}</strong>
          <span className={estado.cambiado ? 'sin-guardar' : 'guardado'}>{estado.cambiado ? '● Cambios sin guardar' : '✓ Guardado'}</span>
        </div>
        <div className="acciones">
          <button onClick={() => entradaArchivo.current?.click()} title="Abrir o importar (Ctrl+O)">Abrir…</button>
          <button onClick={guardarProyecto} title="Guardar el proyecto .obi (Ctrl+S)">Guardar</button>
          <button onClick={validar} disabled={validando}>Validar</button>
          <button onClick={() => setPestana('impresion')} title="PDF para imprenta o digital">PDF…</button>
          <button className="principal" onClick={exportar} title="Exportar EPUB (Ctrl+E)">Exportar EPUB</button>
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
            const nombre = TIPOS_SECCION.find((t) => t.id === tipo)?.nombre ?? '';
            const n = estado.libro.secciones.filter((s) => s.tipo === tipo).length + 1;
            const titulo = tipo === 'capitulo' ? `Capítulo ${n}` : ['ilustracion', 'portada'].includes(tipo) ? '' : nombre;
            const r = await api.anadirSeccion(tipo, titulo, actual);
            aplicar(r.estado);
            setActual(r.seccion);
          })
        }
        onEliminar={async (s) => {
          if (await confirmar('Eliminar sección', `¿Eliminar «${s.titulo || TIPOS_SECCION.find((t) => t.id === s.tipo)?.nombre}»? Se borra su texto.`, 'Eliminar', true)) {
            await llamar(async () => aplicar(await api.eliminarSeccion(s.id)));
          }
        }}
      />
      <main className="centro">
        <div className="pestanas-centro" role="tablist" aria-label="Modo">
          {(['editor', 'codigo', 'vista', 'impresion'] as Vista[]).map((v) => (
            <button key={v} role="tab" aria-selected={vista === v} className={vista === v ? 'activa' : ''} onClick={() => setVista(v)}>
              {v === 'editor' ? 'Escribir' : v === 'codigo' ? 'Código' : v === 'vista' ? 'Vista previa' : 'Impresión'}
            </button>
          ))}
          <span className="tipo-actual">{tipoSeccion}</span>
        </div>
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
          <Editor key={seccion.id} seccion={seccion} onCambio={(b, n) => guardarTexto(seccion.id, b, n)} onEstado={() => api.estado().then((e) => aplicar(e))} />
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
            aviso(r.cambios ? `Tipografía aplicada en ${r.cambios} fragmentos.` : 'No había nada que corregir.');
          })
        }
        validacion={validacion}
        validando={validando}
        onValidar={validar}
        onIrA={(id) => {
          setActual(id);
          setVista('codigo');
        }}
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
  return activa ? <div className="zona-soltar">Suelta aquí el EPUB, Word u .obi</div> : null;
}
