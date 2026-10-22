import { Router } from 'express'
import { Prisma, prisma } from '@repo/db'
import { Role } from '@repo/types'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { emitOrganizationActivity } from '../services/realtime'

export const inventoryRouter = Router()
inventoryRouter.use(requireAuth)

inventoryRouter.get('/', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined
  const businessType = typeof req.query.businessType === 'string' ? req.query.businessType : undefined
  if ((auth.role === Role.CASHIER || auth.role === Role.BRANCH_MANAGER) && branchId && branchId !== auth.branchId) {
    return res.status(403).json({ error: 'Branch access denied' })
  }
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const where: Prisma.BranchInventoryWhereInput = {
        branchId: auth.role === Role.CASHIER || auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : branchId,
        branch: { organizationId: auth.organizationId, businessType },
        product: { isActive: true, ...(search ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }] } : {}) },
      }
    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25))
    const [rows, total] = await Promise.all([prisma.branchInventory.findMany({
      where,
      include: { product: true, branch: { select: { id: true, name: true, organization: { select: { currency: true } } } } },
      orderBy: [{ branch: { name: 'asc' } }, { product: { name: 'asc' } }],
      ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }), paginate ? prisma.branchInventory.count({ where }) : Promise.resolve(0)])
    const data = rows.map((row) => ({ ...row, isLowStock: row.stockAvailable <= row.minStockAlert }))
    res.json(paginate ? { data, page, pageSize, total } : data)
  } catch (error) {
    next(error)
  }
})

inventoryRouter.post('/products', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  const schema = z.object({
    branchId: z.string().min(1),
    sku: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(160),
    description: z.string().max(2000).optional(),
    category: z.string().trim().min(1).max(100),
    basePrice: z.number().nonnegative(),
    initialStock: z.number().int().nonnegative().default(0),
    minStockAlert: z.number().int().nonnegative().default(5),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  if (auth.role === Role.BRANCH_MANAGER && parsed.data.branchId !== auth.branchId) {
    return res.status(403).json({ error: 'Branch access denied' })
  }
  try {
    const branch = await prisma.branch.findFirst({ where: { id: parsed.data.branchId, organizationId: auth.organizationId } })
    if (!branch) return res.status(404).json({ error: 'Branch not found' })
    const { branchId, initialStock, minStockAlert, ...productData } = parsed.data
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...productData,
          organizationId: auth.organizationId!,
          basePrice: new Prisma.Decimal(productData.basePrice),
          inventory: { create: { branchId, stockAvailable: initialStock, minStockAlert } },
        },
        include: { inventory: true },
      })
      await tx.auditLog.create({
        data: { userId: auth.userId, action: 'PRODUCT_CREATED', entity: 'Product', entityId: created.id },
      })
      return created
    })
    emitOrganizationActivity(auth.organizationId, branch.id, 'PRODUCT_CREATED')
    res.status(201).json(product)
  } catch (error) {
    next(error)
  }
})

inventoryRouter.delete('/products/:productId', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) {
    return res.status(403).json({ error: 'Only the store owner can archive catalog products' })
  }
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.productId, organizationId: auth.organizationId, isActive: true },
      include: { inventory: { select: { branchId: true } } },
    })
    if (!product) return res.status(404).json({ error: 'Active product not found' })
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { isActive: false } })
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'PRODUCT_ARCHIVED',
          entity: 'Product',
          entityId: product.id,
          details: JSON.stringify({ name: product.name, sku: product.sku }),
        },
      })
    })
    const branchIds = product.inventory.map((row) => row.branchId)
    if (branchIds.length) emitOrganizationActivity(auth.organizationId, branchIds, 'PRODUCT_ARCHIVED')
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

inventoryRouter.patch('/:inventoryId/adjust', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  const parsed = z.object({ delta: z.number().int().min(-100000).max(100000).refine((value) => value !== 0), reason: z.string().trim().min(3).max(240) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    const inventory = await prisma.$transaction(async (tx) => {
      const existing = await tx.branchInventory.findFirst({
        where: {
          id: req.params.inventoryId,
          branch: { organizationId: auth.organizationId!, id: auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined },
        },
      })
      if (!existing) throw Object.assign(new Error('Inventory entry not found'), { status: 404 })
      if (parsed.data.delta < 0 && existing.stockAvailable < -parsed.data.delta) {
        throw Object.assign(new Error('Adjustment would result in negative stock'), { status: 409 })
      }
      const updateWhere = {
        id: existing.id,
        ...(parsed.data.delta < 0 ? { stockAvailable: { gte: -parsed.data.delta } } : {}),
      }
      const updateResult = await tx.branchInventory.updateMany({
        where: updateWhere,
        data: { stockAvailable: { increment: parsed.data.delta } },
      })
      if (updateResult.count !== 1) throw Object.assign(new Error('Stock changed; reload and retry'), { status: 409 })
      const updated = await tx.branchInventory.findUniqueOrThrow({ where: { id: existing.id }, include: { product: true, branch: true } })
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'STOCK_ADJUSTMENT',
          entity: 'BranchInventory',
          entityId: existing.id,
          details: JSON.stringify({ delta: parsed.data.delta, reason: parsed.data.reason }),
        },
      })
      return updated
    })
    emitOrganizationActivity(auth.organizationId, inventory.branchId, 'STOCK_ADJUSTED')
    res.json({ ...inventory, isLowStock: inventory.stockAvailable <= inventory.minStockAlert })
  } catch (error) {
    next(error)
  }
})
