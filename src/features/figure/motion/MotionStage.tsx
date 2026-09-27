import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { NeutralToneMapping, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { Baked, CompactMotion } from '../../../motion/bake.ts'
import { ContactShadow } from '../ContactShadow'
import { Figure, type FigureHandle } from '../Figure'
import { StudioEnvironment, StudioLights } from '../Studio'
import { frameFit } from '../views'
import { MotionClock } from './clock'
import { composeMotion, viewPresets, type CameraPreset, type MotionExercise, type MotionScene, type ViewPreset } from './compose'
import { MotionProps, type MotionPropsHandle } from './MotionProps'
import { MotionRuntime } from './runtime'
import { motionSkeleton } from './skeleton'

export type MotionStageProps = {
  exercise: MotionExercise
  motion: CompactMotion | Baked
  clock: MotionClock
  view: ViewPreset
  /** extra turn about the vertical axis on top of the view preset, degrees (horizontal drag) */
  yaw?: number
  /** jump to the camera target instead of easing (baking, tests) */
  snap?: boolean
  /** QA close-up: frame a cube of `size` metres around a bone instead of the whole scene */
  focus?: { bone: string; size: number }
  dpr?: number | [number, number]
  onReady?: (scene: MotionScene) => void
}

const DEG = Math.PI / 180
const READY_AT = 6
const MARGIN = 1.05

function cameraFor(scene: MotionScene, view: ViewPreset, yaw: number): CameraPreset {
  const base = view === 'hero' ? scene.hero : viewPresets[view]
  return { az: base.az + yaw, elev: base.elev }
}

function Driver({ scene, figure, clock, target, snap, focus, onReady }: {
  scene: MotionScene
  figure: FigureHandle
  clock: MotionClock
  target: CameraPreset
  snap: boolean
  focus?: MotionStageProps['focus']
  onReady: () => void
}) {
  const runtime = useMemo(() => new MotionRuntime(scene, motionSkeleton(), figure), [scene, figure])
  const props = useRef<MotionPropsHandle>(null)
  const lights = useRef<Group>(null)
  const view = useRef<CameraPreset | null>(null)
  const fitted = useRef('')
  const frames = useRef(0)

  useFrame((state, dt) => {
    const camera = state.camera as PerspectiveCamera
    const size = state.size
    clock.tick(Math.min(dt, 0.1), scene.baked.duration)
    const poses = runtime.update(clock.phase, clock.pulse)
    props.current?.update(poses)
    // ease the camera towards the preset, the long way round never
    const v = view.current
    if (!v || snap) view.current = { ...target }
    else {
      const d = ((((target.az - v.az) % 360) + 540) % 360) - 180
      const k = 1 - Math.exp(-dt * 10)
      v.az += Math.abs(d) < 0.05 ? d : d * k
      v.elev += (target.elev - v.elev) * k
    }
    const cur = view.current!
    let points = scene.frame
    let key = `${cur.az.toFixed(3)}|${cur.elev.toFixed(4)}|${size.width}x${size.height}`
    if (focus) {
      const c = figure.rig.bone(focus.bone).getWorldPosition(new Vector3())
      const h = focus.size / 2
      points = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => [c.x + (k & 1 ? h : -h), c.y + (k & 2 ? h : -h), c.z + (k & 4 ? h : -h)])
      key += `|${c.toArray().map((x) => x.toFixed(4)).join(',')}`
    }
    if (key !== fitted.current) {
      fitted.current = key
      camera.aspect = size.width / size.height
      frameFit(camera, points, cur.az * DEG, focus ? 1 : MARGIN, cur.elev)
      if (lights.current) lights.current.rotation.y = cur.az * DEG
    }
    if (frames.current <= READY_AT && ++frames.current === READY_AT) onReady()
  }, -1)

  return (
    <>
      <group ref={lights}>
        <StudioLights />
      </group>
      <MotionProps ref={props} props={scene.props} />
    </>
  )
}

/** Live exercise figure: the baked loop on the figure with its props, framed by the exercise's camera. */
export default function MotionStage({ exercise, motion, clock, view, yaw = 0, snap = false, focus, dpr, onReady }: MotionStageProps) {
  const scene = useMemo(() => composeMotion(exercise, motion, motionSkeleton()), [exercise, motion])
  const [figure, setFigure] = useState<FigureHandle | null>(null)
  const target = cameraFor(scene, view, yaw)
  const ready = useCallback(() => onReady?.(scene), [onReady, scene])
  const floor = Math.ceil(scene.floor * 10) / 10
  return (
    <Canvas
      dpr={dpr ?? [1, 2]}
      camera={{ fov: 24, position: [0, 1, 5] }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
        gl.toneMappingExposure = 1
      }}
    >
      <StudioEnvironment />
      <Suspense fallback={null}>
        <Figure highlight={scene.highlight} onReady={setFigure} />
        {figure && <Driver scene={scene} figure={figure} clock={clock} target={target} snap={snap} focus={focus} onReady={ready} />}
        <ContactShadow size={floor * 2} resolution={floor > 2 ? 1024 : 512} far={0.8} blur={2.2} opacity={0.62} color="#2b2b2d" />
      </Suspense>
    </Canvas>
  )
}
