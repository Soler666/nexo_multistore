import type { Server as HttpServer } from 'node:http'
import cookie from 'cookie'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'

let io: Server | undefined
const accessSecret = process.env.ACCESS_TOKEN_SECRET
if (!accessSecret) throw new Error('ACCESS_TOKEN_SECRET is required')

export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: process.env.WEB_ORIGIN ?? 'https://nexo-multistore.vercel.app', credentials: true },
  })

  io.use(async (socket, next) => {
    try {
      const token = cookie.parse(socket.handshake.headers.cookie ?? '').accessToken
      if (!token) return next(new Error('Authentication required'))
      const claims = jwt.verify(token, accessSecret!) as jwt.JwtPayload
      if (!claims.sub) return next(new Error('Invalid session'))
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, role: true, organizationId: true, branchId: true, isActive: true },
      })
      if (!user?.isActive || !Object.values(Role).includes(user.role as Role)) {
        return next(new Error('Account is inactive'))
      }
      socket.data.user = { ...user, role: user.role as Role }
      next()
    } catch {
      next(new Error('Invalid or expired session'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as {
      id: string
      role: Role
      organizationId: string | null
      branchId: string | null
    }
    socket.join(`user:${user.id}`)
    if (user.role === Role.SUPER_ADMIN) socket.join('platform')
    if (!user.organizationId) return
    if (user.role === Role.STORE_OWNER) socket.join(`organization:${user.organizationId}`)
    if ((user.role === Role.BRANCH_MANAGER || user.role === Role.CASHIER) && user.branchId) {
      socket.join(`branch:${user.branchId}`)
    }
  })

  return io
}

export function emitOrganizationActivity(
  organizationId: string,
  branchIds: string | string[],
  type: string,
) {
  const branches = Array.isArray(branchIds) ? branchIds : [branchIds]
  const event = { organizationId, branchIds: branches, type, occurredAt: new Date().toISOString() }
  io?.to('platform').emit('platform:activity', event)
  io?.to(`organization:${organizationId}`).emit('organization:activity', event)
  for (const branchId of branches) io?.to(`branch:${branchId}`).emit('organization:activity', event)
}

export function emitAccessDecision(userId: string, status: 'APPROVED' | 'REJECTED') {
  io?.to(`user:${userId}`).emit('access:decision', { status })
}

export function revokeUserSockets(userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true)
}
