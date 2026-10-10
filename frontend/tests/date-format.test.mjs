import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
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
  const { formatCalendarDate, normalizeCalendarDate, parseDayFirstCalendarDate } = loadDateUtil();
  assert.equal(formatCalendarDate('2026-10-11'), '11/10/2026');
  assert.equal(formatCalendarDate('1995-01-09'), '09/01/1995');
  assert.equal(formatCalendarDate(''), '—');
  assert.equal(normalizeCalendarDate('2026-10-11T15:30:00Z'), '2026-10-11');
  assert.equal(parseDayFirstCalendarDate('11/10/2026'), '2026-10-11');
  assert.equal(parseDayFirstCalendarDate('31/02/2026'), '');
  assert.equal(parseDayFirstCalendarDate('09/10/2026', '2026-10-10'), '');
});

test('date-times stay day-first for local and timezone-aware values', () => {
  const { formatDateTimeDayFirst } = loadDateUtil();
  assert.equal(formatDateTimeDayFirst('2026-10-11T15:30:00'), '11/10/2026 15:30');
  assert.match(formatDateTimeDayFirst('2026-10-11T08:30:00Z'), /^11\/10\/2026/);
});

test('feature screens never use browser-locale native date fields', () => {
  const files = [
    '../src/app/admin/commercial.component.ts',
    '../src/app/admin/reservation-desk.component.ts',
    '../src/app/admin/list-pages.component.ts',
    '../src/app/pages/reschedule.component.ts',
    '../src/app/pages/home.component.ts',
    '../src/app/pages/passengers.component.ts',
    '../src/app/pages/lookup.component.ts',
    '../src/app/pages/profile.component.ts',
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const dateInputs = source.match(/<input\b[^>]*type="date"[^>]*>/g) || [];
    assert.equal(dateInputs.length, 0, `${file} still delegates date order to the browser locale`);
    assert.match(source, /<app-date-input\b/, `${file} should use the shared day-first date input`);
  }
});
