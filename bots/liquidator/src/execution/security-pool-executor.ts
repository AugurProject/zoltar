import type { OperatorSettings } from '#config/settings'
import { securityPoolTakeoverPlan, type SecurityPoolTakeover } from '#core/security-pool-strategy'
import type { SecurityPoolObservation, SecurityPoolScope } from '#monitoring/security-pool-monitor'
import type { RuntimeState } from '#state/operator-state'
import { erc20Abi, securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { securityPoolTarget, sameSecurityPoolTarget, type SecurityPoolTarget } from '#monitoring/security-pool-auction'
import { encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { readSecurityPoolExecutionSnapshot } from './security-pool-execution-snapshot.ts'
import { buildSecurityPoolCapitalTakeOverWithBoundsRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { buildSecurityPoolCapitalDepositRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { submitCall } from './submit-call.ts'

export class SecurityPoolOpportunityExpired extends Error {
	override name = 'SecurityPoolOpportunityExpired'
}

export class SecurityPoolGasBudgetExceeded extends SecurityPoolOpportunityExpired {}

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Authenticate exposure and the exact target again at an agreed RPC height before execution. */
export async function refreshSecurityPoolExecution(
	wallet: Wallet,
	settings: OperatorSettings,
	scopes: readonly SecurityPoolScope[],
	pool: RpcPool,
	target: SecurityPoolObservation,
	positionId: SecurityPoolTarget | undefined,
	readers?: Parameters<typeof readSecurityPoolExecutionSnapshot>[6],
	unlockedTarget?: SecurityPoolTarget,
): Promise<{ observation: SecurityPoolObservation; totalPrincipal: bigint | undefined; allowance: bigint }> {
	const targets = [positionId, unlockedTarget].filter(candidate => candidate !== undefined)
	const result = await readSecurityPoolExecutionSnapshot(
		wallet,
		settings,
		pool,
		scopes.map(scope => ({ scope, targets: positionId !== undefined && scope.address === target.selection.address && scope.universeId === target.selection.universeId ? targets : [] })),
		target.selection,
		async ({ client, observation, blockNumber }) => client.readContract({ address: observation.snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [wallet.account.address, observation.snapshot.capitalLedger], blockNumber }),
		readers,
	)
	return { observation: result.observation, totalPrincipal: result.totalPrincipal, allowance: result.details }
}

/** One durable action per cycle. Each prerequisite settles before a fresh, independent cycle can take over. */
export async function executeSecurityPoolTakeover(
	wallet: Wallet,
	settings: OperatorSettings,
	state: RuntimeState,
	pool: RpcPool,
	target: SecurityPoolObservation,
	positionId: SecurityPoolTarget,
	priceAllowed: (observation: SecurityPoolObservation) => Promise<boolean>,
	execution = { refresh: refreshSecurityPoolExecution, submit: submitCall },
	unlockedTarget?: SecurityPoolTarget,
) {
	if (!settings.securityPoolPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Funded security pool automation is disabled')
	if (state.pendingTransactions.length !== 0) throw new Error('Pending recovery blocks security pool exposure changes')
	const refresh = async (requestedCommitment?: bigint) => {
		const current = await execution.refresh(wallet, settings, state.securityPoolScopes, pool, target, positionId, undefined, unlockedTarget)
		const position = current.observation.positions.find(position => sameSecurityPoolTarget(securityPoolTarget(position), positionId))
		if (position === undefined) throw new SecurityPoolOpportunityExpired('Security pool target position is missing')
		const marketAllowed = await priceAllowed(current.observation)
		const result = securityPoolTakeoverPlan(current.observation, position, settings, current.totalPrincipal, marketAllowed, requestedCommitment)
		if (result.plan === undefined) throw new SecurityPoolOpportunityExpired(result.reason)
		return { ...current, plan: result.plan }
	}
	const current = await refresh()
	const { observation, plan } = current
	const expectedAcceptedPriceEpoch = observation.acceptedPriceEpoch
	const base = { owner: wallet.account.address, capitalLedger: observation.snapshot.capitalLedger }
	const kind = plan.ownFunding > 0n ? 'deposit' : 'liquidation'
	let request: { to: typeof base.capitalLedger; data: `0x${string}`; value: bigint }
	let label: string
	let action: 'approval' | 'principal' | 'takeover'
	if (plan.ownFunding > 0n && current.allowance < plan.ownFunding) {
		action = 'approval'
		request = { to: observation.snapshot.repToken, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [base.capitalLedger, plan.approvalRep] }), value: 0n }
		label = 'Approve bounded REP funding for the security pool'
	} else if (plan.ownFunding > 0n) {
		action = 'principal'
		request = buildSecurityPoolCapitalDepositRequest({ ...base, amountAttoRep: plan.ownFunding })
		label = 'Fund security pool owner principal; rescreen next cycle'
	} else {
		action = 'takeover'
		const bounds = { maximumOwnerPrincipal: plan.maximumOwnerPrincipal, maximumOwnerCommitment: plan.maximumOwnerCommitment, expectedTargetHealthFactorBps: settings.securityPoolPolicy.targetHealthFactorBps, expectedAcceptedPriceEpoch, expectedSourceBatch: plan.expectedSourceBatch }
		request =
			typeof positionId === 'bigint'
				? buildSecurityPoolCapitalTakeOverWithBoundsRequest({
						...base,
						positionId: plan.positionId,
						commitment: plan.requestedCommitment ?? plan.commitment,
						minimumTakeoverReward: plan.minimumTakeoverReward,
						maximumOwnRep: plan.maximumOwnRep,
						bounds,
					})
				: { to: base.capitalLedger, value: 0n, data: encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: 'takeOverRepairAuctionBid', args: [positionId.bidId, plan.requestedCommitment ?? plan.commitment, plan.minimumTakeoverReward, plan.maximumOwnRep, bounds] }) }
		label = typeof positionId === 'bigint' ? `Take over security pool position ${positionId}` : `Take over auction bid ${positionId.bidId} bidder ${positionId.bidder} position`
		if (plan.unpaidCure) label = typeof positionId === 'bigint' ? `Cure security pool position ${positionId} without a takeover reward` : `Cure auction bid ${positionId.bidId} bidder ${positionId.bidder} position without a takeover reward`
	}
	const preSubmit = async () => {
		const latest = await refresh(action === 'takeover' && plan.requestedCommitment === undefined ? plan.commitment : undefined)
		assertSecurityPoolPlanStillAllowed(plan, latest.plan, action)
		if (latest.observation.acceptedPriceEpoch !== expectedAcceptedPriceEpoch) throw new SecurityPoolOpportunityExpired('Security pool accepted price epoch changed before signing')
	}
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			...request,
			// A cure spends none of the owner's principal, so funding recorded for a takeover stays recorded.
			securityPoolFunding: action === 'approval' || plan.unpaidCure ? undefined : { key: `${base.capitalLedger.toLowerCase()}:${base.owner.toLowerCase()}`, operation: action === 'principal' ? 'fund' : 'consume', target: positionId, amount: action === 'principal' ? plan.ownFunding : 0n },
			capFeeToGasBudget: action === 'takeover',
			gas: 'estimate',
			gasBudgetExceeded: () => {
				throw new SecurityPoolOpportunityExpired('Estimated security pool gas exceeds strategy.maximumGasCostEth')
			},
			label,
			preSubmit,
			revalidateSimulationRevert: preSubmit,
		},
		kind,
	)
}

