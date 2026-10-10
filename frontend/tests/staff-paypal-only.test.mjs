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

test('staff checkout only creates eligible holds, never a fake immediate purchase', () => {
  assert.equal(/if\s*\(!this\.canBlock\)\s*\{/.test(reservationDesk), true, 'Staff hold must check the 14-day rule');
  assert.equal(/is_block:\s*true/.test(reservationDesk), true, 'Staff creation must be hold-only');
  assert.equal(/mode:\s*'block'\s*\|\s*'buy'/.test(reservationDesk), false, 'Staff must not offer immediate purchase');
});
