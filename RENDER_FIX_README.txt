Sikka Render deploy fix

What it fixes:
- Render crashed on startup because dist/index.mjs looked for:
  artifacts/api-server/data/egyptTransitSeed.json
- The real file was only in:
  artifacts/api-server/src/data/egyptTransitSeed.json
- build.mjs now copies src/data to data every time the backend builds.

How to apply:
1) Put this zip in the Sikka project root.
2) Run:
   unzip -o Sikka-render-deploy-fix.zip -d . && bash apply-render-fix.sh
3) Commit and push:
   git add artifacts/api-server/build.mjs artifacts/api-server/src/data apply-render-fix.sh RENDER_FIX_README.txt
   git commit -m "Fix Render backend seed data runtime path"
   git push

Render commands:
- Build command:
  pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build
- Start command:
  pnpm --filter @workspace/api-server run start

Important:
- The Neon "data transfer quota exceeded" message is separate. This code fix cannot increase Neon quota.
- If your Render dashboard build command runs `pnpm --filter @workspace/db run push`, remove that from the deploy build command and only run schema pushes manually when needed.
