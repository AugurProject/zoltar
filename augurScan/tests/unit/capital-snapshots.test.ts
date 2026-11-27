import { expect, test } from 'bun:test'
import { abiForKind } from '../../src/abi-catalog.ts'
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, toFunctionSelector, zeroAddress } from '../../src/ethereum.ts'
import { capitalPositionRisk } from '../../src/operations.ts'
import { normalizeSnapshotTarget, type StateRead, sampleEntityStateWithRead } from '../../src/snapshots.ts'

const ledger = getAddress('0x1111111111111111111111111111111111111111')
const index = getAddress('0x2222222222222222222222222222222222222222')
const securityPool = getAddress('0x3333333333333333333333333333333333333333')
const feed = getAddress('0x4444444444444444444444444444444444444444')
const token = getAddress('0x5555555555555555555555555555555555555555')
const owner = getAddress('0x6666666666666666666666666666666666666666')
const other = getAddress('0x7777777777777777777777777777777777777777')
const zoltar = getAddress('0x8888888888888888888888888888888888888888')
const streams = getAddress('0x9999999999999999999999999999999999999999')
const settlement = getAddress('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')
const book = getAddress('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')
const services = getAddress('0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC')
const kinds: Readonly<Record<string, string>> = {
	[ledger]: 'securityPoolCapitalLedger',
	[index]: 'securityPoolCommitmentIndex',
	[securityPool]: 'securityPool',
	[zoltar]: 'zoltar',
	[streams]: 'securityPoolCapitalFeeStreams',
	[settlement]: 'securityPoolSettlement',
	[other]: 'securityPoolRepairAuction',
	[book]: 'securityPoolSettlementBook',
}

type Outputs = Readonly<Record<string, readonly unknown[] | ((args: readonly unknown[]) => readonly unknown[])>>
const ledgerOutputs: Outputs = {
	securityPool: [securityPool],
	universeId: [3n],
	commitmentIndex: [index],
	securityMultiplierBps: [15_000n],
	acceptedPrice: [200n * 10n ** 18n],
	conservativePrice: [210n * 10n ** 18n],
	liquidationPrice: [190n * 10n ** 18n],
	priceValidUntil: [1_800_000_000],
	isPriceValid: [true],
	frozen: [false],
	importing: [false],
	zoltar: [zoltar],
	getForkTime: [0n],
	totals: [900n, 40n, 30n],
	demandAttoEth: [25n],
	totalFreeAttoRep: [5n],
	retirementCashAttoRep: [1n],
	frozenBackingAttoRep: [0n],
	frozenCommitmentAttoEth: [0n],
	lastPositionId: [9n],
	priceFeed: [feed],
	collateralToken: [token],
	ownerAccount: [{ freeAttoRep: 20n, feesAttoEth: 4n, feesAttoRep: 6n, targetHealthFactorBps: 12_000n, positionId: 7n }],
	ownerCollateral: [520n, 10n, 30n],
	ownerConservativePrice: [215n * 10n ** 18n],
	repairAuctionCohort: [zeroAddress, 0n, 0n, 0n, 0n],
	unclaimedRepairAuctionBids: [0n],
	annualFeeBps: [200n],
	purchaseFeeBps: [30n],
	feeStreams: [streams],
	settlement: [settlement],
	services: [services],
	outstandingEth: [700n],
	outstandingRep: [80n],
	deferredEth: [3n],
	deferredRep: [0n],
	releasedThrough: [1_700_000_100],
	rewardDuration: [604_800],
	ledger: [book],
	bookIds: [4n],
	books: [5_000n, 4_900n, 60n, 0n, 0n, 0n, 1_700_000_000, false, 0n, 0n, 0n, true, 0, 0, 0n, 0n],
	liquidationStarted: [1_700_000_000],
	requiredRep: [400n],
	accountOf: args => [{ owner: args[0] === 7n ? owner : other, batch: 0n, rep: 500n, commitment: 10n, maxHealthyPrice: 180n * 10n ** 18n, releasedRep: 0n, ethFees: 1n, repFees: 2n, remainingCommitment: 0n }],
}

