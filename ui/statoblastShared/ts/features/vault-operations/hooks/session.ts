import { signal } from '@preact/signals'
import type { SecurityPoolVaultSummary, QueuedVaultOperationState } from '../../../types/contracts.js'
import type { VaultOperationsResult } from '../../../protocol/vaultOperations.js'
import { emptyVaultOperationsDraft } from '../lib/draft.js'

function createSession() {
	return {
		draft: signal(emptyVaultOperationsDraft()),
		result: signal<VaultOperationsResult | undefined>(undefined),
		targets: signal<SecurityPoolVaultSummary[]>([]),
		status: signal<QueuedVaultOperationState | undefined>(undefined),
		busy: signal(false),
		revision: signal(0),
		presentedTerminal: false,
	}
}

const sessions = new Map<string, ReturnType<typeof createSession>>()

export function getVaultOperationsSession(contextKey: string) {
	const existing = sessions.get(contextKey)
	if (existing !== undefined) return existing
	const session = createSession()
	sessions.set(contextKey, session)
	return session
}

export function isTerminalVaultOperation(state: QueuedVaultOperationState | undefined) {
	return state !== undefined && (state.status === 'executed' || state.status === 'failed' || state.status === 'expired' || state.status === 'superseded')
}
