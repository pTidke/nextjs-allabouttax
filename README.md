# All About Tax

Indian income-tax research assistant using reviewed official sources, Azure-hosted inference and Neon PostgreSQL. The early-access app has bounded central income-tax coverage. Filing, tax calculations and statutory return drafts are follow-up milestones.

- [Current release plan and remaining work](docs/release-plan.md)
- [Data pipeline, review rules and database setup](docs/tax-foundation.md)
- [Build, deployment, worker activation and evaluations](docs/deployment.md)

Use Node 24 or a supported Node 22.19+ runtime. Copy `.env.example` into a local environment file and configure server-only credentials. Never commit real credentials.

```sh
npm ci --legacy-peer-deps
npx prisma migrate deploy
npm run dev
```

Use `npm run tax:worker -- run` in a separate terminal for local refresh processing. An installed cloud scheduler is required for updates while the computer is asleep.

```sh
npm run lint
npm test
npm run build
npm run typecheck
```

Sign in to chat. `/library` shows reviewed coverage. `/chats` provides account-scoped history, export and deletion. Existing administrators can review sources and save incomplete drafts at `/admin/knowledge`.
