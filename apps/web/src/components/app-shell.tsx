'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowLeftRight, Boxes, ChartNoAxesCombined, CircleUserRound, LogOut, PackageSearch, ShoppingBasket, Store, UsersRound } from 'lucide-react'
import { io } from 'socket.io-client'
import { api, apiBase } from '@/lib/api'
import type { UserDTO } from '@repo/types'

type User = UserDTO & { email: string }
const links = [
  { href: '/dashboard', label: 'Resumen', icon: ChartNoAxesCombined },
  { href: '/pos', label: 'Punto de venta', icon: ShoppingBasket },
  { href: '/inventory', label: 'Inventario', icon: Boxes },
  { href: '/transfers', label: 'Traslados', icon: ArrowLeftRight },
  { href: '/branches', label: 'Sucursales', icon: Store },
  { href: '/team', label: 'Equipo', icon: UsersRound },
  { href: '/reports', label: 'Reportes', icon: Activity },
]
const roleRoutes = {
  STORE_OWNER: ['/dashboard', '/inventory', '/transfers', '/branches', '/team', '/reports'],
  BRANCH_MANAGER: ['/dashboard', '/inventory', '/transfers', '/reports'],
  CASHIER: ['/pos'],
} as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api<User>('/auth/me')
      } catch {
        await api('/auth/refresh', { method: 'POST' })
        return api<User>('/auth/me')
      }
    },
  })
  const allowedRoutes: readonly string[] = session.data
    ? roleRoutes[session.data.role as keyof typeof roleRoutes] ?? []
    : []

  useEffect(() => {
    if (session.isError) router.replace('/login')
    else if (session.data?.role === 'SUPER_ADMIN') router.replace('/platform')
    else if (session.data?.role === 'UNASSIGNED') router.replace('/access')
    else if (session.data?.role === 'STORE_OWNER' && !session.data.organizationId) router.replace('/onboarding')
    else if (session.data && !session.data.organizationId) router.replace('/access')
    else if (session.data?.organizationId) {
      if (!allowedRoutes.includes(pathname)) router.replace(allowedRoutes[0] ?? '/access')
    }
  }, [allowedRoutes, pathname, session.data, session.isError, router])

  useEffect(() => {
    if (!session.data?.organizationId) return
    const socket = io(apiBase, { withCredentials: true })
    socket.on('connect', () => setLive(true))
    socket.on('disconnect', () => setLive(false))
    socket.on('organization:activity', () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['summary'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['transfers'] }),
        queryClient.invalidateQueries({ queryKey: ['team'] }),
        queryClient.invalidateQueries({ queryKey: ['access-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['branches'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
    })
    return () => {
      socket.disconnect()
      setLive(false)
    }
  }, [queryClient, session.data?.organizationId])

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    router.replace('/login')
    router.refresh()
  }

  if (!session.data?.organizationId) {
    return <div className="session-loading"><span className="loader" /> Cargando espacio de trabajo</div>
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand-lockup"><span className="brand-mark"><Store size={19} /></span><span>Nexo<span className="brand-period">.</span></span></Link>
        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <div className="workspace-switch"><span className="workspace-icon"><PackageSearch size={17} /></span><span><strong>Mi negocio</strong><small>Operación comercial</small></span><span className="online-dot" /></div>
        <div className="nav-caption">GESTIÓN</div>
        <nav className="main-nav" aria-label="Navegación principal">
          {links.filter((link) => allowedRoutes.includes(link.href)).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-link ${pathname === href ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {href === '/inventory' && <span className="nav-indicator" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-note"><span className="plan-kicker">CONTROL CENTRAL</span><strong>Todo en orden.</strong><p>Ventas e inventario, en un mismo lugar.</p></div>
          <button className="user-menu" onClick={signOut} title="Cerrar sesión">
            <span className="avatar"><CircleUserRound size={19} /></span>
            <span className="user-meta"><strong>{session.data.name || 'Mi cuenta'}</strong><small>{session.data.role.replaceAll('_', ' ')}</small></span>
            <LogOut size={16} className="logout-icon" />
          </button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-location"><span className="topbar-dot" /> SISTEMA OPERATIVO <span className="topbar-divider">/</span> {links.find((link) => link.href === pathname)?.label ?? 'Gestión'}</div>
          <div className="topbar-right"><span className={`live-indicator ${live ? 'is-live' : ''}`}><i /> {live ? 'En vivo' : 'Conectando'}</span><span className="topbar-date">{new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date())}</span></div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
