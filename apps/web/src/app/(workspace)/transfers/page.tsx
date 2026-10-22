'use client'

import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, ArrowRight, Check, Clock3, Plus, X } from 'lucide-react'
import { api } from '@/lib/api'

type Branch = { id: string; name: string }
type Product = { id: string; name: string; sku: string }
type Transfer = { id: string; status: string; createdAt: string; sourceBranch: Branch; targetBranch: Branch; items: { id: string; quantity: number; product: Product }[] }
type Inventory = { product: Product; stockAvailable: number }
const statusName: Record<string, string> = { PENDING: 'Pendiente', APPROVED: 'Aceptado', COMPLETED: 'Completado', REJECTED: 'Rechazado' }

export default function TransfersPage() {
  const client = useQueryClient()
  const [sourceBranchId, setSourceBranchId] = useState('')
  const [targetBranchId, setTargetBranchId] = useState('')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') })
  const inventory = useQuery({ queryKey: ['inventory', sourceBranchId], queryFn: () => api<Inventory[]>(`/inventory?branchId=${sourceBranchId}`), enabled: Boolean(sourceBranchId) })
  const transfers = useQuery({ queryKey: ['transfers'], queryFn: () => api<Transfer[]>('/transfers') })
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['transfers'] }), client.invalidateQueries({ queryKey: ['inventory'] }), client.invalidateQueries({ queryKey: ['summary'] })])
  const create = useMutation({ mutationFn: () => api('/transfers', { method: 'POST', body: JSON.stringify({ sourceBranchId, targetBranchId, items: [{ productId, quantity }] }) }), onSuccess: refresh })
  const decide = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' | 'complete' }) => api(`/transfers/${id}/${action}`, { method: 'POST' }), onSuccess: refresh })
  const available = inventory.data?.find((item) => item.product.id === productId)?.stockAvailable ?? 0
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate()
  }

  return <div className="transfers-page"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> MOVIMIENTO ENTRE SEDES</div><h1>Traslados<span className="heading-comma">.</span></h1><p className="page-subtitle">Solicita, recibe y deja trazabilidad de cada movimiento.</p></div><div className="transfer-counter"><span><Clock3 size={15} /> {transfers.data?.filter((transfer) => transfer.status === 'PENDING').length ?? 0}</span><small>por aceptar</small></div></section>
    <section className="transfer-create-panel"><div className="transfer-form-heading"><span className="transfer-form-icon"><ArrowLeftRight size={19} /></span><div><span className="catalog-kicker">NUEVO MOVIMIENTO</span><h2>Solicitar traslado</h2></div></div><form className="transfer-form" onSubmit={submit}><label>Origen<select required value={sourceBranchId} onChange={(event) => { setSourceBranchId(event.target.value); setProductId('') }}><option value="">Selecciona sede</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><span className="transfer-arrow"><ArrowRight size={17} /></span><label>Destino<select required value={targetBranchId} onChange={(event) => setTargetBranchId(event.target.value)}><option value="">Selecciona sede</option>{branches.data?.filter((branch) => branch.id !== sourceBranchId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="transfer-product">Producto<select required value={productId} onChange={(event) => setProductId(event.target.value)} disabled={!sourceBranchId}><option value="">Selecciona producto</option>{inventory.data?.map((item) => <option key={item.product.id} value={item.product.id} disabled={!item.stockAvailable}>{item.product.name} · {item.stockAvailable} disponibles</option>)}</select></label><label className="transfer-quantity">Cantidad<input type="number" min={1} max={available || 1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} required /></label><button className="primary-button transfer-submit" disabled={!sourceBranchId || !targetBranchId || !productId || quantity > available || create.isPending}><Plus size={16} /> Solicitar</button></form>{create.isError && <div className="notice error">{create.error.message}</div>}</section>
    <section className="transfer-list-section"><div className="section-title-line"><div><span className="panel-eyebrow">TRAZABILIDAD</span><h2>Actividad de traslados</h2></div><span>{transfers.data?.length ?? 0} movimientos</span></div><div className="transfer-list">{transfers.data?.map((transfer) => <article className="transfer-row" key={transfer.id}><span className={`transfer-row-icon ${transfer.status.toLowerCase()}`}><ArrowLeftRight size={18} /></span><div className="transfer-route"><strong>{transfer.sourceBranch.name}<ArrowRight size={15} />{transfer.targetBranch.name}</strong><small>{transfer.items.map((item) => `${item.quantity} × ${item.product.name}`).join(' · ')} · {new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(transfer.createdAt))}</small></div><span className={`status-pill ${transfer.status === 'PENDING' ? 'status-warning' : transfer.status === 'REJECTED' ? 'status-rejected' : 'status-ok'}`}><i />{statusName[transfer.status] ?? transfer.status}</span><div className="transfer-actions">{transfer.status === 'PENDING' && <><button className="approve-action" title="Aceptar y mover existencias" onClick={() => decide.mutate({ id: transfer.id, action: 'accept' })}><Check size={15} /></button><button className="reject-action" title="Rechazar solicitud" onClick={() => decide.mutate({ id: transfer.id, action: 'reject' })}><X size={15} /></button></>}{transfer.status === 'APPROVED' && <button className="complete-action" onClick={() => decide.mutate({ id: transfer.id, action: 'complete' })}>Marcar completado</button>}</div></article>)}{!transfers.data?.length && <div className="empty-state">No hay movimientos de inventario todavía.</div>}</div>{decide.isError && <div className="notice error">{decide.error.message}</div>}</section>
  </div>
}
