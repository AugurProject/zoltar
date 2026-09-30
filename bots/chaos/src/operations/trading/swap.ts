import { twoWayConstantProductPairAbi } from '@zoltar/bot-shared/contracts/abi'
import { inputInteger, inputMatches, inputSpend } from '../input-values.ts'
import { amount, choose, eligible, encodeStep, erc1155WalletDebit, eventEvidence, mixSeed, planBase } from '../planning.ts'
import { shareTokenId, walletShares } from '../statoblast/planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationPlan, PairSnapshot, PlanningOptions, PoolSnapshot, ShareInventory } from '../types.ts'
import { metadataPair, metadataPositiveAmount, previousSwapActionMatches } from './continuations.ts'
import { poolForPair, poolLifecycleOpen, protocolQuestionDeadline } from './pool-state.ts'
import { cappedTradingSpend, MAXIMUM_TRADING_SPEND, maximumAfterSlippage, minimumAfterSlippage, quoteExactInput, quoteExactOutput } from './pricing.ts'
import { continuationShareApproval, shareApproval, shareApprovalCleanup } from './share-approvals.ts'

type SwapMode = 'exact-input' | 'exact-output'

const swapMethod = (mode: SwapMode) => (mode === 'exact-input' ? 'swapExactInput' : 'swapExactOutput')

const swapDirection = (yesForNo: boolean) => (yesForNo ? 'YES-to-NO' : 'NO-to-YES')

/** Maximum input share amount the swap may debit, or `undefined` when the quote or wallet balance cannot satisfy the bounds. */
function swapMaximumInput(pair: PairSnapshot, mode: SwapMode, yesForNo: boolean, principal: bigint, bound: bigint, inputBalance: bigint) {
	if (mode === 'exact-input') return inputBalance < principal || quoteExactInput(pair, yesForNo, principal) < bound ? undefined : principal
	const requiredInput = quoteExactOutput(pair, yesForNo, principal)
	return requiredInput === undefined || requiredInput > bound || inputBalance < bound ? undefined : bound
}

function buildSwapPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, mode: SwapMode, yesForNo: boolean, principal: bigint, bound: bigint, metadata: OperationPlan['metadata'], confirmedApproval = false, approvalStepId?: string) {
	if ((mode === 'exact-input' && principal > MAXIMUM_TRADING_SPEND) || (mode === 'exact-output' && bound > MAXIMUM_TRADING_SPEND) || pair.status !== 0) return undefined
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (pool === undefined || shares === undefined) return undefined
	const steps = shareApproval(shares, pair.address, snapshot.wallet.address, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	if (!poolLifecycleOpen(snapshot, pool, options, steps.length)) return undefined
	const maximumInput = swapMaximumInput(pair, mode, yesForNo, principal, bound, amount(yesForNo ? shares.yes : shares.no))
	if (maximumInput === undefined) return undefined
	const method = swapMethod(mode)
	steps.push(
		encodeStep({
			abi: twoWayConstantProductPairAbi,
			args: [yesForNo, principal, bound, snapshot.wallet.address],
			evidence: [eventEvidence(pair.address, 'Swap(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256)')],
			functionName: method,
			id: method,
			label: `Swap ${mode}`,
			to: pair.address,
			walletAssetDebits: [erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, yesForNo ? 1 : 2), maximumInput)],
		}),
	)
	return planBase({
		deadlineTimestamp: protocolQuestionDeadline(snapshot, pool),
		definitionId: `trading.swap.${mode}`,
		ecosystem: 'trading',
		label: `Swap ${mode}`,
		maximumCleanupTransactionCount,
		metadata,
		postconditions: ['Swap event reserve values match stored pair reserves'],
		risk: 'medium',
		snapshot,
		steps,
	})
}

function metadataSwapDirection(metadata: OperationPlan['metadata']) {
	const direction = metadata['direction']
	if (direction === 'YES-to-NO') return true
	if (direction === 'NO-to-YES') return false
	return undefined
}

function buildSwapContinuation(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, mode: SwapMode) {
	if (context.continuationDisposition === 'cleanup-only') return shareApprovalCleanup(snapshot, context)
	const yesForNo = metadataSwapDirection(context.previousPlan.metadata)
	const principal = metadataPositiveAmount(context.previousPlan.metadata, mode === 'exact-input' ? 'inputAmount' : 'outputAmount')
	const bound = metadataPositiveAmount(context.previousPlan.metadata, mode === 'exact-input' ? 'minimumOutput' : 'maximumInput')
	const pair = metadataPair(snapshot, context.previousPlan.metadata)
	if (pair === undefined || yesForNo === undefined || principal === undefined || bound === undefined || !previousSwapActionMatches(snapshot, context, pair, mode, yesForNo, principal, bound)) return shareApprovalCleanup(snapshot, context)
	const approval = continuationShareApproval(context, pair.address)
	if (approval === 'cleanup-only') return shareApprovalCleanup(snapshot, context)
	return buildSwapPlan(snapshot, options, pair, mode, yesForNo, principal, bound, context.previousPlan.metadata, approval.confirmedApproval, approval.approvalStepId) ?? shareApprovalCleanup(snapshot, context)
}

