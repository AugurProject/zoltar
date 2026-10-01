import { erc1155Abi, twoWayConstantProductPairAbi } from '@zoltar/bot-shared/contracts/abi'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { inputInteger, inputMatches } from '../input-values.ts'
import { amount, choose, eligible, encodeStep, erc1155WalletDebit, erc20WalletDebit, eventEvidence, mixSeed, planBase, planningDeadline } from '../planning.ts'
import { shareTokenId, sharesToEth, walletShares } from '../statoblast/planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationPlan, OperationPlanDraft, PairSnapshot, PlanningOptions, PoolSnapshot, ShareInventory } from '../types.ts'
import { metadataAddress, metadataOutcome, metadataPair, metadataPositiveAmount, previousReceiveActionMatches, previousRemoveActionMatches } from './continuations.ts'
import { poolForPair, poolLifecycleOpen, poolQuestion, receiveRequestData } from './pool-state.ts'
import { MAXIMUM_TRADING_SPEND, maximumAfterSlippage, minimumAfterSlippage, minimumOf, minimumPositivePayoutShares, quoteExactOutput, removableLiquidity, removableLiquidityQuote } from './pricing.ts'

type RouterOwnedKind = 'exit' | 'redeem' | 'remove'

const COMPLETE_SET_REDEEMED_SIGNATURE = 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)'

export function buildRouterRemovePlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, liquidity: bigint, minimumYes: bigint, minimumNo: bigint, metadata: OperationPlan['metadata'], allowAboveOperationalCap = false) {
	if ((!allowAboveOperationalCap && liquidity > MAXIMUM_TRADING_SPEND) || amount(pair.walletLiquidity) < liquidity) return undefined
	const inventory = snapshot.wallet.lpTokens.find(candidate => sameAddress(candidate.pair, pair.address))
	const quote = removableLiquidityQuote(pair, liquidity)
	if (inventory === undefined || amount(inventory.balance) < liquidity || quote === undefined || quote.yesOut < minimumYes || quote.noOut < minimumNo) return undefined
	const deadline = planningDeadline(snapshot, options, mixSeed(options.seed, 'trading.liquidity.remove:deadline'))
	if (deadline === undefined) return undefined
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: 'trading.liquidity.remove',
		ecosystem: 'trading',
		label: 'Router remove',
		metadata,
		postconditions: ['LP balance decreases and outcome shares return'],
		risk: 'medium',
		snapshot,
		steps: [
			encodeStep({
				abi: twoWayConstantProductPairAbi,
				args: [liquidity, minimumYes, minimumNo, snapshot.wallet.address, BigInt(deadline)],
				evidence: [eventEvidence(pair.address, 'LiquidityRemoved(address,address,uint256,uint256,uint256)')],
				functionName: 'removeLiquidity',
				id: 'removeLiquidity',
				label: 'Router remove',
				to: pair.address,
				walletAssetDebits: [erc20WalletDebit(pair.address, liquidity, 'lp-token')],
			}),
		],
	})
}

function buildRouterRedeemPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, completeAmount: bigint, minimumEthAttoEth: bigint, metadata: OperationPlan['metadata']) {
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	const universe = pool === undefined ? undefined : snapshot.universes.find(candidate => candidate.id === pool.universeId)
	if (pool === undefined || shares === undefined || pool.systemState !== 0 || universe?.forkTime !== '0') return undefined
	if (amount(shares.invalid) < completeAmount || amount(shares.yes) < completeAmount || amount(shares.no) < completeAmount || sharesToEth(pool, completeAmount) < minimumEthAttoEth) return undefined
	const deadline = planningDeadline(snapshot, options, mixSeed(options.seed, 'trading.complete-set.redeem:deadline'))
	if (deadline === undefined) return undefined
	const tokenIds = [0, 1, 2].map(outcome => shareTokenId(shares.universeId, outcome))
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: 'trading.complete-set.redeem',
		ecosystem: 'trading',
		label: 'Router redeem',
		metadata,
		postconditions: ['Complete sets redeem to ETH and wallet share balances decrease'],
		risk: 'medium',
		snapshot,
		steps: [
			encodeStep({
				abi: erc1155Abi,
				args: [snapshot.wallet.address, snapshot.deployments.tradingRouter, tokenIds, tokenIds.map(() => completeAmount), receiveRequestData(snapshot, pool, pair, shares, 1, 3, completeAmount, 0n, minimumEthAttoEth, BigInt(deadline))],
				evidence: [eventEvidence(pool.address, COMPLETE_SET_REDEEMED_SIGNATURE)],
				functionName: 'safeBatchTransferFrom',
				id: 'redeemCompleteSet',
				label: 'Router redeem',
				to: shares.shareToken,
				walletAssetDebits: [0, 1, 2].map(outcome => erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, outcome), completeAmount)),
			}),
		],
	})
}

function buildRouterExitPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, longOutcome: 1 | 2, completeAmount: bigint, maximumLong: bigint, minimumEthAttoEth: bigint, metadata: OperationPlan['metadata']) {
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (pool === undefined || shares === undefined || pair.status !== 0 || amount(shares.invalid) < completeAmount || amount(longOutcome === 1 ? shares.yes : shares.no) < maximumLong) return undefined
	if (!poolLifecycleOpen(snapshot, pool, options, 0)) return undefined
	const requiredSwapInput = quoteExactOutput(pair, longOutcome === 1, completeAmount)
	if (requiredSwapInput === undefined || requiredSwapInput + completeAmount > maximumLong || sharesToEth(pool, completeAmount) < minimumEthAttoEth) return undefined
	const deadline = planningDeadline(snapshot, options, mixSeed(options.seed, 'trading.position.exit:deadline'), amount(poolQuestion(snapshot, pool)?.endTime ?? '0') - 1n)
	if (deadline === undefined) return undefined
	const tokenIds = [shareTokenId(shares.universeId, 0), shareTokenId(shares.universeId, longOutcome)]
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: 'trading.position.exit',
		ecosystem: 'trading',
		label: 'Router exit',
		metadata,
		postconditions: ['Complete sets redeem to ETH and wallet share balances decrease'],
		risk: 'medium',
		snapshot,
		steps: [
			encodeStep({
				abi: erc1155Abi,
				args: [snapshot.wallet.address, snapshot.deployments.tradingRouter, tokenIds, [completeAmount, maximumLong], receiveRequestData(snapshot, pool, pair, shares, 0, longOutcome, completeAmount, maximumLong, minimumEthAttoEth, BigInt(deadline))],
				evidence: [eventEvidence(pair.address, 'Swap(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256)'), eventEvidence(pool.address, COMPLETE_SET_REDEEMED_SIGNATURE)],
				functionName: 'safeBatchTransferFrom',
				id: 'exitPosition',
				label: 'Router exit',
				to: shares.shareToken,
				walletAssetDebits: [erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 0), completeAmount), erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, longOutcome), maximumLong)],
			}),
		],
	})
}

function rebuildRouterRemove(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, pair: PairSnapshot) {
	const { metadata } = context.previousPlan
	const liquidity = metadataPositiveAmount(metadata, 'liquidity')
	const minimumYes = metadataPositiveAmount(metadata, 'minimumYes')
	const minimumNo = metadataPositiveAmount(metadata, 'minimumNo')
	if (liquidity === undefined || minimumYes === undefined || minimumNo === undefined || !previousRemoveActionMatches(snapshot, context, pair, liquidity, minimumYes, minimumNo)) return undefined
	return buildRouterRemovePlan(snapshot, options, pair, liquidity, minimumYes, minimumNo, metadata)
}

function rebuildRouterReceive(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, pair: PairSnapshot, kind: Exclude<RouterOwnedKind, 'remove'>) {
	const { metadata } = context.previousPlan
	const completeAmount = metadataPositiveAmount(metadata, 'completeAmount')
	const minimumEthAttoEth = metadataPositiveAmount(metadata, 'minimumEthAttoEth')
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (completeAmount === undefined || minimumEthAttoEth === undefined || pool === undefined || shares === undefined) return undefined
	if (kind === 'redeem') {
		if (!previousReceiveActionMatches(snapshot, context, pool, pair, shares, 1, 3, completeAmount, 0n, minimumEthAttoEth)) return undefined
		return buildRouterRedeemPlan(snapshot, options, pair, completeAmount, minimumEthAttoEth, metadata)
	}
	const longOutcome = metadataOutcome(metadata, 'longOutcome')
	const maximumLong = metadataPositiveAmount(metadata, 'maximumLong')
	if (longOutcome === undefined || maximumLong === undefined || !previousReceiveActionMatches(snapshot, context, pool, pair, shares, 0, longOutcome, completeAmount, maximumLong, minimumEthAttoEth)) return undefined
	return buildRouterExitPlan(snapshot, options, pair, longOutcome, completeAmount, maximumLong, minimumEthAttoEth, metadata)
}

