import type { Role } from '@repo/types'

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string
        role: Role
        organizationId: string | null
        branchId: string | null
      }
    }
  }
}

export {}
