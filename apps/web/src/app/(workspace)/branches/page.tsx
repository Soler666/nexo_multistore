'use client'

import { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, MapPin, Plus, Store } from 'lucide-react'
import { api } from '@/lib/api'

type Branch = { id: string; name: string; address: string; businessType: string; organization: { taxRate: string; currency: string } }

export default function BranchesPage() {
  const client = useQueryClient()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') })
  const createBranch = useMutation({
    mutationFn: (payload: { name: string; address: string; businessType: string }) => api('/branches', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['branches'] }),
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    createBranch.mutate({ name: String(form.get('name')), address: String(form.get('address')), businessType: String(form.get('businessType')) })
    event.currentTarget.reset()
  }

  return <div className="branches-page"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> RED DE TIENDAS</div><h1>Sucursales<span className="heading-comma">.</span></h1><p className="page-subtitle">Administra sedes y mantén la operación conectada.</p></div><div className="inventory-heading-stats"><b>{branches.data?.length ?? '—'}</b> sedes activas</div></section>
    <section className="branch-admin-layout"><div className="branch-cards">{branches.data?.map((branch, index) => <article className="branch-card" key={branch.id}><div className={`branch-card-mark mark-${index % 4}`}><Store size={19} /></div><div className="branch-card-type">{branch.businessType.toUpperCase()} <span>·</span> SEDE {String(index + 1).padStart(2, '0')}</div><h2>{branch.name}</h2><p><MapPin size={14} />{branch.address}</p><div className="branch-card-bottom"><span>IVA configurado</span><strong>{(Number(branch.organization.taxRate) * 100).toFixed(2)}%</strong><i /> <span>{branch.organization.currency}</span></div></article>)}{!branches.data?.length && <div className="empty-state">{branches.isLoading ? 'Cargando sedes…' : 'No hay sucursales registradas.'}</div>}</div>
      <aside className="branch-create-panel"><span className="branch-create-icon"><Building2 size={19} /></span><div className="catalog-kicker">EXPANDE TU OPERACIÓN</div><h2>Nueva sede</h2><p>Los impuestos y la moneda se heredan de la configuración del negocio.</p><form onSubmit={submit}><label>Nombre de la sede<input name="name" required minLength={2} placeholder="Ej. Norte" /></label><label>Tipo de negocio<select name="businessType" defaultValue="Ropa"><option>Ropa</option><option>Calzado</option><option>Tecnología</option><option>General</option><option>Otro</option></select></label><label>Dirección<input name="address" required minLength={3} placeholder="Dirección completa" /></label><button className="primary-button" disabled={createBranch.isPending}><Plus size={15} />{createBranch.isPending ? 'Creando…' : 'Crear sucursal'}</button>{createBranch.isError && <div className="notice error">{createBranch.error.message}</div>}</form></aside></section>
  </div>
}
