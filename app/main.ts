// Proceso principal de Electron: arranca el servidor local y abre la ventana.

import { app, BrowserWindow, Menu, dialog, shell, type MenuItemConstructorOptions } from 'electron';
import { iniciarServidor } from './servidor.js';
import { AlmacenPlugins } from '../src/plugins.js';
import { ArchivoConfiguracion, diccionariosPara } from '../src/configuracion.js';
import electronUpdater from 'electron-updater';
import { Backend } from './backend.js';
import { join } from 'node:path';

let ventana: BrowserWindow | null = null;

/** Imprime a PDF con el Chromium de Electron: ventana oculta con el visor de Vivliostyle. */
/** Informe de accesibilidad: abre cada documento en una ventana oculta y ejecuta axe. */
async function evaluadorElectron(urls: string[], codigo: string): Promise<unknown[]> {
  const oculta = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    const salida: unknown[] = [];
    for (const url of urls) {
      await oculta.loadURL(url);
      salida.push(await oculta.webContents.executeJavaScript(codigo, true));
    }
    return salida;
  } finally {
    oculta.destroy();
  }
}

async function renderizadorElectron(url: string): Promise<Uint8Array> {
  const oculta = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true, offscreen: false } });
  try {
    await oculta.loadURL(url);
    const limite = Date.now() + 300_000;
    for (;;) {
      const estado = await oculta.webContents.executeJavaScript(
        `document.querySelector('[data-vivliostyle-viewer-status]')?.getAttribute('data-vivliostyle-viewer-status')`,
      );
      if (estado === 'complete') break;
      if (Date.now() > limite) throw new Error('La compaginación tardó demasiado.');
      await new Promise((ok) => setTimeout(ok, 250));
    }
    await oculta.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const pdf = await oculta.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    });
    return new Uint8Array(pdf);
  } finally {
    oculta.destroy();
  }
}
let salirConfirmado = false;

