import type { OperatorSettings } from '#config/settings'
import { portfolioCurePlan, portfolioEarningsCoverGas } from '#core/portfolio-cure'
import { portfolioTarget, samePortfolioTarget, type PortfolioTarget } from '#monitoring/portfolio-auction'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { multicall3Abi, portfolioRuntimeIdentities, securityPoolCapitalLedgerAbi as capitalAbi } from '@zoltar/bot-shared/contracts/abi'
import { createWalletClient, decodeFunctionResult, encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { MAX_PRIORITY_FEE_PER_GAS, maximumFeePerGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { PortfolioOpportunityExpired, refreshPortfolioExecution } from './portfolio-executor.ts'
import { submitCall } from './liquidation-executor.ts'
import { PREFLIGHT_BALANCE } from './gas-estimate.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>
const cureBounds = (observation: PortfolioObservation, minimumRemoved: bigint, minimumReward: bigint) => ({
	expectedTotalCommitment: observation.snapshot.totalCommitmentAttoEth,
	expectedDemand: observation.snapshot.demandAttoEth,
	expectedAcceptedPriceEpoch: observation.acceptedPriceEpoch,
	minimumRemoved,
	minimumReward,
})
const cureData = (target: PortfolioTarget, bounds: ReturnType<typeof cureBounds>) => encodeFunctionData({ abi: capitalAbi, functionName: typeof target === 'bigint' ? 'cureWithBounds' : 'cureAuctionBid', args: [typeof target === 'bigint' ? target : target.bidId, bounds] })

/** @internal Production regression verifies eth_call progress and exact pull credit without changing state. */
export async function simulatePortfolioCureReward(wallet: Wallet, settings: OperatorSettings, pool: RpcPool, observation: PortfolioObservation, target: PortfolioTarget) {
	const { snapshot } = observation
	const blockNumber = snapshot.blockNumber
	const multicall = settings.deployment.multicall3
	return settledQuorumValue(
		'portfolio cure reward',
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const client = createWalletClient({ account: wallet.account, chain: wallet.chain, transport: pool.transportFor(endpoint) })
			verifyRuntimeIdentity(await client.getCode({ address: multicall, blockNumber }), portfolioRuntimeIdentities.Multicall3, 'cure simulation Multicall3')
			const block = await client.getBlock({ blockNumber })
			if (block.hash !== snapshot.blockHash || block.baseFeePerGas === undefined) throw new Error('Cure simulation block changed')
			const maxFeePerGas = maximumFeePerGas(block.baseFeePerGas)
			const before = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'storedOwnerAccount', args: [multicall], blockNumber })
			const result = await client.call({
				account: wallet.account,
				to: multicall,
				blockNumber,
				gas: 16_777_216n,
				// Isolate reward accounting from RPC gas-ceiling affordability. Only
				// the caller's ETH balance changes; final simulation uses real funds.
				balanceOverride: PREFLIGHT_BALANCE,
				// Use the same signed fee policy as estimation and final simulation.
				maxFeePerGas,
				maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
				data: encodeFunctionData({
					abi: multicall3Abi,
					functionName: 'aggregate3',
					args: [
						[
							{ target: snapshot.capitalLedger, allowFailure: false, callData: cureData(target, cureBounds(observation, 1n, 0n)) },
							{ target: snapshot.capitalLedger, allowFailure: false, callData: encodeFunctionData({ abi: capitalAbi, functionName: 'storedOwnerAccount', args: [multicall] }) },
						],
					],
				}),
			})
			if (result.data === undefined) throw new Error('Cure simulation did not return data')
			const calls = decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: result.data })
			const cure = calls[0]
			const account = calls[1]
			if (cure === undefined || account === undefined || !cure.success || !account.success) throw new Error('Cure reward simulation failed')
			const removed = decodeFunctionResult({ abi: capitalAbi, functionName: typeof target === 'bigint' ? 'cureWithBounds' : 'cureAuctionBid', data: cure.returnData })
			if (typeof removed !== 'bigint') throw new Error('Cure returned invalid progress')
			const after = decodeFunctionResult({ abi: capitalAbi, functionName: 'storedOwnerAccount', data: account.returnData })
			if (after.feesAttoRep < before.feesAttoRep || (await client.getBlock({ blockNumber })).hash !== snapshot.blockHash) throw new Error('Cure reward snapshot changed')
			return { endpoint, value: { removed, reward: after.feesAttoRep - before.feesAttoRep } }
		}),
		settings.connectivity.rpcQuorum,
	)
}

