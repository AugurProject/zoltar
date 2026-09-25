/// <reference types='bun-types' />

import { afterEach, describe, expect, test } from 'bun:test'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import {
	countPendingTransactionActivity,
	dismissTransactionActivity,
	mergeStoredTransactionActivity,
	expireStaleTransactionActivity,
	MAX_PENDING_TRANSACTION_AGE_MILLISECONDS,
	getPendingTransactionActivityScopes,
	getTransactionActivityStorageKey,
	MAX_TRANSACTION_ACTIVITY_ENTRIES,
	parseStoredTransactionActivity,
	recordSubmittedTransactionActivity,
	replaceTransactionActivityHash,
	serializeTransactionActivity,
	settleTransactionActivity,
	type TransactionActivityEntry,
} from '../transactions/transactionActivity.js'
import { createTransactionScope, mergeTransactionScopes, securityPoolTransactionScope, transactionScopesOverlap, universeTransactionScope } from '../transactions/transactionScope.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { dismissTransactionActivityEntry, hasPendingTransactionActivity, setTransactionActivityOwner, recordTransactionSettled, recordTransactionSubmitted, transactionActivity } from '../transactions/transactionActivityStore.js'

installDomTestLifecycle()

function hashOf(index: number): Hash {
	return `0x${index.toString(16).padStart(64, '0')}`
}

function entry(index: number, status: TransactionActivityEntry['status'] = 'confirmed'): TransactionActivityEntry {
	const base: TransactionActivityEntry = { chainId: 1, hash: hashOf(index), scope: [], status, submittedAt: index, title: `Transaction ${index}` }
	return status === 'failed' ? { ...base, failureKind: 'reverted' } : base
}

describe('transaction scopes', () => {
	test('normalizes object ids and overlaps only on shared keys', () => {
		expect(securityPoolTransactionScope(' 0xABC ')).toEqual(['security-pool:0xabc'])
		expect(universeTransactionScope(255n)).toEqual(['universe:0xff'])
		expect(createTransactionScope('market', undefined)).toEqual([])
		expect(createTransactionScope('market', '  ')).toEqual([])
		expect(mergeTransactionScopes(['a'], undefined, ['a', 'b'])).toEqual(['a', 'b'])
		expect(transactionScopesOverlap(['a', 'b'], ['b'])).toBe(true)
		expect(transactionScopesOverlap(['a'], ['b'])).toBe(false)
		// An unscoped action never collides with anything.
		expect(transactionScopesOverlap([], ['a'])).toBe(false)
		expect(transactionScopesOverlap(['a'], undefined)).toBe(false)
	})
})

describe('transaction activity list', () => {
	test('records newest first, ignores duplicates, and settles only pending entries', () => {
		const recorded = recordSubmittedTransactionActivity(recordSubmittedTransactionActivity([], entry(1, 'pending')), entry(2, 'pending'))
		const duplicate = recordSubmittedTransactionActivity(recorded, entry(2, 'pending'))
		const settled = settleTransactionActivity(recorded, hashOf(1), { status: 'failed', failureKind: 'reverted' }, 50)

		expect(recorded.map(item => item.hash)).toEqual([hashOf(2), hashOf(1)])
		expect(duplicate).toBe(recorded)
		expect(settled.find(item => item.hash === hashOf(1))).toMatchObject({ status: 'failed', failureKind: 'reverted', settledAt: 50 })
		expect(settleTransactionActivity(settled, hashOf(1), { status: 'confirmed' }, 60)).toBe(settled)
		expect(countPendingTransactionActivity(settled)).toBe(1)
	})

	test('moves an entry to its replacement hash', () => {
		const replaced = replaceTransactionActivityHash([entry(1, 'pending')], hashOf(1), hashOf(9))

		expect(replaced.map(item => [item.hash, item.title])).toEqual([[hashOf(9), 'Transaction 1']])
	})

	test('caps settled history but never evicts pending transactions', () => {
		let entries: readonly TransactionActivityEntry[] = [entry(0, 'pending')]
		for (let index = 1; index <= MAX_TRANSACTION_ACTIVITY_ENTRIES + 5; index += 1) entries = recordSubmittedTransactionActivity(entries, entry(index))

		expect(entries).toHaveLength(MAX_TRANSACTION_ACTIVITY_ENTRIES)
		expect(entries.some(item => item.hash === hashOf(0))).toBe(true)
		expect(entries[0]?.hash).toBe(hashOf(MAX_TRANSACTION_ACTIVITY_ENTRIES + 5))
	})

	test('expires pending transactions past the tracking window and lets the user dismiss a row', () => {
		const stale = { ...entry(1, 'pending'), scope: ['market:0x1'], submittedAt: 0 }
		const fresh = { ...entry(2, 'pending'), submittedAt: MAX_PENDING_TRANSACTION_AGE_MILLISECONDS }
		const expired = expireStaleTransactionActivity([fresh, stale], MAX_PENDING_TRANSACTION_AGE_MILLISECONDS + 1)

		expect(expired.map(item => [item.hash, item.status, item.failureKind])).toEqual([
			[hashOf(2), 'pending', undefined],
			[hashOf(1), 'failed', 'dropped'],
		])
		expect(getPendingTransactionActivityScopes(expired)).toEqual([])
		expect(expireStaleTransactionActivity([fresh], MAX_PENDING_TRANSACTION_AGE_MILLISECONDS + 1)).toEqual([fresh])
		expect(dismissTransactionActivity(expired, hashOf(2)).map(item => item.hash)).toEqual([hashOf(1)])
		expect(dismissTransactionActivity(expired, hashOf(9))).toBe(expired)
	})

	test("merges entries another tab stored, keeping this tab's copy of a shared hash", () => {
		const mine = [entry(3, 'pending'), entry(1, 'confirmed')]
		const stored = [entry(2, 'pending'), { ...entry(1, 'pending') }]
		const merged = mergeStoredTransactionActivity(mine, stored)

		expect(merged.map(item => [item.hash, item.status])).toEqual([
			[hashOf(3), 'pending'],
			[hashOf(2), 'pending'],
			[hashOf(1), 'confirmed'],
		])
		expect(mergeStoredTransactionActivity(mine, [entry(1)])).toBe(mine)
	})

	test('exposes the scopes of pending transactions for locking', () => {
		const pending = { ...entry(1, 'pending'), scope: ['market:0x1'] }
		const settled = { ...entry(2), scope: ['market:0x2'] }

		expect(getPendingTransactionActivityScopes([pending, settled, entry(3, 'pending')])).toEqual([['market:0x1']])
	})

	test('round-trips storage and drops malformed records', () => {
		const stored = serializeTransactionActivity([entry(1, 'pending'), entry(2, 'failed')])
		const withGarbage = JSON.stringify([...JSON.parse(stored), { hash: 'nope' }, { ...entry(3), status: 'failed' }, 7])

		expect(parseStoredTransactionActivity(stored)).toEqual([entry(1, 'pending'), entry(2, 'failed')])
		expect(parseStoredTransactionActivity(withGarbage).map(item => item.hash)).toEqual([hashOf(1), hashOf(2)])
		expect(parseStoredTransactionActivity('{not json')).toEqual([])
		expect(parseStoredTransactionActivity(null)).toEqual([])
	})

	test('keys storage by backend, network, and account', () => {
		expect(getTransactionActivityStorageKey({ account: '0xABC', backendId: 'injected', chainId: 11155111 })).toBe('zoltar.transactionActivity.v1:injected:11155111:0xabc')
	})
})

