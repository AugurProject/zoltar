import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { abiForKind } from './abi-catalog.ts'
import { readCollateralMetadata } from './collateral-metadata.ts'
import { type AbiValue, type Address, getAddress, zeroAddress } from './ethereum.ts'
import type { StateRead } from './snapshots.ts'
import type { SystemContractKind } from './system-interfaces.ts'

const BPS = 10_000n

// viem returns a uint48 as a number and wider integers as bigint.
const quantity = (value: unknown, name: string): bigint => {
	if (typeof value === 'bigint' && value >= 0n) return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	throw new Error(`${name} returned an invalid value`)
}
/** The health target the ledger enforces: a stored zero is the default 100% target (`_target` in SecurityPoolCapitalState). */
const effectiveTargetHealthFactorBps = (stored: bigint): bigint => (stored === 0n ? BPS : stored)
const flag = (value: unknown, name: string): boolean => {
	if (typeof value !== 'boolean') throw new Error(`${name} returned an invalid value`)
	return value
}
const address = (value: unknown, name: string): Address => {
	if (typeof value !== 'string') throw new Error(`${name} returned an invalid address`)
	return getAddress(value)
}
const tuple = (value: unknown, length: number, name: string): readonly unknown[] => {
	if (!Array.isArray(value) || value.length !== length) throw new Error(`${name} returned an invalid tuple`)
	return value
}
const struct = (value: unknown, name: string): Readonly<Record<string, unknown>> => {
	if (!isObjectRecord(value)) throw new Error(`${name} returned an invalid struct`)
	return value
}

const caller =
	(read: StateRead) =>
	(target: Address, kind: SystemContractKind, name: string, args: readonly AbiValue[] = []) => {
		const abi = abiForKind(kind)
		if (abi === undefined) throw new Error(`Missing capital snapshot ABI ${kind}`)
		return read(target, abi, name, args)
	}

// ERC20 metadata is optional. A failed read must not erase an otherwise valid capital snapshot.
const collateralOf = async (securityPool: Address, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	try {
		const token = address(await caller(read)(securityPool, 'securityPool', 'collateralToken'), 'collateralToken')
		return { collateral: await readCollateralMetadata(token, read) }
	} catch (error) {
		return { collateralMetadataError: errorMessage(error) }
	}
}

/**
 * How far a position's pledged REP is above the REP its commitment requires at the ledger's liquidation
 * price, in basis points. Below 10,000 the position is under the price at which a take-over is allowed.
 * A position without commitment, or a ledger that never accepted a price, has no health factor.
 */
const capitalHealthFactorBps = (pledgedAttoRep: bigint, requiredAttoRep: bigint | undefined): string | undefined => (requiredAttoRep === undefined || requiredAttoRep === 0n ? undefined : ((pledgedAttoRep * BPS) / requiredAttoRep).toString())

type LedgerState = {
	readonly securityPool: Address
	readonly universeId: bigint
	readonly index: Address
	readonly multiplier: bigint
	readonly acceptedPrice: bigint
	readonly conservativePrice: bigint
	readonly liquidationPrice: bigint
	readonly priceValidUntil: bigint
	readonly priceValid: boolean
	readonly frozen: boolean
	readonly importing: boolean
	// Zoltar forked the universe: the ledger rejects every owner operation even before its `freeze()` call.
	readonly universeForked: boolean
}

