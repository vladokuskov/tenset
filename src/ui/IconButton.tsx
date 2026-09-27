import type { LucideIcon } from 'lucide-react'
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react'
import { iconButtonClass, type IconButtonVariant } from './styles'

type StyleProps = {
  icon: LucideIcon
  /** Accessible name; also shown as a tooltip on pointer devices. */
  label: string
  variant?: IconButtonVariant
  /** Visual size in px; the hit area is always at least 44x44. */
  size?: 36 | 44
}

export type IconButtonProps = StyleProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant, size = 44, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={iconButtonClass({ variant, size }, className)}
      {...rest}
    >
      <Icon size={size === 44 ? 22 : 18} strokeWidth={1.75} aria-hidden />
    </button>
  )
})

export type IconAnchorProps = StyleProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>

export const IconAnchor = forwardRef<HTMLAnchorElement, IconAnchorProps>(function IconAnchor(
  { icon: Icon, label, variant, size = 44, className, ...rest },
  ref,
) {
  return (
    <a ref={ref} aria-label={label} title={label} className={iconButtonClass({ variant, size }, className)} {...rest}>
      <Icon size={size === 44 ? 22 : 18} strokeWidth={1.75} aria-hidden />
    </a>
  )
})
