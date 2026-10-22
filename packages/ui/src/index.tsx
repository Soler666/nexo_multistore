import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  icon?: ReactNode
}

export function Button({ variant = 'primary', icon, children, className = '', ...props }: ButtonProps) {
  return (
    <button className={`repo-button repo-button-${variant} ${className}`.trim()} {...props}>
      {icon}{children}
    </button>
  )
}
