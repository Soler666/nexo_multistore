'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Building2, Check, CircleDollarSign, Plus, Store, Trash2, X } from 'lucide-react'
import { io } from 'socket.io-client'
import { api, apiBase } from '@/lib/api'
import type { UserDTO } from '@repo/types'

type User = UserDTO & { email: string }
type Organization = { id: string; name: string; taxId: string; joinCode: string; _count: { branches: number; users: number }; branches: { id: string; name: string }[] }
type RequestRow = { id: string; status: string; requestedRole: string; organization: { id: string; name: string }; requester: { id: string; email: string; name: string | null }; branch: { id: string; name: string }; createdAt: string }
type ActivityRow = { id: string; action: string; createdAt: string; user: { name: string | null; email: string; role: string; branch: { name: string } | null; organization: { name: string } | null } }
type Overview = { organizations: Organization[]; today: { revenue: string | number; sales: number }; month: { revenue: string | number; sales: number }; pendingRequests: number; activity: ActivityRow[] }
const money = (value: string | number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0)

export default function PlatformPage() {
  const router = useRouter()
  const client = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<User>('/auth/me') })
  const overview = useQuery({ queryKey: ['platform-overview'], queryFn: () => api<Overview>('/platform/overview'), enabled: session.data?.role === 'SUPER_ADMIN' })
  const requests = useQuery({ queryKey: ['platform-requests'], queryFn: () => api<RequestRow[]>('/access/requests'), enabled: session.data?.role === 'SUPER_ADMIN' })
  const [showCreate, setShowCreate] = useState(false)
  const createOrganization = useMutation({
    mutationFn: (payload: Record<string, string | number>) => api('/platform/organizations', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['platform-overview'] })
      setShowCreate(false)
    },
  })
  const deleteOrganization = useMutation({
    mutationFn: (id: string) => api(`/platform/organizations/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['platform-overview'] }),
  })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) => api(`/access/requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['platform-requests'] }),
  })

  useEffect(() => {
    if (session.data && session.data.role !== 'SUPER_ADMIN') router.replace(session.data.organizationId ? '/dashboard' : '/access')
  }, [router, session.data])

  useEffect(() => {
    if (session.data?.role !== 'SUPER_ADMIN') return
    const socket = io(apiBase, { withCredentials: true })
    socket.on('platform:activity', () => {
      void Promise.all([
        client.invalidateQueries({ queryKey: ['platform-overview'] }),
        client.invalidateQueries({ queryKey: ['platform-requests'] }),
      ])
    })
    return () => { socket.disconnect() }
  }, [client, session.data?.role])

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    createOrganization.mutate({
      organizationName: String(values.get('organizationName')),
      taxId: String(values.get('taxId')),
      ownerEmail: String(values.get('ownerEmail')),
      branchName: String(values.get('branchName')),
      address: String(values.get('address')),
      businessType: String(values.get('businessType')),
      taxRate: Number(values.get('taxRate')) / 100,
      currency: String(values.get('currency')),
    })
  }

  function removeOrganization(organization: Organization) {
    const confirmed = window.confirm(
      `¿Estás seguro de que deseas eliminar la organización ${organization.name}? Esta acción eliminará sus sedes y datos vinculados. Esta acción no se puede deshacer.`,
    )
    if (confirmed) deleteOrganization.mutate(organization.id)
  }

  if (session.isLoading || session.data?.role !== 'SUPER_ADMIN') {
    return <main className="session-loading"><span className="loader" /> Verificando administrador de plataforma</main>
  }

  return <main className="platform-page">
    <header className="platform-header"><a className="brand-lockup" href="/platform"><span className="brand-mark"><Building2 size={19} /></span><span>Nexo<span className="brand-period">.</span> <small>PLATAFORMA</small></span></a><div><span className="platform-admin-email">{session.data.email}</span><button className="secondary-button" onClick={async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); router.replace('/login') }}>Salir</button></div></header>
    <div className="platform-body"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ADMINISTRACIÓN GLOBAL</div><h1>Control de <em>plataforma.</em></h1><p className="page-subtitle">Organizaciones, solicitudes y actividad de todos los negocios.</p></div><button className="primary-button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> Crear organización</button></section>
      {showCreate && <form className="platform-create-form" onSubmit={create}><div className="catalog-kicker">ALTA DE NEGOCIO Y PROPIETARIO</div><div className="form-grid"><label>Nombre comercial<input name="organizationName" required /></label><label>NIT / RUT<input name="taxId" required /></label><label>Correo del propietario<input name="ownerEmail" type="email" required /></label><label>Primera sede<input name="branchName" required /></label><label>Dirección<input name="address" required /></label><label>Tipo de negocio<input name="businessType" defaultValue="General" required /></label><label>IVA (%)<input name="taxRate" type="number" defaultValue="19" min="0" max="100" step="0.01" required /></label><label>Moneda<select name="currency" defaultValue="COP"><option>COP</option><option>USD</option><option>MXN</option><option>EUR</option></select></label></div>{createOrganization.isError && <div className="notice error">{createOrganization.error.message}</div>}<button className="primary-button" disabled={createOrganization.isPending}>{createOrganization.isPending ? 'Creando…' : 'Crear tienda y propietario'}</button></form>}
      <section className="platform-kpis"><article><span>Organizaciones</span><strong>{overview.data?.organizations.length ?? 0}</strong></article><article><span>Solicitudes pendientes</span><strong>{overview.data?.pendingRequests ?? 0}</strong></article><article><span>Ventas hoy</span><strong>{money(overview.data?.today.revenue ?? 0)}</strong></article><article><span>Operaciones hoy</span><strong>{overview.data?.today.sales ?? 0}</strong></article></section>
      <section className="platform-grid"><article className="platform-panel"><div className="panel-heading"><div><div className="panel-eyebrow">NEGOCIOS REGISTRADOS</div><h2>Organizaciones</h2></div><Store size={18} /></div><div className="platform-org-list">{overview.data?.organizations.map((organization) => <div className="platform-org-row" key={organization.id}><span className="platform-org-icon"><Building2 size={16} /></span><span><strong>{organization.name}</strong><small>{organization.taxId} · {organization._count.branches} sedes · {organization._count.users} usuarios</small></span><code>{organization.joinCode}</code><button className="reject-action" type="button" title={`Eliminar ${organization.name}`} aria-label={`Eliminar ${organization.name}`} disabled={deleteOrganization.isPending} onClick={() => removeOrganization(organization)}><Trash2 size={15} /></button></div>)}{deleteOrganization.isError && <div className="notice error">{deleteOrganization.error.message}</div>}{!overview.data?.organizations.length && <div className="activity-empty">No hay organizaciones registradas.</div>}</div></article>
      <article className="platform-panel"><div className="panel-heading"><div><div className="panel-eyebrow">APROBACIONES</div><h2>Solicitudes globales</h2></div><span className="request-count">{requests.data?.filter((request) => request.status === 'PENDING').length ?? 0}</span></div><div className="request-list">{requests.data?.filter((request) => request.status === 'PENDING').map((request) => <div className="request-row" key={request.id}><span className="request-person"><strong>{request.requester.name ?? request.requester.email}</strong><small>{request.organization.name} · {request.branch.name} · {request.requestedRole === 'CASHIER' ? 'Cajero' : 'Gerente'}</small></span><button className="approve-action" title="Aprobar" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, decision: 'APPROVED' })}><Check size={15} /></button><button className="reject-action" title="Rechazar" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, decision: 'REJECTED' })}><X size={15} /></button></div>)}{!requests.data?.some((request) => request.status === 'PENDING') && <div className="request-empty">No hay solicitudes pendientes.</div>}</div></article></section>
      <section className="platform-panel platform-activity"><div className="panel-heading"><div><div className="panel-eyebrow">AUDITORÍA EN VIVO</div><h2>Actividad global</h2></div><span className="live-indicator is-live"><i /> En vivo</span></div><div className="activity-list">{overview.data?.activity.map((entry) => <div className="activity-row" key={entry.id}><span className="activity-icon"><Activity size={15} /></span><span className="activity-copy"><strong>{entry.user.name ?? entry.user.email} <small>{entry.user.role.replaceAll('_', ' ')}</small></strong><span>{entry.action.replaceAll('_', ' ').toLowerCase()} · {entry.user.organization?.name ?? 'Plataforma'} · {entry.user.branch?.name ?? '—'}</span></span><time>{new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(entry.createdAt))}</time></div>)}{!overview.data?.activity.length && <div className="activity-empty">No hay eventos registrados.</div>}</div></section>
    </div>
  </main>
}
