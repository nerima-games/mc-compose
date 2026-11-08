import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(new URL('../apps/web/main.ts', import.meta.url), 'utf8')

const positionOf = (source: string, marker: string, fromIndex = 0): number => {
  const position = source.indexOf(marker, fromIndex)
  expect(position, `expected main.ts to contain ${marker}`).toBeGreaterThanOrEqual(0)
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
    const tickStart = positionOf(mainSource, 'const tick = (): void => {')

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
    const tickStart = positionOf(mainSource, 'const tick = (): void => {')
    const tickInput = mainSource.slice(
      tickStart,
      positionOf(mainSource, 'if (!dead && !inventoryOpen && !tradeOpen)', tickStart),
    )
    const deadGate = positionOf(tickInput, '!dead &&')
    const bowGate = positionOf(tickInput, '!bowInteractionLocked()')
    const openInput = positionOf(tickInput, "wasActionJustTriggered('openInventory')")
    const runtimeCall = positionOf(tickInput, "setInventoryOpen(!inventoryOpen, 'player')")

    expect(deadGate).toBeLessThan(bowGate)
    expect(bowGate).toBeLessThan(openInput)
    expect(openInput).toBeLessThan(runtimeCall)
  })

  it('preserves workstation setup and container command ordering before opening each screen', () => {
    const crafting = positionOf(mainSource, "route?.kind === 'craftingTable'")
    const craftingOpen = positionOf(mainSource, "setInventoryOpen(true, 'craftingTable')")
    expect(crafting).toBeLessThan(craftingOpen)

    const furnaceStart = positionOf(mainSource, "route?.kind === 'furnace'")
    const furnaceEnd = positionOf(mainSource, "route?.kind === 'storage'", furnaceStart)
    const furnaceRoute = mainSource.slice(furnaceStart, furnaceEnd)
    expect(positionOf(furnaceRoute, 'furnaceStates.set(key,')).toBeLessThan(
      positionOf(furnaceRoute, 'activeFurnaceKey = key'),
    )
    expect(positionOf(furnaceRoute, 'activeFurnaceKey = key')).toBeLessThan(
      positionOf(furnaceRoute, "setInventoryOpen(true, 'furnace')"),
    )

    const storageRoute = mainSource.slice(furnaceEnd, positionOf(mainSource, 'const inventoryBeforeUse', furnaceEnd))
    expect(storageRoute).toContain([
      'if (container !== undefined && sendFacilityCommand({',
      "              _tag: 'ContainerCommand',",
      '              containerId: id,',
      "              action: { _tag: 'open' },",
      '            })) {',
    ].join('\n'))
    expect(positionOf(storageRoute, "action: { _tag: 'open' }"))
      .toBeLessThan(positionOf(storageRoute, 'activeChestId = id'))
    expect(positionOf(storageRoute, 'activeChestId = id'))
      .toBeLessThan(positionOf(storageRoute, "setInventoryOpen(true, 'chest')"))
  })
})
