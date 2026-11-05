import type {
  Account,
  Prisma,
  Session,
  User,
  VerificationToken,
} from "@prisma/client";
export type LegacyAuthSnapshot = {
  users: User[];
  accounts: Account[];
  sessions: Session[];
  verificationTokens: VerificationToken[];
};

// Run inside a target transaction. Existing target identities/roles are retained,
// source IDs are remapped for their accounts/sessions, and any identity conflict
// aborts the whole import. No source rows are modified.
export async function importLegacyAuth(
  tx: Prisma.TransactionClient,
  source: LegacyAuthSnapshot,
) {
  const mapping = new Map<string, string>();
  const existing = await tx.user.findMany();
  let createdUsers = 0;
  let matchedUsers = 0;
  let createdAccounts = 0;
  let createdSessions = 0;
  for (const user of source.users) {
    const matches = existing.filter(
      (u) => u.email.toLowerCase() === user.email.toLowerCase(),
    );
    if (matches.length > 1)
      throw new Error("Ambiguous account identity; import aborted.");
    const target = matches[0];
    if (target) {
      mapping.set(user.id, target.id);
      matchedUsers++;
      // Never downgrade an existing administrator or overwrite newer profile data.
      if (user.createdAt < target.createdAt)
        await tx.user.update({
          where: { id: target.id },
          data: { createdAt: user.createdAt },
        });
    } else {
      if (existing.some((u) => u.id === user.id))
        throw new Error("Account ID conflict; import aborted.");
      await tx.user.create({ data: user });
      mapping.set(user.id, user.id);
      createdUsers++;
    }
  }
  for (const account of source.accounts) {
    const userId = mapping.get(account.userId);
    if (!userId)
      throw new Error("Account references an unknown user; import aborted.");
    const key = {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    };
    const target = await tx.account.findUnique({ where: key });
    if (target && target.userId !== userId)
      throw new Error("Provider identity conflict; import aborted.");
    if (!target) {
      await tx.account.create({ data: { ...account, userId } });
      createdAccounts++;
    }
  }
  for (const session of source.sessions) {
    if (session.expires < new Date()) continue;
    const userId = mapping.get(session.userId);
    if (!userId)
      throw new Error("Session references an unknown user; import aborted.");
    const target = await tx.session.findUnique({
      where: { sessionToken: session.sessionToken },
    });
    if (target && target.userId !== userId)
      throw new Error("Session ownership conflict; import aborted.");
    if (!target) {
      await tx.session.create({ data: { ...session, userId } });
      createdSessions++;
    }
  }
  for (const token of source.verificationTokens) {
    if (token.expires < new Date()) continue;
    await tx.verificationToken.upsert({
      where: {
        identifier_token: { identifier: token.identifier, token: token.token },
      },
      create: token,
      update: {},
    });
  }
  return { createdUsers, matchedUsers, createdAccounts, createdSessions };
}
