import { portfolioReportTakeoverPlan } from '#core/portfolio-report-strategy'
import { assertPortfolioReportFunding, assertPortfolioReportPlansStillAllowed, executePortfolioReportRequest } from './portfolio-report.ts'
import type { OperatorSettings } from '#config/settings'
import { portfolioTakeoverPlan, type PortfolioTakeover } from '#core/portfolio-strategy'
import type { PortfolioObservation, PortfolioScope } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { erc20Abi, securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { portfolioTarget, samePortfolioTarget, type PortfolioTarget } from '#monitoring/portfolio-auction'
import { encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { readPortfolioExecutionSnapshot } from './portfolio-execution-snapshot.ts'
import { buildPortfolioCapitalTakeOverWithBoundsRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { loadPortfolioPriceSnapshot, type PortfolioPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { buildPortfolioCapitalDepositRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { submitCall } from './submit-call.ts'

export class PortfolioOpportunityExpired extends Error {
	override name = 'PortfolioOpportunityExpired'
}

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Authenticate exposure and the exact target again at an agreed RPC height before execution. */
export async function refreshPortfolioExecution(
	wallet: Wallet,
	settings: OperatorSettings,
	scopes: readonly PortfolioScope[],
	pool: RpcPool,
	target: PortfolioObservation,
	positionId: PortfolioTarget | undefined,
	readers?: Parameters<typeof readPortfolioExecutionSnapshot>[6],
): Promise<{ observation: PortfolioObservation; totalPrincipal: bigint; allowance: bigint; price?: PortfolioPriceSnapshot | undefined; baseFeePerGas?: bigint | undefined }> {
	const targets =
		positionId === undefined ? [] : [positionId, ...(settings.portfolioPolicy.maximumReportFundingAttoEth > 0n && (!target.snapshot.priceValid || target.snapshot.timestamp >= target.snapshot.priceValidUntil) ? target.positions.map(portfolioTarget).filter(candidate => !samePortfolioTarget(candidate, positionId)) : [])]
	const result = await readPortfolioExecutionSnapshot(
		wallet,
		settings,
		pool,
		scopes.map(scope => ({ scope, targets: positionId !== undefined && scope.address === target.selection.address && scope.universeId === target.selection.universeId ? targets : [] })),
		target.selection,
		async ({ client, observation, blockNumber }) => ({
			baseFeePerGas: settings.portfolioPolicy.maximumReportFundingAttoEth > 0n ? (await client.getBlock({ blockNumber })).baseFeePerGas : undefined,
			allowance: await client.readContract({ address: observation.snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [wallet.account.address, observation.snapshot.capitalLedger], blockNumber }),
			price:
				settings.portfolioPolicy.maximumReportFundingAttoEth > 0n && (!observation.snapshot.priceValid || observation.snapshot.timestamp >= observation.snapshot.priceValidUntil)
					? await loadPortfolioPriceSnapshot({ client, portfolio: observation.selection.address, universeId: observation.selection.universeId, owner: wallet.account.address, blockNumber })
					: undefined,
		}),
		readers,
	)
	return { observation: result.observation, totalPrincipal: result.totalPrincipal, allowance: result.details.allowance, price: result.details.price, baseFeePerGas: result.details.baseFeePerGas }
}

/** One durable action per cycle. Each prerequisite settles before a fresh, independent cycle can take over. */
export async function executePortfolioTakeover(
	wallet: Wallet,
	settings: OperatorSettings,
	state: RuntimeState,
	pool: RpcPool,
	target: PortfolioObservation,
	positionId: PortfolioTarget,
	priceAllowed: (observation: PortfolioObservation) => Promise<boolean>,
	execution = { refresh: refreshPortfolioExecution, submit: submitCall },
) {
	if (state.sponsoredReports?.some(report => report.fundingKey === `${target.snapshot.capitalLedger.toLowerCase()}:${wallet.account.address.toLowerCase()}`)) throw new PortfolioOpportunityExpired('Sponsored report outcomes must be reconciled before new funding')
	if (!settings.portfolioPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Funded portfolio automation is disabled')
	if (state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery blocks portfolio exposure changes')
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, positionId)
		const position = current.observation.positions.find(position => samePortfolioTarget(portfolioTarget(position), positionId))
		if (position === undefined) throw new PortfolioOpportunityExpired('Portfolio target position is missing')
		const marketAllowed = await priceAllowed(current.observation)
		const direct = portfolioTakeoverPlan(current.observation, position, settings, current.totalPrincipal, marketAllowed)
		const report = direct.plan === undefined && current.price !== undefined ? portfolioReportTakeoverPlan(current.observation, position, settings, current.totalPrincipal, marketAllowed) : undefined
		const result = report ?? direct
		if (result.plan === undefined) throw new PortfolioOpportunityExpired(result.reason)
		return { ...current, plan: result.plan, reportPlans: report?.plans }
	}
	const current = await refresh()
	const { observation, plan } = current
	if (current.price !== undefined) assertPortfolioReportFunding(current, settings)
	if (current.price !== undefined && plan.ownFunding === 0n) {
		await executePortfolioReportRequest(wallet, settings, state, pool, current, refresh, execution.submit)
		return
	}
	const expectedAcceptedPriceEpoch = observation.acceptedPriceEpoch
	const base = { owner: wallet.account.address, capitalLedger: observation.snapshot.capitalLedger }
	const kind = plan.ownFunding > 0n ? 'deposit' : 'liquidation'
	let request: { to: typeof base.capitalLedger; data: `0x${string}`; value: bigint }
	let label: string
	let action: 'approval' | 'principal' | 'takeover'
	if (plan.ownFunding > 0n && current.allowance < plan.ownFunding) {
		action = 'approval'
		request = { to: observation.snapshot.repToken, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [base.capitalLedger, plan.ownFunding] }), value: 0n }
		label = 'Approve bounded portfolio REP funding'
	} else if (plan.ownFunding > 0n) {
		action = 'principal'
		request = buildPortfolioCapitalDepositRequest({ ...base, amountAttoRep: plan.ownFunding })
		label = 'Fund portfolio owner principal; rescreen next cycle'
	} else {
		action = 'takeover'
		const bounds = { maximumOwnerPrincipal: plan.maximumOwnerPrincipal, maximumOwnerCommitment: plan.maximumOwnerCommitment, expectedTargetHealthFactorBps: settings.portfolioPolicy.targetHealthFactorBps, expectedAcceptedPriceEpoch, expectedSourceBatch: plan.expectedSourceBatch }
		request =
			typeof positionId === 'bigint'
				? buildPortfolioCapitalTakeOverWithBoundsRequest({
						...base,
						positionId: plan.positionId,
						commitment: plan.commitment,
						minimumAward: plan.minimumAward,
						maximumOwnRep: plan.maximumOwnRep,
						bounds,
					})
				: { to: base.capitalLedger, value: 0n, data: encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: 'takeOverAuctionBid', args: [positionId.bidId, plan.commitment, plan.minimumAward, plan.maximumOwnRep, bounds] }) }
		label = typeof positionId === 'bigint' ? `Take over portfolio position ${positionId}` : `Take over auction bid ${positionId.bidId} vault ${positionId.vault}`
	}
	const preSubmit = async () => {
		const latest = await refresh()
		if (latest.price !== undefined) assertPortfolioReportFunding(latest, settings)
		assertPortfolioPlanStillAllowed(plan, latest.plan, action)
		if (current.reportPlans !== undefined) assertPortfolioReportPlansStillAllowed(current.reportPlans, latest.reportPlans, action)
		if (latest.observation.acceptedPriceEpoch !== expectedAcceptedPriceEpoch) throw new PortfolioOpportunityExpired('Portfolio accepted price epoch changed before signing')
	}
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			...request,
			portfolioFunding: action === 'approval' ? undefined : { key: `${base.capitalLedger.toLowerCase()}:${base.owner.toLowerCase()}`, operation: action === 'principal' ? 'fund' : 'consume', target: positionId, amount: action === 'principal' ? plan.ownFunding : 0n },
			gas: 'estimate',
			gasBudgetExceeded: () => {
				throw new PortfolioOpportunityExpired('Estimated portfolio gas exceeds strategy.maximumGasCostEth')
			},
			label,
			preSubmit,
			revalidateSimulationRevert: preSubmit,
		},
		kind,
	)
}

/** Revalidate funding, exposure and cohort consent after each prerequisite. */
export function assertPortfolioPlanStillAllowed(original: PortfolioTakeover, current: PortfolioTakeover, action: 'approval' | 'principal' | 'takeover') {
	if (original.expectedTotalCommitment !== current.expectedTotalCommitment || original.expectedDemand !== current.expectedDemand) throw new PortfolioOpportunityExpired('Portfolio cure capacity changed before submission')
	if (original.commitment !== current.commitment || original.expectedSourceBatch !== current.expectedSourceBatch || original.maximumOwnerPrincipal > current.maximumOwnerPrincipal || original.maximumOwnerCommitment > current.maximumOwnerCommitment)
		throw new PortfolioOpportunityExpired('Portfolio exposure or cohort changed before submission')
	if ((action === 'approval' || action === 'principal') && original.ownFunding !== current.ownFunding) throw new PortfolioOpportunityExpired('Portfolio funding requirement changed before submission')
	if (action === 'takeover' && (current.ownFunding !== 0n || current.minimumAward < original.minimumAward || current.maximumOwnRep > original.maximumOwnRep)) throw new PortfolioOpportunityExpired('Portfolio takeover terms changed before submission')
}
