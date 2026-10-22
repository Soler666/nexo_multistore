import { Router } from 'express'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { emitOrganizationActivity, revokeUserSockets } from '../services/realtime'

export const usersRouter = Router()
usersRouter.use(requireAuth)

usersRouter.get('/', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) return res.status(403).json({ error: 'Only the store owner can manage team members' })
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: auth.organizationId },
      select: { id: true, email: true, name: true, image: true, role: true, isActive: true, branchId: true, branch: { select: { name: true } }, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })
    res.json(users)
  } catch (error) {
    next(error)
  }
})

usersRouter.post('/', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) return res.status(403).json({ error: 'Only the store owner can manage team members' })
  const parsed = z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    role: z.enum([Role.BRANCH_MANAGER, Role.CASHIER]),
    branchId: z.string().min(1),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    const branch = await prisma.branch.findFirst({ where: { id: parsed.data.branchId, organizationId: auth.organizationId } })
    if (!branch) return res.status(404).json({ error: 'Branch not found' })
    const member = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: parsed.data.email, role: parsed.data.role, branchId: branch.id, organizationId: auth.organizationId! },
        select: { id: true, email: true, name: true, role: true, isActive: true, branchId: true },
      })
      await tx.auditLog.create({ data: { userId: auth.userId, action: 'TEAM_MEMBER_INVITED', entity: 'User', entityId: created.id, details: JSON.stringify({ role: created.role, branchId: created.branchId }) } })
      return created
    })
    emitOrganizationActivity(auth.organizationId, branch.id, 'TEAM_MEMBER_INVITED')
    res.status(201).json(member)
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'An account with that email already exists' })
    next(error)
  }
})

usersRouter.patch('/:id', async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId || auth.role !== Role.STORE_OWNER) return res.status(403).json({ error: 'Only the store owner can manage team members' })
  if (req.params.id === auth.userId) return res.status(409).json({ error: 'You cannot change your own account here' })
  const parsed = z.object({
    role: z.enum([Role.BRANCH_MANAGER, Role.CASHIER]).optional(),
    branchId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    if (parsed.data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: parsed.data.branchId, organizationId: auth.organizationId } })
      if (!branch) return res.status(404).json({ error: 'Branch not found' })
    }
    const member = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: req.params.id, organizationId: auth.organizationId! },
        data: parsed.data,
      })
      if (!updated.count) throw Object.assign(new Error('Team member not found'), { status: 404 })
      const updatedMember = await tx.user.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { id: true, email: true, name: true, role: true, isActive: true, branchId: true },
      })
      await tx.auditLog.create({ data: { userId: auth.userId, action: 'TEAM_MEMBER_UPDATED', entity: 'User', entityId: updatedMember.id, details: JSON.stringify(parsed.data) } })
      return updatedMember
    })
    revokeUserSockets(member.id)
    if (member.branchId) emitOrganizationActivity(auth.organizationId, member.branchId, 'TEAM_MEMBER_UPDATED')
    res.json(member)
  } catch (error) {
    next(error)
  }
})
