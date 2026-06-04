import type { Address } from 'viem'
import type { ForkOutcomeKey, ListedSecurityPool, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { formatCurrencyBalance } from './formatters.js'
import { tryParseTruthAuctionAmountInput } from './marketForm.js'
import { getTimeRemaining as getSharedTimeRemaining } from './time.js'
import { getReportingOutcomeLabel } from './reporting.js'

const SECONDS_PER_WEEK = 7n * 24n * 60n * 60n

export const AUCTION_TIME_SECONDS = SECONDS_PER_WEEK
export const TRUTH_AUCTION_PRICE_PRECISION = 10n ** 18n
const TRUTH_AUCTION_TICK_PRICE_POWERS = [
	1000100000000000000n,
	1000200010000000000n,
	1000400060004000100n,
	1000800280056007000n,
	1001601200560182043n,
	1003204964963598014n,
	1006420201727613920n,
	1012881622445451097n,
	1025929181087729343n,
	1052530684607338948n,
	1107820842039993613n,
	1227267018058200482n,
	1506184333613467388n,
	2268591246822644826n,
	5146506245160322222n,
	26486526531474198664n,
	701536087702486644953n,
	492152882348911033633683n,
	242214459604341065650571799093n,
	58667844441422969901301586347865591163491n,
] as const

export type ForkAuctionStageView = 'initiate' | 'migration' | 'auction' | 'settlement'

const FORK_AUCTION_STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: 'Trigger',
	migration: 'Migration',
	auction: 'Truth Auction',
	settlement: 'Settlement',
}

const FORK_AUCTION_STAGE_ORDER: Record<ForkAuctionStageView, number> = {
	initiate: 0,
	migration: 1,
	auction: 2,
	settlement: 3,
}

type ForkAuctionStageSource = {
	claimingAvailable?: boolean
	forkOutcome: ForkOutcomeKey
	migratedRep: bigint
	systemState: SecurityPoolSystemState
	truthAuction?: Pick<TruthAuctionMetrics, 'finalized'> | undefined
	truthAuctionStartedAt: bigint
}

type ForkActivitySource = Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'>

export function getOutcomeActionLabel(outcome: ReportingOutcomeKey) {
	return getReportingOutcomeLabel(outcome)
}

export function getForkStageDescriptionForState(state: SecurityPoolSystemState) {
	switch (state) {
		case 'operational':
			return 'This pool is operational. If it is a child universe, the fork and auction path has completed.'
		case 'poolForked':
			return 'The parent pool has forked. Child universes can now be created and REP can migrate.'
		case 'forkMigration':
			return 'Migration is active. Vaults, escalation deposits, and REP can be moved into a child universe before the truth auction starts.'
		case 'forkTruthAuction':
			return 'Truth auction is active. Bidders compete to buy REP exposure for the unresolved collateral.'
		default:
			return assertNever(state)
	}
}

export function getForkAuctionStageLabel(stage: ForkAuctionStageView) {
	return FORK_AUCTION_STAGE_LABELS[stage]
}

export function getForkAuctionStageOrder(stage: ForkAuctionStageView) {
	return FORK_AUCTION_STAGE_ORDER[stage]
}

export function deriveHasForkActivity(source: ForkActivitySource) {
	return source.systemState !== 'operational' || source.truthAuctionStartedAt > 0n || source.migratedRep > 0n || source.forkOutcome !== 'none'
}

export function hasForkActivity(pool: ForkActivitySource) {
	return deriveHasForkActivity(pool)
}

export function getForkAuctionStageView(source: ForkAuctionStageSource): ForkAuctionStageView {
	if (source.truthAuction !== undefined) {
		if (!source.truthAuction.finalized) return 'auction'
		return 'settlement'
	}

	if (source.systemState === 'forkTruthAuction') return 'auction'
	if (source.claimingAvailable === true) return 'settlement'
	if (source.systemState === 'operational' && hasForkActivity(source)) return 'settlement'
	if (source.systemState === 'poolForked' || source.systemState === 'forkMigration' || source.migratedRep > 0n) return 'migration'
	return 'initiate'
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	return getSharedTimeRemaining(targetTime, currentTime)
}

