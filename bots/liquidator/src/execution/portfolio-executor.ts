import type { OperatorSettings } from '#config/settings'
import { portfolioTakeoverPlan, type PortfolioTakeover } from '#core/portfolio-strategy'
import { loadPortfolioObservation, requireCompletePortfolioExposure, type PortfolioObservation, type PortfolioScope } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { createPublicClient, encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue, sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'
import { buildPortfolioCapitalTakeOverWithBoundsRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { buildPortfolioCapitalDepositRequest, buildPortfolioCapitalFundExecutionReserveRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { submitCall } from './liquidation-executor.ts'

export class PortfolioOpportunityExpired extends Error {
	override name = 'PortfolioOpportunityExpired'
}

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** @internal Tests verify authenticated refreshes and inject independent execution snapshots. */
export async function refreshPortfolioExecution(
	wallet: Wallet,
	settings: OperatorSettings,
	scopes: readonly PortfolioScope[],
	pool: RpcPool,
	target: PortfolioObservation,
	positionId: bigint,
	readers = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ endpoint, client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }) })),
) {
	const pinned = await sharedQuorumReadTargets(readers, settings.connectivity.rpcQuorum)
	return settledQuorumValue(
		'portfolio execution snapshot',
		pinned.readers.map(async ({ endpoint, client }) => {
			const block = await client.getBlock({ blockNumber: pinned.blockNumber })
			if (block.number === undefined || block.hash === undefined) throw new Error('Portfolio execution requires a confirmed block')
			const observations = []
			for (const scope of scopes) observations.push(await loadPortfolioObservation(client, settings, wallet.account.address, scope, block.number, scope.address === target.selection.address && scope.universeId === target.selection.universeId ? [positionId] : []))
			requireCompletePortfolioExposure(observations)
			const observation = observations.find(observation => observation.selection.address === target.selection.address && observation.selection.universeId === target.selection.universeId)
			if (observation === undefined) throw new Error('Portfolio disappeared from managed exposure history')
			const allowance = await client.readContract({ address: observation.snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [wallet.account.address, observation.snapshot.capitalLedger], blockNumber: block.number })
			return { endpoint, value: { observation, totalPrincipal: observations.reduce((sum, observation) => sum + observation.snapshot.ownerPrincipalAttoRep, 0n), allowance } }
		}),
		settings.connectivity.rpcQuorum,
	)
}

/** One durable action per cycle. Each prerequisite settles before a fresh, independent cycle can take over. */
export async function executePortfolioTakeover(
	wallet: Wallet,
	settings: OperatorSettings,
	state: RuntimeState,
	pool: RpcPool,
	target: PortfolioObservation,
	positionId: bigint,
	priceAllowed: (observation: PortfolioObservation) => Promise<boolean>,
	execution = { refresh: refreshPortfolioExecution, submit: submitCall },
) {
	if (!settings.portfolioPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Funded portfolio automation is disabled')
	if (state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery blocks portfolio exposure changes')
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, positionId)
		const position = current.observation.positions.find(position => position.id === positionId)
		if (position === undefined) throw new PortfolioOpportunityExpired('Portfolio target position is missing')
		const result = portfolioTakeoverPlan(current.observation, position, settings, current.totalPrincipal, await priceAllowed(current.observation))
		if (result.plan === undefined) throw new PortfolioOpportunityExpired(result.reason)
		return { ...current, plan: result.plan }
	}
	const current = await refresh()
	const { observation, plan } = current
	const expectedAcceptedPriceEpoch = observation.acceptedPriceEpoch
	const base = { owner: wallet.account.address, capitalLedger: observation.snapshot.capitalLedger }
	const kind = plan.ownFunding > 0n || plan.reserveFunding > 0n ? 'deposit' : 'liquidation'
	let request: { to: typeof base.capitalLedger; data: `0x${string}`; value: bigint }
	let label: string
	let action: 'approval' | 'principal' | 'reserve' | 'takeover'
	if (plan.ownFunding > 0n && current.allowance < plan.ownFunding) {
		action = 'approval'
		request = { to: observation.snapshot.repToken, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [base.capitalLedger, plan.ownFunding] }), value: 0n }
		label = 'Approve bounded portfolio REP funding'
	} else if (plan.ownFunding > 0n) {
		action = 'principal'
		request = buildPortfolioCapitalDepositRequest({ ...base, amountAttoRep: plan.ownFunding })
		label = 'Fund portfolio owner principal; rescreen next cycle'
	} else if (plan.reserveFunding > 0n) {
		action = 'reserve'
		request = buildPortfolioCapitalFundExecutionReserveRequest({ ...base, amountAttoEth: plan.reserveFunding })
		label = 'Fund portfolio execution reserve; rescreen next cycle'
	} else {
		action = 'takeover'
		request = buildPortfolioCapitalTakeOverWithBoundsRequest({
			...base,
			positionId: plan.positionId,
			commitment: plan.commitment,
			minimumAward: plan.minimumAward,
			maximumOwnRep: plan.maximumOwnRep,
			bounds: { maximumOwnerPrincipal: plan.maximumOwnerPrincipal, maximumOwnerCommitment: settings.portfolioPolicy.maximumCommitmentAttoEth, expectedTargetHealthFactorBps: settings.portfolioPolicy.targetHealthFactorBps, expectedAcceptedPriceEpoch, expectedSourceBatch: plan.expectedSourceBatch },
		})
		label = `Take over portfolio position ${positionId}`
	}
	const preSubmit = async () => {
		const latest = await refresh()
		assertPortfolioPlanStillAllowed(plan, latest.plan, action)
		if (latest.observation.acceptedPriceEpoch !== expectedAcceptedPriceEpoch) throw new PortfolioOpportunityExpired('Portfolio accepted price epoch changed before signing')
	}
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			...request,
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

/** @internal Tests exercise each prerequisite's final funding, exposure, and cohort revalidation. */
export function assertPortfolioPlanStillAllowed(original: PortfolioTakeover, current: PortfolioTakeover, action: 'approval' | 'principal' | 'reserve' | 'takeover') {
	if (original.commitment !== current.commitment || original.expectedSourceBatch !== current.expectedSourceBatch || original.maximumOwnerPrincipal > current.maximumOwnerPrincipal) throw new PortfolioOpportunityExpired('Portfolio exposure or cohort changed before submission')
	if ((action === 'approval' || action === 'principal') && original.ownFunding !== current.ownFunding) throw new PortfolioOpportunityExpired('Portfolio funding requirement changed before submission')
	if (action === 'reserve' && original.reserveFunding !== current.reserveFunding) throw new PortfolioOpportunityExpired('Portfolio reserve requirement changed before submission')
	if (action === 'takeover' && (current.ownFunding !== 0n || current.reserveFunding !== 0n || current.minimumAward < original.minimumAward || current.maximumOwnRep > original.maximumOwnRep)) throw new PortfolioOpportunityExpired('Portfolio takeover terms changed before submission')
}
