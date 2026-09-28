import { beforeEach, describe, expect, test } from 'bun:test'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { createTransactionFailureError } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'
import { transactionActivity } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import { createMarketTransactionActivity, isMarketTransactionPending } from '../../features/live/marketTransactionActivity.js'

const market: Address = `0x${'22'.repeat(20)}`
const otherMarket: Address = `0x${'23'.repeat(20)}`
const hash: Hash = `0x${'a8'.repeat(32)}`
const cancellationHash: Hash = `0x${'a9'.repeat(32)}`

describe('market transaction activity', () => {
	beforeEach(() => {
		transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	})

	test('locks only its market while pending and unlocks on the receipt', () => {
		const activity = createMarketTransactionActivity(market, 'Trade · Will this resolve?')
		activity.broadcast(hash)
		expect(isMarketTransactionPending(market)).toBeTrue()
		expect(isMarketTransactionPending(otherMarket)).toBeFalse()
		activity.receipt('reverted')
		expect(isMarketTransactionPending(market)).toBeFalse()
		expect(transactionActivity.value.entries[0]).toMatchObject({ hash, status: 'failed', failureKind: 'reverted' })
	})

	test('settles a wallet cancellation instead of leaving the market locked', () => {
		const activity = createMarketTransactionActivity(market, 'Trade · Will this resolve?')
		activity.broadcast(hash)
		activity.replaced(cancellationHash)
		activity.stopped(createTransactionFailureError('replaced', 'Transaction was cancelled in the wallet before confirmation.'), true)
		expect(transactionActivity.value.entries).toHaveLength(1)
		expect(transactionActivity.value.entries[0]).toMatchObject({ hash: cancellationHash, status: 'failed', failureKind: 'replaced' })
		expect(isMarketTransactionPending(market)).toBeFalse()
	})

	test('keeps an unconfirmed broadcast pending for the activity watcher when the receipt read fails', () => {
		const activity = createMarketTransactionActivity(market, 'Trade · Will this resolve?')
		activity.stopped(new Error('before broadcast'), false)
		expect(transactionActivity.value.entries).toHaveLength(0)
		activity.broadcast(hash)
		activity.stopped(new Error('RPC unavailable'), false)
		expect(transactionActivity.value.entries[0]?.status).toBe('pending')
		expect(isMarketTransactionPending(market)).toBeTrue()
	})
})
