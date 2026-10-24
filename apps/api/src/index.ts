import 'dotenv/config'
import { createServer } from 'node:http'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import passport from 'passport'
import { prisma } from '@repo/db'
import { authRouter } from './routes/auth'
import { accessRouter } from './routes/access'
import { branchesRouter } from './routes/branches'
import { inventoryRouter } from './routes/inventory'
import { onboardingRouter } from './routes/onboarding'
import { platformRouter } from './routes/platform'
import { receiptsRouter } from './routes/receipts'
import { reportsRouter } from './routes/reports'
import { salesRouter } from './routes/sales'
import { transfersRouter } from './routes/transfers'
import { usersRouter } from './routes/users'
import { attachRealtime } from './services/realtime'

const app = express()
const webOrigin = process.env.WEB_ORIGIN ?? 'https://nexo-multistore.vercel.app'

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: webOrigin, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(passport.initialize())

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api/auth', authRouter)
app.use('/api/access', accessRouter)
app.use('/api/onboarding', onboardingRouter)
app.use('/api/platform', platformRouter)
app.use('/api/branches', branchesRouter)
app.use('/api/users', usersRouter)
app.use('/api/sales', salesRouter)
app.use('/api/inventory', inventoryRouter)
app.use('/api/transfers', transfersRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/receipts', receiptsRouter)

app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }))
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const known = error as { status?: number; message?: string }
  const status = Number.isInteger(known.status) ? known.status! : 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : known.message ?? 'Request failed' })
})

const port = Number(process.env.PORT ?? 4000)
const server = createServer(app)
attachRealtime(server)
server.listen(port, () => console.log(`API listening on port ${port}`))

async function shutdown() {
  server.close()
  await prisma.$disconnect()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
