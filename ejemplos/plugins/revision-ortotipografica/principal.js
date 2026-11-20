// Revisión ortotipográfica para textos en español.
// Solo lee el libro: devuelve una lista de hallazgos.

const REGLAS = [
  { patron: / {2,}/, mensaje: 'espacio doble' },
  { patron: /"/, mensaje: 'comillas rectas (usa « » o “ ”)' },
  { patron: /(^|[^.])\.\.\.(?!\.)/, mensaje: 'tres puntos sueltos (usa el carácter …)' },
  { patron: / [,.;:!?)»”]/, mensaje: 'espacio antes de un signo de puntuación' },
  { patron: /[¿¡] /, mensaje: 'espacio después de ¿ o ¡' },
];

function parejas(texto, abre, cierra) {
  let n = 0;
  for (const c of texto) {
    if (c === abre) n++;
    else if (c === cierra) n--;
  }
  return n;
}

function fragmento(texto, indice) {
  const ini = Math.max(0, indice - 25);
  return (ini > 0 ? '…' : '') + texto.slice(ini, indice + 25).replace(/\s+/g, ' ') + (indice + 25 < texto.length ? '…' : '');
}

obi.registrar({
  revisar(libro) {
    const hallazgos = [];
    for (const seccion of libro.secciones) {
      const nombre = seccion.titulo || 'Sección sin título';
      const cuenta = new Map();
      for (const bloque of seccion.bloques) {
        const texto = obi.textoBloque(bloque);
        if (!texto) continue;
        for (const regla of REGLAS) {
          const m = regla.patron.exec(texto);
          if (!m) continue;
          const c = cuenta.get(regla.mensaje) || { veces: 0, ejemplo: fragmento(texto, m.index) };
          c.veces++;
          cuenta.set(regla.mensaje, c);
        }
        if (bloque.tipo === 'parrafo' && bloque.estilo !== 'onomatopeya') {
          if (parejas(texto, '¿', '?') > 0 || parejas(texto, '¡', '!') > 0)
            hallazgos.push({ gravedad: 'aviso', seccion: seccion.id, mensaje: `${nombre}: falta el signo de cierre en «${fragmento(texto, 0)}»` });
          if (texto.includes('?') && !texto.includes('¿'))
            hallazgos.push({ gravedad: 'info', seccion: seccion.id, mensaje: `${nombre}: pregunta sin ¿ de apertura en «${fragmento(texto, texto.indexOf('?'))}»` });
          if (texto.length > 2500)
            hallazgos.push({ gravedad: 'info', seccion: seccion.id, mensaje: `${nombre}: párrafo de ${texto.length} caracteres; quizá convenga dividirlo.` });
        }
      }
      for (const [mensaje, c] of cuenta)
        hallazgos.push({ gravedad: 'aviso', seccion: seccion.id, mensaje: `${nombre}: ${mensaje} en ${c.veces} párrafo${c.veces === 1 ? '' : 's'}, por ejemplo «${c.ejemplo}»` });
    }
    console.log(`Revisadas ${libro.secciones.length} secciones.`);
    return hallazgos;
  },
});
