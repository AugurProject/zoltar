import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { peripherals_WETH9_WETH9, test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('WETH9 failure guards', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let operatorClient: WriteClient

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const deployWeth = async () =>
		await deployContract(
			encodeDeployData({
				abi: peripherals_WETH9_WETH9.abi,
				bytecode: `0x${peripherals_WETH9_WETH9.evm.bytecode.object}`,
			}),
		)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		operatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await setupTestAccounts(mockWindow)
	})

	test('withdraw and direct transfer reject amounts above the caller balance without changing state', async () => {
		const weth = await deployWeth()
		const abi = peripherals_WETH9_WETH9.abi

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi,
					address: weth,
					functionName: 'withdraw',
					args: [1n],
				}),
			),
			/reverted/i,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi,
					address: weth,
					functionName: 'transfer',
					args: [operatorClient.account.address, 1n],
				}),
			),
			/reverted/i,
		)
		assert.strictEqual(
			await client.readContract({
				abi,
				address: weth,
				functionName: 'balanceOf',
				args: [client.account.address],
			}),
			0n,
			'rejected balance guards must leave the caller WETH balance unchanged',
		)
		assert.strictEqual(await client.getBalance({ address: weth }), 0n, 'rejected balance guards must leave WETH collateral unchanged')
	})

	test('delegated transfer rejects an insufficient allowance and preserves balances and allowance', async () => {
		const weth = await deployWeth()
		const abi = peripherals_WETH9_WETH9.abi
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi,
				address: weth,
				functionName: 'deposit',
				args: [],
				value: 1n,
			}),
		)

		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi,
					address: weth,
					functionName: 'transferFrom',
					args: [client.account.address, operatorClient.account.address, 1n],
				}),
			),
			/reverted/i,
		)

		assert.strictEqual(
			await client.readContract({
				abi,
				address: weth,
				functionName: 'balanceOf',
				args: [client.account.address],
			}),
			1n,
			'rejected delegated transfer must retain the source balance',
		)
		assert.strictEqual(
			await client.readContract({
				abi,
				address: weth,
				functionName: 'balanceOf',
				args: [operatorClient.account.address],
			}),
			0n,
			'rejected delegated transfer must not credit the destination',
		)
		assert.strictEqual(
			await client.readContract({
				abi,
				address: weth,
				functionName: 'allowance',
				args: [client.account.address, operatorClient.account.address],
			}),
			0n,
			'rejected delegated transfer must preserve the allowance',
		)
	})

	test('withdraw rolls back the burned WETH when the caller rejects the ETH transfer', async () => {
		const weth = await deployWeth()
		const receiver = await deployContract(
			encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		)
		const amount = 1n

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: rejectingEthReceiverArtifact.abi,
				address: receiver,
				functionName: 'execute',
				args: [
					weth,
					encodeFunctionData({
						abi: peripherals_WETH9_WETH9.abi,
						functionName: 'deposit',
						args: [],
					}),
				],
				value: amount,
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_WETH9_WETH9.abi,
				address: weth,
				functionName: 'balanceOf',
				args: [receiver],
			}),
			amount,
			'rejecting caller should hold the deposited WETH before withdrawal',
		)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: rejectingEthReceiverArtifact.abi,
					address: receiver,
					functionName: 'execute',
					args: [
						weth,
						encodeFunctionData({
							abi: peripherals_WETH9_WETH9.abi,
							functionName: 'withdraw',
							args: [amount],
						}),
					],
				}),
			),
			/reverted/i,
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_WETH9_WETH9.abi,
				address: weth,
				functionName: 'balanceOf',
				args: [receiver],
			}),
			amount,
			'failed ETH delivery must restore the caller WETH balance',
		)
		assert.strictEqual(await client.getBalance({ address: weth }), amount, 'failed ETH delivery must preserve WETH collateral')
	})
})
