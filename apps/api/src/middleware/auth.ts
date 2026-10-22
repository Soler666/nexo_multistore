import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'

const accessSecret = process.env.ACCESS_TOKEN_SECRET
if (!accessSecret) throw new Error('ACCESS_TOKEN_SECRET is required')

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined
  const token = bearer ?? req.cookies?.accessToken

  if (!token) return res.status(401).json({ error: 'Authentication required' })

  try {
    const claims = jwt.verify(token, accessSecret!) as jwt.JwtPayload
    if (!claims.sub) {
      return res.status(401).json({ error: 'Invalid access token' })
    }
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, organizationId: true, branchId: true, isActive: true },
    })
    if (!user?.isActive || !Object.values(Role).includes(user.role as Role)) {
      return res.status(401).json({ error: 'Account is inactive or not found' })
    }
    req.auth = {
      userId: user.id,
      role: user.role as Role,
      organizationId: user.organizationId,
      branchId: user.branchId,
    }
    next()
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
    return res.status(401).json({ error: 'Invalid or expired access token' })
    }
    next(error)
  }
}

export function allowRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}