// Encodes every answer through the compiled ABI, so the snapshot decodes exactly what a node returns.
const reader =
	(overrides: Outputs = {}, calls: string[] = []): StateRead =>
	async (address, abi, functionName, args = []) => {
		if (address === token) return functionName === 'symbol' ? 'USDC' : 6
		const kind = kinds[address]
		const compiled = kind === undefined ? undefined : abiForKind(kind)
		if (compiled === undefined) throw new Error(`Unexpected read target ${address}`)
		const input = encodeFunctionData({ abi: compiled, functionName, args })
		const method = compiled.find(item => item.type === 'function' && toFunctionSelector(item) === input.slice(0, 10))
		if (method?.type !== 'function' || method.outputs === undefined) throw new Error(`Missing compiled function ${kind}.${functionName}`)
		calls.push(`${kind}.${functionName}`)
		const answer = overrides[functionName] ?? ledgerOutputs[functionName]
		if (answer === undefined) throw new Error(`Unexpected read ${functionName}`)
		return decodeFunctionResult({ abi, functionName, data: encodeAbiParameters(method.outputs, typeof answer === 'function' ? answer(args) : answer) })
	}

test('a capital ledger snapshot reads its price, totals, feed and last position id', async () => {
	const snapshot = await sampleEntityStateWithRead({ entityType: 'capital-ledger', entityIdentity: ledger.toLowerCase(), address: ledger }, reader())
	expect(snapshot).toMatchObject({ entityType: 'capital-ledger', sourceMethod: 'augurscan.capital-ledger-state.v1', readStatus: 'success' })
	expect(snapshot.readResult).toEqual({
		securityPool: securityPool.toLowerCase(),
		universeId: '3',
		securityMultiplierBps: '15000',
		acceptedPrice: (200n * 10n ** 18n).toString(),
		conservativePrice: (210n * 10n ** 18n).toString(),
		liquidationPrice: (190n * 10n ** 18n).toString(),
		priceValidUntil: '1800000000',
		priceValid: true,
		frozen: false,
		importing: false,
		universeForked: false,
		commitmentIndex: index.toLowerCase(),
		priceFeed: feed.toLowerCase(),
		pledgedAttoRep: '900',
		commitmentAttoEth: '40',
		healthyCommitmentAttoEth: '30',
		demandAttoEth: '25',
		// totals().commitment 40 above demand 25.
		spareCommitmentAttoEth: '15',
		totalFreeAttoRep: '5',
		retirementCashAttoRep: '1',
		frozenBackingAttoRep: '0',
		frozenCommitmentAttoEth: '0',
		lastPositionId: '9',
		fees: {
			annualFeeBps: '200',
			purchaseFeeBps: '30',
			feeStreams: streams.toLowerCase(),
			services: services.toLowerCase(),
			vestingOutstandingAttoEth: '700',
			vestingOutstandingAttoRep: '80',
			deferredAttoEth: '3',
			deferredAttoRep: '0',
			vestingReleasedThrough: '1700000100',
			vestingDurationSeconds: '604800',
			settlementBook: book.toLowerCase(),
			bookId: '4',
			bookCashAttoEth: '5000',
			bookFeeCashAttoEth: '60',
			bookFeesEnabled: true,
		},
		collateral: { address: token.toLowerCase(), symbol: 'USDC', decimals: 6 },
	})
})

