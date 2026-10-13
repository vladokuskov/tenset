import type { LucideIcon } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
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
