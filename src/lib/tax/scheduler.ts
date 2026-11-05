import { prisma } from "../db";
import { enqueueRefresh, registerSources } from "./ingestion";

export function scheduleBucket(now: Date) {
  const day = now.toISOString().slice(0, 10);
  // Weekly reconciliation replaces that day's daily run; retries remain idempotent.
  return `${now.getUTCDay() === 0 ? "weekly" : "daily"}:${day}`;
}
export function weeklyBucket(now: Date) {
  const sunday = new Date(now);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  return `weekly:${sunday.toISOString().slice(0, 10)}`;
}
export async function scheduleRefreshes(now = new Date()) {
  await registerSources();
  const sources = await prisma.taxSource.findMany({ where: { enabled: true } });
  const week = weeklyBucket(now);
  for (const source of sources) {
    const weekly = await prisma.ingestionJob.findUnique({
      where: { dedupeKey: `${source.id}:${week}` },
    });
    // Catch up if the host was unavailable on Sunday. Do not queue a redundant
    // daily scan on the day that reconciliation was first scheduled.
    if (!weekly) await enqueueRefresh(source.id, week);
    else if (
      weekly.createdAt.toISOString().slice(0, 10) !==
      now.toISOString().slice(0, 10)
    )
      await enqueueRefresh(source.id, scheduleBucket(now));
  }
  return sources.length;
}
export async function workerHeartbeat(mode: string) {
  await prisma.taxWorkerState.upsert({
    where: { id: "ingestion" },
    create: { id: "ingestion", heartbeatAt: new Date(), mode },
    update: { heartbeatAt: new Date(), mode },
  });
}
