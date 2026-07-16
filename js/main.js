/**main
 * Main Application
 * Orquesta los módulos de renderizado, UI y Firebase
 */

import { dibujarOLED } from './renderer.js';
import {
  cargarEstado,
  enviarEstado,
  listarCanciones,
  guardarCancionCatalogo,
  suscribirLastSeen,
  listarImagenes,
  guardarImagenCatalogo,
  borrarImagenCatalogo
} from './firebase.js';
import { procesarImagen, dibujarPreviewImagen } from './imageProcessor.js';
import {
  obtenerElementos,
  poblarControles,
  marcarSegmentoActivo,
  marcarEstado,
  marcarConexion,
  setBotonEnviarEstado,
  activarLedTransmision,
  desactivarLedTransmision
} from './ui.js';
import { calcularAnchoTexto } from './fonts.js';

// ===================================================
// Estado Global
// ===================================================
let estadoActual = {
  tipo: 'texto',
  texto: 'Hola Mundo',
  tamano: 2,
  alineacion: 'centro',
  alineacionV: 'centro',
  invertido: false,
  modoTexto: 'ajustar',
  imagenData: '',
  imagenAncho: 0,
  imagenAlto: 0,
  // Canción
  cancion: '',
  cancionNotas: [], // [[freq,dur],...]
  cancionRepeticiones: 1
};

let elementos = null;
let idAnimacionScroll = null;
let scrollX = 128;
let ultimoTs = null;
const VELOCIDAD_SCROLL = 40; // px/segundo
const ANCHO_OLED = 128;

// Catálogo de canciones cargado desde Firebase
let cancionesCatalogo = {};

// Catálogo de imágenes guardadas cargado desde Firebase (/imagenes)
let imagenesCatalogo = {};

// ===================================================
// Estado de conexión del DISPOSITIVO (heartbeat)
// ===================================================
// El ESP8266 escribe oled_remota/lastSeen en cada chequeo exitoso
// (cada TIEMPO_ACTUALIZACION = 10s, ver github.cpp V1.11). Si pasó
// mucho más que eso desde el último valor visto, asumimos que el
// dispositivo está apagado o sin WiFi -- aunque Firebase en sí responda
// perfecto. El umbral es más alto que el intervalo real para dar
// margen (jitter de red, chequeo que se salteó una vez, etc.).
const UMBRAL_DESCONEXION_MS = 25000;
const INTERVALO_CHEQUEO_CONEXION_MS = 5000;

let ultimoLastSeen = null; // ms desde época (heartbeat), o null si nunca llegó nada

function evaluarConexionDispositivo() {
  if (ultimoLastSeen === null) {
    marcarConexion('sin señal del dispositivo', 'error', elementos);
    return;
  }

  const antiguedad = Date.now() - ultimoLastSeen;

  if (antiguedad <= UMBRAL_DESCONEXION_MS) {
    marcarConexion('conectado', 'ok', elementos);
  } else {
    marcarConexion('desconectado', 'error', elementos);
  }
}

function iniciarMonitoreoConexion() {
  suscribirLastSeen((valor) => {
    ultimoLastSeen = valor;
    evaluarConexionDispositivo();
  });

  // lastSeen solo cambia cuando el ESP8266 escribe -- si se apaga,
  // Firebase no dispara ningún evento nuevo (no hay nada que cambiar).
  // Este timer aparte es el que nota que "ya pasó demasiado tiempo"
  // aunque no haya llegado ningún dato nuevo.
  setInterval(evaluarConexionDispositivo, INTERVALO_CHEQUEO_CONEXION_MS);
}

// Preview audio
let audioCtx = null;
let previewAbort = false;

// ===================================================
// Animación del Scroll
// ===================================================
function detenerScroll() {
  if (idAnimacionScroll !== null) {
    cancelAnimationFrame(idAnimacionScroll);
    idAnimacionScroll = null;
  }
}

