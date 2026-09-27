import type { LucideIcon } from 'lucide-react'
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { buttonClass, iconSize, type ButtonSize, type ButtonStyleProps } from './styles'

type StyleProps = ButtonStyleProps & {
  icon?: LucideIcon
  iconEnd?: LucideIcon
}

function Content({ icon: Icon, iconEnd: IconEnd, size = 'md', children }: StyleProps & { size?: ButtonSize; children?: ReactNode }) {
  return (
    <>
      {Icon && <Icon size={iconSize[size]} strokeWidth={1.75} aria-hidden className="shrink-0" />}
      {children}
      {IconEnd && <IconEnd size={iconSize[size]} strokeWidth={1.75} aria-hidden className="shrink-0" />}
    </>
  )
}

export type ButtonProps = StyleProps & ButtonHTMLAttributes<HTMLButtonElement>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, icon, iconEnd, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass({ variant, size, block }, className)} {...rest}>
      <Content icon={icon} iconEnd={iconEnd} size={size}>
        {children}
      </Content>
    </button>
  )
})

export type ButtonAnchorProps = StyleProps & AnchorHTMLAttributes<HTMLAnchorElement>

export const ButtonAnchor = forwardRef<HTMLAnchorElement, ButtonAnchorProps>(function ButtonAnchor(
  { variant, size, block, icon, iconEnd, className, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={buttonClass({ variant, size, block }, className)} {...rest}>
      <Content icon={icon} iconEnd={iconEnd} size={size}>
        {children}
      </Content>
    </a>
  )
})
