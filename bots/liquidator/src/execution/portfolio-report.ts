import { maximumFeePerGas, paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import type { OperatorSettings } from '#config/settings'
import type { RuntimeState } from '#state/operator-state'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'
import { samePortfolioTarget } from '#monitoring/portfolio-auction'
import type { PortfolioReportTakeover } from '#core/portfolio-report-strategy'
import type { PortfolioTakeover } from '#core/portfolio-strategy'
import { sharedPoolPriceFeedAbi, openOracleAbi, securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { buildPortfolioPriceOperationsRequest, buildPortfolioPriceApprovalRequest, buildPortfolioPriceWrapRequest, quotePortfolioPriceFunding, type PortfolioPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { PortfolioOpportunityExpired, assertPortfolioPlanStillAllowed } from './portfolio-executor.ts'
import { readPortfolioExecutionSnapshot } from './portfolio-execution-snapshot.ts'
import { submitCall } from './submit-call.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>
type ReportContext = { observation: PortfolioObservation; totalPrincipal: bigint; plan: PortfolioTakeover; reportPlans?: PortfolioReportTakeover[] | undefined; price?: PortfolioPriceSnapshot | undefined; baseFeePerGas?: bigint | undefined }

export function assertPortfolioReportFunding(current: ReportContext, settings: OperatorSettings) {
	if (current.price === undefined || current.price.observation === undefined) throw new PortfolioOpportunityExpired('Missing report funding quote')
	const funding = quotePortfolioPriceFunding(current.price, current.observation.snapshot.acceptedPrice)
	const reportRisk = funding.weth + (funding.rep * 10n ** 18n + funding.price - 1n) / funding.price
	if (reportRisk > settings.portfolioPolicy.maximumReportFundingAttoEth) throw new PortfolioOpportunityExpired('Report funding exceeds configured loss budget')
	if (current.baseFeePerGas === undefined || current.reportPlans === undefined) throw new PortfolioOpportunityExpired('Missing report settlement gas quote')
	const callbackGas = 4_000_000n + BigInt(current.reportPlans.length * (settings.portfolioPolicy.reportOperationGasLimit + 100_000))
	const settlementGas = callbackGas + callbackGas / 63n + 350_000n
	if (maximumFeePerGas(current.baseFeePerGas) * paddedTransactionGas(settlementGas) > settings.strategy.maximumGasCostAttoEth) throw new PortfolioOpportunityExpired('Report settlement exceeds transaction gas budget')

	if (current.observation.walletRep < funding.rep + current.plan.ownFunding + settings.strategy.walletAttoRepReserve) throw new PortfolioOpportunityExpired('Report would consume wallet REP reserve')
	if (current.observation.walletAttoEth < funding.requiredEth + settings.strategy.maximumGasCostAttoEth * 5n + settings.portfolioPolicy.walletReserveAttoEth) throw new PortfolioOpportunityExpired('Report would consume wallet ETH reserve')
	const reservedRep = funding.rep + (funding.weth * funding.price + 10n ** 18n - 1n) / 10n ** 18n
	if ((current.observation.managedPrincipalAttoRep ?? current.observation.snapshot.ownerPrincipalAttoRep) + reservedRep + current.plan.ownFunding > settings.portfolioPolicy.maximumPrincipalAttoRep || current.totalPrincipal + reservedRep + current.plan.ownFunding > settings.portfolioPolicy.maximumTotalPrincipalAttoRep)
		throw new PortfolioOpportunityExpired('Report collateral exceeds managed principal limits')
	return funding
}

export function assertPortfolioReportPlansStillAllowed(original: PortfolioReportTakeover[] | undefined, current: PortfolioReportTakeover[] | undefined, action: 'approval' | 'principal' | 'takeover') {
	if (original === undefined || current === undefined || original.length !== current.length) throw new PortfolioOpportunityExpired('Report operations changed before signing')
	for (const [index, item] of original.entries()) {
		const latest = current[index]
		if (latest === undefined || !samePortfolioTarget(item.target, latest.target)) throw new PortfolioOpportunityExpired('Report targets changed before signing')
		assertPortfolioPlanStillAllowed(item.plan, latest.plan, action)
	}
}

/** Approval, wrap and report creation are separate durable transactions, each revalidated. */
export async function executePortfolioReportRequest(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, current: ReportContext, refresh: () => Promise<ReportContext>, submit = submitCall) {
	const funding = assertPortfolioReportFunding(current, settings)
	const price = current.price
	if (price?.observation === undefined) throw new PortfolioOpportunityExpired('Missing report state')
	const { plan, observation } = current
	let request
	let label
	let reportSponsorship
	if (price.observation.repAllowanceAttoRep < funding.rep) {
		request = buildPortfolioPriceApprovalRequest(price, 'rep', funding.rep)
		label = 'Approve bounded takeover report REP'
	} else if (price.observation.wethAllowanceAttoEth < funding.weth) {
		request = buildPortfolioPriceApprovalRequest(price, 'weth', funding.weth)
		label = 'Approve bounded takeover report WETH'
	} else if (funding.wrap > 0n) {
		request = buildPortfolioPriceWrapRequest(price, funding.wrap)
		label = 'Wrap bounded takeover report ETH'
	} else {
		const plans = current.reportPlans
		if (plans === undefined || plans.length === 0) throw new PortfolioOpportunityExpired('Missing report batch plan')
		const operations = plans.map(item => {
			const bounds = { maximumOwnerPrincipal: plan.maximumOwnerPrincipal, maximumOwnerCommitment: plan.maximumOwnerCommitment, expectedTargetHealthFactorBps: settings.portfolioPolicy.targetHealthFactorBps, expectedAcceptedPriceEpoch: 0n, expectedSourceBatch: item.plan.expectedSourceBatch }
			// Every attempt may consume the remaining prefunded balance. A failed
			// predecessor leaves that balance available; no call adds new funding.
			const ownRep = plan.maximumOwnRep
			const data =
				typeof item.target === 'bigint'
					? encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: 'takeOverWithBounds', args: [item.target, item.plan.commitment, item.plan.minimumAward, ownRep, bounds] })
					: encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: 'takeOverAuctionBid', args: [item.target.bidId, item.plan.commitment, item.plan.minimumAward, ownRep, bounds] })
			return { gasLimit: BigInt(settings.portfolioPolicy.reportOperationGasLimit), data }
		})
		const batch = { gasLimit: BigInt(operations.length * (settings.portfolioPolicy.reportOperationGasLimit + 100_000)), minimumPrice: funding.price, maximumPrice: funding.price, deadline: price.timestamp + price.observation.settlementSeconds + 300n, operations }
		request = buildPortfolioPriceOperationsRequest(price, funding.price, funding.weth, batch)
		label = 'Sponsor report with ordered bounded takeovers'
		reportSponsorship = { feed: observation.snapshot.priceFeed, fundingKey: `${observation.snapshot.capitalLedger.toLowerCase()}:${observation.snapshot.owner.toLowerCase()}` }
	}
	const revalidate = async () => {
		const latest = await refresh()
		assertPortfolioPlanStillAllowed(plan, latest.plan, 'takeover')
		assertPortfolioReportPlansStillAllowed(current.reportPlans, latest.reportPlans, 'takeover')
		const nextFunding = assertPortfolioReportFunding(latest, settings)
		if (latest.observation.acceptedPriceEpoch !== observation.acceptedPriceEpoch || nextFunding.price !== funding.price || nextFunding.weth > funding.weth || nextFunding.rep > funding.rep) throw new PortfolioOpportunityExpired('Report quote changed before signing')
	}
	await submit(wallet, settings, state, pool, { ...request, reportSponsorship, gas: 'estimate', label, preSubmit: revalidate, revalidateSimulationRevert: revalidate }, 'liquidation')
}

