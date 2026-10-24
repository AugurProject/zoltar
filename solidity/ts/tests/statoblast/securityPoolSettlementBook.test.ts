import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as artifact, test_statoblast_SettlementPersistentMapHarness_SettlementPersistentMapHarness as mapArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

describe('Statoblast: central internal settlement units', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const mint = (book: bigint, question: bigint, cash: bigint, minimum = 0n, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [book, question, cash, minimum, timestamp] }))
	const redeem = (book: bigint, question: bigint, shares: bigint, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'redeem', args: [book, question, shares, 0n, timestamp] }))
	const fee = (book: bigint, question: bigint, cash: bigint, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'chargeFee', args: [book, question, cash, timestamp] }))
	const seal = (book: bigint, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealForFork', args: [book, timestamp] }))
	const child = (source: bigint, cash: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildBook', args: [source, cash] }))
	const schedule = (book: bigint, question: bigint, finalAfter: number, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'scheduleFinality', args: [book, question, finalAfter, timestamp] }))
	const freeze = (book: bigint, timestamp: number) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freezeMatured', args: [book, timestamp] }))
	const book = (id: bigint) => client.readContract({ ...target(), functionName: 'books', args: [id] })
	const question = (bookId: bigint, id: bigint) => client.readContract({ ...target(), functionName: 'question', args: [bookId, id] })
	const quote = async (bookId: bigint, id: bigint, shares: bigint) => [...(await client.readContract({ ...target(), functionName: 'quoteRedemption', args: [bookId, id, shares] }))]

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		await ethereum.advanceTime(1_000_000n)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, 10n ** 12n] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Settlement ledger deployment address missing')
		address = receipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createBook', args: [0] }))
		await setBaselineSnapshot()
	})

	test('fees burn internal units without burning outcomes, and entry preserves existing entitlements', async () => {
		await mint(1n, 1n, 100n)
		await mint(1n, 2n, 200n)
		await fee(1n, 1n, 20n)
		expect((await book(1n)).slice(0, 3)).toEqual([280n, 280n, 20n])
		expect((await question(1n, 1n))[0]).toMatchObject({ units: 80n, outcomeSupplyAttoShares: 100n, finalAfter: 0n })
		await mint(1n, 1n, 40n, 50n)
		expect((await question(1n, 1n))[0]).toMatchObject({ units: 120n, outcomeSupplyAttoShares: 150n, finalAfter: 0n })
		expect(await quote(1n, 1n, 50n)).toEqual([40n, 40n])
		await redeem(1n, 1n, 50n)
		expect(await quote(1n, 1n, 100n)).toEqual([80n, 80n])
		expect(await quote(1n, 2n, 200n)).toEqual([200n, 200n])
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'collectFees', args: [1n, 20n] }))
		expect((await book(1n)).slice(0, 3)).toEqual([280n, 280n, 0n])
	})

	test('underfunded forks preserve all inherited supply before migration and pause entry and fees', async () => {
		await mint(1n, 1n, 100n)
		await mint(1n, 2n, 200n)
		await seal(1n)
		await child(1n, 150n)
		expect((await question(2n, 1n))[0].outcomeSupplyAttoShares).toBe(100n)
		expect(await quote(2n, 1n, 40n)).toEqual([20n, 40n])
		await expect(mint(2n, 1n, 10n)).rejects.toThrow('Settlement in runoff')
		await expect(fee(2n, 1n, 1n)).rejects.toThrow('Runoff fees paused')
		await expect(redeem(1n, 1n, 1n)).rejects.toThrow('Use child settlement book')
		await redeem(2n, 1n, 40n)
		expect((await book(2n)).slice(0, 2)).toEqual([130n, 260n])
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'recapitalize', args: [2n, 130n, 0] }))
		await mint(2n, 2n, 20n)
		expect((await book(2n)).slice(0, 2)).toEqual([280n, 280n])
		expect((await question(1n, 1n))[0].outcomeSupplyAttoShares).toBe(100n)
	})

	test('last redemption pays the exact residual across partial burns and zero-funded descendants', async () => {
		await mint(1n, 1n, 7n)
		await mint(1n, 2n, 4n)
		await seal(1n)
		await child(1n, 5n)
		expect(await quote(2n, 1n, 3n)).toEqual([1n, 3n])
		await redeem(2n, 1n, 3n)
		expect(await quote(2n, 2n, 4n)).toEqual([2n, 4n])
		await redeem(2n, 2n, 4n)
		expect(await quote(2n, 1n, 4n)).toEqual([2n, 4n])
		await redeem(2n, 1n, 4n)
		expect((await book(2n)).slice(0, 2)).toEqual([0n, 0n])
		await child(1n, 0n)
		await redeem(3n, 1n, 7n)
		await redeem(3n, 2n, 4n)
		expect((await book(3n)).slice(0, 2)).toEqual([0n, 0n])
	})

	test('minimum exchange rate prevents enormous issuance after collateral fees exhaust almost all units', async () => {
		await mint(1n, 1n, 10n ** 18n)
		await fee(1n, 1n, 10n ** 18n - 1n)
		await expect(mint(1n, 1n, 1n)).rejects.toThrow('Outcome exchange below minimum')
		expect(await quote(1n, 1n, 10n ** 18n)).toEqual([1n, 1n])
		await redeem(1n, 1n, 10n ** 18n)
		await mint(1n, 1n, 10n)
		expect((await question(1n, 1n))[0].outcomeSupplyAttoShares).toBe(10n)
	})

	test('strict finality cutoff preserves finalized parent money and interrupts equal-deadline claims', async () => {
		await mint(1n, 1n, 100n)
		await mint(1n, 2n, 200n)
		await mint(1n, 3n, 300n)
		await schedule(1n, 1n, 99)
		await schedule(1n, 2n, 100)
		await seal(1n, 100)
		expect((await book(1n)).slice(0, 2)).toEqual([500n, 500n])
		expect((await question(1n, 1n))[1]).toBe(1n)
		expect((await question(1n, 2n))[1]).toBe(0n)
		await child(1n, 250n)
		await expect(redeem(2n, 1n, 100n, 100)).rejects.toThrow('Use source final claim')
		await redeem(1n, 1n, 100n, 100)
		expect(await quote(2n, 1n, 100n)).toEqual([0n, 0n])
		expect([...(await client.readContract({ ...target(), functionName: 'frozenBooks', args: [1n] }))]).toEqual([0n, 0n, 1n])
		expect((await book(2n)).slice(0, 2)).toEqual([250n, 500n])
		await freeze(2n, 101)
		expect((await book(2n)).slice(0, 2)).toEqual([250n, 500n])
		await freeze(2n, 100 + 3 * 86_400)
		expect((await question(2n, 2n))[1]).toBe(0n)
		await freeze(2n, 101 + 3 * 86_400)
		expect((await book(2n)).slice(0, 2)).toEqual([150n, 300n])
		expect((await question(2n, 2n))[1]).toBe(2n)
		expect(await quote(2n, 2n, 200n)).toEqual([100n, 200n])
	})

	test('a real partial maturity on a full timestamp path does not charge the caller for copied ancestors', async () => {
		for (let bit = 0; bit < 48; bit++) {
			const questionId = BigInt(bit + 1)
			await mint(1n, questionId, 1n)
			await schedule(1n, questionId, Number(1n << BigInt(bit)))
		}
		const hash = await freeze(1n, 2)
		const gas = (await client.waitForTransactionReceipt({ hash })).gasUsed
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ partialTimestampMaturityGas: gas })
		expect(gas).toBeLessThan(600_000n)
		expect((await book(1n)).slice(0, 2)).toEqual([47n, 47n])
		expect(await quote(1n, 1n, 1n)).toEqual([1n, 1n])
		expect((await question(1n, 2n))[1]).toBe(0n)
	})

	test('lifetime finality prefixes can wrap while every live and inherited claim remains exact', async () => {
		const maximum = (1n << 256n) - 1n
		await mint(1n, 1n, maximum)
		await schedule(1n, 1n, 10)
		await freeze(1n, 11)
		await redeem(1n, 1n, maximum, 11)
		expect((await book(1n)).slice(0, 2)).toEqual([0n, 0n])
		await mint(1n, 2n, maximum, 0n, 12)
		await schedule(1n, 2n, 20, 12)
		await schedule(1n, 2n, 0, 12)
		await freeze(1n, 21)
		expect((await book(1n)).slice(0, 2)).toEqual([maximum, maximum])
		await schedule(1n, 2n, 30, 21)
		await freeze(1n, 31)
		expect((await book(1n)).slice(0, 2)).toEqual([0n, 0n])
		expect(await quote(1n, 2n, maximum)).toEqual([maximum, maximum])
		await freeze(1n, 31)
		await seal(1n, 31)
		await child(1n, 0n)
		await mint(2n, 3n, maximum, 0n, 31)
		const deadline = 31 + 3 * 86_400 + 1
		await schedule(2n, 3n, deadline, 31)
		await freeze(2n, deadline + 1)
		expect((await book(2n)).slice(0, 2)).toEqual([0n, 0n])
		expect(await quote(2n, 3n, maximum)).toEqual([maximum, maximum])
		expect(await quote(2n, 2n, maximum)).toEqual([0n, 0n])
		expect(await quote(1n, 2n, maximum)).toEqual([maximum, maximum])
	})

	test('fork recovery eligibility matches lazy finality, exact cutoffs and nested minimum response periods', async () => {
		const live = (bookId: bigint, questionId: bigint, timestamp: number) => client.readContract({ address, abi: parseAbi(['function hasLiveForkRecoveryRight(uint64 bookId,uint256 questionId,uint48 forkTimestamp) view returns(bool)']), functionName: 'hasLiveForkRecoveryRight', args: [bookId, questionId, timestamp] })
		await mint(1n, 1n, 100n)
		await mint(1n, 2n, 200n)
		await mint(1n, 3n, 300n)
		await schedule(1n, 1n, 99)
		await schedule(1n, 2n, 100)
		expect(await live(1n, 1n, 100)).toBe(false)
		expect(await live(1n, 2n, 100)).toBe(true)
		expect(await live(1n, 3n, 100)).toBe(true)
		expect(await live(1n, 4n, 100)).toBe(false)
		await seal(1n, 100)
		expect(await live(1n, 1n, 100)).toBe(false)
		expect(await live(1n, 2n, 1_000_000)).toBe(true)
		await child(1n, 250n)
		expect(await live(2n, 1n, 101)).toBe(false)
		expect(await live(2n, 2n, 101)).toBe(true)
		expect(await live(2n, 2n, 100 + 3 * 86_400)).toBe(true)
		expect(await live(2n, 2n, 101 + 3 * 86_400)).toBe(false)
		await seal(2n, 101)
		expect(await live(2n, 2n, 1_000_000)).toBe(true)
	})

	test('same-deadline aggregation, canceled deadlines and partial redemption preserve frozen budgets', async () => {
		await mint(1n, 1n, 100n)
		await mint(1n, 2n, 200n)
		await schedule(1n, 1n, 50)
		await schedule(1n, 2n, 50)
		await redeem(1n, 1n, 10n)
		await fee(1n, 2n, 20n)
		await schedule(1n, 2n, 0)
		await freeze(1n, 50)
		expect((await book(1n)).slice(0, 3)).toEqual([270n, 270n, 20n])
		await freeze(1n, 51)
		expect((await book(1n)).slice(0, 3)).toEqual([180n, 180n, 20n])
		await expect(schedule(1n, 1n, 100, 51)).rejects.toThrow('Final claim immutable')
		await expect(fee(1n, 1n, 1n, 51)).rejects.toThrow('Final claim fees closed')
		await redeem(1n, 1n, 90n, 51)
		expect((await book(1n)).slice(0, 3)).toEqual([180n, 180n, 20n])
	})

	test('nested branches isolate current state without replaying ancestors', async () => {
		await mint(1n, 1n << 255n, 100n)
		await mint(1n, (1n << 255n) + 1n, 100n)
		let current = 1n
		for (let depth = 0; depth < 12; depth++) {
			await seal(current)
			await child(current, 200n - BigInt(depth) * 2n)
			current++
			await redeem(current, 1n << 255n, 1n)
			await redeem(current, (1n << 255n) + 1n, 1n)
		}
		expect((await question(current, 1n << 255n))[0].outcomeSupplyAttoShares).toBe(88n)
		expect((await question(1n, 1n << 255n))[0].outcomeSupplyAttoShares).toBe(100n)
		const estimate = await client.estimateContractGas({ ...target(), functionName: 'redeem', args: [current, 1n << 255n, 1n, 0n, 0] })
		expect(estimate).toBeLessThan(500_000n)
	})

	test('unauthorized callers cannot create virtual funding or consume claims', async () => {
		const outsider = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1])
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'mint', args: [1n, 1n, 100n, 0n, 0] }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'createChildBook', args: [1n, 0n] }))).rejects.toThrow('Only portfolio')
	})

	test('aggregate time fees materialize question units once and preserve replacement boundaries', async () => {
		await mint(1n, 1n, 1_000n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 7n, 100, 0] }))
		await freeze(1n, 40)
		expect((await book(1n)).slice(0, 3)).toEqual([720n, 720n, 280n])
		expect((await question(1n, 1n))[0].units).toBe(720n)
		await mint(1n, 2n, 200n, 0n, 40)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 2n, 2n, 100, 40] }))
		await freeze(1n, 80)
		expect((await question(1n, 1n))[0].units).toBe(440n)
		expect((await question(1n, 2n))[0].units).toBe(120n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 3n, 140, 80] }))
		await freeze(1n, 140)
		expect((await book(1n)).slice(0, 3)).toEqual([340n, 340n, 860n])
		expect((await question(1n, 1n))[0].units).toBe(260n)
		expect((await question(1n, 2n))[0].units).toBe(80n)
		await redeem(1n, 1n, 1_000n, 140)
		await redeem(1n, 2n, 200n, 140)
		expect((await book(1n)).slice(0, 3)).toEqual([0n, 0n, 860n])
	})

	test('runoff fee pauses neither charge skipped time after recap nor extend an expired stream', async () => {
		await mint(1n, 1n, 1_000n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 10n, 90, 0] }))
		await seal(1n, 20)
		await child(1n, 400n)
		await freeze(2n, 60)
		expect((await question(2n, 1n))[0].units).toBe(800n)
		expect((await book(2n)).slice(0, 3)).toEqual([400n, 800n, 0n])
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'recapitalize', args: [2n, 400n, 60] }))
		await freeze(2n, 100)
		expect((await question(2n, 1n))[0].units).toBe(500n)
		expect((await book(2n)).slice(0, 3)).toEqual([500n, 500n, 300n])
		await freeze(2n, 1_000)
		expect((await book(2n)).slice(0, 3)).toEqual([500n, 500n, 300n])
		await child(1n, 0n)
		await freeze(3n, 100)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'recapitalize', args: [3n, 800n, 100] }))
		await freeze(3n, 1_000)
		expect((await question(3n, 1n))[0].units).toBe(800n)
		expect((await book(3n)).slice(0, 3)).toEqual([800n, 800n, 0n])
	})

	test('price validity pauses exact prospective fees and a full burn removes future stream liability', async () => {
		await mint(1n, 1n, 1_000n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 10n, 100, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setFeeAccrualEnabled', args: [1n, false, 30] }))
		await freeze(1n, 70)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setFeeAccrualEnabled', args: [1n, true, 70] }))
		await freeze(1n, 90)
		expect((await question(1n, 1n))[0].units).toBe(500n)
		expect((await book(1n)).slice(0, 3)).toEqual([500n, 500n, 500n])
		await redeem(1n, 1n, 1_000n, 90)
		await freeze(1n, 1_000)
		expect((await book(1n)).slice(0, 3)).toEqual([0n, 0n, 500n])
	})

	test('native fee deadlines expire during fork pauses and never back-charge across two forks or runoff', async () => {
		const clockAbi = parseAbi(['function setFeeClock(uint64 bookId,uint48 nativeTimestamp)', 'function feeTimestamp(uint64 bookId) view returns(uint48)'])
		const enabled = (bookId: bigint, on: boolean, time: number) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setFeeAccrualEnabled', args: [bookId, on, time] }))
		const clock = (bookId: bigint, time: number) => writeContractAndWait(client, () => client.writeContract({ address, abi: clockAbi, functionName: 'setFeeClock', args: [bookId, time] }))
		await mint(1n, 1n, 1_000n)
		await mint(1n, 2n, 1_000n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 1n, 200, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 2n, 2n, 500, 0] }))
		await seal(1n, 100)
		await child(1n, 1_700n)
		await enabled(2n, false, 100)
		await clock(2n, 400)
		await enabled(2n, true, 100)
		await freeze(2n, 150)
		expect((await question(2n, 1n))[0].units).toBe(900n)
		expect((await question(2n, 2n))[0].units).toBe(700n)
		await expect(clock(2n, 500)).rejects.toThrow('Pause fees before clock change')
		await seal(2n, 150)
		await child(2n, 1_000n)
		await enabled(3n, false, 150)
		await clock(3n, 475)
		await enabled(3n, true, 150)
		await freeze(3n, 160)
		expect((await question(3n, 2n))[0].units).toBe(700n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'recapitalize', args: [3n, 600n, 160] }))
		await freeze(3n, 200)
		expect(await client.readContract({ address, abi: clockAbi, functionName: 'feeTimestamp', args: [3n] })).toBe(525n)
		expect((await question(3n, 1n))[0].units).toBe(900n)
		expect((await question(3n, 2n))[0].units).toBe(670n)
		expect((await book(3n)).slice(0, 3)).toEqual([1_570n, 1_570n, 30n])
		await schedule(3n, 2n, 300, 200)
		await enabled(3n, false, 200)
		await expect(clock(3n, 524)).rejects.toThrow('Fee clock cannot go backwards')
	})

	test('a prepared child may hold a future native fee anchor while accrual stays disabled', async () => {
		const clockAbi = parseAbi(['function setFeeClock(uint64 bookId,uint48 nativeTimestamp)', 'function feeTimestamp(uint64 bookId) view returns(uint48)'])
		await seal(1n)
		await child(1n, 0n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setFeeAccrualEnabled', args: [2n, false, 0] }))
		const future = Number((await client.getBlock()).timestamp) + 100
		await writeContractAndWait(client, () => client.writeContract({ address, abi: clockAbi, functionName: 'setFeeClock', args: [2n, future] }))
		expect(await client.readContract({ address, abi: clockAbi, functionName: 'feeTimestamp', args: [2n] })).toBe(BigInt(future))
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setFeeAccrualEnabled', args: [2n, true, 0] }))).rejects.toThrow('Fee activation is in the future')
	})

	test('a bound finality schedule cannot hide future time-fee deductions', async () => {
		await mint(1n, 1n, 1_000n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 5n, 100, 0] }))
		await expect(schedule(1n, 1n, 80, 40)).rejects.toThrow('Stop fees before finality')
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 1n, 0n, 0, 40] }))
		await schedule(1n, 1n, 80, 40)
		await freeze(1n, 81)
		expect((await book(1n)).slice(0, 3)).toEqual([0n, 0n, 200n])
		expect(await quote(1n, 1n, 1_000n)).toEqual([800n, 800n])
	})
})

