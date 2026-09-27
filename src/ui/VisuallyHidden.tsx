import type { HTMLAttributes } from 'react'

type Props = HTMLAttributes<HTMLElement> & { as?: 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'p' }

/** Content for screen readers only. */
export function VisuallyHidden({ as: Tag = 'span', className, ...rest }: Props) {
  return <Tag className={className ? `sr-only ${className}` : 'sr-only'} {...rest} />
}
