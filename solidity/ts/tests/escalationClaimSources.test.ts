import { beforeEach, describe, test } from 'bun:test'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import assert from '../testSupport/simulator/utils/assert'
import { test_statoblast_EscalationClaimSourcesHarness_EscalationClaimSourcesHarness as artifact } from '../types/contractArtifact'

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

	beforeEach(async () => {
		const ethereum = getAnvilWindowEthereum()
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
	})

	test('nine successive non-dyadic haircuts telescope exactly at every checkpoint', async () => {
		let source = await deploy(zeroAddress, 0n, 0n)
		const firstAmount = 8n * 10n ** 18n + 3n
		const secondAmount = firstAmount + 2n
		let firstEnd = firstAmount
		let totalEnd = firstAmount + secondAmount
		for (let depth = 0; depth < 9; depth++) {
			const descendant = await deploy(source, 7n, 5n)
			firstEnd = (firstEnd * 5n) / 7n
			totalEnd = (totalEnd * 5n) / 7n
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
