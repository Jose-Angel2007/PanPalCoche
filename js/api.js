/*
 * api.js — Pedir los datos al Ministerio y dejarlos en un formato cómodo.
 *
 * API oficial (pública, sin clave, CORS abierto):
 *   https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/
 * Se actualiza cada media hora según su propio campo "Nota".
 *
 * La respuesta viene "en crudo": los números son texto con coma decimal ("1,849"),
 * un combustible que no se vende viene como "" y algunas claves tienen espacios
 * o tildes ("Longitud (WGS84)", "Rótulo"). Aquí hacemos una capa ANTICORRUPCIÓN:
 * el resto de la app nunca ve ese formato, solo objetos limpios.
 */

const API_BASE =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';

// Nombres más legibles para los combustibles. Si aparece uno que no está aquí,
// se muestra con el nombre que da la API (la app no se rompe por un combustible nuevo).
const NOMBRES_COMBUSTIBLE = {
  'Gasolina 95 E5': 'Gasolina 95',
  'Gasolina 95 E10': 'Gasolina 95 E10',
  'Gasolina 95 E5 Premium': 'Gasolina 95 Premium',
  'Gasolina 98 E5': 'Gasolina 98',
  'Gasolina 98 E10': 'Gasolina 98 E10',
  'Gasoleo A': 'Diésel',
  'Gasoleo Premium': 'Diésel Premium',
  'Gasoleo B': 'Gasóleo B (agrícola)',
  'Diésel Renovable': 'Diésel renovable',
  'Gases licuados del petróleo': 'GLP (autogás)',
  'Gas Natural Comprimido': 'GNC',
  'Gas Natural Licuado': 'GNL',
  'Adblue': 'AdBlue',
};

/** "1,849" -> 1.849 ; "" -> null */
function aNumero(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (texto === '') return null;
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "06/10/2026 14:47:02" -> Date (hora local) */
function aFecha(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(texto || '');
  if (!m) return null;
  const [, d, mes, a, h, min, s] = m.map(Number);
  return new Date(a, mes - 1, d, h, min, s);
}

/** Una estación cruda de la API -> objeto limpio. */
function normalizarEstacion(cruda) {
  const precios = {};
  for (const [clave, valor] of Object.entries(cruda)) {
    if (!clave.startsWith('Precio ')) continue;
    const precio = aNumero(valor);
    if (precio !== null && precio > 0) precios[clave.slice('Precio '.length)] = precio;
  }
  return {
    id: cruda.IDEESS,
    rotulo: (cruda['Rótulo'] || 'Sin nombre').trim(),
    direccion: (cruda['Dirección'] || '').trim(),
    horario: (cruda.Horario || '').trim(),
    lat: aNumero(cruda.Latitud),
    lon: aNumero(cruda['Longitud (WGS84)']),
    precios,
  };
}

/**
 * Descarga las estaciones de un municipio.
 * Devuelve { fecha: Date|null, estaciones: [...] } o lanza un Error.
 */
async function obtenerEstaciones(idMunicipio, { timeoutMs = 20000 } = {}) {
  // Si el servidor no responde, cortamos nosotros en vez de dejar la app colgada.
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), timeoutMs);
  try {
    const resp = await fetch(
      `${API_BASE}/EstacionesTerrestres/FiltroMunicipio/${encodeURIComponent(idMunicipio)}`,
      { headers: { Accept: 'application/json' }, signal: control.signal }
    );
    if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`);
    const datos = await resp.json();
    if (datos.ResultadoConsulta !== 'OK') {
      throw new Error(`La API respondió: ${datos.ResultadoConsulta}`);
    }
    return {
      fecha: aFecha(datos.Fecha),
      estaciones: (datos.ListaEESSPrecio || []).map(normalizarEstacion),
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('El servidor del Ministerio tarda demasiado');
    throw err;
  } finally {
    clearTimeout(temporizador);
  }
}

function nombreCombustible(clave) {
  return NOMBRES_COMBUSTIBLE[clave] || clave;
}

if (typeof module !== 'undefined') {
  module.exports = { aNumero, aFecha, normalizarEstacion, obtenerEstaciones, nombreCombustible };
}
