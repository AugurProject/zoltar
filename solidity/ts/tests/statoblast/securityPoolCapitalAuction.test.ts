import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalAuctionDelegate_SecurityPoolCapitalAuctionDelegate as delegateArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalAuctionHarness_CapitalAuctionHarness as harnessArtifact,
	test_statoblast_CapitalAuctionHarness_CapitalAuctionAdapterMock as adapterArtifact,
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
	const call = (functionName: 'installAuction', rep = REP, lot = LOT) => writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName, args: [adapter, 3n, rep, lot] }))
	const position = (id: bigint) => caller.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const owner = (address: Address) => caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [address] })
	const materialize = (id: bigint) => writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeAuctionBid', args: [id] }))
	const setPrice = async (price: bigint, seconds = 100_000n) => {
		const now = (await caller.getBlock()).timestamp
		return writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [price, Number(now + seconds)] }))
	}
	const activate = async (demand = 3n * LOT) => {
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [capital, 3n * REP] }))
		await call('installAuction')
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
		await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [1n, first.account.address, 12_000n, 2n] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'setBid', args: [2n, second.account.address, 15_000n, 1n] }))
		await setPrice(ATTO_ETH_PER_ETH)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'beginImport' }))
		await setBaselineSnapshot()
	})

	test('installation requires real collateral, valid lot precision and the fork authority', async () => {
		const delegate = await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionDelegate' })
		await expect(caller.writeContract({ abi: delegateArtifact.abi, address: delegate, functionName: 'install', args: [adapter, 3n, REP, LOT, LOT] })).rejects.toThrow('Only capital ledger context')
		await expect(caller.writeContract({ abi: delegateArtifact.abi, address: delegate, functionName: 'materialize', args: [1n] })).rejects.toThrow('Only capital ledger context')
		await expect(call('installAuction')).rejects.toThrow('Auction principal unfunded')
		await expect(call('installAuction', REP + 1n)).rejects.toThrow('Auction collateral ratio rounds per vault')
		await expect(call('installAuction', REP, LOT - 1n)).rejects.toThrow('Invalid auction cohort')
		await expect(caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'installAuctionCohort', args: [adapter, 3n, REP, LOT] })).rejects.toThrow('Only fork authority')
		await activate()
		await expect(call('installAuction')).rejects.toThrow('Auction cohort installation unavailable')
	})

	test('unclaimed winners count fully and detach only their own principal and fees', async () => {
		await activate()
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'totals' })).toMatchObject({ rep: 3n * REP, commitment: 3n * LOT, healthy: 3n * LOT })
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [first.account.address] })).toMatchObject({ principal: 2n * REP, commitment: 2n * LOT, withdrawable: 2n * REP - (2n * LOT * 105n * 12n) / 1000n })
		expect((await owner(first.account.address)).targetHealthFactorBps).toBe(12_000n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionPosition', args: [1n] })).toMatchObject({ principal: 2n * REP, commitment: 2n * LOT, earnedAttoEth: 20n, earnedAttoRep: 0n, materialized: false })
		await materialize(1n)
		const firstOwner = await owner(first.account.address)
		expect(firstOwner).toMatchObject({ targetHealthFactorBps: 12_000n, feesAttoEth: 20n })
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
		expect(await caller.getBalance({ address: capital })).toBe(0n)
		expect(await caller.getBalance({ address: adapter })).toBe(0n)
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
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionPosition', args: [2n] })).toMatchObject({ principal: REP, commitment: LOT, liquidationStarted: started, materialized: false })
		await expect(writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOver', args: [1n, LOT, 0n, 0n] }))).rejects.toThrow('Materialize an individual auction vault')
		await expect(writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [adapter] }))).rejects.toThrow()
	})

	const setCommitment = (client: WriteClient, commitment: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'setCommitment', args: [commitment] }))

	test('a winner materializes and cures its own lot, keeping all its REP, while the caller gains nothing', async () => {
		await activate(0n)
		await setPrice(3n * ATTO_ETH_PER_ETH)
		const callerBefore = await owner(caller.account.address)
		await materialize(2n)
		await setCommitment(second, 0n)
		const secondOwner = await owner(second.account.address)
		expect((await position(secondOwner.positionId)).commitment).toBe(0n)
		// The deficit is below the minimum commitment, so the floor removes the whole lot.
		expect(secondOwner.freeAttoRep).toBe(REP)
		expect(await owner(caller.account.address)).toEqual(callerBefore)
		expect((await owner(caller.account.address)).feesAttoRep).toBe(0n)
		expect(await caller.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [capital] })).toBe(3n * REP)
		expect(await position(1n)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
		expect(await caller.readContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'remainingLots' })).toBe(2n)
	})

	test('a cure never removes more than spare capacity and leaves each residual fully backed', async () => {
		await activate(2n * LOT)
		await setPrice(3n * ATTO_ETH_PER_ETH)
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
		expect(await position(secondId)).toMatchObject({ commitment: 0n, releasedRep: REP })
	})

	test('materialization pays nothing regardless of gas price', async () => {
		await activate(0n)
		await setPrice(3n * ATTO_ETH_PER_ETH)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'materializeAuctionBid', args: [2n], gasPrice: 10n ** 9n }))
		expect((await owner(caller.account.address)).feesAttoRep).toBe(0n)
		expect((await owner(caller.account.address)).feesAttoEth).toBe(0n)
		expect(await caller.getBalance({ address: adapter })).toBe(0n)
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

	test('a bounded takeover materializes one distressed winner and isolates its principal loss and earned fees', async () => {
		await activate()
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		await setPrice(3n * ATTO_ETH_PER_ETH)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [caller.account.address, REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, REP] }))
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [caller.account.address, REP] }))
		await getAnvilWindowEthereum().advanceTime(3601n)
		const bounds = { maximumOwnerPrincipal: 2n * REP, maximumOwnerCommitment: LOT, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'acceptedPriceEpoch' }), expectedSourceBatch: 0n }
		await expect(caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverAuctionBid', args: [2n, LOT, REP, REP, { ...bounds, maximumOwnerPrincipal: 2n * REP - 1n }] })).rejects.toThrow('Takeover owner principal exceeds limit')
		expect((await owner(second.account.address)).positionId).toBe(0n)
		expect(await caller.readContract({ abi: adapterArtifact.abi, address: adapter, functionName: 'removed', args: [2n] })).toBe(false)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'takeOverAuctionBid', args: [2n, LOT, REP, REP, bounds] }))
		expect(await position((await owner(caller.account.address)).positionId)).toMatchObject({ rep: 2n * REP, commitment: LOT })
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionPosition', args: [1n] })).toMatchObject({ principal: 2n * REP, commitment: 2n * LOT, earnedAttoEth: 20n, materialized: false })
		expect(await caller.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'auctionPosition', args: [2n] })).toMatchObject({ principal: 0n, commitment: 0n, earnedAttoEth: 10n, materialized: true })
		expect(await position(1n)).toMatchObject({ rep: 2n * REP, commitment: 2n * LOT })
	})

	test('new income keeps its original ownership when another bidder materializes first', async () => {
		await activate()
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		await materialize(1n)
		await writeContractAndWait(caller, () => caller.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditFees', value: 30n }))
		await materialize(2n)
		await writeContractAndWait(first, () => first.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'claimEarnings' }))
		expect((await owner(second.account.address)).feesAttoEth).toBe(20n)
		expect((await owner(first.account.address)).feesAttoEth).toBe(0n)
		// The first owner has claimed 40 attoETH; only the second owner
		// still owns the remaining 20 attoETH in capital custody.
		expect(await caller.getBalance({ address: capital })).toBe(20n)
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
})