const ledgerState = async (ledger: Address, read: StateRead): Promise<LedgerState> => {
	const call = caller(read)
	const kind = 'securityPoolCapitalLedger'
	const values = await Promise.all([
		call(ledger, kind, 'securityPool'),
		call(ledger, kind, 'universeId'),
		call(ledger, kind, 'commitmentIndex'),
		call(ledger, kind, 'securityMultiplierBps'),
		call(ledger, kind, 'acceptedPrice'),
		call(ledger, kind, 'conservativePrice'),
		call(ledger, kind, 'liquidationPrice'),
		call(ledger, kind, 'priceValidUntil'),
		call(ledger, kind, 'isPriceValid'),
		call(ledger, kind, 'frozen'),
		call(ledger, kind, 'importing'),
		call(ledger, kind, 'zoltar'),
	])
	const index = address(values[2], 'commitmentIndex')
	if (index === zeroAddress) throw new Error('Capital ledger has no commitment index')
	const universeId = quantity(values[1], 'universeId')
	const forkTime = quantity(await call(address(values[11], 'zoltar'), 'zoltar', 'getForkTime', [universeId]), 'getForkTime')
	return {
		securityPool: address(values[0], 'securityPool'),
		universeId,
		index,
		multiplier: quantity(values[3], 'securityMultiplierBps'),
		acceptedPrice: quantity(values[4], 'acceptedPrice'),
		conservativePrice: quantity(values[5], 'conservativePrice'),
		liquidationPrice: quantity(values[6], 'liquidationPrice'),
		priceValidUntil: quantity(values[7], 'priceValidUntil'),
		priceValid: flag(values[8], 'isPriceValid'),
		frozen: flag(values[9], 'frozen'),
		importing: flag(values[10], 'importing'),
		universeForked: forkTime !== 0n,
	}
}

const ledgerFields = (state: LedgerState): Record<string, unknown> => ({
	securityPool: state.securityPool.toLowerCase(),
	universeId: state.universeId.toString(),
	securityMultiplierBps: state.multiplier.toString(),
	acceptedPrice: state.acceptedPrice.toString(),
	conservativePrice: state.conservativePrice.toString(),
	liquidationPrice: state.liquidationPrice.toString(),
	priceValidUntil: state.priceValidUntil.toString(),
	priceValid: state.priceValid,
	frozen: state.frozen,
	importing: state.importing,
	universeForked: state.universeForked,
})

/**
 * The fee state of one universe: the security pool's fee configuration, the ledger's vesting fee streams, and the
 * universe's book in the security pool settlement book. Fee reads are optional: a failure is recorded beside an
 * otherwise valid ledger snapshot instead of failing it.
 */
const universeFees = async (ledger: Address, state: LedgerState, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const call = caller(read)
	try {
		const [annualFeeBps, purchaseFeeBps, rawStreams, rawSettlement, rawServices] = await Promise.all([
			call(state.securityPool, 'securityPool', 'annualFeeBps'),
			call(state.securityPool, 'securityPool', 'purchaseFeeBps'),
			call(ledger, 'securityPoolCapitalLedger', 'feeStreams'),
			call(state.securityPool, 'securityPool', 'settlement'),
			call(state.securityPool, 'securityPool', 'services'),
		])
		const streams = address(rawStreams, 'feeStreams')
		const settlement = address(rawSettlement, 'settlement')
		const streamKind = 'securityPoolCapitalFeeStreams'
		const [outstandingEth, outstandingRep, deferredEth, deferredRep, releasedThrough, rewardDuration, rawBook, rawBookId] = await Promise.all([
			call(streams, streamKind, 'outstandingEth'),
			call(streams, streamKind, 'outstandingRep'),
			call(streams, streamKind, 'deferredEth'),
			call(streams, streamKind, 'deferredRep'),
			call(streams, streamKind, 'releasedThrough'),
			call(streams, streamKind, 'rewardDuration'),
			call(settlement, 'securityPoolSettlement', 'ledger'),
			call(settlement, 'securityPoolSettlement', 'bookIds', [state.universeId]),
		])
		const book = address(rawBook, 'settlement.ledger')
		const bookId = quantity(rawBookId, 'bookIds')
		// A universe without a registered book has id 0, which the book contract rejects.
		const bookState = bookId === 0n ? undefined : tuple(await call(book, 'securityPoolSettlementBook', 'books', [bookId]), 16, 'books')
		return {
			fees: {
				annualFeeBps: quantity(annualFeeBps, 'annualFeeBps').toString(),
				purchaseFeeBps: quantity(purchaseFeeBps, 'purchaseFeeBps').toString(),
				feeStreams: streams.toLowerCase(),
				services: address(rawServices, 'services').toLowerCase(),
				// Funded fees awaiting release at a checkpoint and deferred stale income awaiting burn.
				vestingOutstandingAttoEth: quantity(outstandingEth, 'outstandingEth').toString(),
				vestingOutstandingAttoRep: quantity(outstandingRep, 'outstandingRep').toString(),
				deferredAttoEth: quantity(deferredEth, 'deferredEth').toString(),
				deferredAttoRep: quantity(deferredRep, 'deferredRep').toString(),
				vestingReleasedThrough: quantity(releasedThrough, 'releasedThrough').toString(),
				vestingDurationSeconds: quantity(rewardDuration, 'rewardDuration').toString(),
				settlementBook: book.toLowerCase(),
				bookId: bookId.toString(),
				...(bookState === undefined
					? {}
					: {
							bookCashAttoEth: quantity(bookState[0], 'books.cashAttoEth').toString(),
							bookFeeCashAttoEth: quantity(bookState[2], 'books.feeCashAttoEth').toString(),
							bookFeesEnabled: flag(bookState[11], 'books.feesEnabled'),
						}),
			},
		}
	} catch (error) {
		return { feeReadError: errorMessage(error) }
	}
}

