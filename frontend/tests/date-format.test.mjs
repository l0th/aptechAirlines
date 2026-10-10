import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function loadDateUtil() {
  const source = fs.readFileSync(new URL('../src/app/core/date-format.util.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

test('calendar dates always display as dd/MM/yyyy', () => {
  const { formatCalendarDate, formatDayFirstDatesInText, localCalendarDate, normalizeCalendarDate, parseDayFirstCalendarDate } = loadDateUtil();
  assert.equal(formatCalendarDate('2026-10-11'), '11/10/2026');
  assert.equal(formatCalendarDate('1995-01-09'), '09/01/1995');
  assert.equal(formatCalendarDate(''), '—');
  assert.equal(normalizeCalendarDate('2026-10-11T15:30:00Z'), '2026-10-11');
  assert.equal(parseDayFirstCalendarDate('11/10/2026'), '2026-10-11');
  assert.equal(parseDayFirstCalendarDate('31/02/2026'), '');
  assert.equal(parseDayFirstCalendarDate('09/10/2026', '2026-10-10'), '');
  assert.equal(localCalendarDate(new Date(2026, 9, 10, 1, 30)), '2026-10-10');
  assert.equal(formatDayFirstDatesInText('Valid from 2026-10-10; expected YYYY-MM-DD.'), 'Valid from 10/10/2026; expected dd/mm/yyyy.');
});

test('date-times stay day-first for local and timezone-aware values', () => {
  const { formatDateTimeDayFirst } = loadDateUtil();
  assert.equal(formatDateTimeDayFirst('2026-10-11T15:30:00'), '11/10/2026 15:30');
  assert.match(formatDateTimeDayFirst('2026-10-11T08:30:00Z'), /^11\/10\/2026/);
});

test('all feature screens avoid browser-locale native date fields and month-first copy', () => {
  const appRoot = fileURLToPath(new URL('../src/app/', import.meta.url));
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.ts')) files.push(fullPath);
    }
  };
  walk(appRoot);

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const dateInputs = source.match(/<input\b[^>]*type="date"[^>]*>/g) || [];
    if (!file.endsWith('day-first-date-input.component.ts')) {
      assert.equal(dateInputs.length, 0, `${file} still delegates date order to the browser locale`);
    }
    assert.doesNotMatch(source, /mm\/dd\/yyyy/i, `${file} still contains month-first copy`);
  }
});

test('known user-facing date paths never expose canonical API dates', () => {
  const listPage = fs.readFileSync(new URL('../src/app/admin/list-pages.component.ts', import.meta.url), 'utf8');
  const passengers = fs.readFileSync(new URL('../src/app/pages/passengers.component.ts', import.meta.url), 'utf8');
  const desk = fs.readFileSync(new URL('../src/app/admin/reservation-desk.component.ts', import.meta.url), 'utf8');

  assert.match(listPage, /depUtc:formatDateTimeDayFirst/);
  assert.match(listPage, /formatCalendarDate\(this\.flightMinDate/);
  assert.doesNotMatch(passengers, /định dạng YYYY-MM-DD|use YYYY-MM-DD format/);
  assert.doesNotMatch(desk, /today\s*=\s*new Date\(\)\.toISOString\(\)/);
});
