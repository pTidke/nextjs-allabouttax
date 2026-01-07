import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { 
  prisma: ReturnType<typeof createPrismaClient>
}

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  const isAccelerate = url?.startsWith('prisma://') || url?.startsWith('prisma+postgres://');

  if (isAccelerate) {
    return new PrismaClient({
      accelerateUrl: url
    } as any);
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}