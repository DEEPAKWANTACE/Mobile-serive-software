import type { AuthUser } from '@msm/shared';
import { env } from '../../config/env.ts';
import { HttpError } from '../../lib/http-error.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import { prisma } from '../../lib/prisma.ts';
import { generateRefreshToken, hashToken, signAccessToken } from '../../lib/tokens.ts';
import { recordAudit } from '../audit/audit.service.ts';

type ClientContext = { ip?: string; userAgent?: string };

const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  isActive: true,
  passwordHash: true,
  branch: { select: { id: true, code: true, name: true, isActive: true } },
} as const;

type UserRecord = NonNullable<Awaited<ReturnType<typeof findUserByUsername>>>;

/** Window in which a just-rotated refresh token is treated as a benign race (e.g. two tabs) rather than theft. */
const ROTATION_GRACE_MS = 30_000;

// Used to keep login timing similar whether or not the username exists.
const dummyHash = hashPassword('timing-safe-dummy-password');

function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username }, select: userSelect });
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    branch: user.branch ? { id: user.branch.id, code: user.branch.code, name: user.branch.name } : null,
  };
}

function assertCanSignIn(user: UserRecord) {
  if (!user.isActive) throw new HttpError(403, 'Your account has been deactivated', 'ACCOUNT_INACTIVE');
  if (user.branch && !user.branch.isActive) {
    throw new HttpError(403, 'Your branch is currently inactive', 'BRANCH_INACTIVE');
  }
}

async function issueTokens(user: UserRecord, ctx: ClientContext) {
  const refreshToken = generateRefreshToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 255),
    },
  });
  const accessToken = signAccessToken({ sub: user.id, role: user.role, branchId: user.branch?.id ?? null });
  return { accessToken, refreshToken, user: toAuthUser(user) };
}

export async function login(username: string, password: string, ctx: ClientContext) {
  const user = await findUserByUsername(username);
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));

  if (!user || !valid) {
    if (user) {
      await recordAudit({
        actorId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        branchId: user.branch?.id,
        ip: ctx.ip,
      });
    }
    throw new HttpError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }

  assertCanSignIn(user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    actorId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    branchId: user.branch?.id,
    ip: ctx.ip,
  });

  return issueTokens(user, ctx);
}

export async function refresh(refreshToken: string, ctx: ClientContext) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { select: userSelect } },
  });
  if (!session) throw new HttpError(401, 'Session not found', 'SESSION_INVALID');

  if (session.revokedAt) {
    // A revoked token being replayed outside the grace window indicates theft: kill every session.
    if (Date.now() - session.revokedAt.getTime() > ROTATION_GRACE_MS) {
      await prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAudit({
        actorId: session.userId,
        action: 'auth.refresh_token_reuse',
        entityType: 'user',
        entityId: session.userId,
        ip: ctx.ip,
      });
    }
    throw new HttpError(401, 'Session expired', 'SESSION_INVALID');
  }

  if (session.expiresAt < new Date()) throw new HttpError(401, 'Session expired', 'SESSION_INVALID');

  assertCanSignIn(session.user);

  // Atomic rotation: only one concurrent request can revoke this session.
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new HttpError(401, 'Session expired', 'SESSION_INVALID');

  return issueTokens(session.user, ctx);
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCurrentUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user) throw HttpError.unauthorized();
  assertCanSignIn(user);
  return toAuthUser(user);
}
