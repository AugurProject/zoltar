import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { DAY, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import assert from '../testSupport/simulator/utils/assert'
import { readClaimCheckpointBatch } from '../testSupport/simulator/utils/contracts/claimCheckpoints'
import { test_statoblast_EscalationClaimSourcesHarness_EscalationClaimSourcesHarness as artifact, test_statoblast_EscalationClaimCheckpointHarness_EscalationClaimCheckpointHarness as checkpointArtifact } from '../types/contractArtifact'

describe('Escalation claim interval checkpoints', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient

	const deploy = async (source: Address, before: bigint, remaining: bigint) => {
		const hash = await client.sendTransaction({ data: `0x${artifact.evm.bytecode.object}` })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const address = receipt.contractAddress
		if (address === undefined) throw new Error('Deployment address missing')
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'configure', args: [source, before, remaining] }))
		return address
	}

	const deployCheckpointSource = async (source: Address, before: bigint, remaining: bigint) => {
		const hash = await client.sendTransaction({ data: encodeDeployData({ abi: checkpointArtifact.abi, bytecode: `0x${checkpointArtifact.evm.bytecode.object}`, args: [source, source === zeroAddress ? 0n : 2n, before, remaining, 0n] }) })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined) throw new Error('Checkpoint source deployment address missing')
		return receipt.contractAddress
	}

	beforeEach(async () => {
		const ethereum = getAnvilWindowEthereum()
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
		await ethereum.setTime(16n * 7n * DAY)
	})

	test('nine successive non-dyadic haircuts telescope exactly at every checkpoint', async () => {
		let source = await deployCheckpointSource(zeroAddress, 0n, 0n)
		const firstAmount = 8n * 10n ** 18n + 3n
		const secondAmount = firstAmount + 2n
		let firstEnd = firstAmount
		let totalEnd = firstAmount + secondAmount
		for (let depth = 0; depth < 9; depth++) {
			const descendant = await deployCheckpointSource(source, 7n, 5n)
			firstEnd = (firstEnd * 5n) / 7n
			totalEnd = (totalEnd * 5n) / 7n
			for (const tuple of [
				[1, firstAmount, firstAmount, 0n],
				[1, secondAmount, firstAmount + secondAmount, 1n],
			] as const) {
				const progress = () => client.readContract({ abi: checkpointArtifact.abi, address: descendant, functionName: 'getClaimCheckpointProgress', args: tuple })
				assert.strictEqual((await progress())[3], depth < 8, 'only claims within the bounded read depth should be ready without preparation')
				if (depth < 8) continue
				await assert.rejects(client.readContract({ abi: checkpointArtifact.abi, address: descendant, functionName: 'getInheritedClaimAllocation', args: tuple }), /Claim checkpoint required/)
				for (let transaction = 0; transaction < 3 && !(await progress())[2]; transaction++) {
					const batch = await readClaimCheckpointBatch(client, descendant, tuple)
					await writeContractAndWait(client, () => client.writeContract({ abi: checkpointArtifact.abi, address: descendant, functionName: 'processClaimCheckpoint', args: [...tuple, 8n, batch.baseCommitment, batch.transforms] }))
				}
				assert.strictEqual((await progress())[2], true, 'the deep claim checkpoint should finish in bounded transactions')
			}
			const first = await client.readContract({ abi: artifact.abi, address: descendant, functionName: 'getInheritedClaimAllocation', args: [1, firstAmount, firstAmount, 0n] })
			const second = await client.readContract({ abi: artifact.abi, address: descendant, functionName: 'getInheritedClaimAllocation', args: [1, secondAmount, firstAmount + secondAmount, 1n] })
			assert.strictEqual(first.retainedAmountAttoRep, firstEnd)
			assert.strictEqual(second.retainedAmountAttoRep, totalEnd - firstEnd)
			assert.strictEqual(first.retainedAmountAttoRep + second.retainedAmountAttoRep, totalEnd)
			source = descendant
		}
	})

	test('export compacts a removed prefix before applying the next haircut', async () => {
		const root = await deploy(zeroAddress, 0n, 0n)
		const child = await deploy(root, 2n, 1n)
		const firstAmount = 8n * 10n ** 18n + 3n
		const secondAmount = firstAmount + 2n
		const firstRetained = firstAmount / 2n
		const secondRetained = (firstAmount + secondAmount) / 2n - firstRetained
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: child, functionName: 'consume', args: [0n, firstRetained] }))
		const grandchild = await deploy(child, 4n, 3n)
		const allocation = await client.readContract({ abi: artifact.abi, address: grandchild, functionName: 'getInheritedClaimAllocation', args: [1, secondAmount, firstAmount + secondAmount, 1n] })
		assert.strictEqual(allocation.sourceAmountAttoRep, secondRetained)
		assert.strictEqual(allocation.retainedAmountAttoRep, (secondRetained * 3n) / 4n)
		assert.strictEqual(allocation.retainedCumulativeAttoRep, (((firstAmount + secondAmount) / 2n) * 3n) / 4n, 'removing principal must preserve the original reward position')
	})
})
