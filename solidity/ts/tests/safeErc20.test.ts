import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { encodeDeployData, type Hex } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { peripherals_SecurityPoolMigrationProxy_SecurityPoolMigrationProxy, peripherals_test_FalseReturningERC20_FalseReturningERC20, peripherals_test_SafeERC20OpsHarness_SafeERC20OpsHarness } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Safe ERC20 Operations', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	const deployContract = async (deploymentData: Hex) => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const deployFalseReturningToken = async () =>
		await deployContract(
			encodeDeployData({
				abi: peripherals_test_FalseReturningERC20_FalseReturningERC20.abi,
				bytecode: `0x${peripherals_test_FalseReturningERC20_FalseReturningERC20.evm.bytecode.object}`,
			}),
		)

	const deployHarness = async () =>
		await deployContract(
			encodeDeployData({
				abi: peripherals_test_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
				bytecode: `0x${peripherals_test_SafeERC20OpsHarness_SafeERC20OpsHarness.evm.bytecode.object}`,
			}),
		)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
	})

	test('safe helper wrappers reject false-returning ERC20 calls', async () => {
		const falseToken = await deployFalseReturningToken()
		const harness = await deployHarness()
		const receiver = client.account.address
		if (receiver === null) throw new Error('receiver address missing')

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_test_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeApproveToken',
					args: [falseToken, receiver, 1n],
				}),
			),
			/token returned false/i,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_test_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeTransferToken',
					args: [falseToken, receiver, 1n],
				}),
			),
			/token returned false/i,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_test_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeTransferFromToken',
					args: [falseToken, receiver, receiver, 1n],
				}),
			),
			/token returned false/i,
		)
	})

	test('migration proxy constructor rejects false-returning approval tokens', async () => {
		const falseToken = await deployFalseReturningToken()
		const dummyZoltar = client.account.address
		if (dummyZoltar === null) throw new Error('dummy zoltar address missing')
		const owner = client.account.address
		if (owner === null) throw new Error('owner address missing')
		const deploymentData = encodeDeployData({
			abi: peripherals_SecurityPoolMigrationProxy_SecurityPoolMigrationProxy.abi,
			bytecode: `0x${peripherals_SecurityPoolMigrationProxy_SecurityPoolMigrationProxy.evm.bytecode.object}`,
			args: [dummyZoltar, falseToken, 0n, owner],
		})

		await assert.rejects(
			writeContractAndWait(client, () => client.sendTransaction({ data: deploymentData })),
			/token returned false/i,
		)
	})
})
