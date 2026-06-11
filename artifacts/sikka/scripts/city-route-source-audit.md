# City Route Source Audit

Checked before the APK build on 2026-06-11.

## Imported

- Greater Cairo: existing uploaded Sikka/Replit snapshot.
- Alexandria: official Alexandria Passenger Transport Authority bus table.
- Alexandria tram: separate tram transport type, seeded from official Alexandria tram route-map source and tagged as AI-assisted geometry.
- Cairo Monorail: East/West monorail station corridors updated and tagged as AI-assisted geometry.

## Checked But Not Imported

No parseable official in-city bus route table was found during this pass for:

- Sohag
- Assiut
- Minya
- Qena
- Luxor
- Aswan
- Beni Suef
- Fayoum
- Port Said
- Ismailia
- Suez
- Dakahlia
- Gharbia
- Sharqia
- Beheira
- Damietta
- Kafr El Sheikh
- Menofia
- Qalyubia
- Red Sea
- South Sinai
- North Sinai
- Matrouh
- New Valley

## Rule Used

Only in-city/public local transit routes should be imported. Intercity coaches, travel buses, private long-distance lines, and unsourced AI-only routes are intentionally excluded. AI is used only to correct/densify geometry after a route source provides the actual route identity and stops/corridor.
