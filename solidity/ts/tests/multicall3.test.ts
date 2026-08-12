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

	const executeCall = async (address: Address, data: Hex, value = 0n) => {
		await writeContractAndWait(client, () =>
			client.sendTransaction({
				to: address,
				data,
				value,
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

	test('every required-success aggregate variant exposes the canonical call failure', async () => {
		const multicall = await deployMulticall()
		const abi = peripherals_Multicall3_Multicall3.abi
		const failingCall = { callData: '0xdeadbeef' as Hex, target: multicall }
		const failureCases = [
			encodeFunctionData({ abi, functionName: 'aggregate', args: [[failingCall]] }),
			encodeFunctionData({ abi, functionName: 'tryAggregate', args: [true, [failingCall]] }),
			encodeFunctionData({ abi, functionName: 'tryBlockAndAggregate', args: [true, [failingCall]] }),
			encodeFunctionData({ abi, functionName: 'blockAndAggregate', args: [[failingCall]] }),
			encodeFunctionData({
				abi,
				functionName: 'aggregate3',
				args: [[{ ...failingCall, allowFailure: false }]],
			}),
			encodeFunctionData({
				abi,
				functionName: 'aggregate3Value',
				args: [[{ ...failingCall, allowFailure: false, value: 0n }]],
			}),
		]

		for (const data of failureCases) {
			await assert.rejects(executeCall(multicall, data), /Multicall3: call failed/)
		}
		assert.strictEqual(await client.getBalance({ address: multicall }), 0n, 'rejected aggregate calls must not retain ETH')
	})

	test('aggregate3Value rejects a value mismatch and rolls back successful subcalls', async () => {
		const multicall = await deployMulticall()
		const recipient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0).account.address
		const recipientBalanceBefore = await client.getBalance({ address: recipient })
		const multicallBalanceBefore = await client.getBalance({ address: multicall })
		const data = encodeFunctionData({
			abi: peripherals_Multicall3_Multicall3.abi,
			functionName: 'aggregate3Value',
			args: [
				[
					{
						allowFailure: false,
						callData: '0x',
						target: recipient,
						value: 1n,
					},
				],
			],
		})

		await assert.rejects(executeCall(multicall, data, 2n), /Multicall3: value mismatch/)
		assert.strictEqual(await client.getBalance({ address: recipient }), recipientBalanceBefore, 'value mismatch must roll back successful value subcalls')
		assert.strictEqual(await client.getBalance({ address: multicall }), multicallBalanceBefore, 'value mismatch must not retain the excess msg.value')
	})
})
