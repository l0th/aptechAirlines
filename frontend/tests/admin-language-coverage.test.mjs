import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const cases = [
  ['admin-shell.component.ts', ['Overview', 'Language selector', 'Customer site', 'Dashboard & reports']],
  ['dashboard.component.ts', ['Dashboard', 'Refresh', 'Net revenue', 'Passenger demographics']],
  ['email-center.component.ts', ['Email center', 'Templates', 'Send history', 'Automated jobs']],
  ['reservation-desk.component.ts', ['Ticket desk', 'Customer', 'Flights', 'Passengers & seats']],
  ['staff-management.component.ts', ['Staff management', 'All statuses', 'Reset password']],
  ['policies.component.ts', ['Refund policies', 'Create policy', 'Refund rate']],
];

for (const [file, englishCopy] of cases) {
  test(`${file} exposes its admin copy through the shared language helper`, async () => {
    const source = await readFile(new URL(`../src/app/admin/${file}`, import.meta.url), 'utf8');
    assert.match(source, /LanguageService/);
    assert.match(source, /\.pick\(|\bt\(/);
    for (const copy of englishCopy) assert.ok(source.includes(copy), `${file} is missing English copy: ${copy}`);
  });
}

