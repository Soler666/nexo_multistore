import { Router } from 'express'
import { Prisma, prisma } from '@repo/db'
import { Role } from '@repo/types'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { emitOrganizationActivity } from '../services/realtime'

export const platformRouter = Router()
platformRouter.use(requireAuth)

function requirePlatformAdmin(req: Parameters<Parameters<typeof platformRouter.get>[1]>[0], res: Parameters<Parameters<typeof platformRouter.get>[1]>[1]) {
  if (req.auth?.role === Role.SUPER_ADMIN) return true
  res.status(403).json({ error: 'Platform administrator access required' })
  return false
}

platformRouter.get('/overview', async (req, res, next) => {
  if (!requirePlatformAdmin(req, res)) return
  try {
    const [organizations, todaySales, monthSales, requests, activity] = await Promise.all([
      prisma.organization.findMany({
        include: {
          _count: { select: { branches: true, users: true } },
          branches: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.sale.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } }, _sum: { totalAmount: true }, _count: true }),
      prisma.sale.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }, _sum: { totalAmount: true }, _count: true }),
      prisma.accessRequest.count({ where: { status: 'PENDING' } }),
      prisma.auditLog.findMany({
        include: { user: { select: { id: true, name: true, email: true, role: true, organization: { select: { id: true, name: true } }, branch: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])
    res.json({
      organizations,
      today: { revenue: todaySales._sum.totalAmount ?? 0, sales: todaySales._count },
      month: { revenue: monthSales._sum.totalAmount ?? 0, sales: monthSales._count },
      pendingRequests: requests,
      activity,
    })
  } catch (error) {
    next(error)
  }
})

platformRouter.post('/organizations', async (req, res, next) => {
  if (!requirePlatformAdmin(req, res)) return
  const parsed = z.object({
    organizationName: z.string().trim().min(2).max(120),
    taxId: z.string().trim().min(3).max(40),
    branchName: z.string().trim().min(2).max(120),
    address: z.string().trim().min(3).max(240),
    businessType: z.string().trim().min(2).max(80),
    ownerEmail: z.string().trim().email().transform((email) => email.toLowerCase()),
    taxRate: z.number().min(0).max(1).default(0.19),
    currency: z.string().length(3).default('COP'),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    const organization = await prisma.$transaction(async (tx) => {
      const owner = await tx.user.findUnique({ where: { email: parsed.data.ownerEmail } })
      if (owner && (owner.organizationId || owner.role !== Role.UNASSIGNED || !owner.isActive)) {
        throw Object.assign(new Error('Owner email is already assigned to another account'), { status: 409 })
      }
      const created = await tx.organization.create({
        data: {
          name: parsed.data.organizationName,
          taxId: parsed.data.taxId,
          taxRate: parsed.data.taxRate,
          currency: parsed.data.currency.toUpperCase(),
          branches: { create: { name: parsed.data.branchName, address: parsed.data.address, businessType: parsed.data.businessType } },
        },
        include: { branches: true },
      })
      const firstBranch = created.branches[0]
      if (owner) {
        await tx.user.update({
          where: { id: owner.id },
          data: { organizationId: created.id, branchId: firstBranch.id, role: Role.STORE_OWNER },
        })
      } else {
        await tx.user.create({
          data: { email: parsed.data.ownerEmail, organizationId: created.id, branchId: firstBranch.id, role: Role.STORE_OWNER },
        })
      }
      await tx.auditLog.create({
        data: {
          userId: req.auth!.userId,
          action: 'ORGANIZATION_CREATED_BY_PLATFORM',
          entity: 'Organization',
          entityId: created.id,
          details: JSON.stringify({ ownerEmail: parsed.data.ownerEmail }),
        },
      })
      return created
    })
    emitOrganizationActivity(organization.id, organization.branches[0].id, 'ORGANIZATION_CREATED')
    res.status(201).json(organization)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'A business with that tax ID already exists' })
    }
    next(error)
  }
})

platformRouter.delete('/organizations/:id', async (req, res, next) => {
  if (!requirePlatformAdmin(req, res)) return
  try {
    await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true },
      })
      if (!organization) throw Object.assign(new Error('Organization not found'), { status: 404 })

      const [branches, products, users] = await Promise.all([
        tx.branch.findMany({ where: { organizationId: organization.id }, select: { id: true } }),
        tx.product.findMany({ where: { organizationId: organization.id }, select: { id: true } }),
        tx.user.findMany({ where: { organizationId: organization.id }, select: { id: true } }),
      ])
      const branchIds = branches.map(({ id }) => id)
      const productIds = products.map(({ id }) => id)
      const userIds = users.map(({ id }) => id)

      const [sales, transfers] = await Promise.all([
        tx.sale.findMany({
          where: {
            OR: [
              { branchId: { in: branchIds } },
              { userId: { in: userIds } },
              { items: { some: { productId: { in: productIds } } } },
            ],
          },
          select: { id: true },
        }),
        tx.stockTransfer.findMany({
          where: {
            OR: [
              { sourceBranchId: { in: branchIds } },
              { targetBranchId: { in: branchIds } },
              { requestedById: { in: userIds } },
              { decidedById: { in: userIds } },
              { items: { some: { productId: { in: productIds } } } },
            ],
          },
          select: { id: true },
        }),
      ])
      const saleIds = sales.map(({ id }) => id)
      const transferIds = transfers.map(({ id }) => id)

      await tx.accessRequest.deleteMany({
        where: {
          OR: [
            { organizationId: organization.id },
            { branchId: { in: branchIds } },
            { userId: { in: userIds } },
            { decidedById: { in: userIds } },
          ],
        },
      })
      await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds } } })
      await tx.sale.deleteMany({ where: { id: { in: saleIds } } })
      await tx.transferItem.deleteMany({ where: { transferId: { in: transferIds } } })
      await tx.stockTransfer.deleteMany({ where: { id: { in: transferIds } } })
      await tx.branchInventory.deleteMany({
        where: { OR: [{ branchId: { in: branchIds } }, { productId: { in: productIds } }] },
      })
      await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
      await tx.user.deleteMany({ where: { id: { in: userIds } } })
      await tx.branch.deleteMany({ where: { id: { in: branchIds } } })
      await tx.product.deleteMany({ where: { id: { in: productIds } } })
      await tx.organization.delete({ where: { id: organization.id } })
      await tx.auditLog.create({
        data: {
          userId: req.auth!.userId,
          action: 'ORGANIZATION_DELETED_BY_PLATFORM',
          entity: 'Organization',
          entityId: organization.id,
          details: JSON.stringify({ name: organization.name }),
        },
      })
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
