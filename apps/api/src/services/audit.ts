import { prisma } from '@repo/db'

export async function writeAudit(
  userId: string,
  action: string,
  entity: string,
  entityId: string,
  details?: object,
) {
  return prisma.auditLog.create({
    data: { userId, action, entity, entityId, details: details ? JSON.stringify(details) : undefined },
  })
}
