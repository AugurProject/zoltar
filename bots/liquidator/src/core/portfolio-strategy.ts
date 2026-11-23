import type { OperatorSettings } from '#config/settings'
import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { portfolioTakeoverFill, portfolioTakeoverTransfer } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { portfolioCureOutcome } from './portfolio-cure-state.ts'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { DEFAULT_TRANSACTION_VALIDITY_BLOCKS } from '@zoltar/bot-shared/execution/transaction-submission'

const UNIT = 10n ** 18n
const BPS = 10_000n
/** @internal Post-merge Ethereum slot length; converts the signed transaction's block validity into seconds. */
export const SIGNED_TRANSACTION_SLOT_SECONDS = 12n
export type PortfolioTakeover = {
	positionId: bigint
	commitment: bigint
	minimumAward: bigint
	ownFunding: bigint
	approvalRep: bigint
	maximumOwnRep: bigint
	maximumOwnerPrincipal: bigint
	maximumOwnerCommitment: bigint
	expectedTotalCommitment: bigint
	expectedDemand: bigint
	expectedSourceBatch: bigint
	netRewardAttoEth: bigint
	/** The ledger's preliminary cure alone restores the target: the call pays no award and must ask for none. */
	unpaidCure: boolean
}

/**
 * A cure that heals its target consumes shared spare and pays nothing. It is worth its gas only when
 * another position, itself curable until then, is left without spare and becomes a profitable takeover.
 */
function unlockingCurePlan(observation: PortfolioObservation, position: PortfolioPosition, removed: bigint, settings: OperatorSettings, totalPrincipal: bigint, marketAllowed: boolean): { reason: string; plan?: PortfolioTakeover } {
	const { snapshot } = observation
	const curedSnapshot = { ...snapshot, totalCommitmentAttoEth: snapshot.totalCommitmentAttoEth - removed }
	const cured = { ...observation, snapshot: curedSnapshot, positions: observation.positions.filter(candidate => candidate !== position) }
	const cureGas = settings.strategy.maximumGasCostAttoEth
	for (const candidate of cured.positions) {
		if (candidate.commitment === 0n || candidate.liquidationStarted === 0n || candidate.maxHealthyPrice >= snapshot.liquidationPrice || !portfolioCureOutcome(observation, candidate).healthy) continue
		const unlocked = paidTakeoverPlan(cured, candidate, settings, totalPrincipal, marketAllowed).plan
		if (unlocked === undefined || unlocked.netRewardAttoEth - cureGas < settings.portfolioPolicy.minimumNetRewardAttoEth) continue
		if (observation.walletAttoEth < settings.strategy.maximumGasCostAttoEth * 4n + settings.portfolioPolicy.walletReserveAttoEth) continue
		return {
			reason: settings.portfolioPolicy.allowFundedTakeovers ? 'Unpaid cure ready; it opens another position to takeover' : 'Unpaid cure ready; automation is disabled',
			plan: {
				positionId: position.id,
				// The ledger ignores every bound below when the cure heals. If it does not, zero consent makes the call revert.
				commitment: position.commitment,
				minimumAward: 0n,
				ownFunding: 0n,
				approvalRep: 0n,
				maximumOwnRep: 0n,
				maximumOwnerPrincipal: 0n,
				maximumOwnerCommitment: 0n,
				expectedSourceBatch: 0n,
				expectedTotalCommitment: snapshot.totalCommitmentAttoEth,
				expectedDemand: snapshot.demandAttoEth,
				netRewardAttoEth: unlocked.netRewardAttoEth - cureGas,
				unpaidCure: true,
			},
		}
	}
	return { reason: 'Cure restores target health without a takeover' }
}

/** Quote the complete residual after the transaction’s deterministic preliminary cure, or the unpaid cure when it alone heals the target. */
export function portfolioTakeoverPlan(observation: PortfolioObservation, position: PortfolioPosition, settings: OperatorSettings, totalPrincipal: bigint, marketAllowed: boolean, requestedCommitment?: bigint): { reason: string; plan?: PortfolioTakeover } {
	const result = paidTakeoverPlan(observation, position, settings, totalPrincipal, marketAllowed, requestedCommitment)
	if (result.healingCure === undefined) return result
	return unlockingCurePlan(observation, position, result.healingCure, settings, totalPrincipal, marketAllowed)
}