test('fee reads are optional beside the ledger state and skip an unregistered book', async () => {
	const sample = async (overrides: Outputs) => (await sampleEntityStateWithRead({ entityType: 'capital-ledger', entityIdentity: ledger.toLowerCase(), address: ledger }, reader(overrides))).readResult
	// A universe without a registered settlement book has id 0. Its public getter returns zeros; skip that absent book.
	const unregistered = await sample({
		bookIds: [0n],
		books: () => {
			throw new Error('Unregistered book must not be read')
		},
	})
	expect(unregistered?.['fees']).toMatchObject({ bookId: '0', annualFeeBps: '200' })
	expect(unregistered?.['fees']).not.toHaveProperty('bookCashAttoEth')
	// A failed fee read leaves the ledger's price and totals in place and records the reason.
	const failed = await sample({
		outstandingEth: () => {
			throw new Error('fee streams unavailable')
		},
	})
	expect(failed).toMatchObject({ commitmentAttoEth: '40', feeReadError: 'fee streams unavailable' })
	expect(failed).not.toHaveProperty('fees')
})

test('a capital position snapshot reads the permanent owner of one id', async () => {
	const target = (positionId: bigint) => ({ entityType: 'capital-position' as const, entityIdentity: `${ledger.toLowerCase()}:${positionId}`, address: ledger, positionId })
	expect((await sampleEntityStateWithRead(target(7n), reader())).readResult).toEqual({ ledger: ledger.toLowerCase(), positionId: '7', owner: owner.toLowerCase() })
	expect((await sampleEntityStateWithRead(target(8n), reader())).readResult).toMatchObject({ owner: other.toLowerCase() })
	// An id the index never issued has no owner; the read fails instead of recording the zero address.
	const unknown = reader({ accountOf: () => [{ owner: zeroAddress, batch: 0n, rep: 0n, commitment: 0n, maxHealthyPrice: 0n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }] })
	expect(await sampleEntityStateWithRead(target(99n), unknown)).toMatchObject({ readStatus: 'failed', readFailureReason: 'Capital position does not exist' })
	expect(await sampleEntityStateWithRead({ entityType: 'capital-position', entityIdentity: 'position', address: ledger }, reader())).toMatchObject({ readStatus: 'failed', readFailureReason: 'Capital position snapshot is missing its id' })
})

test('the auction adapter owns the cohort position that the ledger keeps outside its owner account', async () => {
	// The ledger reports zero principal and commitment for the adapter; the cohort's REP and commitment are in the index.
	const cohort = reader({
		repairAuctionCohort: [owner, 9n, 4n, 125n, 5n],
		ownerAccount: [{ freeAttoRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, targetHealthFactorBps: 0n, positionId: 0n }],
		ownerCollateral: [0n, 0n, 0n],
		accountOf: args => [{ owner, batch: 0n, rep: args[0] === 9n ? 500n : 0n, commitment: 20n, maxHealthyPrice: 195n * 10n ** 18n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }],
	})
	const snapshot = await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, cohort)
	expect(snapshot.readResult).toMatchObject({ repairAuctionCohort: true, repairAuctionCohortRemainingLots: '4', positionId: '9', principalAttoRep: '500', pledgedAttoRep: '500', commitmentAttoEth: '20', healthFactorBps: '12500', belowLiquidationPrice: false })
	// A cohort is taken over per bid through `takeOverRepairAuctionBid`, never as a whole, even below the liquidation price.
	const underwater = await sampleEntityStateWithRead(
		{ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner },
		reader({ repairAuctionCohort: [owner, 9n, 4n, 125n, 5n], ownerAccount: [{ freeAttoRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, targetHealthFactorBps: 0n, positionId: 0n }], ownerCollateral: [0n, 0n, 0n] }),
	)
	expect(underwater.readResult).toMatchObject({ repairAuctionCohort: true, belowLiquidationPrice: true, takeoverPreconditionsMet: false })
	const cohortRisk = capitalPositionRisk(underwater.readResult ?? {})
	expect(cohortRisk).toMatchObject({ protocolState: 'under-collateralized', scannerSeverity: 'critical' })
	expect(cohortRisk.scannerReason).toContain('taken over per bid')
	expect(cohortRisk.scannerReason).not.toContain('adverse observation')
	expect(capitalPositionRisk(snapshot.readResult ?? {})).toMatchObject({ protocolState: 'healthy' })
	// Any other owner is unaffected by an installed cohort.
	const bystander = await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, reader({ repairAuctionCohort: [other, 9n, 4n, 125n, 5n] }))
	expect(bystander.readResult).toMatchObject({ positionId: '7', principalAttoRep: '520' })
	expect(bystander.readResult?.['repairAuctionCohort']).toBeUndefined()
})