async function crearVentana() {
  const backend = new Backend(join(app.getPath('userData'), 'recuperacion'));
  backend.configuracion = new ArchivoConfiguracion(process.env.OBI_CONFIGURACION || join(app.getPath('userData'), 'configuracion.json'));
  backend.plugins = new AlmacenPlugins(process.env.OBI_PLUGINS || join(app.getPath('userData'), 'plugins'));
  backend.renderizador = renderizadorElectron;
  backend.evaluador = evaluadorElectron;
  const { url, puerto } = await iniciarServidor({ backend });
  const origen = `http://127.0.0.1:${puerto}`;

  ventana = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Obi Studio EPUB',
    backgroundColor: '#efeae2',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  // Corrector ortográfico: los idiomas de la configuración y el del libro abierto.
  // (En Windows y macOS se usa el corrector del sistema, que reconoce el idioma por sí mismo.)
  const sesion = ventana.webContents.session;
  backend.alCambiarCorrector = (idiomas) => {
    if (process.platform === 'darwin') return;
    const dic = diccionariosPara(idiomas, sesion.availableSpellCheckerLanguages);
    if (dic.length) sesion.setSpellCheckerLanguages(dic);
  };
  void backend.avisarCorrector();

  // Actualizaciones automáticas (solo la app instalada; los instaladores publican latest.yml en la versión de GitHub).
  if (app.isPackaged) {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (i) => (backend.actualizacion = { version: i.version, descargada: false }));
    autoUpdater.on('update-downloaded', (i) => (backend.actualizacion = { version: i.version, descargada: true }));
    autoUpdater.on('error', (e) => console.error('Actualización:', e.message));
    backend.comprobarActualizacion = async () => {
      const r = await autoUpdater.checkForUpdates();
      return r?.isUpdateAvailable ? r.updateInfo.version : undefined;
    };
    backend.instalarActualizacion = () =>
      void backend.guardarRecuperacion().finally(() => {
        // Lo último queda en la copia de recuperación: se puede salir sin preguntar.
        salirConfirmado = true;
        autoUpdater.quitAndInstall();
      });
    void backend.configuracion.leer().then(async (c) => {
      if (c.buscarActualizaciones) await autoUpdater.checkForUpdates().catch(() => undefined);
    });
  }
  ventana.once('ready-to-show', () => ventana?.show());

  // Solo se navega dentro de la app; los enlaces externos se abren en el navegador del sistema.
  ventana.webContents.on('will-navigate', (e, destino) => {
    if (!destino.startsWith(origen)) {
      e.preventDefault();
      if (/^https?:/.test(destino)) void shell.openExternal(destino);
    }
  });
  ventana.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (/^https?:/.test(destino)) void shell.openExternal(destino);
    return { action: 'deny' };
  });

  // Descargas (exportar EPUB, guardar proyecto): diálogo nativo de guardar.
  ventana.webContents.session.on('will-download', (_e, item) => {
    const nombre = item.getFilename();
    const tipo = nombre.endsWith('.kepub.epub') ? 'kepub' : nombre.split('.').pop();
    const filtros: Record<string, { titulo: string; filtro: { name: string; extensions: string[] } }> = {
      epub: { titulo: 'Exportar EPUB', filtro: { name: 'Libro EPUB', extensions: ['epub'] } },
      kepub: { titulo: 'Exportar KEPUB para Kobo', filtro: { name: 'Libro KEPUB', extensions: ['epub'] } },
      pdf: { titulo: 'Exportar PDF', filtro: { name: 'PDF', extensions: ['pdf'] } },
      html: { titulo: 'Guardar informe de accesibilidad', filtro: { name: 'Página web', extensions: ['html'] } },
      docx: { titulo: 'Exportar Word para corrección', filtro: { name: 'Documento de Word', extensions: ['docx'] } },
      obi: { titulo: 'Guardar proyecto', filtro: { name: 'Proyecto de Obi Studio', extensions: ['obi'] } },
    };
    // Exportadores de plugins: cualquier otra extensión.
    const f = filtros[tipo ?? 'obi'] ?? (tipo ? { titulo: 'Exportar', filtro: { name: tipo.toUpperCase(), extensions: [tipo] } } : filtros.obi);
    item.setSaveDialogOptions({ title: f.titulo, defaultPath: join(app.getPath('documents'), nombre), filters: [f.filtro] });
  });

  // Aviso de cambios sin guardar al cerrar.
  ventana.on('close', async (e) => {
    if (salirConfirmado || !backend.cambiado) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(ventana!, {
      type: 'question',
      buttons: ['Guardar copia y salir', 'Salir sin guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      message: 'Hay cambios sin guardar.',
      detail: 'Si sales sin guardar, el último estado queda en la copia de recuperación.',
    });
    if (r.response === 2) return;
    await backend.guardarRecuperacion();
    if (r.response === 0) {
      const destino = await dialog.showSaveDialog(ventana!, {
        defaultPath: join(app.getPath('documents'), backend.nombreArchivo),
        filters: [{ name: 'Proyecto de Obi Studio', extensions: ['obi'] }],
      });
      if (destino.canceled || !destino.filePath) return;
      const { guardarProyecto } = await import('../src/proyecto.js');
      await guardarProyecto(destino.filePath, backend.libro);
    }
    salirConfirmado = true;
    ventana?.close();
  });

  const plantilla: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'Archivo', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit', label: 'Salir' }] },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'pasteAndMatchStyle', label: 'Pegar sin formato' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const, label: 'Herramientas de desarrollo' }]),
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Buscar actualizaciones…',
          click: async () => {
            if (!backend.comprobarActualizacion) return void dialog.showMessageBox(ventana!, { message: 'Las actualizaciones automáticas solo funcionan en la app instalada.' });
            try {
              const v = await backend.comprobarActualizacion();
              await dialog.showMessageBox(ventana!, { message: v ? `Hay una versión nueva: ${v}` : 'Tienes la última versión.', detail: v ? 'Se descarga en segundo plano y se instala al cerrar la app.' : `Obi Studio EPUB ${app.getVersion()}` });
            } catch (e) {
              await dialog.showMessageBox(ventana!, { type: 'warning', message: 'No se pudo buscar actualizaciones.', detail: (e as Error).message });
            }
          },
        },
        { label: 'Acerca de Obi Studio', click: () => dialog.showMessageBox(ventana!, { message: `Obi Studio EPUB ${app.getVersion()}`, detail: 'Maquetador de novelas ligeras. Valida con EPUBCheck 5.4.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla));

  // Menú contextual con sugerencias de ortografía.
  ventana.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = p.dictionarySuggestions.slice(0, 6).map((s) => ({ label: s, click: () => ventana?.webContents.replaceMisspelling(s) }));
    if (p.misspelledWord) items.push({ label: 'Añadir al diccionario', click: () => ventana?.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    if (p.isEditable) items.push({ role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' });
    else if (p.selectionText) items.push({ role: 'copy', label: 'Copiar' });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  await ventana.loadURL(url);
}

app.whenReady().then(crearVentana);
app.on('window-all-closed', () => app.quit());
