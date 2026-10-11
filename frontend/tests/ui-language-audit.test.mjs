import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../src/app/', import.meta.url));
const vietnamese = /[ÀÁÂÃĂẠẢẤẦẨẪẬẮẰẲẴẶÈÉÊẸẺẼỀẾỂỄỆÌÍĨỈỊÒÓÔÕƠỌỎỐỒỔỖỘỚỜỞỠỢÙÚŨƯỤỦỨỪỬỮỰỲÝỴỶỸĐàáâãăạảấầẩẫậắằẳẵặèéêẹẻẽềếểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳýỵỷỹđ]/;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(join(dir, entry.name))
    : entry.name.endsWith('.component.ts') ? [join(dir, entry.name)] : []));
  return nested.flat();
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function directVietnameseCopy(source, file) {
  const match = /template\s*:\s*`([\s\S]*?)`\s*,?\s*(?:styles|\})/.exec(source);
  if (!match) return [];
  const template = match[1];
  const offset = match.index + match[0].indexOf(template);
  const findings = [];
  const textPattern = />([^<>]+)</g;
  for (const item of template.matchAll(textPattern)) {
    const raw = item[1].replace(/<!--.*?-->/gs, '').replace(/\{\{[\s\S]*?\}\}/g, '').trim();
    if (!raw || !vietnamese.test(raw)) continue;
    findings.push(`${relative(appRoot, file)}:${lineOf(source, offset + item.index)} text: ${raw.replace(/\s+/g, ' ')}`);
  }
  const attrPattern = /(?<!\[)(placeholder|title|aria-label)="([^"]+)"/g;
  for (const item of template.matchAll(attrPattern)) {
    if (!vietnamese.test(item[2])) continue;
    findings.push(`${relative(appRoot, file)}:${lineOf(source, offset + item.index)} ${item[1]}: ${item[2]}`);
  }
  const expressionPattern = /\{\{([\s\S]*?)\}\}|\[[^\]]+\]="([^"]+)"/g;
  for (const item of template.matchAll(expressionPattern)) {
    const expression = item[1] || item[2] || '';
    if (!vietnamese.test(expression) || /(?:\.pick|\.translate|\bt|\bpick|\btext)\s*\(/.test(expression)) continue;
    findings.push(`${relative(appRoot, file)}:${lineOf(source, offset + item.index)} expression: ${expression.replace(/\s+/g, ' ').trim()}`);
  }
  return findings;
}

test('Angular templates do not contain untranslated static Vietnamese copy', async () => {
  const files = await walk(appRoot);
  const findings = [];
  for (const file of files) findings.push(...directVietnameseCopy(await readFile(file, 'utf8'), file));
  assert.deepEqual(findings, [], `Static Vietnamese copy must use LanguageService.pick(vi, en):\n${findings.join('\n')}`);
});

