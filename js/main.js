/**main
 * Main Application
 * Orquesta los módulos de renderizado, UI y Firebase
 */

import { dibujarOLED } from './renderer.js';
import {
  cargarEstado,
  enviarEstado,
  listarCanciones,
  suscribirLastSeen,
  listarImagenes,
  guardarImagenCatalogo,
  borrarImagenCatalogo
} from './firebase.js';
import { procesarImagen, procesarImagenDesdeDataURL, dibujarPreviewImagen } from './imageProcessor.js';
import {
  inicializarDibujo,
  establecerGrosor,
  deshacerTrazo,
  rehacerTrazo,
  limpiarLienzo,
  hayHistorial,
  hayRehistorial,
  obtenerResultadoImagen
} from './dibujo.js';
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

// V1.14: clave (nombre) de la imagen actualmente seleccionada en la
// Galería -- separado de estadoActual.imagenData porque necesitamos
// saber el NOMBRE para poder borrarla, no solo sus datos. Se limpia
// cuando se borra, se sube una nueva, o se cambia de tipo.
let galeriaSeleccionActual = null;

// dataURL (128×64, ya redimensionado, SIN binarizar) de la imagen que
// está actualmente activa -- puede venir de un archivo recién subido
// (sección Imagen o Galería) o de una imagen del catálogo que se
// guardó con esta info. Mientras exista, el umbral y el dithering se
// pueden reajustar libremente. Si es null (imagen de una versión
// vieja del catálogo, o el estado que trae Firebase al arrancar), los
// controles quedan inertes porque no hay nada que reprocesar.
let imagenFuenteActual = null;

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

  // V1.13: "Dibujo" también refleja en vivo la pantalla virtual
  // principal de arriba, igual que Texto/Imagen -- antes se apoyaba
  // solo en el propio lienzo (#lienzoDibujo) como preview. Se convierte
  // el trazo actual a bitmap y se dibuja arriba con el mismo pipeline
  // que una imagen, sin pisar estadoActual.tipo (sigue siendo "dibujo").
  if (estadoActual.tipo === 'dibujo') {
    detenerScroll();
    actualizarPreviewDesdeLienzo();
    return;
  }

  // Imagen: dibuja directo. Galería: mismo bitmap, pero estadoActual.tipo
  // se queda en "galeria" (no salta a "imagen") para que la sección
  // correcta se mantenga visible -- se fuerza tipo:"imagen" solo para
  // este dibujado puntual, igual que se hace al enviar (enviarAFirebase).
  if (estadoActual.tipo === 'imagen') {
    detenerScroll();
    dibujarOLED(elementos.canvas, estadoActual);
    return;
  }

  if (estadoActual.tipo === 'galeria') {
    detenerScroll();
    dibujarOLED(elementos.canvas, Object.assign({}, estadoActual, { tipo: 'imagen' }));
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

// V1.13: convierte el lienzo de dibujo a bitmap y lo pinta en la
// pantalla virtual principal (#oled), igual que hace enviarAFirebase()
// al mandar un dibujo -- pero acá es solo para el preview, no toca
// Firebase. Se throttlea a como mucho una vez por frame: los eventos
// pointermove pueden disparar muchas notificaciones seguidas mientras
// se arrastra, y no tiene sentido reconvertir el canvas más rápido de
// lo que la pantalla puede mostrar.
let previewDibujoPendiente = false;
function actualizarPreviewDesdeLienzo() {
  if (!elementos.lienzoDibujo || previewDibujoPendiente) return;
  previewDibujoPendiente = true;

  requestAnimationFrame(() => {
    previewDibujoPendiente = false;
    // Pudo cambiar de pestaña mientras se esperaba el frame.
    if (estadoActual.tipo !== 'dibujo') return;

    const resultado = obtenerResultadoImagen(elementos.lienzoDibujo);
    dibujarOLED(elementos.canvas, Object.assign({}, estadoActual, {
      tipo: 'imagen',
      imagenData: resultado.imagenData,
      imagenAncho: resultado.imagenAncho,
      imagenAlto: resultado.imagenAlto
    }));
  });
}

// ===================================================
// Gestión de Tipo de Contenido
// ===================================================
function mostrarSeccionSegunTipo(tipo) {
  marcarSegmentoActivo(elementos.grupoTipo, tipo);

  const secciones = {
    texto: elementos.seccionTexto,
    imagen: elementos.seccionImagen,
    cancion: elementos.seccionCancion,
    dibujo: elementos.seccionDibujo,
    galeria: elementos.seccionGaleria
  };

  Object.keys(secciones).forEach((clave) => {
    const el = secciones[clave];
    if (el) el.style.display = (clave === tipo) ? 'block' : 'none';
  });

  // "Añadir nueva" y "Guardar en la galería" viven en un contenedor
  // aparte (después del switch global Invertido), pero solo deben
  // verse cuando la sección Galería está activa -- se sincronizan acá.
  if (elementos.seccionGaleriaFinal) {
    elementos.seccionGaleriaFinal.style.display = (tipo === 'galeria') ? 'block' : 'none';
  }

  // "Invertido" no tiene ningún efecto visual mientras suena una
  // canción (la pantalla no cambia con la música), así que no
  // corresponde mostrarlo ahí -- para el resto de los tipos sí aplica.
  if (elementos.filaInvertido) {
    elementos.filaInvertido.style.display = (tipo === 'cancion') ? 'none' : 'flex';
  }
}

function cambiarTipo(nuevoTipo) {
  estadoActual.tipo = nuevoTipo;
  mostrarSeccionSegunTipo(nuevoTipo);

  // Al entrar a Galería, refrescar el catálogo por si se guardó algo
  // desde otra pestaña/dispositivo mientras tanto.
  if (nuevoTipo === 'galeria') {
    poblarCatalogoImagenes();
  }

  renderizar();
}

// ===================================================
// Gestión de Imágenes
// ===================================================

// El umbral y el dithering se pueden reajustar en vivo mientras exista
// una "fuente" editable (imagenFuenteActual): un dataURL 128×64 ya
// redimensionado pero SIN binarizar. Esa fuente puede venir de un
// archivo recién subido, o de una imagen del catálogo que se guardó
// CON esa copia (ver guardarImagenCatalogo). Si no hay fuente (subida
// vieja del catálogo sin "preprocesada"), los controles se desactivan
// porque no hay nada que reprocesar.
// El umbral y el dithering se pueden reajustar en vivo mientras exista
// una "fuente" editable (imagenFuenteActual): un dataURL 128×64 ya
// redimensionado pero SIN binarizar. Esa fuente puede venir de un
// archivo recién subido (Imagen o Galería), o de una imagen del
// catálogo que se guardó CON esa copia (ver guardarImagenCatalogo). Si
// no hay fuente (subida vieja del catálogo sin "preprocesada"), los
// dos pares de controles (Imagen y Galería) quedan deshabilitados
// porque no hay nada que reprocesar -- sin texto de aviso, la imagen
// sigue siendo perfectamente utilizable tal cual está guardada, solo
// que fija.
function actualizarControlesEdicionImagen() {
  const hayFuente = !!imagenFuenteActual;

  if (elementos.umbral) elementos.umbral.disabled = !hayFuente;
  if (elementos.dithering) elementos.dithering.disabled = !hayFuente;
  if (elementos.umbralGaleria) elementos.umbralGaleria.disabled = !hayFuente;
  if (elementos.ditheringGaleria) elementos.ditheringGaleria.disabled = !hayFuente;
}

// Aplica el resultado de procesarImagen/procesarImagenDesdeDataURL al
// estado y al preview, y guarda la copia editable para poder seguir
// reajustando umbral/dithering después.
function aplicarResultadoImagen(resultado) {
  estadoActual.imagenData = resultado.imagenData;
  estadoActual.imagenAncho = resultado.imagenAncho;
  estadoActual.imagenAlto = resultado.imagenAlto;

  if (resultado.preprocesada) {
    imagenFuenteActual = resultado.preprocesada;
  }

  renderizar();
  actualizarControlesEdicionImagen();
  marcarEstado(`Imagen procesada: ${resultado.imagenAncho}×${resultado.imagenAlto}px`, 'ok', elementos);
}

// Dispara al elegir un archivo nuevo del disco.
async function procesarYMostrarImagen() {
  const file = elementos.cargadorImagen.files[0];
  if (!file) return;

  try {
    marcarEstado('Procesando imagen…', null, elementos);

    const umbral = parseInt(elementos.umbral.value);
    const dithering = elementos.dithering.checked;
    const resultado = await procesarImagen(file, 128, 64, umbral, dithering);

    aplicarResultadoImagen(resultado);

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

// Dispara al mover cualquiera de los dos sliders de umbral, o
// tildar/destildar cualquiera de los dos switches de dithering (el
// par de la sección Imagen, o el de la sección Galería) -- se le pasa
// explícitamente de cuál par leer, para no mezclar los valores de una
// sección con el resultado de la otra.
async function reprocesarImagenFuenteActual(umbralEl, ditheringEl) {
  if (!imagenFuenteActual) return;

  try {
    marcarEstado('Procesando imagen…', null, elementos);

    const umbral = parseInt(umbralEl.value);
    const dithering = ditheringEl.checked;
    const resultado = await procesarImagenDesdeDataURL(imagenFuenteActual, 128, 64, umbral, dithering);

    aplicarResultadoImagen(resultado);
  } catch (error) {
    console.error('Error reprocesando imagen:', error);
    marcarEstado(`Error: ${error.message}`, 'error', elementos);
  }
}

// Guarda en el catálogo (/imagenes) la imagen que está actualmente
// procesada y visible en el preview. Acción explícita del usuario,
// separada de "subir imagen para el dispositivo": no todo lo que se
// sube queda guardado, solo lo que se decide agregar acá. Guarda
// también la copia editable (imagenFuenteActual) y los valores de
// umbral/dithering usados, para poder reajustarla más adelante.
async function manejarGuardarEnGaleria() {
  if (estadoActual.tipo !== 'imagen' || !estadoActual.imagenData) {
    setAvisoGaleria('Primero subí y procesá una imagen para poder guardarla.', 'error');
    return;
  }

  const nombre = (elementos.nombreGaleria && elementos.nombreGaleria.value.trim()) || '';
  if (!nombre) {
    setAvisoGaleria('Poné un nombre para guardar la imagen en la galería.', 'error');
    return;
  }

  setAvisoGaleria('Guardando…');
  const resultado = await guardarImagenCatalogo(
    nombre,
    estadoActual.imagenData,
    estadoActual.imagenAncho,
    estadoActual.imagenAlto,
    imagenFuenteActual,
    {
      origen: 'upload',
      umbral: parseInt(elementos.umbral.value),
      dithering: elementos.dithering.checked,
      fecha: Date.now()
    }
  );

  if (resultado.exito) {
    await poblarCatalogoImagenes();
    setAvisoGaleria(`Guardada en la galería como "${resultado.key}"`);
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
// V1.12: Dibujo -- guardar en el mismo catálogo de imágenes
// ===================================================
function setAvisoGaleriaDibujo(text, tipo = null) {
  if (!elementos.avisoGaleriaDibujo) return;
  elementos.avisoGaleriaDibujo.style.display = text ? 'block' : 'none';
  elementos.avisoGaleriaDibujo.textContent = text || '';
  if (tipo === 'error') elementos.avisoGaleriaDibujo.classList.add('error');
  else elementos.avisoGaleriaDibujo.classList.remove('error');
}

// Guarda el dibujo actual en el catálogo /imagenes -- el mismo que usa
// la sección Imagen. Convierte el lienzo a bitmap en el momento (no
// depende de que el usuario haya tocado "Enviar" antes).
async function manejarGuardarDibujoEnGaleria() {
  const nombre = (elementos.nombreGaleriaDibujo && elementos.nombreGaleriaDibujo.value.trim()) || '';
  if (!nombre) {
    setAvisoGaleriaDibujo('Poné un nombre para guardar el dibujo en la galería.', 'error');
    return;
  }

  setAvisoGaleriaDibujo('Guardando…');

  const resultado_imagen = obtenerResultadoImagen(elementos.lienzoDibujo);

  const resultado = await guardarImagenCatalogo(
    nombre,
    resultado_imagen.imagenData,
    resultado_imagen.imagenAncho,
    resultado_imagen.imagenAlto,
    resultado_imagen.preprocesada,
    { origen: 'dibujo', fecha: Date.now() }
  );

  if (resultado.exito) {
    await poblarCatalogoImagenes();
    setAvisoGaleriaDibujo(`Guardado en la galería como "${resultado.key}"`);
  } else {
    setAvisoGaleriaDibujo('No se pudo guardar: ' + (resultado.error || ''), 'error');
  }
}

// ===================================================
// V1.13: Galería -- sección propia con el catálogo completo.
// Seleccionar un item deja estadoActual.tipo="galeria" (no salta a
// "imagen"): la sección Galería se queda a la vista, con sus propios
// controles de umbral/dithering para reajustar la selección ahí mismo.
// ===================================================
async function poblarCatalogoImagenes() {
  try {
    imagenesCatalogo = await listarImagenes() || {};
    renderizarGaleria();
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
    actualizarBotonBorrarGaleria();
    return;
  }

  claves.forEach((key) => {
    const entry = imagenesCatalogo[key];
    if (!entry || !entry.datos) return;

    const item = document.createElement('div');
    item.className = 'item-galeria';
    if (estadoActual.tipo === 'galeria' && galeriaSeleccionActual === key) {
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

    item.addEventListener('click', () => {
      estadoActual.tipo = 'galeria';
      estadoActual.imagenData = entry.datos;
      estadoActual.imagenAncho = entry.ancho || 128;
      estadoActual.imagenAlto = entry.alto || 64;
      galeriaSeleccionActual = key;

      // Limpiar el input de "añadir nueva": si quedaba un archivo de una
      // subida anterior, no queremos que se confunda con la fuente que
      // se está por activar acá.
      if (elementos.cargadorImagenGaleria) elementos.cargadorImagenGaleria.value = '';

      if (entry.preprocesada) {
        // Esta imagen tiene copia editable: se puede seguir reajustando
        // el umbral y el dithering como si se acabara de subir. Restauramos
        // los controles de Galería a los valores con los que se guardó,
        // para que el preview y los sliders arranquen sincronizados.
        imagenFuenteActual = entry.preprocesada;
        if (entry.meta && typeof entry.meta.umbral === 'number') {
          elementos.umbralGaleria.value = entry.meta.umbral;
          elementos.valorUmbralGaleria.textContent = String(entry.meta.umbral);
        }
        if (entry.meta && typeof entry.meta.dithering === 'boolean') {
          elementos.ditheringGaleria.checked = entry.meta.dithering;
        }
      } else {
        // Guardada con una versión anterior de la galería: no hay fuente
        // editable, queda como bitmap fijo.
        imagenFuenteActual = null;
      }

      // Precargar el nombre: un simple click en "Guardar en la galería"
      // sobrescribe esta misma entrada con los cambios; para guardar
      // aparte alcanza con cambiar el nombre antes de guardar.
      if (elementos.nombreGaleriaNueva) elementos.nombreGaleriaNueva.value = key;

      renderizarGaleria(); // re-dibuja el grid para mover el resaltado "activo"
      renderizar();
      actualizarControlesEdicionImagen();
      marcarEstado(`Imagen "${key}" cargada desde la galería`, 'ok', elementos);
    });

    item.appendChild(canvas);
    item.appendChild(nombre);
    grid.appendChild(item);
  });

  actualizarBotonBorrarGaleria();
}

// V1.14: habilita el ícono de basura de la cabecera solo si hay una
// imagen seleccionada Y esa imagen todavía existe en el catálogo en
// memoria (por si se borró desde otra pestaña/dispositivo mientras
// tanto).
function actualizarBotonBorrarGaleria() {
  if (!elementos.botonBorrarGaleria) return;
  const haySeleccion = !!galeriaSeleccionActual && !!imagenesCatalogo[galeriaSeleccionActual];
  elementos.botonBorrarGaleria.disabled = !haySeleccion;
}

// Borra la imagen actualmente seleccionada en la Galería (ver
// galeriaSeleccionActual, se fija al tocar una miniatura).
async function manejarBorrarGaleriaSeleccionada() {
  if (!galeriaSeleccionActual) return;

  const key = galeriaSeleccionActual;
  const resultado = await borrarImagenCatalogo(key);

  if (resultado.exito) {
    galeriaSeleccionActual = null;
    await poblarCatalogoImagenes();
    marcarEstado(`Imagen "${key}" borrada de la galería.`, 'ok', elementos);
  } else {
    marcarEstado('No se pudo borrar la imagen: ' + (resultado.error || ''), 'error', elementos);
  }
}

// Procesa un archivo nuevo subido desde la sección Galería (usa el par
// umbral/dithering propio de esta sección) y lo deja listo en el
// preview para ponerle nombre y guardarlo.
async function procesarYMostrarImagenGaleria() {
  const file = elementos.cargadorImagenGaleria.files[0];
  if (!file) return;

  try {
    marcarEstado('Procesando imagen…', null, elementos);

    const umbral = parseInt(elementos.umbralGaleria.value);
    const dithering = elementos.ditheringGaleria.checked;
    const resultado = await procesarImagen(file, 128, 64, umbral, dithering);

    estadoActual.tipo = 'galeria';
    aplicarResultadoImagen(resultado);
    renderizarGaleria(); // por si había una entrada seleccionada, sacarle el resaltado

    if (elementos.nombreGaleriaNueva && !elementos.nombreGaleriaNueva.value) {
      elementos.nombreGaleriaNueva.value = file.name.replace(/\.[^.]+$/, '');
    }
  } catch (error) {
    console.error('Error procesando imagen:', error);
    marcarEstado(`Error: ${error.message}`, 'error', elementos);
  }
}

function setAvisoGaleriaNueva(text, tipo = null) {
  if (!elementos.avisoGaleriaNueva) return;
  elementos.avisoGaleriaNueva.style.display = text ? 'block' : 'none';
  elementos.avisoGaleriaNueva.textContent = text || '';
  if (tipo === 'error') elementos.avisoGaleriaNueva.classList.add('error');
  else elementos.avisoGaleriaNueva.classList.remove('error');
}

// Guarda en el catálogo lo que esté actualmente activo en la sección
// Galería -- ya sea una imagen recién subida con "Añadir una imagen
// nueva", o una imagen del catálogo que se acaba de reajustar. Si el
// nombre coincide con una entrada existente, la reemplaza (mismo
// comportamiento que guardarImagenCatalogo en firebase.js: la clave es
// el nombre).
async function manejarGuardarNuevaEnGaleria() {
  if (estadoActual.tipo !== 'galeria' || !estadoActual.imagenData) {
    setAvisoGaleriaNueva('Primero subí una imagen nueva o seleccioná una de la galería.', 'error');
    return;
  }

  const nombre = (elementos.nombreGaleriaNueva && elementos.nombreGaleriaNueva.value.trim()) || '';
  if (!nombre) {
    setAvisoGaleriaNueva('Poné un nombre para guardar la imagen en la galería.', 'error');
    return;
  }

  setAvisoGaleriaNueva('Guardando…');
  const resultado = await guardarImagenCatalogo(
    nombre,
    estadoActual.imagenData,
    estadoActual.imagenAncho,
    estadoActual.imagenAlto,
    imagenFuenteActual,
    {
      origen: 'upload',
      umbral: parseInt(elementos.umbralGaleria.value),
      dithering: elementos.ditheringGaleria.checked,
      fecha: Date.now()
    }
  );

  if (resultado.exito) {
    await poblarCatalogoImagenes();
    setAvisoGaleriaNueva(`Guardada en la galería como "${resultado.key}"`);
  } else {
    setAvisoGaleriaNueva('No se pudo guardar: ' + (resultado.error || ''), 'error');
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
    setAvisoCancion('No se encontró la canción en la galería.', 'error');
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

// V1.15: la carga de canciones nuevas se privatizó -- ya no vive en este
// panel público. El dueño del dispositivo la sube por otra vía (fuera
// de esta página), así un visitante con el link no puede subir música
// nueva, solo elegir entre las que ya están cargadas.

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

  // Umbral de binarización (sección Imagen)
  elementos.umbral.addEventListener('input', (e) => {
    elementos.valorUmbral.textContent = e.target.value;
    reprocesarImagenFuenteActual(elementos.umbral, elementos.dithering);
  });

  // Dithering (Floyd-Steinberg) vs umbral simple (sección Imagen)
  elementos.dithering.addEventListener('change', () => {
    reprocesarImagenFuenteActual(elementos.umbral, elementos.dithering);
  });

  // Guardar la imagen actualmente procesada en el catálogo
  if (elementos.botonGuardarGaleria) {
    elementos.botonGuardarGaleria.addEventListener('click', manejarGuardarEnGaleria);
  }

  // V1.13: sección Galería -- añadir imagen nueva, reajustar la
  // seleccionada (mismo par umbral/dithering, pero el de esta sección).
  if (elementos.cargadorImagenGaleria) {
    elementos.cargadorImagenGaleria.addEventListener('change', () => procesarYMostrarImagenGaleria());
  }
  if (elementos.umbralGaleria) {
    elementos.umbralGaleria.addEventListener('input', (e) => {
      elementos.valorUmbralGaleria.textContent = e.target.value;
      reprocesarImagenFuenteActual(elementos.umbralGaleria, elementos.ditheringGaleria);
    });
  }
  if (elementos.ditheringGaleria) {
    elementos.ditheringGaleria.addEventListener('change', () => {
      reprocesarImagenFuenteActual(elementos.umbralGaleria, elementos.ditheringGaleria);
    });
  }
  if (elementos.botonGuardarGaleriaNueva) {
    elementos.botonGuardarGaleriaNueva.addEventListener('click', manejarGuardarNuevaEnGaleria);
  }
  if (elementos.botonBorrarGaleria) {
    elementos.botonBorrarGaleria.addEventListener('click', manejarBorrarGaleriaSeleccionada);
  }

  // V1.12: Dibujo -- grosor, deshacer, limpiar, guardar en catálogo
  if (elementos.grupoGrosor) {
    elementos.grupoGrosor.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const px = Number(btn.dataset.valor);
      establecerGrosor(px);
      marcarSegmentoActivo(elementos.grupoGrosor, btn.dataset.valor);
    });
  }
  if (elementos.botonDeshacerDibujo) {
    elementos.botonDeshacerDibujo.addEventListener('click', () => {
      if (!deshacerTrazo()) {
        marcarEstado('No hay nada más para deshacer.', null, elementos);
      } else {
        actualizarPreviewDesdeLienzo();
      }
    });
  }
  if (elementos.botonRehacerDibujo) {
    elementos.botonRehacerDibujo.addEventListener('click', () => {
      if (!rehacerTrazo()) {
        marcarEstado('No hay nada más para rehacer.', null, elementos);
      } else {
        actualizarPreviewDesdeLienzo();
      }
    });
  }
  if (elementos.botonLimpiarDibujo) {
    elementos.botonLimpiarDibujo.addEventListener('click', () => {
      limpiarLienzo(elementos.lienzoDibujo);
      actualizarPreviewDesdeLienzo();
    });
  }
  if (elementos.botonGuardarGaleriaDibujo) {
    elementos.botonGuardarGaleriaDibujo.addEventListener('click', manejarGuardarDibujoEnGaleria);
  }

  // Enviar
  elementos.botonEnviar.addEventListener('click', enviarAFirebase);

  // Canción: selección
  if (elementos.seleccionCancion) {
    elementos.seleccionCancion.addEventListener('change', manejarSeleccionCancion);
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
      actualizarControlesEdicionImagen();
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
    // V1.12: Dibujo -- se convierte el lienzo a bitmap recién acá, en
    // el momento de enviar (siempre el dibujo más reciente, no una
    // versión vieja cacheada). Importante: se arma un payload TEMPORAL
    // con tipo forzado a "imagen" -- NO se pisa estadoActual.tipo, así
    // el usuario se queda en la pestaña Dibujo después de enviar, en
    // vez de que la UI salte sola a la pestaña Imagen. Para Firebase y
    // el ESP8266 esto es indistinguible de una imagen subida normal.
    if (estadoActual.tipo === 'dibujo') {
      const resultado_imagen = obtenerResultadoImagen(elementos.lienzoDibujo);
      const payloadDibujo = Object.assign({}, estadoActual, {
        tipo: 'imagen',
        imagenData: resultado_imagen.imagenData,
        imagenAncho: resultado_imagen.imagenAncho,
        imagenAlto: resultado_imagen.imagenAlto
      });

      const resultado = await enviarEstado(payloadDibujo);

      if (resultado.exito) {
        marcarEstado(
          `Enviado ✅ · v${resultado.version}. La OLED la toma en el próximo chequeo.`,
          'ok',
          elementos
        );
      } else {
        marcarEstado('Error al enviar. Revisar conexión.', 'error', elementos);
      }
      return;
    }

    // V1.13: Galería -- misma idea que Dibujo: payload TEMPORAL con
    // tipo forzado a "imagen", sin pisar estadoActual.tipo, así el
    // usuario se queda en la pestaña Galería después de enviar. La
    // imagen ya está procesada (estadoActual.imagenData), no hace
    // falta reconvertir nada acá.
    if (estadoActual.tipo === 'galeria') {
      const payloadGaleria = Object.assign({}, estadoActual, { tipo: 'imagen' });
      const resultado = await enviarEstado(payloadGaleria);

      if (resultado.exito) {
        marcarEstado(
          `Enviado ✅ · v${resultado.version}. La OLED la toma en el próximo chequeo.`,
          'ok',
          elementos
        );
      } else {
        marcarEstado('Error al enviar. Revisar conexión.', 'error', elementos);
      }
      return;
    }

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
  actualizarControlesEdicionImagen();
  marcarConexion('conectando…', null, elementos);

  if (elementos.lienzoDibujo) {
    inicializarDibujo(elementos.lienzoDibujo, actualizarPreviewDesdeLienzo);
  }

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
