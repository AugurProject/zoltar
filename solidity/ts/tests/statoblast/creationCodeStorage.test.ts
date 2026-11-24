import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_CreationCodeStorageHarness_CreationCodeStorageHarness as artifact } from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

describe('creation bytecode storage (#1505)', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		address = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
		await node.setBaselineSnapshot()
	})
	for (const length of [1, 2, 3, 47_999, 48_000, 49_150]) {
		test(`reassembles ${length} bytes exactly with inert bounded carriers`, async () => {
			const code: Hex = `0x${'ef'.repeat(length)}`
			await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'store', args: [code], gas: 16_777_216n }))
			expect(await client.readContract({ abi: artifact.abi, address, functionName: 'load' })).toBe(code)
			for (const functionName of ['first', 'second'] as const) {
				const carrier = await client.readContract({ abi: artifact.abi, address, functionName })
				const runtime = await client.getCode({ address: carrier })
				if (runtime === undefined) throw new Error('Missing bytecode carrier')
				expect(runtime.startsWith('0x00')).toBe(true)
				expect((runtime.length - 2) / 2).toBeLessThanOrEqual(24_576)
			}
		})
	}
	for (const length of [0, 49_151]) {
		test(`rejects an invalid ${length}-byte payload`, async () => {
			const code: Hex = `0x${'01'.repeat(length)}`
			await expect(client.writeContract({ abi: artifact.abi, address, functionName: 'store', args: [code] })).rejects.toThrow('Invalid creation code length')
		})
	}
})
