import { beforeAll, describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, getAddress, parseAbiItem, toEventSelector, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './statoblast/securityPoolCapitalTestComponents'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalRepairAuctionHarness_CapitalRepairAuctionHarness as harnessArtifact,
	test_statoblast_CapitalRepairAuctionHarness_CapitalRepairAuctionAdapterMock as adapterArtifact,
	statoblast_WETH9_WETH9 as wethArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../types/contractArtifact'

// Section C of the audit brief: the capital auction cohort on the real ledger with a mock adapter.
// Each claimed bid's lots join its bidder's own account; one bidder may hold several bids.
// Long run: AUDIT_FUZZ_SECONDS=20 (budget of the randomized cohort test) AUDIT_FUZZ_SEED=<n> bun ./tooling/testing/bun-test.mts --timeout 600000 solidity/ts/tests/auditAuctionCapitalCohortFuzz.test.ts

const SECONDS = Number(process.env['AUDIT_FUZZ_SECONDS'] ?? '3')
let seed = Number(BigInt(process.env['AUDIT_FUZZ_SEED'] ?? '20261113') % 0xffffffffn)
const random = () => {
	seed = (seed + 0x6d2b79f5) | 0
	let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
	return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}
const below = (limit: number) => Math.floor(random() * limit)
const pick = <T>(values: readonly T[]): T => {
	const value = values[below(values.length)]
	if (value === undefined) throw new Error('Cannot pick from an empty list')
	return value
}
const PINNED_SCENARIOS = 4
const LOT = 10n ** 15n
const UNIT = 10n ** 18n
const GRID = 21n

describe('audit fuzz: capital auction cohort owned by bidders', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let clients: WriteClient[] = []
	let caller: WriteClient
	let harness: Address
	let capital: Address
	let index: Address
	let adapter: Address
	let token: Address
	let weth: Address
	const deploy = async (data: Hex) => {
		const receipt = await caller.waitForTransactionReceipt({ hash: await caller.sendTransaction({ data }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Deployment address missing')
		return getAddress(receipt.contractAddress)
	}
	const reasonOf = async (attempt: () => Promise<unknown>) => {
		try {
			await attempt()
		} catch (error) {
			return error instanceof Error ? error.message : String(error)
		}
		return 'no revert'
	}
	const snapshot = async () => {
		const id = await getAnvilWindowEthereum().requestRaw({ method: 'evm_snapshot', params: [] })
		if (typeof id !== 'string') throw new Error('Snapshot identifier missing')
		return id
	}
	const revert = async (id: string) => {
		if ((await getAnvilWindowEthereum().requestRaw({ method: 'evm_revert', params: [id] })) !== true) throw new Error('Snapshot revert failed')
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		clients = TEST_ADDRESSES.map(address => createWriteClient(ethereum, address))
		const first = clients[0]
		if (first === undefined) throw new Error('Test client missing')
		caller = first
		const components = await deployCapitalTestComponents(caller)
		if (components.contractAddress === undefined || components.contractAddress === null) throw new Error('Test components missing')
		harness = await deploy(encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [components.contractAddress] }))
		capital = await caller.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		index = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'commitmentIndex' })
		token = await caller.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		weth = await caller.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'collateralToken' })
		adapter = await deploy(encodeDeployData({ abi: adapterArtifact.abi, bytecode: `0x${adapterArtifact.evm.bytecode.object}`, args: [capital] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setRepairAuction', args: [adapter] }))
		const now = (await caller.getBlock()).timestamp
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [UNIT, Number(now + 100_000_000n)] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'beginImport' }))
		await setBaselineSnapshot()
	})

	// Runs randomized cohort scenarios from the current seed while `more` allows another one.
	const runCohorts = async (more: (scenarios: number) => boolean) => {
		let scenarios = 0
		// Three bidders for up to five bids: bidders often hold several bids, which join their account together.
		const bidders = clients.slice(1, 4)
		const keeper = clients[6]
		if (keeper === undefined) throw new Error('Keeper client missing')
		while (more(scenarios)) {
			const saved = await snapshot()
			scenarios++
			let credits = 0
			const exactFees = scenarios % 2 === 1
			const bidCount = 2 + below(4)
			const repPerLot = GRID * (BigInt(below(3)) * 10n ** 14n + 8n * 10n ** 13n + BigInt(below(1_000_000)))
			type Holder = { client: WriteClient; address: Address; takenOver: boolean; takeoverReward: bigint; removed: bigint }
			const holders = new Map<Address, Holder>()
			const bids: { id: bigint; lots: bigint; owner: Holder; claimed: boolean; expectedAttoEthScaled: bigint }[] = []
			for (let position = 0; position < bidCount; position++) {
				const client = pick(bidders)
				const address = client.account.address
				const holder = holders.get(address) ?? { client, address, takenOver: false, takeoverReward: 0n, removed: 0n }
				holders.set(address, holder)
				const id = BigInt(position + 1) + (position % 2 === 0 ? 0n : 1n << 200n)
				const lots = BigInt(1 + below(4))
				await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [id, address, lots] }))
				bids.push({ id, lots, owner: holder, claimed: false, expectedAttoEthScaled: 0n })
			}
			const owners = [...holders.values()]
			const bidsOf = (holder: Holder) => bids.filter(bid => bid.owner === holder)
			const lotsOf = (holder: Holder) => bidsOf(holder).reduce((sum, bid) => sum + bid.lots, 0n)
			const claimedLotsOf = (holder: Holder) => bidsOf(holder).reduce((sum, bid) => sum + (bid.claimed ? bid.lots : 0n), 0n)
			const totalLots = bids.reduce((sum, bid) => sum + bid.lots, 0n)
			const context = () => `repPerLot=${repPerLot} bids=[${bids.map(bid => `#${bid.id % 1000n}:${bid.lots}lots@${bid.owner.address.slice(0, 6)}${bid.claimed ? 'C' : ''}${bid.owner.takenOver ? 'T' : ''}`).join(' ')}]`
			expect(await reasonOf(() => caller.simulateContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installRepairAuction', args: [adapter, totalLots, repPerLot, LOT] }))).toContain('Auction principal unfunded')
			await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [capital, totalLots * repPerLot] }))
			expect(await reasonOf(() => caller.simulateContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installRepairAuction', args: [adapter, totalLots, repPerLot + 1n, LOT] }))).toContain('Auction collateral ratio rounds per vault')
			await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installRepairAuction', args: [adapter, totalLots, repPerLot, LOT] }))
			await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'finishImport', args: [exactFees ? totalLots * LOT : 0n] }))
			const cohortId = (await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionCohort' }))[1]
			let credited = 0n
			let keeperDeposit = 0n
			const setPrice = async (price: bigint) => {
				const now = (await caller.getBlock()).timestamp
				await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [price, Number(now + 100_000_000n)] }))
			}
			const check = async (label: string) => {
				const cohort = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionCohort' })
				const remaining = bids.filter(bid => !bid.claimed).reduce((sum, bid) => sum + bid.lots, 0n)
				if (cohort[2] !== remaining) throw new Error(`${label}: cohort remainingLots ${cohort[2]} != ${remaining}: ${context()}`)
				const aggregate = await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [cohortId] })
				if (aggregate.rep !== remaining * repPerLot || aggregate.commitment !== remaining * LOT) throw new Error(`${label}: cohort position holds rep ${aggregate.rep} commitment ${aggregate.commitment}, expected ${remaining} lots: ${context()}`)
				let earned = 0n
				for (const holder of owners) {
					const account = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [holder.address] })
					const unclaimed = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'unclaimedRepairAuctionBids', args: [holder.address] })
					const expectedUnclaimed = BigInt(bidsOf(holder).filter(bid => !bid.claimed).length)
					if (unclaimed !== expectedUnclaimed) throw new Error(`${label}: bidder ${holder.address} has ${unclaimed} unclaimed bids, expected ${expectedUnclaimed}: ${context()}`)
					let ownerEarned = account.feesAttoEth
					if (account.positionId !== 0n) ownerEarned += (await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [account.positionId] })).ethFees
					const views = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionPositions', args: [bidsOf(holder).map(bid => bid.id)] })
					for (const [slot, bid] of bidsOf(holder).entries()) {
						const position = views[slot]
						if (position === undefined) throw new Error(`${label}: bid ${bid.id} view missing`)
						if (getAddress(position.bidder) !== holder.address || position.claimed !== bid.claimed || position.materialized !== bid.claimed) throw new Error(`${label}: bid ${bid.id} bidder or claim flags wrong: ${context()}`)
						if (position.materialized !== (position.positionId !== 0n) || (bid.claimed && position.positionId !== account.positionId && !holder.takenOver)) throw new Error(`${label}: bid ${bid.id} position ${position.positionId} is not its bidder's ${account.positionId}: ${context()}`)
						if (position.principal !== bid.lots * repPerLot || position.commitment !== bid.lots * LOT) throw new Error(`${label}: bid ${bid.id} principal ${position.principal} commitment ${position.commitment}, expected ${bid.lots} lots: ${context()}`)
						ownerEarned += position.earnedAttoEth
					}
					const collateral = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [holder.address] })
					// Unclaimed lots stay in the cohort, outside the bidder's own account.
					if (collateral[0] !== claimedLotsOf(holder) * repPerLot - holder.takeoverReward || collateral[1] !== claimedLotsOf(holder) * LOT - holder.removed) throw new Error(`${label}: ownerCollateral of ${holder.address} is ${collateral[0]}/${collateral[1]}: ${context()}`)
					earned += ownerEarned
					if (exactFees) {
						// Exact share is the bids' expected scaled earnings / totalLots. Integer splits move less than an
						// attoETH per credit and per materialization between winners, in either direction.
						const expectedScaled = bidsOf(holder).reduce((sum, bid) => sum + bid.expectedAttoEthScaled, 0n)
						const scaled = ownerEarned * totalLots - expectedScaled
						const deviation = (scaled < 0n ? -scaled : scaled) / totalLots + 1n
						if (deviation > BigInt(2 * credits + bids.length + 2)) throw new Error(`${label}: bidder ${holder.address} earned ${ownerEarned}, exact ${expectedScaled}/${totalLots}: ${context()}`)
					}
				}
				const keeperPrincipal = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [keeper.account.address] })
				expect(keeperPrincipal[0]).toBe(keeperDeposit + owners.reduce((sum, holder) => sum + holder.takeoverReward, 0n))
				if (earned > credited) throw new Error(`${label}: winners are owed ${earned} of ${credited} credited: ${context()}`)
				const [ledgerCash, deferredCash] = await Promise.all([capital, harness].map(address => caller.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [address] })))
				if (ledgerCash === undefined || deferredCash === undefined) throw new Error('Missing capital fee custody balances')
				const wethBalanceAttoEth = ledgerCash + deferredCash
				// Healthy cohorts keep every credited attoETH; fees of unhealthy intervals are burned by design.
				if (exactFees ? wethBalanceAttoEth !== credited : wethBalanceAttoEth > credited || wethBalanceAttoEth < earned) throw new Error(`${label}: ledger holds ${wethBalanceAttoEth} collateral for ${credited} credited and ${earned} owed fees: ${context()}`)
				const totals = await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'totals' })
				const free = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totalFreeAttoRep' })
				const retirement = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'retirementCashAttoRep' })
				const balance = await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })
				if (balance !== totals[0] + free + retirement || balance !== totalLots * repPerLot + keeperDeposit) throw new Error(`${label}: ledger REP ${balance} != pledged ${totals[0]} + free ${free} + retirement ${retirement} (expected ${totalLots * repPerLot + keeperDeposit}): ${context()}`)
				if (!owners.some(holder => holder.takenOver) && totals[1] !== totalLots * LOT) throw new Error(`${label}: total commitment ${totals[1]} != ${totalLots * LOT}: ${context()}`)
			}
			let forked = false
			// Anyone claims any batch of bids, already claimed ones included; each claim moves only its own bid.
			const materialize = async (bid: (typeof bids)[number]) => {
				const batch = [bid, ...bids.filter(other => other !== bid && below(3) === 0)]
				const client = below(2) === 0 ? keeper : bid.owner.client
				await writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeRepairAuctionBids', args: [batch.map(entry => entry.id)] }))
				for (const entry of batch) entry.claimed = true
			}
			await check('installed')
			const operations = 6 + below(8)
			for (let step = 0; step < operations; step++) {
				const choice = below(exactFees ? 4 : 8)
				const bid = pick(bids)
				if (choice === 0 || choice === 1) await materialize(bid)
				else if (choice === 2 && !forked) {
					const value = pick([1n, BigInt(1 + below(100)), BigInt(1 + below(1_000_000_000))])
					await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value }))
					credited += value
					credits++
					for (const winner of bids) if (!winner.owner.takenOver) winner.expectedAttoEthScaled += value * winner.lots
				} else if (choice === 3 && !forked) await setPrice(pick([UNIT, UNIT / 2n, (UNIT * 3n) / 4n, UNIT - 1n]))
				else if (choice === 4) {
					// Third parties cannot plant principal on a winner's account or act on the shared cohort position.
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [bid.owner.address, 1n] }))).toContain(forked ? 'Capital universe inactive' : 'Invalid capital deposit')
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOver', args: [cohortId, LOT, 0n, 0n] }))).not.toBe('no revert')
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'serveRetirement', args: [cohortId] }))).not.toBe('no revert')
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'registerRepairAuctionBidder', args: [keeper.account.address] }))).toContain('Only the repair auction')
				} else if (choice === 5 && !forked && !owners.some(holder => holder.takenOver)) {
					// Distress every winner, wait out the takeover reward ramp, and let a keeper take over one bidder.
					await setPrice(10n * UNIT)
					await getAnvilWindowEthereum().advanceTime(3601n)
					const holder = bid.owner
					const principal = lotsOf(holder) * repPerLot
					// The keeper takes over at most this bid's commitment at its own 100% target, so it funds that requirement.
					const deposit = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'requiredRep', args: [bid.lots * LOT, 10_000n] })
					await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [keeper.account.address, deposit] }))
					await writeContractAndWait(keeper, () => keeper.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, deposit] }))
					await writeContractAndWait(keeper, () => keeper.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [keeper.account.address, deposit] }))
					keeperDeposit += deposit
					const target = (await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [holder.address] })).targetHealthFactorBps
					const bounds = { maximumOwnerPrincipal: 100n * principal, maximumOwnerCommitment: lotsOf(holder) * LOT, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'acceptedPriceEpoch' }), expectedSourceBatch: 0n }
					expect(target === 0n || target === 10_000n).toBe(true)
					let takeoverHash: Hex | undefined
					const outcome = await reasonOf(async () => {
						takeoverHash = await writeContractAndWait(keeper, () => keeper.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverRepairAuctionBid', args: [bid.id, bid.lots * LOT, 0n, keeperDeposit, bounds] }))
					})
					if (outcome !== 'no revert') {
						if (!outcome.includes('Position requires additional backing') && !outcome.includes('Receiver commitment below minimum')) throw new Error(`keeper takeover reverted unexpectedly: ${outcome}: ${context()}`)
						await check('minimum repair remains atomic')
						continue
					}
					if (takeoverHash === undefined) throw new Error('Missing takeover receipt')
					const receipt = await keeper.waitForTransactionReceipt({ hash: takeoverHash })
					for (const log of receipt.logs) {
						if (
							getAddress(log.address) !== getAddress(capital) ||
							(log.topics[0] !== toEventSelector(parseAbiItem('event CommitmentTakenOver(uint96 indexed sourceId,uint96 indexed receiverId,uint256 commitment,uint256 takeoverRewardAttoRep)')) &&
								log.topics[0] !== toEventSelector(parseAbiItem('event CommitmentCured(uint96 indexed positionId,uint256 removedCommitment)')))
						)
							continue
						const event = decodeEventLog({ abi: capitalArtifact.abi, data: log.data, topics: log.topics })
						if (event.eventName === 'CommitmentTakenOver') {
							holder.takeoverReward += event.args.takeoverRewardAttoRep
							holder.removed += event.args.commitment
						} else if (event.eventName === 'CommitmentCured') holder.removed += event.args.removedCommitment
					}
					bid.claimed = true
					holder.takenOver = true
					// The taken-over bidder's account stays usable.
					await writeContractAndWait(holder.client, () => holder.client.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'checkpoint' }))
				} else if (choice === 6 && !forked && step > 2) {
					const timestamp = (await caller.getBlock()).timestamp
					await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [timestamp] }))
					forked = true
				} else await getAnvilWindowEthereum().advanceTime(BigInt(1 + below(5000)))
				await check(`step ${step} choice ${choice}`)
			}
			// Every remaining bid can still be claimed (also after a fork), in random order, down to an empty cohort.
			for (let rest = bids.filter(bid => !bid.claimed); rest.length !== 0; rest = bids.filter(bid => !bid.claimed)) {
				const bid = rest[below(rest.length)]
				if (bid === undefined) throw new Error('Remaining bid missing')
				await materialize(bid)
				await check(`final claim ${bid.id}`)
			}
			expect((await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionCohort' }))[2]).toBe(0n)
			for (const holder of owners) {
				if (holder.takenOver) continue
				const owner = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [holder.address] })
				const position = await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [owner.positionId] })
				if (position.rep !== lotsOf(holder) * repPerLot || position.commitment !== lotsOf(holder) * LOT || owner.freeAttoRep !== 0n || (owner.targetHealthFactorBps !== 0n && owner.targetHealthFactorBps !== 10_000n))
					throw new Error(`bidder ${holder.address} holds rep ${position.rep} commitment ${position.commitment} free ${owner.freeAttoRep}: ${context()}`)
			}
			await revert(saved)
		}
	}

	test('C: random cohorts materialize in any order with fee credits, price changes, attacks and takeovers', async () => {
		const started = Date.now()
		await runCohorts(() => Date.now() - started < SECONDS * 1000)
	})

	test('C: pinned seed 2 funds every keeper takeover from the receiver requirement (#1463)', async () => {
		// Seed 2 reaches a takeover at ten times the price in its fourth scenario; four times the principal under-funded it.
		seed = 2
		await runCohorts(scenarios => scenarios < PINNED_SCENARIOS)
	})
})