/** A takeover that asks for an award. A target its own model predicts the cure will heal never gets one. */
function paidTakeoverPlan(observation: PortfolioObservation, position: PortfolioPosition, settings: OperatorSettings, totalPrincipal: bigint, marketAllowed: boolean, requestedCommitment?: bigint): { reason: string; plan?: PortfolioTakeover; healingCure?: bigint } {
	const { snapshot } = observation
	const policy = settings.portfolioPolicy
	const reject = (reason: string) => ({ reason })
	if (!observation.selected || !observation.approvedUniverse) return reject('Portfolio and universe must both be selected')
	if (!marketAllowed) return reject('Independent REP price evidence is unavailable or disagrees')
	if (!snapshot.priceValid || snapshot.timestamp >= snapshot.priceValidUntil || snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return reject('Portfolio capital is inactive or its price has expired')
	// The signed transaction may land up to its validity horizon later; the ledger reverts once the price is stale.
	if (snapshot.timestamp + DEFAULT_TRANSACTION_VALIDITY_BLOCKS * SIGNED_TRANSACTION_SLOT_SECONDS >= snapshot.priceValidUntil) return reject('Accepted price expires before the signed transaction validity window ends')
	if (position.owner === snapshot.owner || position.controllingOwner === snapshot.owner || position.commitment === 0n || position.maxHealthyPrice >= snapshot.liquidationPrice || position.liquidationStarted === 0n) return reject('Position is not an external takeover target')
	if (snapshot.ownerAccount.targetHealthFactorBps !== policy.targetHealthFactorBps) return reject('Receiver health target does not match the configured target')
	const receiver = snapshot.positions.find(position => position.commitment > 0n)
	const source = portfolioCureOutcome(observation, position)
	if (source.healthy) return source.removed === 0n ? reject('Cure restores target health without a takeover') : { reason: 'Cure restores target health without a takeover', healingCure: source.removed }
	if (receiver !== undefined && receiver.batch !== 0n && receiver.batch !== source.batch) return reject('Receiver and target retirement cohorts differ')
	const requiredFor = (commitment: bigint) => ceilDiv(ceilDiv(ceilDiv((snapshot.ownerCommitmentAttoEth + commitment) * snapshot.ownerConservativePrice, UNIT) * snapshot.securityMultiplierBps, BPS) * policy.targetHealthFactorBps, BPS)
	const quote = (commitment: bigint) => {
		const allowed = portfolioTakeoverTransfer(source, commitment)
		return portfolioTakeoverFill(source, allowed ?? source.maximumPartialCommitment, snapshot.economics.minimumCommitmentAttoEth)
	}
	let fill = quote(requestedCommitment ?? source.maximumTakeoverCommitment)
	// After funding, accept the part this capital supports instead of chasing
	// an ever-growing full-repair quote through repeated approval/deposit cycles.
	if (requestedCommitment === undefined && snapshot.ownerPrincipalAttoRep > 0n && snapshot.ownerPrincipalAttoRep + fill.award < requiredFor(fill.commitment)) {
		let low = 0n
		let high = fill.commitment
		while (low < high) {
			const middle = (low + high + 1n) / 2n
			const candidate = quote(middle)
			if (snapshot.ownerPrincipalAttoRep + candidate.award >= requiredFor(candidate.commitment)) low = middle
			else high = middle - 1n
		}
		const funded = quote(low)
		if (funded.commitment > 0n && snapshot.ownerCommitmentAttoEth + funded.commitment >= snapshot.economics.minimumCommitmentAttoEth) fill = funded
	}
	const { commitment, award } = fill
	if (commitment === 0n) return reject('Minimum position needs additional backing or healthy capacity')
	if (snapshot.ownerCommitmentAttoEth + commitment < snapshot.economics.minimumCommitmentAttoEth) return reject('Receiver commitment would be below the economic minimum')
	const maximumOwnerCommitment = policy.maximumCommitmentAttoEth - (observation.managedCommitmentAttoEth ?? snapshot.ownerCommitmentAttoEth) + snapshot.ownerCommitmentAttoEth
	if (snapshot.ownerCommitmentAttoEth + commitment > maximumOwnerCommitment) return reject('Owner commitment limit would be exceeded')
	if (policy.takeoverIncomeHorizonSeconds === 0 && award === 0n) return reject('Repair earns future income; configure an income horizon before automation')
	const required = requiredFor(commitment)
	const ownFunding = required > snapshot.ownerPrincipalAttoRep + award ? required - snapshot.ownerPrincipalAttoRep - award : 0n
	if (ownFunding > 0n && receiver !== undefined && receiver.maxHealthyPrice < snapshot.liquidationPrice) return reject('Receiver position is liquidating; principal top-ups are unavailable')
	const maximumOwnerPrincipal = policy.maximumPrincipalAttoRep < policy.maximumTotalPrincipalAttoRep - totalPrincipal + snapshot.ownerPrincipalAttoRep ? policy.maximumPrincipalAttoRep : policy.maximumTotalPrincipalAttoRep - totalPrincipal + snapshot.ownerPrincipalAttoRep
	// Both receiver-funded principal and the pledged award count toward exposure limits.
	if (maximumOwnerPrincipal < snapshot.ownerPrincipalAttoRep + ownFunding + award) return reject('Managed principal exposure limit would be exceeded')
	if (ownFunding > policy.maximumOwnFundingAttoRep) return reject('Own REP funding limit would be exceeded')
	if (observation.walletRep < ownFunding + settings.strategy.walletAttoRepReserve) return reject('Wallet REP reserve would be consumed')
	const possibleCommitment = source.commitment < maximumOwnerCommitment - snapshot.ownerCommitmentAttoEth ? source.commitment : maximumOwnerCommitment - snapshot.ownerCommitmentAttoEth
	const fullFunding = requiredFor(possibleCommitment) > snapshot.ownerPrincipalAttoRep ? requiredFor(possibleCommitment) - snapshot.ownerPrincipalAttoRep : 0n
	const approvalRep = [fullFunding, policy.maximumOwnFundingAttoRep, maximumOwnerPrincipal - snapshot.ownerPrincipalAttoRep, observation.walletRep - settings.strategy.walletAttoRepReserve].reduce((a, b) => (a < b ? a : b))
	// Repair income arrives in the future. Budget approval, deposit and repair
	// from the wallet without treating that income as spendable gas funding.
	const gasBudget = settings.strategy.maximumGasCostAttoEth * 3n
	if (observation.walletAttoEth < gasBudget + policy.walletReserveAttoEth) return reject('Wallet ETH gas reserve would be consumed')
	// This is a projection at the current fee rate and demand, not guaranteed income.
	// Receiver-funded principal is an investment, not an execution expense or reward.
	const annualFees = (snapshot.demandAttoEth * snapshot.economics.annualFeeBps) / BPS
	const projectedIncome = (annualFees * commitment * BigInt(policy.takeoverIncomeHorizonSeconds)) / (snapshot.totalCommitmentAttoEth - source.removed) / 31_536_000n
	const awardValue = (award * UNIT) / snapshot.ownerConservativePrice
	const netRewardAttoEth = awardValue + projectedIncome - gasBudget
	if (netRewardAttoEth < policy.minimumNetRewardAttoEth) return reject('Projected future income is below the profitability floor')
	return {
		reason: policy.allowFundedTakeovers ? 'Funded takeover ready' : 'Funded takeover ready; automation is disabled',
		plan: {
			positionId: position.id,
			commitment,
			minimumAward: award,
			ownFunding,
			approvalRep,
			maximumOwnRep: snapshot.ownerAccount.freeAttoRep + ownFunding + (receiver === undefined ? snapshot.positions.reduce((sum, position) => sum + position.releasedRep, 0n) : 0n),
			maximumOwnerPrincipal,
			maximumOwnerCommitment,
			expectedSourceBatch: source.batch,
			expectedTotalCommitment: snapshot.totalCommitmentAttoEth,
			expectedDemand: snapshot.demandAttoEth,
			netRewardAttoEth,
			unpaidCure: false,
		},
	}
}
