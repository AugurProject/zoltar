import { encodeDeployData, encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { deployContract } from '../testSupport/deployContract'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../testSupport/simulator/utils/assert'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact, statoblast_WETH9_WETH9 } from '../types/contractArtifact'

describe('WETH9 failure guards', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let operatorClient: WriteClient

	const deployWeth = async () =>
		await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_WETH9_WETH9.abi,
				bytecode: `0x${statoblast_WETH9_WETH9.evm.bytecode.object}`,
			}),
		)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		operatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await setupTestAccounts(mockWindow)
	})

	test('withdraw and direct transfer reject amounts above the caller balance without changing state', async () => {
		const weth = await deployWeth()
		const abi = statoblast_WETH9_WETH9.abi

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
		const abi = statoblast_WETH9_WETH9.abi
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
			client,
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
						abi: statoblast_WETH9_WETH9.abi,
						functionName: 'deposit',
						args: [],
					}),
				],
				value: amount,
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_WETH9_WETH9.abi,
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
							abi: statoblast_WETH9_WETH9.abi,
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
				abi: statoblast_WETH9_WETH9.abi,
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