/** One universe's capital ledger: the price it accepted, its aggregate principal and commitment, and the last position id it issued. */
export const capitalLedgerSnapshot = async (ledger: Address, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const call = caller(read)
	const state = await ledgerState(ledger, read)
	const kind = 'securityPoolCapitalLedger'
	const [rawTotals, demand, free, retirement, frozenBacking, frozenCommitment, lastPositionId, feed] = await Promise.all([
		call(ledger, kind, 'totals'),
		call(ledger, kind, 'demandAttoEth'),
		call(ledger, kind, 'totalFreeAttoRep'),
		call(ledger, kind, 'retirementCashAttoRep'),
		call(ledger, kind, 'frozenBackingAttoRep'),
		call(ledger, kind, 'frozenCommitmentAttoEth'),
		call(state.index, 'securityPoolCommitmentIndex', 'lastPositionId'),
		call(state.securityPool, 'securityPool', 'priceFeed', [state.universeId]),
	])
	const totals = tuple(rawTotals, 3, 'totals')
	return {
		...ledgerFields(state),
		commitmentIndex: state.index.toLowerCase(),
		priceFeed: address(feed, 'priceFeed').toLowerCase(),
		pledgedAttoRep: quantity(totals[0], 'totals.rep').toString(),
		commitmentAttoEth: quantity(totals[1], 'totals.commitment').toString(),
		healthyCommitmentAttoEth: quantity(totals[2], 'totals.healthy').toString(),
		demandAttoEth: quantity(demand, 'demandAttoEth').toString(),
		// Commitment above demand. While it covers a position's deficit, the ledger cures that position instead of allowing a take-over.
		spareCommitmentAttoEth: (quantity(totals[1], 'totals.commitment') > quantity(demand, 'demandAttoEth') ? quantity(totals[1], 'totals.commitment') - quantity(demand, 'demandAttoEth') : 0n).toString(),
		totalFreeAttoRep: quantity(free, 'totalFreeAttoRep').toString(),
		retirementCashAttoRep: quantity(retirement, 'retirementCashAttoRep').toString(),
		frozenBackingAttoRep: quantity(frozenBacking, 'frozenBackingAttoRep').toString(),
		frozenCommitmentAttoEth: quantity(frozenCommitment, 'frozenCommitmentAttoEth').toString(),
		lastPositionId: quantity(lastPositionId, 'lastPositionId').toString(),
		...(await universeFees(ledger, state, read)),
		...(await collateralOf(state.securityPool, read)),
	}
}