export function estimateRepPurchased(ethAmount: bigint, price: bigint) {
	if (ethAmount <= 0n || price <= 0n) return 0n
	return (ethAmount * TRUTH_AUCTION_PRICE_PRECISION) / price
}

export function getTruthAuctionPriceAtTick(tick: bigint) {
	const absoluteTick = tick < 0n ? -tick : tick
	let price = TRUTH_AUCTION_PRICE_PRECISION
	for (let bitIndex = 0; bitIndex < TRUTH_AUCTION_TICK_PRICE_POWERS.length; bitIndex += 1) {
		const bitMask = 1n << BigInt(bitIndex)
		const pricePower = TRUTH_AUCTION_TICK_PRICE_POWERS[bitIndex]
		if (pricePower === undefined) throw new Error(`Missing truth auction tick price power for bit ${bitIndex}`)
		if ((absoluteTick & bitMask) !== 0n) price = (price * pricePower) / TRUTH_AUCTION_PRICE_PRECISION
	}
	return tick < 0n ? (TRUTH_AUCTION_PRICE_PRECISION * TRUTH_AUCTION_PRICE_PRECISION) / price : price
}

export function getTruthAuctionTickAtPrice(price: bigint): bigint | undefined {
	if (price <= 0n) return undefined
	if (price === TRUTH_AUCTION_PRICE_PRECISION) return 0n

	let lowerTick = 0n
	let upperTick = 1n
	let upperPrice = getTruthAuctionPriceAtTick(upperTick)

	if (price >= TRUTH_AUCTION_PRICE_PRECISION) {
		while (upperPrice <= price) {
			lowerTick = upperTick
			upperTick *= 2n
			upperPrice = getTruthAuctionPriceAtTick(upperTick)
		}
		while (upperTick - lowerTick > 1n) {
			const midTick = (lowerTick + upperTick) / 2n
			const midPrice = getTruthAuctionPriceAtTick(midTick)
			if (midPrice <= price) {
				lowerTick = midTick
				continue
			}
			upperTick = midTick
		}
		return lowerTick
	}

	lowerTick = -1n
	upperTick = 0n
	let lowerPrice = getTruthAuctionPriceAtTick(lowerTick)
	while (lowerPrice > price) {
		upperTick = lowerTick
		lowerTick *= 2n
		lowerPrice = getTruthAuctionPriceAtTick(lowerTick)
	}
	while (upperTick - lowerTick > 1n) {
		const midTick = (lowerTick + upperTick) / 2n
		const midPrice = getTruthAuctionPriceAtTick(midTick)
		if (midPrice <= price) {
			lowerTick = midTick
			continue
		}
		upperTick = midTick
	}
	return lowerTick
}

export function getTruthAuctionBidGuardMessage({
	accountAddress,
	currentTimestamp,
	isMainnet,
	submitBidAmountInput,
	truthAuction,
	walletEthBalance,
}: {
	accountAddress: Address | undefined
	currentTimestamp?: bigint | undefined
	isMainnet: boolean
	submitBidAmountInput: string
	truthAuction: TruthAuctionMetrics | undefined
	walletEthBalance: bigint | undefined
}) {
	if (accountAddress === undefined) return 'Connect a wallet before submitting a truth auction bid.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before submitting a truth auction bid.'
	if (truthAuction === undefined) return 'Load the truth auction before bidding.'
	if (truthAuction.finalized) return 'Truth auction is already finalized.'
	const auctionHasEndedByTimestamp = currentTimestamp !== undefined && truthAuction.auctionEndsAt !== undefined && currentTimestamp >= truthAuction.auctionEndsAt
	if (auctionHasEndedByTimestamp || truthAuction.timeRemaining === 0n) return 'Truth auction has ended.'

	const trimmedAmount = submitBidAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a bid amount greater than zero.'
	const bidAmount = tryParseTruthAuctionAmountInput(trimmedAmount)
	if (bidAmount === undefined) return 'Enter a valid bid amount.'

	if (bidAmount <= 0n) return 'Enter a bid amount greater than zero.'
	if (bidAmount < truthAuction.minBidSize) return `Bid must be at least ${formatCurrencyBalance(truthAuction.minBidSize)} ETH.`
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (bidAmount > walletEthBalance) return `Need ${formatCurrencyBalance(bidAmount - walletEthBalance)} more ETH in this wallet to bid the selected amount.`
	return undefined
}
