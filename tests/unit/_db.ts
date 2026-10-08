import { loadContent } from '../../src/core/data/load';
import { packs } from '../../src/data';
import type { ContentDb } from '../../src/core/data/types';

let cached: ContentDb | null = null;
export function db(): ContentDb {
  return (cached ??= loadContent(packs));
}
