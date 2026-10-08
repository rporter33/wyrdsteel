// The content packs, gathered for the loader. Game data is JSON so it can be validated, diffed
// and hashed (the hash is stamped into replays and saves).
import type { RawPacks } from '../core/data/load';
import actions from './actions.json';
import weapons from './weapons.json';
import projectiles from './projectiles.json';
import abilities from './abilities.json';
import classes from './classes.json';
import trees from './trees.json';
import enemies from './enemies.json';
import elites from './elites.json';
import affixes from './affixes.json';
import bases from './bases.json';
import runes from './runes.json';
import charms from './charms.json';
import ruiners from './ruiners.json';
import blueprints from './blueprints.json';
import drops from './drops.json';
import rooms from './rooms.json';
import zones from './zones.json';
import story from './story.json';
import wyrd from './wyrd.json';
import uniques from './uniques.json';
import codex from './codex.json';
import bosses from './bosses.json';

export const CONTENT_VERSION = 1;

export const packs: RawPacks = {
  version: CONTENT_VERSION,
  actions,
  weapons,
  projectiles,
  abilities,
  classes,
  trees,
  enemies,
  elites,
  affixes,
  bases,
  runes,
  charms,
  ruiners,
  blueprints,
  drops,
  rooms,
  zones,
  story,
  wyrd,
  uniques,
  codex,
  bosses,
};
