/**main
 * Main Application
 * Orquesta los módulos de renderizado, UI y Firebase
 */

import { dibujarOLED } from './renderer.js';
import { cargarEstado, enviarEstado } from './firebase.js';
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
  invertido: false,
  modoTexto: 'ajustar',
  imagenData: '',
  imagenAncho: 0,
  imagenAlto: 0
};

let elementos = null;
let idAnimacionScroll = null;
let scrollX = 128;
let ultimoTs = null;
const VELOCIDAD_SCROLL = 40; // px/segundo
const ANCHO_OLED = 128;

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
  } else {
    elementos.seccionTexto.style.display = 'none';
    elementos.seccionImagen.style.display = 'block';
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
          invertido: resultado.invertido,
          modoTexto: resultado.modoTexto,
          imagenData: resultado.imagenData || '',
          imagenAncho: resultado.imagenAncho || 0,
          imagenAlto: resultado.imagenAlto || 0
        };
      }

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
