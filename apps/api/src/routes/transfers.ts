import { Router } from 'express'
import { prisma } from '@repo/db'
import { Role, TransferStatus } from '@repo/types'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { emitOrganizationActivity } from '../services/realtime'

export const transfersRouter = Router()
transfersRouter.use(requireAuth)

transfersRouter.get('/', async (req, res, next) => {
  const auth = req.auth!
  if (auth.role === Role.CASHIER) return res.status(403).json({ error: 'Cashiers cannot access stock transfers' })
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  try {
    const transfers = await prisma.stockTransfer.findMany({
      where: {
        sourceBranch: { organizationId: auth.organizationId },
        ...(auth.role === Role.BRANCH_MANAGER
          ? { OR: [{ sourceBranchId: auth.branchId ?? '' }, { targetBranchId: auth.branchId ?? '' }] }
          : {}),
      },
      include: {
        sourceBranch: { select: { id: true, name: true } },
        targetBranch: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(transfers)
  } catch (error) {
    next(error)
  }
})

transfersRouter.post('/', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  const parsed = z.object({
    sourceBranchId: z.string().min(1),
    targetBranchId: z.string().min(1),
    items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
  }).refine((data) => data.sourceBranchId !== data.targetBranchId, 'Source and target branches must differ').safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  if (auth.role === Role.BRANCH_MANAGER && parsed.data.sourceBranchId !== auth.branchId) {
    return res.status(403).json({ error: 'Managers can only request transfers from their branch' })
  }
  try {
    const transfer = await prisma.$transaction(async (tx) => {
      const branches = await tx.branch.findMany({
        where: { id: { in: [parsed.data.sourceBranchId, parsed.data.targetBranchId] }, organizationId: auth.organizationId! },
      })
      if (branches.length !== 2) throw Object.assign(new Error('One or more branches were not found'), { status: 404 })
      const quantities = new Map<string, number>()
      for (const item of parsed.data.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity)
      const productIds = [...quantities.keys()]
      const products = await tx.product.findMany({ where: { id: { in: productIds }, organizationId: auth.organizationId!, isActive: true }, select: { id: true } })
      if (products.length !== productIds.length) throw Object.assign(new Error('One or more products were not found'), { status: 400 })
      const sourceInventory = await tx.branchInventory.findMany({ where: { branchId: parsed.data.sourceBranchId, productId: { in: productIds } } })
      if (sourceInventory.length !== productIds.length) throw Object.assign(new Error('Products are not stocked at the source branch'), { status: 409 })
      for (const [id, requested] of quantities) {
        if (sourceInventory.find((entry) => entry.productId === id)!.stockAvailable < requested) {
          throw Object.assign(new Error(`Insufficient source stock for ${id}`), { status: 409 })
        }
      }
      const items = [...quantities].map(([productId, quantity]) => ({ productId, quantity }))
      return tx.stockTransfer.create({
        data: {
          sourceBranchId: parsed.data.sourceBranchId,
          targetBranchId: parsed.data.targetBranchId,
          requestedById: auth.userId,
          items: { create: items },
        },
        include: { items: true },
      })
    })
    emitOrganizationActivity(auth.organizationId, [transfer.sourceBranchId, transfer.targetBranchId], 'TRANSFER_REQUESTED')
    res.status(201).json(transfer)
  } catch (error) {
    next(error)
  }
})

transfersRouter.post('/:id/accept', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  try {
    const transfer = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockTransfer.findFirst({
        where: {
          id: req.params.id,
          status: TransferStatus.PENDING,
          sourceBranch: { organizationId: auth.organizationId! },
          targetBranchId: auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined,
        },
      })
      if (!existing) throw Object.assign(new Error('Pending transfer not found or access denied'), { status: 404 })

      const claimed = await tx.stockTransfer.updateMany({
        where: { id: existing.id, status: TransferStatus.PENDING },
        data: { status: TransferStatus.APPROVED, decidedById: auth.userId },
      })
      if (claimed.count !== 1) throw Object.assign(new Error('Transfer status changed; reload and retry'), { status: 409 })

      const items = await tx.transferItem.findMany({ where: { transferId: existing.id } })
      for (const item of items) {
        const source = await tx.branchInventory.updateMany({
          where: { branchId: existing.sourceBranchId, productId: item.productId, stockAvailable: { gte: item.quantity } },
          data: { stockAvailable: { decrement: item.quantity } },
        })
        if (source.count !== 1) throw Object.assign(new Error(`Insufficient source stock for ${item.productId}`), { status: 409 })
        await tx.branchInventory.upsert({
          where: { productId_branchId: { productId: item.productId, branchId: existing.targetBranchId } },
          create: { productId: item.productId, branchId: existing.targetBranchId, stockAvailable: item.quantity },
          update: { stockAvailable: { increment: item.quantity } },
        })
      }
      const accepted = await tx.stockTransfer.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } })
      await tx.auditLog.create({
        data: { userId: auth.userId, action: 'STOCK_TRANSFER_ACCEPTED', entity: 'StockTransfer', entityId: existing.id },
      })
      return accepted
    })
    emitOrganizationActivity(auth.organizationId, [transfer.sourceBranchId, transfer.targetBranchId], 'TRANSFER_ACCEPTED')
    res.json(transfer)
  } catch (error) {
    next(error)
  }
})

