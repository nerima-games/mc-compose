import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(new URL('../apps/web/main.ts', import.meta.url), 'utf8')
const frameInputSource = readFileSync(new URL('../apps/web/tick/frame-input.ts', import.meta.url), 'utf8')
const postFrameGameplayPath = new URL('../apps/web/tick/post-frame-gameplay.ts', import.meta.url)
const postFrameGameplaySource = existsSync(postFrameGameplayPath)
  ? readFileSync(postFrameGameplayPath, 'utf8')
  : mainSource

const positionOf = (source: string, marker: string, fromIndex = 0): number => {
  const position = source.indexOf(marker, fromIndex)
  expect(position, `expected source to contain ${marker}`).toBeGreaterThanOrEqual(0)
  return position
}

describe('H4b main.ts wiring', () => {
  it('connects the main-owned inventory state and commands before installing listeners and starting tick', () => {
    const clientContextStart = positionOf(mainSource, 'const multiplayerClientContext: MultiplayerClientContext = {')
    const clientCreation = positionOf(mainSource, '} = createMultiplayerClient(multiplayerClientContext)')
    const runtimeCreation = positionOf(mainSource, 'const inventoryRuntime = createPlayerUiRuntime({')
    const runtimeDestructure = positionOf(mainSource, '} = inventoryRuntime')
    const listenerInstallation = positionOf(mainSource, 'installInventoryListeners()')
    const pauseInstallation = positionOf(mainSource, 'const handlePauseRequest = installPauseControls({')
    const tickStart = positionOf(mainSource, 'const tick = (() => {')

    expect(clientCreation).toBeLessThan(runtimeCreation)
    expect(runtimeCreation).toBeLessThan(runtimeDestructure)
    expect(runtimeDestructure).toBeLessThan(listenerInstallation)
    expect(listenerInstallation).toBeLessThan(pauseInstallation)
    expect(pauseInstallation).toBeLessThan(tickStart)

    const multiplayerClientContext = mainSource.slice(clientContextStart, clientCreation)
    for (const [field, variable] of [
      ['inventoryOpen', 'inventoryOpen'],
      ['inventoryMode', 'inventoryMode'],
      ['activeFurnaceKey', 'activeFurnaceKey'],
      ['activeChestId', 'activeChestId'],
      ['selectedHotbarIndex', 'selectedHotbarIndex'],
      ['multiplayerInventorySelection', 'multiplayerInventorySelection'],
    ] as const) {
      expect(multiplayerClientContext).toContain(`get ${field}() { return ${variable} }`)
      expect(multiplayerClientContext).toContain(`set ${field}(value) { ${variable} = value }`)
    }
    expect(multiplayerClientContext).toContain('multiplayerChat,')
    expect(multiplayerClientContext).toContain('multiplayerChatForm,')
    expect(multiplayerClientContext).toContain('multiplayerChatInput,')
    expect(multiplayerClientContext).toContain('get multiplayerHandshakeComplete() { return multiplayerHandshakeComplete }')

    const runtimeSetup = mainSource.slice(runtimeCreation, runtimeDestructure)
    for (const callback of [
      'getInventoryOpen: () => inventoryOpen,',
      'setInventoryOpenState: (open) => { inventoryOpen = open },',
      'getInventoryMode: () => inventoryMode,',
      'setInventoryMode: (mode) => { inventoryMode = mode },',
      'getSelectedHotbarIndex: () => selectedHotbarIndex,',
      'getActiveChestId: () => activeChestId,',
      'setActiveChestId: (id) => { activeChestId = id },',
      'getActiveFurnaceKey: () => activeFurnaceKey,',
      'getMultiplayerInventorySelection: () => multiplayerInventorySelection,',
      'setMultiplayerInventorySelection: (selection) => { multiplayerInventorySelection = selection },',
    ]) {
      expect(runtimeSetup).toContain(callback)
    }
    expect(runtimeSetup).toContain('sendInventoryCommand,')
    expect(runtimeSetup).toContain('requestCrafting,')
    expect(runtimeSetup).toContain('sendFacilityCommand,')
  })

  it('keeps inventory input gated before calling the extracted runtime', () => {
    const tickStart = positionOf(frameInputSource, 'export const runTickFrameInput = (')
    const tickInput = frameInputSource.slice(
      tickStart,
      positionOf(frameInputSource, 'if (!dead && !state.inventoryOpen.get() && !state.tradeOpen.get())', tickStart),
    )
    const deadGate = positionOf(tickInput, '!dead &&')
    const bowGate = positionOf(tickInput, '!context.bowInteractionLocked()')
    const openInput = positionOf(tickInput, "wasActionJustTriggered('openInventory')")
    const runtimeCall = positionOf(tickInput, "context.setInventoryOpen(!state.inventoryOpen.get(), 'player')")

    expect(deadGate).toBeLessThan(bowGate)
    expect(bowGate).toBeLessThan(openInput)
    expect(openInput).toBeLessThan(runtimeCall)
  })

  it('preserves workstation setup and container command ordering before opening each screen', () => {
    const crafting = positionOf(postFrameGameplaySource, "route?.kind === 'craftingTable'")
    const craftingOpen = positionOf(postFrameGameplaySource, "setInventoryOpen(true, 'craftingTable')")
    expect(crafting).toBeLessThan(craftingOpen)

    const furnaceStart = positionOf(postFrameGameplaySource, "route?.kind === 'furnace'")
    const furnaceEnd = positionOf(postFrameGameplaySource, "route?.kind === 'storage'", furnaceStart)
    const furnaceRoute = postFrameGameplaySource.slice(furnaceStart, furnaceEnd)
    const activeFurnaceUpdate = furnaceRoute.includes('h5bState.activeFurnaceKey.set(key)')
      ? 'h5bState.activeFurnaceKey.set(key)'
      : 'activeFurnaceKey = key'
    expect(positionOf(furnaceRoute, 'furnaceStates.set(key,')).toBeLessThan(
      positionOf(furnaceRoute, activeFurnaceUpdate),
    )
    expect(positionOf(furnaceRoute, activeFurnaceUpdate)).toBeLessThan(
      positionOf(furnaceRoute, "setInventoryOpen(true, 'furnace')"),
    )

    const storageRoute = postFrameGameplaySource.slice(
      furnaceEnd,
      positionOf(postFrameGameplaySource, 'const inventoryBeforeUse', furnaceEnd),
    )
    const containerCommandStart = positionOf(storageRoute, 'if (container !== undefined && sendFacilityCommand({')
    const containerCommandOpen = positionOf(storageRoute, "action: { _tag: 'open' }")
    const containerCommandEnd = positionOf(storageRoute, '})) {', containerCommandOpen)
    expect(storageRoute).toContain("_tag: 'ContainerCommand'")
    expect(storageRoute).toContain('containerId: id,')
    expect(containerCommandStart).toBeLessThan(containerCommandOpen)
    const activeChestUpdate = storageRoute.includes('h5bState.activeChestId.set(id)')
      ? 'h5bState.activeChestId.set(id)'
      : 'activeChestId = id'
    expect(containerCommandOpen).toBeLessThan(containerCommandEnd)
    expect(containerCommandEnd).toBeLessThan(positionOf(storageRoute, activeChestUpdate))
    expect(positionOf(storageRoute, activeChestUpdate))
      .toBeLessThan(positionOf(storageRoute, "setInventoryOpen(true, 'chest')"))
  })
})
