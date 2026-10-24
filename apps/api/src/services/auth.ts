import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20'
import { prisma, type User } from '@repo/db'
import { Role } from '@repo/types'

const accessSecret = process.env.ACCESS_TOKEN_SECRET
if (!accessSecret) throw new Error('ACCESS_TOKEN_SECRET is required')

export const googleOAuthEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
)

function getGoogleCallbackUrl() {
  if (process.env.GOOGLE_CALLBACK_URL) return process.env.GOOGLE_CALLBACK_URL

  if (process.env.NODE_ENV === 'production') {
    const apiPublicUrl = process.env.API_PUBLIC_URL?.replace(/\/+$/, '')
    if (!apiPublicUrl) {
      throw new Error('GOOGLE_CALLBACK_URL or API_PUBLIC_URL is required when Google OAuth is enabled in production')
    }
    return `${apiPublicUrl}/api/auth/google/callback`
  }

  return 'http://localhost:4000/api/auth/google/callback'
}

if (googleOAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: getGoogleCallbackUrl(),
      },
      async (_accessToken, _refreshToken, profile: Profile, done) => {
        try {
          const verifiedEmail = profile.emails?.find((email) => email.verified)?.value
          if (!verifiedEmail) return done(new Error('Google account must have a verified email'))

          const existing = await prisma.user.findFirst({
            where: { OR: [{ googleId: profile.id }, { email: verifiedEmail }] },
          })
          const configuredAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
          const isPlatformAdmin = Boolean(configuredAdminEmail && verifiedEmail.toLowerCase() === configuredAdminEmail)
          const user = existing
            ? await prisma.user.update({
                where: { id: existing.id },
                data: {
                  googleId: profile.id,
                  email: verifiedEmail,
                  name: profile.displayName || existing.name,
                  image: profile.photos?.[0]?.value ?? existing.image,
                  ...(isPlatformAdmin ? { role: Role.SUPER_ADMIN, organizationId: null, branchId: null } : {}),
                },
              })
            : await prisma.user.create({
                data: {
                  googleId: profile.id,
                  email: verifiedEmail,
                  name: profile.displayName,
                  image: profile.photos?.[0]?.value,
                  role: isPlatformAdmin ? Role.SUPER_ADMIN : Role.UNASSIGNED,
                },
              })

          if (!user.isActive) return done(new Error('Account disabled'))
          return done(null, user)
        } catch (error) {
          return done(error as Error)
        }
      },
    ),
  )
}

export function createAccessToken(user: User) {
  return jwt.sign(
    {
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId,
    },
    accessSecret!,
    { subject: user.id, expiresIn: '15m' },
  )
}

export async function createRefreshToken(userId: string) {
  const token = randomBytes(48).toString('hex')
  await prisma.refreshToken.create({
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })
  return token
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
