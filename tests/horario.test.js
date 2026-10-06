// Ejecutar con:  node --test
// Usa los formatos REALES que devuelve la API para las gasolineras de Alcalá.
const test = require('node:test');
const assert = require('node:assert/strict');
const { estaAbierta, parsearHorario } = require('../js/horario.js');

// Fechas de referencia (hora local). 5-oct-2026 es lunes.
const lunes = (h, m = 0) => new Date(2026, 9, 5, h, m);
const sabado = (h, m = 0) => new Date(2026, 9, 10, h, m);
const domingo = (h, m = 0) => new Date(2026, 9, 11, h, m);

test('24 horas todos los días', () => {
  assert.equal(estaAbierta('L-D: 24H', lunes(3)), true);
  assert.equal(estaAbierta('L-D: 24H', domingo(23, 59)), true);
});

test('horario simple, bordes [inicio, fin)', () => {
  const h = 'L-D: 06:00-23:00';
  assert.equal(estaAbierta(h, lunes(5, 59)), false);
  assert.equal(estaAbierta(h, lunes(6, 0)), true);
  assert.equal(estaAbierta(h, lunes(22, 59)), true);
  assert.equal(estaAbierta(h, lunes(23, 0)), false);
});

test('varios bloques por días', () => {
  const h = 'L-S: 06:00-21:30; D: 07:00-14:00';
  assert.equal(estaAbierta(h, sabado(21)), true);
  assert.equal(estaAbierta(h, domingo(21)), false);
  assert.equal(estaAbierta(h, domingo(13, 30)), true);
});

test('cierre a medianoche "06:00-00:00"', () => {
  const h = 'L-D: 06:00-00:00';
  assert.equal(estaAbierta(h, lunes(23, 30)), true);
  assert.equal(estaAbierta(h, lunes(0, 30)), false);
});

test('"00:00-23:59" cuenta como todo el día', () => {
  assert.equal(estaAbierta('L-D: 00:00-23:59', lunes(23, 59)), true);
});

test('tramo que cruza la medianoche pasa al día siguiente', () => {
  const h = 'S: 22:00-06:00';
  assert.equal(estaAbierta(h, sabado(23)), true);
  assert.equal(estaAbierta(h, domingo(5)), true); // madrugada del domingo
  assert.equal(estaAbierta(h, domingo(7)), false);
  assert.equal(estaAbierta(h, sabado(3)), false); // la madrugada del sábado es del viernes
});

test('solo un día ("L: 24H") y cerrada el resto', () => {
  assert.equal(estaAbierta('L: 24H', lunes(12)), true);
  assert.equal(estaAbierta('L: 24H', domingo(12)), false);
});

test('rango de días sin domingo', () => {
  assert.equal(estaAbierta('L-S: 09:30-22:00', domingo(12)), false);
  assert.equal(estaAbierta('L-S: 09:30-22:00', sabado(12)), true);
});

test('formato desconocido devuelve null (no inventamos)', () => {
  assert.equal(estaAbierta('', lunes(12)), null);
  assert.equal(estaAbierta('Consultar en estación', lunes(12)), null);
  assert.equal(parsearHorario('Z-Q: 06:00-22:00'), null);
});