function iniciarScroll() {
  detenerScroll();
  scrollX = ANCHO_OLED;
  ultimoTs = null;

  function frame(ts) {
    if (ultimoTs === null) ultimoTs = ts;
    const dt = (ts - ultimoTs) / 1000;
    ultimoTs = ts;

    const anchoTexto = calcularAnchoTexto(estadoActual.texto, estadoActual.tamano);

    scrollX -= VELOCIDAD_SCROLL * dt;
    if (scrollX < -anchoTexto) scrollX = ANCHO_OLED;

    dibujarOLED(elementos.canvas, estadoActual, scrollX);
    idAnimacionScroll = requestAnimationFrame(frame);
  }

  idAnimacionScroll = requestAnimationFrame(frame);
}

function renderizar() {
  // "Cancion" no dibuja nada propio: en el dispositivo real, mandar una
  // canción NO toca la pantalla (ver pantalla.cpp -- mostrarPantalla()
  // es un no-op para tipo="cancion"). Sigue mostrando lo que ya había:
  // texto (con scroll incluido), imagen, apagada, o el reloj. Acá en el
  // preview hacemos lo mismo: no tocamos el canvas, para que se vea
  // consistente con lo que realmente pasa en la OLED física.
  if (estadoActual.tipo === 'cancion') {
    detenerScroll();
    return;
  }

  // Si es imagen, no animar
  if (estadoActual.tipo === 'imagen') {
    detenerScroll();
    dibujarOLED(elementos.canvas, estadoActual);
    return;
  }

  // Si es texto y modo scroll, animar
  if (estadoActual.modoTexto === 'scroll') {
    iniciarScroll();
  } else {
    detenerScroll();
    dibujarOLED(elementos.canvas, estadoActual);
  }
}

// ===================================================
// Gestión de Tipo de Contenido
// ===================================================
function mostrarSeccionSegunTipo(tipo) {
  marcarSegmentoActivo(elementos.grupoTipo, tipo);

  if (tipo === 'texto') {
    elementos.seccionTexto.style.display = 'block';
    elementos.seccionImagen.style.display = 'none';
    if (elementos.seccionCancion) elementos.seccionCancion.style.display = 'none';
  } else if (tipo === 'imagen') {
    elementos.seccionTexto.style.display = 'none';
    elementos.seccionImagen.style.display = 'block';
    if (elementos.seccionCancion) elementos.seccionCancion.style.display = 'none';
  } else if (tipo === 'cancion') {
    elementos.seccionTexto.style.display = 'none';
    elementos.seccionImagen.style.display = 'none';
    if (elementos.seccionCancion) elementos.seccionCancion.style.display = 'block';
  }
}

function cambiarTipo(nuevoTipo) {
  estadoActual.tipo = nuevoTipo;
  mostrarSeccionSegunTipo(nuevoTipo);
  renderizar();
}

// ===================================================
// Gestión de Imágenes
// ===================================================

// El umbral y el dithering solo tienen sentido cuando hay un ARCHIVO
// crudo para reprocesar (elementos.cargadorImagen.files[0]). Una imagen
// elegida desde el catálogo ya es un bitmap final: esos controles no
// aplican, así que se desactivan y se avisa, en vez de dejarlos
// "vivos" reprocesando por atrás un archivo viejo que haya quedado en
// el input de una subida anterior.
function actualizarControlesSegunOrigen() {
  const hayArchivo = elementos.cargadorImagen.files && elementos.cargadorImagen.files.length > 0;

  elementos.umbral.disabled = !hayArchivo;
  elementos.dithering.disabled = !hayArchivo;

  if (elementos.avisoImagen) {
    if (!hayArchivo && estadoActual.tipo === 'imagen' && estadoActual.imagenData) {
      elementos.avisoImagen.style.display = 'block';
      elementos.avisoImagen.textContent = 'Esta imagen viene del catálogo: el umbral y el dithering quedaron fijos desde que se guardó. Subí un archivo nuevo si querés volver a ajustarlos.';
      elementos.avisoImagen.classList.remove('error');
    } else {
      elementos.avisoImagen.style.display = 'none';
    }
  }
}

