// The office, drawn pixel by pixel into a 64 × 36 frame: a wall with a window that follows the hour, a clock, a
// board with a line per teammate at work, a door, the lead's dark desk and six wooden desks. The cube robots with
// their dark visor, orange eyes and trade accessories are a small-scale take on the robots of Le Bureau des agents
// (src/engine/robots.ts, MIT); everything here is drawn anew at this size.

import type { OfficeAgent, OfficeLead, OfficeRole } from '../types'
import { phaseOf, ROLES } from './model'
import { darken, Frame, lighten, P } from './pixels'

export const W = 64
export const H = 36

/** The top-left corner of each team desk (12 × 3). */
export const DESK_AT: readonly [number, number][] = [
  [2, 24],
  [26, 24],
  [50, 24],
  [2, 32],
  [26, 32],
  [50, 32],
]
const LEAD_DESK: [number, number] = [25, 17]
/** Where a teammate stands in the doorway, its sprite's top-left corner. */
const DOOR: [number, number] = [56, 4]

type Pose = 'idle' | 'type' | 'read' | 'think' | 'raise' | 'cheer' | 'walk'
type Eyes = 'open' | 'down' | 'up' | 'blink' | 'happy' | 'sad'

type Look = { top: number; front: number; shade: number; visor: number; body: number; bodyShade: number; arm: number; leg: number; tip: number }

function lookOf(role: OfficeRole): Look {
  if (role === 'lead') {
    return { top: 0x77718a, front: 0x4a4658, shade: 0x33303f, visor: 0x0b0910, body: 0x4a4658, bodyShade: 0x33303f, arm: 0x5a5569, leg: 0x2a2734, tip: P.orange }
  }
  const c = ROLES[role].color
  return { top: 0xffffff, front: 0xe8e5f1, shade: 0xc4bfd4, visor: 0x15121c, body: c, bodyShade: darken(c, 0.25), arm: 0xd7d3e2, leg: 0x3a3547, tip: c }
}

/** A cube robot, 7 × 8, its top-left corner at (x, y). */
function robot(f: Frame, x: number, y: number, role: OfficeRole, pose: Pose, eyes: Eyes, frame: number) {
  const L = lookOf(role)
  const bob = pose === 'type' && frame % 2 === 1 ? 1 : 0
  const hy = y + bob
  // antenna, head (a lit top, the face, a shaded chin) and the visor
  f.set(x + 3, hy, L.tip)
  f.rect(x + 1, hy + 1, 5, 1, L.top)
  f.rect(x + 1, hy + 2, 5, 2, L.front)
  f.rect(x + 1, hy + 4, 5, 1, L.shade)
  f.rect(x + 2, hy + 2, 3, 2, L.visor)
  const eye = eyes === 'happy' ? P.green : eyes === 'sad' ? P.red : P.orange
  if (eyes === 'blink') {
    f.set(x + 2, hy + 3, P.orangeDark)
    f.set(x + 4, hy + 3, P.orangeDark)
  } else {
    const ey = eyes === 'down' ? hy + 3 : hy + 2
    f.set(x + 2, ey, eye)
    f.set(x + 4, ey, eye)
  }
  // the trade's accessory
  switch (role) {
    case 'research': // an explorer's hat
      f.rect(x, hy + 1, 7, 1, 0xd6bd86)
      f.rect(x + 2, hy, 3, 1, 0xc7aa70)
      break
    case 'code': // headphones
      f.set(x, hy + 2, ROLES.code.color)
      f.set(x, hy + 3, darken(ROLES.code.color, 0.3))
      f.set(x + 6, hy + 2, ROLES.code.color)
      f.set(x + 6, hy + 3, darken(ROLES.code.color, 0.3))
      break
    case 'design': // a beret
      f.rect(x + 1, hy, 4, 1, ROLES.design.color)
      f.set(x + 5, hy + 1, darken(ROLES.design.color, 0.15))
      break
    case 'writing': // a pencil behind the ear
      f.set(x + 6, hy + 1, ROLES.analysis.color)
      f.set(x + 6, hy + 2, ROLES.writing.color)
      break
    case 'analysis': // glasses
      f.set(x + 1, hy + 2, ROLES.analysis.color)
      f.set(x + 5, hy + 2, ROLES.analysis.color)
      break
    default:
      break
  }
  // body and arms
  f.rect(x + 1, y + 5, 5, 1, L.body)
  f.rect(x + 2, y + 6, 3, 1, L.bodyShade)
  if (pose === 'raise') {
    f.set(x, y + 5, L.arm)
    f.rect(x + 6, y + 1, 1, 4, L.arm)
    f.set(x + 6, y, lighten(L.arm, 0.3))
  } else if (pose === 'cheer') {
    const up = frame % 2 === 0 ? 1 : 2
    f.rect(x, y + up, 1, 5 - up, L.arm)
    f.rect(x + 6, y + up, 1, 5 - up, L.arm)
  } else if (pose === 'type') {
    f.set(x, y + 5, L.arm)
    f.set(x + 6, y + 5, L.arm)
    f.set(frame % 2 ? x + 1 : x + 5, y + 6, L.arm)
  } else if (pose === 'read') {
    f.set(x, y + 5, L.arm)
    f.set(x + 6, y + 5, L.arm)
    f.rect(x + 2, y + 6, 3, 1, P.paper)
  } else {
    f.set(x, y + 5, L.arm)
    f.set(x + 6, y + 5, L.arm)
  }
  if (pose === 'think' && frame % 4 < 2) f.set(x + 6, y + 1, P.white)
  // legs: they swing while walking, the desk hides them otherwise
  if (pose === 'walk') {
    const s = frame % 2
    f.set(x + 2 - s, y + 7, L.leg)
    f.set(x + 4 + s, y + 7, L.leg)
  } else {
    f.set(x + 2, y + 7, L.leg)
    f.set(x + 4, y + 7, L.leg)
  }
}

