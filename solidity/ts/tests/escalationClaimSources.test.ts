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

	const deploySourceNode = async (sourceGame: `0x${string}`) =>
		await deploy(
			encodeDeployData({
				abi: sourceNodeArtifact.abi,
				bytecode: `0x${sourceNodeArtifact.evm.bytecode.object}`,
				args: [sourceGame],
			}),
		)

	beforeEach(async () => {
		const mockWindow: AnvilWindowEthereum = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
	})

	test('accepts eight registries and rejects a ninth without an unbounded loop', async () => {
		const harness = await deploy(
			encodeDeployData({
				abi: sourcesHarnessArtifact.abi,
				bytecode: `0x${sourcesHarnessArtifact.evm.bytecode.object}`,
			}),
		)
		const games: `0x${string}`[] = []
		let sourceGame = zeroAddress
		for (let gameIndex = 0; gameIndex < 9; gameIndex++) {
			sourceGame = await deploySourceNode(sourceGame)
			games.push(sourceGame)
		}

		const [collectedGames, gameCount] = await client.readContract({
			abi: sourcesHarnessArtifact.abi,
			address: harness,
			functionName: 'collect',
			args: [games[7]],
		})
		assert.strictEqual(gameCount, 8n, 'the production traversal helper should accept exactly eight registries')
		assert.deepStrictEqual(collectedGames, games.slice(0, 8).reverse(), 'the complete supported chain should be returned from the current game through its ancestors')

		await assert.rejects(
			client.readContract({
				abi: sourcesHarnessArtifact.abi,
				address: harness,
				functionName: 'collect',
				args: [games[8]],
			}),
			/Claim depth/,
		)
	})
})
