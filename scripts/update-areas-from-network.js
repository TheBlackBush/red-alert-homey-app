#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CITIES_MIX_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetCitiesMix.aspx';
const FILTER_SUFFIX1 = ' - כל האזורים';
const FILTER_SUFFIX2 = ' כל - האזורים';
const DEPRECATION_SUFFIX = ' (אזור התרעה ישן)';

function normalizeAreaName(name) {
  return String(name || '')
    .trim()
    .replace(/[׳']/g, '')
    .replace(/["”״]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    apply: args.has('--apply'),
    keepRemoved: args.has('--keep-removed'),
  };
}

function toSortedUniqueAreas(payload) {
  if (!Array.isArray(payload)) return [];

  const set = new Set();
  for (const row of payload) {
    const label = String(row?.label || '').trim();
    if (!label) continue;
    if (label.endsWith(FILTER_SUFFIX1)) continue;
    if (label.endsWith(FILTER_SUFFIX2)) continue;
    if (label.endsWith(DEPRECATION_SUFFIX)) continue;
    set.add(label);
  }

  return [...set].sort((a, b) => a.localeCompare(b, 'he'));
}

function buildNormalizedMap(areasMap) {
  const out = {};
  for (const [area, meta] of Object.entries(areasMap)) {
    out[normalizeAreaName(area)] = { area, m: meta?.m ?? null, d: meta?.d ?? null };
  }
  return out;
}

async function main() {
  const { apply, keepRemoved } = parseArgs(process.argv);
  const projectRoot = path.resolve(__dirname, '..');
  const metaPath = path.join(projectRoot, 'data', 'area_metadata.json');

  const res = await fetch(CITIES_MIX_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.oref.org.il/',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch areas. status=${res.status}`);
  }

  const payload = await res.json();
  const remoteAreas = toSortedUniqueAreas(payload);

  const current = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const localAreas = Object.keys(current?.areas || {});

  const remoteSet = new Set(remoteAreas);
  const localSet = new Set(localAreas);

  const added = remoteAreas.filter((a) => !localSet.has(a));
  const removed = localAreas.filter((a) => !remoteSet.has(a)).sort((a, b) => a.localeCompare(b, 'he'));

  console.log(`Remote areas: ${remoteAreas.length}`);
  console.log(`Local areas:  ${localAreas.length}`);
  console.log(`Added:        ${added.length}`);
  console.log(`Removed:      ${removed.length}`);

  if (added.length) console.log(`Added list: ${added.join(' | ')}`);
  if (removed.length) console.log(`Removed list: ${removed.join(' | ')}`);

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to update data/area_metadata.json');
    return;
  }

  const mergedAreas = {};

  for (const area of remoteAreas) {
    if (current.areas && Object.prototype.hasOwnProperty.call(current.areas, area)) {
      mergedAreas[area] = {
        m: current.areas[area]?.m ?? null,
        d: current.areas[area]?.d ?? null,
      };
    } else {
      mergedAreas[area] = { m: null, d: null };
    }
  }

  if (keepRemoved) {
    for (const area of removed) {
      if (!Object.prototype.hasOwnProperty.call(mergedAreas, area)) {
        mergedAreas[area] = {
          m: current.areas?.[area]?.m ?? null,
          d: current.areas?.[area]?.d ?? null,
        };
      }
    }
  }

  const updated = {
    ...current,
    generatedAt: new Date().toISOString(),
    areas: mergedAreas,
    normalized: buildNormalizedMap(mergedAreas),
  };

  fs.writeFileSync(metaPath, JSON.stringify(updated));
  console.log(`Updated ${metaPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
