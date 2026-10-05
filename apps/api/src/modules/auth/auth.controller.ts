import type { CookieOptions, Request, Response } from 'express';
import type { AuthResponse, LoginInput } from '@msm/shared';
import { env, isProduction } from '../../config/env.ts';
import { HttpError } from '../../lib/http-error.ts';
import * as authService from './auth.service.ts';

const REFRESH_COOKIE = 'msm_rt';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
};

const clientContext = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

function sendSession(res: Response, result: Awaited<ReturnType<typeof authService.login>>) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions);
  const body: AuthResponse = { accessToken: result.accessToken, user: result.user };
  res.json(body);
}

export async function login(req: Request, res: Response) {
  const { username, password } = req.body as LoginInput;
  sendSession(res, await authService.login(username, password, clientContext(req)));
}

export async function refresh(req: Request, res: Response) {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new HttpError(401, 'No session', 'SESSION_INVALID');
  try {
    sendSession(res, await authService.refresh(token, clientContext(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ user: await authService.getCurrentUser(req.auth!.sub) });
}
