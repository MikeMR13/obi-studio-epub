import { useEffect, useState } from 'react';
import type { Metadatos, Seccion, Tema, Tipografia, RolCredito } from '../../../src/model';
import { ROLES, TIPOS_SECCION } from '../../../src/model';
import type { Estado, Resultado } from '../api';
import { urlRecurso } from '../api';

export type Pestana = 'seccion' | 'libro' | 'tema' | 'impresion' | 'validacion';

interface Props {
  estado: Estado;
  seccion?: Seccion;
  pestana: Pestana;
  onPestana: (p: Pestana) => void;
  onSeccion: (cambios: Partial<Seccion>) => void;
  onMetadatos: (cambios: Partial<Metadatos>) => void;
  onTema: (cambios: Partial<Tema>) => void;
  onTipografia: (cambios: Partial<Tipografia>) => void;
  onAplicarTipografia: (todo: boolean) => void;
  validacion?: Resultado | null;
  validando: boolean;
  onValidar: () => void;
  onIrA: (seccion: string) => void;
  panelImpresion: React.ReactNode;
  panelTema: React.ReactNode;
  onImagenCabecera: (archivo: File | null) => void;
  version: number;
}

/** Campo de texto que guarda al salir (o tras una pausa), no en cada tecla. */
function Texto(p: { etiqueta: string; valor?: string | number; onGuardar: (v: string) => void; area?: boolean; ayuda?: string; tipo?: string; marcador?: string }) {
  const [v, setV] = useState(String(p.valor ?? ''));
  useEffect(() => setV(String(p.valor ?? '')), [p.valor]);
  const guardar = () => v !== String(p.valor ?? '') && p.onGuardar(v);
  return (
    <label className="campo">
      <span>{p.etiqueta}</span>
      {p.area ? (
        <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} onBlur={guardar} placeholder={p.marcador} />
      ) : (
        <input type={p.tipo ?? 'text'} value={v} onChange={(e) => setV(e.target.value)} onBlur={guardar} onKeyDown={(e) => e.key === 'Enter' && guardar()} placeholder={p.marcador} />
      )}
      {p.ayuda && <small>{p.ayuda}</small>}
    </label>
  );
}