function sky(hour: number): { glass: number; isNight: boolean } {
  if (hour >= 8 && hour < 17) return { glass: 0x7ec8f0, isNight: false }
  if ((hour >= 17 && hour < 20) || (hour >= 6 && hour < 8)) return { glass: 0xff9a5c, isNight: false }
  return { glass: 0x1b2140, isNight: true }
}

function room(f: Frame, hour: number, minute: number, isDoorOpen: boolean) {
  // the wall, its panel lines and the baseboard
  f.rect(0, 0, W, 1, P.wallTop)
  f.rect(0, 1, W, 10, P.wallFace)
  for (let x = 0; x < W; x += 16) f.rect(x, 1, 1, 10, P.wallLine)
  f.rect(0, 11, W, 1, P.baseboard)
  // the parquet: planks two pixels high, staggered seams
  for (let y = 12; y < H; y++) {
    const row = (y - 12) >> 1
    for (let x = 0; x < W; x++) {
      const seam = (y - 12) % 2 === 1 || (x + row * 4) % 10 === 0
      f.set(x, y, seam ? P.floorSeam : row % 2 ? P.floor1 : P.floor2)
    }
  }
  // the window, with the sky of the hour
  const s = sky(hour)
  f.rect(3, 2, 12, 7, P.woodDark)
  f.rect(4, 3, 10, 5, s.glass)
  f.rect(8, 3, 1, 5, P.woodDark)
  if (s.isNight) {
    for (const [x, y] of [[5, 4], [11, 3], [13, 6], [6, 6]] as const) f.set(x, y, P.white)
    f.set(12, 4, 0xf3e6a8)
  } else {
    f.set(hour < 12 ? 5 : 12, 4, 0xffe27a)
  }
  // the clock: its hand turns with the minutes
  f.rect(18, 2, 5, 5, P.metalDark)
  f.rect(19, 3, 3, 3, P.paper)
  f.set(20, 4, P.ink)
  const a = (minute / 60) * Math.PI * 2
  f.set(20 + Math.round(Math.sin(a)), 4 - Math.round(Math.cos(a)), P.ink)
  // the board (its lines are drawn with the team)
  f.rect(26, 2, 22, 7, P.metalDark)
  f.rect(27, 3, 20, 5, P.paper)
  // the door, open while someone walks through
  f.rect(55, 2, 8, 10, P.woodDark)
  f.rect(56, 3, 6, 9, isDoorOpen ? 0x0e0c14 : P.woodFront)
  if (!isDoorOpen) f.set(60, 7, P.orange)
  // a plant by the wall
  f.rect(20, 14, 3, 2, P.pot)
  f.rect(19, 11, 5, 3, P.leaf)
  f.set(21, 10, P.leafHi)
  f.set(19, 12, P.leafDark)
  f.set(23, 12, P.leafHi)
}

