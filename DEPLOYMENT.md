# Sikka Go Deployment

This copy is standalone. The backend is an Express service for Render, and the main frontend in `artifacts/sikka` is a Vite app prepared for Capacitor.

## Backend on Render

1. Create a PostgreSQL database, then copy its external connection string.
2. Create a Render Web Service from this repo.
3. Render can read `render.yaml`, or you can enter these commands manually:
   - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build`
   - Start: `pnpm --filter @workspace/api-server run start`
   - Health check: `/api/healthz`
4. Add the environment variables from `.env.backend.example` in Render.
5. After deploy, your API base URL will look like `https://sikka-go-api.onrender.com`.

## Frontend Web Build

```sh
pnpm install
cd artifacts/sikka
cp .env.example .env
pnpm run build
```

Set `VITE_API_URL` to the Render backend origin. In browser development, `/api` is still proxied to `VITE_API_PROXY_TARGET` or `http://localhost:8080`.

## Capacitor App

From `artifacts/sikka`:

```sh
pnpm install
pnpm exec cap add android
pnpm exec cap add ios
pnpm run cap:sync
pnpm run cap:open:android
```

For iOS use `pnpm run cap:open:ios` on macOS with Xcode installed.

Before every mobile build, make sure `artifacts/sikka/.env` contains:

```env
VITE_API_URL=https://your-render-service.onrender.com
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
VITE_MAPBOX_TOKEN=your_mapbox_token
```

## Local Development

Backend:

```sh
pnpm run dev:backend
```

Frontend:

```sh
pnpm run dev:frontend
```

Use `PORT=8080` for the backend if you want the default Vite proxy to work unchanged.
