import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');

export function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  // Git does not track empty folders, so a layer with no files yet may not exist in a checkout.
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out.sort();
}

export function rel(p: string): string {
  return relative(ROOT, p).replaceAll('\\', '/');
}

export function read(p: string): string {
  return readFileSync(p, 'utf8');
}

/** Strip // and /* *\/ comments so prose about Math.sin doesn't trip the scanner. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Static import specifiers, including `import type` and re-exports. */
export function importsOf(src: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  const re = /(?:import|export)\s+(type\s+)?(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ spec: m[2]!, typeOnly: !!m[1] });
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(src))) out.push({ spec: m[1]!, typeOnly: false });
  return out;
}

export function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return rel(resolve(dirname(fromFile), spec));
}
