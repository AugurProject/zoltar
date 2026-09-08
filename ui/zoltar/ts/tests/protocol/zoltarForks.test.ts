/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, type Hex } from '@zoltar/shared/evm/ethereum'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { migrateInternalRepInZoltar } from '@zoltar/ui-zoltar-shared/protocol/zoltarForks.js'

describe('combined REP split submission', () => {
	test('sorts indexes numerically without mutating the selected destinations', async () => {
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
		expect(decoded.args).toEqual([1n, 20n, [0n, 2n, 10n], 5n])
		expect(result.outcomeIndexes).toEqual([0n, 2n, 10n])
		expect(selected).toEqual([10n, 2n, 0n])
	})
})