async function procesarYMostrarImagen() {
  const file = elementos.cargadorImagen.files[0];
  if (!file) return;

  try {
    marcarEstado('Procesando imagen…', null, elementos);
    
    const umbral = parseInt(elementos.umbral.value);
    const dithering = elementos.dithering.checked;
    const resultado = await procesarImagen(file, 128, 64, umbral, dithering);

    estadoActual.imagenData = resultado.imagenData;
    estadoActual.imagenAncho = resultado.imagenAncho;
    estadoActual.imagenAlto = resultado.imagenAlto;

    renderizar();
    actualizarControlesSegunOrigen();
    marcarEstado(`Imagen procesada: ${resultado.imagenAncho}×${resultado.imagenAlto}px`, 'ok', elementos);

    // Sugerir un nombre para el catálogo basado en el archivo, pero SIN
    // guardar nada todavía -- eso solo pasa si el usuario toca el botón
    // "Añadir imagen al catálogo" a propósito.
    if (elementos.nombreGaleria && !elementos.nombreGaleria.value) {
      elementos.nombreGaleria.value = file.name.replace(/\.[^.]+$/, '');
    }
  } catch (error) {
    console.error('Error procesando imagen:', error);
    marcarEstado(`Error: ${error.message}`, 'error', elementos);
  }
}

// Guarda en el catálogo (/imagenes) la imagen que está actualmente
// procesada y visible en el preview. Acción explícita del usuario,
// separada de "subir imagen para el dispositivo": no todo lo que se
// sube queda guardado, solo lo que se decide agregar acá.
async function manejarGuardarEnGaleria() {
  if (estadoActual.tipo !== 'imagen' || !estadoActual.imagenData) {
    setAvisoGaleria('Primero subí y procesá una imagen para poder guardarla.', 'error');
    return;
  }

  const nombre = (elementos.nombreGaleria && elementos.nombreGaleria.value.trim()) || '';
  if (!nombre) {
    setAvisoGaleria('Poné un nombre para guardar la imagen en el catálogo.', 'error');
    return;
  }

  setAvisoGaleria('Guardando…');
  const resultado = await guardarImagenCatalogo(
    nombre,
    estadoActual.imagenData,
    estadoActual.imagenAncho,
    estadoActual.imagenAlto,
    { origen: 'upload', fecha: Date.now() }
  );

  if (resultado.exito) {
    await poblarCatalogoImagenes();
    setAvisoGaleria(`Guardada en el catálogo como "${resultado.key}"`);
  } else {
    setAvisoGaleria('No se pudo guardar: ' + (resultado.error || ''), 'error');
  }
}

function setAvisoGaleria(text, tipo = null) {
  if (!elementos.avisoGaleria) return;
  elementos.avisoGaleria.style.display = text ? 'block' : 'none';
  elementos.avisoGaleria.textContent = text || '';
  if (tipo === 'error') elementos.avisoGaleria.classList.add('error');
  else elementos.avisoGaleria.classList.remove('error');
}

// ===================================================
// Galería de imágenes guardadas: catálogo, selección, borrado
// ===================================================
async function poblarCatalogoImagenes() {
  try {
    imagenesCatalogo = await listarImagenes() || {};
    if (elementos.panelGaleria && elementos.panelGaleria.style.display !== 'none') {
      renderizarGaleria();
    }
  } catch (err) {
    console.error('Error cargando catálogo de imágenes:', err);
  }
}

