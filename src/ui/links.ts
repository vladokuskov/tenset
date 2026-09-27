import { createLink } from '@tanstack/react-router'
import { ButtonAnchor } from './Button'
import { IconAnchor } from './IconButton'

/** A router link styled as a Button; takes typed `to`, `params` and `search`. */
export const LinkButton = createLink(ButtonAnchor)

/** A router link styled as an IconButton. */
export const IconLink = createLink(IconAnchor)
