// Shared contract (owner: catalog agent). Keep these props stable; replace internals freely.
export { ExerciseCardMedia, type ExerciseCardMediaProps } from './ExerciseCardMedia'
export { ExerciseRow, type ExerciseRowProps } from './ExerciseRow'
export { equipmentGlyph, isCatalogExercise, primaryGroupNames, type CardExercise } from './media'
export { useIsCustomized, useRoles } from './useRoles'
export { applyOverride, isCustomized } from './roles'
export { LEVEL_LABEL, PATTERN_GROUPS, PATTERN_LABEL, patternLabel } from './patterns'
export { buildIndex, filterExercises, type CatalogFilters, type CatalogIndex } from './search'
export { AddToPlanSheet, type AddToPlanSheetProps } from './AddToPlanSheet'
