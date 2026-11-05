import { config } from "dotenv";
// Keep standalone worker commands consistent with local Next.js configuration.
config({ path: [".env.local", ".env"], quiet: true });
