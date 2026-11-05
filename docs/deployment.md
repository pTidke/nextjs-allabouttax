# Deploying the assistant and refresh worker

The web application uses Azure for model inference and Neon for PostgreSQL. The web host and background-worker host are separate deployment choices. Credentials must be configured at runtime and must not be copied into images or committed.

## Verify locally

Use Node 24 (or a supported Node 22.19+ runtime):

```sh
npm ci --legacy-peer-deps
npm run lint
npm test
npm run build
npm run typecheck
npm run tax:health
npm run tax:evaluate
npm run tax:evaluate -- --live
```

The normal test suite uses embedded PostgreSQL and creates no live user records. The retrieval preflight reads the live library. `--live` sends only checked-in public test questions/evidence to the configured Azure deployment and may incur model charges; it creates no conversations. The small case set must be expanded and reviewed before public launch.

`tax:health` reports library freshness, source failures, queue size and worker heartbeat. A nonzero status means the report requires attention. The public `/api/health` endpoint is liveness only and does not prove the corpus is fresh or the model is reachable.

## Database changes

Deploy schema changes separately, before starting a newer app or worker:

```sh
npx prisma migrate deploy
npx prisma generate
```

`202611040001_review_drafts` is additive and stores incomplete reviewer fields separately from approved knowledge. Never use reset or accept-data-loss commands against Neon.

## Web image

```sh
docker build --target web -t allabouttax-web .
docker run --rm --env-file .env.local -p 3000:3000 allabouttax-web
```

The multi-stage image uses standalone Next output, includes public/static assets, and runs as an unprivileged user. Its build context excludes `.env` files. Set the actual deployed `AUTH_URL`, Google callback URL, `AUTH_SECRET`, database and Azure variables from `.env.example` in the host. Do not reuse the local HTTP AUTH_URL in a public deployment. Use HTTPS at the host ingress. Check the provider's plan and terms for the intended commercial use before selecting it.

The web image does not run migrations. The image cannot be considered Linux-verified until the Docker build or Linux CI has actually passed. The current local Docker daemon was unavailable during initial preparation.

## Worker image

```sh
docker build --target worker -t allabouttax-worker .
```

Run the default command as a scheduled job every six hours, or more frequently when ingestion throughput requires it. The command is `node --import tsx scripts/tax-worker.ts tick`, has an eight-minute between-jobs budget, and is safe to retry. Give each run at least 25 minutes at the host. Its environment needs `DATABASE_URL`, optional `TAX_DISCOVERY_START_YEAR` and `TAX_MAX_ORIGINAL_BYTES`; it does not need Google or Azure model credentials. Do not supply `.env.local` wholesale to a hosted worker.

The current worker image keeps its development tool dependencies because the CLI executes TypeScript. A dedicated bundled worker build can reduce image size later.

## Prepared GitHub Actions alternative

`.github/workflows/checks.yml` runs lint, isolated tests, a production build and type checks with placeholder build configuration. It receives no production credentials.

`.github/workflows/knowledge-worker.yml` is opt-in. It runs at minute 17 every six hours and supports manual dispatch. To activate after the owner approves sharing the credential with this service:

1. Commit/push and review the workflow on the repository's default branch.
2. Create a protected GitHub environment named `tax-worker`; limit deployment branches to the trusted default branch.
3. Store the Neon worker `DATABASE_URL` as an encrypted environment secret. Prefer a separately provisioned database role with only the worker's required privileges; do not paste the URL into a chat, source file or workflow input.
4. Set repository variable `TAX_WORKER_ENABLED=true`; optionally configure discovery/storage variables.
5. Dispatch a run and confirm it processes jobs, updates heartbeat and passes freshness checks. Resolve document/source failures reported by health checks.
6. Configure GitHub failure notifications and an independent check for missed schedules. Schedule execution can be delayed, and inactive public repositories can have schedules disabled. This is a POC option, not a strict scheduling SLA.

No GitHub secret or repository variable is configured simply by adding these files. A cloud scheduler is active only after a real scheduled run is confirmed. Automated source checks never approve new tax material.

References: [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/), [OpenAI evaluation practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
