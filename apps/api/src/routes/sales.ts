import { Router } from 'express'
import { Prisma, prisma } from '@repo/db'
import { Role, SaleStatus } from '@repo/types'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { writeAudit } from '../services/audit'
import { emitOrganizationActivity } from '../services/realtime'

export const salesRouter = Router()
const createSaleSchema = z.object({
  branchId: z.string().min(1),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER']),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(10000) })).min(1).max(100),
})

salesRouter.use(requireAuth)

salesRouter.get('/', async (req, res, next) => {
  try {
    const { organizationId, branchId, role } = req.auth!
    if (role !== Role.STORE_OWNER && role !== Role.BRANCH_MANAGER) {
      return res.status(403).json({ error: 'Sales history is available to owners and branch managers' })
    }
    if (!organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
    const requestedBranch = typeof req.query.branchId === 'string' ? req.query.branchId : undefined
    if (role === Role.BRANCH_MANAGER && requestedBranch && requestedBranch !== branchId) {
      return res.status(403).json({ error: 'Branch access denied' })
    }
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25))
    const sales = await prisma.sale.findMany({
      where: {
        branch: { organizationId },
        branchId: role === Role.BRANCH_MANAGER ? branchId ?? '' : requestedBranch,
      },
      include: {
        branch: { select: { name: true, organization: { select: { currency: true } } } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    res.json({ data: sales, page, pageSize })
  } catch (error) {
    next(error)
  }
})

salesRouter.post('/', async (req, res, next) => {
  const parsed = createSaleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const auth = req.auth!
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  const organizationId = auth.organizationId
  if (auth.role !== Role.CASHIER) return res.status(403).json({ error: 'Only cashiers can complete sales' })
  if (parsed.data.branchId !== auth.branchId) return res.status(403).json({ error: 'Branch access denied' })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: parsed.data.branchId, organizationId },
        include: { organization: true },
      })
      if (!branch) throw Object.assign(new Error('Branch not found'), { status: 404 })

      const quantities = new Map<string, number>()
      for (const item of parsed.data.items) {
        quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity)
      }
      const productIds = [...quantities.keys()]
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organizationId, isActive: true },
      })
      if (products.length !== productIds.length) throw Object.assign(new Error('One or more products were not found'), { status: 400 })

      const inventory = await tx.branchInventory.findMany({
        where: { branchId: branch.id, productId: { in: productIds } },
      })
      if (inventory.length !== productIds.length) throw Object.assign(new Error('Products are not stocked at this branch'), { status: 409 })
      const inventoryByProduct = new Map(inventory.map((entry) => [entry.productId, entry]))
      const productsById = new Map(products.map((product) => [product.id, product]))

      for (const [productId, quantity] of quantities) {
        const updated = await tx.branchInventory.updateMany({
          where: { branchId: branch.id, productId, stockAvailable: { gte: quantity } },
          data: { stockAvailable: { decrement: quantity } },
        })
        if (updated.count !== 1) throw Object.assign(new Error(`Insufficient stock for ${productId}`), { status: 409 })
      }

      const items = parsed.data.items.map((item) => {
        const product = productsById.get(item.productId)!
        const localPrice = inventoryByProduct.get(item.productId)!.localPrice
        const unitPrice = localPrice ?? product.basePrice
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice,
          subtotal: unitPrice.mul(item.quantity),
        }
      })
      const subtotal = items.reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0))
      const taxAmount = subtotal.mul(branch.organization.taxRate).toDecimalPlaces(2)
      const totalAmount = subtotal.add(taxAmount)
      const sequence = await tx.branch.update({
        where: { id: branch.id },
        data: { nextInvoiceNumber: { increment: 1 } },
        select: { nextInvoiceNumber: true },
      })
      const sale = await tx.sale.create({
        data: {
          invoiceNumber: String(sequence.nextInvoiceNumber - 1).padStart(8, '0'),
          branchId: branch.id,
          userId: auth.userId,
          totalAmount,
          taxAmount,
          taxRate: branch.organization.taxRate,
          receiptToken: randomBytes(32).toString('hex'),
          paymentMethod: parsed.data.paymentMethod,
          status: SaleStatus.COMPLETED,
          items: { create: items },
        },
        include: { items: { include: { product: true } } },
      })
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'SALE_COMPLETED',
          entity: 'Sale',
          entityId: sale.id,
          details: JSON.stringify({ invoiceNumber: sale.invoiceNumber, total: totalAmount.toString() }),
        },
      })
      return sale
    })
    emitOrganizationActivity(organizationId, parsed.data.branchId, 'SALE_COMPLETED')
    res.status(201).json(result)
  } catch (error) {
    next(error)
  }
})

salesRouter.post('/:id/cancel', async (req, res, next) => {
  const auth = req.auth!
  if (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER && auth.role !== Role.SUPER_ADMIN) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  try {
    const sale = await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: {
          id: req.params.id,
          branch: { organizationId: auth.organizationId ?? '' },
          branchId: auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined,
        },
        include: { items: true },
      })
      if (!existing) throw Object.assign(new Error('Sale not found'), { status: 404 })
      if (existing.status !== SaleStatus.COMPLETED) throw Object.assign(new Error('Sale is already cancelled'), { status: 409 })
      const cancelled = await tx.sale.updateMany({
        where: { id: existing.id, status: SaleStatus.COMPLETED },
        data: { status: SaleStatus.CANCELLED },
      })
      if (cancelled.count !== 1) throw Object.assign(new Error('Sale status changed; reload and retry'), { status: 409 })
      for (const item of existing.items) {
        await tx.branchInventory.update({
          where: { productId_branchId: { productId: item.productId, branchId: existing.branchId } },
          data: { stockAvailable: { increment: item.quantity } },
        })
      }
      await tx.auditLog.create({ data: { userId: auth.userId, action: 'SALE_CANCELLED', entity: 'Sale', entityId: existing.id } })
      return existing
    })
    emitOrganizationActivity(auth.organizationId!, sale.branchId, 'SALE_CANCELLED')
    res.json({ id: sale.id, status: SaleStatus.CANCELLED })
  } catch (error) {
    next(error)
  }
})
