/** Saves a file through a temporary <a download>. */
export function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

let shareFilesSupport: boolean | undefined

/** Web Share with files; pass the file to check its type, otherwise a small JSON probe is used (cached). */
export function canShareFiles(file?: File): boolean {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    if (file) return navigator.canShare({ files: [file] })
    shareFilesSupport ??= navigator.canShare({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] })
    return shareFilesSupport
  } catch {
    return false
  }
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

/** Opens the share sheet when the browser can share this file, else downloads it. */
export async function shareOrDownload(file: File, title: string): Promise<ShareResult> {
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    }
  }
  download(file)
  return 'downloaded'
}