function renderizarGaleria() {
  const grid = elementos.gridGaleria;
  if (!grid) return;
  grid.innerHTML = '';

  const claves = Object.keys(imagenesCatalogo);

  if (claves.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'galeria-vacio';
    vacio.textContent = 'Todavía no hay imágenes guardadas.';
    grid.appendChild(vacio);
    return;
  }

  claves.forEach((key) => {
    const entry = imagenesCatalogo[key];
    if (!entry || !entry.datos) return;

    const item = document.createElement('div');
    item.className = 'item-galeria';
    if (estadoActual.tipo === 'imagen' && estadoActual.imagenData === entry.datos) {
      item.classList.add('activo');
    }

    const canvas = document.createElement('canvas');
    canvas.width = entry.ancho || 128;
    canvas.height = entry.alto || 64;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      dibujarPreviewImagen(canvas, entry.datos, entry.ancho || 128, entry.alto || 64, '#4dd2ff');
    } catch (e) {
      console.error('Error dibujando miniatura de galería:', e);
    }

    const nombre = document.createElement('span');
    nombre.className = 'item-galeria-nombre';
    nombre.textContent = key;

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-galeria-borrar';
    borrar.textContent = 'Borrar';
    borrar.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const resultado = await borrarImagenCatalogo(key);
      if (resultado.exito) {
        await poblarCatalogoImagenes();
        renderizarGaleria();
      } else {
        marcarEstado('No se pudo borrar la imagen: ' + (resultado.error || ''), 'error', elementos);
      }
    });

    item.addEventListener('click', () => {
      estadoActual.tipo = 'imagen';
      estadoActual.imagenData = entry.datos;
      estadoActual.imagenAncho = entry.ancho || 128;
      estadoActual.imagenAlto = entry.alto || 64;

      // Limpiar el input de archivo: si quedaba un archivo de una subida
      // anterior, mover el umbral o el dithering reprocesaba ESE archivo
      // viejo por atrás en vez de no hacer nada, dando resultados
      // inconsistentes con lo que se ve en pantalla (la imagen del
      // catálogo ya es un bitmap fijo, no hay nada que reprocesar).
      elementos.cargadorImagen.value = '';

      mostrarSeccionSegunTipo('imagen');
      marcarSegmentoActivo(elementos.grupoTipo, 'imagen');
      renderizar();
      actualizarControlesSegunOrigen();
      cerrarPanelGaleria();
      marcarEstado(`Imagen "${key}" cargada desde la galería`, 'ok', elementos);
    });

    item.appendChild(canvas);
    item.appendChild(nombre);
    item.appendChild(borrar);
    grid.appendChild(item);
  });
}

function abrirPanelGaleria() {
  if (!elementos.panelGaleria) return;
  elementos.panelGaleria.style.display = 'block';
  renderizarGaleria();
  poblarCatalogoImagenes(); // refresca por si se subió algo desde otra pestaña
}

function cerrarPanelGaleria() {
  if (!elementos.panelGaleria) return;
  elementos.panelGaleria.style.display = 'none';
}

// ===================================================
// Canciones: catálogo, selección, upload, preview
// ===================================================
async function poblarCatalogoCanciones() {
  try {
    const listado = await listarCanciones();
    cancionesCatalogo = listado || {};

    // Limpiar select
    elementos.seleccionCancion.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Seleccioná --';
    elementos.seleccionCancion.appendChild(placeholder);

    Object.keys(cancionesCatalogo).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      // mostrar nombre legible si meta tiene nombre, si no usar key
      const entry = cancionesCatalogo[key] || {};
      let label = key;
      if (entry.meta && entry.meta.titulo) label = entry.meta.titulo;
      opt.textContent = label;
      elementos.seleccionCancion.appendChild(opt);
    });

    // Si estadoActual.cancion ya tiene valor, seleccionarlo
    if (estadoActual.cancion) {
      elementos.seleccionCancion.value = estadoActual.cancion;
    }
  } catch (err) {
    console.error('Error cargando catálogo de canciones:', err);
  }
}