describe('transaction activity store', () => {
	afterEach(() => {
		resetActiveEnvironmentForTesting()
		transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	})

	test('keeps one row when a broadcast is replaced and releases a dismissed pending lock', () => {
		recordTransactionSubmitted({ hash: hashOf(1), scope: ['trading-deployment:factory'], title: 'Deploy factory' })
		recordTransactionSubmitted({ hash: hashOf(2), previousHash: hashOf(1), scope: ['trading-deployment:factory'], title: 'Deploy factory' })
		expect(transactionActivity.value.entries.map(item => item.hash)).toEqual([hashOf(2)])
		expect(hasPendingTransactionActivity(['trading-deployment:factory'])).toBeTrue()
		dismissTransactionActivityEntry(hashOf(2))
		expect(transactionActivity.value.entries).toEqual([])
		expect(hasPendingTransactionActivity(['trading-deployment:factory'])).toBeFalse()
	})

	test('settles stale pending transactions when the stored list is loaded', () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend())
		try {
			setTransactionActivityOwner('0x00000000000000000000000000000000000000a1')
			const storageKey = transactionActivity.value.storageKey
			if (storageKey === undefined) throw new Error('Expected persisted activity for a connected account')
			window.localStorage.setItem(storageKey, serializeTransactionActivity([{ ...entry(1, 'pending'), submittedAt: Date.now() - MAX_PENDING_TRANSACTION_AGE_MILLISECONDS - 1 }]))
			transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
			setTransactionActivityOwner('0x00000000000000000000000000000000000000a1')
			expect(transactionActivity.value.entries[0]).toMatchObject({ status: 'failed', failureKind: 'dropped' })
			expect(window.localStorage.getItem(storageKey)).toContain('"dropped"')
		} finally {
			restore()
		}
	})

	test('keeps pending transactions another tab recorded for the same account', () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend())
		try {
			setTransactionActivityOwner('0x00000000000000000000000000000000000000a1')
			const storageKey = transactionActivity.value.storageKey
			if (storageKey === undefined) throw new Error('Expected persisted activity for a connected account')
			// The other tab stored its pending transaction after this tab loaded the list.
			window.localStorage.setItem(storageKey, serializeTransactionActivity([{ ...entry(7, 'pending'), submittedAt: Date.now() - 1 }]))
			recordTransactionSubmitted({ hash: hashOf(8), scope: [], title: 'Mine' })
			transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
			setTransactionActivityOwner('0x00000000000000000000000000000000000000a1')
			expect(transactionActivity.value.entries.map(item => item.hash).sort()).toEqual([hashOf(7), hashOf(8)])
		} finally {
			restore()
		}
	})

	test('persists per account and restores the list after a reload', () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend())
		try {
			setTransactionActivityOwner('0x00000000000000000000000000000000000000a1')
			recordTransactionSubmitted({ hash: hashOf(1), scope: ['security-pool:0x1'], title: 'Depositing REP' })
			recordTransactionSettled(hashOf(1), { status: 'confirmed' })
			recordTransactionSubmitted({ hash: hashOf(2), scope: undefined, title: 'Creating Question' })
			const storedKey = transactionActivity.value.storageKey
			if (storedKey === undefined) throw new Error('Expected persisted activity for a connected account')

			setTransactionActivityOwner('0x00000000000000000000000000000000000000b2')
			expect(transactionActivity.value.entries).toEqual([])

			// A reload starts with an empty module and reads the stored list back.
			transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
			setTransactionActivityOwner('0x00000000000000000000000000000000000000A1')
			expect(transactionActivity.value.entries.map(item => [item.title, item.status])).toEqual([
				['Creating Question', 'pending'],
				['Depositing REP', 'confirmed'],
			])
			expect(window.localStorage.getItem(storedKey)).not.toBeNull()
		} finally {
			restore()
		}
	})
})
