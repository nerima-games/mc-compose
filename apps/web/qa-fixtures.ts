export const FARMLAND_BLOCK_ID = 49
export const POTATO_CROP_BLOCK_ID = 72
export const OBSIDIAN_BLOCK_ID = 40
export const NETHER_PORTAL_BLOCK_ID = 118

export const KNOWN_TARGET_BLOCK = { x: 8, y: 63, z: 8 } as const
export const QA_FARM_CROP_BLOCK = { x: 8, y: 64, z: 8 } as const
export const QA_IGNITION_HIT_BLOCK = { x: 8, y: 66, z: 8 } as const
export const QA_IGNITION_CELL = { x: 8, y: 66, z: 9 } as const
export const QA_IGNITION_SUPPORT_BLOCK = { x: 8, y: 65, z: 9 } as const
export const QA_IGNITION_FLOOR_BLOCK = { x: 8, y: 64, z: 10 } as const
export const QA_PISTON = { x: 8, y: 66, z: 8 } as const
export const QA_PISTON_LEVER = { x: 8, y: 66, z: 9 } as const
export const QA_PISTON_NEAR = { x: 8, y: 66, z: 7 } as const
export const QA_PISTON_FAR = { x: 8, y: 66, z: 6 } as const
export const QA_REDSTONE_BUTTON = { x: 8, y: 66, z: 9 } as const
export const QA_REDSTONE_REPEATER = { x: 8, y: 66, z: 8 } as const
export const QA_REDSTONE_LAMP = { x: 8, y: 66, z: 7 } as const
export const QA_REDSTONE_BRANCH_BUTTON = { x: 12, y: 66, z: 9 } as const
export const QA_REDSTONE_BRANCH_WIRE = { x: 12, y: 66, z: 8 } as const
export const QA_REDSTONE_DOOR = { x: 11, y: 66, z: 8 } as const
export const QA_REDSTONE_RAIL = { x: 13, y: 66, z: 8 } as const
export const QA_REDSTONE_DISPENSER = { x: 12, y: 67, z: 8 } as const
export const QA_REDSTONE_HOPPER = { x: 12, y: 65, z: 8 } as const
export const QA_REDSTONE_OBSERVER = { x: 16, y: 66, z: 8 } as const
export const QA_REDSTONE_OBSERVER_INPUT = { x: 16, y: 66, z: 9 } as const
export const QA_REDSTONE_OBSERVER_LAMP = { x: 16, y: 66, z: 7 } as const
export const QA_REDSTONE_COMPARATOR = { x: 20, y: 66, z: 8 } as const

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
export const QA_ENVIRONMENT_CONTACT_CELLS = [
  { x: 24, y: 65, z: 8 },
  { x: 25, y: 65, z: 8 },
] as const
export const QA_ENVIRONMENT_FLOOR_CELLS = Array.from({ length: 4 }, (_, offset) => ({
  x: 23 + offset,
  y: 64,
  z: 8,
}))
export const QA_FALL_CENTER = { x: 28, z: 8 } as const
export const QA_FALL_FLOOR_Y = 64
export const QA_FALL_START_Y = {
  safe: 67.5,
  damaging: 72,
  lethal: 88,
} as const

export const QA_PORTAL_ANCHOR = { x: 120, y: 65, z: 8 } as const
export const QA_PORTAL_POSE = {
  feetPosition: { x: 120.5, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
export const QA_PORTAL_LAYOUT = {
  frame: [
    ...Array.from({ length: 4 }, (_, offset) => ({ x: 119 + offset, y: 64, z: 8 })),
    ...Array.from({ length: 4 }, (_, offset) => ({ x: 119 + offset, y: 68, z: 8 })),
    ...Array.from({ length: 3 }, (_, offset) => ({ x: 119, y: 65 + offset, z: 8 })),
    ...Array.from({ length: 3 }, (_, offset) => ({ x: 122, y: 65 + offset, z: 8 })),
  ],
  interior: Array.from({ length: 6 }, (_, index) => ({
    x: 120 + (index % 2),
    y: 65 + Math.floor(index / 2),
    z: 8,
  })),
} as const
export const QA_IGNITION_PORTAL_LAYOUT = {
  frame: [
    ...Array.from({ length: 4 }, (_, offset) => ({ x: 7 + offset, y: 65, z: 9 })),
    ...Array.from({ length: 4 }, (_, offset) => ({ x: 7 + offset, y: 69, z: 9 })),
    ...Array.from({ length: 3 }, (_, offset) => ({ x: 7, y: 66 + offset, z: 9 })),
    ...Array.from({ length: 3 }, (_, offset) => ({ x: 10, y: 66 + offset, z: 9 })),
  ],
  interior: Array.from({ length: 6 }, (_, index) => ({
    x: 8 + (index % 2),
    y: 66 + Math.floor(index / 2),
    z: 9,
  })),
} as const

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
])

export const QA_POSE = {
  feetPosition: { x: 8.5, y: 64.5, z: 8.5 },
  yawRadians: 0,
  pitchRadians: -Math.PI / 2 + 0.01,
} as const
export const QA_FARM_POSE = {
  feetPosition: { x: 8.5, y: 65.5, z: 8.5 },
  yawRadians: 0,
  pitchRadians: -Math.PI / 2 + 0.01,
} as const
export const QA_IGNITION_POSE = {
  feetPosition: { x: 8.5, y: 65, z: 10.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
