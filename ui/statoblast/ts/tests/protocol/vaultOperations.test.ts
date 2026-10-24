import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { hasPendingVaultCommitment } from '@zoltar/ui-statoblast-shared/protocol/vaultOperations.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

test.each([0n, 1n, 1_000_000n])('commitment checks use one owner lookup for operation %s', async operationId => {
	const owner = getAddress('0x0000000000000000000000000000000000000001')
	const manager = getAddress('0x0000000000000000000000000000000000000002')
	let reads = 0
	const client = createMockReadClient(async request => {
		reads++
		expect(request.address).toBe(manager)
		expect(request.functionName).toBe('getPendingCommitmentOperationId')
		expect(request.args).toEqual([owner])
		return operationId
	})
	expect(await hasPendingVaultCommitment(client, manager, owner)).toBe(operationId !== 0n)
	expect(reads).toBe(1)
})
