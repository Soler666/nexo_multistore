'use client'

import { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Check, Clock3, Copy, RefreshCw, UserPlus, UsersRound, X } from 'lucide-react'
import { api } from '@/lib/api'

type Branch = { id: string; name: string }
type Member = { id: string; email: string; name: string | null; role: string; isActive: boolean; branchId: string | null; branch?: { name: string } | null }
type AccessRequest = { id: string; status: string; requestedRole: string; createdAt: string; requester: { name: string | null; email: string }; branch: { id: string; name: string } }
type JoinCode = { name: string; joinCode: string }

export default function TeamPage() {
  const client = useQueryClient()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') })
  const members = useQuery({ queryKey: ['team'], queryFn: () => api<Member[]>('/users') })
  const requests = useQuery({ queryKey: ['access-requests'], queryFn: () => api<AccessRequest[]>('/access/requests') })
  const joinCode = useQuery({ queryKey: ['join-code'], queryFn: () => api<JoinCode>('/access/join-code') })
  const invite = useMutation({
    mutationFn: (payload: { email: string; role: string; branchId: string }) => api('/users', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['team'] }),
  })
  const update = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['team'] }),
  })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      api(`/access/requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['access-requests'] }),
        client.invalidateQueries({ queryKey: ['team'] }),
      ])
    },
  })
  const rotateCode = useMutation({
    mutationFn: () => api<JoinCode>('/access/join-code/rotate', { method: 'POST' }),
    onSuccess: (nextCode) => client.setQueryData(['join-code'], nextCode),
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    invite.mutate({ email: String(form.get('email')), role: String(form.get('role')), branchId: String(form.get('branchId')) })
    event.currentTarget.reset()
  }

  return <div className="team-page"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ACCESO Y RESPONSABILIDADES</div><h1>Equipo<span className="heading-comma">.</span></h1><p className="page-subtitle">Asigna personas a una sede y define su nivel de acceso.</p></div><div className="inventory-heading-stats"><b>{members.data?.filter((member) => member.isActive).length ?? '—'}</b> cuentas activas</div></section>
    <section className="team-control-grid"><article className="join-code-panel"><div className="panel-eyebrow">INGRESO A TU ORGANIZACIÓN</div><h2>Código de acceso</h2><p>Comparte este código solo con personas que deban solicitar un puesto en tu negocio.</p><div className="join-code-value">{joinCode.data?.joinCode ?? '—'}<button className="icon-quiet" title="Copiar código" disabled={!joinCode.data} onClick={() => joinCode.data && navigator.clipboard.writeText(joinCode.data.joinCode)}><Copy size={15} /></button></div><button className="secondary-button" disabled={rotateCode.isPending} onClick={() => rotateCode.mutate()}><RefreshCw size={14} /> Renovar código</button></article><article className="pending-requests-panel"><div className="panel-heading"><div><div className="panel-eyebrow">REVISIÓN DEL PROPIETARIO</div><h2>Solicitudes de acceso</h2></div><span className="request-count">{requests.data?.filter((request) => request.status === 'PENDING').length ?? 0}</span></div><div className="request-list">{requests.data?.filter((request) => request.status === 'PENDING').map((request) => <div className="request-row" key={request.id}><span className="request-avatar"><Clock3 size={16} /></span><span className="request-person"><strong>{request.requester.name ?? request.requester.email}</strong><small>{request.requester.email}</small><small>{request.requestedRole === 'CASHIER' ? 'Cajero' : 'Gerente'} · {request.branch.name}</small></span><button className="approve-action" title="Aprobar y asignar rol/sede" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, decision: 'APPROVED' })}><Check size={15} /></button><button className="reject-action" title="Rechazar solicitud" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, decision: 'REJECTED' })}><X size={15} /></button></div>)}{!requests.data?.some((request) => request.status === 'PENDING') && <div className="request-empty"><BadgeCheck size={18} />No hay solicitudes pendientes</div>}</div>{decide.isError && <div className="notice error">{decide.error.message}</div>}</article></section>
    <section className="team-layout"><div className="table-panel team-table"><div className="table-topline"><div><UsersRound size={17} /><strong>Personas del negocio</strong></div><span>ACCESO POR ROL Y SEDE</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>PERSONA</th><th>ROL</th><th>SEDE ASIGNADA</th><th>ESTADO</th><th>ACCESO</th></tr></thead><tbody>{members.data?.map((member) => <tr key={member.id}><td><strong>{member.name ?? 'Invitación enviada'}</strong><small>{member.email}</small></td><td>{member.role === 'BRANCH_MANAGER' ? 'Administrador de sede' : member.role === 'CASHIER' ? 'Cajero' : member.role.replaceAll('_', ' ')}</td><td>{member.branch?.name ?? 'Sin asignar'}</td><td><span className={`status-pill ${member.isActive ? 'status-ok' : 'status-rejected'}`}><i />{member.isActive ? 'Activo' : 'Desactivado'}</span></td><td><button className="access-toggle" disabled={update.isPending} onClick={() => update.mutate({ id: member.id, isActive: !member.isActive })}>{member.isActive ? 'Desactivar' : 'Reactivar'}</button></td></tr>)}{!members.data?.length && <tr><td colSpan={5} className="table-empty">{members.isLoading ? 'Cargando equipo…' : 'Aún no hay personas invitadas.'}</td></tr>}</tbody></table></div>{members.isError && <div className="notice error table-notice">{members.error.message}</div>}</div>
    <aside className="branch-create-panel invite-panel"><span className="branch-create-icon"><UserPlus size={19} /></span><div className="catalog-kicker">NUEVO ACCESO</div><h2>Invitar al equipo</h2><p>La persona aceptará al iniciar sesión con Google usando este correo.</p><form onSubmit={submit}><label>Correo electrónico<input name="email" type="email" required placeholder="persona@negocio.com" /></label><label>Rol<select name="role" defaultValue="CASHIER"><option value="CASHIER">Cajero</option><option value="BRANCH_MANAGER">Administrador de sede</option></select></label><label>Sede<select name="branchId" required defaultValue=""><option value="" disabled>Selecciona sede</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button className="primary-button" disabled={invite.isPending}><UserPlus size={15} />{invite.isPending ? 'Enviando…' : 'Invitar persona'}</button>{invite.isError && <div className="notice error">{invite.error.message}</div>}</form></aside></section>
  </div>
}
