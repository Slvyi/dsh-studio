export type RuntimePhase = 'idle' | 'starting' | 'ready' | 'failed'

export interface RuntimeSnapshot {
  phase: RuntimePhase
  message: string
  url?: string
  logs: string[]
}
