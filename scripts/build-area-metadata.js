#!/usr/bin/env node
'use strict';

const fs = require('fs');

function decodePyString(raw) {
  const q = raw[0];
  let s = raw.slice(1, -1);
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
  if (q === '"') s = s.replace(/\\"/g, '"');
  if (q === "'") s = s.replace(/\\'/g, "'");
  s = s.replace(/\\\\/g, '\\');
  return s;
}

function parsePyDict(content) {
  const out = new Map();
  const lines = content.split(/\r?\n/);
  const rx = /^\s*(["'])(.*)\1\s*:\s*(.+?)\s*,?\s*$/;
  for (const line of lines) {
    const m = line.match(rx);
    if (!m) continue;
    const quote = m[1];
    const keyBody = m[2];
    const valueRaw = m[3].trim();
    const key = decodePyString(quote + keyBody + quote);

    let value;
    if (/^\d+$/.test(valueRaw)) {
      value = Number(valueRaw);
    } else if ((valueRaw.startsWith('"') && valueRaw.endsWith('"')) || (valueRaw.startsWith("'") && valueRaw.endsWith("'"))) {
      value = decodePyString(valueRaw);
    } else {
      continue;
    }

    out.set(key, value);
  }
  return out;
}

function normalizeAreaName(name) {
  return String(name || '')
    .trim()
    .replace(/[׳']/g, '')
    .replace(/["”״]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function main() {
  const migunPyPath = process.argv[2] || '/tmp/area_to_migun_time.py';
  const districtPyPath = process.argv[3] || '/tmp/area_to_district.py';
  const outPath = process.argv[4] || 'data/area_metadata.json';

  const migunMap = parsePyDict(fs.readFileSync(migunPyPath, 'utf8'));
  const districtMap = parsePyDict(fs.readFileSync(districtPyPath, 'utf8'));

  const merged = {};
  for (const [area, migun] of migunMap.entries()) {
    const district = districtMap.get(area);
    merged[area] = { m: migun, d: typeof district === 'string' ? district : null };
  }

  const normalized = {};
  for (const [area, meta] of Object.entries(merged)) {
    normalized[normalizeAreaName(area)] = { area, m: meta.m, d: meta.d };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    areas: merged,
    normalized,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload));

  const missingDistrict = Object.values(merged).filter((x) => !x.d).length;
  console.log(`Wrote ${outPath}`);
  console.log(`areas=${Object.keys(merged).length} normalized=${Object.keys(normalized).length} missingDistrict=${missingDistrict}`);
}

main();