export function Inspector(p: Props) {
  const m = p.estado.libro.metadatos;
  const t = p.estado.libro.tema;
  const tip = p.estado.libro.tipografia;
  const pestanas: [Pestana, string][] = [
    ['seccion', 'Sección'],
    ['libro', 'Libro'],
    ['tema', 'Tema'],
    ['impresion', 'Impresión'],
    ['validacion', 'Validación'],
  ];
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="pestanas" role="tablist">
        {pestanas.map(([id, nombre]) => (
          <button key={id} role="tab" aria-selected={p.pestana === id} className={p.pestana === id ? 'activa' : ''} onClick={() => p.onPestana(id)}>
            {nombre}
            {id === 'validacion' && p.validacion && !p.validacion.valido ? <span className="punto-error" aria-label="con errores" /> : null}
          </button>
        ))}
      </div>
      <div className="contenido-inspector" role="tabpanel">
        {p.pestana === 'seccion' && p.seccion && (
          <>
            <Texto etiqueta="Título" valor={p.seccion.titulo} onGuardar={(v) => p.onSeccion({ titulo: v })} />
            <label className="campo">
              <span>Tipo de sección</span>
              <select value={p.seccion.tipo} onChange={(e) => p.onSeccion({ tipo: e.target.value as Seccion['tipo'] })}>
                {TIPOS_SECCION.map((x) => (
                  <option key={x.id} value={x.id}>{x.nombre}</option>
                ))}
              </select>
              <small>Define la semántica del EPUB (capítulo, prólogo…) y cómo lo anuncian los lectores de pantalla.</small>
            </label>
            <label className="casilla">
              <input type="checkbox" checked={p.seccion.mostrarTitulo} onChange={(e) => p.onSeccion({ mostrarTitulo: e.target.checked })} />
              Mostrar el título en la página
            </label>
            <label className="casilla">
              <input type="checkbox" checked={p.seccion.enIndice} onChange={(e) => p.onSeccion({ enIndice: e.target.checked })} />
              Incluir en el índice
            </label>
            {!['portada', 'ilustracion', 'indice', 'creditos'].includes(p.seccion.tipo) && (
              <div className="campo">
                <span>Imagen de cabecera</span>
                {p.seccion.imagenCabecera ? (
                  <div className="fila-ornamento">
                    <img src={urlRecurso(p.seccion.imagenCabecera, p.version)} alt="Imagen de cabecera" />
                    <button className="pequeno" onClick={() => p.onImagenCabecera(null)}>Quitar</button>
                  </div>
                ) : (
                  <label className="boton-archivo">
                    Elegir imagen…
                    <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImagenCabecera(f); e.target.value = ''; }} />
                  </label>
                )}
                <small>Imagen decorativa sobre el título (una viñeta, un emblema…).</small>
              </div>
            )}
            {p.seccion.tipo === 'ilustracion' && (
              <label className="casilla">
                <input type="checkbox" checked={!!p.seccion.doblePagina} onChange={(e) => p.onSeccion({ doblePagina: e.target.checked || undefined })} />
                Doble página enfrentada en el PDF de impresión
              </label>
            )}
            <p className="dato">{(p.estado.palabras[p.seccion.id] ?? 0).toLocaleString('es')} palabras · {p.seccion.notas.length} notas</p>
            <button onClick={() => p.onAplicarTipografia(false)}>Aplicar tipografía a esta sección</button>
          </>
        )}

        {p.pestana === 'libro' && (
          <>
            <Texto etiqueta="Título" valor={m.titulo} onGuardar={(v) => p.onMetadatos({ titulo: v })} />
            <Texto etiqueta="Subtítulo" valor={m.subtitulo} onGuardar={(v) => p.onMetadatos({ subtitulo: v })} />
            <fieldset className="grupo">
              <legend>Créditos</legend>
              {m.creditos.map((c, k) => (
                <div key={k} className="fila-credito">
                  <input
                    aria-label="Nombre"
                    defaultValue={c.nombre}
                    onBlur={(e) => {
                      const creditos = [...m.creditos];
                      creditos[k] = { ...c, nombre: e.target.value };
                      p.onMetadatos({ creditos: creditos.filter((x) => x.nombre.trim()) });
                    }}
                  />
                  <select
                    aria-label="Función"
                    value={c.rol}
                    onChange={(e) => {
                      const creditos = [...m.creditos];
                      creditos[k] = { ...c, rol: e.target.value as RolCredito };
                      p.onMetadatos({ creditos });
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                  <button aria-label="Quitar crédito" onClick={() => p.onMetadatos({ creditos: m.creditos.filter((_, j) => j !== k) })}>✕</button>
                </div>
              ))}
              <button className="pequeno" onClick={() => p.onMetadatos({ creditos: [...m.creditos, { nombre: 'Nombre', rol: m.creditos.length ? 'trl' : 'aut' }] })}>
                + Añadir crédito
              </button>
            </fieldset>
            <div className="fila-dos">
              <Texto etiqueta="Serie" valor={m.serie} onGuardar={(v) => p.onMetadatos({ serie: v })} />
              <Texto etiqueta="Volumen" tipo="number" valor={m.volumen} onGuardar={(v) => p.onMetadatos({ volumen: v ? Number(v) : undefined })} />
            </div>
            <label className="campo">
              <span>Idioma</span>
              <select value={m.idioma} onChange={(e) => p.onMetadatos({ idioma: e.target.value })}>
                <option value="es">Español</option>
                <option value="es-MX">Español (México)</option>
                <option value="es-ES">Español (España)</option>
                <option value="en">Inglés</option>
                <option value="pt-BR">Portugués (Brasil)</option>
                <option value="ja">Japonés</option>
              </select>
            </label>
            <Texto etiqueta="ISBN o identificador" valor={m.identificador} onGuardar={(v) => p.onMetadatos({ identificador: v })} ayuda="Si no tienes ISBN, deja el UUID que se generó." />
            <div className="fila-dos">
              <Texto etiqueta="Fecha" tipo="date" valor={m.fecha} onGuardar={(v) => p.onMetadatos({ fecha: v })} />
              <Texto etiqueta="Editorial" valor={m.editorial} onGuardar={(v) => p.onMetadatos({ editorial: v })} />
            </div>
            <Texto etiqueta="Sinopsis" area valor={m.descripcion} onGuardar={(v) => p.onMetadatos({ descripcion: v })} />
            <Texto etiqueta="Derechos" valor={m.derechos} onGuardar={(v) => p.onMetadatos({ derechos: v })} marcador="© 2026 …" />
            <Texto
              etiqueta="Resumen de accesibilidad"
              area
              valor={m.resumenAccesibilidad}
              onGuardar={(v) => p.onMetadatos({ resumenAccesibilidad: v })}
              ayuda="Opcional. Si lo dejas vacío, Obi Studio escribe uno automáticamente."
            />
          </>
        )}

        {p.pestana === 'tema' && p.panelTema}

        {p.pestana === 'impresion' && p.panelImpresion}

        {p.pestana === 'validacion' && (
          <>
            <p className="ayuda">EPUBCheck 5.4 comprueba el libro con las reglas oficiales de EPUB 3.3. Exportar siempre valida antes.</p>
            <button className="principal" onClick={p.onValidar} disabled={p.validando}>
              {p.validando ? 'Validando…' : 'Validar ahora'}
            </button>
            {p.validacion && (
              <div className="resultado-validacion">
                {p.validacion.valido ? (
                  <p className="ok">✓ El EPUB es válido{p.validacion.avisos ? ` (${p.validacion.avisos} avisos)` : ''}.</p>
                ) : (
                  <p className="error">✕ {p.validacion.errores} errores, {p.validacion.avisos} avisos.</p>
                )}
                {!p.validacion.disponible && <p className="error">No se encontró EPUBCheck o Java.</p>}
                <ul className="mensajes">
                  {p.validacion.mensajes.map((x, k) => {
                    const s = p.estado.libro.secciones.find((y) => y.id === x.seccion);
                    return (
                      <li key={k} className={x.gravedad}>
                        <strong>{x.gravedad === 'error' ? 'Error' : 'Aviso'}</strong> {x.mensaje}
                        {s && (
                          <button className="enlace" onClick={() => p.onIrA(s.id)}>
                            Ir a «{s.titulo || s.tipo}»{x.linea ? `, línea ${x.linea}` : ''}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
