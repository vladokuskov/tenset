/** a = realistic head, b = stylized head; same skeleton, UVs, hair, shorts and morphs */
export type FigureVariant = 'a' | 'b'

export const figureVariants: FigureVariant[] = ['a', 'b']

export function bodyUrl(variant: FigureVariant = 'a') {
  return `${import.meta.env.BASE_URL}models/body-${variant}.glb`
}

export const BODY_URL = bodyUrl('a')
