import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as artifact } from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// A child premium book whose branch received no chosen commitment, or a share that rounds
// to zero, must not inherit parent premium units without cash: `fund` would revert for every
// question of that universe. A dust-funded child must also still be able to schedule.
describe('audit: an unfunded or dust-funded child premium book stays usable', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const register = (universe: bigint, securityPoolTimestamp: number) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'register', args: [universe, securityPoolTimestamp] }))
	const fund = (universe: bigint, id: bigint, cash: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'fund', args: [universe, id, cash] }))
	const freeze = (universe: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [universe] }))
	const choose = (source: bigint, child: bigint, chosen: bigint, total: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [source, child, chosen, total] }))
	const createChild = (source: bigint, child: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [source, child] }))
	const schedule = (universe: bigint, id: bigint, finalAfterSecurityPoolTime: number) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'schedule', args: [universe, id, finalAfterSecurityPoolTime] }))
	const totals = async (universe: bigint) => {
		const [cash, units] = await client.readContract({ ...target(), functionName: 'totals', args: [universe] })
		return { cash, units }
	}
	const question = async (universe: bigint, id: bigint) => {
		const [units, cash] = await client.readContract({ ...target(), functionName: 'question', args: [universe, id] })
		return { units, cash }
	}
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		await node.getAnvilWindowEthereum().advanceTime(10_000_000n)
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Missing premium ledger deployment')
		address = receipt.contractAddress
		await register(0n, 0)
		await node.setBaselineSnapshot()
	})

	test('a branch nobody chose starts with an empty book and prices new premium at par', async () => {
		// Question 1 is still trading in the parent: funded, never scheduled.
		await fund(0n, 1n, 10n ** 18n)
		await freeze(0n)
		// No owner chose branch 1.
		await createChild(0n, 1n)
		expect(await totals(1n)).toEqual({ cash: 0n, units: 0n })
		expect(await question(1n, 1n)).toEqual({ units: 0n, cash: 0n })
		// A new question and the inherited one can both fund a premium, each owning exactly its cash.
		await fund(1n, 2n, 10n ** 15n)
		await fund(1n, 1n, 3n * 10n ** 15n)
		expect(await question(1n, 2n)).toEqual({ units: 10n ** 15n, cash: 10n ** 15n })
		expect(await question(1n, 1n)).toEqual({ units: 3n * 10n ** 15n, cash: 3n * 10n ** 15n })
		// The parent keeps the whole premium for source recovery.
		expect(await totals(0n)).toEqual({ cash: 10n ** 18n, units: 10n ** 18n })
	})

	test('a chosen share that rounds to zero cash also starts empty', async () => {
		await fund(0n, 1n, 1_000n)
		await freeze(0n)
		// chosen commitment 1 of 10_000: floor(1_000 * 1 / 10_000) == 0
		await choose(0n, 1n, 1n, 10_000n)
		await createChild(0n, 1n)
		await fund(1n, 2n, 10n ** 15n)
		expect(await question(1n, 2n)).toEqual({ units: 10n ** 15n, cash: 10n ** 15n })
	})

	test('a child funded only with dust starts empty and the dust is burned from the source', async () => {
		// Parent holds 1e18 premium units; the chosen share leaves the child 1 attoETH of cash.
		await fund(0n, 1n, 10n ** 18n)
		await freeze(0n)
		await choose(0n, 1n, 1n, 10n ** 18n)
		// The book reports the dust for the caller to burn and removes it from its own custody.
		const { result: dust } = await client.simulateContract({ ...target(), functionName: 'createChild', args: [0n, 1n] })
		expect(dust).toBe(1n)
		await createChild(0n, 1n)
		expect(await totals(1n)).toEqual({ cash: 0n, units: 0n })
		expect(await client.readContract({ ...target(), functionName: 'branchCash', args: [1n] })).toBe(0n)
		expect(await totals(0n)).toEqual({ cash: 10n ** 18n - 1n, units: 10n ** 18n })
		expect(await client.readContract({ ...target(), functionName: 'totalCash' })).toBe(10n ** 18n - 1n)
		// Recovering the whole source supply returns every unit of cash the source still holds:
		// the neutral cash is the same as before the child existed, and nothing is stranded.
		const { result } = await client.simulateContract({ ...target(), functionName: 'recover', args: [0n, 1n, 5n, 5n] })
		expect(result).toBe(10n ** 18n - 1n)
		await fund(1n, 2n, 10n ** 18n)
		await schedule(1n, 2n, 0)
		expect(await question(1n, 2n)).toEqual({ units: 10n ** 18n, cash: 10n ** 18n })
	})

	test('a thinly funded child can still schedule reporting when its scaled premium rate exceeds the former uint96 domain', async () => {
		// The child keeps one billionth of the cash, so new premium buys a billion units per token unit.
		await fund(0n, 1n, 10n ** 18n)
		await freeze(0n)
		await choose(0n, 1n, 1n, 10n ** 9n)
		await createChild(0n, 1n)
		expect(await totals(1n)).toEqual({ cash: 10n ** 9n, units: 10n ** 18n })
		const funded = 10n ** 20n
		await fund(1n, 2n, funded)
		// 1e38 scaled units fit the uint128 book; their 52-day rate exceeds the former uint96 domain.
		await schedule(1n, 2n, 0)
		expect(await question(1n, 2n)).toEqual({ units: funded * 10n ** 9n, cash: funded })
	})
})
