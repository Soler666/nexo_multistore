import { Router } from 'express'
import PDFDocument from 'pdfkit'
import { prisma } from '@repo/db'
import { Role, SaleStatus } from '@repo/types'
import { requireAuth } from '../middleware/auth'

export const reportsRouter = Router()
reportsRouter.use(requireAuth)

reportsRouter.get('/activity', async (req, res, next) => {
  const auth = req.auth!
  if (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER) {
    return res.status(403).json({ error: 'Activity is available to owners and branch managers' })
  }
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  try {
    const activity = await prisma.auditLog.findMany({
      where: {
        user: {
          organizationId: auth.organizationId,
          ...(auth.role === Role.BRANCH_MANAGER ? { branchId: auth.branchId ?? '' } : {}),
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true, branch: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    res.json(activity)
  } catch (error) {
    next(error)
  }
})

reportsRouter.get('/summary', async (req, res, next) => {
  const auth = req.auth!
  if (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER) {
    return res.status(403).json({ error: 'Reports are available to owners and branch managers' })
  }
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  const requestedBranch = typeof req.query.branchId === 'string' ? req.query.branchId : undefined
  if (auth.role === Role.BRANCH_MANAGER && requestedBranch && requestedBranch !== auth.branchId) {
    return res.status(403).json({ error: 'Branch access denied' })
  }
  const branchId = auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : requestedBranch
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1)
  try {
    const [today, month, lowStock, branchSales, bestSellers] = await Promise.all([
      prisma.sale.aggregate({ where: { status: SaleStatus.COMPLETED, branch: { organizationId: auth.organizationId }, branchId, createdAt: { gte: startOfDay } }, _sum: { totalAmount: true }, _count: true }),
      prisma.sale.aggregate({ where: { status: SaleStatus.COMPLETED, branch: { organizationId: auth.organizationId }, branchId, createdAt: { gte: startOfMonth } }, _sum: { totalAmount: true }, _count: true }),
      prisma.branchInventory.findMany({ where: { branch: { organizationId: auth.organizationId }, branchId }, include: { product: { select: { name: true, sku: true } }, branch: { select: { name: true } } }, orderBy: { stockAvailable: 'asc' } }),
      prisma.sale.groupBy({ by: ['branchId'], where: { status: SaleStatus.COMPLETED, branch: { organizationId: auth.organizationId }, branchId, createdAt: { gte: startOfMonth } }, _sum: { totalAmount: true }, _count: true }),
      prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { status: SaleStatus.COMPLETED, branch: { organizationId: auth.organizationId }, branchId, createdAt: { gte: startOfMonth } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5 }),
    ])
    const branches = await prisma.branch.findMany({
      where: { organizationId: auth.organizationId, id: { in: branchSales.map((item) => item.branchId) } },
      select: { id: true, name: true },
    })
    const products = await prisma.product.findMany({ where: { id: { in: bestSellers.map((item) => item.productId) } }, select: { id: true, name: true } })
    res.json({
      today: { revenue: today._sum.totalAmount ?? 0, sales: today._count },
      month: { revenue: month._sum.totalAmount ?? 0, sales: month._count },
      lowStockCount: lowStock.filter((item) => item.stockAvailable <= item.minStockAlert).length,
      lowStock: lowStock.filter((item) => item.stockAvailable <= item.minStockAlert).slice(0, 8).map((item) => ({ ...item, isLowStock: true })),
      branchSales: branchSales.map((item) => ({ ...item, branch: branches.find((branch) => branch.id === item.branchId) })),
      bestSellers: bestSellers.map((item) => ({ ...item, product: products.find((product) => product.id === item.productId) })),
    })
  } catch (error) {
    next(error)
  }
})

reportsRouter.get('/sales.csv', async (req, res, next) => {
  const auth = req.auth!
  if (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER) {
    return res.status(403).json({ error: 'Reports are available to owners and branch managers' })
  }
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  const branchId = auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined
  try {
    const sales = await prisma.sale.findMany({
      where: { branch: { organizationId: auth.organizationId }, branchId, status: SaleStatus.COMPLETED },
      include: { branch: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    })
    const escape = (value: string) => {
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
      return `"${safe.replaceAll('"', '""')}"`
    }
    const lines = [
      ['Factura', 'Fecha', 'Sede', 'Vendedor', 'Total', 'Impuesto', 'Pago'].map(escape).join(','),
      ...sales.map((sale) => [sale.invoiceNumber, sale.createdAt.toISOString(), sale.branch.name, sale.user.name ?? '', sale.totalAmount.toString(), sale.taxAmount.toString(), sale.paymentMethod].map(escape).join(',')),
    ]
    res.type('text/csv; charset=utf-8').attachment('ventas.csv').send(`\uFEFF${lines.join('\r\n')}`)
  } catch (error) {
    next(error)
  }
})

reportsRouter.get('/sales.pdf', async (req, res, next) => {
  const auth = req.auth!
  if (auth.role !== Role.STORE_OWNER && auth.role !== Role.BRANCH_MANAGER) {
    return res.status(403).json({ error: 'Reports are available to owners and branch managers' })
  }
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  const branchId = auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined
  try {
    const sales = await prisma.sale.findMany({
      where: { branch: { organizationId: auth.organizationId }, branchId, status: SaleStatus.COMPLETED },
      include: { branch: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })
    const document = new PDFDocument({ size: 'A4', margin: 36 })
    res.type('application/pdf').attachment('reporte-ventas.pdf')
    document.pipe(res)
    document.fontSize(18).font('Helvetica-Bold').text('Reporte de ventas')
    document.moveDown(0.35).fontSize(9).font('Helvetica').text(`Generado ${new Date().toLocaleString('es-CO')} · ${sales.length} operaciones`)
    document.moveDown()
    const columns = [36, 112, 205, 294, 385, 468]
    const headings = ['FACTURA', 'FECHA', 'SEDE', 'VENDEDOR', 'PAGO', 'TOTAL']
    const drawHeadings = () => {
      const y = document.y
      document.font('Helvetica-Bold').fontSize(7).fillColor('#53614f')
      headings.forEach((heading, index) => document.text(heading, columns[index], y, { width: index === headings.length - 1 ? 86 : 78 }))
      document.moveDown(0.9).strokeColor('#dfe3da').moveTo(36, document.y).lineTo(559, document.y).stroke().moveDown(0.45)
      document.font('Helvetica').fontSize(7).fillColor('#303630')
    }
    drawHeadings()
    for (const sale of sales) {
      if (document.y > 745) {
        document.addPage()
        drawHeadings()
      }
      const y = document.y
      const values = [sale.invoiceNumber, sale.createdAt.toLocaleDateString('es-CO'), sale.branch.name, sale.user.name ?? '—', sale.paymentMethod, sale.totalAmount.toFixed(2)]
      values.forEach((value, index) => document.text(value, columns[index], y, { width: index === values.length - 1 ? 86 : 78, ellipsis: true }))
      document.moveDown(0.8)
    }
    document.end()
  } catch (error) {
    next(error)
  }
})
