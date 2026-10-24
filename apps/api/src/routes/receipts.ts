import { Router } from 'express'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { prisma } from '@repo/db'
import { Role } from '@repo/types'
import { requireAuth } from '../middleware/auth'

export const receiptsRouter = Router()

receiptsRouter.get('/:saleId.pdf', requireAuth, async (req, res, next) => {
  const auth = req.auth!
  if (!auth.organizationId) return res.status(409).json({ error: 'Complete onboarding first' })
  if (auth.role !== Role.CASHIER && auth.role !== Role.BRANCH_MANAGER && auth.role !== Role.STORE_OWNER) {
    return res.status(403).json({ error: 'This role cannot access sale receipts' })
  }
  try {
    const sale = await prisma.sale.findFirst({
      where: {
        id: req.params.saleId,
        branch: { organizationId: auth.organizationId },
        branchId: auth.role === Role.CASHIER || auth.role === Role.BRANCH_MANAGER ? auth.branchId ?? '' : undefined,
        userId: auth.role === Role.CASHIER ? auth.userId : undefined,
      },
      include: {
        branch: { include: { organization: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
        user: { select: { name: true } },
      },
    })
    if (!sale) return res.status(404).json({ error: 'Sale not found' })

    const apiPublicUrl = (process.env.API_PUBLIC_URL ?? 'https://nexo-multistore.onrender.com').replace(/\/+$/, '')
    const verifyUrl = `${apiPublicUrl}/api/receipts/verify/${sale.receiptToken}`
    const qrData = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 112 })
    const document = new PDFDocument({ size: 'A4', margin: 42 })
    res.type('application/pdf').attachment(`comprobante-${sale.invoiceNumber}.pdf`)
    document.pipe(res)
    document.fontSize(18).text(sale.branch.organization.name)
    document.moveDown(0.25).fontSize(11).text(sale.branch.name)
    document.text(sale.branch.address)
    document.moveDown().fontSize(14).text(`Comprobante ${sale.invoiceNumber}`)
    document.fontSize(10).text(`Fecha: ${new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: 'America/Bogota',
    }).format(sale.createdAt)}`)
    document.text(`Atendido por: ${sale.user.name ?? 'Cajero'}`)
    document.moveDown().font('Helvetica-Bold').text('Producto', 42, document.y, { continued: true, width: 265 })
    document.text('Cant.', 310, document.y, { continued: true, width: 55, align: 'right' })
    document.text('Precio', 370, document.y, { continued: true, width: 85, align: 'right' })
    document.text('Total', 460, document.y, { width: 90, align: 'right' })
    document.font('Helvetica')
    for (const item of sale.items) {
      const y = document.y + 5
      document.text(item.product.name, 42, y, { width: 250 })
      document.text(String(item.quantity), 310, y, { width: 55, align: 'right' })
      document.text(item.unitPrice.toFixed(2), 370, y, { width: 85, align: 'right' })
      document.text(item.subtotal.toFixed(2), 460, y, { width: 90, align: 'right' })
      document.moveDown(0.65)
    }
    document.moveDown().text(`Impuesto (${(Number(sale.taxRate) * 100).toFixed(2)}%): ${sale.taxAmount.toFixed(2)}`, { align: 'right' })
    document.font('Helvetica-Bold').fontSize(13).text(`TOTAL: ${sale.totalAmount.toFixed(2)} ${sale.branch.organization.currency}`, { align: 'right' })
    document.image(Buffer.from(qrData.split(',')[1], 'base64'), 42, document.y + 18, { width: 92 })
    document.font('Helvetica').fontSize(9).text(`Verificar comprobante: ${verifyUrl}`, 145, document.y + 42, { width: 390 })
    document.end()
  } catch (error) {
    next(error)
  }
})

receiptsRouter.get('/verify/:token', async (req, res, next) => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { receiptToken: req.params.token },
      select: {
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        branch: { select: { name: true, organization: { select: { name: true, taxId: true, currency: true } } } },
      },
    })
    if (!sale) return res.status(404).json({ valid: false })
    res.json({ valid: true, ...sale })
  } catch (error) {
    next(error)
  }
})
