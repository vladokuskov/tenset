import { createLink } from '@tanstack/react-router'
import { ButtonAnchor } from './Button'

/** A router link styled as a Button; takes typed `to`, `params` and `search`. */
export const LinkButton = createLink(ButtonAnchor)
