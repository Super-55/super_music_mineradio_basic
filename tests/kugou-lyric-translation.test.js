'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');

const KRC_XOR_KEY = Buffer.from([
  64, 71, 97, 119, 94, 50, 116, 71,
  81, 54, 49, 45, 206, 210, 110, 105,
]);

function encodeKrc(text) {
  const compressed = zlib.deflateSync(Buffer.from(text, 'utf8'));
  const encrypted = Buffer.alloc(compressed.length);
  for (let index = 0; index < compressed.length; index += 1) {
    encrypted[index] = compressed[index] ^ KRC_XOR_KEY[index % KRC_XOR_KEY.length];
  }
  return Buffer.concat([Buffer.from('krc1'), encrypted]).toString('base64');
}

test('KuGou KRC decoder extracts timed translated lyrics', () => {
  const translations = {
    version: 1,
    content: [
      {
        type: 1,
        language: 0,
        content: [['我们不再交谈'], ['像从前那样']],
      },
    ],
  };
  const encodedLanguage = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
  const krcText = [
    `[language:${encodedLanguage}]`,
    '[1000,1500]<0,500,0>We <500,500,0>don\'t <1000,500,0>talk',
    '[3000,1200]<0,600,0>Like <600,600,0>we used to',
  ].join('\n');

  const api = require('../kugou-api');
  assert.equal(typeof api._test.decodeKugouKrcContent, 'function');
  assert.equal(typeof api._test.extractKugouKrcTranslation, 'function');

  const decoded = api._test.decodeKugouKrcContent(encodeKrc(krcText));
  assert.equal(decoded, krcText);
  assert.equal(
    api._test.extractKugouKrcTranslation(decoded),
    '[00:01.00]我们不再交谈\n[00:03.00]像从前那样',
  );
});

test('KuGou KRC translation parser fails soft for malformed metadata', () => {
  const api = require('../kugou-api');
  assert.equal(
    api._test.extractKugouKrcTranslation('[language:not-base64]\n[0,500]<0,500,0>Hello'),
    '',
  );
});

test('KuGou KRC parser accepts the live lyricContent field', () => {
  const api = require('../kugou-api');
  const translations = {
    content: [{ type: 1, language: 0, lyricContent: [[' '], ['第二行译文']] }],
  };
  const encodedLanguage = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
  const decoded = [
    `[language:${encodedLanguage}]`,
    '[0,500]<0,500,0>Instrumental',
    '[1200,800]<0,800,0>Original line',
  ].join('\n');
  assert.equal(api._test.extractKugouKrcTranslation(decoded), '[00:01.20]第二行译文');
});