function desk(f: Frame, x: number, y: number, w: number, isLead: boolean, glow: number | null) {
  f.rect(x, y, w, 1, isLead ? P.ebonyHi : P.woodHi)
  f.rect(x, y + 1, w, 2, isLead ? P.ebonyFront : P.woodFront)
  // a laptop, its screen lit in the trade's colour while its owner works
  const lx = x + w - 4
  f.rect(lx, y - 2, 4, 2, P.tech)
  f.rect(lx + 1, y - 2, 2, 1, glow ?? P.screenOff)
}

export type SceneInput = {
  agents: readonly OfficeAgent[]
  lead: OfficeLead
  now: number
  frame: number
  hour: number
  minute: number
}

const poseOfAct = (kind: string | undefined): Pose =>
  kind === 'write' || kind === 'edit' || kind === 'bash' ? 'type' : kind === 'read' || kind === 'search' || kind === 'web' ? 'read' : kind === 'ask' ? 'raise' : 'think'

function eyesOf(pose: Pose, frame: number, seed: number): Eyes {
  if ((frame + seed) % 9 === 0) return 'blink'
  return pose === 'read' ? 'down' : pose === 'think' ? 'up' : 'open'
}

export function drawOffice(s: SceneInput): Frame {
  const f = new Frame(W, H)
  const placed = s.agents.map(a => ({ a, p: phaseOf(a, s.now) })).filter(x => x.a.desk >= 0 && x.p.at !== 'gone')
  room(f, s.hour, s.minute, placed.some(x => x.p.at === 'in' || x.p.at === 'out'))

  // the board: a line per teammate at work, longer with every tool call
  placed
    .filter(x => x.a.state === 'working')
    .slice(0, 4)
    .forEach((x, i) => f.rect(28, 4 + i, Math.max(2, Math.min(18, 2 + x.a.tools)), 1, ROLES[x.a.role].color))

  // the lead, behind its desk
  const leadPose: Pose = s.lead.state === 'waiting' ? 'raise' : s.lead.state === 'working' ? poseOfAct(s.lead.act?.kind) : 'idle'
  robot(f, LEAD_DESK[0] + 1, LEAD_DESK[1] - 6, 'lead', leadPose, s.lead.state === 'idle' ? (s.frame % 9 === 0 ? 'blink' : 'open') : eyesOf(leadPose, s.frame, 0), s.frame)
  desk(f, LEAD_DESK[0], LEAD_DESK[1], 14, true, s.lead.state === 'idle' ? null : P.orange)

  // the team: seated ones behind their desks, row by row; walkers on top
  const walkers: { x: number; y: number; a: OfficeAgent }[] = []
  for (const [d, [dx, dy]] of DESK_AT.entries()) {
    const here = placed.find(x => x.a.desk === d)
    const isSeated = here?.p.at === 'seated'
    if (here && isSeated) {
      const a = here.a
      const pose: Pose = a.state === 'done' ? 'cheer' : a.state === 'error' ? 'idle' : poseOfAct(a.act?.kind)
      const eyes: Eyes = a.state === 'done' ? 'happy' : a.state === 'error' ? 'sad' : eyesOf(pose, s.frame, d + 1)
      robot(f, dx + 1, dy - 6, a.role, pose, eyes, s.frame)
    }
    const glow = here && isSeated && here.a.state === 'working' ? ROLES[here.a.role].color : null
    desk(f, dx, dy, 12, false, glow)
    if (here && !isSeated) {
      // from the doorway to the seat while walking in, and back while walking out
      const t = here.p.at === 'in' ? here.p.t : 1 - here.p.t
      walkers.push({ x: DOOR[0] + (dx + 1 - DOOR[0]) * t, y: DOOR[1] + (dy - 6 - DOOR[1]) * t, a: here.a })
    }
  }
  walkers.sort((p, q) => p.y - q.y)
  for (const w of walkers) robot(f, w.x, w.y, w.a.role, 'walk', w.a.state === 'done' ? 'happy' : 'open', s.frame)
  return f
}

