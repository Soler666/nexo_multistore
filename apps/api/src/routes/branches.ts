import { Router } from 'express'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { emitOrganizationActivity } from '../services/realtime'

export const branchesRouter = Router()
branchesRouter.use(requireAuth)

branchesRouter.get('/', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  try {
    const branches = await prisma.branch.findMany({
      where: {
        organizationId: auth.organizationId,
        id: auth.role === Role.CASHIER || auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined,
      },
      select: { id: true, name: true, address: true, businessType: true, organization: { select: { taxRate: true, currency: true } } },
      orderBy: { name: 'asc' },
    })
    res.json(branches)
  } catch (error) {
    next(error)
  }
})

branchesRouter.post('/', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) {
    return res.status(403).json({ error: 'Only the store owner can create branches' })
  }
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(3).max(240),
    businessType: z.string().trim().min(2).max(80),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    const branch = await prisma.$transaction(async (tx) => {
      const created = await tx.branch.create({
        data: { ...parsed.data, organizationId: auth.organizationId! },
        select: { id: true, name: true, address: true, businessType: true },
      })
      await tx.auditLog.create({
        data: { userId: auth.userId, action: 'BRANCH_CREATED', entity: 'Branch', entityId: created.id },
      })
      return created
    })
    emitOrganizationActivity(auth.organizationId, branch.id, 'BRANCH_CREATED')
    res.status(201).json(branch)
  } catch (error) {
    next(error)
  }
})

branchesRouter.delete('/:id', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) {
    return res.status(403).json({ error: 'Only the store owner can delete branches' })
  }
  try {
    const branch = await prisma.branch.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
      select: { id: true, name: true },
    })
    if (!branch) return res.status(404).json({ error: 'Branch not found' })

    await prisma.$transaction(async (tx) => {
      const transfers = await tx.stockTransfer.findMany({
        where: { OR: [{ sourceBranchId: branch.id }, { targetBranchId: branch.id }] },
        select: { id: true },
      })
      const sales = await tx.sale.findMany({ where: { branchId: branch.id }, select: { id: true } })
      const transferIds = transfers.map(({ id }) => id)
      const saleIds = sales.map(({ id }) => id)

      await tx.accessRequest.deleteMany({ where: { branchId: branch.id } })
      await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds } } })
      await tx.sale.deleteMany({ where: { id: { in: saleIds } } })
      await tx.transferItem.deleteMany({ where: { transferId: { in: transferIds } } })
      await tx.stockTransfer.deleteMany({ where: { id: { in: transferIds } } })
      await tx.branchInventory.deleteMany({ where: { branchId: branch.id } })
      await tx.user.updateMany({ where: { branchId: branch.id }, data: { branchId: null } })
      await tx.branch.delete({ where: { id: branch.id } })
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'BRANCH_DELETED',
          entity: 'Branch',
          entityId: branch.id,
          details: JSON.stringify({ name: branch.name }),
        },
      })
    })
    emitOrganizationActivity(auth.organizationId, branch.id, 'BRANCH_DELETED')
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