function setAvisoCancion(text, tipo = null) {
  if (!elementos.avisoCancion) return;
  elementos.avisoCancion.style.display = text ? 'block' : 'none';
  elementos.avisoCancion.textContent = text || '';
  if (tipo === 'error') elementos.avisoCancion.classList.add('error');
  else elementos.avisoCancion.classList.remove('error');
}

async function manejarSeleccionCancion() {
  const key = elementos.seleccionCancion.value;
  if (!key) {
    estadoActual.cancion = '';
    estadoActual.cancionNotas = [];
    return;
  }
  const entry = cancionesCatalogo[key];
  if (!entry) {
    setAvisoCancion('No se encontró la canción en el catálogo', 'error');
    return;
  }
  estadoActual.cancion = key;
  estadoActual.cancionNotas = entry.notas || [];
  // si el catálogo incluye meta.repeticiones la usamos; si no mantener input
  if (entry.meta && entry.meta.repeticiones) {
    estadoActual.cancionRepeticiones = Number(entry.meta.repeticiones) || 1;
    elementos.inputRepeticiones.value = String(estadoActual.cancionRepeticiones);
  }
  setAvisoCancion(`Canción cargada: ${key}`);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function playPreviewLocal(notas, repeticiones = 1) {
  if (!notas || notas.length === 0) return;
  // detener preview previo
  previewAbort = true;
  if (audioCtx) {
    try { audioCtx.close(); } catch (e) {}
  }
  await sleep(50);
  previewAbort = false;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
    for (let r = 0; r < repeticiones && !previewAbort; r++) {
      for (let i = 0; i < notas.length && !previewAbort; i++) {
        const [freq, dur] = notas[i];
        if (freq > 0) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.value = Math.max(20, freq);
          gain.gain.value = 0.05; // volumen bajo
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          await sleep(dur);
          osc.stop();
          // small gap handled by awaiting a tiny time to avoid clicks
          await sleep(10);
        } else {
          // silencio
          await sleep(dur);
        }
      }
    }
  } catch (e) {
    console.error('Error en preview audio:', e);
  } finally {
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
    previewAbort = false;
  }
}

async function manejarCargadorCancion(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json.notas || !Array.isArray(json.notas)) throw new Error('Formato inválido: falta "notas"');
    // validar notas
    const notas = [];
    for (const p of json.notas) {
      if (!Array.isArray(p) || p.length < 2) throw new Error('Formato inválido en notas');
      const freq = Number(p[0]) || 0;
      const dur = Number(p[1]) || 0;
      notas.push([freq, dur]);
    }
    const nombre = json.nombre ? String(json.nombre) : file.name.replace(/\.[^.]+$/, '');
    // guardar en catálogo y seleccionar
    const result = await guardarCancionCatalogo(nombre, notas, { origen: 'upload' });
    if (!result.exito) {
      setAvisoCancion('No se pudo guardar canción en catálogo: ' + (result.error || ''), 'error');
      return;
    }
    // actualizar catálogo en memoria y select
    await poblarCatalogoCanciones();
    elementos.seleccionCancion.value = nombre;
    estadoActual.cancion = nombre;
    estadoActual.cancionNotas = notas;
    setAvisoCancion(`Canción subida y seleccionada: ${nombre}`);
  } catch (err) {
    console.error('Error al cargar canción:', err);
    setAvisoCancion('Error al cargar canción: ' + err.message, 'error');
  }
}

async function manejarPreviewCancion() {
  if (!estadoActual.cancionNotas || estadoActual.cancionNotas.length === 0) {
    setAvisoCancion('No hay notas cargadas para previsualizar', 'error');
    return;
  }
  setAvisoCancion('Reproduciendo previsualización...');
  const rep = Number(elementos.inputRepeticiones.value) || 1;
  try {
    await playPreviewLocal(estadoActual.cancionNotas, rep);
    setAvisoCancion('');
  } catch (err) {
    console.error('Error en preview:', err);
    setAvisoCancion('Error en previsualización', 'error');
  }
}

