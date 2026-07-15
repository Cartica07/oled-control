/**firebase
 * Firebase Integration
 * Maneja la carga y almacenamiento de configuración en Firebase Realtime Database
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyACebxW1oTWpBWfinBUJwmynxHxQmtRMDo",
  authDomain: "lorenita-6ad1e.firebaseapp.com",
  databaseURL: "https://lorenita-6ad1e-default-rtdb.firebaseio.com",
  projectId: "lorenita-6ad1e",
  storageBucket: "lorenita-6ad1e.firebasestorage.app",
  messagingSenderId: "426829616333",
  appId: "1:426829616333:web:f1f5ce42ebf0e0aea04584"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

/**
 * Carga el estado actual desde Firebase
 * Retorna un objeto con la configuración actual o null si hay error
 */
export async function cargarEstado() {
  try {
    const snap = await get(ref(db, 'oled_remota'));

    if (snap.exists()) {
      const datos = snap.val();
      const pantalla = datos.pantalla || {};
      const config = pantalla.config || {};
      const imagen = pantalla.imagen || {};
      const cancion = pantalla.cancion || {};

      return {
        tipo: pantalla.tipo || 'texto',
        texto: (typeof pantalla.texto === 'string') ? pantalla.texto : 'Hola Mundo',
        tamano: Number(config.tamano) || 2,
        alineacion: config.alineacion || 'centro',
        alineacionV: config.alineacionV || 'centro',
        invertido: !!config.invertido,
        modoTexto: config.modoTexto || 'ajustar',
        imagenData: imagen.datos || '',
        imagenAncho: Number(imagen.ancho) || 0,
        imagenAlto: Number(imagen.alto) || 0,
        cancionNombre: (typeof cancion.nombre === 'string') ? cancion.nombre : '',
        cancionRepeticiones: Number(cancion.repeticiones) || 1,
        // NOTA: no traemos las notas completas aquí porque pueden ser grandes;
        // la web gestionará un catálogo independiente (oled_remota/canciones).
        version: Number(datos.version) || 0,
        exito: true
      };
    } else {
      // No hay datos aún, retornar estado por defecto
      return {
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
        cancionNombre: '',
        cancionRepeticiones: 1,
        version: 0,
        exito: true,
        vacio: true
      };
    }
  } catch (err) {
    console.error('Error al cargar estado de Firebase:', err);
    return {
      exito: false,
      error: err.message
    };
  }
}

/**
 * Lista las canciones disponibles en el catálogo (oled_remota/canciones)
 * Retorna un objeto { nombre: { notas: [...], meta: {...} }, ... }
 */
export async function listarCanciones() {
  try {
    const snap = await get(ref(db, 'oled_remota/canciones'));
    if (!snap.exists()) return {};
    return snap.val();
  } catch (err) {
    console.error('Error al listar canciones:', err);
    return {};
  }
}

/**
 * Guarda una canción en el catálogo (oled_remota/canciones/<nombre>)
 * notas: array de arrays [freq, durMs]
 */
export async function guardarCancionCatalogo(nombre, notas, meta = {}) {
  try {
    const safeKey = String(nombre).replace(/\./g, '_').replace(/\$/g, '_');
    await set(ref(db, `oled_remota/canciones/${safeKey}`), {
      notas: notas,
      meta: meta
    });
    return { exito: true };
  } catch (err) {
    console.error('Error al guardar canción en catálogo:', err);
    return { exito: false, error: err.message };
  }
}

/**
 * Envía la configuración actualizada a Firebase
 */
export async function enviarEstado(estado) {
  try {
    const snapVersion = await get(ref(db, 'oled_remota/version'));
    const nuevaVersion = (snapVersion.exists() ? Number(snapVersion.val()) : 0) + 1;

    const pantallaPayload = {};

    if (estado.tipo === 'imagen') {
      pantallaPayload.tipo = 'imagen';
      pantallaPayload.imagen = {
        ancho: estado.imagenAncho,
        alto: estado.imagenAlto,
        datos: estado.imagenData
      };
    } else if (estado.tipo === 'cancion') {
      pantallaPayload.tipo = 'cancion';
      pantallaPayload.cancion = {
        nombre: estado.cancion || '',
        repeticiones: Number(estado.cancionRepeticiones || 1),
        notas: estado.cancionNotas || []
      };
    } else {
      // Texto por defecto
      pantallaPayload.tipo = 'texto';
      pantallaPayload.texto = estado.texto;
      pantallaPayload.config = {
        tamano: estado.tamano,
        alineacion: estado.alineacion,
        alineacionV: estado.alineacionV,
        invertido: estado.invertido,
        modoTexto: estado.modoTexto
      };

      pantallaPayload.imagen = {
        ancho: estado.imagenAncho,
        alto: estado.imagenAlto,
        datos: estado.imagenData
      };
    }

    await set(ref(db, 'oled_remota'), Object.assign({ version: nuevaVersion }, { pantalla: pantallaPayload }));

    return {
      exito: true,
      version: nuevaVersion
    };
  } catch (err) {
    console.error('Error al enviar estado a Firebase:', err);
    return {
      exito: false,
      error: err.message
    };
  }
}
