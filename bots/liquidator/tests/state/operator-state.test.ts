import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertIntentSender, initialRuntimeState, loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'
import { getAddress, keccak256, privateKeyToAccount, type Hex } from '../helpers/ethereum.ts'

describe('liquidator durable state', () => {
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
				coordinator: getAddress('0x0000000000000000000000000000000000000020'),
				operationId: 7n,
				queuedBlock: 101n,
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
					initiator: account.address,
					target: getAddress('0x0000000000000000000000000000000000000030'),
					type: 'pending-liquidation',
				},
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

	test('rejects malformed persisted transaction intents instead of dropping them', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-state-'))
		const path = join(directory, 'state.json')
		try {
			await writeFile(path, '{"version":1,"activities":[],"pendingTransactions":"invalid"}')
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
