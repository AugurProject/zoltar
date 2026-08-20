import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertIntentSender, clearMarketEvidenceForConfigurationChange, commitReconciledIntent, initialRuntimeState, loadDurableState, operatorSnapshot, recoveredIntentCanBeResubmitted, resolveRecoveredIntentJournal, saveDurableState } from '../../src/state/operator-state.ts'
import { getAddress, keccak256, privateKeyToAccount, type Hex } from '../helpers/ethereum.ts'

describe('liquidator durable state', () => {
	test('reports operator capability only after a complete scan with no unresolved recovery', () => {
		const state = initialRuntimeState(false, undefined)
		expect(operatorSnapshot(state, false).operatorCapable).toBe(false)
		state.lastScanAt = '2026-08-20T00:00:00.000Z'
		state.lastScannedBlock = 100n
		state.status = 'dry-run'
		expect(operatorSnapshot(state, false).operatorCapable).toBe(true)
		state.scanning = true
		expect(operatorSnapshot(state, false).operatorCapable).toBe(false)
		state.scanning = false
		expect(operatorSnapshot(state, true).operatorCapable).toBe(false)
		state.status = 'running'
		expect(operatorSnapshot(state, true).operatorCapable).toBe(false)
		state.wallet = getAddress('0x0000000000000000000000000000000000000010')
		expect(operatorSnapshot(state, true).operatorCapable).toBe(true)
		state.pendingStagedOperations.push({
			coordinator: getAddress('0x0000000000000000000000000000000000000020'),
			operationId: 7n,
			queuedBlock: 101n,
			target: getAddress('0x0000000000000000000000000000000000000030'),
		})
		const blocked = operatorSnapshot(state, false)
		expect(blocked.operatorCapable).toBe(false)
		expect(blocked.pendingStagedOperations).toEqual([expect.objectContaining({ operationId: '7', queuedBlock: '101' })])
		expect(blocked.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('staged operation(s) require outcome recovery') })]))
	})

	test('rejects a current state journal that omits recovery collections', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-state-schema-'))
		const path = join(directory, 'state.json')
		try {
			await writeFile(path, JSON.stringify({ activities: [], pendingStagedOperations: [], version: 1 }), 'utf8')
			await expect(loadDurableState(path)).rejects.toThrow('pendingTransactions')
			await writeFile(path, JSON.stringify({ activities: [], pendingTransactions: [], version: 1 }), 'utf8')
			await expect(loadDurableState(path)).rejects.toThrow('pendingStagedOperations')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('never resubmits a recovered price-dependent intent without fresh evidence', () => {
		expect(recoveredIntentCanBeResubmitted({ requiresMarketEvidence: true })).toBe(false)
		expect(recoveredIntentCanBeResubmitted({ requiresMarketEvidence: false })).toBe(true)
	})
	test('clears all prior venue evidence when the configured source set changes', () => {
		const evidence: { centralizedMarket: unknown; marketConsensus: unknown; marketObservations: unknown[] } = { centralizedMarket: 'old-cex', marketConsensus: 'old-consensus', marketObservations: ['old-observation'] }
		clearMarketEvidenceForConfigurationChange(evidence)
		expect(evidence).toEqual({ centralizedMarket: undefined, marketConsensus: undefined, marketObservations: [] })
	})

	test('persists a signed intent before submission for restart recovery', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-state-'))
		const path = join(directory, 'state.json')
		try {
			const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
			if (account.signTransaction === undefined) throw new Error('Test account cannot sign')
			const serializedTransaction = await account.signTransaction({
				chainId: 1,
				gas: 21_000n,
				maxFeePerGas: 2n,
				maxPriorityFeePerGas: 1n,
				nonce: 4n,
				to: getAddress('0x0000000000000000000000000000000000000020'),
				value: 0n,
			})
			const state = initialRuntimeState(false, account.address)
			state.pendingStagedOperations.push({
				candidateOutcome: {
					blockHash: `0x${'44'.repeat(32)}`,
					blockNumber: 110n,
					errorMessage: '',
					operation: 0n,
					operationId: 7n,
					success: true,
					transactionHash: `0x${'55'.repeat(32)}`,
				},
				coordinator: getAddress('0x0000000000000000000000000000000000000020'),
				historicalRecoveryComplete: true,
				operationId: 7n,
				queuedBlock: 101n,
				recoveryAnchorBlock: 110n,
				recoveryAnchorHash: `0x${'66'.repeat(32)}`,
				target: getAddress('0x0000000000000000000000000000000000000030'),
			})
			state.pendingTransactions.push({
				hash: keccak256(serializedTransaction),
				kind: 'liquidation',
				label: 'Queue liquidation',
				maxBlockNumber: 125n,
				mode: 'private',
				nonce: 4n,
				receiptExpectation: {
					amount: 20n,
					coordinator: getAddress('0x0000000000000000000000000000000000000020'),
					operator: account.address,
					receiver: account.address,
					target: getAddress('0x0000000000000000000000000000000000000030'),
					type: 'pending-liquidation',
				},
				requiresMarketEvidence: true,
				sender: account.address,
				serializedTransaction,
				submissionBlock: 100n,
			})
			await saveDurableState(path, state)
			const loaded = await loadDurableState(path)
			expect(loaded.pendingTransactions).toEqual(state.pendingTransactions)
			expect(loaded.pendingStagedOperations).toEqual(state.pendingStagedOperations)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('retains an ambiguous journal across restart and resolves the same intent when its receipt appears later', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-late-receipt-'))
		const path = join(directory, 'state.json')
		try {
			const account = privateKeyToAccount(`0x${'12'.repeat(32)}`)
			if (account.signTransaction === undefined) throw new Error('Test account cannot sign')
			const serializedTransaction = await account.signTransaction({
				chainId: 1,
				gas: 21_000n,
				maxFeePerGas: 2n,
				maxPriorityFeePerGas: 1n,
				nonce: 3n,
				to: getAddress('0x0000000000000000000000000000000000000020'),
				value: 0n,
			})
			const hash = keccak256(serializedTransaction)
			const state = initialRuntimeState(false, account.address)
			state.pendingTransactions.push({
				hash,
				kind: 'liquidation',
				label: 'Late receipt liquidation',
				maxBlockNumber: 120n,
				mode: 'public',
				nonce: 3n,
				receiptExpectation: { type: 'transaction' },
				requiresMarketEvidence: true,
				sender: account.address,
				serializedTransaction,
				submissionBlock: 100n,
			})
			expect(resolveRecoveredIntentJournal(state, hash, undefined)).toBe(false)
			await saveDurableState(path, state)
			const restarted = await loadDurableState(path)
			expect(restarted.pendingTransactions).toHaveLength(1)
			const recoveredState = initialRuntimeState(false, account.address)
			recoveredState.pendingTransactions = restarted.pendingTransactions
			expect(resolveRecoveredIntentJournal(recoveredState, hash, 'success')).toBe(true)
			await saveDurableState(path, recoveredState)
			expect((await loadDurableState(path)).pendingTransactions).toEqual([])
		} finally {
			await rm(directory, { recursive: true })
		}
	})

	test('keeps a reconciled intent blocking in memory until its removal is durable', async () => {
		const account = privateKeyToAccount(`0x${'13'.repeat(32)}`)
		if (account.signTransaction === undefined) throw new Error('Test account cannot sign')
		const serializedTransaction = await account.signTransaction({ chainId: 1, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 4n, to: getAddress('0x0000000000000000000000000000000000000020'), value: 0n })
		const hash = keccak256(serializedTransaction)
		const state = initialRuntimeState(false, account.address)
		state.pendingTransactions.push({ hash, kind: 'liquidation', label: 'Replacement persistence', maxBlockNumber: 120n, mode: 'public', nonce: 4n, receiptExpectation: { type: 'transaction' }, requiresMarketEvidence: true, sender: account.address, serializedTransaction, submissionBlock: 100n })
		const activity = { hash, kind: 'recovery' as const, message: 'Replacement reconciled', status: 'confirmed' as const }
		await expect(
			commitReconciledIntent('unused', state, hash, activity, async (_path, next) => {
				expect(next.pendingTransactions).toEqual([])
				expect(state.pendingTransactions).toHaveLength(1)
				throw new Error('durable write failed')
			}),
		).rejects.toThrow('durable write failed')
		expect(state.pendingTransactions).toHaveLength(1)
		expect(state.activities).toEqual([])
		await commitReconciledIntent('unused', state, hash, activity, async (_path, next) => {
			expect(next.pendingTransactions).toEqual([])
			expect(state.pendingTransactions).toHaveLength(1)
		})
		expect(state.pendingTransactions).toEqual([])
		expect(state.activities[0]?.kind).toBe('recovery')
	})

	test('rejects malformed persisted transaction intents instead of dropping them', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-state-'))
		const path = join(directory, 'state.json')
		try {
			await writeFile(path, '{"version":1,"activities":[],"pendingStagedOperations":[],"pendingTransactions":"invalid"}')
			expect(loadDurableState(path)).rejects.toThrow('pendingTransactions must be an array')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects a persisted transaction whose hash does not match its signed bytes', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-state-'))
		const path = join(directory, 'state.json')
		try {
			await writeFile(
				path,
				JSON.stringify({
					activities: [],
					pendingStagedOperations: [],
					pendingTransactions: [
						{
							hash: `0x${'11'.repeat(32)}`,
							kind: 'fees',
							label: 'Redeem fees',
							maxBlockNumber: '125',
							mode: 'public',
							nonce: '4',
							receiptExpectation: { type: 'transaction' },
							sender: '0x0000000000000000000000000000000000000010',
							serializedTransaction: '0x1234',
							submissionBlock: '100',
						},
					],
					version: 1,
				}),
			)
			expect(loadDurableState(path)).rejects.toThrow('hash does not match')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('refuses to recover an intent signed by a different account', () => {
		expect(() => assertIntentSender(getAddress('0x0000000000000000000000000000000000000010'), getAddress('0x0000000000000000000000000000000000000020'))).toThrow('active signer')
	})

	test('rejects a persisted sender that is not the signed transaction sender', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-state-'))
		const path = join(directory, 'state.json')
		try {
			const account = privateKeyToAccount(`0x${'22'.repeat(32)}`)
			if (account.signTransaction === undefined) throw new Error('Test account cannot sign')
			const serializedTransaction = await account.signTransaction({
				chainId: 1,
				gas: 21_000n,
				maxFeePerGas: 2n,
				maxPriorityFeePerGas: 1n,
				nonce: 4n,
				to: getAddress('0x0000000000000000000000000000000000000020'),
				value: 0n,
			})
			await writeFile(
				path,
				JSON.stringify({
					activities: [],
					pendingStagedOperations: [],
					pendingTransactions: [
						{
							hash: keccak256(serializedTransaction),
							kind: 'fees',
							label: 'Redeem fees',
							maxBlockNumber: '125',
							mode: 'public',
							nonce: '4',
							receiptExpectation: { type: 'transaction' },
							sender: '0x0000000000000000000000000000000000000010',
							serializedTransaction: serializedTransaction satisfies Hex,
							submissionBlock: '100',
						},
					],
					version: 1,
				}),
			)
			expect(loadDurableState(path)).rejects.toThrow('sender does not match')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})
})
