import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, maxUint256, type Address } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_CheckedTimestampHarness_CheckedTimestampHarness as artifact } from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

describe('checked protocol timestamps', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	beforeAll(async () => {
		const mock = getAnvilWindowEthereum()
		await setupTestAccounts(mock)
		client = createWriteClient(mock, TEST_ADDRESSES[0])
		address = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
		await setBaselineSnapshot()
	})
	test('#1357 preserves representable timestamps and rejects silent truncation', async () => {
		const convert = (value: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'convert', args: [value] })
		for (const value of [0n, 1n, (1n << 48n) - 1n]) expect(await convert(value)).toBe(value)
		for (const value of [1n << 48n, maxUint256]) await expect(convert(value)).rejects.toThrow('Timestamp exceeds uint48')
	})
})
