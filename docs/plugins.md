# Plugins de Obi Studio

Un plugin es un archivo `.obiplugin`: un ZIP con dos archivos.

```
manifiesto.json
principal.js
```

Empaquétalo con `node scripts/empaquetar-plugin.mjs <carpeta> [salida.obiplugin]` e instálalo desde **Más → Plugins… → Instalar plugin…**. En `ejemplos/plugins/` hay tres plugins completos.

## manifiesto.json

```json
{
  "id": "mi-plugin",
  "nombre": "Mi plugin",
  "version": "1.0.0",
  "autor": "Tu nombre",
  "descripcion": "Qué hace, en una o dos frases.",
  "tipos": ["revision"],
  "permisos": []
}
```

| Campo | Notas |
| --- | --- |
| `id` | Minúsculas, números, `.`, `-` y `_`. Instalar otro paquete con el mismo id lo actualiza. |
| `tipos` | Uno o varios: `revision`, `transformacion`, `exportador`, `importador`. |
| `permisos` | `recursos` (ver y cambiar los bytes de las imágenes) y `red` (`fetch` a URL http/https). Se muestran al instalar. |
| `extensiones` | Solo importadores: extensiones que abre, sin punto (`["txt"]`). |
| `salida` | Solo exportadores: `{ "extension": "txt", "tipoMime": "text/plain; charset=utf-8" }`. |

## principal.js

Es un script, no un módulo. Llama una sola vez a `obi.registrar` con las funciones de sus tipos; pueden ser `async`.

```js
obi.registrar({
  revisar(libro) {
    return [{ gravedad: 'aviso', mensaje: 'Algo que revisar', seccion: libro.secciones[0].id }];
  },
  transformar(libro) {
    // Cambia el libro y devuélvelo entero.
    return libro;
  },
  exportar(libro) {
    return { nombre: libro.metadatos.titulo, datos: 'texto o Uint8Array' };
  },
  importar(datos, nombreArchivo) {
    // datos es un Uint8Array con el archivo.
    return { metadatos: { titulo: 'Título' }, secciones: [{ tipo: 'capitulo', titulo: 'Capítulo 1', bloques: [], notas: [] }] };
  },
});
```

El libro sigue el modelo de `src/model.ts`: `metadatos`, `secciones` (cada una con `bloques` y `notas`), `recursos`, `tema`. Un párrafo es `{ tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: '…', marcas: ['cursiva'] }] }`.

Ayudas disponibles:

- `obi.texto(inlines)`: texto plano de un contenido.
- `obi.textoBloque(bloque)`: texto plano de un párrafo, subtítulo, lista o recuadro.
- `console.log(...)`: los mensajes se muestran al terminar.
- `fetch(url)`: solo con el permiso `red`; devuelve `{ ok, status, text(), json() }`.

## Qué no puede hacer un plugin

- Leer ni escribir archivos, abrir procesos, cargar módulos (`require`, `import`) ni usar `eval` o `new Function`.
- Ver las imágenes sin el permiso `recursos`: recibe los recursos con `datos` vacíos y, aunque los cambie, se conservan los originales.
- Tardar más de 30 s o usar más de 512 MB: el proceso se detiene.
- Devolver un libro roto: se comprueban los tipos de sección y de bloque, los estilos, las notas, las imágenes y que el XHTML de los bloques de código esté bien formado. Si algo falla, el libro no cambia y se muestra el motivo.

Las transformaciones se pueden deshacer desde el gestor de plugins mientras no se haga otro cambio.
