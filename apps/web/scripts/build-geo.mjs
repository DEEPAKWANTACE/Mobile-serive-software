// Builds the State → District → City/Taluka → Gaon lists in public/data/geo from the Government of India
// Local Government Directory (LGD). Data: Government Open Data License – India; source lgdirectory.gov.in,
// daily Parquet dumps at https://github.com/ramSeraph/opendata/releases/tag/lgd-parquet-latest
//
// To refresh: download the latest districts, subdistricts and villages files as districts.parquet,
// subdistricts.parquet and villages.parquet into one folder, then (without saving the packages):
//   npm i --no-save hyparquet hyparquet-compressors
//   node apps/web/scripts/build-geo.mjs <download-folder> apps/web/public/data/geo
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: build-geo.mjs <download-folder> <output-folder>');

const read = async (name) => parquetReadObjects({ file: await asyncBufferFromFile(join(input, `${name}.parquet`)), compressors });
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const byName = (a, b) => a.localeCompare(b, 'en');
const unique = (values) => [...new Set(values.filter(Boolean))].sort(byName);

const [districts, subdistricts, villages] = [await read('districts'), await read('subdistricts'), await read('villages')];

// District codes become file names, so they must be plain numbers.
const codeOf = (value) => {
  const code = String(value);
  if (!/^\d{1,6}$/.test(code)) throw new Error(`Unexpected district code: ${code}`);
  return code;
};

const states = new Map();
for (const d of districts) {
  const state = clean(d.state_name);
  const list = states.get(state) ?? [];
  const code = codeOf(d.district_code);
  list.push({ code, name: clean(d.district_name), talukas: unique(subdistricts.filter((s) => String(s.district_code) === code).map((s) => clean(s.subdistrict_name))) });
  states.set(state, list);
}
const index = [...states].sort((a, b) => byName(a[0], b[0])).map(([name, list]) => ({ name, districts: list.sort((a, b) => byName(a.name, b.name)) }));

const perDistrict = new Map();
for (const v of villages) {
  const code = codeOf(v.district_code);
  const talukas = perDistrict.get(code) ?? new Map();
  const taluka = clean(v.subdistrict_name);
  const names = talukas.get(taluka) ?? [];
  names.push(clean(v.village_name));
  talukas.set(taluka, names);
  perDistrict.set(code, talukas);
}

rmSync(join(output, 'villages'), { recursive: true, force: true });
mkdirSync(join(output, 'villages'), { recursive: true });
writeFileSync(join(output, 'index.json'), JSON.stringify(index));
let count = 0;
for (const [code, talukas] of perDistrict) {
  const data = Object.fromEntries([...talukas].sort((a, b) => byName(a[0], b[0])).map(([taluka, names]) => [taluka, unique(names)]));
  count += Object.values(data).reduce((n, names) => n + names.length, 0);
  writeFileSync(join(output, 'villages', `${code}.json`), JSON.stringify(data));
}
console.log(`${index.length} states, ${districts.length} districts, ${subdistricts.length} talukas, ${count} villages in ${perDistrict.size} district files`);
