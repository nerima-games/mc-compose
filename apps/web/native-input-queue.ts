export type NativeInputAction = 'attack' | 'use'

export type NativeInputQueueState = Readonly<{
  readonly attack: number
  readonly use: number
}>

export const EMPTY_NATIVE_INPUT_QUEUE: NativeInputQueueState = {
  attack: 0,
  use: 0,
}

export const enqueueNativeMouseButton = (
  state: NativeInputQueueState,
  button: number,
): NativeInputQueueState => {
  if (button === 0) return { attack: state.attack + 1, use: state.use }
  if (button === 2) return { attack: state.attack, use: state.use + 1 }
  return state
}

export const consumeNativeInput = (
  state: NativeInputQueueState,
  action: NativeInputAction,
): { readonly triggered: boolean; readonly state: NativeInputQueueState } => {
  if (state[action] === 0) return { triggered: false, state }
  return action === 'attack'
    ? { triggered: true, state: { attack: state.attack - 1, use: state.use } }
    : { triggered: true, state: { attack: state.attack, use: state.use - 1 } }
}