test('a capital owner snapshot reads principal, commitment and the health of the live position', async () => {
	const snapshot = await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: `${ledger.toLowerCase()}:${owner.toLowerCase()}`, address: ledger, ownerAddress: owner }, reader())
	expect(snapshot.readStatus).toBe('success')
	expect(snapshot.readResult).toMatchObject({
		ledger: ledger.toLowerCase(),
		owner: owner.toLowerCase(),
		securityPool: securityPool.toLowerCase(),
		universeId: '3',
		positionId: '7',
		principalAttoRep: '520',
		commitmentAttoEth: '10',
		withdrawableAttoRep: '30',
		freeAttoRep: '20',
		// The live position's pledged REP, not principal minus free REP.
		pledgedAttoRep: '500',
		targetHealthFactorBps: '12000',
		// Account fees plus the earnings the index still holds for the position.
		unclaimedFeesAttoEth: '5',
		unclaimedFeesAttoRep: '8',
		ownerConservativePrice: (215n * 10n ** 18n).toString(),
		requiredAttoRep: '400',
		healthFactorBps: '12500',
		maxHealthyPrice: (180n * 10n ** 18n).toString(),
		liquidationStartedAt: '1700000000',
		belowLiquidationPrice: true,
		takeoverPreconditionsMet: true,
		priceValid: true,
		collateral: { address: token.toLowerCase(), symbol: 'USDC', decimals: 6 },
	})
})

test('take-over eligibility persists after price expiry once an adverse observation starts the clock', async () => {
	const sample = async (overrides: Outputs) => (await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, reader(overrides))).readResult
	expect(await sample({ liquidationStarted: [0] })).toMatchObject({ belowLiquidationPrice: true, takeoverPreconditionsMet: false })
	expect(await sample({ isPriceValid: [false] })).toMatchObject({ belowLiquidationPrice: true, takeoverPreconditionsMet: true })
	expect(await sample({ isPriceValid: [false], liquidationStarted: [0] })).toMatchObject({ belowLiquidationPrice: true, takeoverPreconditionsMet: false })
	expect(await sample({ importing: [true] })).toMatchObject({ belowLiquidationPrice: true, takeoverPreconditionsMet: false })
	expect(await sample({ frozen: [true] })).toMatchObject({ belowLiquidationPrice: true, takeoverPreconditionsMet: false })
	// Zoltar forked the universe but the coordinator has not frozen the ledger yet: `_requireOpen` already rejects a take-over.
	expect(await sample({ getForkTime: [1_700_000_500n] })).toMatchObject({ universeForked: true, frozen: false, belowLiquidationPrice: true, takeoverPreconditionsMet: false })
	const healthy = { owner, batch: 0n, rep: 500n, commitment: 10n, maxHealthyPrice: 191n * 10n ** 18n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }
	expect(await sample({ accountOf: () => [healthy] })).toMatchObject({ belowLiquidationPrice: false, takeoverPreconditionsMet: false })
})

