import { describe, expect, it } from 'vitest'
import { checkCue, ngrams, normalize, parseAllowlist, stripHtml } from './cue-rules.ts'

const corpusOf = (...texts: string[]) => new Map(texts.flatMap((t) => ngrams(t).map((g) => [g, 'test'] as const)))

describe('cue rules', () => {
  it('normalizes case, punctuation, apostrophes and accents', () => {
    expect(normalize("Don't  lock-out; Café KNEES!")).toBe('dont lock out cafe knees')
  })

  it('keeps Cyrillic words', () => {
    expect(normalize('Зведіть лопатки, тримайте мʼязи!')).toBe(normalize('зведіть лопатки тримайте мязи'))
    expect(ngrams('раз два три чотири пʼять шість сім')).toHaveLength(1)
  })

  it('flags Ukrainian boilerplate', () => {
    expect(checkCue('Повільно поверніться у вихідне положення', new Map())).toEqual([
      { kind: 'boilerplate', phrase: 'поверніться у вихідне положення' },
    ])
  })

  it('strips tags and decodes entities', () => {
    expect(normalize(stripHtml('<p>Keep&nbsp;it <b>slow</b> &amp; steady&#46;</p>'))).toBe('keep it slow steady')
  })

  it('builds word 7-grams', () => {
    expect(ngrams('one two three four five six seven eight')).toEqual([
      'one two three four five six seven',
      'two three four five six seven eight',
    ])
    expect(ngrams('only six words in this line')).toEqual([])
  })

  it('flags a shared 7-gram regardless of case and punctuation', () => {
    const corpus = corpusOf('Plant the violet kettle beside the purple window gently.')
    expect(checkCue('plant the Violet kettle, beside the purple window', corpus)).toEqual([
      { kind: 'ngram', phrase: 'plant the violet kettle beside the purple', source: 'test' },
      { kind: 'ngram', phrase: 'the violet kettle beside the purple window', source: 'test' },
    ])
  })

  it('passes a 6-word overlap', () => {
    const corpus = corpusOf('Plant the violet kettle beside the window.')
    expect(checkCue('Then plant the violet kettle beside it', corpus)).toEqual([])
  })

  it('exempts 7-grams inside an allowlisted phrase', () => {
    const corpus = corpusOf('plant the violet kettle beside the purple window')
    const allow = parseAllowlist('# comment\nPlant the violet kettle beside the purple window  # generic\n')
    expect(checkCue('Plant the violet kettle beside the purple window', corpus, allow)).toEqual([])
  })

  it('flags boilerplate phrasing', () => {
    expect(checkCue('This will be your starting position.', new Map())).toContainEqual({
      kind: 'boilerplate',
      phrase: 'this will be your starting position',
    })
    expect(checkCue('Press up and exhale as you rise', new Map()).map((f) => f.phrase)).toEqual(['exhale as you'])
  })
})
