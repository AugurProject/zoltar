import type { OperatorSettings } from '#config/settings'
import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { requiredPortfolioExecutionReserve } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'

const UNIT = 10n ** 18n
const BPS = 10_000n
export type PortfolioTakeover = {
	positionId: bigint
	commitment: bigint
	minimumAward: bigint
	ownFunding: bigint
	reserveFunding: bigint
	maximumOwnRep: bigint
	maximumOwnerPrincipal: bigint
	expectedSourceBatch: bigint
	netRewardAttoEth: bigint
}

/** Conservative full-position takeover. A shrinking source is rescreened after protocol cure, never guessed. */
export function portfolioTakeoverPlan(observation: PortfolioObservation, position: PortfolioPosition, settings: OperatorSettings, totalPrincipal: bigint, marketAllowed: boolean): { reason: string; plan?: PortfolioTakeover } {
	const { snapshot } = observation
	const policy = settings.portfolioPolicy
	const reject = (reason: string) => ({ reason })
	if (!observation.selected || !observation.approvedUniverse) return reject('Portfolio and universe must both be selected')
	if (!marketAllowed) return reject('Independent REP price evidence is unavailable or disagrees')
	if (!snapshot.priceValid || snapshot.timestamp >= snapshot.priceValidUntil || snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return reject('Portfolio capital is inactive or its price has expired')
	if (position.owner === snapshot.owner || position.commitment === 0n || position.maxHealthyPrice >= snapshot.liquidationPrice || position.liquidationStarted === 0n) return reject('Position is not a takeover target')
	if (snapshot.ownerAccount.targetHealthFactorBps !== policy.targetHealthFactorBps) return reject('Receiver health target does not match the configured target')
	const receiver = snapshot.positions.find(position => position.commitment > 0n)
	if (receiver !== undefined && receiver.batch !== position.batch) return reject('Receiver and target retirement cohorts differ')
	// takeOver first cures unused commitment. Let a later scan observe that change; simulation alone is not a quote.
	if (snapshot.totalCommitmentAttoEth > snapshot.demandAttoEth) return reject('Unused commitment must be cured before funded takeover')
	const commitment = position.commitment
	if (snapshot.ownerCommitmentAttoEth + commitment > policy.maximumCommitmentAttoEth) return reject('Owner commitment limit would be exceeded')
	const elapsed = snapshot.timestamp - position.liquidationStarted
	if (elapsed < 0n) return reject('Adverse observation is in the future')
	const award = (position.rep * (elapsed < 3600n ? elapsed : 3600n)) / 3600n
	const required = ceilDiv(ceilDiv(ceilDiv((snapshot.ownerCommitmentAttoEth + commitment) * snapshot.ownerConservativePrice, UNIT) * snapshot.securityMultiplierBps, BPS) * policy.targetHealthFactorBps, BPS)
	const ownFunding = required > snapshot.ownerPrincipalAttoRep + award ? required - snapshot.ownerPrincipalAttoRep - award : 0n
	const maximumOwnerPrincipal = policy.maximumPrincipalAttoRep < policy.maximumTotalPrincipalAttoRep - totalPrincipal + snapshot.ownerPrincipalAttoRep ? policy.maximumPrincipalAttoRep : policy.maximumTotalPrincipalAttoRep - totalPrincipal + snapshot.ownerPrincipalAttoRep
	// Full auction award can grow before inclusion; reserve its full REP amount in exposure limits.
	if (maximumOwnerPrincipal < snapshot.ownerPrincipalAttoRep + ownFunding + position.rep) return reject('Managed principal exposure limit would be exceeded')
	if (ownFunding > policy.maximumOwnFundingAttoRep) return reject('Own REP funding limit would be exceeded')
	if (observation.walletRep < ownFunding + settings.strategy.walletAttoRepReserve) return reject('Wallet REP reserve would be consumed')
	const requiredReserve = requiredPortfolioExecutionReserve({ commitment: snapshot.ownerCommitmentAttoEth + commitment, ...snapshot.economics })
	const availableReserve = snapshot.ownerAccount.executionReserveAttoEth + (receiver?.executionReserveAttoEth ?? 0n)
	const reserveFunding = requiredReserve > availableReserve ? requiredReserve - availableReserve : 0n
	if (reserveFunding > policy.maximumReserveFundingAttoEth) return reject('Execution reserve funding limit would be exceeded')
	// Account for approval, principal funding, reserve funding and takeover even when fewer calls are needed.
	const gasBudget = settings.strategy.maximumGasCostAttoEth * 4n
	if (observation.walletAttoEth < reserveFunding + gasBudget + policy.walletReserveAttoEth) return reject('Wallet ETH gas reserve would be consumed')
	const netRewardAttoEth = ((award - ownFunding) * UNIT) / snapshot.ownerConservativePrice - gasBudget - reserveFunding
	if (award === 0n || netRewardAttoEth < policy.minimumNetRewardAttoEth) return reject('Conservative net award is below the profitability floor')
	return {
		reason: policy.allowFundedTakeovers ? 'Funded takeover ready' : 'Funded takeover ready; automation is disabled',
		plan: {
			positionId: position.id,
			commitment,
			minimumAward: award,
			ownFunding,
			reserveFunding,
			maximumOwnRep: snapshot.ownerAccount.freeAttoRep + ownFunding + (receiver === undefined ? snapshot.positions.reduce((sum, position) => sum + position.releasedRep, 0n) : 0n),
			maximumOwnerPrincipal,
			expectedSourceBatch: position.batch,
			netRewardAttoEth,
		},
	}
}
