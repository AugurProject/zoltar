/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { OracleOperationActions } from '@zoltar/ui-statoblast-shared/features/security-pools/components/OracleOperationActions.js'

type Prepared = Parameters<typeof OracleOperationActions>[0]['prepared']

function createPrepared(overrides: Partial<Prepared> = {}): Prepared {
	return { error: undefined, preparing: false, retainedWorkflow: undefined, retry: () => undefined, retryAvailable: false, sending: false, workflow: undefined, ...overrides }
}

describe('OracleOperationActions', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanup?.()
			cleanup = undefined
		},
	})

	const renderActions = async (prepared: Prepared, reason?: string) => {
		cleanup = (await renderIntoDocument(<OracleOperationActions prepared={prepared} operationKey='operation' actionLabel='Queue liquidation' pendingLabel='Queueing liquidation…' requiresReportFunding={false} busy={false} pending={false} reason={reason} onExecute={() => undefined} />)).cleanup
		return getTransactionButtonState(document.body, 'Queue liquidation')
	}

	test('says the transaction steps are being prepared instead of naming setup transactions', async () => {
		const state = await renderActions(createPrepared({ preparing: true }))
		expect(state.disabled).toBe(true)
		expect(state.reason).toBe('Preparing the transaction steps…')
	})

	test('asks to retry when preparing the transaction steps failed', async () => {
		const state = await renderActions(createPrepared({ error: 'RPC unavailable', retryAvailable: true }))
		expect(state.disabled).toBe(true)
		expect(state.reason).toBe('Preparing the transaction steps failed. Retry to continue.')
	})

	test('keeps the caller reason first', async () => {
		const state = await renderActions(createPrepared({ preparing: true }), 'Enter an amount to liquidate.')
		expect(state.reason).toBe('Enter an amount to liquidate.')
	})
})
