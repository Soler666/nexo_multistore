import { randomBytes } from 'node:crypto'
import { Router, type Response } from 'express'
import passport from 'passport'
import { prisma, type User } from '@repo/db'
import { Role } from '@repo/types'
import { requireAuth } from '../middleware/auth'
import {
  createAccessToken,
  createRefreshToken,
  googleOAuthEnabled,
  hashRefreshToken,
} from '../services/auth'

export const authRouter = Router()
const secure = process.env.NODE_ENV === 'production'
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'

function setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
  const options = { httpOnly: true, secure, sameSite: 'lax' as const }
  res.cookie('accessToken', accessToken, { ...options, path: '/', maxAge: 15 * 60 * 1000 })
  res.cookie('refreshToken', refreshToken, {
    ...options,
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
}

authRouter.get('/google', (req, res, next) => {
  if (!googleOAuthEnabled) return res.status(503).json({ error: 'Google OAuth is not configured' })
  const state = randomBytes(24).toString('hex')
  res.cookie('oauthState', state, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 5 * 60 * 1000,
  })
  passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next)
})

authRouter.get('/google/callback', (req, res, next) => {
  const expectedState = req.cookies?.oauthState as string | undefined
  const receivedState = typeof req.query.state === 'string' ? req.query.state : undefined
  res.clearCookie('oauthState', { secure, sameSite: 'lax', path: '/api/auth' })
  if (!expectedState || !receivedState || expectedState !== receivedState) {
    return res.redirect(`${webOrigin}/login?error=oauth_state_invalid`)
  }
  passport.authenticate('google', { session: false }, async (error: Error | null, account: Express.User | false) => {
    if (error || !account) {
      const code = (error as (Error & { code?: string }) | null)?.code
      const failure = code === 'P1001' || code === 'P1000'
        ? 'database_unavailable'
        : code === 'P2021' || code === 'P2022'
          ? 'database_schema_missing'
          : error?.message.includes('verified email')
            ? 'google_email_unverified'
            : error?.message.includes('disabled')
              ? 'account_disabled'
              : 'oauth_failed'
      return res.redirect(`${webOrigin}/login?error=${failure}`)
    }
    try {
      const user = account as User
      const accessToken = createAccessToken(user)
      const refreshToken = await createRefreshToken(user.id)
      setSessionCookies(res, accessToken, refreshToken)
      const destination = user.role === 'SUPER_ADMIN'
        ? '/platform'
        : user.organizationId
          ? '/dashboard'
          : '/access'
      res.redirect(`${webOrigin}${destination}`)
    } catch (sessionError) {
      const code = (sessionError as { code?: string }).code
      const failure = code === 'P1001' || code === 'P1000'
        ? 'database_unavailable'
        : code === 'P2021' || code === 'P2022'
          ? 'database_schema_missing'
          : 'session_failed'
      res.redirect(`${webOrigin}/login?error=${failure}`)
    }
  })(req, res, next)
})

authRouter.post('/refresh', async (req, res, next) => {
  const token = req.cookies?.refreshToken as string | undefined
  if (!token) return res.status(401).json({ error: 'Refresh token required' })

  try {
    const now = new Date()
    const session = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { user: true },
    })
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
      return res.status(401).json({ error: 'Refresh token is invalid or expired' })
    }

    const rotated = await prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      })
      if (revoked.count !== 1) return null
      const rawToken = randomBytes(48).toString('hex')
      await tx.refreshToken.create({
        data: {
          tokenHash: hashRefreshToken(rawToken),
          userId: session.userId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
      return rawToken
    })

    if (!rotated) return res.status(401).json({ error: 'Refresh token already used' })
    setSessionCookies(res, createAccessToken(session.user), rotated)
    return res.status(204).end()
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    res.clearCookie('accessToken', { secure, sameSite: 'lax', path: '/' })
    res.clearCookie('refreshToken', { secure, sameSite: 'lax', path: '/api/auth' })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, name: true, image: true, role: true, organizationId: true, branchId: true },
    })
    if (!user) return res.status(401).json({ error: 'Account not found' })
    res.json(user)
  } catch (error) {
    next(error)
  }
})
