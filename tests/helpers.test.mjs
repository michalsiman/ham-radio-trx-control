import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFrequency, parseFrequency, sUnits } from '../dist/ham-radio-trx-control.js';

test('frequency display', () => {
  assert.equal(formatFrequency(14074000), '14.074.000');
  assert.equal(formatFrequency(7078500), '7.078.500');
  assert.equal(formatFrequency(144800000), '144.800.000');
  assert.equal(formatFrequency(475000), '0.475.000');
});

test('frequency input in MHz, kHz or Hz', () => {
  assert.equal(parseFrequency('14.074'), 14074000);
  assert.equal(parseFrequency('7,0785'), 7078500);
  assert.equal(parseFrequency('14074'), 14074000);
  assert.equal(parseFrequency('14074000'), 14074000);
  assert.equal(parseFrequency('abc'), null);
  assert.equal(parseFrequency('-1'), null);
});

test('S-units', () => {
  assert.equal(sUnits(0), 'S9');
  assert.equal(sUnits(-6), 'S8');
  assert.equal(sUnits(-42), 'S2');
  assert.equal(sUnits(-80), 'S0');
  assert.equal(sUnits(20), 'S9+20');
});
