import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { emitAccessDecision, emitOrganizationActivity } from '../services/realtime'

export const accessRouter = Router()
accessRouter.use(requireAuth)

const requestSchema = z.object({
  joinCode: z.string().trim().min(4).max(80),
  branchId: z.string().min(1),
  requestedRole: z.enum([Role.BRANCH_MANAGER, Role.CASHIER]),
})

accessRouter.get('/me', async (req, res, next) => {
  const auth = req.auth!
  if (auth.organizationId || auth.role !== Role.UNASSIGNED) {
    return res.json({ accessGranted: true, organizationId: auth.organizationId, role: auth.role })
  }
  try {
    const requests = await prisma.accessRequest.findMany({
      where: { userId: auth.userId },
      include: { organization: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ accessGranted: false, requests })
  } catch (error) {
    next(error)
  }
})

accessRouter.get('/join-code', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) {
    return res.status(403).json({ error: 'Only the store owner can manage join codes' })
  }
  try {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { id: true, name: true, joinCode: true },
    })
    res.json(organization)
  } catch (error) {
    next(error)
  }
})

accessRouter.get('/organizations/:joinCode', async (req, res, next) => {
  const auth = req.auth!
  if (auth.organizationId || auth.role !== Role.UNASSIGNED) {
    return res.status(403).json({ error: 'Only unassigned accounts can look up a business' })
  }
  try {
    const organization = await prisma.organization.findUnique({
      where: { joinCode: req.params.joinCode.trim() },
      select: {
        id: true,
        name: true,
        branches: { select: { id: true, name: true, businessType: true }, orderBy: { name: 'asc' } },
      },
    })
    if (!organization) return res.status(404).json({ error: 'Join code not found' })
    res.json(organization)
  } catch (error) {
    next(error)
  }
})

accessRouter.post('/join-code/rotate', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) {
    return res.status(403).json({ error: 'Only the store owner can manage join codes' })
  }
  try {
    const organization = await prisma.organization.update({
      where: { id: auth.organizationId },
      data: { joinCode: `NX-${randomBytes(6).toString('hex').toUpperCase()}` },
      select: { id: true, name: true, joinCode: true },
    })
    res.json(organization)
  } catch (error) {
    next(error)
  }
})

accessRouter.get('/requests', async (req, res, next) => {
  const auth = req.auth!
  const isPlatformAdmin = auth.role === Role.SUPER_ADMIN
  if (!isPlatformAdmin && (!auth.organizationId || auth.role !== Role.STORE_OWNER)) {
    return res.status(403).json({ error: 'Only an owner or platform admin can review access requests' })
  }
  try {
    const requests = await prisma.accessRequest.findMany({
      where: isPlatformAdmin ? {} : { organizationId: auth.organizationId! },
      include: {
        requester: { select: { id: true, email: true, name: true, image: true } },
        branch: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    res.json(requests)
  } catch (error) {
    next(error)
  }
})

accessRouter.post('/requests', async (req, res, next) => {
  const auth = req.auth!
  if (auth.organizationId || auth.role !== Role.UNASSIGNED) {
    return res.status(409).json({ error: 'This account already belongs to an organization' })
  }
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    const organization = await prisma.organization.findUnique({ where: { joinCode: parsed.data.joinCode } })
    if (!organization) return res.status(404).json({ error: 'Join code not found' })
    const branch = await prisma.branch.findFirst({
      where: { id: parsed.data.branchId, organizationId: organization.id },
      select: { id: true },
    })
    if (!branch) return res.status(404).json({ error: 'Branch not found in this organization' })

    const previous = await prisma.accessRequest.findFirst({
      where: { userId: auth.userId, organizationId: organization.id },
    })
    if (previous?.status === 'PENDING') {
      return res.status(409).json({ error: 'A request for this business is already pending' })
    }
    const accessRequest = previous
      ? await prisma.accessRequest.update({
          where: { id: previous.id },
          data: {
            branchId: branch.id,
            requestedRole: parsed.data.requestedRole,
            status: 'PENDING',
            decidedById: null,
            decidedAt: null,
          },
          include: { organization: { select: { name: true } }, branch: { select: { name: true } } },
        })
      : await prisma.accessRequest.create({
          data: {
            userId: auth.userId,
            organizationId: organization.id,
            branchId: branch.id,
            requestedRole: parsed.data.requestedRole,
          },
          include: { organization: { select: { name: true } }, branch: { select: { name: true } } },
        })
    await prisma.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'ACCESS_REQUESTED',
        entity: 'AccessRequest',
        entityId: accessRequest.id,
        details: JSON.stringify({ organizationId: organization.id, branchId: branch.id, requestedRole: parsed.data.requestedRole }),
      },
    })
    emitOrganizationActivity(organization.id, branch.id, 'ACCESS_REQUESTED')
    res.status(201).json(accessRequest)
  } catch (error) {
    next(error)
  }
})

accessRouter.post('/requests/:id/decision', async (req, res, next) => {
  const auth = req.auth!
  const isPlatformAdmin = auth.role === Role.SUPER_ADMIN
  if (!isPlatformAdmin && (!auth.organizationId || auth.role !== Role.STORE_OWNER)) {
    return res.status(403).json({ error: 'Only an owner or platform admin can review access requests' })
  }
  const parsed = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  try {
    const request = await prisma.$transaction(async (tx) => {
      const pending = await tx.accessRequest.findFirst({
        where: {
          id: req.params.id,
          status: 'PENDING',
          ...(isPlatformAdmin ? {} : { organizationId: auth.organizationId! }),
        },
      })
      if (!pending) throw Object.assign(new Error('Pending request not found'), { status: 404 })
      if (parsed.data.decision === 'APPROVED') {
        const assigned = await tx.user.updateMany({
          where: { id: pending.userId, organizationId: null, role: Role.UNASSIGNED, isActive: true },
          data: {
            organizationId: pending.organizationId,
            branchId: pending.branchId,
            role: pending.requestedRole,
          },
        })
        if (assigned.count !== 1) throw Object.assign(new Error('Account is no longer eligible for access'), { status: 409 })
      }
      const updated = await tx.accessRequest.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { status: parsed.data.decision, decidedById: auth.userId, decidedAt: new Date() },
      })
      if (updated.count !== 1) throw Object.assign(new Error('Request status changed; reload and retry'), { status: 409 })
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: parsed.data.decision === 'APPROVED' ? 'ACCESS_APPROVED' : 'ACCESS_REJECTED',
          entity: 'AccessRequest',
          entityId: pending.id,
          details: JSON.stringify({ userId: pending.userId, role: pending.requestedRole, branchId: pending.branchId }),
        },
      })
      return tx.accessRequest.findUniqueOrThrow({
        where: { id: pending.id },
        include: { requester: { select: { id: true, email: true, name: true } }, branch: { select: { name: true } } },
      })
    })
    emitAccessDecision(request.userId, request.status as 'APPROVED' | 'REJECTED')
    emitOrganizationActivity(request.organizationId, request.branchId, `ACCESS_${request.status}`)
    res.json(request)
  } catch (error) {
    next(error)
  }
})
