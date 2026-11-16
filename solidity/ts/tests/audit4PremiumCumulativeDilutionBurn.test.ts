import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as artifact } from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// `createChild` burns a branch's premium cash when `parent.units / cash` exceeds its limit.
// That ratio is cumulative over a lineage: every fork multiplies it by the inverse of
// the chosen share, and new funding is priced at the inherited ratio. With a limit of 1e9,
// three forks each chosen by 0.1% of commitment made a later branch chosen by 49% of
// commitment count as dust. The limit of 1e12 keeps that branch's premium.
describe('audit4: the inherited premium unit ratio accumulates across forks', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const fund = (universe: bigint, id: bigint, cash: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'fund', args: [universe, id, cash] }))
	const freeze = (universe: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [universe] }))
	const choose = (source: bigint, child: bigint, chosen: bigint, total: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [source, child, chosen, total] }))
	const createChild = (source: bigint, child: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [source, child] }))
	const totals = async (universe: bigint) => {
		const [cash, units] = await client.readContract({ ...target(), functionName: 'totals', args: [universe] })
		return { cash, units }
	}
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		await node.getAnvilWindowEthereum().advanceTime(10_000_000n)
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Missing premium ledger deployment')
		address = receipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'register', args: [0n, 0] }))
		await node.setBaselineSnapshot()
	})

	test('a branch chosen by 49% of commitment keeps its premium after three thin forks', async () => {
		const ether = 10n ** 18n
		// Three generations: 1 ETH of premium is funded, then 0.1% of commitment chooses the branch.
		for (const generation of [0n, 1n, 2n]) {
			await fund(generation, generation + 1n, ether)
			await freeze(generation)
			await choose(generation, generation + 1n, 1n, 1_000n)
			await createChild(generation, generation + 1n)
			const child = await totals(generation + 1n)
			// Each thin branch keeps its inherited units.
			expect(child.units / child.cash).toBe(1_000n ** (generation + 1n))
		}
		// The fourth universe is active: its buyers fund 10 ETH of premium at the inherited ratio.
		await fund(3n, 4n, 10n * ether)
		const parentBefore = await totals(3n)
		await freeze(3n)
		// 49% of commitment chooses branch 4.
		await choose(3n, 4n, 49n, 100n)
		const assigned = await client.readContract({ ...target(), functionName: 'branchCash', args: [4n] })
		expect(assigned).toBeGreaterThan((49n * ether) / 10n)
		const totalBefore = await client.readContract({ ...target(), functionName: 'totalCash' })
		await createChild(3n, 4n)
		// The branch inherits its whole share and nothing is burned.
		expect(await totals(4n)).toEqual({ cash: assigned, units: parentBefore.units })
		expect((await totals(3n)).cash).toBe(parentBefore.cash)
		expect(await client.readContract({ ...target(), functionName: 'totalCash' })).toBe(totalBefore)
	})
})
