import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relativeDateToDays } from '../src/utils/relativeDate.js';
import { parseLocaleNumber, parseRating, stripLabel } from '../src/utils/text.js';
import { whatsappLink } from '../src/proposal/whatsappMessage.js';
import { isMapsUrl } from '../src/scraper/mapsScraper.js';
import { isSocialOrDirectory } from '../src/scraper/websiteAnalyzer.js';

test('parseLocaleNumber entiende formatos locales', () => {
  assert.equal(parseLocaleNumber('(1.234)'), 1234);
  assert.equal(parseLocaleNumber('1,234 reviews'), 1234);
  assert.equal(parseLocaleNumber('23 reseñas'), 23);
  assert.equal(parseLocaleNumber('1,2 mil reseñas'), 1200);
  assert.equal(parseLocaleNumber('2K'), 2000);
  assert.equal(parseLocaleNumber(''), undefined);
});

test('parseRating', () => {
  assert.equal(parseRating('4,6'), 4.6);
  assert.equal(parseRating('4.1 estrellas'), 4.1);
  assert.equal(parseRating('5 estrellas'), 5);
  assert.equal(parseRating('nada'), undefined);
});

test('relativeDateToDays en español e inglés', () => {
  assert.equal(relativeDateToDays('hace 3 días'), 3);
  assert.equal(relativeDateToDays('Hace una semana'), 7);
  assert.equal(relativeDateToDays('hace 2 meses'), 60);
  assert.equal(relativeDateToDays('hace un año'), 365);
  assert.equal(relativeDateToDays('Editado hace 5 horas'), 0);
  assert.equal(relativeDateToDays('a month ago'), 30);
  assert.equal(relativeDateToDays('2 weeks ago'), 14);
  assert.equal(relativeDateToDays('ayer'), 1);
});

test('stripLabel quita prefijos de aria-label', () => {
  assert.equal(stripLabel('Dirección: Calle Mayor 12'), 'Calle Mayor 12');
  assert.equal(stripLabel('Teléfono: 911 22 23 33'), '911 22 23 33');
});

test('isMapsUrl', () => {
  assert.ok(isMapsUrl('https://www.google.com/maps/place/Algo/@40,-3,17z'));
  assert.ok(isMapsUrl('https://maps.app.goo.gl/abc123'));
  assert.ok(isMapsUrl('https://www.google.com.ar/maps/place/X'));
  assert.ok(!isMapsUrl('https://example.com/maps'));
  assert.ok(!isMapsUrl('https://www.google.com/search?q=x'));
  assert.ok(!isMapsUrl('no es url'));
});

test('isSocialOrDirectory', () => {
  assert.ok(isSocialOrDirectory('https://www.instagram.com/negocio'));
  assert.ok(isSocialOrDirectory('https://m.facebook.com/negocio'));
  assert.ok(!isSocialOrDirectory('https://www.inbox.com'));
  assert.ok(!isSocialOrDirectory('https://peluquerialola.es'));
});

test('whatsappLink solo usa el teléfono con prefijo internacional', () => {
  assert.match(whatsappLink('+34 911 22 23 33', 'hola'), /^https:\/\/wa\.me\/34911222333\?text=hola$/);
  assert.match(whatsappLink('911 22 23 33', 'hola'), /^https:\/\/wa\.me\/\?text=hola$/);
});
