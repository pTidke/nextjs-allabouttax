import { readFile } from "node:fs/promises";
export async function productionDatabaseUrl() {
  const project = JSON.parse(await readFile(".vercel/project.json", "utf8"));
  const configDir = process.env.VERCEL_CLI_CONFIG_DIR;
  if (!configDir)
    throw new Error(
      "Set VERCEL_CLI_CONFIG_DIR to the authorized Vercel CLI configuration directory.",
    );
  const auth = JSON.parse(await readFile(`${configDir}/auth.json`, "utf8"));
  async function api(path: string) {
    const url = new URL(`https://api.vercel.com${path}`);
    url.searchParams.set("teamId", project.orgId);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok)
      throw new Error(
        "Could not inspect the approved production database configuration.",
      );
    return response.json();
  }
  // List encrypted metadata, then decrypt only the explicitly approved database variable.
  const list = await api(`/v10/projects/${project.projectId}/env`);
  const entry = list.envs.find(
    (e: { key: string; target: string[] }) =>
      e.key === "DATABASE_URL" && e.target.includes("production"),
  );
  if (!entry) throw new Error("Production database variable is missing.");
  const data = await api(`/v1/projects/${project.projectId}/env/${entry.id}`);
  if (!/^postgres(?:ql)?:/.test(data.value))
    throw new Error("A direct PostgreSQL connection is required.");
  return data.value as string;
}
