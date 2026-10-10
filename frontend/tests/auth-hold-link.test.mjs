import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';

const dir = await mkdtemp(join(process.cwd(), 'node_modules', '.hold-link-test-'));
after(() => rm(dir, { recursive: true, force: true }));
const outfile = join(dir, 'auth.mjs');
await build({
  stdin: {
    contents: "export { authGuard, safeReturnPath } from './src/app/core/guards.ts'; export { AuthService } from './src/app/core/auth.service.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'auth-hold-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
});

const { authGuard, safeReturnPath, AuthService } = await import(pathToFileURL(outfile).href);

test('hold payment deep-link retains BLK code through login redirect', () => {
  const redirects = [];
  const mockRouter = { createUrlTree: (path, options) => { redirects.push({ path, options }); return 'login-redirect'; } };
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: { authenticated: () => false } },
    { provide: Router, useValue: mockRouter },
  ] });
  const destination = '/track?code=BLK-2RU37W';
  const guarded = runInInjectionContext(injector, () => authGuard({}, { url: destination }));
  assert.equal(guarded, 'login-redirect');
  assert.deepEqual(redirects, [{ path: ['/auth'], options: { queryParams: { next: destination } } }]);
  assert.equal(safeReturnPath(destination), destination);
});

test('post-login return path only accepts internal paths', () => {
  assert.equal(safeReturnPath('/trips'), '/trips');
  assert.equal(safeReturnPath('/track?code=BLK-2RU37W'), '/track?code=BLK-2RU37W');
  for (const malicious of ['//example.org', '/\\\\example.org', 'https://example.org', 'javascript:alert(1)', '/safe\\evil']) {
    assert.equal(safeReturnPath(malicious), '/');
  }
});
