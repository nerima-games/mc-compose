import { blockIdOf, blockPosition, type BlockId, type BlockPosition } from '@nerima-games/mc-kernel'

type Cell = BlockPosition
type Pose = { readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }; readonly yawRadians: number; readonly pitchRadians: number }

export const FARMLAND_BLOCK_ID: BlockId = blockIdOf('farmland')
export const POTATO_CROP_BLOCK_ID: BlockId = blockIdOf('potato_crop')
export const OBSIDIAN_BLOCK_ID: BlockId = blockIdOf('obsidian')
export const NETHER_PORTAL_BLOCK_ID: BlockId = blockIdOf('nether_portal')

export const KNOWN_TARGET_BLOCK: Cell = blockPosition(8, 63, 8)
export const QA_FARM_CROP_BLOCK: Cell = blockPosition(8, 64, 8)
export const QA_IGNITION_HIT_BLOCK: Cell = blockPosition(8, 66, 8)
export const QA_IGNITION_CELL: Cell = blockPosition(8, 66, 9)
export const QA_IGNITION_SUPPORT_BLOCK: Cell = blockPosition(8, 65, 9)
export const QA_IGNITION_FLOOR_BLOCK: Cell = blockPosition(8, 64, 10)
export const QA_PISTON: Cell = blockPosition(8, 66, 8)
export const QA_PISTON_LEVER: Cell = blockPosition(8, 66, 9)
export const QA_PISTON_NEAR: Cell = blockPosition(8, 66, 7)
export const QA_PISTON_FAR: Cell = blockPosition(8, 66, 6)
export const QA_REDSTONE_BUTTON: Cell = blockPosition(8, 66, 9)
export const QA_REDSTONE_REPEATER: Cell = blockPosition(8, 66, 8)
export const QA_REDSTONE_LAMP: Cell = blockPosition(8, 66, 7)
export const QA_REDSTONE_BRANCH_BUTTON: Cell = blockPosition(12, 66, 9)
export const QA_REDSTONE_BRANCH_WIRE: Cell = blockPosition(12, 66, 8)
export const QA_REDSTONE_DOOR: Cell = blockPosition(11, 66, 8)
export const QA_REDSTONE_RAIL: Cell = blockPosition(13, 66, 8)
export const QA_REDSTONE_DISPENSER: Cell = blockPosition(12, 67, 8)
export const QA_REDSTONE_HOPPER: Cell = blockPosition(12, 65, 8)
export const QA_REDSTONE_OBSERVER: Cell = blockPosition(16, 66, 8)
export const QA_REDSTONE_OBSERVER_INPUT: Cell = blockPosition(16, 66, 9)
export const QA_REDSTONE_OBSERVER_LAMP: Cell = blockPosition(16, 66, 7)
export const QA_REDSTONE_COMPARATOR: Cell = blockPosition(20, 66, 8)
// Own lane at spawn's own z=10 row, walkable from QA_IGNITION_POSE by real
// movement input — every other redstone fixture sits at z=7-9, targeted by
// raycast rather than walked onto, so this lane avoids them entirely.
//
// The plate sits ON TOP of its own floor tile, one cell above the z=11/12
// wire and lamp's floor — the real arrangement, not the walkway-flush stand-in
// this used to be. main.ts's `simPhysicsConfig` now resolves each block's
// actual registry collisionShape (the real ~1/16-tall plate box mc-physics
// itself models), so a plate raised a block above the approach floor is
// walkable rather than a solid wall. The wire and lamp move up in lockstep so
// the circuit's relative shape — and its support, each on its own explicit
// floor tile rather than on assumed ambient terrain — is unchanged from what
// already passes.
export const QA_REDSTONE_PLATE_FLOOR: ReadonlyArray<Cell> = [
  blockPosition(9, 64, 10),
  blockPosition(10, 64, 10),
  blockPosition(11, 64, 10),
  blockPosition(10, 64, 11),
  blockPosition(10, 64, 12),
]
export const QA_REDSTONE_PLATE: Cell = blockPosition(10, 65, 10)
export const QA_REDSTONE_PLATE_WIRE: Cell = blockPosition(10, 65, 11)
export const QA_REDSTONE_PLATE_LAMP: Cell = blockPosition(10, 65, 12)

