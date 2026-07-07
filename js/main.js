/**
 * Main Application
 * Orquesta los módulos de renderizado, UI y Firebase
 */

import { dibujarOLED } from './renderer.js';
import { cargarEstado, enviarEstado } from './firebase.js';
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
  texto: 'Hola Mundo',
  tamano: 2,
  alineacion: 'centro',
  invertido: false,
  modoTexto: 'ajustar'
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
  if (estadoActual.modoTexto === 'scroll') {
    iniciarScroll();
  } else {
    detenerScroll();
    dibujarOLED(elementos.canvas, estadoActual);
  }
}

// ===================================================
// Event Listeners de Controles
// ===================================================
function configurarEventos() {
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
          texto: resultado.texto,
          tamano: resultado.tamano,
          alineacion: resultado.alineacion,
          invertido: resultado.invertido,
          modoTexto: resultado.modoTexto
        };
      }

      poblarControles(estadoActual, elementos);
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