// ===================================================
// Event Listeners de Controles
// ===================================================
function configurarEventos() {
  // Selector de tipo
  elementos.grupoTipo.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    cambiarTipo(btn.dataset.valor);
  });

  // Texto
  elementos.texto.addEventListener('input', () => {
    estadoActual.texto = elementos.texto.value;
    elementos.contador.textContent = String(elementos.texto.value.length);
    renderizar();
  });

  // Invertido
  elementos.invertido.addEventListener('change', () => {
    estadoActual.invertido = elementos.invertido.checked;
    renderizar();
  });

  // Tamaño
  elementos.grupoTamano.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    estadoActual.tamano = Number(btn.dataset.valor);
    marcarSegmentoActivo(elementos.grupoTamano, estadoActual.tamano);
    renderizar();
  });

  // Alineación
  elementos.grupoAlineacion.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    estadoActual.alineacion = btn.dataset.valor;
    marcarSegmentoActivo(elementos.grupoAlineacion, estadoActual.alineacion);
    renderizar();
  });

  // Alineación vertical
  elementos.grupoAlineacionV.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    estadoActual.alineacionV = btn.dataset.valor;
    marcarSegmentoActivo(elementos.grupoAlineacionV, estadoActual.alineacionV);
    renderizar();
  });

  // Modo de texto
  elementos.grupoModo.addEventListener('change', (e) => {
    if (e.target.name !== 'modoTexto') return;
    estadoActual.modoTexto = e.target.value;
    renderizar();
  });

  // Cargador de imagen: solo procesa y muestra el preview. Guardar en
  // el catálogo es una acción aparte (botón "Añadir imagen al catálogo").
  elementos.cargadorImagen.addEventListener('change', () => procesarYMostrarImagen());

  // Umbral de binarización
  elementos.umbral.addEventListener('input', (e) => {
    elementos.valorUmbral.textContent = e.target.value;
    if (elementos.cargadorImagen.files.length > 0) {
      procesarYMostrarImagen();
    }
  });

  // Dithering (Floyd-Steinberg) vs umbral simple
  elementos.dithering.addEventListener('change', () => {
    if (elementos.cargadorImagen.files.length > 0) {
      procesarYMostrarImagen();
    }
  });

  // Guardar la imagen actualmente procesada en el catálogo (galería)
  if (elementos.botonGuardarGaleria) {
    elementos.botonGuardarGaleria.addEventListener('click', manejarGuardarEnGaleria);
  }

  // Galería de imágenes guardadas
  if (elementos.botonGaleria) {
    elementos.botonGaleria.addEventListener('click', () => {
      const abierta = elementos.panelGaleria && elementos.panelGaleria.style.display !== 'none';
      if (abierta) {
        cerrarPanelGaleria();
      } else {
        abrirPanelGaleria();
      }
    });
  }
  if (elementos.cerrarGaleria) {
    elementos.cerrarGaleria.addEventListener('click', cerrarPanelGaleria);
  }

  // Enviar
  elementos.botonEnviar.addEventListener('click', enviarAFirebase);

  // Canción: selección
  if (elementos.seleccionCancion) {
    elementos.seleccionCancion.addEventListener('change', manejarSeleccionCancion);
  }
  if (elementos.previewCancion) {
    elementos.previewCancion.addEventListener('click', manejarPreviewCancion);
  }
  if (elementos.cargadorCancion) {
    elementos.cargadorCancion.addEventListener('change', manejarCargadorCancion);
  }
  if (elementos.inputRepeticiones) {
    elementos.inputRepeticiones.addEventListener('input', (e) => {
      const v = Number(e.target.value) || 1;
      estadoActual.cancionRepeticiones = v;
    });
  }
}