/**
 * The owner of one position id. The index never deletes a position, so its owner is a permanent fact: one
 * successful read identifies every event that names the id, including a position a fork imported silently.
 */
export const capitalPositionSnapshot = async (ledger: Address, positionId: bigint, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const call = caller(read)
	const index = address(await call(ledger, 'securityPoolCapitalLedger', 'commitmentIndex'), 'commitmentIndex')
	const owner = address(struct(await call(index, 'securityPoolCommitmentIndex', 'accountOf', [positionId]), 'accountOf')['owner'], 'accountOf.owner')
	if (owner === zeroAddress) throw new Error('Capital position does not exist')
	return { ledger: ledger.toLowerCase(), positionId: positionId.toString(), owner: owner.toLowerCase() }
}

type UnclaimedRepairAuctionLots = {
	readonly bidIds: readonly string[]
	readonly principal: bigint
	readonly commitment: bigint
	readonly earnedAttoEth: bigint
	readonly earnedAttoRep: bigint
	readonly liquidationStarted: bigint
}

/**
 * The owner's winning repair-auction lots that no claim has moved into its account yet, or undefined when there are none.
 * Lots exist only once the auction installed its cohort, so the bidder's bids are listed through the bidding engine of
 * the cohort's auction and read in one batched `repairAuctionPositions` call. Claimed bids and bids that won nothing
 * carry no lots.
 */
const unclaimedRepairAuctionLots = async (ledger: Address, adapter: Address, owner: Address, read: StateRead): Promise<UnclaimedRepairAuctionLots | undefined> => {
	const call = caller(read)
	const engine = address(await call(adapter, 'securityPoolRepairAuction', 'engine'), 'engine')
	const count = quantity(await call(engine, 'securityPoolUniformPriceRepairAuction', 'bidderBidCount', [owner]), 'bidderBidCount')
	if (count === 0n) return undefined
	const indexes = Array.from({ length: Number(count) }, (_, index) => BigInt(index))
	const bidIds = await Promise.all(indexes.map(async index => quantity(await call(engine, 'securityPoolUniformPriceRepairAuction', 'bidderBidId', [owner, index]), 'bidderBidId')))
	const positions = await call(ledger, 'securityPoolCapitalLedger', 'repairAuctionPositions', [bidIds])
	if (!Array.isArray(positions) || positions.length !== bidIds.length) throw new Error('repairAuctionPositions returned an invalid list')
	let principal = 0n
	let commitment = 0n
	let earnedAttoEth = 0n
	let earnedAttoRep = 0n
	let liquidationStarted = 0n
	const unclaimedIds: string[] = []
	for (const [slot, bidId] of bidIds.entries()) {
		const bid = struct(positions[slot], 'repairAuctionPositions')
		if (address(bid['bidder'], 'repairAuctionPositions.bidder') !== owner) throw new Error('Auction bid bidder does not match capital owner')
		const lots = quantity(bid['principal'], 'repairAuctionPositions.principal')
		// A claimed bid's lots and earnings are already in the owner's account; a bid that won nothing has none.
		if (flag(bid['claimed'], 'repairAuctionPositions.claimed') || lots === 0n) continue
		unclaimedIds.push(bidId.toString())
		principal += lots
		commitment += quantity(bid['commitment'], 'repairAuctionPositions.commitment')
		earnedAttoEth += quantity(bid['earnedAttoEth'], 'repairAuctionPositions.earnedAttoEth')
		earnedAttoRep += quantity(bid['earnedAttoRep'], 'repairAuctionPositions.earnedAttoRep')
		// Every unclaimed lot sits in the one cohort position, so the bids share its liquidation start.
		const started = quantity(bid['liquidationStarted'], 'repairAuctionPositions.liquidationStarted')
		if (started !== 0n && (liquidationStarted === 0n || started < liquidationStarted)) liquidationStarted = started
	}
	if (unclaimedIds.length === 0) return undefined
	return { bidIds: unclaimedIds, principal, commitment, earnedAttoEth, earnedAttoRep, liquidationStarted }
}

