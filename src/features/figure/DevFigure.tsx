import { useCallback, useEffect, useMemo } from 'react'
import type { FigureVariant } from './assets'
import type { FigureHandle } from './Figure'
import { FigureStage, type Focus } from './FigureStage'
import { parseHighlight } from './highlight'
import { isPoseName, poseNames, poses } from './poses'
import type { Pose } from './rig'
import { SceneProps } from './SceneProps'
import { isSceneName, scenes, type ExerciseScene } from './scenes'
import { isViewName, views } from './views'

declare global {
  interface Window {
    __ready?: boolean
  }
}

/** a named pose, or inline JSON: {"base":"relaxed","joints":{...}} merges joints over the base */
function resolvePose(pose: string): Pose | null {
  if (isPoseName(pose)) return poses[pose]
  try {
    const p = JSON.parse(pose) as Pose & { base?: string }
    const base = p.base && isPoseName(p.base) ? poses[p.base] : { joints: {} }
    return { ...base, ...p, joints: { ...base.joints, ...p.joints } }
  } catch {
    return null
  }
}

type Props = {
  /** exercise still (scenes.tsx): pose, view, highlight and equipment; pose, view and hl override it */
  scene?: string
  pose?: string
  view?: string
  head?: FigureVariant
  correctives?: boolean
  focus?: Focus
  /** highlight spec, see parseHighlight */
  hl?: string
  /** concentric pulse phase 0..1 */
  pulse?: number
  atlas?: 'on' | 'off' | 'flat'
  ortho?: boolean
}

export default function DevFigure({ scene: sceneName, pose: poseArg, view: viewArg, head = 'a', correctives = true, focus, hl, pulse, atlas, ortho }: Props) {
  useEffect(() => {
    window.__ready = false
  }, [sceneName, poseArg, viewArg, head, correctives, focus?.bone, focus?.size, focus?.lift, hl, pulse, atlas, ortho])
  const scene: ExerciseScene | undefined = isSceneName(sceneName) ? scenes[sceneName] : undefined
  const pose = poseArg ?? scene?.pose ?? 'relaxed'
  const view = viewArg ?? scene?.view ?? 'front'
  const highlight = useMemo(() => (hl ? parseHighlight(hl) : scene?.highlight), [hl, scene])
  const extras = useMemo(() => (scene ? (figure: FigureHandle) => <SceneProps scene={scene} figure={figure} /> : undefined), [scene])
  const onReady = useCallback(() => {
    window.__ready = true
  }, [])

  const resolved = useMemo(() => resolvePose(pose), [pose])
  if (!resolved || !isViewName(view)) {
    return (
      <pre className="p-4 text-sm">
        {`unknown pose or view: ${pose} / ${view}\nposes: ${poseNames.join(', ')}\nviews: ${Object.keys(views).join(', ')}\nscenes: ${Object.keys(scenes).join(', ')}`}
      </pre>
    )
  }
  return (
    <div className="fixed inset-0" style={{ background: '#ffffff' }}>
      <FigureStage
        pose={resolved}
        view={view}
        variant={head}
        correctives={correctives}
        focus={focus}
        highlight={highlight}
        pulse={pulse}
        atlas={atlas}
        ortho={ortho}
        extras={extras}
        dpr={Math.min(window.devicePixelRatio || 1, 3)}
        onReady={onReady}
      />
    </div>
  )
}