test('a bidder reports its unclaimed bids and the winning lots outside its account', async () => {
	const calls: string[] = []
	const sample = async (overrides: Outputs) => (await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, reader(overrides, calls))).readResult
	// Bid 2 won 500 REP of lots and is unclaimed; bid 5 filled nothing and is unclaimed; bid 6 won lots and was claimed.
	const lots = (bidId: unknown) => {
		if (bidId === 2n) return { bidder: owner, principal: 500n, commitment: 10n, liquidationStarted: 1_700_000_000, claimed: false, earnedAttoEth: 5n, earnedAttoRep: 8n }
		if (bidId === 6n) return { bidder: owner, principal: 300n, commitment: 6n, liquidationStarted: 0, claimed: true, earnedAttoEth: 0n, earnedAttoRep: 0n }
		return { bidder: owner, principal: 0n, commitment: 0n, liquidationStarted: 0, claimed: false, earnedAttoEth: 0n, earnedAttoRep: 0n }
	}
	const bidIds = [2n, 5n, 6n]
	const auction = {
		repairAuctionCohort: [other, 9n, 4n, 125n, 5n],
		unclaimedRepairAuctionBids: (args: readonly unknown[]) => [args[0] === owner ? 2n : 0n],
		engine: [other],
		bidderBidCount: (args: readonly unknown[]) => [args[0] === owner ? BigInt(bidIds.length) : 0n],
		bidderBidId: (args: readonly unknown[]) => [bidIds[Number(args[1])]],
		repairAuctionPositions: (args: readonly unknown[]) => [Array.isArray(args[0]) ? args[0].map(lots) : []],
	}
	// A fresh bidder: `ownerCollateral` is empty, so the unclaimed lots supply the principal, commitment, earnings and clock.
	const fresh = await sample({
		...auction,
		ownerCollateral: [0n, 0n, 0n],
		ownerAccount: [{ freeAttoRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, targetHealthFactorBps: 12_000n, positionId: 0n }],
	})
	expect(fresh).toMatchObject({
		positionId: '0',
		principalAttoRep: '500',
		commitmentAttoEth: '10',
		pledgedAttoRep: '500',
		withdrawableAttoRep: '0',
		liquidationStartedAt: '1700000000',
		unclaimedFeesAttoEth: '5',
		unclaimedFeesAttoRep: '8',
		repairAuctionUnclaimedBids: '2',
		repairAuctionPendingBidIds: ['2'],
		repairAuctionPendingPrincipalAttoRep: '500',
		repairAuctionPendingCommitmentAttoEth: '10',
		repairAuctionPendingEarnedAttoEth: '5',
		repairAuctionPendingEarnedAttoRep: '8',
	})
	// The bids are read in one batched call.
	expect(calls.filter(call => call === 'securityPoolCapitalLedger.repairAuctionPositions')).toEqual(['securityPoolCapitalLedger.repairAuctionPositions'])

	// A bidder without a live position keeps fees from earlier positions; the unclaimed lots' earnings add to them.
	const earlier = await sample({
		...auction,
		ownerCollateral: [0n, 0n, 0n],
		ownerAccount: [{ freeAttoRep: 0n, feesAttoEth: 3n, feesAttoRep: 4n, targetHealthFactorBps: 0n, positionId: 0n }],
	})
	expect(earlier).toMatchObject({ positionId: '0', unclaimedFeesAttoEth: '8', unclaimedFeesAttoRep: '12' })

	// A bidder with its own position: `ownerCollateral` covers only that position, and the unclaimed lots add to it once.
	const merged = await sample(auction)
	expect(merged).toMatchObject({ positionId: '7', principalAttoRep: '1020', commitmentAttoEth: '20', pledgedAttoRep: '1000', withdrawableAttoRep: '30', unclaimedFeesAttoEth: '10', unclaimedFeesAttoRep: '16', repairAuctionPendingBidIds: ['2'] })
	// The position's own take-over condition is unchanged by lots that still sit in the cohort.
	expect(merged).toMatchObject({ belowLiquidationPrice: true, takeoverPreconditionsMet: true })

	// Only the losing bid is unclaimed: it still blocks the fork choice but carries no lots.
	const losing = await sample({
		...auction,
		unclaimedRepairAuctionBids: [1n],
		repairAuctionPositions: (args: readonly unknown[]) => [Array.isArray(args[0]) ? args[0].map(bidId => ({ ...lots(bidId), ...(bidId === 2n ? { claimed: true, materialized: true, positionId: 7n, earnedAttoEth: 0n, earnedAttoRep: 0n } : {}) })) : []],
	})
	expect(losing).toMatchObject({ positionId: '7', principalAttoRep: '520', pledgedAttoRep: '500', unclaimedFeesAttoEth: '5', repairAuctionUnclaimedBids: '1' })
	expect(losing?.['repairAuctionPendingBidIds']).toBeUndefined()

	// An auction that installed no cohort awarded no lots, so only the unclaimed count is reported.
	calls.length = 0
	const noCohort = await sample({ ...auction, repairAuctionCohort: [zeroAddress, 0n, 0n, 0n, 0n] })
	expect(noCohort).toMatchObject({ principalAttoRep: '520', repairAuctionUnclaimedBids: '2' })
	expect(calls.filter(call => call.startsWith('securityPoolRepairAuction.') || call.endsWith('.repairAuctionPositions'))).toEqual([])

	// Once every bid is claimed, the bidder's bids are not read.
	calls.length = 0
	const settled = await sample({ ...auction, unclaimedRepairAuctionBids: [0n] })
	expect(settled).toMatchObject({ positionId: '7', principalAttoRep: '520', pledgedAttoRep: '500', unclaimedFeesAttoEth: '5', unclaimedFeesAttoRep: '8' })
	expect(settled?.['repairAuctionUnclaimedBids']).toBeUndefined()
	expect(settled?.['repairAuctionPendingBidIds']).toBeUndefined()
	expect(calls.filter(call => call.startsWith('securityPoolRepairAuction.'))).toEqual([])
})

