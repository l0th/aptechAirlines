import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const stateSource = fs.readFileSync(new URL('../src/app/core/booking-state.service.ts', import.meta.url), 'utf8');
const passengerSource = fs.readFileSync(new URL('../src/app/pages/passengers.component.ts', import.meta.url), 'utf8');

function loadPassengerProfileUtil() {
  const utilUrl = new URL('../src/app/core/passenger-profile.util.ts', import.meta.url);
  const source = fs.readFileSync(utilUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

test('booking draft is restored from and persisted to sessionStorage', () => {
  assert.match(stateSource, /sessionStorage\.getItem/);
  assert.match(stateSource, /sessionStorage\.setItem/);
  assert.match(stateSource, /passengers\(\)/);
});

test('passenger edits are copied into the persisted draft before leaving the page', () => {
  assert.match(passengerSource, /\(ngModelChange\)="draftChanged\(\)"/);
  assert.match(passengerSource, /draftChanged\(\)/);
});

test('Vietnamese CCCD extracts only the encoded birth year', () => {
  const { vietnameseCitizenIdBirthYear } = loadPassengerProfileUtil();

  assert.equal(vietnameseCitizenIdBirthYear('079095000123'), 1995);
  assert.equal(vietnameseCitizenIdBirthYear('079205000123'), 2005);
  assert.equal(vietnameseCitizenIdBirthYear('B1234567'), null);
  assert.equal(vietnameseCitizenIdBirthYear('07909500012'), null);
});

test('passenger age category is calculated on the departure date', () => {
  const { passengerTypeForBirthDate } = loadPassengerProfileUtil();
  const departureDate = '2026-10-10';

  assert.equal(passengerTypeForBirthDate('2024-10-11', departureDate), 'INFANT');
  assert.equal(passengerTypeForBirthDate('2024-10-10', departureDate), 'CHILD');
  assert.equal(passengerTypeForBirthDate('2014-10-11', departureDate), 'CHILD');
  assert.equal(passengerTypeForBirthDate('2014-10-10', departureDate), 'ADULT');
  assert.equal(passengerTypeForBirthDate('1966-10-11', departureDate), 'ADULT');
  assert.equal(passengerTypeForBirthDate('1966-10-10', departureDate), 'SENIOR');
});

test('passenger page validates every date of birth against the selected category', () => {
  assert.match(passengerSource, /passengerTypeForBirthDate/);
  assert.match(passengerSource, /departureDate/);
});

test('CCCD birth-year helper is not rendered below passenger fields', () => {
  assert.doesNotMatch(passengerSource, /CCCD cho biết năm sinh/);
});
