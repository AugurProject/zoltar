import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { peripherals_Multicall3_Multicall3 } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Multicall3', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const deployMulticall = async () =>
		await deployContract(
			encodeDeployData({
				abi: peripherals_Multicall3_Multicall3.abi,
				bytecode: `0x${peripherals_Multicall3_Multicall3.evm.bytecode.object}`,
			}),
		)

	const executeCall = async (address: Address, data: Hex) => {
		await writeContractAndWait(client, () =>
			client.sendTransaction({
				to: address,
				data,
			}),
		)
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
	})

	test('block and account helper getters execute successfully', async () => {
		const multicall = await deployMulticall()
		const account = client.account.address
		if (account === null) throw new Error('account address missing')

		const latestBlock = await client.getBlock()
		if (latestBlock.number === undefined) throw new Error('latest block number missing')
		const previousBlockNumber = latestBlock.number - 1n

		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getBlockHash', args: [previousBlockNumber] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getBlockNumber', args: [] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getCurrentBlockCoinbase', args: [] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getCurrentBlockDifficulty', args: [] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getCurrentBlockGasLimit', args: [] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getCurrentBlockTimestamp', args: [] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getEthBalance', args: [account] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getBasefee', args: [] }))
		await executeCall(multicall, encodeFunctionData({ abi: peripherals_Multicall3_Multicall3.abi, functionName: 'getChainId', args: [] }))

		const blockNumber = await client.readContract({
			abi: peripherals_Multicall3_Multicall3.abi,
			address: multicall,
			functionName: 'getBlockNumber',
			args: [],
		})
		const prevrandao = await client.readContract({
			abi: peripherals_Multicall3_Multicall3.abi,
			address: multicall,
			functionName: 'getCurrentBlockDifficulty',
			args: [],
		})
		const chainId = await client.readContract({
			abi: peripherals_Multicall3_Multicall3.abi,
			address: multicall,
			functionName: 'getChainId',
			args: [],
		})

		assert.ok(blockNumber > previousBlockNumber, 'block number should advance while getter transactions execute')
		assert.ok(prevrandao >= 0n, 'prevrandao should be readable through the compatibility getter')
		assert.strictEqual(chainId, 1n, 'test chain id mismatch')
	})
})
