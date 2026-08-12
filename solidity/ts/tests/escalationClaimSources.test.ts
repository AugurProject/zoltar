import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { encodeDeployData, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import assert from '../testSupport/simulator/utils/assert'
import { test_peripherals_EscalationClaimSourcesHarness_EscalationClaimSourceNode as sourceNodeArtifact, test_peripherals_EscalationClaimSourcesHarness_EscalationClaimSourcesHarness as sourcesHarnessArtifact } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Escalation claim source traversal', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient

	const deploy = async (data: Hex) => {
		const hash = await client.sendTransaction({ data })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) {
			throw new Error('deployment address missing')
		}
		return receipt.contractAddress
	}

	const deploySourceNode = async (rootSource: `0x${string}`, retention: bigint, retentionExponent: bigint) =>
		await deploy(
			encodeDeployData({
				abi: sourceNodeArtifact.abi,
				bytecode: `0x${sourceNodeArtifact.evm.bytecode.object}`,
				args: [rootSource, retention, retentionExponent],
			}),
		)

	beforeEach(async () => {
		const mockWindow: AnvilWindowEthereum = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
	})

	test('applies a ninth recursive retention checkpoint without ancestry traversal', async () => {
		const harness = await deploy(
			encodeDeployData({
				abi: sourcesHarnessArtifact.abi,
				bytecode: `0x${sourcesHarnessArtifact.evm.bytecode.object}`,
			}),
		)
		const normalizedMantissa = 1n << 255n
		const rootSource = await deploySourceNode(zeroAddress, normalizedMantissa, 0n)
		await client.writeContract({
			abi: sourcesHarnessArtifact.abi,
			address: harness,
			functionName: 'configure',
			args: [rootSource, normalizedMantissa, 9n],
		})
		const retained = await client.readContract({
			abi: sourcesHarnessArtifact.abi,
			address: harness,
			functionName: 'applyRootRetention',
			args: [10n ** 18n],
		})
		assert.strictEqual(retained, (10n ** 18n) >> 9n, 'nine half-retention lineage checkpoints should resolve through one direct index ratio')
	})
})
