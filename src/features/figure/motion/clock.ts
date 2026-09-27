/** Playback state shared by the stage (which advances it every frame) and the controls (which read and set it). */
export class MotionClock {
  /** loop fraction 0..1 */
  phase: number
  playing: boolean
  speed = 1
  /** concentric pulse in the highlighted muscles */
  pulse = true

  constructor(phase = 0, playing = true, pulse = true) {
    this.phase = phase
    this.playing = playing
    this.pulse = pulse
  }

  /** advance by dt seconds of a loop lasting `duration` seconds */
  tick(dt: number, duration: number) {
    if (!this.playing) return
    const u = this.phase + (dt * this.speed) / Math.max(0.1, duration)
    this.phase = u - Math.floor(u)
  }

  play(on: boolean) {
    this.playing = on
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  seek(phase: number) {
    this.phase = phase - Math.floor(phase)
  }
}