test('an owner without a position or a price has principal but no health factor', async () => {
	const calls: string[] = []
	const idle = reader({ ownerAccount: [{ freeAttoRep: 70n, feesAttoEth: 0n, feesAttoRep: 0n, targetHealthFactorBps: 0n, positionId: 0n }], ownerCollateral: [70n, 0n, 70n] }, calls)
	const snapshot = await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, idle)
	// A stored zero target is the ledger's default 100% target, not 0%.
	expect(snapshot.readResult).toMatchObject({ positionId: '0', principalAttoRep: '70', commitmentAttoEth: '0', pledgedAttoRep: '0', targetHealthFactorBps: '10000' })
	expect(snapshot.readResult?.['healthFactorBps']).toBeUndefined()
	expect(snapshot.readResult?.['maxHealthyPrice']).toBeUndefined()
	// Neither the index position nor the pure requirement formula is read for an idle owner.
	expect(calls.filter(call => call.startsWith('securityPoolCommitmentIndex.'))).toEqual([])

	// The requirement formula rejects a zero price, so a ledger that never accepted one is not asked.
	const unpriced: string[] = []
	const beforePrice = await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, reader({ liquidationPrice: [0n], isPriceValid: [false] }, unpriced))
	expect(beforePrice.readResult).toMatchObject({ commitmentAttoEth: '10', belowLiquidationPrice: false, takeoverPreconditionsMet: false })
	expect(beforePrice.readResult?.['healthFactorBps']).toBeUndefined()
	expect(unpriced).not.toContain('securityPoolCommitmentIndex.requiredRep')
})

test('a failed capital read is recorded as failed and an owner target requires its owner', async () => {
	const failing: StateRead = async () => {
		throw new Error('execution reverted')
	}
	expect(await sampleEntityStateWithRead({ entityType: 'capital-ledger', entityIdentity: ledger.toLowerCase(), address: ledger }, failing)).toMatchObject({ readStatus: 'failed', readFailureReason: 'execution reverted' })
	expect(await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger }, reader())).toMatchObject({ readStatus: 'failed', readFailureReason: 'Capital owner snapshot is missing its owner' })
})