function buildRouterOwnedContinuation(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, kind: RouterOwnedKind): OperationPlanDraft | undefined {
	if (context.continuationDisposition === 'cleanup-only' || context.previousPlan.deadlineTimestamp === undefined) return undefined
	const reviewedOptions = { ...options, reviewedDeadlineTimestamp: context.previousPlan.deadlineTimestamp }
	const routerAddress = metadataAddress(context.previousPlan.metadata, 'router')
	const pair = metadataPair(snapshot, context.previousPlan.metadata)
	if (pair === undefined || (kind !== 'remove' && !sameAddress(routerAddress, snapshot.deployments.tradingRouter))) return undefined
	return kind === 'remove' ? rebuildRouterRemove(snapshot, reviewedOptions, context, pair) : rebuildRouterReceive(snapshot, reviewedOptions, context, pair, kind)
}

const longOutcome = (longYes: boolean): 1 | 2 => (longYes ? 1 : 2)

const completeSetBalance = (shares: ShareInventory) => minimumOf([amount(shares.invalid), amount(shares.yes), amount(shares.no)])

/**
 * Whether the wallet holds inventory the router-owned workflow can consume from `pair`.
 * Exit candidate selection requires the long balance to cover the exact swap input, while
 * eligibility additionally requires slippage headroom (`requireExitSlippageHeadroom`).
 */
function routerOwnedPairReady(snapshot: EcosystemSnapshot, pair: PairSnapshot, kind: RouterOwnedKind, options: PlanningOptions, requireExitSlippageHeadroom: boolean) {
	if (kind === 'remove') return removableLiquidity(pair) > 0n
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (pool === undefined || shares === undefined || amount(shares.invalid) === 0n) return false
	if (kind === 'redeem') {
		const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
		const complete = completeSetBalance(shares)
		return pool.systemState === 0 && universe?.forkTime === '0' && complete > 0n && sharesToEth(pool, complete) > 0n
	}
	if (pair.status !== 0 || !poolLifecycleOpen(snapshot, pool, options, 0)) return false
	const complete = minimumPositivePayoutShares(pool)
	if (complete === undefined || amount(shares.invalid) < complete) return false
	return [true, false].some(longYes => {
		const requiredSwapInput = quoteExactOutput(pair, longYes, complete)
		if (requiredSwapInput === undefined) return false
		return amount(longYes ? shares.yes : shares.no) >= complete + (requireExitSlippageHeadroom ? maximumAfterSlippage(requiredSwapInput) : requiredSwapInput)
	})
}

function buildRemoveFromPair(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, pool: PoolSnapshot) {
	const liquidity = inputInteger(options, 'amount', removableLiquidity(pair), 1n, removableLiquidity(pair))
	const quote = removableLiquidityQuote(pair, liquidity)
	if (quote === undefined) return undefined
	const minimumYes = inputInteger(options, 'minimumYes', minimumAfterSlippage(quote.yesOut), 1n, quote.yesOut)
	const minimumNo = inputInteger(options, 'minimumNo', minimumAfterSlippage(quote.noOut), 1n, quote.noOut)
	return buildRouterRemovePlan(snapshot, options, pair, liquidity, minimumYes, minimumNo, { liquidity: liquidity.toString(), minimumNo: minimumNo.toString(), minimumYes: minimumYes.toString(), pair: pair.address, pool: pool.address, router: snapshot.deployments.tradingRouter })
}

const minimumEthForCompleteSets = (options: PlanningOptions, pool: PoolSnapshot, completeAmount: bigint) => inputInteger(options, 'minimumEthAttoEth', minimumAfterSlippage(sharesToEth(pool, completeAmount)), 1n, sharesToEth(pool, completeAmount))

