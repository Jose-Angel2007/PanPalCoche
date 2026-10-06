/*
 * horario.js — ¿Está abierta la gasolinera ahora?
 *
 * La API devuelve el horario como texto libre, por ejemplo:
 *   "L-D: 24H"
 *   "L-V: 06:30-22:30; S-D: 07:00-22:30"
 *   "L-D: 06:00-00:00"          (cierra a medianoche)
 *   "L-S: 06:00-21:30; D: 07:00-14:00"
 *
 * Técnica: NORMALIZAR el texto a una estructura fácil de consultar.
 * Convertimos el horario en 7 listas (lunes..domingo) de intervalos
 * [inicio, fin) en minutos desde las 00:00. Una vez normalizado,
 * "¿abierta ahora?" es solo buscar si el minuto actual cae en algún intervalo.
 *
 * El caso delicado es un tramo que CRUZA LA MEDIANOCHE (p. ej. 22:00-06:00):
 * lo partimos en dos, [22:00, 24:00) ese día y [00:00, 06:00) el día siguiente.
 * "06:00-00:00" cae en el mismo caso (fin <= inicio) y queda [06:00, 24:00).
 */

// Índice 0 = lunes, como en el texto de la API (no como Date.getDay, donde 0 = domingo).
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MIN_DIA = 24 * 60;

/** "L-V" -> [0,1,2,3,4]; "D" -> [6]; "L,X" -> [0,2]. Devuelve null si no entiende el texto. */
function parsearDias(texto) {
  const dias = [];
  for (const parte of texto.split(',')) {
    const [a, b] = parte.trim().split('-').map((s) => DIAS.indexOf(s.trim()));
    if (a === -1 || b === -1 || a === undefined) return null;
    if (b === undefined) {
      dias.push(a);
    } else {
      // Rango, que podría dar la vuelta a la semana (p. ej. "S-L"): usamos módulo 7.
      for (let d = a; ; d = (d + 1) % 7) {
        dias.push(d);
        if (d === b) break;
      }
    }
  }
  return dias;
}

/** "06:30" -> 390 minutos */
function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convierte el texto del horario en un array de 7 posiciones (lunes..domingo),
 * cada una con una lista de intervalos {ini, fin} en minutos.
 * Devuelve null si el formato no se reconoce: preferimos decir "no sé"
 * antes que afirmar que está abierta o cerrada sin motivo.
 */
function parsearHorario(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const semana = DIAS.map(() => []);

  for (const bloque of texto.split(';')) {
    const sep = bloque.indexOf(':');
    if (sep === -1) return null;
    const dias = parsearDias(bloque.slice(0, sep));
    const horas = bloque.slice(sep + 1).trim();
    if (!dias || !horas) return null;

    if (/^24\s*H$/i.test(horas)) {
      for (const d of dias) semana[d].push({ ini: 0, fin: MIN_DIA });
      continue;
    }

    const tramos = [...horas.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)];
    if (tramos.length === 0) return null;

    for (const [, iniTxt, finTxt] of tramos) {
      const ini = aMinutos(iniTxt);
      let fin = aMinutos(finTxt);
      if (fin === MIN_DIA - 1) fin = MIN_DIA; // "23:59" significa "hasta el final del día"

      for (const d of dias) {
        if (fin > ini) {
          semana[d].push({ ini, fin });
        } else {
          // Cruza la medianoche: se parte en dos intervalos.
          semana[d].push({ ini, fin: MIN_DIA });
          if (fin > 0) semana[(d + 1) % 7].push({ ini: 0, fin });
        }
      }
    }
  }
  return semana;
}

/**
 * true = abierta, false = cerrada, null = no sabemos interpretar el horario.
 * `fecha` es la hora del dispositivo (vale porque la app se usa en el propio pueblo).
 */
function estaAbierta(textoHorario, fecha = new Date()) {
  const semana = parsearHorario(textoHorario);
  if (!semana) return null;
  const dia = (fecha.getDay() + 6) % 7; // convierte domingo=0 a lunes=0
  const minuto = fecha.getHours() * 60 + fecha.getMinutes();
  return semana[dia].some(({ ini, fin }) => ini <= minuto && minuto < fin);
}

// Permite usar el fichero desde Node (tests) sin afectar al navegador.
if (typeof module !== 'undefined') {
  module.exports = { parsearHorario, estaAbierta };
}
