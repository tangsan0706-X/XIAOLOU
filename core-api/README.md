# core-api

Zero-dependency demo backend for the project. It runs on Node.js built-in HTTP modules, keeps the current API surface available for local development and UI integration, and persists the demo state in SQLite.

## What it provides

- REST-style demo endpoints for projects, scripts, assets, storyboards, videos, dubbings, tasks, wallet, enterprise applications, and toolbox operations.
- Server-sent events at `/api/tasks/stream` for task progress updates.
- SQLite-backed seed data so the API boots with a realistic project already loaded and survives server restarts.

## Run

From the repo root:

```powershell
cd D:\xuan\小楼WEB\core-api
npm run dev
```

For live Qwen / Wan / CosyVoice calls, create `core-api/.env.local` first:

```powershell
Copy-Item .env.example .env.local
```

Then set:

```text
DASHSCOPE_API_KEY=your_real_key
```

The backend auto-loads local env files from:

- `core-api/.env.local`
- `core-api/.env`
- repo-root `.env.local` / `.env`
- `XIAOLOU-main/.env.local` / `.env`

Or run the server directly:

```powershell
node src\server.js
```

The default port is `4100`. Override it with `PORT` if needed:

```powershell
$env:PORT = 4200
npm start
```

The default SQLite file is:

```text
D:\xuan\小楼WEB\core-api\data\demo.sqlite
```

Override it with `CORE_API_DB_PATH` if needed:

```powershell
$env:CORE_API_DB_PATH = 'D:\xuan\小楼WEB\core-api\data\custom-demo.sqlite'
node src\server.js
```

## Verify

Run the built-in smoke check:

```powershell
npm run verify
```

That script starts the demo server on a random local port and checks:

- `/healthz`
- `/api/projects`
- `/api/projects/:projectId/overview`
- `/api/projects/:projectId/tasks`
- `/api/toolbox/capabilities`

It also creates a project, closes the server, reopens the SQLite file, and confirms the project persisted.

## Handy requests

```powershell
Invoke-RestMethod http://127.0.0.1:4100/api/projects
Invoke-RestMethod http://127.0.0.1:4100/api/projects/proj_demo_001/overview
Invoke-RestMethod http://127.0.0.1:4100/api/toolbox
Invoke-RestMethod -Method Post http://127.0.0.1:4100/api/demo/reset
```

## Notes

- The backend uses Node's built-in `node:sqlite` module. In Node 24 it still prints an experimental warning, but it works correctly for the local demo flow.
- `POST /api/demo/reset` restores the seeded demo dataset in the SQLite file.
- New routes should stay dependency-free and preserve the existing response envelope shape:
  - `success: true|false`
  - `data` for successful responses
  - `error` for failures
  - `meta` for request metadata
