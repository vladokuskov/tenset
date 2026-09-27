import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { Box3, NeutralToneMapping, Vector3, type PerspectiveCamera } from 'three'
import { ContactShadow } from '../ContactShadow'
import { Figure } from '../Figure'
import { StudioEnvironment, StudioLights } from '../Studio'
import { azimuth, elevations, frameFit, isViewName, type ViewName } from '../views'
import { galleryNames, galleryScene, type MarkerKind } from './scenes'
import { piecesBox, piecesCorners } from './kit'
import { PropModel } from './PropModel'

const MARKER: Record<MarkerKind, string> = { grip: '#e0402a', surface: '#2a7de0', cable: '#1f9d55' }

// a relaxed standing figure, for framing before its mesh is measured
const FIGURE_BOX = new Box3(new Vector3(-0.3, 0, -0.16), new Vector3(0.3, 1.82, 0.16))

const FRAME_AT = 2
const READY_AT = 8

function Framing({ points, view, wait, onReady }: { points: number[]; view: ViewName; wait: boolean; onReady: () => void }) {
  const frames = useRef(0)
  const key = useRef('')
  useFrame((state) => {
    const camera = state.camera as PerspectiveCamera
    const size = state.size
    const k = `${size.width}x${size.height}|${view}|${points.length}|${wait}`
    if (k !== key.current) {
      key.current = k
      frames.current = 0
    }
    if (wait) return
    frames.current++
    if (frames.current === FRAME_AT) {
      camera.aspect = size.width / size.height
      frameFit(camera, points, azimuth(view), 1.05, elevations[view])
    }
    if (frames.current === READY_AT) onReady()
  })
  return null
}

/** Dev gallery of the props library: ?scene=props (all) or ?scene=props-<name>; hl=sockets marks the sockets. */
export default function PropsGallery({ name, view: viewArg, hl }: { name: string; view?: string; hl?: string }) {
  const scene = useMemo(() => galleryScene(name), [name])
  const [figureReady, setFigureReady] = useState(false)
  const onFigure = useCallback(() => setFigureReady(true), [])
  const onReady = useCallback(() => {
    window.__ready = true
  }, [])
  const layout = useMemo(() => {
    if (!scene) return null
    const box = piecesBox(scene.pieces)
    const pts = piecesCorners(scene.pieces)
    if (scene.figure) {
      const fb = FIGURE_BOX.clone().translate(new Vector3(...scene.figure.at))
      box.union(fb)
      for (let k = 0; k < 8; k++) pts.push(k & 1 ? fb.max.x : fb.min.x, k & 2 ? fb.max.y : fb.min.y, k & 4 ? fb.max.z : fb.min.z)
    }
    const c = box.getCenter(new Vector3())
    const shift = new Vector3(-c.x, 0, -c.z)
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] += shift.x
      pts[i + 2] += shift.z
    }
    // the soft shadow reaches a few centimetres past whatever stands on the floor
    const n = pts.length
    for (let i = 0; i < n; i += 3) if (pts[i + 1] < 0.03) pts.push(pts[i] - 0.04, 0, pts[i + 2] - 0.04, pts[i] + 0.04, 0, pts[i + 2] + 0.04)
    const extent = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    return { shift, pts, shadow: extent + 0.8 }
  }, [scene])

  if (!scene || !layout) {
    return <pre className="p-4 text-sm">{`unknown props scene: ${name}\nscenes: ${galleryNames.join(', ')}`}</pre>
  }
  const view: ViewName = isViewName(viewArg) ? viewArg : scene.view ?? 'hero'
  return (
    <div className="fixed inset-0" style={{ background: '#ffffff' }}>
      <Canvas
        dpr={Math.min(window.devicePixelRatio || 1, 3)}
        camera={{ fov: 24, position: [0, 1, 6] }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = NeutralToneMapping
          gl.toneMappingExposure = 1
        }}
      >
        <StudioEnvironment />
        <StudioLights azimuth={azimuth(view)} />
        <group position={layout.shift}>
          <PropModel pieces={scene.pieces} />
          {scene.figure && (
            <Suspense fallback={null}>
              <group position={scene.figure.at} rotation-y={scene.figure.rotY ?? 0}>
                <Figure pose="relaxed" onReady={onFigure} />
              </group>
            </Suspense>
          )}
          {hl === 'sockets' && scene.markers.map((m, i) => (
            <mesh key={i} position={m.pos} renderOrder={10}>
              <sphereGeometry args={[0.018, 16, 12]} />
              <meshBasicMaterial color={MARKER[m.kind]} depthTest={false} transparent opacity={0.9} />
            </mesh>
          ))}
        </group>
        <ContactShadow size={layout.shadow} resolution={layout.shadow > 4 ? 1024 : 512} far={0.8} blur={2.2} opacity={0.62} color="#2b2b2d" />
        <Framing points={layout.pts} view={view} wait={!!scene.figure && !figureReady} onReady={onReady} />
      </Canvas>
    </div>
  )
}