export async function executePortfolioCure(
	wallet: Wallet,
	settings: OperatorSettings,
	state: RuntimeState,
	pool: RpcPool,
	target: PortfolioObservation,
	targetId: PortfolioTarget,
	priceAllowed: (observation: PortfolioObservation) => Promise<boolean>,
	execution = { refresh: refreshPortfolioExecution, simulate: simulatePortfolioCureReward, submit: submitCall },
) {
	if (!settings.portfolioPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Portfolio automation is disabled')
	if (state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery blocks portfolio cures')
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, targetId)
		const position = current.observation.positions.find(position => samePortfolioTarget(portfolioTarget(position), targetId))
		if (position === undefined) throw new PortfolioOpportunityExpired('Cure target was materialized or removed; rescreen its ordinary position')
		const plan = portfolioCurePlan(current.observation, position, settings, await priceAllowed(current.observation))
		if (plan === undefined) throw new PortfolioOpportunityExpired('No profitable REP-funded cure progress is available')
		const quote = await execution.simulate(wallet, settings, pool, current.observation, targetId)
		if (quote.removed <= 0n || quote.reward > plan.rewardCeiling || quote.reward < plan.minimumReward) throw new PortfolioOpportunityExpired('Simulated cure reward does not cover cure, claim and minimum profit')
		return { observation: current.observation, quote, minimumReward: plan.minimumReward }
	}
	const current = await refresh()
	const bounds = cureBounds(current.observation, current.quote.removed, current.minimumReward)
	const preSubmit = async () => {
		const latest = await refresh()
		const next = cureBounds(latest.observation, latest.quote.removed, latest.minimumReward)
		if (
			next.expectedTotalCommitment !== bounds.expectedTotalCommitment ||
			next.expectedDemand !== bounds.expectedDemand ||
			next.expectedAcceptedPriceEpoch !== bounds.expectedAcceptedPriceEpoch ||
			latest.quote.removed < bounds.minimumRemoved ||
			latest.quote.reward < bounds.minimumReward ||
			latest.minimumReward > bounds.minimumReward
		)
			throw new PortfolioOpportunityExpired('Cure state or minimum reward changed before signing')
	}
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			to: current.observation.snapshot.capitalLedger,
			value: 0n,
			data: cureData(targetId, bounds),
			gas: 'estimate',
			label: typeof targetId === 'bigint' ? `Cure portfolio position ${targetId}` : `Cure auction bid ${targetId.bidId} vault ${targetId.vault}`,
			preSubmit,
			revalidateSimulationRevert: preSubmit,
			gasBudgetExceeded: () => {
				throw new PortfolioOpportunityExpired('Estimated cure gas exceeds the configured budget')
			},
		},
		'liquidation',
	)
}

/** Reward credits are collected separately, with no principal or commitment mutation. */
export async function executePortfolioEarnings(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: PortfolioObservation, priceAllowed: (observation: PortfolioObservation) => Promise<boolean>, execution = { refresh: refreshPortfolioExecution, submit: submitCall }) {
	if (!settings.portfolioPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Portfolio automation is disabled')
	if (state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery blocks portfolio earnings withdrawal')
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, undefined)
		const observation = current.observation
		if (!portfolioEarningsCoverGas(observation, settings, await priceAllowed(observation))) throw new PortfolioOpportunityExpired('Portfolio earnings do not cover claim gas and minimum profit')
		return observation
	}
	const current = await refresh()
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			to: current.snapshot.capitalLedger,
			value: 0n,
			data: encodeFunctionData({ abi: capitalAbi, functionName: 'claimEarnings' }),
			gas: 'estimate',
			label: 'Collect portfolio keeper rewards and earned fees',
			preSubmit: refresh,
			revalidateSimulationRevert: refresh,
			gasBudgetExceeded: () => {
				throw new PortfolioOpportunityExpired('Estimated reward claim gas exceeds the configured budget')
			},
		},
		'fees',
	)
}
