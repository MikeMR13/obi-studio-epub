import { useEffect, useState } from 'react';
import type { Metadatos, Seccion, Tema, Tipografia, RolCredito } from '../../../src/model';
import { ROLES, TIPOS_SECCION } from '../../../src/model';
import type { Estado, Resultado } from '../api';

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

        {p.pestana === 'tema' && (
          <>
            <div className="muestra-tema" style={{ fontFamily: t.fuenteTexto, lineHeight: t.interlineado }}>
              <h3 style={{ fontFamily: t.fuenteTitulos }}>Capítulo 1</h3>
              <p style={{ textIndent: 0, textAlign: t.alinear === 'justificado' ? 'justify' : 'left' }}>—¿De verdad crees que el gremio nos aceptará? —preguntó Aria, mirando el cartel.</p>
              <p style={{ textIndent: `${t.sangria}em`, marginTop: `${t.espacioParrafos}em`, textAlign: t.alinear === 'justificado' ? 'justify' : 'left' }}>
                El viento movía las banderas de la ciudad mientras el sol se ocultaba tras las murallas.
              </p>
            </div>
            <div className="fila-dos">
              <label className="campo">
                <span>Letra del texto</span>
                <select value={t.fuenteTexto} onChange={(e) => p.onTema({ fuenteTexto: e.target.value as Tema['fuenteTexto'] })}>
                  <option value="serif">Con remate (serif)</option>
                  <option value="sans-serif">Sin remate (sans)</option>
                </select>
              </label>
              <label className="campo">
                <span>Letra de los títulos</span>
                <select value={t.fuenteTitulos} onChange={(e) => p.onTema({ fuenteTitulos: e.target.value as Tema['fuenteTitulos'] })}>
                  <option value="serif">Con remate (serif)</option>
                  <option value="sans-serif">Sin remate (sans)</option>
                </select>
              </label>
            </div>
            <label className="campo">
              <span>Interlineado: {t.interlineado.toFixed(2)}</span>
              <input type="range" min={1.1} max={2} step={0.05} value={t.interlineado} onChange={(e) => p.onTema({ interlineado: Number(e.target.value) })} />
            </label>
            <label className="campo">
              <span>Sangría: {t.sangria.toFixed(1)} em</span>
              <input type="range" min={0} max={3} step={0.1} value={t.sangria} onChange={(e) => p.onTema({ sangria: Number(e.target.value) })} />
            </label>
            <label className="campo">
              <span>Espacio entre párrafos: {t.espacioParrafos.toFixed(1)} em</span>
              <input type="range" min={0} max={1.5} step={0.1} value={t.espacioParrafos} onChange={(e) => p.onTema({ espacioParrafos: Number(e.target.value) })} />
            </label>
            <div className="fila-dos">
              <label className="campo">
                <span>Alineación</span>
                <select value={t.alinear} onChange={(e) => p.onTema({ alinear: e.target.value as Tema['alinear'] })}>
                  <option value="justificado">Justificado</option>
                  <option value="izquierda">A la izquierda</option>
                </select>
              </label>
              <label className="campo">
                <span>Separador de escena</span>
                <select value={t.separador} onChange={(e) => p.onTema({ separador: e.target.value as Tema['separador'] })}>
                  <option value="asteriscos">* * *</option>
                  <option value="linea">Línea</option>
                  <option value="espacio">Espacio en blanco</option>
                </select>
              </label>
            </div>
            <fieldset className="grupo">
              <legend>Tipografía española</legend>
              <label className="casilla">
                <input type="checkbox" checked={tip.raya} onChange={(e) => p.onTipografia({ raya: e.target.checked })} />
                Raya de diálogo (— en vez de -)
              </label>
              <label className="casilla">
                <input type="checkbox" checked={tip.suspensivos} onChange={(e) => p.onTipografia({ suspensivos: e.target.checked })} />
                Puntos suspensivos (… en vez de ...)
              </label>
              <label className="campo">
                <span>Comillas</span>
                <select value={tip.comillas} onChange={(e) => p.onTipografia({ comillas: e.target.value as Tipografia['comillas'] })}>
                  <option value="latinas">Latinas « »</option>
                  <option value="inglesas">Inglesas “ ”</option>
                  <option value="sin-cambio">No cambiar</option>
                </select>
              </label>
              <button onClick={() => p.onAplicarTipografia(true)}>Aplicar a todo el libro</button>
            </fieldset>
          </>
        )}

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