export const QA_ENVIRONMENT_OVERLAP_POSE = {
  feetPosition: { x: 24.95, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
export const QA_CACTUS_APPROACH_POSE = {
  feetPosition: { x: 24.2, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
export const QA_ENVIRONMENT_CONTACT_CELLS: readonly [Cell, Cell] = [
  blockPosition(24, 65, 8),
  blockPosition(25, 65, 8),
]
export const QA_ENVIRONMENT_FLOOR_CELLS: ReadonlyArray<Cell> = Array.from({ length: 4 }, (_, offset) =>
  blockPosition(23 + offset, 64, 8),
)
export const QA_FALL_CENTER = { x: 28, z: 8 } as const
export const QA_FALL_FLOOR_Y = 64
export const QA_FALL_START_Y = {
  safe: 67.5,
  damaging: 72,
  lethal: 88,
} as const

export const QA_PORTAL_ANCHOR: Cell = blockPosition(120, 65, 8)
export const QA_PORTAL_POSE = {
  feetPosition: { x: 120.5, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
export const QA_PORTAL_LAYOUT: { readonly frame: ReadonlyArray<Cell>; readonly interior: ReadonlyArray<Cell> } = {
  frame: [
    ...Array.from({ length: 4 }, (_, offset) => blockPosition(119 + offset, 64, 8)),
    ...Array.from({ length: 4 }, (_, offset) => blockPosition(119 + offset, 68, 8)),
    ...Array.from({ length: 3 }, (_, offset) => blockPosition(119, 65 + offset, 8)),
    ...Array.from({ length: 3 }, (_, offset) => blockPosition(122, 65 + offset, 8)),
  ],
  interior: Array.from({ length: 6 }, (_, index) =>
    blockPosition(120 + (index % 2), 65 + Math.floor(index / 2), 8),
  ),
}
export const QA_IGNITION_PORTAL_LAYOUT: { readonly frame: ReadonlyArray<Cell>; readonly interior: ReadonlyArray<Cell> } = {
  frame: [
    ...Array.from({ length: 4 }, (_, offset) => blockPosition(7 + offset, 65, 9)),
    ...Array.from({ length: 4 }, (_, offset) => blockPosition(7 + offset, 69, 9)),
    ...Array.from({ length: 3 }, (_, offset) => blockPosition(7, 66 + offset, 9)),
    ...Array.from({ length: 3 }, (_, offset) => blockPosition(10, 66 + offset, 9)),
  ],
  interior: Array.from({ length: 6 }, (_, index) =>
    blockPosition(8 + (index % 2), 66 + Math.floor(index / 2), 9),
  ),
}

export const REDSTONE_PLACEMENT_ITEMS: ReadonlySet<string> = new Set([
  'redstone_dust',
  'redstone_torch',
  'lever',
  'stone_button',
  'repeater',
  'redstone_lamp',
  'observer',
  'comparator',
  'dispenser',
  'dropper',
  'hopper',
  'piston',
  'powered_rail',
  'door',
  'pressure_plate',
])

export const QA_POSE: Pose = {
  feetPosition: { x: 8.5, y: 64.5, z: 8.5 },
  yawRadians: 0,
  pitchRadians: -Math.PI / 2 + 0.01,
}
export const QA_FARM_POSE: Pose = {
  feetPosition: { x: 8.5, y: 65.5, z: 8.5 },
  yawRadians: 0,
  pitchRadians: -Math.PI / 2 + 0.01,
}
export const QA_IGNITION_POSE = {
  feetPosition: { x: 8.5, y: 65, z: 10.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
