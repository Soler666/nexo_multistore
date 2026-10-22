import { resolve } from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: resolve(__dirname, '../../../.env'), override: process.env.NODE_ENV !== 'production' })

void import('./index.js')