/** Discover and settle the sponsor's pending report after a restart or independent renewal. */
export async function executePendingPortfolioReport(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: PortfolioObservation, submit = submitCall): Promise<'none' | 'waiting' | 'submitted'> {
	if (target.pendingOperationReport === undefined) return 'none'
	const refresh = () =>
		readPortfolioExecutionSnapshot(
			wallet,
			settings,
			pool,
			state.portfolioScopes.map(scope => ({ scope, targets: [] })),
			target.selection,
			async () => undefined,
		)
	const current = (await refresh()).observation
	const pending = current.pendingOperationReport
	if (pending === undefined) return 'none'
	if (!current.selected || !current.approvedUniverse || !settings.runtime.execute || !settings.portfolioPolicy.allowFundedTakeovers) return 'waiting'
	const [amount1, amount2, reporter, reportedAt, settledAt, token1, oppoTime, settlementTime, halt, recipient, bounty, token2, count, delay, fee, multiplier, callback, callbackGas, protocolFee, flags] = pending.game
	if (settledAt === 0n && current.snapshot.timestamp < reportedAt + settlementTime) return 'waiting'
	const request =
		settledAt !== 0n
			? { to: current.snapshot.priceFeed, value: 0n, data: encodeFunctionData({ abi: sharedPoolPriceFeedAbi, functionName: 'recoverReport', args: [pending.id] }) }
			: {
					to: pending.oracle,
					value: 0n,
					data: encodeFunctionData({
						abi: openOracleAbi,
						functionName: 'settle',
						args: [pending.id, [amount1, amount2, reporter, reportedAt, settledAt, token1, oppoTime, settlementTime, halt, recipient, bounty, token2, count, delay, fee, multiplier, callback, callbackGas, protocolFee, flags], [pending.id, ...pending.helper]],
					}),
				}
	const gas = settledAt !== 0n ? 'estimate' : callbackGas + callbackGas / 63n + 350_000n
	const revalidate = async () => {
		const next = (await refresh()).observation.pendingOperationReport
		if (next === undefined || next.id !== pending.id || next.game.some((value, index) => value !== pending.game[index])) throw new PortfolioOpportunityExpired('Sponsored report changed before settlement')
	}
	if (current.walletAttoEth < settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.walletReserveAttoEth) throw new PortfolioOpportunityExpired('Report settlement would consume ETH reserve')
	await submit(
		wallet,
		settings,
		state,
		pool,
		{ ...request, gas, reportOperations: { feed: current.snapshot.priceFeed, reportId: pending.id }, label: settledAt !== 0n ? 'Recover sponsored report after failed callback' : 'Settle sponsored takeover report', preSubmit: revalidate, revalidateSimulationRevert: revalidate },
		'liquidation',
	)
	return 'submitted'
}