describe('Statoblast: immutable settlement Patricia roots', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: mapArtifact.abi, address })
	const set = (root: bigint, key: bigint, value: bigint, weight = value) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'set', args: [root, key, value, weight] }))
	const get = (root: bigint, key: bigint) => client.readContract({ ...target(), functionName: 'get', args: [root, key] })
	const prefix = (root: bigint, key: bigint) => client.readContract({ ...target(), functionName: 'prefixTotalModular', args: [root, key] })
	const total = (root: bigint) => client.readContract({ ...target(), functionName: 'total', args: [root] })

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${mapArtifact.evm.bytecode.object}` }) })
		if (receipt.contractAddress === undefined) throw new Error('Persistent map deployment address missing')
		address = receipt.contractAddress
		await setBaselineSnapshot()
	})

	test('full-width keys, replacements, deletions and prefix reads preserve old snapshots', async () => {
		const high = 1n << 255n
		await set(0n, high, 7n)
		await set(1n, 0n, 3n)
		await set(2n, high + 1n, 11n)
		await set(3n, 99n, 13n)
		await set(4n, high, 17n)
		await set(5n, 99n, 0n)
		expect(await total(4n)).toBe(34n)
		expect(await total(6n)).toBe(31n)
		expect(await get(4n, high)).toBe(7n)
		expect(await get(6n, high)).toBe(17n)
		expect(await prefix(6n, high - 1n)).toBe(3n)
		expect(await prefix(6n, high)).toBe(20n)
		expect(await prefix(6n, (1n << 256n) - 1n)).toBe(31n)
		expect(await prefix(4n, high)).toBe(23n)
		expect(await get(4n, 99n)).toBe(13n)
		expect(await get(6n, 99n)).toBe(0n)
	})

	test('only finality maps wrap cumulative weights and checked maps still reject overflow', async () => {
		const maximum = (1n << 256n) - 1n
		const modular = (root: bigint, key: bigint, value: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setModular', args: [root, key, value, value] }))
		await modular(0n, 1n, maximum)
		await expect(set(1n, 2n, maximum)).rejects.toThrow()
		await modular(1n, 2n, maximum)
		expect(await prefix(2n, 0n)).toBe(0n)
		expect(await prefix(2n, 1n)).toBe(maximum)
		expect(await prefix(2n, 2n)).toBe(maximum - 1n)
		await modular(2n, 2n, 0n)
		expect(await prefix(3n, 2n)).toBe(maximum)
		expect(await prefix(2n, 2n)).toBe(maximum - 1n)
	})

	test('constant-work frozen history appends match sorted ceilings across immutable fork snapshots', async () => {
		const histories: { timestamp: number; value: bigint }[][] = [[]]
		let seed = 31n
		let maximumGas = 0n
		for (let index = 1; index <= 150; index++) {
			seed = (seed * 1664525n + 1013904223n) % (1n << 32n)
			const parent = index > 128 && index % 3 === 0 ? Number(seed % BigInt(histories.length)) : index - 1
			const prior = histories[parent]
			if (prior === undefined) throw new Error('Missing frozen history model')
			const timestamp = (prior.at(-1)?.timestamp ?? 0) + 1 + Number(seed % 13n)
			const value = (1n << 248n) + BigInt(index)
			const hash = await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'appendFrozen', args: [BigInt(parent), timestamp, value] }))
			const gas = (await client.waitForTransactionReceipt({ hash })).gasUsed
			if (gas > maximumGas) maximumGas = gas
			const entries = [...prior, { timestamp, value }]
			histories.push(entries)
			for (const root of [parent, index]) {
				const model = histories[root]
				if (model === undefined) throw new Error('Missing frozen fork model')
				for (const cutoff of [0, timestamp, timestamp + 1, Number(seed % BigInt(timestamp + 1))]) {
					const expected = model.find(entry => entry.timestamp >= cutoff)?.value ?? 0n
					expect(await client.readContract({ ...target(), functionName: 'frozenCeiling', args: [BigInt(root), cutoff] })).toBe(expected)
				}
			}
		}
		expect(maximumGas).toBeLessThan(200_000n)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ frozenHistoryMaximumAppendGas: maximumGas })
		const last = histories.at(-1)?.at(-1)
		if (last === undefined) throw new Error('Missing latest frozen checkpoint')
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'appendFrozen', args: [150n, last.timestamp, 1n] }))).rejects.toThrow('Frozen checkpoints must advance')
		const maximumTime = Number((1n << 48n) - 1n)
		const maximumValue = (1n << 256n) - 1n
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'appendFrozen', args: [150n, maximumTime, maximumValue] }))
		expect(await client.readContract({ ...target(), functionName: 'frozenCeiling', args: [151n, maximumTime] })).toBe(maximumValue)
		expect(await client.readContract({ ...target(), functionName: 'frozenCeiling', args: [150n, maximumTime] })).toBe(0n)
	})

	test('maximum uint48 timestamp depth preserves replacement and production fee-history reads', async () => {
		await set(0n, 0n, 1n)
		for (let bit = 0; bit < 48; bit++) await set(BigInt(bit + 1), 1n << BigInt(bit), 1n)
		const replacement = await client.waitForTransactionReceipt({ hash: await set(49n, 0n, 2n) })
		expect(replacement.gasUsed).toBeLessThanOrEqual(16_777_216n)
		expect(await prefix(50n, 0n)).toBe(2n)
		expect(await prefix(50n, (1n << 48n) - 1n)).toBe(50n)
		expect(await client.readContract({ ...target(), functionName: 'prefixTotal', args: [50n, 0n] })).toBe(2n)
		expect(await client.readContract({ ...target(), functionName: 'prefixTotal', args: [50n, (1n << 48n) - 1n] })).toBe(50n)
		expect(await client.readContract({ ...target(), functionName: 'floor', args: [50n, 0n] })).toBe(2n)
		expect(await client.readContract({ ...target(), functionName: 'floor', args: [50n, (1n << 48n) - 1n] })).toBe(1n)
		expect(await total(49n)).toBe(49n)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ timestampDepth: 48, replacementGas: replacement.gasUsed })
	})

	test('empty maturity prefixes preserve their original root without copying the timestamp path', async () => {
		for (let bit = 0; bit < 48; bit++) await set(BigInt(bit), 1n << BigInt(bit), 1n)
		const root = await client.readContract({ ...target(), functionName: 'roots', args: [48n] })
		const gas = await client.estimateContractGas({ ...target(), functionName: 'prefixTotalModular', args: [48n, 0n] })
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ emptyTimestampPrefixGas: gas })
		expect(gas).toBeLessThan(500_000n)
		expect(await prefix(48n, 0n)).toBe(0n)
		expect(await client.readContract({ ...target(), functionName: 'roots', args: [48n] })).toBe(root)
		expect(await total(48n)).toBe(48n)
	})

	test('a fully matured timestamp tree reuses its original root and keeps old snapshots immutable', async () => {
		const maximum = (1n << 48n) - 1n
		for (let bit = 0; bit < 48; bit++) await set(BigInt(bit), maximum - (1n << BigInt(bit)), 1n)
		const root = await client.readContract({ ...target(), functionName: 'roots', args: [48n] })
		const gas = await client.estimateContractGas({ ...target(), functionName: 'prefixTotalModular', args: [48n, maximum] })
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ completeTimestampPrefixGas: gas })
		expect(gas).toBeLessThan(500_000n)
		expect(await prefix(48n, maximum)).toBe(48n)
		expect(await client.readContract({ ...target(), functionName: 'roots', args: [48n] })).toBe(root)
		expect(await total(48n)).toBe(48n)
	})

	test('mixed immutable updates agree with independent sorted-map lookups and prefix boundaries', async () => {
		const values = new Map<bigint, bigint>()
		const snapshots = [new Map<bigint, bigint>()]
		let seed = 19n
		let root = 0n
		for (let index = 0; index < 48; index++) {
			seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n)
			const key = (seed % 97n) << BigInt(index % 192)
			const value = BigInt(index + 1)
			await set(root, key, value)
			root++
			values.set(key, value)
			snapshots.push(new Map(values))
			expect(await total(root)).toBe([...values.values()].reduce((a, b) => a + b, 0n))
		}
		const keys = [...values.keys()].sort((a, b) => {
			if (a === b) return 0
			return a < b ? -1 : 1
		})
		for (const key of keys.filter((_, index) => index % 4 === 0)) {
			const expectedValue = values.get(key)
			if (expectedValue === undefined) throw new Error('Missing test value')
			expect(await get(root, key)).toBe(expectedValue)
			for (const snapshot of [0, 17, 31, Number(root)]) {
				const model = snapshots[snapshot]
				if (model === undefined) throw new Error('Missing persistent map snapshot')
				for (const cutoff of [key - 1n, key, key + 1n, (1n << 256n) - 1n]) {
					if (cutoff < 0n) continue
					const expected = [...model.entries()].filter(([candidate]) => candidate <= cutoff).reduce((sum, [, value]) => sum + value, 0n)
					expect(await prefix(BigInt(snapshot), cutoff)).toBe(expected)
				}
			}
		}
	})

	test('adversarial keys exercise the full 256-bit path without a historical traversal', async () => {
		await set(0n, 0n, 1n)
		let root = 1n
		for (let bit = 0; bit < 256; bit++) {
			await set(root, 1n << BigInt(bit), 1n)
			root++
		}
		expect(await total(root)).toBe(257n)
		const gas = await client.estimateContractGas({ ...target(), functionName: 'set', args: [root, 0n, 2n, 2n] })
		expect(gas).toBeLessThan(25_000_000n)
		await set(root, 0n, 2n)
		expect(await get(root + 1n, 0n)).toBe(2n)
		expect(await get(root, 0n)).toBe(1n)
		expect(await prefix(root + 1n, 0n)).toBe(2n)
		expect(await prefix(root, 0n)).toBe(1n)
		expect(await prefix(root + 1n, (1n << 256n) - 1n)).toBe(258n)
		await set(root + 1n, 0n, 0n)
		expect(await total(root + 2n)).toBe(256n)
		expect(await get(root + 2n, 0n)).toBe(0n)
		expect(await prefix(root + 2n, 0n)).toBe(0n)
		expect(await get(root + 1n, 0n)).toBe(2n)
		expect(await total(root)).toBe(257n)
	})
})
