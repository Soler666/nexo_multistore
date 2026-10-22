'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, ArrowUpRight, BadgeCheck, Building2, CircleDollarSign, PackageCheck, Store } from 'lucide-react'
import { apiBase } from '@/lib/api'

export default function LoginPage() {
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    const messages: Record<string, string> = {
      access_denied: 'Cancelaste el acceso con Google. Puedes intentarlo de nuevo cuando quieras.',
      account_disabled: 'Esta cuenta está desactivada. Contacta al propietario del negocio.',
      database_schema_missing: 'La base existe, pero falta sincronizar el esquema. Ejecuta pnpm db:push y reinicia la API.',
      database_unavailable: 'No se pudo conectar con SQLite. Comprueba DATABASE_URL y que la API esté iniciada.',
      google_email_unverified: 'Google debe confirmar el correo de la cuenta antes de continuar.',
      oauth_failed: 'No se pudo completar el acceso con Google. Comprueba la API y la base de datos e inténtalo otra vez.',
      oauth_state_invalid: 'La sesión de acceso expiró o no coincide. Inicia el proceso de nuevo.',
      session_failed: 'Google validó la cuenta, pero no se pudo crear la sesión. Comprueba la base de datos.',
    }
    if (code) setAuthError(messages[code] ?? 'No se pudo completar el acceso. Inténtalo de nuevo.')
  }, [])

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-topline"><span className="brand-mark"><Store size={19} /></span><strong>Nexo<span className="brand-period">.</span></strong><span className="auth-topline-label">COMERCIO, EN ORDEN</span></div>
        <div className="auth-visual-copy"><span className="eyebrow auth-eyebrow"><span className="eyebrow-line" /> VISIÓN DE CONJUNTO</span><h1>La operación<br />fluye<span>.</span></h1><p>Ventas, inventario y equipos alineados. Todo lo que hace avanzar tu negocio, en un solo lugar.</p></div>
        <div className="auth-scene" aria-hidden="true">
          <div className="scene-window"><div className="scene-window-top"><span /><span /><span /><b>ACTIVIDAD DE TIENDA</b></div><div className="scene-chart"><div className="scene-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="scene-chart-baseline" /></div><div className="scene-side-note"><span>VENTAS HOY</span><b>$ 4.280.000</b><small><ArrowUpRight size={13} /> 12.8% esta semana</small></div><div className="scene-receipt"><div className="receipt-icon"><CircleDollarSign size={16} /></div><div><b>Venta completada</b><span>Comprobante #000184</span></div><BadgeCheck size={17} /></div></div>
          <div className="scene-counter"><span>01</span><i /><span>OPERACIÓN EN TIEMPO REAL</span></div>
        </div>
        <div className="auth-visual-footer"><span>INVENTARIO CONECTADO</span><span>01 — 04</span></div>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap"><div className="auth-mobile-brand"><span className="brand-mark"><Store size={19} /></span><strong>Nexo<span className="brand-period">.</span></strong></div><div className="auth-form-kicker">TU NEGOCIO, MÁS CLARO</div><h2>Inicia sesión o regístrate</h2><p className="auth-form-copy">Google crea tu cuenta la primera vez. Si trabajas en una tienda, solicita el código al propietario; si eres dueño, crea tu negocio.</p>
          <a className="google-button" href={`${apiBase}/api/auth/google`}><span className="google-g">G</span> Continuar con Google <ArrowRight size={17} /></a>
          {authError && <div className="notice error login-error" role="alert">{authError}</div>}
          <div className="auth-divider"><span /> <small>ACCESO SEGURO</small> <span /></div>
          <div className="auth-security"><span><BadgeCheck size={17} /></span><p><strong>Tu información está protegida</strong><small>Usamos la autenticación segura de Google. No almacenamos contraseñas.</small></p></div>
          <div className="auth-features"><div><Building2 size={16} /><span>Varias sedes</span></div><div><PackageCheck size={16} /><span>Stock al día</span></div></div>
        </div><div className="auth-footer"><span>© NEXO COMERCIAL</span><span>GESTIÓN MULTISEDE</span></div>
      </section>
    </main>
  )
}