transfersRouter.post('/:id/complete', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  try {
    const transfer = await prisma.stockTransfer.findFirst({
      where: {
        id: req.params.id,
        status: TransferStatus.APPROVED,
        sourceBranch: { organizationId: auth.organizationId },
        targetBranchId: auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined,
      },
    })
    if (!transfer) return res.status(404).json({ error: 'Approved transfer not found' })
    const completed = await prisma.$transaction(async (tx) => {
      const result = await tx.stockTransfer.updateMany({
        where: { id: transfer.id, status: TransferStatus.APPROVED },
        data: { status: TransferStatus.COMPLETED, completedAt: new Date() },
      })
      if (result.count !== 1) throw Object.assign(new Error('Transfer status changed; reload and retry'), { status: 409 })
      await tx.auditLog.create({
        data: { userId: auth.userId, action: 'STOCK_TRANSFER_COMPLETED', entity: 'StockTransfer', entityId: transfer.id },
      })
      return tx.stockTransfer.findUniqueOrThrow({ where: { id: transfer.id } })
    })
    emitOrganizationActivity(auth.organizationId, [transfer.sourceBranchId, transfer.targetBranchId], 'TRANSFER_COMPLETED')
    res.json(completed)
  } catch (error) {
    next(error)
  }
})

transfersRouter.post('/:id/reject', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  try {
    const rejected = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockTransfer.findFirst({
        where: {
          id: req.params.id,
          status: TransferStatus.PENDING,
          sourceBranch: { organizationId: auth.organizationId! },
          targetBranchId: auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined,
        },
      })
      if (!existing) return null
      const result = await tx.stockTransfer.updateMany({
        where: { id: existing.id, status: TransferStatus.PENDING },
        data: { status: TransferStatus.REJECTED, decidedById: auth.userId },
      })
      if (result.count !== 1) throw Object.assign(new Error('Transfer status changed; reload and retry'), { status: 409 })
      await tx.auditLog.create({ data: { userId: auth.userId, action: 'STOCK_TRANSFER_REJECTED', entity: 'StockTransfer', entityId: existing.id } })
      return { id: existing.id, sourceBranchId: existing.sourceBranchId, targetBranchId: existing.targetBranchId }
    })
    if (!rejected) return res.status(404).json({ error: 'Pending transfer not found or access denied' })
    emitOrganizationActivity(auth.organizationId, [rejected.sourceBranchId, rejected.targetBranchId], 'TRANSFER_REJECTED')
    res.json({ id: rejected.id, status: TransferStatus.REJECTED })
  } catch (error) {
    next(error)
  }
})