function buildRedeemFromPair(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, pool: PoolSnapshot, shares: ShareInventory) {
	const available = completeSetBalance(shares)
	const completeAmount = inputInteger(options, 'amount', available, 1n, available)
	const minimumEthAttoEth = minimumEthForCompleteSets(options, pool, completeAmount)
	return buildRouterRedeemPlan(snapshot, options, pair, completeAmount, minimumEthAttoEth, { completeAmount: completeAmount.toString(), minimumEthAttoEth: minimumEthAttoEth.toString(), pair: pair.address, pool: pool.address, router: snapshot.deployments.tradingRouter })
}

function buildExitFromPair(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, pool: PoolSnapshot, shares: ShareInventory, id: string) {
	const minimum = minimumPositivePayoutShares(pool)
	if (minimum === undefined) return undefined
	const completeAmount = inputInteger(options, 'amount', minimum, minimum, amount(shares.invalid))
	if (amount(shares.invalid) < completeAmount) return undefined
	const routes = [true, false]
		.filter(longYes => inputMatches(options, 'longOutcome', longOutcome(longYes)))
		.flatMap(longYes => {
			const requiredSwapInput = quoteExactOutput(pair, longYes, completeAmount)
			const longBalance = amount(longYes ? shares.yes : shares.no)
			const maximumSwapInput = requiredSwapInput === undefined ? undefined : maximumAfterSlippage(requiredSwapInput)
			return maximumSwapInput !== undefined && longBalance >= completeAmount + maximumSwapInput ? [{ longOutcome: longOutcome(longYes), maximumLong: completeAmount + maximumSwapInput }] : []
		})
	const route = choose(routes, mixSeed(options.seed, `${id}:direction`))
	if (route === undefined) return undefined
	const minimumEthAttoEth = minimumEthForCompleteSets(options, pool, completeAmount)
	return buildRouterExitPlan(snapshot, options, pair, route.longOutcome, completeAmount, route.maximumLong, minimumEthAttoEth, {
		completeAmount: completeAmount.toString(),
		longOutcome: route.longOutcome,
		maximumLong: route.maximumLong.toString(),
		minimumEthAttoEth: minimumEthAttoEth.toString(),
		pair: pair.address,
		pool: pool.address,
		router: snapshot.deployments.tradingRouter,
	})
}

export function routerOwnedDefinition(kind: RouterOwnedKind): OperationDefinition {
	const details = {
		exit: ['trading.position.exit', 'safeBatchTransferFrom'],
		redeem: ['trading.complete-set.redeem', 'safeBatchTransferFrom'],
		remove: ['trading.liquidity.remove', 'removeLiquidity'],
	} as const
	const [id, method] = details[kind]
	return {
		requiredTradingDeployment: kind === 'remove' ? [] : ['router'],
		buildPlan(snapshot, options) {
			const pair = choose(
				snapshot.pairs.filter(candidate => inputMatches(options, 'pair', candidate.address) && routerOwnedPairReady(snapshot, candidate, kind, options, false)),
				mixSeed(options.seed, id),
			)
			const pool = pair === undefined ? undefined : poolForPair(snapshot, pair)
			if (pair === undefined || pool === undefined) return undefined
			if (kind === 'remove') return buildRemoveFromPair(snapshot, options, pair, pool)
			const shares = walletShares(snapshot, pool)
			if (shares === undefined) return undefined
			return kind === 'redeem' ? buildRedeemFromPair(snapshot, options, pair, pool, shares) : buildExitFromPair(snapshot, options, pair, pool, shares, id)
		},
		buildContinuationPlan(snapshot, options, context) {
			return buildRouterOwnedContinuation(snapshot, options, context, kind)
		},
		classification: 'selectable',
		contract: kind === 'remove' ? 'TwoWayConstantProductPair' : 'ShareToken',
		description: kind === 'remove' ? 'Removes wallet-owned LP directly from the pair.' : `Transfers wallet-owned shares into the router's atomic ${kind} callback.`,
		discoveryInputs: ['wallet shares/LP balance', 'pair lifecycle'],
		ecosystem: 'trading',
		evaluate(snapshot, options) {
			const found = snapshot.pairs.some(pair => routerOwnedPairReady(snapshot, pair, kind, options, true))
			return eligible(found ? undefined : `No wallet inventory is eligible to ${kind}`)
		},
		id,
		label: `Router ${kind}`,
		method,
		risk: 'medium',
	}
}