/** One owner's capital in one universe's ledger: principal, commitment, health and unclaimed earnings. */
export const capitalOwnerSnapshot = async (ledger: Address, owner: Address, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const call = caller(read)
	const state = await ledgerState(ledger, read)
	const kind = 'securityPoolCapitalLedger'
	const [rawAccount, rawCollateral, ownerPrice, rawCohort] = await Promise.all([call(ledger, kind, 'ownerAccount', [owner]), call(ledger, kind, 'ownerCollateral', [owner]), call(ledger, kind, 'ownerConservativePrice', [owner]), call(ledger, kind, 'repairAuctionCohort')])
	const account = struct(rawAccount, 'ownerAccount')
	const collateral = tuple(rawCollateral, 3, 'ownerCollateral')
	const cohort = tuple(rawCohort, 5, 'repairAuctionCohort')
	// The auction adapter owns the cohort's aggregate position in the index, but the ledger keeps its id in
	// `repairAuctionCohort` and reports zero principal and commitment for the adapter itself.
	const adapter = address(cohort[0], 'repairAuctionCohort.adapter')
	const cohortId = adapter === owner ? quantity(cohort[1], 'repairAuctionCohort.positionId') : 0n
	const positionId = cohortId === 0n ? quantity(account['positionId'], 'ownerAccount.positionId') : cohortId
	const freeAttoRep = quantity(account['freeAttoRep'], 'ownerAccount.freeAttoRep')
	let principal = quantity(collateral[0], 'ownerCollateral.principal')
	let commitment = quantity(collateral[1], 'ownerCollateral.commitment')
	let pledged = principal - freeAttoRep
	let unclaimedEth = quantity(account['feesAttoEth'], 'ownerAccount.feesAttoEth')
	let unclaimedRep = quantity(account['feesAttoRep'], 'ownerAccount.feesAttoRep')
	let position: Record<string, unknown> = {}
	// A bidder's winning lots stay in the auction cohort until someone claims the bid. `ownerCollateral` covers only the
	// account's own position, so the unclaimed lots' REP, commitment and earnings are read per bid and added here once.
	const unclaimedBids = adapter === owner ? 0n : quantity(await call(ledger, kind, 'unclaimedRepairAuctionBids', [owner]), 'unclaimedRepairAuctionBids')
	const pending = unclaimedBids === 0n || adapter === zeroAddress ? undefined : await unclaimedRepairAuctionLots(ledger, adapter, owner, read)
	principal += pending?.principal ?? 0n
	commitment += pending?.commitment ?? 0n
	if (positionId !== 0n) {
		const [rawPosition, started] = await Promise.all([call(state.index, 'securityPoolCommitmentIndex', 'accountOf', [positionId]), call(ledger, kind, 'liquidationStarted', [positionId])])
		const indexed = struct(rawPosition, 'accountOf')
		const maxHealthyPrice = quantity(indexed['maxHealthyPrice'], 'accountOf.maxHealthyPrice')
		const liquidationStartedAt = quantity(started, 'liquidationStarted')
		pledged = quantity(indexed['rep'], 'accountOf.rep') + (pending?.principal ?? 0n)
		if (cohortId !== 0n) {
			// Unclaimed winning bids: the cohort's REP and commitment are not yet split among the winning bidders.
			principal = pledged
			commitment = quantity(indexed['commitment'], 'accountOf.commitment')
		}
		// The index holds earnings the ledger has not yet moved to the owner's account.
		unclaimedEth += quantity(indexed['ethFees'], 'accountOf.ethFees') + (pending?.earnedAttoEth ?? 0n)
		unclaimedRep += quantity(indexed['repFees'], 'accountOf.repFees') + (pending?.earnedAttoRep ?? 0n)
		// The take-over condition belongs to this index position alone, not to the bidder's unclaimed cohort lots.
		const belowLiquidationPrice = quantity(indexed['commitment'], 'accountOf.commitment') !== 0n && state.liquidationPrice !== 0n && maxHealthyPrice < state.liquidationPrice
		position = {
			maxHealthyPrice: maxHealthyPrice.toString(),
			releasedAttoRep: quantity(indexed['releasedRep'], 'accountOf.releasedRep').toString(),
			retirementBatch: quantity(indexed['batch'], 'accountOf.batch').toString(),
			remainingCommitmentAttoEth: quantity(indexed['remainingCommitment'], 'accountOf.remainingCommitment').toString(),
			liquidationStartedAt: liquidationStartedAt.toString(),
			belowLiquidationPrice,
			// What a take-over needs before the ledger cures: an open universe (`_requireOpen`) and an adverse observation.
			// The ledger first attempts an unpaid cure; if it restores health, the call succeeds with zero transfer.
			// Cure eligibility also uses the public minimum commitment. A cohort is taken over per bid, never as a whole.
			takeoverPreconditionsMet: cohortId === 0n && belowLiquidationPrice && liquidationStartedAt !== 0n && !state.frozen && !state.importing && !state.universeForked,
		}
	} else if (pending !== undefined) {
		// Before a claim the cohort holds the bids' commitment and shares out indexed fees per bid;
		// the bidder's own account may already hold fees from earlier positions.
		pledged += pending.principal
		unclaimedEth += pending.earnedAttoEth
		unclaimedRep += pending.earnedAttoRep
		position['liquidationStartedAt'] = pending.liquidationStarted.toString()
	}
	// Every unclaimed bid, including one that won nothing, blocks the owner's fork-choice export until it is claimed.
	if (unclaimedBids !== 0n) position['repairAuctionUnclaimedBids'] = unclaimedBids.toString()
	if (pending !== undefined)
		position = {
			...position,
			repairAuctionPendingBidIds: pending.bidIds,
			repairAuctionPendingPrincipalAttoRep: pending.principal.toString(),
			repairAuctionPendingCommitmentAttoEth: pending.commitment.toString(),
			repairAuctionPendingEarnedAttoEth: pending.earnedAttoEth.toString(),
			repairAuctionPendingEarnedAttoRep: pending.earnedAttoRep.toString(),
		}
	// The pure index formula at the protocol health floor; it rejects a zero price, so it is read only once a price exists.
	const required = commitment === 0n || state.liquidationPrice === 0n ? undefined : quantity(await call(state.index, 'securityPoolCommitmentIndex', 'requiredRep', [commitment, state.liquidationPrice, state.multiplier, BPS]), 'requiredRep')
	return {
		...ledgerFields(state),
		ledger: ledger.toLowerCase(),
		owner: owner.toLowerCase(),
		positionId: positionId.toString(),
		...(cohortId === 0n ? {} : { repairAuctionCohort: true, repairAuctionCohortRemainingLots: quantity(cohort[2], 'repairAuctionCohort.remainingLots').toString() }),
		principalAttoRep: principal.toString(),
		commitmentAttoEth: commitment.toString(),
		withdrawableAttoRep: quantity(collateral[2], 'ownerCollateral.withdrawable').toString(),
		freeAttoRep: freeAttoRep.toString(),
		pledgedAttoRep: pledged.toString(),
		targetHealthFactorBps: effectiveTargetHealthFactorBps(quantity(account['targetHealthFactorBps'], 'ownerAccount.targetHealthFactorBps')).toString(),
		unclaimedFeesAttoEth: unclaimedEth.toString(),
		unclaimedFeesAttoRep: unclaimedRep.toString(),
		ownerConservativePrice: quantity(ownerPrice, 'ownerConservativePrice').toString(),
		requiredAttoRep: required?.toString(),
		healthFactorBps: capitalHealthFactorBps(pledged, required),
		...position,
		...(await collateralOf(state.securityPool, read)),
	}
}