function swappablePairShares(snapshot: EcosystemSnapshot, pair: PairSnapshot, options: PlanningOptions) {
	if (pair.status !== 0) return undefined
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (pool === undefined || shares === undefined || !poolLifecycleOpen(snapshot, pool, options, shareApproval(shares, pair.address, snapshot.wallet.address).length)) return undefined
	return { pool, shares }
}

function swapQuote(pair: PairSnapshot, shares: ShareInventory, mode: SwapMode, yesForNo: boolean, options: PlanningOptions) {
	const inputBalance = amount(yesForNo ? shares.yes : shares.no)
	const spend = inputSpend(options, cappedTradingSpend(inputBalance), inputBalance, 0n, MAXIMUM_TRADING_SPEND)
	const quote = mode === 'exact-input' ? quoteExactInput(pair, yesForNo, spend) : quoteExactOutput(pair, yesForNo, inputInteger(options, 'outputAmount', 1n, 1n))
	return { quote, spend }
}

type SwapCandidate = { maximumInput: bigint; pair: PairSnapshot; pool: PoolSnapshot; quote: bigint; spend: bigint; yesForNo: boolean }

function swapCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions, mode: SwapMode): SwapCandidate[] {
	return snapshot.pairs
		.filter(pair => inputMatches(options, 'pair', pair.address))
		.flatMap(pair => {
			const swappable = swappablePairShares(snapshot, pair, options)
			if (swappable === undefined) return []
			const { pool, shares } = swappable
			return [true, false]
				.filter(yesForNo => inputMatches(options, 'direction', swapDirection(yesForNo)))
				.flatMap(yesForNo => {
					const { quote, spend } = swapQuote(pair, shares, mode, yesForNo, options)
					if (quote === undefined || quote === 0n) return []
					const maximumInput = mode === 'exact-output' ? inputInteger(options, 'maximumInput', maximumAfterSlippage(quote), 1n) : spend
					if (maximumInput > spend) return []
					return [{ maximumInput, pair, pool, quote, spend, yesForNo }]
				})
		})
}

function buildSwapCandidatePlan(snapshot: EcosystemSnapshot, options: PlanningOptions, mode: SwapMode, candidate: SwapCandidate) {
	const { maximumInput, pair, pool, quote, spend, yesForNo } = candidate
	const direction = swapDirection(yesForNo)
	if (mode === 'exact-input') {
		const minimumOutput = inputInteger(options, 'minimumOutput', minimumAfterSlippage(quote), 1n, quote)
		return buildSwapPlan(snapshot, options, pair, mode, yesForNo, spend, minimumOutput, { direction, inputAmount: spend.toString(), minimumOutput: minimumOutput.toString(), pair: pair.address, pool: pool.address })
	}
	const outputAmount = inputInteger(options, 'outputAmount', 1n, 1n)
	return buildSwapPlan(snapshot, options, pair, mode, yesForNo, outputAmount, maximumInput, { direction, maximumInput: maximumInput.toString(), outputAmount: outputAmount.toString(), pair: pair.address, pool: pool.address })
}

export function swapDefinition(mode: SwapMode): OperationDefinition {
	const id = `trading.swap.${mode}`
	return {
		buildPlan(snapshot, options) {
			const candidate = choose(swapCandidates(snapshot, options, mode), mixSeed(options.seed, id))
			return candidate === undefined ? undefined : buildSwapCandidatePlan(snapshot, options, mode, candidate)
		},
		buildContinuationPlan(snapshot, options, context) {
			return buildSwapContinuation(snapshot, options, context, mode)
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductPair',
		description: `Trades wallet-owned directional shares through the pair's ${mode} path.`,
		discoveryInputs: ['pair status/reserves', 'share balances/approval'],
		ecosystem: 'trading',
		evaluate(snapshot, options) {
			const found = snapshot.pairs.some(pair => {
				const swappable = swappablePairShares(snapshot, pair, options)
				if (swappable === undefined) return false
				return [true, false].some(yesForNo => {
					const { quote, spend } = swapQuote(pair, swappable.shares, mode, yesForNo, options)
					return quote !== undefined && quote > 0n && (mode === 'exact-input' || maximumAfterSlippage(quote) <= spend)
				})
			})
			return eligible(found ? undefined : 'No open pair has tradable wallet shares')
		},
		id,
		label: `Swap ${mode}`,
		method: swapMethod(mode),
		risk: 'medium',
	}
}
