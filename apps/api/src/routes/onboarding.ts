import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'
import { requireAuth } from '../middleware/auth'
import { createAccessToken } from '../services/auth'

export const onboardingRouter = Router()
const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  taxId: z.string().trim().min(3).max(40),
  branchName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(240),
  businessType: z.string().trim().min(2).max(80),
  taxRate: z.number().min(0).max(1).default(0.19),
  currency: z.string().length(3).default('COP'),
})

onboardingRouter.post('/', requireAuth, async (req, res, next) => {
  const parsed = onboardingSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  if (req.auth!.role !== Role.UNASSIGNED || req.auth!.organizationId) {
    return res.status(409).json({ error: 'This account has already completed onboarding' })
  }

  try {
    const { organizationName, taxId, branchName, address, businessType, taxRate, currency } = parsed.data
    const organization = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: organizationName,
          taxId,
          taxRate,
          currency: currency.toUpperCase(),
          branches: { create: { name: branchName, address, businessType } },
        },
        include: { branches: true },
      })
      await tx.user.update({
        where: { id: req.auth!.userId },
        data: { organizationId: created.id, branchId: created.branches[0].id, role: Role.STORE_OWNER },
      })
      await tx.accessRequest.updateMany({
        where: { userId: req.auth!.userId, status: 'PENDING' },
        data: { status: 'REJECTED', decidedAt: new Date() },
      })
      return created
    })
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
    res.cookie('accessToken', createAccessToken(updatedUser), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    })
    res.status(201).json(organization)
  } catch (error) {
    next(error)
  }
})
