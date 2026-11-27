/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { migrateInternalRepInZoltar } from '@zoltar/ui-zoltar-shared/protocol/zoltarForks.js'
import type { TransactionPlanStep } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

describe('combined REP split submission', () => {
	test('forwards the exact preparation amount and selected destination order', async () => {
		let data: Hex | undefined
		const client = asWriteClient(
			createMockWriteClient(request => {
				data = request.data
			}),
		)
		const selected = [10n, 2n, 0n]
		const result = await migrateInternalRepInZoltar(client, 1n, 20n, selected, 5n)
		if (data === undefined) throw new Error('Expected split transaction data')
		const decoded = decodeFunctionData({ abi: Zoltar_Zoltar.abi, data })
		expect(decoded.functionName).toBe('prepareAndSplitMigrationRep')
		expect(decoded.args).toEqual([1n, 20n, [10n, 2n, 0n], 5n])
		expect(result.outcomeIndexes).toEqual([10n, 2n, 0n])
		expect(selected).toEqual([10n, 2n, 0n])
	})

	test('review compares fresh wallet REP and selected child migration balances', async () => {
		const rep = 10n ** 18n
		const address = '0x0000000000000000000000000000000000000001'
		let step: TransactionPlanStep | undefined
		const writer = asWriteClient(
			createMockWriteClient(
				() => undefined,
				async request => {
					expect(request.blockNumber).toBe(4n)
					switch (request.functionName) {
						case 'getRepToken':
							return address
						case 'balanceOf':
							return 10n * rep
						case 'getMigrationRepBalanceAttoRep':
							return 2n * rep
						case 'getChildUniverseId':
							return 42n
						case 'getChildMigrationRepAmountsAttoRep':
							return [2n * rep]
						default:
							throw new Error(`Unexpected migration read: ${request.functionName}`)
					}
				},
			),
		)
		await migrateInternalRepInZoltar(
			{
				...writer,
				account: { type: 'json-rpc', address },
				chain: MAINNET_NETWORK_PROFILE.chain,
				getBlock: async () => ({ ...createBlockWithTimestamp(10n), number: 4n }),
				onTransactionPlan: steps => {
					step = steps[0]
				},
			},
			1n,
			3n * rep,
			[2n],
			3n * rep,
		)
		expect(step?.readReviewRows?.()).toEqual([])
		await step?.validateBeforeSubmit?.()
		expect(step?.readReviewRows?.()).toEqual([
			{ label: 'Wallet REP', value: '10 REP → 7 REP' },
			{ label: 'Migration balance', value: '2 REP → 5 REP' },
			{ label: 'Migrated to universe 42', value: '2 REP → 5 REP' },
		])
	})
})
