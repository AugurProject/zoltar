import type { CanonicalRecovery } from './browser-types.ts'

export interface CanonicalState {
	recovery: CanonicalRecovery | undefined
	refreshRequired: boolean
	dataGeneration: number
}

export const createCanonicalState = (): CanonicalState => ({ recovery: undefined, refreshRequired: false, dataGeneration: 0 })
