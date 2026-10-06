// Ejecutar con:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { aNumero, aFecha, normalizarEstacion } = require('../js/api.js');

test('aNumero convierte coma decimal y vacíos', () => {
  assert.equal(aNumero('1,849'), 1.849);
  assert.equal(aNumero('-5,853056'), -5.853056);
  assert.equal(aNumero(''), null);
  assert.equal(aNumero('  '), null);
  assert.equal(aNumero(undefined), null);
  assert.equal(aNumero('abc'), null);
});

test('aFecha interpreta el formato de la API', () => {
  const f = aFecha('06/10/2026 14:47:02');
  assert.equal(f.getFullYear(), 2026);
  assert.equal(f.getMonth(), 9);
  assert.equal(f.getDate(), 6);
  assert.equal(f.getHours(), 14);
  assert.equal(aFecha('basura'), null);
});

test('normalizarEstacion limpia claves y omite combustibles sin precio', () => {
  // Estructura copiada de una respuesta real (precios inventados).
  const cruda = {
    IDEESS: '1234',
    'Rótulo': 'ZACATÍN ',
    'Dirección': 'CARRETERA C-432 KM. 156',
    Horario: 'L-D: 06:00-23:00',
    Latitud: '37,326556',
    'Longitud (WGS84)': '-5,853056',
    'Precio Gasolina 95 E5': '1,849',
    'Precio Gasoleo A': '1,999',
    'Precio Hidrogeno': '',
  };
  const e = normalizarEstacion(cruda);
  assert.equal(e.rotulo, 'ZACATÍN');
  assert.equal(e.lat, 37.326556);
  assert.equal(e.lon, -5.853056);
  assert.deepEqual(e.precios, { 'Gasolina 95 E5': 1.849, 'Gasoleo A': 1.999 });
});