// ===================================================
// Firebase: Cargar y Enviar
// ===================================================
async function cargarEstadoInicial() {
  try {
    const resultado = await cargarEstado();
    
    if (resultado.exito) {
      if (!resultado.vacio) {
        // Hay datos en Firebase
        estadoActual = {
          tipo: resultado.tipo || 'texto',
          texto: resultado.texto,
          tamano: resultado.tamano,
          alineacion: resultado.alineacion,
          alineacionV: resultado.alineacionV || 'centro',
          invertido: resultado.invertido,
          modoTexto: resultado.modoTexto,
          imagenData: resultado.imagenData || '',
          imagenAncho: resultado.imagenAncho || 0,
          imagenAlto: resultado.imagenAlto || 0,
          cancion: resultado.cancionNombre || '',
          cancionRepeticiones: resultado.cancionRepeticiones || 1,
          cancionNotas: []
        };
      }

      // poblar catálogo de canciones, catálogo de imágenes, y controles
      await poblarCatalogoCanciones();
      await poblarCatalogoImagenes();
      poblarControles(estadoActual, elementos);
      mostrarSeccionSegunTipo(estadoActual.tipo);
      renderizar();
      actualizarControlesSegunOrigen();
      // El LED de conexión ya no se marca acá: refleja el heartbeat del
      // dispositivo (ver iniciarMonitoreoConexion), no si el navegador
      // pudo leer Firebase, que es una cosa completamente distinta.
      marcarEstado(
        resultado.vacio
          ? 'Conectado a Firebase. Todavía no hay datos.'
          : `En la OLED ahora mismo: v${resultado.version}`,
        'ok',
        elementos
      );
    } else {
      poblarControles(estadoActual, elementos);
      renderizar();
      marcarConexion('sin Firebase', 'error', elementos);
      marcarEstado('No se pudo leer Firebase.', 'error', elementos);
    }
  } catch (err) {
    console.error('Error durante carga inicial:', err);
    poblarControles(estadoActual, elementos);
    renderizar();
    marcarConexion('sin Firebase', 'error', elementos);
    marcarEstado('Error de conexión a Firebase.', 'error', elementos);
  }
}

async function enviarAFirebase() {
  setBotonEnviarEstado(false, elementos);
  marcarEstado('Enviando…', null, elementos);
  activarLedTransmision(elementos);

  try {
    // asegurar que el estadoActual tiene campos de canción cuando corresponda
    if (estadoActual.tipo === 'cancion') {
      // si el usuario eligió una canción del catálogo pero no cargó notas en memoria,
      // intenta rellenarlas desde el catálogo
      if ((!estadoActual.cancionNotas || estadoActual.cancionNotas.length === 0) && estadoActual.cancion) {
        const entry = cancionesCatalogo[estadoActual.cancion];
        if (entry && entry.notas) {
          estadoActual.cancionNotas = entry.notas;
        }
      }
      estadoActual.cancionRepeticiones = Number(elementos.inputRepeticiones.value) || Number(estadoActual.cancionRepeticiones) || 1;
    }

    const resultado = await enviarEstado(estadoActual);

    if (resultado.exito) {
      marcarEstado(
        `Enviado ✅ · v${resultado.version}. La OLED la toma en el próximo chequeo.`,
        'ok',
        elementos
      );
    } else {
      marcarEstado('Error al enviar. Revisar conexión.', 'error', elementos);
    }
  } catch (err) {
    console.error('Error al enviar:', err);
    marcarEstado('Error desconocido al enviar.', 'error', elementos);
  } finally {
    setBotonEnviarEstado(true, elementos);
    desactivarLedTransmision(elementos);
  }
}

// ===================================================
// Inicialización
// ===================================================
async function inicializar() {
  elementos = obtenerElementos();
  
  poblarControles(estadoActual, elementos);
  renderizar();
  actualizarControlesSegunOrigen();
  marcarConexion('conectando…', null, elementos);
  
  configurarEventos();
  iniciarMonitoreoConexion();

  await cargarEstadoInicial();
}

// Ejecutar al cargar el DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializar);
} else {
  inicializar();
}
