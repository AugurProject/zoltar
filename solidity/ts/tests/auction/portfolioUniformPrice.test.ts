import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as artifact, test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingArtifact } from '../../types/contractArtifact'

const unit = 10n ** 18n
const opensAt = 100n
const closesAt = 10_000n
const abi = artifact.abi

describe('Portfolio uniform-price auction', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	const client = (index: 0 | 1 | 2 = 0) => createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[index])
	beforeAll(async () => {
		await setupTestAccounts(getAnvilWindowEthereum())
		await setBaselineSnapshot()
	})

	const deploy = async (target = 10n, inventory = 100n * unit, lot = unit, grid = 1n) => {
		const owner = client()
		const address = await deployContract(owner, encodeDeployData({ abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [owner.account.address] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi, address, functionName: 'startAuction', args: [opensAt, closesAt, lot, target, inventory, grid, owner.account.address] }))
		return address
	}

	const bid = async (address: Address, price: bigint, lots: bigint, bidder = client(1).account.address, lot = unit) => {
		const owner = client()
		await writeContractAndWait(owner, () => owner.writeContract({ abi, address, functionName: 'submitBid', args: [bidder, bidder, 12_000n, lots, price], value: lots * lot }))
		return owner.readContract({ abi, address, functionName: 'bidCount' })
	}

	const close = async (address: Address, limit = 10n) => {
		if ((await client().getBlock()).timestamp < closesAt) await getAnvilWindowEthereum().setTime(closesAt)
		await writeContractAndWait(client(), () => client().writeContract({ abi, address, functionName: 'finalize', args: [limit] }))
		return client().readContract({ abi, address, functionName: 'previewFinalization', args: [limit] })
	}

	const fill = (address: Address, bidId: bigint) => client().readContract({ abi, address, functionName: 'previewBid', args: [bidId] })
	const settle = (address: Address, bidId: bigint) => writeContractAndWait(client(), () => client().writeContract({ abi, address, functionName: 'settleBid', args: [bidId] }))
	const detach = async (address: Address, bidId: bigint, eth = 0n, rep = 0n) => {
		const preview = await client().readContract({ abi, address, functionName: 'previewBidFees', args: [bidId, eth, rep] })
		const simulation = await client().simulateContract({ abi, address, functionName: 'allocateAndRemoveFees', args: [bidId, eth, rep] })
		expect(preview).toEqual(simulation.result)
		await writeContractAndWait(client(), () => client().writeContract({ abi, address, functionName: 'allocateAndRemoveFees', args: [bidId, eth, rep] }))
		return [simulation.result[0], simulation.result[1]] satisfies readonly [bigint, bigint]
	}

	test('weak demand purchases the whole fresh inventory without a seller price floor', async () => {
		const address = await deploy(100n, 100n * unit)
		await getAnvilWindowEthereum().setTime(opensAt)
		const id = await bid(address, unit / 2n, 1n)
		const result = await close(address, 100n)
		expect(result).toMatchObject({ attoRepPerLot: 100n * unit, filledLots: 1n, raisedAttoEth: unit, soldAttoRep: 100n * unit, raiseLimitReached: false })
		expect(await fill(address, id)).toMatchObject({ filledLots: 1n, principalAttoRep: 100n * unit })
	})

	test('equal-price marginal bids receive proportional whole lots in either settlement order', async () => {
		const address = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		const first = await bid(address, unit, 6n)
		const second = await bid(address, unit, 6n, client(2).account.address)
		expect(await close(address)).toMatchObject({ attoRepPerLot: unit, filledLots: 10n, soldAttoRep: 10n * unit })
		for (const id of [second, first]) {
			const amounts = await fill(address, id)
			expect(amounts).toMatchObject({ filledLots: 5n, usedAttoEth: 5n * unit, principalAttoRep: 5n * unit, refundAttoEth: unit })
			await settle(address, id)
			expect(await fill(address, id)).toEqual(amounts)
		}
		await expect(settle(address, first)).rejects.toThrow('Auction bid has already been settled')
	})

	test('higher maximum prices and marginal winners acquire exactly the same REP per ETH', async () => {
		const address = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		const high = await bid(address, unit / 2n, 4n)
		const marginal = await bid(address, unit, 9n)
		const low = await bid(address, 2n * unit, 1n)
		expect(await close(address)).toMatchObject({ attoRepPerLot: unit, marginalDemandLots: 9n, marginalFillLots: 6n, fullBeforeLots: 4n })
		expect(await fill(address, high)).toMatchObject({ usedAttoEth: 4n * unit, principalAttoRep: 4n * unit })
		expect(await fill(address, marginal)).toMatchObject({ usedAttoEth: 6n * unit, principalAttoRep: 6n * unit, refundAttoEth: 3n * unit })
		expect(await fill(address, low)).toMatchObject({ filledLots: 0n, principalAttoRep: 0n, refundAttoEth: unit })
	})

	test('inventory caps accepted ETH at every winner minimum without topping up REP', async () => {
		const address = await deploy(10n, 100n, 1n)
		await getAnvilWindowEthereum().setTime(opensAt)
		const high = await bid(address, 10n, 2n, client(1).account.address, 1n)
		const marginal = await bid(address, 30n, 4n, client(2).account.address, 1n)
		const low = await bid(address, 40n, 5n, client(1).account.address, 1n)
		expect(await close(address)).toMatchObject({ attoRepPerLot: 33n, filledLots: 3n, raisedAttoEth: 3n, soldAttoRep: 100n, roundingAttoRep: 1n, marginalMinimumAttoRepPerLot: 30n, raiseLimitReached: false })
		expect(await fill(address, high)).toMatchObject({ filledLots: 2n, principalAttoRep: 66n })
		expect(await fill(address, marginal)).toMatchObject({ filledLots: 1n, principalAttoRep: 33n, refundAttoEth: 3n })
		expect(await fill(address, low)).toMatchObject({ filledLots: 0n, refundAttoEth: 5n })
	})

	test('a lower capacity clears proportionally, while zero capacity fully refunds', async () => {
		const address = await deploy()
		const cancelled = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		await bid(address, unit, 8n)
		await bid(address, unit, 4n)
		await bid(cancelled, unit, 1n)
		expect(await close(address, 3n)).toMatchObject({ filledLots: 3n, raisedAttoEth: 3n * unit, soldAttoRep: 3n * unit, raiseLimitReached: true })
		expect(await fill(address, 1n)).toMatchObject({ filledLots: 2n, refundAttoEth: 6n * unit })
		expect(await fill(address, 2n)).toMatchObject({ filledLots: 1n, refundAttoEth: 3n * unit })
		expect(await close(cancelled, 0n)).toMatchObject({ filledLots: 0n, soldAttoRep: 0n, roundingAttoRep: 0n })
		expect(await fill(cancelled, 1n)).toMatchObject({ filledLots: 0n, refundAttoEth: unit })
		await expect(detach(cancelled, 1n, 1n)).rejects.toThrow('Auction bid has no remaining fee ownership')
	})

	test('a small inventory can repair fewer lots than the ETH target', async () => {
		const address = await deploy(100n, 101n, 1n, 3n)
		await getAnvilWindowEthereum().setTime(opensAt)
		const id = await bid(address, 30n, 2n, client(1).account.address, 1n)
		expect(await close(address, 100n)).toMatchObject({ attoRepPerLot: 48n, filledLots: 2n, soldAttoRep: 101n, roundingAttoRep: 5n, raiseLimitReached: false })
		expect(await fill(address, id)).toMatchObject({ principalAttoRep: 96n, usedAttoEth: 2n })
		expect(await detach(address, id)).toEqual([0n, 5n])
	})

	test('inventory rationing prorates the marginal minimum even when clearing REP is higher', async () => {
		const address = await deploy(10n, 100n, 1n)
		await getAnvilWindowEthereum().setTime(opensAt)
		const first = await bid(address, 40n, 3n, client(1).account.address, 1n)
		const second = await bid(address, 40n, 3n, client(2).account.address, 1n)
		const lower = await bid(address, 45n, 1n, client(1).account.address, 1n)
		expect(await close(address)).toMatchObject({ attoRepPerLot: 50n, filledLots: 2n, soldAttoRep: 100n, marginalMinimumAttoRepPerLot: 40n, marginalDemandLots: 6n, marginalFillLots: 2n })
		for (const id of [first, second]) expect(await fill(address, id)).toMatchObject({ filledLots: 1n, principalAttoRep: 50n, refundAttoEth: 2n })
		expect(await fill(address, lower)).toMatchObject({ filledLots: 0n, refundAttoEth: 1n })
	})

	test('absolute deadlines, authority, integer funding and price grid are enforced', async () => {
		const address = await deploy(10n, 1_000n, 7n, 3n)
		expect(await client().readContract({ abi, address, functionName: 'maximumBidAttoRepPerLot' })).toBe(999n)
		await expect(bid(address, 3n, 1n, client(1).account.address, 7n)).rejects.toThrow('Auction bidding window is closed')
		await getAnvilWindowEthereum().setTime(opensAt)
		await expect(client(1).writeContract({ abi, address, functionName: 'submitBid', args: [client(1).account.address, client(1).account.address, 12_000n, 1n, 3n], value: 7n })).rejects.toThrow('Only the auction controller')
		await expect(client().writeContract({ abi, address, functionName: 'finalize', args: [10n] })).rejects.toThrow('Auction bidding window has not closed')
		await expect(bid(address, 1_002n, 1n, client(1).account.address, 7n)).rejects.toThrow('Auction bid exceeds the REP inventory per lot')
		await expect(bid(address, 4n, 1n, client(1).account.address, 7n)).rejects.toThrow('Auction bid must use the REP price grid')
		await expect(bid(address, 3n, 1n)).rejects.toThrow('Auction bid must fund exact whole ETH lots')
		await expect(bid(address, 3n, 0n, client(1).account.address, 7n)).rejects.toThrow('Auction bid must fund exact whole ETH lots')
		await getAnvilWindowEthereum().setTime(closesAt)
		await expect(bid(address, 3n, 1n, client(1).account.address, 7n)).rejects.toThrow('Auction bidding window is closed')
		await expect(close(address, 11n)).rejects.toThrow('Auction raise limit exceeds its target')
		expect(await close(address)).toMatchObject({ filledLots: 0n })
		const late = await deploy()
		await expect(bid(late, unit, 1n)).rejects.toThrow('Auction bidding window is closed')
		expect(await close(late)).toMatchObject({ filledLots: 0n })
	})

	test('one remaining lot never creates subminimum winners', async () => {
		const address = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		await bid(address, unit, 8n)
		await bid(address, unit, 4n)
		await close(address, 1n)
		expect(await fill(address, 1n)).toMatchObject({ filledLots: 0n, usedAttoEth: 0n, refundAttoEth: 8n * unit })
		expect(await fill(address, 2n)).toMatchObject({ filledLots: 1n, usedAttoEth: unit, refundAttoEth: 3n * unit })
		await settle(address, 1n)
		await settle(address, 2n)
		expect(await client().readContract({ abi, address, functionName: 'refundCreditAttoEth', args: [client(1).account.address] })).toBe(11n * unit)
	})

	test('refunds and proceeds are independent pulls even for a rejecting bidder', async () => {
		const address = await deploy()
		const owner = client()
		const receiver = await deployContract(owner, encodeDeployData({ abi: rejectingArtifact.abi, bytecode: `0x${rejectingArtifact.evm.bytecode.object}` }))
		await getAnvilWindowEthereum().setTime(opensAt)
		const id = await bid(address, unit, 12n, receiver)
		await close(address)
		await settle(address, id)
		await expect(owner.writeContract({ abi, address, functionName: 'withdrawRaised', args: [receiver] })).rejects.toThrow('Auction proceeds transfer failed')
		expect(await owner.readContract({ abi, address, functionName: 'raisedWithdrawn' })).toBe(false)
		await writeContractAndWait(owner, () => owner.writeContract({ abi, address, functionName: 'withdrawRaised', args: [owner.account.address] }))
		const recipient = client(2).account.address
		const before = await owner.getBalance({ address: recipient })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: rejectingArtifact.abi, address: receiver, functionName: 'execute', args: [address, encodeFunctionData({ abi, functionName: 'withdrawRefund', args: [recipient] })] }))
		expect((await owner.getBalance({ address: recipient })) - before).toBe(2n * unit)
		expect(await owner.getBalance({ address })).toBe(0n)
		await expect(owner.writeContract({ abi, address, functionName: 'withdrawRaised', args: [recipient] })).rejects.toThrow('Auction proceeds are not withdrawable')
	})

	test('controller can combine a beneficiary refund and tolerate an empty ETH credit', async () => {
		const address = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		await bid(address, unit, 12n)
		await close(address)
		await settle(address, 1n)
		const bidder = client(1).account.address
		const recipient = client(2).account.address
		await expect(client(1).writeContract({ abi, address, functionName: 'withdrawRefundFor', args: [bidder, recipient] })).rejects.toThrow('Only the auction controller')
		const before = await client().getBalance({ address: recipient })
		for (let attempt = 0; attempt < 2; attempt++) await writeContractAndWait(client(), () => client().writeContract({ abi, address, functionName: 'withdrawRefundFor', args: [bidder, recipient] }))
		expect((await client().getBalance({ address: recipient })) - before).toBe(2n * unit)
	})

	test('all marginal sizes preserve the same principal-to-commitment ratio exactly', async () => {
		const target = 101n
		const price = 21n
		const lot = 13n
		const address = await deploy(target, 10_000n, lot, 3n)
		await getAnvilWindowEthereum().setTime(opensAt)
		const amounts = [5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]
		for (const amount of amounts) await bid(address, price, amount, client(1).account.address, lot)
		const result = await close(address, target)
		const total = amounts.reduce((sum, amount) => sum + amount, 0n)
		let before = 0n
		let used = 0n
		let rep = 0n
		let refund = 0n
		for (const [index, amount] of amounts.entries()) {
			const actual = await fill(address, BigInt(index + 1))
			const winning = ((before + amount) * target) / total - (before * target) / total
			expect(actual.filledLots).toBe(winning)
			expect(actual.usedAttoEth * price).toBe(actual.principalAttoRep * lot)
			used += actual.usedAttoEth
			rep += actual.principalAttoRep
			refund += actual.refundAttoEth
			before += amount
		}
		expect(used).toBe(target * lot)
		expect(rep).toBe(result.soldAttoRep)
		expect(rep).toBe(target * price)
		expect(refund + used).toBe(total * lot)
	})

	test('mixed books agree with an independent per-lot model across demand and inventory limits', async () => {
		const cases = [
			{ seed: 42n, inventory: 100_000n, limit: 333n, grid: 1n },
			{ seed: 123n, inventory: 100_001n, limit: 1_000n, grid: 1n },
			{ seed: 333n, inventory: 1_003n, limit: 75n, grid: 1n },
			{ seed: 444n, inventory: 31n, limit: 1_000n, grid: 1n },
			{ seed: 555n, inventory: 1_009n, limit: 1_000n, grid: 3n },
		]
		const auctions: { address: Address; entries: { price: bigint; lots: bigint; id: bigint }[]; inventory: bigint; limit: bigint; grid: bigint }[] = []
		for (const entry of cases) auctions.push({ address: await deploy(1_000n, entry.inventory, 1n, entry.grid), entries: [], inventory: entry.inventory, limit: entry.limit, grid: entry.grid })
		await getAnvilWindowEthereum().setTime(opensAt)
		for (const [index, auction] of auctions.entries()) {
			let seed = cases[index]?.seed ?? 1n
			for (let count = 0; count < 32; count++) {
				seed = (seed * 1_103_515_245n + 12_345n) % 2n ** 31n
				const price = ([3n, 7n, 11n, 13n, 19n][Number(seed % 5n)] ?? 3n) * auction.grid
				const lots = 1n + (seed % 31n)
				auction.entries.push({ price, lots, id: await bid(auction.address, price, lots, client(1).account.address, 1n) })
			}
		}
		for (const auction of auctions) {
			const ordered = [...auction.entries].sort((a, b) => Number(a.price - b.price || a.id - b.id))
			const limits = ordered.flatMap(entry => Array.from({ length: Number(entry.lots) }, () => entry.price))
			let filled = 0n
			let marginal = 0n
			for (const minimum of limits) {
				const next = filled + 1n
				if (next > auction.limit || next * minimum > auction.inventory) break
				filled = next
				marginal = minimum
			}
			const fullBefore = ordered.filter(entry => entry.price < marginal).reduce((sum, entry) => sum + entry.lots, 0n)
			const marginalDemand = ordered.filter(entry => entry.price === marginal).reduce((sum, entry) => sum + entry.lots, 0n)
			let price = filled === auction.limit ? marginal : auction.inventory / filled
			price -= price % auction.grid
			const sold = filled === auction.limit ? filled * price : auction.inventory
			const rounding = sold - filled * price
			const result = await close(auction.address, auction.limit)
			expect(result).toMatchObject({ attoRepPerLot: price, filledLots: filled, soldAttoRep: sold, roundingAttoRep: rounding, marginalMinimumAttoRepPerLot: marginal })
			let before = 0n
			let used = 0n
			let principal = 0n
			let fees = 0n
			let refund = 0n
			for (const entry of auction.entries) {
				let winning = entry.price < marginal ? entry.lots : 0n
				if (entry.price === marginal) {
					winning = ((before + entry.lots) * (filled - fullBefore)) / marginalDemand - (before * (filled - fullBefore)) / marginalDemand
					before += entry.lots
				}
				const actual = await fill(auction.address, entry.id)
				expect(actual.filledLots).toBe(winning)
				expect(actual.principalAttoRep).toBeGreaterThanOrEqual(winning * entry.price)
				used += actual.usedAttoEth
				principal += actual.principalAttoRep
				refund += actual.refundAttoEth
				if (winning !== 0n) fees += (await detach(auction.address, entry.id))[1]
			}
			expect(used).toBe(result.raisedAttoEth)
			expect(principal + fees).toBe(result.soldAttoRep)
			expect(fees).toBe(rounding)
			expect(result.soldAttoRep).toBeLessThanOrEqual(auction.inventory)
			expect(used + refund).toBe(auction.entries.reduce((sum, entry) => sum + entry.lots, 0n))
		}
	})

	test('detached winners retain old fees but cannot collect later cohort fees', async () => {
		const address = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		await bid(address, unit, 4n)
		await bid(address, unit, 6n)
		await close(address)
		await expect(client(1).writeContract({ abi, address, functionName: 'allocateAndRemoveFees', args: [1n, 0n, 0n] })).rejects.toThrow('Only the auction fee allocator')
		expect(await detach(address, 1n, 101n, 103n)).toEqual([40n, 41n])
		expect([...(await client().readContract({ abi, address, functionName: 'previewBidFees', args: [1n, 101n, 103n] }))]).toEqual([0n, 0n])
		expect(await client().readContract({ abi, address, functionName: 'remainingFeeLots' })).toBe(6n)
		await expect(detach(address, 1n)).rejects.toThrow('Auction bid has no remaining fee ownership')
		expect(await detach(address, 2n, 7n, 9n)).toEqual([68n, 71n])
		expect(await client().readContract({ abi, address, functionName: 'remainingFeeLots' })).toBe(0n)
		// ETH refund settlement and fee ownership are intentionally independent.
		await settle(address, 1n)
		await settle(address, 2n)
	})

	test('frozen fee ownership conserves every unit in different claim orders', async () => {
		const auctions = [await deploy(29n, 1_000n, 1n), await deploy(29n, 1_000n, 1n), await deploy(29n, 1_000n, 1n)]
		await getAnvilWindowEthereum().setTime(opensAt)
		for (const auction of auctions) for (let index = 0; index < 23; index++) await bid(auction, 3n + BigInt(index % 4), 1n + BigInt(index % 5), client(1).account.address, 1n)
		const expected = new Map<bigint, [bigint, bigint]>()
		for (const [index, auction] of auctions.entries()) {
			await close(auction, 29n)
			const winners: bigint[] = []
			for (let id = 1n; id <= 23n; id++) if ((await fill(auction, id)).filledLots > 0n) winners.push(id)
			if (index === 1) winners.reverse()
			if (index === 2) winners.sort((a, b) => Number(((a * 17n) % 23n) - ((b * 17n) % 23n)))
			let eth = 0n
			let rep = 0n
			for (const [position, id] of winners.entries()) {
				const fees = await detach(auction, id, position === 0 ? 113n : 0n, position === 0 ? 197n : 0n)
				eth += fees[0]
				rep += fees[1]
				if (index === 0) expected.set(id, fees)
				else {
					const prior = expected.get(id)
					if (prior === undefined) throw new Error('Missing original fee allocation')
					expect(fees).toEqual([...prior])
				}
			}
			expect([eth, rep]).toEqual([113n, 197n])
			expect(await client().readContract({ abi, address: auction, functionName: 'remainingFeeLots' })).toBe(0n)
		}
	})

	test('inventory residue and later fee budgets have the same ownership in either claim order', async () => {
		const auctions = [await deploy(10n, 101n, 1n, 3n), await deploy(10n, 101n, 1n, 3n)]
		await getAnvilWindowEthereum().setTime(opensAt)
		for (const address of auctions) {
			await bid(address, 3n, 1n, client(1).account.address, 1n)
			await bid(address, 6n, 3n, client(2).account.address, 1n)
		}
		const expected = new Map<bigint, readonly [bigint, bigint]>()
		for (const [index, address] of auctions.entries()) {
			expect(await close(address)).toMatchObject({ attoRepPerLot: 24n, filledLots: 4n, soldAttoRep: 101n, roundingAttoRep: 5n })
			let totalEth = 0n
			let totalRep = 0n
			for (const [position, id] of (index === 0 ? [1n, 2n] : [2n, 1n]).entries()) {
				const fees = await detach(address, id, position === 0 ? 13n : 0n, position === 0 ? 17n : 0n)
				totalEth += fees[0]
				totalRep += fees[1]
				if (index === 0) expected.set(id, fees)
				else {
					const previous = expected.get(id)
					if (previous === undefined) throw new Error('First claim order did not record this bid')
					expect(fees[0]).toBe(previous[0])
					expect(fees[1]).toBe(previous[1])
				}
			}
			expect([totalEth, totalRep]).toEqual([13n, 22n])
			expect(await client().readContract({ abi, address, functionName: 'remainingFeeLots' })).toBe(0n)
		}
	})

	test('packed fee amounts reject overflow instead of silently truncating ownership', async () => {
		const address = await deploy()
		await getAnvilWindowEthereum().setTime(opensAt)
		await bid(address, unit, 10n)
		await close(address)
		for (const amounts of [
			[1n << 128n, 0n],
			[0n, 1n << 128n],
		] as const) {
			await expect(client().readContract({ abi, address, functionName: 'previewBidFees', args: [1n, ...amounts] })).rejects.toThrow('Auction amount exceeds the supported range')
			await expect(client().writeContract({ abi, address, functionName: 'allocateAndRemoveFees', args: [1n, ...amounts] })).rejects.toThrow('Auction amount exceeds the supported range')
		}
		expect(await client().readContract({ abi, address, functionName: 'remainingFeeLots' })).toBe(10n)
		expect(await detach(address, 1n, (1n << 128n) - 1n, (1n << 128n) - 1n)).toEqual([(1n << 128n) - 1n, (1n << 128n) - 1n])
	})

	test('repeated new fee budgets conserve exact totals through mixed partial winners', async () => {
		const address = await deploy(17n, 1_000n, 1n)
		await getAnvilWindowEthereum().setTime(opensAt)
		for (let index = 0; index < 31; index++) await bid(address, 7n, 1n + BigInt(index % 5), client(1).account.address, 1n)
		await close(address, 17n)
		let totalEth = 0n
		let totalRep = 0n
		let allocatedEth = 0n
		let allocatedRep = 0n
		for (let id = 31n; id > 0n; id--) {
			const winner = (await fill(address, id)).filledLots > 0n
			if (!winner) {
				await expect(detach(address, id, 1n, 1n)).rejects.toThrow('Auction bid has no remaining fee ownership')
				continue
			}
			const eth = (id * 37n) % 101n
			const rep = (id * 71n) % 113n
			const fees = await detach(address, id, eth, rep)
			totalEth += eth
			totalRep += rep
			allocatedEth += fees[0]
			allocatedRep += fees[1]
		}
		expect([allocatedEth, allocatedRep]).toEqual([totalEth, totalRep])
		expect(await client().readContract({ abi, address, functionName: 'remainingFeeLots' })).toBe(0n)
	})

	test('closing, refund settlement and fee detachment stay logarithmic from 64 to 512 bids', async () => {
		const small = await deploy(1_000n, 1_000_000n, 1n)
		const large = await deploy(1_000n, 1_000_000n, 1n)
		await getAnvilWindowEthereum().setTime(opensAt)
		for (let index = 0; index < 512; index++) {
			await bid(large, 1n + BigInt(index), 1n, client(1).account.address, 1n)
			if (index < 64) await bid(small, 1n + BigInt(index), 1n, client(1).account.address, 1n)
		}
		await getAnvilWindowEthereum().setTime(closesAt)
		const closeGas = (address: Address) => client().estimateContractGas({ abi, address, functionName: 'finalize', args: [1_000n] })
		const smallClose = await closeGas(small)
		const largeClose = await closeGas(large)
		expect(largeClose).toBeLessThan(smallClose + 100_000n)
		expect(largeClose).toBeLessThan(500_000n)
		await close(small, 1_000n)
		await close(large, 1_000n)
		const claimGas = (address: Address) => client().estimateContractGas({ abi, address, functionName: 'settleBid', args: [1n] })
		expect(await claimGas(large)).toBeLessThan((await claimGas(small)) + 100_000n)
		const feeGas = (address: Address) => client().estimateContractGas({ abi, address, functionName: 'allocateAndRemoveFees', args: [1n, 1_000_003n, 2_000_003n] })
		const smallFee = await feeGas(small)
		const largeFee = await feeGas(large)
		expect(largeFee).toBeLessThan(smallFee + 350_000n)
		expect(largeFee).toBeLessThan(1_200_000n)
	})
})
