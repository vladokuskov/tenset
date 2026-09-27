import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Box3, NeutralToneMapping, Vector3, type Group, type OrthographicCamera, type PerspectiveCamera } from 'three'
import type { FigureVariant } from './assets'
import { Figure, type FigureHandle } from './Figure'
import type { FigureHighlight } from './highlight'
import type { Pose } from './rig'
import type { PoseName } from './poses'
import { StudioEnvironment, StudioFloor, StudioLights } from './Studio'
import { skinnedPositions } from './props/fit'
import { azimuth, elevations, frameBox, frameBoxOrtho, frameFit, type ViewName } from './views'

declare global {
  interface Window {
    __figure?: FigureHandle
  }
}

/** frame a cube of `size` metres around a bone (raised by `lift` metres) instead of the whole body */
export type Focus = { bone: string; size: number; lift?: number }

export type FigureStageProps = {
  pose: Pose | PoseName
  view: ViewName
  variant?: FigureVariant
  correctives?: boolean
  focus?: Focus
  highlight?: FigureHighlight
  pulse?: number | null
  /** 'flat' = QA region colours, 'off' = no relief or highlight */
  atlas?: 'on' | 'off' | 'flat'
  /** orthographic, level camera (QA) */
  ortho?: boolean
  dpr?: number
  /** equipment and other scene content placed on the posed figure; framed together with it */
  extras?: (figure: FigureHandle) => ReactNode
  /** fires once the figure is posed, framed and a few frames have rendered */
  onReady?: () => void
}

type FramingProps = {
  handle: FigureHandle | null
  extras: RefObject<Group | null>
  pose: Pose | PoseName
  view: ViewName
  focus?: Focus
  ortho?: boolean
  onFramed: () => void
}

/** skinned body vertices (every 4th), the floor under the feet (for the contact shadow) and the extras' box corners */
function framingPoints(handle: FigureHandle, extras: Group | null) {
  const P = skinnedPositions(handle.rig.mesh)
  const out: number[] = []
  let minY = Infinity
  for (let i = 0; i < P.length; i += 12) {
    out.push(P[i], P[i + 1], P[i + 2])
    minY = Math.min(minY, P[i + 1])
  }
  const box = new Box3()
  if (extras) box.setFromObject(extras)
  if (!box.isEmpty()) {
    for (let k = 0; k < 8; k++) out.push(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z)
  }
  // the soft shadow spreads a few centimetres past the feet
  const n = out.length
  for (let i = 0; i < n; i += 3) if (out[i + 1] < minY + 0.03) out.push(out[i], 0, out[i + 2] + 0.04, out[i], 0, out[i + 2] - 0.04)
  return out
}

// props place themselves in the first frames after the figure is posed, so framing waits for them
const FRAME_AT = 2
const READY_AT = 6

function Framing({ handle, extras, pose, view, focus, ortho, onFramed }: FramingProps) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const framed = useRef<unknown[]>([])
  const frames = useRef(-1)
  useFrame(() => {
    if (!handle) return
    const key = [handle, pose, view, focus?.bone, focus?.size, focus?.lift, size.width, size.height, ortho]
    if (key.some((k, i) => framed.current[i] !== k)) {
      framed.current = key
      frames.current = 0
      return
    }
    if (frames.current < 0) return
    frames.current++
    if (frames.current === FRAME_AT) {
      const mesh = handle.rig.mesh
      handle.scene.updateMatrixWorld(true)
      let box: Box3
      if (focus) {
        const c = handle.rig.bone(focus.bone).getWorldPosition(new Vector3())
        c.y += focus.lift ?? 0
        box = new Box3().setFromCenterAndSize(c, new Vector3(focus.size, focus.size, focus.size))
      } else {
        mesh.skeleton.update()
        mesh.computeBoundingBox()
        box = new Box3().copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld)
        if (extras.current) box.union(new Box3().setFromObject(extras.current))
        box.min.y = Math.min(box.min.y, 0)
      }
      if (ortho) frameBoxOrtho(camera as OrthographicCamera, box, azimuth(view), size.width, size.height)
      else {
        const cam = camera as PerspectiveCamera
        cam.aspect = size.width / size.height
        if (focus) frameBox(cam, box, azimuth(view), 1, elevations[view])
        else frameFit(cam, framingPoints(handle, extras.current), azimuth(view), 1.07, elevations[view])
      }
    }
    if (frames.current === READY_AT) onFramed()
  })
  return null
}

export function FigureStage({ pose, view, variant, correctives, focus, highlight, pulse, atlas = 'on', ortho, dpr, extras, onReady }: FigureStageProps) {
  const [handle, setHandle] = useState<FigureHandle | null>(null)
  const extrasRef = useRef<Group>(null)
  const onFigureReady = useCallback((h: FigureHandle) => {
    if (import.meta.env.DEV) window.__figure = h
    setHandle(h)
  }, [])
  const onFramed = useCallback(() => onReady?.(), [onReady])
  return (
    <Canvas
      dpr={dpr ?? [1, 2]}
      orthographic={ortho}
      camera={ortho ? { position: [0, 1, 5] } : { fov: 24, position: [0, 1, 5] }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
        gl.toneMappingExposure = 1
      }}
    >
      <StudioEnvironment />
      <StudioLights azimuth={azimuth(view)} />
      <Suspense fallback={null}>
        <Figure pose={pose} variant={variant} correctives={correctives} highlight={highlight} pulse={pulse} atlas={atlas === 'on'} atlasFlat={atlas === 'flat'} onReady={onFigureReady} />
        <group ref={extrasRef}>{handle && extras?.(handle)}</group>
        {atlas !== 'flat' && <StudioFloor />}
      </Suspense>
      <Framing handle={handle} extras={extrasRef} pose={pose} view={view} focus={focus} ortho={ortho} onFramed={onFramed} />
    </Canvas>
  )
}

export default FigureStage
