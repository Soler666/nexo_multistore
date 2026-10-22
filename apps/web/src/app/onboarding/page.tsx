'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Store } from 'lucide-react'
import { api } from '@/lib/api'

export default function OnboardingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const formData = new FormData(event.currentTarget)
    try {
      await api('/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          organizationName: formData.get('organizationName'),
          taxId: formData.get('taxId'),
          branchName: formData.get('branchName'),
          address: formData.get('address'),
          businessType: formData.get('businessType'),
          taxRate: Number(formData.get('taxRate')) / 100,
          currency: formData.get('currency'),
        }),
      })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      router.replace('/dashboard')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el negocio')
    } finally {
      setSaving(false)
    }
  }

  return <main className="onboarding-page"><div className="onboarding-brand"><span className="brand-mark"><Store size={19} /></span><strong>Nexo<span className="brand-period">.</span></strong><span>CONFIGURACIÓN INICIAL</span></div><div className="onboarding-content"><div className="onboarding-progress"><span className="progress-step done"><Check size={13} /></span><i /><span className="progress-step current">01</span><i className="progress-muted" /><span className="progress-step future">02</span><small>NEGOCIO</small></div><div className="eyebrow"><span className="eyebrow-line" /> PRIMEROS PASOS</div><h1>Empecemos por<br /><em>tu primera sede.</em></h1><p className="page-subtitle">Crea tu espacio comercial y deja listo el punto de partida.</p>
    <form className="onboarding-form" onSubmit={submit}><div className="form-section-title"><span>01</span><strong>Datos del negocio</strong></div><div className="form-grid"><label>Nombre comercial<input name="organizationName" required minLength={2} placeholder="Ej. Casa Norte" /></label><label>NIT / RUT<input name="taxId" required minLength={3} placeholder="Identificación tributaria" /></label><label>Moneda<select name="currency" defaultValue="COP"><option value="COP">COP · Peso colombiano</option><option value="MXN">MXN · Peso mexicano</option><option value="USD">USD · Dólar estadounidense</option><option value="EUR">EUR · Euro</option></select></label><label>Impuesto (%)<input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue="19" required /></label></div><div className="form-section-title second"><span>02</span><strong>Primera sede</strong></div><div className="form-grid"><label>Nombre de la sede<input name="branchName" required placeholder="Ej. Centro" /></label><label>Tipo de negocio<select name="businessType" defaultValue="Ropa"><option>Ropa</option><option>Calzado</option><option>Tecnología</option><option>General</option><option>Otro</option></select></label><label className="full-field">Dirección<input name="address" required placeholder="Calle, ciudad y referencia" /></label></div>
    {error && <div className="notice error">{error}</div>}<button className="primary-button onboarding-submit" disabled={saving}>{saving ? 'Creando espacio…' : 'Crear mi espacio'} <ArrowRight size={17} /></button></form></div><div className="onboarding-footer">NEXO COMERCIAL <span>·</span> CONFIGURACIÓN SEGURA</div></main>
}
