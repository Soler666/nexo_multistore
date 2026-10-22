'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowDownRight, ArrowUpRight, Boxes, CalendarDays, CircleDollarSign, PackageOpen, ReceiptText, TrendingUp } from 'lucide-react'
import { CartesianGrid, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/currency'

type Branch = { id: string; name: string; organization: { currency: string } }
type Summary = {
  today: { revenue: number | string; sales: number }
  month: { revenue: number | string; sales: number }
  lowStockCount: number
  lowStock: { id: string; stockAvailable: number; minStockAlert: number; product: { name: string; sku: string }; branch: { name: string } }[]
  branchSales: { branchId: string; _sum: { totalAmount: number | string | null }; _count: number; branch?: Branch }[]
  bestSellers: { productId: string; _sum: { quantity: number | null }; product?: { name: string } }[]
}
type ActivityRow = { id: string; action: string; entity: string; createdAt: string; user: { id: string; name: string | null; role: string; branch: { name: string } | null } }
const actionLabels: Record<string, string> = {
  ACCESS_APPROVED: 'Aprobó acceso',
  ACCESS_REJECTED: 'Rechazó acceso',
  BRANCH_CREATED: 'Creó una sucursal',
  PRODUCT_CREATED: 'Registró un producto',
  SALE_CANCELLED: 'Anuló una venta',
  SALE_COMPLETED: 'Completó una venta',
  STOCK_ADJUSTMENT: 'Ajustó existencias',
  STOCK_TRANSFER_ACCEPTED: 'Aceptó un traslado',
  STOCK_TRANSFER_COMPLETED: 'Completó un traslado',
  STOCK_TRANSFER_REJECTED: 'Rechazó un traslado',
  TEAM_MEMBER_INVITED: 'Invitó a una persona',
  TEAM_MEMBER_UPDATED: 'Actualizó permisos',
}

export default function DashboardPage() {
  const [branchId, setBranchId] = useState('')
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') })
  const summary = useQuery({ queryKey: ['summary', branchId], queryFn: () => api<Summary>(`/reports/summary${branchId ? `?branchId=${branchId}` : ''}`) })
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api<ActivityRow[]>('/reports/activity') })
  const currencyCode = branches.data?.[0]?.organization.currency ?? 'COP'
  const currency = (value: number | string) => formatCurrency(value, currencyCode)
  const data = summary.data

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" /> CENTRO DE OPERACIONES</div><h1>Buenos días<span className="heading-comma">,</span><br /><em>tu negocio está en marcha.</em></h1><p className="page-subtitle">Un vistazo claro a lo que ocurre hoy en tus tiendas.</p></div>
        <label className="branch-filter"><span>VER OPERACIÓN</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Todas las sedes</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><span className="select-chevron">⌄</span></label>
      </section>

      {summary.isError && <div className="notice error">{summary.error.message}</div>}
      <section className="metric-grid" aria-label="Indicadores de ventas">
        <article className="metric-card metric-featured">
          <div className="metric-top"><span className="metric-icon coral"><CircleDollarSign size={18} /></span><span className="metric-period"><CalendarDays size={13} /> HOY</span></div>
          <div className="metric-label">Ventas del día</div><div className="metric-value">{summary.isLoading ? '—' : currency(data?.today.revenue ?? 0)}</div>
          <div className="metric-foot"><span className="metric-trend"><ArrowUpRight size={15} /> {data?.today.sales ?? 0} operaciones</span><span className="metric-foot-label">actualizado al momento</span></div>
          <div className="metric-stamp">01</div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span className="metric-icon olive"><TrendingUp size={18} /></span><span className="metric-period">MES ACTUAL</span></div>
          <div className="metric-label">Ingresos del mes</div><div className="metric-value">{summary.isLoading ? '—' : currency(data?.month.revenue ?? 0)}</div>
          <div className="metric-foot"><span className="metric-trend muted"><ReceiptText size={14} /> {data?.month.sales ?? 0} comprobantes</span><span className="metric-foot-label">ventas completadas</span></div>
          <div className="metric-stamp">02</div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span className="metric-icon blue"><PackageOpen size={18} /></span><span className="metric-period">MÁS VENDIDO</span></div>
          <div className="metric-label">Producto destacado</div><div className="metric-value metric-product">{data?.bestSellers[0]?.product?.name ?? 'Sin ventas aún'}</div>
          <div className="metric-foot"><span className="metric-trend muted"><ArrowUpRight size={14} /> {data?.bestSellers[0]?._sum.quantity ?? 0} unidades</span><span className="metric-foot-label">este mes</span></div>
          <div className="metric-stamp">03</div>
        </article>
        <article className="metric-card metric-alert-card">
          <div className="metric-top"><span className="metric-icon amber"><Boxes size={18} /></span><span className="metric-period">ATENCIÓN</span></div>
          <div className="metric-label">Stock por reponer</div><div className="metric-value">{data?.lowStockCount ?? 0}<small> productos</small></div>
          <div className="metric-foot"><span className="metric-trend alert-trend"><ArrowDownRight size={15} /> requiere revisión</span><span className="metric-foot-label">en tus sedes</span></div>
          <div className="metric-stamp">04</div>
        </article>
      </section>

      <section className="dashboard-lower">
        <article className="panel sales-panel">
          <div className="panel-heading"><div><div className="panel-eyebrow">RENDIMIENTO</div><h2>Ventas por sede</h2></div><a className="panel-link" href="/reports">Ver reporte <span>↗</span></a></div>
          <div className="chart-wrap">
            {data?.branchSales.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.branchSales.map((item) => ({ name: item.branch?.name ?? 'Sede', total: Number(item._sum.totalAmount ?? 0), count: item._count }))} margin={{ top: 10, right: 5, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#e9e8e1" strokeDasharray="3 5" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#777b73', fontSize: 11 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#898c84', fontSize: 10 }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} width={34} />
              <Tooltip cursor={{ fill: '#f1f0e9' }} formatter={(value) => [currency(Number(value)), 'Ingresos']} contentStyle={{ border: '1px solid #e4e2d9', borderRadius: 4, fontSize: 12 }} />
              <Bar dataKey="total" radius={[3, 3, 0, 0]} maxBarSize={45}>{data.branchSales.map((item, index) => <Cell key={item.branchId} fill={index === 0 ? '#c5644d' : '#71816b'} />)}</Bar>
            </BarChart></ResponsiveContainer> : <div className="chart-empty"><span className="chart-empty-icon"><TrendingUp size={22} /></span><strong>Las ventas se verán aquí</strong><span>Cuando registres operaciones, compararemos el rendimiento de cada sede.</span></div>}
          </div>
          <div className="chart-legend"><span><i className="legend-coral" /> Ingresos del mes</span><span className="chart-footnote">{currencyCode} · mes actual</span></div>
        </article>

        <article className="panel stock-panel">
          <div className="panel-heading"><div><div className="panel-eyebrow">INVENTARIO</div><h2>Necesita atención</h2></div><a className="panel-link" href="/inventory">Inventario <span>↗</span></a></div>
          <div className="stock-list">
            {data?.lowStock.length ? data.lowStock.slice(0, 5).map((item) => <div className="stock-row" key={item.id}>
              <span className="stock-item-icon"><PackageOpen size={16} /></span><span className="stock-item-info"><strong>{item.product.name}</strong><small>{item.branch.name} · {item.product.sku}</small></span><span className={`stock-count ${item.stockAvailable === 0 ? 'out' : ''}`}>{item.stockAvailable}<small> uds.</small></span>
            </div>) : <div className="stock-clear"><span><Boxes size={22} /></span><strong>Todo abastecido</strong><small>No hay productos en nivel crítico.</small></div>}
          </div>
          <div className="stock-footer"><span className="stock-status-dot" /> Alertas según mínimo por producto</div>
        </article>
      </section>
      <section className="panel activity-panel">
        <div className="panel-heading"><div><div className="panel-eyebrow">SEGUIMIENTO POR ROL</div><h2>Actividad reciente</h2></div><span className="live-indicator"><i /> En vivo</span></div>
        <div className="activity-list">{activity.data?.map((item) => <div className="activity-row" key={item.id}><span className="activity-icon"><Activity size={15} /></span><span className="activity-copy"><strong>{item.user.name ?? 'Usuario'} <small>{item.user.role.replaceAll('_', ' ')}</small></strong><span>{actionLabels[item.action] ?? item.action.replaceAll('_', ' ').toLowerCase()}</span></span><span className="activity-branch">{item.user.branch?.name ?? 'Organización'}</span><time>{new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.createdAt))}</time></div>)}{!activity.data?.length && <div className="activity-empty">{activity.isLoading ? 'Cargando actividad…' : 'Las acciones del equipo aparecerán aquí.'}</div>}</div>
      </section>
      <div className="dashboard-bottomline"><span>PLATAFORMA DE GESTIÓN MULTISEDE</span><span>NEXO COMERCIAL <b>·</b> 01 / RESUMEN</span></div>
    </div>
  )
}
