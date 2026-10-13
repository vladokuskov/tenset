import { loadAllExerciseText } from './localize.ts'

// The app loads exercise text lazily (useLocalizedCatalog); tests read it synchronously.
await loadAllExerciseText()
