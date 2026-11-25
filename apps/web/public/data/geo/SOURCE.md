# State, district, taluka and village lists

Government of India **Local Government Directory (LGD)** data, Ministry of Panchayati Raj (https://lgdirectory.gov.in),
published under the Government Open Data License – India (GODL-India).

- Downloaded from the daily dumps at https://github.com/ramSeraph/opendata/releases/tag/lgd-parquet-latest
- Snapshot date: 25 November 2026
- `index.json`: states → districts → talukas. `villages/<district code>.json`: taluka → village names.
- Rebuild with `apps/web/scripts/build-geo.mjs` (instructions at the top of that file).
