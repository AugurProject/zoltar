import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { encodeDeployData, type Address, type Hex } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder as seederArtifact, test_chaos_GenesisUniswapV3SeederMocks_GenesisSeederPoolMock as poolArtifact, test_chaos_GenesisUniswapV3SeederMocks_GenesisSeederTokenMock as tokenArtifact } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('GenesisUniswapV3Seeder', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient

	const deploy = async (data: Hex): Promise<Address> => {
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	beforeEach(async () => {
		const mockWindow: AnvilWindowEthereum = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
	})

	test('pays only the authenticated callback request and refunds unused token maxima', async () => {
		const token0 = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }))
		const token1 = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }))
		const pool = await deploy(encodeDeployData({ abi: poolArtifact.abi, args: [60n, 80n], bytecode: `0x${poolArtifact.evm.bytecode.object}` }))
		const seeder = await deploy(encodeDeployData({ abi: seederArtifact.abi, bytecode: `0x${seederArtifact.evm.bytecode.object}` }))
		for (const token of [token0, token1]) {
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, args: [client.account.address, 100n], functionName: 'mint' }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, args: [seeder, 100n], functionName: 'approve' }))
		}
		await writeContractAndWait(client, () => client.writeContract({ abi: seederArtifact.abi, address: seeder, args: [pool, token0, token1, -887_200, 887_200, 50n, 100n, 100n, client.account.address], functionName: 'seed' }))
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token0, args: [pool], functionName: 'balanceOf' }), 60n)
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token1, args: [pool], functionName: 'balanceOf' }), 80n)
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token0, args: [client.account.address], functionName: 'balanceOf' }), 40n)
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token1, args: [client.account.address], functionName: 'balanceOf' }), 20n)
	})
})
