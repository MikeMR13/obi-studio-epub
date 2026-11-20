// Transformación: devuelve el libro con los espacios corregidos.

function limpiar(inlines) {
  const salida = inlines.map((i) => (i.tipo === 'texto' ? { ...i, texto: i.texto.replace(/[  ]{2,}/g, ' ') } : i));
  const primero = salida.find((i) => i.tipo === 'texto');
  if (primero && salida[0] === primero) primero.texto = primero.texto.replace(/^\s+/, '');
  const ultimo = [...salida].reverse().find((i) => i.tipo === 'texto');
  if (ultimo && salida[salida.length - 1] === ultimo) ultimo.texto = ultimo.texto.replace(/\s+$/, '');
  return salida.filter((i) => i.tipo !== 'texto' || i.texto !== '');
}

obi.registrar({
  transformar(libro) {
    let cambios = 0;
    for (const s of libro.secciones) {
      const antes = JSON.stringify(s.bloques);
      s.bloques = s.bloques
        .map((b) => (b.tipo === 'parrafo' || b.tipo === 'subtitulo' ? { ...b, contenido: limpiar(b.contenido) } : b))
        .filter((b) => !(b.tipo === 'parrafo' && b.contenido.length === 0));
      for (const n of s.notas) n.contenido = limpiar(n.contenido);
      if (JSON.stringify(s.bloques) !== antes) cambios++;
    }
    console.log(`Secciones cambiadas: ${cambios}.`);
    return libro;
  },
});