/** @internal Revalidate funding, exposure and cohort consent after each prerequisite. */
export function assertSecurityPoolPlanStillAllowed(original: SecurityPoolTakeover, current: SecurityPoolTakeover, action: 'approval' | 'principal' | 'takeover') {
	if (original.expectedTotalCommitment !== current.expectedTotalCommitment || original.expectedDemand !== current.expectedDemand) throw new SecurityPoolOpportunityExpired('Security pool cure capacity changed before submission')
	const commitmentCovered = original.requestedCommitment !== undefined && current.commitment >= original.commitment && current.commitment <= original.requestedCommitment
	if ((!commitmentCovered && original.commitment !== current.commitment) || original.expectedSourceBatch !== current.expectedSourceBatch || original.maximumOwnerPrincipal > current.maximumOwnerPrincipal || original.maximumOwnerCommitment > current.maximumOwnerCommitment)
		throw new SecurityPoolOpportunityExpired('Security pool exposure or cohort changed before submission')
	if (original.unpaidCure !== current.unpaidCure) throw new SecurityPoolOpportunityExpired('Security pool takeover terms changed before submission')
	if ((action === 'approval' || action === 'principal') && original.ownFunding !== current.ownFunding) throw new SecurityPoolOpportunityExpired('Security pool funding requirement changed before submission')
	if (action === 'takeover' && (current.ownFunding !== 0n || current.minimumTakeoverReward < original.minimumTakeoverReward || current.maximumOwnRep > original.maximumOwnRep)) throw new SecurityPoolOpportunityExpired('Security pool takeover terms changed before submission')
}
