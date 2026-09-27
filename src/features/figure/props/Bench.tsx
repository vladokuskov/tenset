import { useEffect, useMemo } from 'react'
import { BoxGeometry, CylinderGeometry, Quaternion, Vector3, type Material } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { propMaterials } from './materials'
import { BENCH, benchDefaults, benchSockets, type BenchParams } from './sockets'

const SEAT = BENCH.seat
const BACK = BENCH.back
const RAIL_Y = BENCH.railY
const FRONT_Z = BENCH.frontZ
const REAR_Z = BENCH.rearZ

const UP = new Vector3(0, 1, 0)

function Tube({ from, to, size, material }: { from: Vector3; to: Vector3; size: [number, number]; material: Material }) {
  const [w, h] = size
  const len = from.distanceTo(to)
  const geo = useMemo(() => new RoundedBoxGeometry(w, len, h, 2, Math.min(w, h) * 0.2), [w, h, len])
  useEffect(() => () => geo.dispose(), [geo])
  const q = new Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize())
  return <mesh geometry={geo} material={material} position={from.clone().lerp(to, 0.5)} quaternion={q} />
}

export function Bench(props: BenchParams) {
  const o = { ...benchDefaults, ...props }
  const mats = propMaterials()
  const s = benchSockets(o)
  const geo = useMemo(() => ({
    seat: new RoundedBoxGeometry(SEAT.width, SEAT.thick, SEAT.len, 4, 0.022),
    back: new RoundedBoxGeometry(BACK.width, BACK.thick, BACK.len, 4, 0.022),
    board: new BoxGeometry(1, 1, 1),
    cap: new RoundedBoxGeometry(0.07, 0.035, 0.06, 2, 0.012),
    pin: new CylinderGeometry(0.012, 0.012, 0.09, 16),
  }), [])
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])

  const b = (o.back * Math.PI) / 180
  const seatTilt = (o.seat * Math.PI) / 180
  const hinge = s.hinge
  const along = s.back.along
  const normal = s.back.normal
  const backCentre = hinge.clone().addScaledVector(along, BACK.len / 2 + 0.01).addScaledVector(normal, BACK.thick / 2)
  const backBoard = hinge.clone().addScaledVector(along, BACK.len / 2 + 0.01).addScaledVector(normal, -0.012)
  // strut from the rail up to the back's underside, a third of the way along the pad
  const strutTop = hinge.clone().addScaledVector(along, Math.min(0.5, 0.18 + 0.3 * Math.max(0, Math.sin(b)))).addScaledVector(normal, -0.03)
  const railFront = new Vector3(0, RAIL_Y, FRONT_Z - 0.04)
  const railRear = new Vector3(0, RAIL_Y, REAR_Z + 0.04)
  const strutFoot = new Vector3(0, RAIL_Y + 0.03, Math.max(REAR_Z + 0.12, strutTop.z - 0.22 * Math.cos(b) - 0.05))
  const post = new Vector3(0, o.height - SEAT.thick - 0.03, 0.02)
  const tube: [number, number] = [0.07, 0.05]
  return (
    <group>
      {/* stabilisers with rubber feet */}
      {[FRONT_Z, REAR_Z].map((z) => (
        <group key={z}>
          <Tube from={new Vector3(-0.24, 0.035, z)} to={new Vector3(0.24, 0.035, z)} size={[0.07, 0.05]} material={mats.frame} />
          {[-1, 1].map((x) => <mesh key={x} geometry={geo.cap} material={mats.rubber} position={[x * 0.25, 0.017, z]} />)}
        </group>
      ))}
      {/* spine rail rising from both stabilisers */}
      <Tube from={new Vector3(0, 0.05, FRONT_Z)} to={railFront} size={tube} material={mats.frame} />
      <Tube from={new Vector3(0, 0.05, REAR_Z)} to={railRear} size={tube} material={mats.frame} />
      <Tube from={railFront} to={railRear} size={[0.08, 0.06]} material={mats.frame} />
      {/* seat post and back strut */}
      <Tube from={new Vector3(0, RAIL_Y, 0.04)} to={post} size={tube} material={mats.frame} />
      <Tube from={strutFoot} to={strutTop} size={[0.06, 0.045]} material={mats.frame} />
      <mesh geometry={geo.pin} material={mats.frameDark} position={strutFoot.clone().add(new Vector3(0, 0.02, 0))} rotation-z={Math.PI / 2} />
      {/* seat */}
      <group position={[0, o.height - SEAT.thick / 2, 0]} rotation-x={-seatTilt}>
        <mesh geometry={geo.seat} material={mats.pad} />
        <mesh geometry={geo.board} material={mats.frameDark} scale={[SEAT.width - 0.04, 0.012, SEAT.len - 0.04]} position-y={-SEAT.thick / 2 - 0.006} />
      </group>
      {/* back pad */}
      <group position={backCentre} rotation-x={b}>
        <mesh geometry={geo.back} material={mats.pad} />
      </group>
      <group position={backBoard} rotation-x={b}>
        <mesh geometry={geo.board} material={mats.frameDark} scale={[BACK.width - 0.05, 0.012, BACK.len - 0.06]} />
      </group>
    </group>
  )
}
