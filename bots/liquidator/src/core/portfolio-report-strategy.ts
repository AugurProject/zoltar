import type { OperatorSettings } from '#config/settings'
import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { portfolioTarget, samePortfolioTarget, type PortfolioTarget } from '#monitoring/portfolio-auction'
import { portfolioTakeoverPlan, type PortfolioTakeover } from './portfolio-strategy.ts'
import { portfolioCureOutcome } from './portfolio-cure-state.ts'

export type PortfolioReportTakeover = { target: PortfolioTarget; plan: PortfolioTakeover }

/** Forecast ordered acquisitions and reserve cumulative funding/exposure. The gas
 * budget, rather than a fixed count, determines how many scanned targets fit. */
export function portfolioReportTakeoverPlan(observation: PortfolioObservation, position: PortfolioPosition, settings: OperatorSettings, totalPrincipal: bigint, marketAllowed: boolean): { reason: string; plan?: PortfolioTakeover; plans?: PortfolioReportTakeover[] } {
	if (settings.portfolioPolicy.maximumReportFundingAttoEth === 0n || observation.snapshot.acceptedPrice === 0n || observation.pendingOperationReport !== undefined) return { reason: 'Report sponsorship is disabled or already pending' }
	if (observation.snapshot.priceValid && observation.snapshot.timestamp < observation.snapshot.priceValidUntil) return { reason: 'Use the existing fresh price' }
	const projected = { ...observation, snapshot: { ...observation.snapshot, ownerAccount: { ...observation.snapshot.ownerAccount }, priceValid: true, priceValidUntil: observation.snapshot.timestamp + 1n } }
	const targets = [position, ...observation.positions.filter(candidate => !samePortfolioTarget(portfolioTarget(candidate), portfolioTarget(position)))]
	const plans: PortfolioReportTakeover[] = []
	let funding = 0n
	let gas = 0
	let profit = 0n
	let exposure = totalPrincipal
	let first: PortfolioTakeover | undefined
	for (const target of targets) {
		if (plans.some(item => samePortfolioTarget(item.target, portfolioTarget(target)))) continue
		if (gas + settings.portfolioPolicy.reportOperationGasLimit + 100_000 > settings.portfolioPolicy.reportOperationsGasLimit) break
		const result = portfolioTakeoverPlan(projected, target, settings, exposure, marketAllowed)
		if (result.plan === undefined) {
			if (plans.length === 0) return result
			continue
		}
		const plan = result.plan
		// Pending retirement cohorts can change through automatic servicing. Keep
		// them eligible alone; forecast multi-target batches only in active capital.
		if (plan.expectedSourceBatch !== 0n && plans.length !== 0) continue
		if (funding + plan.ownFunding > settings.portfolioPolicy.maximumOwnFundingAttoRep) continue
		const source = portfolioCureOutcome(projected, target)
		if ((projected.managedPrincipalAttoRep ?? projected.snapshot.ownerPrincipalAttoRep) + plan.ownFunding + source.rep > settings.portfolioPolicy.maximumPrincipalAttoRep) continue
		first ??= plan
		plans.push({ target: portfolioTarget(target), plan })
		funding += plan.ownFunding
		profit += plan.netRewardAttoEth
		gas += settings.portfolioPolicy.reportOperationGasLimit + 100_000
		const principal = projected.snapshot.ownerPrincipalAttoRep + plan.ownFunding + plan.minimumAward
		const commitment = projected.snapshot.ownerCommitmentAttoEth + plan.commitment
		exposure += plan.ownFunding + source.rep
		projected.managedPrincipalAttoRep = (projected.managedPrincipalAttoRep ?? projected.snapshot.ownerPrincipalAttoRep) + plan.ownFunding + source.rep
		projected.managedCommitmentAttoEth = (projected.managedCommitmentAttoEth ?? projected.snapshot.ownerCommitmentAttoEth) + plan.commitment
		projected.walletRep -= plan.ownFunding
		projected.snapshot.ownerPrincipalAttoRep = principal
		projected.snapshot.ownerCommitmentAttoEth = commitment
		projected.snapshot.ownerAccount.freeAttoRep = 0n
		projected.snapshot.totalCommitmentAttoEth -= source.removed
		projected.snapshot.positions = [{ id: 0n, owner: projected.snapshot.owner, batch: plan.expectedSourceBatch, rep: principal, commitment, maxHealthyPrice: 0n, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 0n, remainingCommitment: 0n, retirementPreview: undefined }]
		if (plan.expectedSourceBatch !== 0n) break
	}
	if (first === undefined) return { reason: 'No takeover fits the report gas and funding budgets' }
	const reportingCost = settings.portfolioPolicy.maximumReportFundingAttoEth + settings.strategy.maximumGasCostAttoEth * 5n
	if (profit - reportingCost < settings.portfolioPolicy.minimumNetRewardAttoEth) return { reason: 'Report funding risk and gas exceed the takeover profit' }
	const plan = { ...first, ownFunding: funding, minimumAward: plans.reduce((sum, item) => sum + item.plan.minimumAward, 0n), maximumOwnRep: first.maximumOwnRep - first.ownFunding + funding, netRewardAttoEth: profit - reportingCost }
	return { reason: 'Sponsor a gas-bounded takeover batch', plan, plans }
}
