'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BadgeCheck, Building2, Clock3, KeyRound, Store } from 'lucide-react'
import { io } from 'socket.io-client'
import { api, apiBase } from '@/lib/api'
import type { UserDTO } from '@repo/types'

type User = UserDTO & { email: string }
type Organization = { id: string; name: string; branches: { id: string; name: string; businessType: string }[] }
type AccessRequest = { id: string; status: string; requestedRole: string; organization: { name: string }; branch: { name: string }; createdAt: string }
type AccessState = { accessGranted: boolean; requests: AccessRequest[] }

export default function AccessPage() {
  const router = useRouter()
  const client = useQueryClient()
  const [joinCode, setJoinCode] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [requestedRole, setRequestedRole] = useState('CASHIER')
  const [lookupError, setLookupError] = useState('')
  const [requestError, setRequestError] = useState('')
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<User>('/auth/me'),
    refetchInterval: 5000,
  })
  const requests = useQuery({
    queryKey: ['access-requests-me'],
    queryFn: () => api<AccessState>('/access/me'),
    refetchInterval: 5000,
  })
  const lookup = useMutation({
    mutationFn: (code: string) => api<Organization>(`/access/organizations/${encodeURIComponent(code)}`),
    onSuccess: (organization) => {
      setSelectedBranch(organization.branches[0]?.id ?? '')
      setLookupError('')
    },
    onError: (error) => setLookupError(error.message),
  })
  const submitRequest = useMutation({
    mutationFn: (payload: { joinCode: string; branchId: string; requestedRole: string }) =>
      api<AccessRequest>('/access/requests', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: async () => {
      setRequestError('')
      await client.invalidateQueries({ queryKey: ['access-requests-me'] })
    },
    onError: (error) => setRequestError(error.message),
  })

  useEffect(() => {
    if (session.data?.role === 'SUPER_ADMIN') router.replace('/platform')
    else if (session.data?.organizationId) router.replace('/dashboard')
    else if (session.data?.role === 'STORE_OWNER') router.replace('/onboarding')
  }, [router, session.data])

  useEffect(() => {
    if (!session.data?.id || session.data.role !== 'UNASSIGNED') return
    const socket = io(apiBase, { withCredentials: true })
    socket.on('access:decision', () => {
      void Promise.all([
        client.invalidateQueries({ queryKey: ['session'] }),
        client.invalidateQueries({ queryKey: ['access-requests-me'] }),
      ])
    })
    return () => {
      socket.disconnect()
    }
  }, [client, session.data?.id, session.data?.role])

  function findOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    lookup.mutate(joinCode.trim())
  }

  function requestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!lookup.data || !selectedBranch) return
    submitRequest.mutate({ joinCode: joinCode.trim(), branchId: selectedBranch, requestedRole })
  }

  if (session.isLoading || requests.isLoading) {
    return <main className="session-loading"><span className="loader" /> Cargando tu acceso</main>
  }

  const currentRequest = requests.data?.requests.find((request) => request.status === 'PENDING')

  return (
    <main className="access-page">
      <header className="onboarding-brand"><span className="brand-mark"><Store size={19} /></span><strong>Nexo<span className="brand-period">.</span></strong><span>ACCESO AL NEGOCIO</span></header>
      <section className="access-content">
        <div className="eyebrow"><span className="eyebrow-line" /> CUENTA PERSONAL</div>
        <h1>Solicita acceso<br /><em>a una tienda.</em></h1>
        <p className="page-subtitle">Tu correo verificado: {session.data?.email}. El propietario debe aprobar tu sucursal y rol antes de que puedas entrar.</p>

        {currentRequest ? (
          <div className="access-pending">
            <span className="access-pending-icon"><Clock3 size={19} /></span>
            <div><strong>Solicitud pendiente</strong><p>{currentRequest.organization.name} · {currentRequest.branch.name} · {currentRequest.requestedRole === 'CASHIER' ? 'Cajero' : 'Gerente'}</p><small>Esta página se actualizará cuando el propietario decida.</small></div>
          </div>
        ) : (
          <>
            <form className="access-code-form" onSubmit={findOrganization}>
              <label>Código de ingreso<div className="access-code-input"><KeyRound size={16} /><input value={joinCode} onChange={(event) => { setJoinCode(event.target.value); lookup.reset() }} placeholder="NX-XXXXXXXXXXXX" required /></div></label>
              <button className="primary-button" disabled={lookup.isPending}>{lookup.isPending ? 'Buscando…' : 'Buscar negocio'} <ArrowRight size={15} /></button>
            </form>
            {lookupError && <div className="notice error">{lookupError}</div>}
            {lookup.data && <form className="access-request-form" onSubmit={requestAccess}>
              <div className="access-organization"><span><Building2 size={18} /></span><div><strong>{lookup.data.name}</strong><small>{lookup.data.branches.length} sucursales disponibles</small></div></div>
              <label>Sucursal<select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} required><option value="" disabled>Selecciona una sucursal</option>{lookup.data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.businessType}</option>)}</select></label>
              <label>Rol solicitado<select value={requestedRole} onChange={(event) => setRequestedRole(event.target.value)}><option value="CASHIER">Cajero · ventas y comprobantes</option><option value="BRANCH_MANAGER">Gerente · inventario y traslados</option></select></label>
              {requestError && <div className="notice error">{requestError}</div>}
              <button className="primary-button" disabled={submitRequest.isPending || !selectedBranch}>{submitRequest.isPending ? 'Enviando solicitud…' : 'Solicitar aprobación'} <ArrowRight size={15} /></button>
            </form>}
          </>
        )}

        {requests.data?.requests.filter((request) => request.status !== 'PENDING').map((request) => <div className={`access-decision ${request.status.toLowerCase()}`} key={request.id}><BadgeCheck size={17} /><span>{request.organization.name} · {request.branch.name}: {request.status === 'APPROVED' ? 'aprobada' : 'rechazada'}</span></div>)}
        <div className="access-own-business"><span>¿Eres dueño de un negocio?</span><a href="/onboarding">Crear mi negocio <ArrowRight size={14} /></a></div>
      </section>
      <footer className="onboarding-footer">NEXO COMERCIAL <span>·</span> ACCESO CON APROBACIÓN</footer>
    </main>
  )
}
