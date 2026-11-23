import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as artifact } from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// A fork child inherits all parent premium units on only its chosen share of cash, so a thin
// but surviving branch prices new premium at many units per wei. The unit domain must leave
// such a book room for any realistic premium, while funding, schedules and finality settle
// exactly. Only shares beyond the inherited-ratio dust limit are burned.
const ether = 10n ** 18n
const UNIT_SCALE = 10n ** 9n
const WINDOW = 259_200 + 7 * 604_800
const RESPONSE = 259_200
const ceilDiv = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor

type ModelBook = { cash: bigint; units: bigint; questions: Map<bigint, bigint> }

describe('premium book: a diluted but surviving fork child keeps its funding capacity', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const register = (universe: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'register', args: [universe, 0] }))
	const freeze = (universe: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [universe] }))
	const choose = (source: bigint, child: bigint, chosen: bigint, total: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [source, child, chosen, total] }))
	const createChild = (source: bigint, child: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [source, child] }))
	const schedule = (universe: bigint, id: bigint, finalAfterPortfolioTime: number) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'schedule', args: [universe, id, finalAfterPortfolioTime] }))
	const totals = async (universe: bigint) => {
		const [cash, units] = await client.readContract({ ...target(), functionName: 'totals', args: [universe] })
		return { cash, units }
	}
	const question = async (universe: bigint, id: bigint) => {
		const [units, cash] = await client.readContract({ ...target(), functionName: 'question', args: [universe, id] })
		return { units, cash }
	}
	const totalCash = () => client.readContract({ ...target(), functionName: 'totalCash' })

	const fund = async (book: ModelBook, universe: bigint, id: bigint, cash: bigint) => {
		const units = book.units === 0n ? cash * UNIT_SCALE : ceilDiv(cash * book.units, book.cash)
		const { result } = await client.simulateContract({ ...target(), functionName: 'fund', args: [universe, id, cash] })
		expect(result).toBe(ceilDiv(units, UNIT_SCALE))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'fund', args: [universe, id, cash] }))
		book.units += units
		book.cash += cash
		book.questions.set(id, (book.questions.get(id) ?? 0n) + units)
		expect(await totals(universe)).toEqual({ cash: book.cash, units: ceilDiv(book.units, UNIT_SCALE) })
		expect(await question(universe, id)).toEqual({ units: ceilDiv(book.questions.get(id) ?? 0n, UNIT_SCALE), cash: ((book.questions.get(id) ?? 0n) * book.cash) / book.units })
	}

	// Each generation funds 1 ETH of premium on a fresh question, then forks with the given share.
	const buildLineage = async (shares: readonly (readonly [bigint, bigint])[]) => {
		await register(0n)
		let book: ModelBook = { cash: 0n, units: 0n, questions: new Map() }
		let universe = 0n
		for (const [chosen, total] of shares) {
			await fund(book, universe, universe + 1n, ether)
			await freeze(universe)
			await choose(universe, universe + 1n, chosen, total)
			const { result: dust } = await client.simulateContract({ ...target(), functionName: 'createChild', args: [universe, universe + 1n] })
			expect(dust).toBe(0n)
			await createChild(universe, universe + 1n)
			book = { cash: (book.cash * chosen) / total, units: book.units, questions: new Map(book.questions) }
			universe += 1n
			expect(await totals(universe)).toEqual({ cash: book.cash, units: ceilDiv(book.units, UNIT_SCALE) })
		}
		return { universe, book }
	}

	// Checkpoint past every funded deadline: earned and unused cash together drain the book exactly.
	const settleAll = async (universe: bigint, book: ModelBook, expectedEarnedUnits: bigint) => {
		const totalBefore = await totalCash()
		const earnedCash = expectedEarnedUnits === book.units ? book.cash : (book.cash * expectedEarnedUnits) / book.units
		const {
			result: [earned, unused],
		} = await client.simulateContract({ ...target(), functionName: 'checkpoint', args: [universe, WINDOW + 1] })
		expect(earned).toBe(earnedCash)
		expect(unused).toBe(book.cash - earnedCash)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'checkpoint', args: [universe, WINDOW + 1] }))
		expect(await totals(universe)).toEqual({ cash: 0n, units: 0n })
		expect(await totalCash()).toBe(totalBefore - book.cash)
	}

	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		await node.getAnvilWindowEthereum().advanceTime(10_000_000n)
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Missing premium ledger deployment')
		address = receipt.contractAddress
		await node.setBaselineSnapshot()
	})

	test('one fork at a 1e-12 share funds a million ETH of premium and settles it exactly', async () => {
		const { universe, book } = await buildLineage([[1n, 10n ** 12n]])
		// 1e27 scaled units on 1e6 wei: 1e21 units per wei, exactly at the dust limit.
		expect(book).toMatchObject({ cash: 10n ** 6n, units: 10n ** 27n })
		await fund(book, universe, 50n, 10n ** 6n * ether)
		// Even 2^128 wei more, beyond all ETH in existence, still fits the unit domain.
		await client.simulateContract({ ...target(), functionName: 'fund', args: [universe, 51n, 1n << 128n] })
		// The domain itself stays bounded.
		await expect(client.simulateContract({ ...target(), functionName: 'fund', args: [universe, 51n, 10n ** 42n] })).rejects.toThrow('Premium unit domain exceeded')
		// Both questions earn their full prepaid window.
		await schedule(universe, 1n, 0)
		await schedule(universe, 50n, 0)
		await settleAll(universe, book, book.units)
	})

	test('three forks at 0.1% then one at 49% fund a million ETH and refund a shortened question exactly', async () => {
		const { universe, book } = await buildLineage([
			[1n, 1_000n],
			[1n, 1_000n],
			[1n, 1_000n],
			[49n, 100n],
		])
		await fund(book, universe, 50n, 10n ** 6n * ether)
		await fund(book, universe, 51n, 3n * 10n ** 5n * ether + 7n)
		// Inherited questions earn their full window; question 50 resolves early and refunds its tail.
		for (const id of [1n, 2n, 3n, 4n, 51n]) await schedule(universe, id, 0)
		const finalAfter = RESPONSE + 86_400
		await schedule(universe, 50n, finalAfter)
		const shortened = book.questions.get(50n) ?? 0n
		const earnedShortened = (shortened / BigInt(WINDOW)) * BigInt(finalAfter)
		expect(earnedShortened).toBeLessThan(shortened)
		await settleAll(universe, book, book.units - shortened + earnedShortened)
	})
})
