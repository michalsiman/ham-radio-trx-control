import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFrequency, frequencyDigits, parseFrequency, sUnits, stepFrequency, stepLabel } from '../dist/ham-radio-trx-control.js';

test('frequency display in MHz to 100 Hz', () => {
  assert.equal(formatFrequency(14074500), '14.0745');
  assert.equal(formatFrequency(7078500), '7.0785');
  assert.equal(formatFrequency(144800000), '144.8000');
  assert.equal(formatFrequency(475000), '0.4750');
  assert.equal(formatFrequency(14074049), '14.0740');
});

test('each digit knows its step', () => {
  const d = frequencyDigits(14074500);
  assert.deepEqual(d.map((x) => x.ch).join(''), '14.0745');
  assert.deepEqual(d.map((x) => x.step), [10e6, 1e6, null, 1e5, 1e4, 1e3, 100]);
  assert.deepEqual(frequencyDigits(7078500).map((x) => x.step), [1e6, null, 1e5, 1e4, 1e3, 100]);
});

test('knob steps', () => {
  assert.equal(stepFrequency(14074000, 1000, 1), 14075000);
  assert.equal(stepFrequency(14074000, 1000, -3), 14071000);
  // Between steps the first click reaches the next step only.
  assert.equal(stepFrequency(14074500, 1000, 1), 14075000);
  assert.equal(stepFrequency(14074500, 1000, -1), 14074000);
  assert.equal(stepFrequency(14074500, 1000, 2), 14076000);
  assert.equal(stepFrequency(14074500, 100, 1), 14074600);
  assert.equal(stepFrequency(40000, 100000, -5), 30000);
});

test('step labels', () => {
  assert.equal(stepLabel(100), '100 Hz');
  assert.equal(stepLabel(1000), '1 kHz');
  assert.equal(stepLabel(10e6), '10 MHz');
});

test('frequency input in MHz, kHz or Hz', () => {
  assert.equal(parseFrequency('14.074'), 14074000);
  assert.equal(parseFrequency('7,0785'), 7078500);
  assert.equal(parseFrequency('14074'), 14074000);
  assert.equal(parseFrequency('14074000'), 14074000);
  assert.equal(parseFrequency('abc'), null);
});

test('S-units', () => {
  assert.equal(sUnits(0), 'S9');
  assert.equal(sUnits(-42), 'S2');
  assert.equal(sUnits(20), 'S9+20');
});

import { bandKey, bandTarget, modeKind } from '../dist/ham-radio-trx-control.js';

test('band buttons', () => {
  assert.equal(bandKey('80 m'), '80m');
  assert.equal(modeKind('PKTUSB'), 'data');
  assert.equal(modeKind('CW'), 'cw');
  assert.equal(modeKind('LSB'), 'voice');
  assert.equal(bandTarget('20m', 'PKTUSB', {}), 14078000);
  assert.equal(bandTarget('40m', 'LSB', {}), 7100000);
  assert.equal(bandTarget('20m', 'USB', { '20m': 14230000 }), 14230000);
  // A remembered frequency outside the band is ignored.
  assert.equal(bandTarget('20m', 'CW', { '20m': 7030000 }), 14050000);
});
