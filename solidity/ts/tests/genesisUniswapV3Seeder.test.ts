import { beforeEach, describe, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder as seederArtifact, test_chaos_GenesisUniswapV3SeederMocks_GenesisSeederPoolMock as poolArtifact, test_chaos_GenesisUniswapV3SeederMocks_GenesisSeederTokenMock as tokenArtifact } from '../types/contractArtifact'

describe('GenesisUniswapV3Seeder', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient

	const deploy = async (data: Hex): Promise<Address> => {
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data }) })
		if (receipt.contractAddress === undefined) throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	beforeEach(async () => {
		const mockWindow: AnvilWindowEthereum = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
	})

	test('preserves existing balances and accepts callbacks only during the mint (#1400, #1401)', async () => {
		const token0 = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }))
		const token1 = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }))
		const pool = await deploy(encodeDeployData({ abi: poolArtifact.abi, args: [60n, 80n], bytecode: `0x${poolArtifact.evm.bytecode.object}` }))
		const seeder = await deploy(encodeDeployData({ abi: seederArtifact.abi, bytecode: `0x${seederArtifact.evm.bytecode.object}` }))
		const callback = encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }], [client.account.address, token0, token1, 0n, 0n])
		const checkIdle = () =>
			assert.rejects(
				writeContractAndWait(client, () => client.writeContract({ abi: seederArtifact.abi, address: seeder, args: [0n, 0n, callback], functionName: 'uniswapV3MintCallback' })),
				/Unexpected pool/,
			)
		await checkIdle()
		for (const token of [token0, token1]) {
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, args: [seeder, 7n], functionName: 'mint' }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, args: [client.account.address, 100n], functionName: 'mint' }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, args: [seeder, 100n], functionName: 'approve' }))
		}
		await writeContractAndWait(client, () => client.writeContract({ abi: seederArtifact.abi, address: seeder, args: [pool, token0, token1, -887_200, 887_200, 50n, 100n, 100n, client.account.address], functionName: 'seed' }))
		await checkIdle()
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token0, args: [pool], functionName: 'balanceOf' }), 60n)
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token1, args: [pool], functionName: 'balanceOf' }), 80n)
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token0, args: [client.account.address], functionName: 'balanceOf' }), 40n)
		assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token1, args: [client.account.address], functionName: 'balanceOf' }), 20n)
		for (const token of [token0, token1]) {
			assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token, args: [seeder], functionName: 'balanceOf' }), 7n)
		}
	})
	test.each([0, 1] as const)('seeds a one-sided position with no budget or approval for the unused token (#1402), side %s', async side => {
		const token0 = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }))
		const token1 = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }))
		const fundedToken = side === 0 ? token0 : token1
		const pool = await deploy(encodeDeployData({ abi: poolArtifact.abi, args: side === 0 ? [60n, 0n] : [0n, 60n], bytecode: `0x${poolArtifact.evm.bytecode.object}` }))
		const seeder = await deploy(encodeDeployData({ abi: seederArtifact.abi, bytecode: `0x${seederArtifact.evm.bytecode.object}` }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: fundedToken, args: [client.account.address, 100n], functionName: 'mint' }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: fundedToken, args: [seeder, 100n], functionName: 'approve' }))
		const bounds = side === 0 ? ([100, 200, 100n, 0n] as const) : ([-200, -100, 0n, 100n] as const)
		await writeContractAndWait(client, () => client.writeContract({ abi: seederArtifact.abi, address: seeder, args: [pool, token0, token1, bounds[0], bounds[1], 50n, bounds[2], bounds[3], client.account.address], functionName: 'seed' }))
		for (const [index, token] of [token0, token1].entries()) {
			assert.strictEqual(await client.readContract({ abi: tokenArtifact.abi, address: token, args: [pool], functionName: 'balanceOf' }), index === side ? 60n : 0n)
		}
	})
})