test('capital snapshot targets carry the owner or the position id', () => {
	expect(normalizeSnapshotTarget({ entity_type: 'capital-owner', entity_identity: `${ledger}:${owner}`, address: ledger, owner_address: owner.toLowerCase() })).toEqual({ entityType: 'capital-owner', entityIdentity: `${ledger}:${owner}`, address: ledger, ownerAddress: owner })
	expect(normalizeSnapshotTarget({ entity_type: 'capital-position', entity_identity: `${ledger}:11`, address: ledger, position_id: '11' })).toEqual({ entityType: 'capital-position', entityIdentity: `${ledger}:11`, address: ledger, positionId: 11n })
	expect(() => normalizeSnapshotTarget({ entity_type: 'capital-position', entity_identity: ledger, address: ledger, position_id: 'x' })).toThrow('position id is invalid')
})

test('the health factor rounds down pledged REP over the requirement', async () => {
	const sample = async (required: bigint) => (await sampleEntityStateWithRead({ entityType: 'capital-owner', entityIdentity: 'position', address: ledger, ownerAddress: owner }, reader({ requiredRep: [required] }))).readResult?.['healthFactorBps']
	expect(await sample(400n)).toBe('12500')
	expect(await sample(501n)).toBe('9980')
	// A zero requirement cannot be divided by; the position then has no health factor.
	expect(await sample(0n)).toBeUndefined()
})

test('capital risk follows the ledger facts and adds only the scanner warning band', () => {
	const base = { commitmentAttoEth: '10', priceValid: true, frozen: false, importing: false, belowLiquidationPrice: false, takeoverPreconditionsMet: false, healthFactorBps: '15000' }
	expect(capitalPositionRisk(base)).toMatchObject({ protocolState: 'healthy', scannerSeverity: 'healthy' })
	expect(capitalPositionRisk({ ...base, healthFactorBps: '11999' })).toMatchObject({ protocolState: 'healthy', scannerSeverity: 'warning' })
	expect(capitalPositionRisk({ ...base, healthFactorBps: '12000' })).toMatchObject({ scannerSeverity: 'healthy' })
	expect(capitalPositionRisk({ ...base, healthFactorBps: '9000', belowLiquidationPrice: true })).toMatchObject({ protocolState: 'under-collateralized', scannerSeverity: 'critical' })
	expect(capitalPositionRisk({ ...base, healthFactorBps: '9000', belowLiquidationPrice: true, takeoverPreconditionsMet: true })).toMatchObject({ protocolState: 'takeover-preconditions-met', scannerSeverity: 'critical' })
	expect(capitalPositionRisk({ ...base, commitmentAttoEth: '0', healthFactorBps: undefined })).toMatchObject({ protocolState: 'uncommitted', scannerSeverity: 'healthy' })
	expect(capitalPositionRisk({ ...base, frozen: true, belowLiquidationPrice: true })).toMatchObject({ protocolState: 'frozen', scannerSeverity: 'unavailable' })
	expect(capitalPositionRisk({ ...base, importing: true })).toMatchObject({ protocolState: 'frozen', scannerSeverity: 'unavailable' })
	expect(capitalPositionRisk({ ...base, universeForked: true, belowLiquidationPrice: true, takeoverPreconditionsMet: false })).toMatchObject({ protocolState: 'frozen', scannerSeverity: 'unavailable' })
	// An owner whose winning auction lots have not joined its account has no index position, so only its health factor shows it is under the requirement.
	expect(capitalPositionRisk({ commitmentAttoEth: '10', priceValid: true, healthFactorBps: '9000' })).toMatchObject({ protocolState: 'under-collateralized', scannerSeverity: 'critical' })
	expect(capitalPositionRisk({ commitmentAttoEth: '10', priceValid: true, healthFactorBps: '10000' })).toMatchObject({ protocolState: 'healthy', scannerSeverity: 'warning' })
	expect(capitalPositionRisk({ ...base, healthFactorBps: undefined })).toMatchObject({ protocolState: 'unavailable', scannerSeverity: 'unavailable' })
	expect(capitalPositionRisk({})).toMatchObject({ protocolState: 'unavailable', scannerSeverity: 'unavailable' })
	expect(capitalPositionRisk({ ...base, priceValid: false }).scannerReason).toContain('accepted price has expired')
})
