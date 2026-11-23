import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, getCreate2Address, toHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './statoblast/securityPoolCapitalTestComponents'
import { auctionVaultCreationCode, decodeAuctionVaultBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
	test_statoblast_CapitalAuctionHarness_CapitalAuctionHarness as harnessArtifact,
	test_statoblast_CapitalAuctionHarness_CapitalAuctionAdapterMock as adapterArtifact,
	test_statoblast_AuctionVaultDeploymentBenchmark_AuctionVaultDeploymentBenchmark as benchmarkArtifact,
	test_statoblast_AuctionVaultDeploymentBenchmark_AuctionVaultBenchmarkAuctionMock as auctionMockArtifact,
	test_statoblast_AuctionVaultDeploymentBenchmark_AuctionVaultBenchmarkCapitalMock as capitalMockArtifact,
	statoblast_WETH9_WETH9 as wethArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../types/contractArtifact'

// Sections C (capital auction cohort on the real ledger, real vault clones, mock adapter)
// and D (vault clone bindings, prediction, access) of the audit brief.
// Long run: AUDIT_FUZZ_SECONDS=20 (budget of the randomized cohort test) AUDIT_FUZZ_SEED=<n> bun ./tooling/testing/bun-test.mts --timeout 600000 solidity/ts/tests/auditAuctionCapitalVaultFuzz.test.ts

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
const randomBits = (bits: number) => {
	let value = 0n
	for (let index = 0; index < bits; index += 16) value = (value << 16n) | BigInt(below(65536))
	return value & ((1n << BigInt(bits)) - 1n)
}
const PINNED_SCENARIOS = 4
const LOT = 10n ** 15n
const UNIT = 10n ** 18n
const GRID = 21n

describe('audit fuzz: capital auction cohort and auction vault clones', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let clients: WriteClient[] = []
	let caller: WriteClient
	let harness: Address
	let capital: Address
	let index: Address
	let adapter: Address
	let token: Address
	let weth: Address
	let benchmark: Address
	let implementation: Address
	let auctionMock: Address
	let capitalMock: Address
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
	const createClone = async (owner: Address, capitalAddress: Address, auctionAddress: Address, bidId: bigint) => {
		const simulation = await caller.simulateContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'createClone', args: [owner, capitalAddress, auctionAddress, bidId] })
		await writeContractAndWait(caller, () => caller.writeContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'createClone', args: [owner, capitalAddress, auctionAddress, bidId] }))
		return getAddress(simulation.result)
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
		benchmark = await deploy(`0x${benchmarkArtifact.evm.bytecode.object}`)
		auctionMock = await deploy(`0x${auctionMockArtifact.evm.bytecode.object}`)
		capitalMock = await deploy(`0x${capitalMockArtifact.evm.bytecode.object}`)
		implementation = await caller.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'implementation' })
		const now = (await caller.getBlock()).timestamp
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [UNIT, Number(now + 100_000_000n)] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'beginImport' }))
		await setBaselineSnapshot()
	})

	test('D: clone bindings, address prediction and access for random owners and bid identifiers', async () => {
		const owners: Address[] = [addressString(1n), addressString(0xabn), addressString(0xffffn << 100n), addressString((1n << 160n) - 1n), addressString(1n << 159n), addressString(randomBits(64)), ...Array.from({ length: 10 }, () => addressString(randomBits(160) | 1n))]
		const bidIds = [0n, 1n, 2n, 255n, 256n, (1n << 96n) - 1n, 1n << 255n, (1n << 255n) + 1n, (1n << 256n) - 1n, (1n << 256n) - 2n, ...Array.from({ length: 10 }, () => randomBits(256))]
		const seen = new Set<string>()
		for (let round = 0; round < 40; round++) {
			const owner = round < owners.length ? (owners[round] ?? addressString(1n)) : pick(owners)
			const bidId = round < bidIds.length ? (bidIds[round] ?? 0n) : pick(bidIds)
			const boundCapital = round % 3 === 0 ? addressString(randomBits(160) | 1n) : capitalMock
			const boundAuction = round % 5 === 0 ? addressString(randomBits(120) | 1n) : auctionMock
			const key = `${bidId}`
			const predicted = getAddress(await caller.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'predictClone', args: [owner, boundCapital, boundAuction, bidId] }))
			const bindings = { implementation, owner: getAddress(owner), capital: getAddress(boundCapital), auction: getAddress(boundAuction), bidId }
			expect(getCreate2Address({ from: benchmark, salt: toHex(bidId, { size: 32 }), bytecode: auctionVaultCreationCode(bindings) })).toBe(predicted)
			if (seen.has(key)) {
				// The salt is the bid identifier and the code binds the owner: the same pair
				// cannot be redeployed, while another owner lands on a different address.
				expect(await reasonOf(() => caller.simulateContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'createClone', args: [owner, boundCapital, boundAuction, bidId] }))).not.toBe('')
				continue
			}
			seen.add(key)
			const vault = await createClone(owner, boundCapital, boundAuction, bidId)
			expect(vault).toBe(predicted)
			const runtime = await caller.getCode({ address: vault })
			if (runtime === undefined) throw new Error('Clone code missing')
			expect((runtime.length - 2) / 2).toBe(137)
			expect(decodeAuctionVaultBindings(runtime)).toEqual(bindings)
			expect(getAddress(await caller.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'owner' }))).toBe(getAddress(owner))
			expect(getAddress(await caller.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'initialCapital' }))).toBe(getAddress(boundCapital))
			expect(getAddress(await caller.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'auction' }))).toBe(getAddress(boundAuction))
			expect(await caller.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'bidId' })).toBe(bidId)
			expect(await caller.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'initialPositionMaterialized' })).toBe(false)
			expect(await reasonOf(() => caller.simulateContract({ account: addressString(0x5757n), abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [auctionMock, 0n, '0x5c36b186'] }))).toContain('Only the auction vault owner')
		}
		// The implementation holds no bindings and refuses every use.
		for (const functionName of ['owner', 'initialCapital', 'auction', 'bidId'] as const) expect(await reasonOf(() => caller.readContract({ abi: vaultArtifact.abi, address: implementation, functionName }))).toContain('Auction vault is not a clone')
		expect(await reasonOf(() => caller.simulateContract({ abi: vaultArtifact.abi, address: implementation, functionName: 'execute', args: [auctionMock, 0n, '0x'] }))).toContain('Auction vault is not a clone')
		expect(await reasonOf(() => caller.simulateContract({ abi: vaultArtifact.abi, address: implementation, functionName: 'depositPrincipal', args: [capitalMock, 1n, 10_000n] }))).toContain('Auction vault is not a clone')
		expect(await caller.readContract({ abi: vaultArtifact.abi, address: implementation, functionName: 'initialPositionMaterialized' })).toBe(false)
		expect(await reasonOf(() => caller.simulateContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'createClone', args: [addressString(0n), capitalMock, auctionMock, 77n] }))).toContain('Auction vault dependencies missing')
	})

	test('D: lazy materialization for a losing bid, a late fill, and a keeper that materializes first', async () => {
		const owner = caller.account.address
		const ping = encodeFunctionData({ abi: auctionMockArtifact.abi, functionName: 'ping' })
		const execute = (vault: Address, client = caller) => writeContractAndWait(client, () => client.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [auctionMock, 0n, ping] }))
		const materialized = (vault: Address) => caller.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'initialPositionMaterialized' })
		const bidId = (1n << 255n) + 5n
		const vault = await createClone(owner, capitalMock, auctionMock, bidId)
		// Losing bid: usable, never flagged, no ledger call.
		await execute(vault)
		await execute(vault)
		expect(await materialized(vault)).toBe(false)
		expect(await caller.readContract({ abi: capitalMockArtifact.abi, address: capitalMock, functionName: 'positionIds', args: [vault] })).toBe(0n)
		// The fill appears later (cancelled then recomputed is impossible on chain, but the vault must follow the auction).
		await writeContractAndWait(caller, () => caller.writeContract({ abi: auctionMockArtifact.abi, address: auctionMock, functionName: 'setFill', args: [bidId, vault, 3n] }))
		const stranger = clients[1]
		if (stranger === undefined) throw new Error('Stranger client missing')
		expect(await reasonOf(() => execute(vault, stranger))).toContain('Only the auction vault owner')
		expect(await materialized(vault)).toBe(false)
		await execute(vault)
		expect(await materialized(vault)).toBe(true)
		// ETH sent to the clone reaches the implementation's receive().
		await stranger.waitForTransactionReceipt({ hash: await stranger.sendTransaction({ to: vault, value: 5n }) })
		expect(await caller.getBalance({ address: vault })).toBe(5n)
		// A failed owner operation reverts the flag together with the materialization.
		const second = await createClone(owner, capitalMock, auctionMock, 9n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: auctionMockArtifact.abi, address: auctionMock, functionName: 'setFill', args: [9n, second, 1n] }))
		expect(await reasonOf(() => caller.simulateContract({ abi: vaultArtifact.abi, address: second, functionName: 'execute', args: [auctionMock, 0n, '0xdeadbeef'] }))).not.toBe('no revert')
		expect(await materialized(second)).toBe(false)
	})

	// Runs randomized cohort scenarios from the current seed while `more` allows another one.
	const runCohorts = async (more: (scenarios: number) => boolean) => {
		let scenarios = 0
		const bidders = clients.slice(1, 6)
		const keeper = clients[6]
		if (keeper === undefined) throw new Error('Keeper client missing')
		while (more(scenarios)) {
			const saved = await snapshot()
			scenarios++
			let credits = 0
			const exactFees = scenarios % 2 === 1
			const bidCount = 2 + below(4)
			const repPerLot = GRID * (BigInt(below(3)) * 10n ** 14n + 8n * 10n ** 13n + BigInt(below(1_000_000)))
			const bids: { id: bigint; lots: bigint; health: bigint; owner: WriteClient; vault: Address; materialized: boolean; takenOver: boolean; expectedAttoEth: bigint; expectedAttoEthScaled: bigint }[] = []
			for (let position = 0; position < bidCount; position++) {
				const owner = bidders[position % bidders.length]
				if (owner === undefined) throw new Error('Bidder client missing')
				const id = BigInt(position + 1) + (position % 2 === 0 ? 0n : 1n << 200n)
				const vault = await createClone(owner.account.address, capital, adapter, id)
				const lots = BigInt(1 + below(4))
				const health = pick([10_000n, 12_000n, 15_000n])
				await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [id, vault, health, lots] }))
				bids.push({ id, lots, health, owner, vault, materialized: false, takenOver: false, expectedAttoEth: 0n, expectedAttoEthScaled: 0n })
			}
			const totalLots = bids.reduce((sum, bid) => sum + bid.lots, 0n)
			const context = () => `repPerLot=${repPerLot} bids=[${bids.map(bid => `#${bid.id % 1000n}:${bid.lots}lots@${bid.health}${bid.materialized ? 'M' : ''}${bid.takenOver ? 'T' : ''}`).join(' ')}]`
			expect(await reasonOf(() => caller.simulateContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installAuction', args: [adapter, totalLots, repPerLot, LOT] }))).toContain('Auction principal unfunded')
			await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [capital, totalLots * repPerLot] }))
			expect(await reasonOf(() => caller.simulateContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installAuction', args: [adapter, totalLots, repPerLot + 1n, LOT] }))).toContain('Auction collateral ratio rounds per vault')
			await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installAuction', args: [adapter, totalLots, repPerLot, LOT] }))
			await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'finishImport', args: [exactFees ? totalLots * LOT : 0n] }))
			const cohortId = (await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionCohort' }))[1]
			let credited = 0n
			let keeperDeposit = 0n
			const setPrice = async (price: bigint) => {
				const now = (await caller.getBlock()).timestamp
				await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [price, Number(now + 100_000_000n)] }))
			}
			const checkpoint = encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'checkpoint' })
			const check = async (label: string) => {
				const cohort = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionCohort' })
				const remaining = bids.filter(bid => !bid.materialized).reduce((sum, bid) => sum + bid.lots, 0n)
				if (cohort[2] !== remaining) throw new Error(`${label}: cohort remainingLots ${cohort[2]} != ${remaining}: ${context()}`)
				const aggregate = await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [cohortId] })
				if (aggregate.rep !== remaining * repPerLot || aggregate.commitment !== remaining * LOT) throw new Error(`${label}: cohort position holds rep ${aggregate.rep} commitment ${aggregate.commitment}, expected ${remaining} lots: ${context()}`)
				let earned = 0n
				for (const bid of bids) {
					const position = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionPosition', args: [bid.id] })
					if (getAddress(position.vault) !== bid.vault || position.materialized !== bid.materialized) throw new Error(`${label}: bid ${bid.id} vault or materialized flag wrong: ${context()}`)
					if (position.principal !== bid.lots * repPerLot || (!bid.takenOver && position.commitment !== bid.lots * LOT) || position.targetHealthFactorBps !== bid.health)
						throw new Error(`${label}: bid ${bid.id} principal ${position.principal} commitment ${position.commitment} target ${position.targetHealthFactorBps}, expected ${bid.lots} lots: ${context()}`)
					const collateral = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [bid.vault] })
					if (collateral[0] !== bid.lots * repPerLot || (!bid.takenOver && collateral[1] !== bid.lots * LOT)) throw new Error(`${label}: ownerCollateral of bid ${bid.id} is ${collateral[0]}/${collateral[1]}: ${context()}`)
					earned += position.earnedAttoEth
					if (exactFees) {
						// Exact share is expectedAttoEthScaled / totalLots. Integer splits move less than an attoETH per
						// credit and per materialization between winners, in either direction.
						const scaled = position.earnedAttoEth * totalLots - bid.expectedAttoEthScaled
						const deviation = (scaled < 0n ? -scaled : scaled) / totalLots + 1n
						if (deviation > BigInt(2 * credits + bids.length + 2)) throw new Error(`${label}: bid ${bid.id} earned ${position.earnedAttoEth}, exact ${bid.expectedAttoEthScaled}/${totalLots}: ${context()}`)
					}
				}
				if (earned > credited) throw new Error(`${label}: winners are owed ${earned} of ${credited} credited: ${context()}`)
				const wethBalanceAttoEth = await caller.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [capital] })
				// Healthy cohorts keep every credited attoETH; fees of unhealthy intervals are burned by design.
				if (exactFees ? wethBalanceAttoEth !== credited : wethBalanceAttoEth > credited || wethBalanceAttoEth < earned) throw new Error(`${label}: ledger holds ${wethBalanceAttoEth} collateral for ${credited} credited and ${earned} owed fees: ${context()}`)
				const totals = await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'totals' })
				const free = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totalFreeAttoRep' })
				const retirement = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'retirementCashAttoRep' })
				const balance = await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })
				if (balance !== totals[0] + free + retirement || balance !== totalLots * repPerLot + keeperDeposit) throw new Error(`${label}: ledger REP ${balance} != pledged ${totals[0]} + free ${free} + retirement ${retirement} (expected ${totalLots * repPerLot + keeperDeposit}): ${context()}`)
				if (!bids.some(bid => bid.takenOver) && totals[1] !== totalLots * LOT) throw new Error(`${label}: total commitment ${totals[1]} != ${totalLots * LOT}: ${context()}`)
			}
			const materialize = async (bid: (typeof bids)[number]) => {
				if (below(2) === 0) {
					await writeContractAndWait(keeper, () => keeper.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeAuctionBid', args: [bid.id] }))
				} else {
					await writeContractAndWait(bid.owner, () => bid.owner.writeContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'execute', args: [capital, 0n, checkpoint] }))
					expect(await caller.readContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'initialPositionMaterialized' })).toBe(true)
				}
				bid.materialized = true
			}
			await check('installed')
			let forked = false
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
					for (const winner of bids) if (!winner.takenOver) winner.expectedAttoEthScaled += value * winner.lots
				} else if (choice === 3 && !forked) await setPrice(pick([UNIT, UNIT / 2n, (UNIT * 3n) / 4n, UNIT - 1n]))
				else if (choice === 4) {
					// Third parties cannot plant principal on a winner's vault or act on the shared cohort position.
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [bid.vault, 1n] }))).toContain(forked ? 'Capital universe inactive' : 'Invalid capital deposit')
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOver', args: [cohortId, LOT, 0n, 0n] }))).not.toBe('no revert')
					expect(await reasonOf(() => keeper.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'serveRetirement', args: [cohortId] }))).not.toBe('no revert')
					expect(await reasonOf(() => keeper.simulateContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'execute', args: [capital, 0n, checkpoint] }))).toContain('Only the auction vault owner')
				} else if (choice === 5 && !forked && !bids.some(other => other.takenOver)) {
					// Distress every winner, wait out the award ramp, and let a keeper take one bid over.
					await setPrice(10n * UNIT)
					await getAnvilWindowEthereum().advanceTime(3601n)
					const principal = bid.lots * repPerLot
					// The keeper takes over at most the bid's commitment at its own 100% target, so it funds that requirement.
					const deposit = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'requiredRep', args: [bid.lots * LOT, 10_000n] })
					await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [keeper.account.address, deposit] }))
					await writeContractAndWait(keeper, () => keeper.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, deposit] }))
					await writeContractAndWait(keeper, () => keeper.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [keeper.account.address, deposit] }))
					keeperDeposit += deposit
					const bounds = { maximumOwnerPrincipal: 100n * principal, maximumOwnerCommitment: bid.lots * LOT, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'acceptedPriceEpoch' }), expectedSourceBatch: 0n }
					const outcome = await reasonOf(() => writeContractAndWait(keeper, () => keeper.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverAuctionBid', args: [bid.id, bid.lots * LOT, 0n, keeperDeposit, bounds] })))
					if (outcome !== 'no revert') {
						if (!outcome.includes('Position requires additional backing') && !outcome.includes('Receiver commitment below minimum')) throw new Error(`keeper takeover reverted unexpectedly: ${outcome}: ${context()}`)
						await check('minimum repair remains atomic')
						continue
					}
					bid.materialized = true
					bid.takenOver = true
					// The vault of the taken-over winner stays usable.
					await writeContractAndWait(bid.owner, () => bid.owner.writeContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'execute', args: [capital, 0n, checkpoint] }))
				} else if (choice === 6 && !forked && step > 2) {
					const timestamp = (await caller.getBlock()).timestamp
					await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [timestamp] }))
					forked = true
				} else await getAnvilWindowEthereum().advanceTime(BigInt(1 + below(5000)))
				await check(`step ${step} choice ${choice}`)
			}
			// Every remaining winner can still materialize (also after a fork), in random order, down to an empty cohort.
			const rest = bids.filter(bid => !bid.materialized)
			while (rest.length !== 0) {
				const [bid] = rest.splice(below(rest.length), 1)
				if (bid === undefined) throw new Error('Remaining bid missing')
				await materialize(bid)
				await check(`final materialize ${bid.id}`)
			}
			expect((await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionCohort' }))[2]).toBe(0n)
			for (const bid of bids) {
				const owner = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [bid.vault] })
				if (bid.takenOver) continue
				const position = await caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [owner.positionId] })
				if (position.rep !== bid.lots * repPerLot || position.commitment !== bid.lots * LOT || owner.targetHealthFactorBps !== bid.health || owner.freeAttoRep !== 0n) throw new Error(`materialized bid ${bid.id} holds rep ${position.rep} commitment ${position.commitment} free ${owner.freeAttoRep}: ${context()}`)
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
