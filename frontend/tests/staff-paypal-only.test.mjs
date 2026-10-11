import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const reservationDesk = readFileSync(new URL('../src/app/admin/reservation-desk.component.ts', import.meta.url), 'utf8');
const adminLists = readFileSync(new URL('../src/app/admin/list-pages.component.ts', import.meta.url), 'utf8');

test('staff booking screens contain no saved-card fields or fake card confirmation calls', () => {
  for (const source of [reservationDesk, adminLists]) {
    assert.equal(/PROFILE_CARD|preferred_credit_card|has_preferred_credit_card/.test(source), false, 'Saved-card path must not appear in staff UI');
    assert.equal(/\bapi\.confirm\s*\(/.test(source), false, 'Staff must not directly confirm without PayPal capture');
  }
});

test('staff checkout creates a 30-minute payment hold without reusing the customer 14-day rule', () => {
  assert.equal(/if\s*\(!this\.canBlock\)\s*\{/.test(reservationDesk), false, 'Staff-assisted holds must not use the customer 14-day rule');
  assert.equal(/\[disabled\]="busy\s*\|\|\s*quoting\s*\|\|\s*!canBlock"/.test(reservationDesk), false, 'A near-term flight must not disable the staff hold button');
  assert.equal(/30\s*phút/i.test(reservationDesk), true, 'The staff UI must explain the 30-minute payment window');
  assert.equal(/email/i.test(reservationDesk), true, 'The staff UI must explain that the payment link is emailed to the customer');
  assert.equal(/is_block:\s*true/.test(reservationDesk), true, 'Staff creation must be hold-only');
  assert.equal(/mode:\s*'block'\s*\|\s*'buy'/.test(reservationDesk), false, 'Staff must not offer immediate purchase');
});
