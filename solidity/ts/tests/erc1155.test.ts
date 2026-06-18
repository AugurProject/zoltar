import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { peripherals_tokens_ShareToken_ShareToken, test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver, test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('ERC1155 Compliance Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let operatorClient: WriteClient

	const deployContract = async (deploymentData: Hex) => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const deployShareToken = async (questionId = 1n) =>
		await deployContract(
			encodeDeployData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
				args: [client.account.address, getZoltarAddress(), questionId],
			}),
		)

	const deployReceiver = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.evm.bytecode.object}`,
			}),
		)

	const deployNonReceiver = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver.evm.bytecode.object}`,
			}),
		)

	const mintCompleteSets = async (shareTokenAddress: Address, account: Address, amount: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'mintCompleteSets',
					args: [0n, account, amount],
				}),
		)

	const readTokenId = async (shareTokenAddress: Address, outcome: 0 | 1 | 2) =>
		await client.readContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			address: shareTokenAddress,
			functionName: 'getTokenId',
			args: [0n, outcome],
		})

	const transactWithShareToken = async (shareTokenAddress: Address, data: Hex) => await writeContractAndWait(client, async () => await client.sendTransaction({ to: shareTokenAddress, data }))

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		operatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
	})

	test('share token supports ERC165 and ERC1155 interface identifiers', async () => {
		const shareTokenAddress = await deployShareToken()
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'supportsInterface',
				args: ['0x01ffc9a7'],
			}),
			true,
			'share token should support ERC165',
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'supportsInterface',
				args: ['0xd9b67a26'],
			}),
			true,
			'share token should support ERC1155',
		)
	})

	test('safeTransferFrom rejects contract recipients that do not implement IERC1155Receiver', async () => {
		const shareTokenAddress = await deployShareToken()
		const nonReceiverAddress = await deployNonReceiver()
		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)

		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: peripherals_tokens_ShareToken_ShareToken.abi,
						address: shareTokenAddress,
						functionName: 'safeTransferFrom',
						args: [client.account.address, nonReceiverAddress, yesTokenId, 1n, '0x1234'],
					}),
			),
			/non ERC1155Receiver implementer/,
		)
	})

	test('safeTransferFrom calls the receiver hook and batch minting to a contract uses the batch hook', async () => {
		const shareTokenAddress = await deployShareToken()
		const receiverAddress = await deployReceiver()
		await mintCompleteSets(shareTokenAddress, client.account.address, 2n)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeTransferFrom',
					args: [client.account.address, receiverAddress, yesTokenId, 1n, '0x1234'],
				}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'balanceOf',
				args: [receiverAddress, yesTokenId],
			}),
			1n,
			'receiver should hold the transferred share token',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'singleReceiveCount',
				args: [],
			}),
			1n,
			'receiver hook should run for safeTransferFrom',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'lastData',
				args: [],
			}),
			'0x1234',
			'receiver should observe the transfer payload',
		)

		await mintCompleteSets(shareTokenAddress, receiverAddress, 1n)

		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'batchReceiveCount',
				args: [],
			}),
			1n,
			'batch receiver hook should run when minting complete sets to a contract',
		)
	})

	test('operator approval allows third-party single and batch transfers', async () => {
		const shareTokenAddress = await deployShareToken()
		const receiverAddress = await deployReceiver()
		await mintCompleteSets(shareTokenAddress, client.account.address, 3n)
		const invalidTokenId = await readTokenId(shareTokenAddress, 0)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)
		const noTokenId = await readTokenId(shareTokenAddress, 2)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'setApprovalForAll',
					args: [operatorClient.account.address, true],
				}),
		)

		await writeContractAndWait(
			operatorClient,
			async () =>
				await operatorClient.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeTransferFrom',
					args: [client.account.address, receiverAddress, yesTokenId, 1n],
				}),
		)

		await writeContractAndWait(
			operatorClient,
			async () =>
				await operatorClient.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeBatchTransferFrom',
					args: [client.account.address, receiverAddress, [invalidTokenId, noTokenId], [1n, 2n], '0xbeef'],
				}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'singleReceiveCount',
				args: [],
			}),
			1n,
			'single transfer receiver hook should run',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'batchReceiveCount',
				args: [],
			}),
			1n,
			'batch transfer receiver hook should run',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'lastData',
				args: [],
			}),
			'0xbeef',
			'batch receiver should observe the transfer payload',
		)
	})

	test('complete-set and token-id burns reduce ERC1155 supply', async () => {
		const shareTokenAddress = await deployShareToken()
		await mintCompleteSets(shareTokenAddress, client.account.address, 5n)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'burnCompleteSets',
					args: [0n, client.account.address, 2n],
				}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'totalSupply',
				args: [yesTokenId],
			}),
			3n,
			'batch burn should reduce the token supply',
		)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'burnTokenId',
					args: [yesTokenId, client.account.address],
				}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'totalSupply',
				args: [yesTokenId],
			}),
			0n,
			'single-token burn should clear the remaining supply',
		)
	})

	test('read-only ERC1155 and share-token helpers execute as transactions for bytecode coverage', async () => {
		const shareTokenAddress = await deployShareToken()
		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		const invalidTokenId = await readTokenId(shareTokenAddress, 0)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)
		const noTokenId = await readTokenId(shareTokenAddress, 2)

		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'supportsInterface', args: ['0xd9b67a26'] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOf', args: [client.account.address, yesTokenId] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'totalSupply', args: [yesTokenId] }))
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'balanceOfBatch',
				args: [
					[client.account.address, client.account.address, client.account.address],
					[invalidTokenId, yesTokenId, noTokenId],
				],
			}),
		)
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'isApprovedForAll', args: [client.account.address, operatorClient.account.address] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'getTokenIds', args: [0n, [0, 1, 2]] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'unpackTokenId', args: [yesTokenId] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'totalSupplyForOutcome', args: [0n, 1] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOfOutcome', args: [0n, 1, client.account.address] }))
		await transactWithShareToken(shareTokenAddress, encodeFunctionData({ abi: peripherals_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOfShares', args: [0n, client.account.address] }))

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'balanceOf',
				args: [client.account.address, yesTokenId],
			}),
			1n,
			'read-only transaction execution should not change token balances',
		)
	})
})
