import { describe, expect, test } from 'bun:test'
import example from '../../config/operator.example.json'
import { parseSettings, type OperatorSettings } from '../../src/config/settings.ts'
import { createGoLiveControls, PENDING_INTENT_MODE_CHANGE } from '../../src/core/go-live-controls.ts'
import { initialRuntimeState, type PendingTransactionIntent } from '../../src/state/operator-state.ts'

const sender = '0x1111111111111111111111111111111111111111'

function pendingIntent(mode: 'private' | 'public'): PendingTransactionIntent {
	return {
		hash: `0x${'ab'.repeat(32)}`,
		kind: 'deposit',
		label: 'Deposit REP',
		maxBlockNumber: 120n,
		mode,
		nonce: 7n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: false,
		sender,
		serializedTransaction: `0x${'02'.repeat(40)}`,
		submissionBlock: 100n,
	}
}

function controls(settings: OperatorSettings, pending: PendingTransactionIntent[]) {
	const state = initialRuntimeState(true, undefined, settings.network.chainId)
	state.pendingTransactions = pending
	let current = settings
	const locks = { acquireSigner: async () => undefined, commitSigner: async () => undefined, disableExecution: async () => undefined, discardSigner: async () => undefined, enableExecution: async () => undefined }
	const controller = createGoLiveControls({
		activePrivateKey: () => undefined,
		applySigner: () => undefined,
		locks,
		persist: async update => {
			current = update(current)
			return current
		},
		runMutation: mutation => mutation(),
		settings: () => current,
		state,
	})
	return { controller, settings: () => current, state }
}

describe('liquidator go-live controls', () => {
	const settings = parseSettings({ ...example, connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, networkConfigured: true })

	test('keeps the delivery mode of a pending intent until recovery resolves it', async () => {
		const { controller, settings: current } = controls(settings, [pendingIntent('public')])
		// Keep delivery settings stable while an unresolved intent still depends on them.
		await expect(controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net'] })).rejects.toThrow(PENDING_INTENT_MODE_CHANGE)
		expect(current().submission.mode).toBe('public')
		// Same-mode edits stay possible while the intent is pending.
		await controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		expect(current().submission.mode).toBe('public')
	})

	test('changes the delivery mode once no intent depends on the previous one', async () => {
		const { controller, settings: current, state } = controls({ ...settings, submission: { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net'] } }, [pendingIntent('private')])
		await expect(controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })).rejects.toThrow(PENDING_INTENT_MODE_CHANGE)
		state.pendingTransactions = []
		await controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		expect(current().submission.mode).toBe('public')
		expect(state.activities[0]?.message).toBe('Transaction delivery settings saved')
	})
})
