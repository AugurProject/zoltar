import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

// #1319: a fork child gives each inherited question a share of newly surrendered recovery REP
// in proportion to its claim units at the fork. Holding fees the child charges before the
// question's first write in the child must not shrink that share, and the last claim of the
// book must not collect REP that belongs to another question.
const E18 = 10n ** 18n
const DAY = 86_400n
const YEAR = 365n * DAY
const UNIT_SCALE = 10n ** 9n
const SHARES = 100n * E18
const RECOVERY = 1_000n * E18
const FORK_TIME = 30n * DAY
// The rate the portfolio installs: principal units * annual fee / (10,000 * 365 days).
const feeRate = (annualFeeBps: bigint) => (SHARES * UNIT_SCALE * annualFeeBps) / (10_000n * YEAR)

describe('Statoblast: child holding fees preserve inherited recovery REP', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const send = (request: Parameters<WriteClient['writeContract']>[0]) => writeContractAndWait(client, () => client.writeContract(request))
	const mint = (book: bigint, question: bigint, cash: bigint, at: bigint) => send({ ...target(), functionName: 'mint', args: [book, question, cash, 0n, Number(at)] })
	const stream = (book: bigint, question: bigint, rate: bigint, end: bigint, at: bigint) => send({ ...target(), functionName: 'replaceFeeStream', args: [book, question, rate, Number(end), Number(at)] })
	const seal = (book: bigint, at: bigint) => send({ ...target(), functionName: 'sealForFork', args: [book, Number(at)] })
	const freeze = (book: bigint, at: bigint) => send({ ...target(), functionName: 'freezeMatured', args: [book, Number(at)] })
	const fundedChild = async (source: bigint, recovery: bigint) => {
		const required = await client.readContract({ ...target(), functionName: 'requiredForkCash', args: [source] })
		await send({ ...target(), functionName: 'createChildBook', args: [source, required, recovery] })
		const bookId = await client.readContract({ ...target(), functionName: 'lastBookId' })
		expect(await client.readContract({ ...target(), functionName: 'isCashFunded', args: [bookId] })).toBe(true)
		return bookId
	}
	const supply = async (book: bigint, question: bigint) => (await client.readContract({ ...target(), functionName: 'scaledQuestion', args: [book, question] }))[0].outcomeSupplyAttoShares
	const claim = async (book: bigint, question: bigint) => client.readContract({ ...target(), functionName: 'quoteRecoveryRep', args: [book, question, await supply(book, question)] })
	const custody = (book: bigint) => client.readContract({ ...target(), functionName: 'recoveryRep', args: [book] })
	const redeemAll = async (book: bigint, question: bigint, at: bigint) => {
		const before = await custody(book)
		await send({ ...target(), functionName: 'redeem', args: [book, question, await supply(book, question), 0n, Number(at)] })
		return before - (await custody(book))
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		await ethereum.advanceTime(3n * YEAR)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, 1n, 1n] }) }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Settlement ledger deployment address missing')
		address = receipt.contractAddress
		await setBaselineSnapshot()
	})

	/** Book 1 holds two equal fee-bearing questions and forks into a funded child with new recovery REP. */
	const forkTwoEqualQuestions = async (rate: bigint, end: bigint) => {
		await send({ ...target(), functionName: 'createBook', args: [0] })
		for (const question of [1n, 2n]) {
			await mint(1n, question, SHARES, 0n)
			await stream(1n, question, rate, end, 0n)
		}
		await seal(1n, FORK_TIME)
		return fundedChild(1n, RECOVERY)
	}

	for (const [annualFeeBps, untouchedDays] of [
		[500n, 30n],
		[1_000n, 365n],
	] as const)
		test(`an untouched inherited question keeps its share after ${untouchedDays} days at ${annualFeeBps} bps`, async () => {
			const rate = feeRate(annualFeeBps)
			const child = await forkTwoEqualQuestions(rate, 10n * YEAR)
			const atFork = [await claim(child, 1n), await claim(child, 2n)] as const
			expect(atFork[0]).toBe(atFork[1])
			expect(atFork[0] + atFork[1]).toBeGreaterThanOrEqual(RECOVERY - 2n)
			// Question 2 is written in the child at once; question 1 is never touched before it is redeemed.
			await stream(child, 2n, rate, 10n * YEAR, FORK_TIME)
			const later = FORK_TIME + untouchedDays * DAY
			await freeze(child, later)
			expect(await custody(child)).toBe(RECOVERY)
			expect(await claim(child, 1n)).toBe(atFork[0])
			expect(await claim(child, 2n)).toBe(atFork[1])
			expect(await redeemAll(child, 1n, later)).toBe(atFork[0])
			// The last claim receives only its own share plus allocation dust.
			const last = await redeemAll(child, 2n, later)
			expect(last - atFork[1]).toBeLessThanOrEqual(2n)
			expect(await custody(child)).toBe(0n)
		})

	test('a dust claim minted in the child without REP collects only allocation dust', async () => {
		const rate = feeRate(500n)
		const child = await forkTwoEqualQuestions(rate, 10n * YEAR)
		const atFork = [await claim(child, 1n), await claim(child, 2n)] as const
		await stream(child, 2n, rate, 10n * YEAR, FORK_TIME)
		// A fresh question needs no recovery REP.
		const dust = 10n ** 12n
		expect(await client.readContract({ ...target(), functionName: 'quoteMintRecoveryRep', args: [child, 3n, dust] })).toBe(0n)
		await mint(child, 3n, dust, FORK_TIME)
		expect(await claim(child, 3n)).toBe(0n)
		const later = FORK_TIME + 180n * DAY
		await freeze(child, later)
		expect(await redeemAll(child, 1n, later)).toBe(atFork[0])
		expect(await redeemAll(child, 2n, later)).toBe(atFork[1])
		expect(await redeemAll(child, 3n, later)).toBeLessThanOrEqual(2n)
		expect(await custody(child)).toBe(0n)
	})

	// An untouched question must match an identical question rewritten at every fork, across two
	// forks with new REP and fees charged in both children, whether the stream ends before or after the second fork.
	for (const [label, streamEnd] of [
		['after both forks', 10n * YEAR],
		['between the forks', FORK_TIME + 20n * DAY],
	] as const)
		test(`two recovery forks with a stream ending ${label} keep the untouched share exact`, async () => {
			const rate = feeRate(1_000n)
			const child = await forkTwoEqualQuestions(rate, streamEnd)
			await stream(child, 2n, rate, streamEnd, FORK_TIME)
			const secondFork = FORK_TIME + 40n * DAY
			await seal(child, secondFork)
			const grandchild = await fundedChild(child, 3n * RECOVERY)
			await stream(grandchild, 2n, streamEnd > secondFork ? rate : 0n, streamEnd, secondFork)
			const later = secondFork + 60n * DAY
			await freeze(grandchild, later)
			const untouched = await claim(grandchild, 1n)
			const rewritten = await claim(grandchild, 2n)
			expect(untouched).toBe(rewritten)
			expect(untouched + rewritten).toBeGreaterThanOrEqual(3n * RECOVERY - 4n)
			expect(await redeemAll(grandchild, 1n, later)).toBe(untouched)
			const last = await redeemAll(grandchild, 2n, later)
			expect(last - rewritten).toBeLessThanOrEqual(4n)
			expect(await custody(grandchild)).toBe(0n)
		})
})
