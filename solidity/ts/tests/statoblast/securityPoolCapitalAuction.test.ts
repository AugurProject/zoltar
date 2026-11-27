import { collateralBalance } from './burnEvidence'
import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, keccak256, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalRepairAuctionDelegate_SecurityPoolCapitalRepairAuctionDelegate as delegateArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalRepairAuctionHarness_CapitalRepairAuctionHarness as harnessArtifact,
	test_statoblast_CapitalRepairAuctionHarness_CapitalRepairAuctionAdapterMock as adapterArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './securityPoolCapitalTestComponents'

const ATTO_ETH_PER_ETH = 10n ** 18n
const LOT = 10n ** 15n
// The multiplier is 10500; 21 divides REP per lot, making its initial floor exact.
const REP = 2_100_000_000_000_000n

describe('Statoblast: individually owned lazy auction capital', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let caller: WriteClient
	let first: WriteClient
	let second: WriteClient
	let harness: Address
	let capital: Address
	let index: Address
	let adapter: Address
	let token: Address
	const call = (functionName: 'installRepairAuction', rep = REP, lot = LOT) => writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName, args: [adapter, 3n, rep, lot] }))
	const position = (id: bigint) => caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const owner = (address: Address) => caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [address] })
	const unclaimed = (holder: Address) => caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'unclaimedRepairAuctionBids', args: [holder] })
	const bidPosition = async (id: bigint) => {
		const [result] = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionPositions', args: [[id]] })
		if (result === undefined) throw new Error('Bid position missing')
		return result
	}
	const materialize = (id: bigint) => writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeRepairAuctionBids', args: [[id]] }))
	const setPrice = async (price: bigint, seconds = 100_000n) => {
		const now = (await caller.getBlock()).timestamp
		return writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [price, Number(now + seconds)] }))
	}
	type Choice = { rep: bigint; commitment: bigint; batch: bigint; remainingCommitment: bigint; retirementOrder: bigint }
	/** Import a branch choice for `holder` during the import phase, with its custody. */
	const importChoice = async (holder: Address, choice: Choice, target = 10_000n) => {
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [capital, choice.rep] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [holder, choice, target] }))
	}
	const active = (rep: bigint, commitment: bigint): Choice => ({ rep, commitment, batch: 0n, remainingCommitment: 0n, retirementOrder: 0n })
	const activate = async (demand = 3n * LOT) => {
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [capital, 3n * REP] }))
		await call('installRepairAuction')
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'finishImport', args: [demand] }))
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		caller = createWriteClient(ethereum, TEST_ADDRESSES[0])
		first = createWriteClient(ethereum, TEST_ADDRESSES[1])
		second = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const components = await deployCapitalTestComponents(caller)
		if (components.contractAddress === undefined) throw new Error('Test components missing')
		const deployed = await caller.waitForTransactionReceipt({ hash: await caller.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [components.contractAddress] }) }) })
		if (deployed.contractAddress === undefined) throw new Error('Capital auction harness missing')
		harness = deployed.contractAddress
		capital = await caller.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		index = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'commitmentIndex' })
		token = await caller.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		const auction = await caller.waitForTransactionReceipt({ hash: await caller.sendTransaction({ data: encodeDeployData({ abi: adapterArtifact.abi, bytecode: `0x${adapterArtifact.evm.bytecode.object}`, args: [capital] }) }) })
		if (auction.contractAddress === undefined) throw new Error('Auction adapter missing')
		adapter = auction.contractAddress
		await expect(caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [1n, first.account.address, 2n] })).rejects.toThrow('Only the repair auction')
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setRepairAuction', args: [adapter] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [1n, first.account.address, 2n] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [2n, second.account.address, 1n] }))
		await setPrice(ATTO_ETH_PER_ETH)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'beginImport' }))
		await setBaselineSnapshot()
	})

	test('installation requires real collateral, valid lot precision and the fork authority', async () => {
		const delegate = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionDelegate' })
		await expect(caller.writeContract({ abi: delegateArtifact.abi, address: delegate, functionName: 'install', args: [adapter, 3n, REP, LOT, LOT] })).rejects.toThrow('Only capital delegatecall')
		await expect(caller.writeContract({ abi: delegateArtifact.abi, address: delegate, functionName: 'materializeBid', args: [1n] })).rejects.toThrow('Only capital delegatecall')
		await expect(call('installRepairAuction')).rejects.toThrow('Auction principal unfunded')
		await expect(call('installRepairAuction', REP + 1n)).rejects.toThrow('Auction collateral ratio rounds per vault')
		await expect(call('installRepairAuction', REP, LOT - 1n)).rejects.toThrow('Invalid auction cohort')
		await expect(caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'installRepairAuctionCohort', args: [adapter, 3n, REP, LOT] })).rejects.toThrow('Only fork authority')
		await activate()
		await expect(call('installRepairAuction')).rejects.toThrow('Auction cohort installation unavailable')
	})

	test('unclaimed winners count fully and detach only their own principal and fees', async () => {
		await activate()
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totals' })).toMatchObject({ rep: 3n * REP, commitment: 3n * LOT, healthy: 3n * LOT })
		// Unclaimed lots stay in the cohort; the bidder's own account shows only what it holds.
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [first.account.address] })).toMatchObject({ principal: 0n, commitment: 0n, withdrawable: 0n })
		expect(await unclaimed(first.account.address)).toBe(1n)
		// Bids choose no health target; winning lots arrive at the protocol floor.
		expect((await owner(first.account.address)).targetHealthFactorBps).toBe(0n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'pendingServiceCash' })).toBe(30n)
		expect(await bidPosition(1n)).toMatchObject({ principal: 2n * REP, commitment: 2n * LOT, earnedAttoEth: 20n, earnedAttoRep: 0n, claimed: false, materialized: false })
		await materialize(1n)
		const firstOwner = await owner(first.account.address)
		expect(firstOwner).toMatchObject({ targetHealthFactorBps: 0n, feesAttoEth: 20n })
		expect(await position(firstOwner.positionId)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
		expect(await position(1n)).toMatchObject({ rep: REP, commitment: LOT })
		await materialize(2n)
		expect((await owner(second.account.address)).feesAttoEth).toBe(10n)
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totals' })).toMatchObject({ rep: 3n * REP, commitment: 3n * LOT, healthy: 3n * LOT })
		await materialize(1n)
		expect(await owner(first.account.address)).toEqual(firstOwner)
	})

	test('materialization requires no ETH and preserves every winning commitment', async () => {
		await activate()
		await materialize(1n)
		const id = (await owner(first.account.address)).positionId
		expect(await position(id)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
		expect(await collateralBalance(caller, harness, capital)).toBe(0n)
		expect(await collateralBalance(caller, harness, adapter)).toBe(0n)
		expect((await owner(second.account.address)).positionId).toBe(0n)
	})

	test('a materialized distressed winner keeps the original liquidation start and other winners remain unchanged', async () => {
		await activate()
		await setPrice(3n * ATTO_ETH_PER_ETH)
		const started = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'liquidationStarted', args: [1n] })
		await getAnvilWindowEthereum().advanceTime(3601n)
		await materialize(1n)
		const id = (await owner(first.account.address)).positionId
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'liquidationStarted', args: [id] })).toBe(started)
		expect(await bidPosition(2n)).toMatchObject({ principal: REP, commitment: LOT, liquidationStarted: started, materialized: false })
		await expect(writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOver', args: [1n, LOT, 0n, 0n] }))).rejects.toThrow('Materialize an individual repair auction bidder')
		await expect(writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [adapter] }))).rejects.toThrow()
	})

	const setCommitment = (client: WriteClient, commitment: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'setCommitment', args: [commitment] }))

	test('a minimum winner retires ordinarily when demand is zero without releasing REP through a cure', async () => {
		await activate(0n)
		await setPrice(3n * ATTO_ETH_PER_ETH)
		const callerBefore = await owner(caller.account.address)
		await materialize(2n)
		const hash = await setCommitment(second, 0n)
		const receipt = await caller.getTransactionReceipt({ hash })
		expect(receipt.logs.some(log => log.topics[0] === keccak256('CommitmentCured(uint96,uint256)'))).toBe(false)
		const secondOwner = await owner(second.account.address)
		expect((await position(secondOwner.positionId)).commitment).toBe(0n)
		// Zero demand lets the ordinary queue release the lot; owner settlement credits its REP.
		expect((await position(secondOwner.positionId)).releasedRep).toBe(REP)
		await writeContractAndWait(second, () => second.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'claimEarnings', args: [second.account.address] }))
		expect((await owner(second.account.address)).freeAttoRep).toBe(REP)
		expect(await owner(caller.account.address)).toEqual(callerBefore)
		expect((await owner(caller.account.address)).feesAttoRep).toBe(0n)
		expect(await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })).toBe(3n * REP)
		expect(await position(1n)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
		expect(await caller.readContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'remainingLots' })).toBe(2n)
	})

	test('a cure never removes more than spare capacity and leaves each residual fully backed', async () => {
		await activate(2n * LOT)
		// At price 4 the first lot's deficit is a whole minimum, so the owner's reduction is cured
		// rather than queued; a smaller deficit would queue (#1449).
		await setPrice(4n * ATTO_ETH_PER_ETH)
		await materialize(1n)
		const firstId = (await owner(first.account.address)).positionId
		await setCommitment(first, LOT)
		const cured = await position(firstId)
		expect(cured).toMatchObject({ rep: 2n * REP, commitment: LOT, batch: 0n })
		const required = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'requiredRep', args: [cured.commitment, 10_000n] })
		expect(cured.rep).toBeGreaterThanOrEqual(required)
		expect((await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totals' })).commitment).toBe(2n * LOT)
		// Demand now consumes every remaining commitment, so the second winner's exit can only wait in the queue.
		await materialize(2n)
		const secondId = (await owner(second.account.address)).positionId
		await setCommitment(second, 0n)
		expect(await position(secondId)).toMatchObject({ rep: REP, commitment: LOT })
		expect((await position(secondId)).batch).not.toBe(0n)
		expect((await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totals' })).commitment).toBe(2n * LOT)
		expect((await owner(caller.account.address)).feesAttoRep).toBe(0n)
		expect((await owner(caller.account.address)).feesAttoEth).toBe(0n)
		// Once healthy commitment covers the returned demand, the queued unbacked exit completes with all its REP.
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [LOT] }))
		expect(await position(secondId)).toMatchObject({ commitment: LOT, releasedRep: 0n })
		await writeContractAndWait(second, () => second.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'serveRetirement', args: [secondId] }))
		expect(await position(secondId)).toMatchObject({ commitment: 0n, releasedRep: REP })
	})

	test('materialization pays nothing regardless of gas price', async () => {
		await activate(0n)
		await setPrice(3n * ATTO_ETH_PER_ETH)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeRepairAuctionBids', args: [[2n]], gasPrice: 10n ** 9n }))
		expect((await owner(caller.account.address)).feesAttoRep).toBe(0n)
		expect((await owner(caller.account.address)).feesAttoEth).toBe(0n)
		expect(await collateralBalance(caller, harness, adapter)).toBe(0n)
		expect(await position(1n)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
		expect((await position((await owner(second.account.address)).positionId)).commitment).toBe(LOT)
	})

	test('a healthy winner keeping its commitment removes nothing and pays nothing', async () => {
		await activate(0n)
		await materialize(2n)
		const id = (await owner(second.account.address)).positionId
		await setCommitment(second, LOT)
		expect(await position(id)).toMatchObject({ rep: REP, commitment: LOT })
		expect((await owner(caller.account.address)).feesAttoRep).toBe(0n)
		expect((await owner(caller.account.address)).feesAttoEth).toBe(0n)
	})

	test.each([false, true])('a funded repair moves only its target takeover reward and preserves another winner’s fees (expired=%s)', async expired => {
		await activate()
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		await setPrice(6n * ATTO_ETH_PER_ETH, expired ? 60n : 100_000n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [caller.account.address, 3n * REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, 3n * REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [caller.account.address, 3n * REP] }))
		if (expired) await getAnvilWindowEthereum().advanceTime(61n)
		const bounds = { maximumOwnerPrincipal: 5n * REP, maximumOwnerCommitment: LOT, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'acceptedPriceEpoch' }), expectedSourceBatch: 0n }
		await expect(caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverRepairAuctionBid', args: [1n, LOT, 0n, 3n * REP, { ...bounds, maximumOwnerPrincipal: 3n * REP - 1n }] })).rejects.toThrow('Takeover owner principal exceeds limit')
		expect((await owner(first.account.address)).positionId).toBe(0n)
		expect(await caller.readContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'removed', args: [1n] })).toBe(false)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverRepairAuctionBid', args: [1n, LOT, 0n, 3n * REP, bounds] }))
		const acquired = await position((await owner(caller.account.address)).positionId)
		const firstAccount = await owner(first.account.address)
		const remaining = await position(firstAccount.positionId)
		expect(acquired.commitment).toBe(LOT)
		expect(acquired.rep + remaining.rep + firstAccount.freeAttoRep).toBe(5n * REP)
		expect(remaining.commitment).toBe(LOT)
		expect(firstAccount.feesAttoEth).toBe(20n)
		const [taken, untouched] = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionPositions', args: [[1n, 2n]] })
		expect(taken).toMatchObject({ bidder: first.account.address, positionId: firstAccount.positionId, claimed: true, materialized: true })
		expect(untouched).toMatchObject({ principal: REP, commitment: LOT, earnedAttoEth: 10n, claimed: false, materialized: false })
		expect(await position(1n)).toMatchObject({ rep: REP, commitment: LOT })
		await expect(caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverRepairAuctionBid', args: [2n, LOT, 0n, 0n, bounds] })).rejects.toThrow('Receiver collateral insufficient')
		expect((await owner(second.account.address)).positionId).toBe(0n)
	})

	test('new income keeps its original ownership when another bidder materializes first', async () => {
		await activate()
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		await materialize(1n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		await materialize(2n)
		await writeContractAndWait(first, () => first.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'claimEarnings', args: [first.account.address] }))
		expect((await owner(second.account.address)).feesAttoEth).toBe(20n)
		expect((await owner(first.account.address)).feesAttoEth).toBe(0n)
		// The first owner has claimed 40 attoETH; only the second owner
		// still owns the remaining 20 attoETH in capital custody.
		expect(await collateralBalance(caller, harness, capital)).toBe(20n)
	})

	test('frozen ownership detaches after backing migration without moving principal or changing the snapshot', async () => {
		await activate()
		const timestamp = (await caller.getBlock()).timestamp
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [timestamp] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'releaseForkBacking' }))
		expect(await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })).toBe(0n)
		await materialize(1n)
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'frozenBackingAttoRep' })).toBe(3n * REP)
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'frozenCommitmentAttoEth' })).toBe(3n * LOT)
		expect(await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })).toBe(0n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [first.account.address] }))
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'exported', args: [first.account.address] })).toBe(true)
		expect(await position(1n)).toMatchObject({ rep: REP, commitment: LOT })
	})

	test('a late unchosen winner cannot revive migrated principal', async () => {
		await activate()
		const timestamp = (await caller.getBlock()).timestamp
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [timestamp] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'releaseForkBacking' }))
		await getAnvilWindowEthereum().advanceTime(8n * 7n * 86_400n + 1n)
		await materialize(2n)
		await expect(second.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'withdrawPrincipal', args: [REP, second.account.address] })).rejects.toThrow('Capital universe inactive')
		expect(await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })).toBe(0n)
	})
	const liquidationStarted = (id: bigint) => caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'liquidationStarted', args: [id] })
	const cohortId = async () => (await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'repairAuctionCohort' }))[1]

	test('winning lots merge into the bidder’s existing position, which keeps the older liquidation start', async () => {
		// The imported position holds 1 ETH of commitment per REP lot: unhealthy above price 1, the lots above 2.
		await importChoice(first.account.address, active(REP, 2n * LOT))
		await activate()
		const existing = (await owner(first.account.address)).positionId
		await setPrice((3n * ATTO_ETH_PER_ETH) / 2n)
		const existingStart = await liquidationStarted(existing)
		expect(existingStart).not.toBe(0n)
		expect(await liquidationStarted(await cohortId())).toBe(0n)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await setPrice(3n * ATTO_ETH_PER_ETH)
		const cohortStart = await liquidationStarted(await cohortId())
		expect(cohortStart).toBeGreaterThan(existingStart)
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [first.account.address] })).toMatchObject({ principal: REP, commitment: 2n * LOT })
		const hash = await materialize(1n)
		const receipt = await caller.getTransactionReceipt({ hash })
		expect(receipt.logs.filter(log => log.topics[0] === keccak256('RepairAuctionBidMaterialized(uint256,address,uint96,uint256,uint256)'))).toHaveLength(1)
		const account = await owner(first.account.address)
		expect(account.positionId).toBe(existing)
		expect(await position(existing)).toMatchObject({ rep: 3n * REP, commitment: 4n * LOT, batch: 0n })
		// Merging can neither reset nor shorten the older clock.
		expect(await liquidationStarted(existing)).toBe(existingStart)
		expect(await unclaimed(first.account.address)).toBe(0n)
		expect(await bidPosition(2n)).toMatchObject({ liquidationStarted: cohortStart, materialized: false })
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totals' })).toMatchObject({ rep: 4n * REP, commitment: 5n * LOT })
	})

	test('a healthy existing position inherits the older distress of the winning lots it absorbs', async () => {
		// The imported position stays healthy up to price 6; the lots become unhealthy above 2.
		await importChoice(first.account.address, active(3n * REP, LOT))
		await activate()
		const existing = (await owner(first.account.address)).positionId
		await setPrice(3n * ATTO_ETH_PER_ETH)
		const cohortStart = await liquidationStarted(await cohortId())
		expect(cohortStart).not.toBe(0n)
		expect(await liquidationStarted(existing)).toBe(0n)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await setPrice(7n * ATTO_ETH_PER_ETH)
		expect(await liquidationStarted(existing)).toBeGreaterThan(cohortStart)
		await materialize(1n)
		expect(await liquidationStarted(existing)).toBe(cohortStart)
	})

	test('lots that join a healthy merged position clear its distress at the observed price', async () => {
		await importChoice(first.account.address, active(10n * REP, LOT))
		await activate()
		const existing = (await owner(first.account.address)).positionId
		await setPrice(3n * ATTO_ETH_PER_ETH)
		expect(await liquidationStarted(await cohortId())).not.toBe(0n)
		await materialize(1n)
		expect(await liquidationStarted(existing)).toBe(0n)
		await expect(caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOver', args: [existing, LOT, 0n, 0n] })).rejects.toThrow()
	})

	test('a merge that moves the liquidation start to the lots’ older distress keeps the penalty already paid', async () => {
		// The imported position becomes unhealthy above price 6, the lots above 2.
		await importChoice(first.account.address, active(6n * REP, 2n * LOT))
		await activate(5n * LOT)
		const existing = (await owner(first.account.address)).positionId
		await setPrice(3n * ATTO_ETH_PER_ETH)
		const cohortStart = await liquidationStarted(await cohortId())
		expect(cohortStart).not.toBe(0n)
		await getAnvilWindowEthereum().advanceTime(600n)
		await setPrice(7n * ATTO_ETH_PER_ETH)
		expect(await liquidationStarted(existing)).toBeGreaterThan(cohortStart)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await setPrice(7n * ATTO_ETH_PER_ETH)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [caller.account.address, 10n * REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, 10n * REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [caller.account.address, 10n * REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOver', args: [existing, LOT, 0n, 10n * REP] }))
		const paid = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'liquidationPenaltyPaid', args: [existing] })
		expect(paid).toBeGreaterThan(0n)
		expect((await position(existing)).commitment).toBe(LOT)
		await materialize(1n)
		expect(await liquidationStarted(existing)).toBe(cohortStart)
		// Without carrying the payment, the older clock would reopen the whole penalty on REP that already paid it.
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'liquidationPenaltyPaid', args: [existing] })).toBe(paid)
	})

	test.each([1n, 2n])('lots merged into a queued retirement (batch %s) keep the owner’s requested reduction', async batch => {
		await importChoice(first.account.address, { rep: 4n * REP, commitment: 2n * LOT, batch, remainingCommitment: LOT, retirementOrder: 1n })
		await activate(0n)
		const existing = (await owner(first.account.address)).positionId
		const preview = (id: bigint) => caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'previewRetirement', args: [id, ATTO_ETH_PER_ETH, 0n] })
		expect((await preview(existing)).commitmentReduction).toBe(LOT)
		await materialize(1n)
		const merged = await position(existing)
		expect(merged).toMatchObject({ rep: 6n * REP, commitment: 4n * LOT, remainingCommitment: 3n * LOT })
		expect(merged.batch).not.toBe(0n)
		expect((await preview(existing)).commitmentReduction).toBe(LOT)
		await writeContractAndWait(first, () => first.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'serveRetirement', args: [existing] }))
		// Serving the request removes only the requested reduction; the winning lots stay committed.
		expect(await position(existing)).toMatchObject({ rep: 6n * REP, commitment: 3n * LOT, batch: 0n })
	})

	test('a bidder with unclaimed bids cannot choose a fork branch until each one is claimed', async () => {
		await activate()
		const timestamp = (await caller.getBlock()).timestamp
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [timestamp] }))
		await expect(writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [first.account.address] }))).rejects.toThrow('Claim repair auction bids before choosing')
		// Claims work on the frozen ledger, and then the choice exports the claimed lots.
		await materialize(1n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [first.account.address] }))
		const account = await owner(first.account.address)
		expect(await position(account.positionId)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'exported', args: [first.account.address] })).toBe(true)
	})

	test('a bid that won nothing is claimed without a position and stops blocking fork choices', async () => {
		await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [3n, caller.account.address, 0n] }))
		await activate()
		expect(await unclaimed(caller.account.address)).toBe(1n)
		await materialize(3n)
		expect(await unclaimed(caller.account.address)).toBe(0n)
		expect((await owner(caller.account.address)).positionId).toBe(0n)
		expect(await bidPosition(3n)).toMatchObject({ bidder: caller.account.address, claimed: true, materialized: false, principal: 0n })
		// A repeated claim changes nothing.
		await materialize(3n)
		expect(await unclaimed(caller.account.address)).toBe(0n)
		await expect(caller.simulateContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeRepairAuctionBids', args: [[99n]] })).rejects.toThrow('Auction bid missing')
	})

	test('one bidder may place many bids, claimed in any batches at a cost that does not grow with them', async () => {
		const many = 20n
		for (let id = 100n; id < 100n + many; id++) await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [id, caller.account.address, 1n] }))
		const lots = 3n + many
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [capital, lots * REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'installRepairAuction', args: [adapter, lots, REP, LOT] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'finishImport', args: [lots * LOT] }))
		expect(await unclaimed(caller.account.address)).toBe(many)
		const gasOf = async (ids: bigint[]) => (await caller.getTransactionReceipt({ hash: await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeRepairAuctionBids', args: [ids] })) })).gasUsed
		// The first claim creates the bidder's position; every later claim merges one bid into it.
		await gasOf([100n])
		const secondClaim = await gasOf([101n])
		await gasOf(Array.from({ length: 17 }, (_, index) => 102n + BigInt(index)))
		expect(await unclaimed(caller.account.address)).toBe(1n)
		const lastClaim = await gasOf([119n])
		// No path loops over the bidder's bids, so the last claim costs no more than an early one.
		expect(lastClaim).toBeLessThan(secondClaim + 30_000n)
		expect(await unclaimed(caller.account.address)).toBe(0n)
		const account = await owner(caller.account.address)
		expect(await position(account.positionId)).toMatchObject({ rep: many * REP, commitment: many * LOT })
	})
})
