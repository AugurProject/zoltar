import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { encodeDeployData, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { applyLibraries } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import {
	peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker,
	peripherals_SecurityPoolMigrationProxy_SecurityPoolMigrationProxy,
	test_peripherals_FalseReturningERC20_FalseReturningERC20,
	test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness,
	test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar,
} from '../types/contractArtifact'

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
				abi: test_peripherals_FalseReturningERC20_FalseReturningERC20.abi,
				bytecode: `0x${test_peripherals_FalseReturningERC20_FalseReturningERC20.evm.bytecode.object}`,
			}),
		)

	const deployHarness = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
				bytecode: `0x${test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness.evm.bytecode.object}`,
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
					abi: test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
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
					abi: test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
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
					abi: test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
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

	test('security pool deployment worker bubbles constructor revert reasons', async () => {
		const fakeZoltar = await deployContract(
			encodeDeployData({
				abi: test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar.abi,
				bytecode: `0x${test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar.evm.bytecode.object}`,
			}),
		)
		const deploymentWorker = await deployContract(
			encodeDeployData({
				abi: peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.abi,
				bytecode: applyLibraries(peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.evm.bytecode.object),
			}),
		)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.abi,
					address: deploymentWorker,
					functionName: 'deploy',
					args: [zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, fakeZoltar, 0n, 0n, 2n, 1n, zeroAddress],
				}),
			),
			/SafeERC20Ops token address must contain contract code/,
		)
	})
})
