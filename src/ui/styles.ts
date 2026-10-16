import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonStyleProps = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }
export type IconButtonVariant = 'ghost' | 'tonal' | 'solid' | 'fill' | 'inverse'

const base =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-on-ink hover:bg-ink/88',
  secondary: 'bg-surface-2 text-ink hover:bg-line',
  ghost: 'bg-transparent text-ink hover:bg-surface-2',
  link: 'bg-transparent text-accent underline-offset-4 hover:underline active:scale-100',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'hit h-9 rounded-md px-3.5 text-sm',
  md: 'h-11 rounded-md px-4 text-base',
  lg: 'h-13 rounded-lg px-5 text-md',
}

export const iconSize: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 }

const linkSizes: Record<ButtonSize, string> = {
  sm: 'hit h-8 rounded-sm px-0 text-sm',
  md: 'hit h-9 rounded-sm px-0 text-base',
  lg: 'h-11 rounded-sm px-0 text-md',
}

export function buttonClass({ variant = 'secondary', size = 'md', block }: ButtonStyleProps = {}, className?: string) {
  return cx(base, variants[variant], variant === 'link' ? linkSizes[size] : sizes[size], block && 'w-full', className)
}

const iconVariants: Record<IconButtonVariant, string> = {
  ghost: 'text-ink hover:bg-surface-2',
  tonal: 'bg-surface-2 text-ink hover:bg-line',
  solid: 'bg-ink text-on-ink hover:bg-ink/88',
  fill: 'text-mv-ink/75 hover:bg-white/45 hover:text-mv-ink',
  inverse: 'text-on-ink hover:bg-on-ink/10',
}

export function iconButtonClass({ variant = 'ghost', size = 44 }: { variant?: IconButtonVariant; size?: 36 | 44 }, className?: string) {
  return cx(
    'hit inline-flex shrink-0 select-none items-center justify-center rounded-full transition-[background-color,scale] duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-40',
    size === 44 ? 'size-11' : 'size-9',
    iconVariants[variant],
    className,
  )
}
