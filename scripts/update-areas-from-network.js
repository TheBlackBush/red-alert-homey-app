#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DISTRICTS_HE_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=he';
const DISTRICTS_EN_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=en';
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

function shouldFilterLabel(label) {
  const s = String(label || '').trim();
  return !s || s.endsWith(FILTER_SUFFIX1) || s.endsWith(FILTER_SUFFIX2) || s.endsWith(DEPRECATION_SUFFIX);
}

function fetchJson(url) {
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.oref.org.il/',
    },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`GET ${url} failed status=${res.status}`);
    return res.json();
  });
}

function buildCombinedCities(heRows, enRows) {
  const enById = new Map();
  for (const row of enRows || []) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    if (shouldFilterLabel(row?.label) || shouldFilterLabel(row?.label_he)) continue;
    if (!enById.has(id)) enById.set(id, row);
  }

  const citiesById = new Map();
  for (const row of heRows || []) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    if (shouldFilterLabel(row?.label) || shouldFilterLabel(row?.label_he)) continue;

    const enRow = enById.get(id);
    const heName = String(row?.label_he || row?.label || '').trim();
    const enName = String(enRow?.label || '').trim();

    if (!heName) continue;

    citiesById.set(id, {
      id,
      he: heName,
      en: enName || heName,
      areaHe: String(row?.areaname || '').trim(),
      areaEn: String(enRow?.areaname || '').trim(),
      areaId: Number(row?.areaid),
      countdown: Number.isFinite(Number(row?.migun_time)) ? Number(row.migun_time) : null,
      value: String(row?.value || ''),
    });
  }

  return citiesById;
}

function toCitiesJsonPayload(citiesById) {
  const cities = {};
  for (const city of [...citiesById.values()].sort((a, b) => a.he.localeCompare(b.he, 'he'))) {
    // Keep compatibility with app.js dictionary loader.
    cities[city.he] = {
      id: city.id,
      he: city.he,
      en: city.en,
      area: city.areaId,
      countdown: city.countdown,
    };
  }

  return {
    cities,
    areas: {},
    countdown: {},
    '@VERSION': 'network-sync-v2',
    '@BUILD_DATE': new Date().toISOString(),
  };
}

function buildAreaMetadata(citiesById, keepRemoved, previousAreas = {}) {
  const areas = {};

  for (const city of citiesById.values()) {
    const key = city.he;
    if (!key) continue;
    areas[key] = {
      m: Number.isFinite(city.countdown) ? city.countdown : null,
      d: city.areaHe || null,
      en: city.en || null,
      d_en: city.areaEn || null,
      cityId: city.id,
    };
  }

  if (keepRemoved) {
    for (const [area, meta] of Object.entries(previousAreas || {})) {
      if (!Object.prototype.hasOwnProperty.call(areas, area)) {
        areas[area] = meta;
      }
    }
  }

  const normalized = {};
  for (const [area, meta] of Object.entries(areas)) {
    normalized[normalizeAreaName(area)] = {
      area,
      m: meta?.m ?? null,
      d: meta?.d ?? null,
      en: meta?.en ?? null,
      d_en: meta?.d_en ?? null,
      cityId: meta?.cityId ?? null,
    };
  }

  return { areas, normalized };
}

async function main() {
  const { apply, keepRemoved } = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..');

  const metadataPath = path.join(root, 'data', 'area_metadata.json');
  const citiesPath = path.join(root, 'data', 'cities.json');
  const previousMetadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : { areas: {} };

  const [heRows, enRows] = await Promise.all([fetchJson(DISTRICTS_HE_URL), fetchJson(DISTRICTS_EN_URL)]);
  const citiesById = buildCombinedCities(heRows, enRows);

  const nextAreasHe = [...new Set([...citiesById.values()].map((x) => x.he).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const nextAreasEn = [...new Set([...citiesById.values()].map((x) => x.en).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));

  const prevAreaKeys = Object.keys(previousMetadata.areas || {});
  const nextAreaSet = new Set(nextAreasHe);
  const prevAreaSet = new Set(prevAreaKeys);
  const added = nextAreasHe.filter((x) => !prevAreaSet.has(x));
  const removed = prevAreaKeys.filter((x) => !nextAreaSet.has(x)).sort((a, b) => a.localeCompare(b, 'he'));

  console.log(`Cities from network: ${citiesById.size}`);
  console.log(`Areas (HE):          ${nextAreasHe.length}`);
  console.log(`Added areas:         ${added.length}`);
  console.log(`Removed areas:       ${removed.length}`);

  if (added.length) console.log(`Added list: ${added.join(' | ')}`);
  if (removed.length) console.log(`Removed list: ${removed.join(' | ')}`);

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write updated files.');
    return;
  }

  const citiesPayload = toCitiesJsonPayload(citiesById);
  const { areas, normalized } = buildAreaMetadata(citiesById, keepRemoved, previousMetadata.areas || {});

  fs.writeFileSync(citiesPath, JSON.stringify(citiesPayload));
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      areas,
      normalized,
    }),
  );

  console.log('Updated:');
  console.log(`- ${citiesPath}`);
  console.log(`- ${metadataPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
