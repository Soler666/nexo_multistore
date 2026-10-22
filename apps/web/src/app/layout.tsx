import type { Metadata } from 'next'
import { Providers } from '@/components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nexo | Control de tiendas',
  description: 'Punto de venta e inventario para negocios con varias sedes.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><Providers>{children}</Providers></body></html>
}
