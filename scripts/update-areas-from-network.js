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

function loadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

async function main() {
  const { apply, keepRemoved } = parseArgs(process.argv);
  const projectRoot = path.resolve(__dirname, '..');

  const metaPath = path.join(projectRoot, 'data', 'area_metadata.json');
  const migunPath = path.join(projectRoot, 'data-src', 'area_to_migun_time.json');
  const districtPath = path.join(projectRoot, 'data-src', 'area_to_district.json');

  const current = loadJson(metaPath, { areas: {} });
  const migunMap = loadJson(migunPath, {});
  const districtMap = loadJson(districtPath, {});

  const res = await fetch(CITIES_MIX_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.oref.org.il/',
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch areas. status=${res.status}`);

  const payload = await res.json();
  const remoteAreas = toSortedUniqueAreas(payload);
  const localAreas = Object.keys(current?.areas || {});

  const remoteSet = new Set(remoteAreas);
  const localSet = new Set(localAreas);

  const added = remoteAreas.filter((a) => !localSet.has(a));
  const removed = localAreas.filter((a) => !remoteSet.has(a)).sort((a, b) => a.localeCompare(b, 'he'));

  let fromExisting = 0;
  let fromSources = 0;
  let unresolved = 0;

  const mergedAreas = {};
  for (const area of remoteAreas) {
    const existing = current.areas?.[area];
    if (existing && (existing.m !== null || existing.d !== null)) {
      mergedAreas[area] = { m: existing.m ?? null, d: existing.d ?? null };
      fromExisting += 1;
      continue;
    }

    const m = Number.isFinite(Number(migunMap?.[area])) ? Number(migunMap[area]) : null;
    const d = typeof districtMap?.[area] === 'string' ? districtMap[area] : null;

    if (m !== null || d !== null) fromSources += 1;
    else unresolved += 1;

    mergedAreas[area] = { m, d };
  }

  if (keepRemoved) {
    for (const area of removed) {
      if (!Object.prototype.hasOwnProperty.call(mergedAreas, area)) {
        const existing = current.areas?.[area] || {};
        mergedAreas[area] = { m: existing.m ?? null, d: existing.d ?? null };
      }
    }
  }

  const normalized = buildNormalizedMap(mergedAreas);

  console.log(`Remote areas:   ${remoteAreas.length}`);
  console.log(`Current areas:  ${localAreas.length}`);
  console.log(`Added:          ${added.length}`);
  console.log(`Removed:        ${removed.length}`);
  console.log(`Meta existing:  ${fromExisting}`);
  console.log(`Meta src json:  ${fromSources}`);
  console.log(`Meta unresolved:${unresolved}`);

  if (added.length) console.log(`Added list: ${added.join(' | ')}`);
  if (removed.length) console.log(`Removed list: ${removed.join(' | ')}`);

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to update data/area_metadata.json');
    return;
  }

  const updated = {
    generatedAt: new Date().toISOString(),
    areas: mergedAreas,
    normalized,
  };

  fs.writeFileSync(metaPath, JSON.stringify(updated));
  console.log(`Updated ${metaPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
