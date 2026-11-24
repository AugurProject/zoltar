import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { deployContract } from '../testSupport/deployContract'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../testSupport/simulator/utils/assert'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import {
	ReputationToken_ReputationToken,
	statoblast_factories_QuestionLedgerDeployer_QuestionLedgerDeploymentWorker,
	test_statoblast_FalseReturningERC20_FalseReturningERC20,
	test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness,
	test_statoblast_QuestionLedgerConstructorFailureZoltar_QuestionLedgerConstructorFailureZoltar,
} from '../types/contractArtifact'

describe('Safe ERC20 Operations', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	const deployFalseReturningToken = async () =>
		await deployContract(
			client,
			encodeDeployData({
				abi: test_statoblast_FalseReturningERC20_FalseReturningERC20.abi,
				bytecode: `0x${test_statoblast_FalseReturningERC20_FalseReturningERC20.evm.bytecode.object}`,
			}),
		)

	const deployHarness = async () =>
		await deployContract(
			client,
			encodeDeployData({
				abi: test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
				bytecode: `0x${test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness.evm.bytecode.object}`,
			}),
		)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
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
					abi: test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeApproveToken',
					args: [falseToken, receiver, 1n],
				}),
			),
			/SafeERC20Ops token returned false from ERC20 call/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeTransferToken',
					args: [falseToken, receiver, 1n],
				}),
			),
			/SafeERC20Ops token returned false from ERC20 call/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeTransferFromToken',
					args: [falseToken, receiver, receiver, 1n],
				}),
			),
			/SafeERC20Ops token returned false from ERC20 call/,
		)
	})

	test('safe helper wrappers replace an underlying token revert with the canonical call failure', async () => {
		const harness = await deployHarness()
		const reputationToken = await deployContract(
			client,
			encodeDeployData({
				abi: ReputationToken_ReputationToken.abi,
				bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
				args: [client.account.address],
			}),
		)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SafeERC20OpsHarness_SafeERC20OpsHarness.abi,
					address: harness,
					functionName: 'safeTransferToken',
					args: [reputationToken, client.account.address, 1n],
				}),
			),
			/SafeERC20Ops token call reverted/,
		)
	})

	test('question ledger deployment worker reports constructor failures without revert data', async () => {
		const fakeZoltar = await deployContract(
			client,
			encodeDeployData({
				abi: test_statoblast_QuestionLedgerConstructorFailureZoltar_QuestionLedgerConstructorFailureZoltar.abi,
				bytecode: `0x${test_statoblast_QuestionLedgerConstructorFailureZoltar_QuestionLedgerConstructorFailureZoltar.evm.bytecode.object}`,
			}),
		)
		const deploymentWorker = await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_factories_QuestionLedgerDeployer_QuestionLedgerDeploymentWorker.abi,
				bytecode: `0x${statoblast_factories_QuestionLedgerDeployer_QuestionLedgerDeploymentWorker.evm.bytecode.object}`,
				args: [zeroAddress, zeroAddress, zeroAddress],
			}),
		)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: statoblast_factories_QuestionLedgerDeployer_QuestionLedgerDeploymentWorker.abi,
					address: deploymentWorker,
					functionName: 'deploy',
					args: [zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, fakeZoltar, 0n, 0n, 2n],
				}),
			),
			/Question ledger deployment failed/,
		)
	})
})
