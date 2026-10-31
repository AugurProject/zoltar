import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as artifact, test_statoblast_CommitmentIndexHarness_CommitmentIndexHarness as harnessArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

describe('Statoblast: targeted retirement preview', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	let harness: Address
	const preview = (id: bigint, price: bigint, demand: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'previewRetirement', args: [id, price, demand] })
	const account = (id: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'accountOf', args: [id] })
	const create = async (rep: bigint, commitment: bigint, price: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'create', args: [addressString(rep + commitment + price), rep, commitment, price] }))
		return client.readContract({ abi: artifact.abi, address, functionName: 'lastPositionId' })
	}
	const request = (id: bigint, remaining: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'requestPartial', args: [id, remaining] }))
	const retire = (id: bigint, price: bigint, demand: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'retirePosition', args: [id, price, demand] }))
	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${harnessArtifact.evm.bytecode.object}` }) })
		if (receipt.contractAddress === undefined) throw new Error('Commitment harness deployment address missing')
		harness = receipt.contractAddress
		address = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'index' })
		await setBaselineSnapshot()
	})

	test('normalizes the first pending cohort without counting active roots as earlier requests', async () => {
		await create(100n, 10n, 20n)
		const id = await create(60n, 6n, 20n)
		await request(id, 2n)
		expect(await preview(id, 10n, 12n)).toEqual({ status: 5n, effectiveCurrentBatch: 1n, healthyCommitment: 16n, spareCommitment: 4n, queuedAheadCommitment: 0n, commitmentReduction: 4n, releasedRep: 0n })
		expect(await client.readContract({ abi: artifact.abi, address, functionName: 'currentBatch' })).toBe(0n)
		await retire(id, 10n, 12n)
		expect(await account(id)).toMatchObject({ batch: 0n, rep: 60n, commitment: 2n })
		expect((await preview(id, 10n, 12n)).status).toBe(0n)
	})

	test('reports debt, priority and full-reduction shortfalls separately without changing state', async () => {
		const later = await create(80n, 8n, 20n)
		const earlier = await create(90n, 9n, 30n)
		await request(later, 3n)
		await request(earlier, 5n)
		expect(await preview(later, 10n, 18n)).toMatchObject({ status: 2n, commitmentReduction: 5n, releasedRep: 0n })
		expect(await preview(later, 10n, 15n)).toMatchObject({ status: 3n, spareCommitment: 2n, queuedAheadCommitment: 4n })
		expect(await preview(later, 10n, 12n)).toMatchObject({ status: 4n, spareCommitment: 5n, queuedAheadCommitment: 4n })
		expect(await preview(later, 10n, 8n)).toMatchObject({ status: 5n, spareCommitment: 9n, queuedAheadCommitment: 4n })
		await retire(later, 10n, 12n)
		expect((await account(later)).commitment).toBe(8n)
		await retire(later, 10n, 8n)
		expect((await account(later)).commitment).toBe(3n)
	})

	test('unhealthy targets preserve healthy earlier reductions but need no own healthy spare', async () => {
		const unhealthy = await create(50n, 5n, 5n)
		const healthy = await create(70n, 7n, 20n)
		await request(unhealthy, 0n)
		await request(healthy, 4n)
		expect(await preview(unhealthy, 10n, 5n)).toMatchObject({ status: 3n, queuedAheadCommitment: 3n, commitmentReduction: 5n, releasedRep: 50n })
		expect(await preview(unhealthy, 10n, 4n)).toMatchObject({ status: 5n, spareCommitment: 3n })
		await retire(unhealthy, 10n, 4n)
		expect((await account(unhealthy)).releasedRep).toBe(50n)
		expect(await preview(unhealthy, 10n, 4n)).toMatchObject({ status: 0n, commitmentReduction: 0n, releasedRep: 0n })
	})

	test('recognizes lazy bulk retirement and unknown or active positions without a mutating claim', async () => {
		const first = await create(50n, 5n, 20n)
		const second = await create(60n, 6n, 20n)
		expect((await preview(first, 10n, 0n)).status).toBe(0n)
		expect((await preview(999n, 10n, 0n)).status).toBe(0n)
		await request(first, 0n)
		await request(second, 0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'retire', args: [10n, 0n] }))
		for (const id of [first, second]) expect(await preview(id, 10n, 0n)).toMatchObject({ status: 0n, commitmentReduction: 0n, releasedRep: 0n })
	})

	test('reserves closed-cohort reductions before newer requests and promotes an emptied cohort in the view', async () => {
		const older = await create(90n, 9n, 30n)
		await request(older, 5n)
		await retire(older, 10n, 9n)
		const newer = await create(80n, 8n, 40n)
		await request(newer, 3n)
		expect(await preview(newer, 10n, 12n)).toMatchObject({ status: 4n, effectiveCurrentBatch: 1n, queuedAheadCommitment: 4n })
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'cancel', args: [older] }))
		expect(await preview(newer, 10n, 12n)).toMatchObject({ status: 5n, effectiveCurrentBatch: 2n, queuedAheadCommitment: 0n })
		await retire(newer, 10n, 12n)
		expect((await account(newer)).commitment).toBe(3n)
	})

	test('marks imported retirement unavailable until sealed while preserving its target and cohort priority', async () => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'initCohorts', args: [7n, 8n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importPartial', args: [addressString(1n), 90n, 9n, 30n, 7n, 5n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importPartial', args: [addressString(2n), 80n, 8n, 40n, 8n, 3n] }))
		expect(await preview(2n, 10n, 8n)).toMatchObject({ status: 1n, effectiveCurrentBatch: 7n, queuedAheadCommitment: 4n, commitmentReduction: 5n })
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'sealImports' }))
		expect((await preview(2n, 10n, 8n)).status).toBe(5n)
		await retire(2n, 10n, 8n)
		expect((await account(2n)).commitment).toBe(3n)
	})
})
