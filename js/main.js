/**main
 * Main Application
 * Orquesta los módulos de renderizado, UI y Firebase
 */

import { dibujarOLED } from './renderer.js';
import { cargarEstado, enviarEstado, listarCanciones, guardarCancionCatalogo } from './firebase.js';
import { procesarImagen } from './imageProcessor.js';
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
    marcarEstado(`Imagen procesada: ${resultado.imagenAncho}×${resultado.imagenAlto}px`, 'ok', elementos);
  } catch (error) {
    console.error('Error procesando imagen:', error);
    marcarEstado(`Error: ${error.message}`, 'error', elementos);
  }
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

  // Cargador de imagen
  elementos.cargadorImagen.addEventListener('change', procesarYMostrarImagen);

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

      // poblar catálogo de canciones y controles
      await poblarCatalogoCanciones();
      poblarControles(estadoActual, elementos);
      mostrarSeccionSegunTipo(estadoActual.tipo);
      renderizar();
      marcarConexion('conectado', 'ok', elementos);
      marcarEstado(
        resultado.vacio
          ? 'Conectado. Todavía no hay datos.'
          : `En la OLED ahora mismo: v${resultado.version}`,
        'ok',
        elementos
      );
    } else {
      poblarControles(estadoActual, elementos);
      renderizar();
      marcarConexion('sin conexión', 'error', elementos);
      marcarEstado('No se pudo leer Firebase.', 'error', elementos);
    }
  } catch (err) {
    console.error('Error durante carga inicial:', err);
    poblarControles(estadoActual, elementos);
    renderizar();
    marcarConexion('sin conexión', 'error', elementos);
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
  marcarConexion('conectando…', null, elementos);
  
  configurarEventos();
  
  await cargarEstadoInicial();
}

// Ejecutar al cargar el DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializar);
} else {
  inicializar();
}
