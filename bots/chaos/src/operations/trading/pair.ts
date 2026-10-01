import { twoWayConstantProductFactoryAbi, twoWayConstantProductPairAbi } from '@zoltar/bot-shared/contracts/abi'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { inputInteger, inputMatches, inputSpend } from '../input-values.ts'
import { amount, choose, eligible, encodeStep, erc1155WalletDebit, eventEvidence, mixSeed, planBase } from '../planning.ts'
import { shareTokenId, walletShares } from '../statoblast/planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationPlan, PairSnapshot, PlanningOptions } from '../types.ts'
import { metadataPair, metadataPositiveAmount, previousDirectActionMatches } from './continuations.ts'
import { poolForPair, poolLifecycleOpen, protocolQuestionDeadline } from './pool-state.ts'
import { cappedTradingSpend, MAXIMUM_TRADING_SPEND, minimumAfterSlippage, proportionalLiquidity } from './pricing.ts'
import { continuationShareApproval, shareApproval, shareApprovalCleanup } from './share-approvals.ts'

type DirectLiquidityKind = 'initialize' | 'add'
type DirectLiquidityMethod = 'addLiquidity' | 'initialize'

const MINIMUM_INITIAL_LIQUIDITY = 1_000n

export const createPair: OperationDefinition = {
	requiredTradingDeployment: ['factory'],
	buildPlan(snapshot, options) {
		const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
		const pool = choose(
			snapshot.pools.filter(candidate => !paired.has(candidate.address.toLowerCase()) && (options.genesisInitializationTarget?.pool === undefined || sameAddress(candidate.address, options.genesisInitializationTarget.pool))),
			mixSeed(options.seed, createPair.id),
		)
		if (pool === undefined) return undefined
		return planBase({
			definitionId: createPair.id,
			ecosystem: 'trading',
			label: createPair.label,
			metadata: { pool: pool.address },
			postconditions: ['Factory getPair(pool) returns the emitted pair'],
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: twoWayConstantProductFactoryAbi,
					args: [pool.address],
					evidence: [
						{
							abi: 'function getPair(address pool) view returns (address)',
							args: [pool.address],
							contract: snapshot.deployments.tradingFactory,
							expected: '0',
							functionName: 'getPair',
							kind: 'storage-postcondition',
							relation: 'greater-than',
						},
					],
					functionName: 'createPair',
					id: 'create-pair',
					label: 'Create pair',
					to: snapshot.deployments.tradingFactory,
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductFactory',
	description: 'Permissionlessly deploys the canonical pair for an unpaired security pool.',
	discoveryInputs: ['security pools', 'factory pair mapping'],
	ecosystem: 'trading',
	evaluate(snapshot) {
		const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
		return eligible(snapshot.pools.some(pool => !paired.has(pool.address.toLowerCase())) ? undefined : 'Every discovered pool already has a pair')
	},
	id: 'trading.pair.create',
	label: 'Create trading pair',
	method: 'createPair',
	risk: 'low',
}

function directLiquidityReady(snapshot: EcosystemSnapshot, pair: PairSnapshot, kind: DirectLiquidityKind, options: PlanningOptions) {
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (pool === undefined || shares === undefined) return false
	const prerequisiteCount = shareApproval(shares, pair.address, snapshot.wallet.address).length
	if (!poolLifecycleOpen(snapshot, pool, options, prerequisiteCount)) return false
	const spend = cappedTradingSpend(amount(shares.yes) < amount(shares.no) ? amount(shares.yes) : amount(shares.no))
	if (kind === 'initialize') return pair.status === 6 && amount(pair.effectiveYesReserve) === 0n && amount(pair.effectiveNoReserve) === 0n && spend > MINIMUM_INITIAL_LIQUIDITY
	return pair.status === 0 && proportionalLiquidity(pair, spend, spend) !== undefined
}

/** Liquidity the pair would mint for `shareAmount` of each side plus the event proving it, or `undefined` when the pair is not in the required state. */
function expectedDirectLiquidity(pair: PairSnapshot, kind: DirectLiquidityKind, shareAmount: bigint) {
	if (kind === 'initialize') {
		if (pair.status !== 6 || amount(pair.effectiveYesReserve) !== 0n || amount(pair.effectiveNoReserve) !== 0n || shareAmount <= MINIMUM_INITIAL_LIQUIDITY) return undefined
		return { expectedLiquidity: shareAmount - MINIMUM_INITIAL_LIQUIDITY, signature: 'LiquidityInitialized(address,address,uint256,uint256,uint256)' }
	}
	if (pair.status !== 0) return undefined
	return { expectedLiquidity: proportionalLiquidity(pair, shareAmount, shareAmount)?.liquidity, signature: 'LiquidityAdded(address,address,uint256,uint256,uint256)' }
}

function buildDirectShareLiquidityPlan(
	snapshot: EcosystemSnapshot,
	options: PlanningOptions,
	pair: PairSnapshot,
	kind: DirectLiquidityKind,
	id: string,
	method: DirectLiquidityMethod,
	shareAmount: bigint,
	minimumLiquidity: bigint,
	metadata: OperationPlan['metadata'],
	confirmedApproval = false,
	approvalStepId?: string,
) {
	if (shareAmount > MAXIMUM_TRADING_SPEND) return undefined
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : walletShares(snapshot, pool)
	if (pool === undefined || shares === undefined || amount(shares.yes) < shareAmount || amount(shares.no) < shareAmount) return undefined
	const steps = shareApproval(shares, pair.address, snapshot.wallet.address, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	if (!poolLifecycleOpen(snapshot, pool, options, steps.length)) return undefined
	const expected = expectedDirectLiquidity(pair, kind, shareAmount)
	if (expected?.expectedLiquidity === undefined || expected.expectedLiquidity < minimumLiquidity) return undefined
	steps.push(
		encodeStep({
			abi: twoWayConstantProductPairAbi,
			args: [shareAmount, shareAmount, minimumLiquidity, snapshot.wallet.address],
			evidence: [eventEvidence(pair.address, expected.signature)],
			functionName: method,
			id: method,
			label: `${kind} direct liquidity`,
			to: pair.address,
			walletAssetDebits: [erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 1), shareAmount), erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 2), shareAmount)],
		}),
	)
	return planBase({
		deadlineTimestamp: protocolQuestionDeadline(snapshot, pool),
		definitionId: id,
		ecosystem: 'trading',
		label: `${kind} share liquidity`,
		maximumCleanupTransactionCount,
		metadata,
		postconditions: ['Pair reserves and wallet LP balance change consistently'],
		risk: 'medium',
		snapshot,
		steps,
	})
}

function buildDirectShareLiquidityContinuation(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, kind: DirectLiquidityKind, id: string, method: DirectLiquidityMethod) {
	if (context.continuationDisposition === 'cleanup-only') return shareApprovalCleanup(snapshot, context)
	const shareAmount = metadataPositiveAmount(context.previousPlan.metadata, 'shareAmount')
	const minimumLiquidity = metadataPositiveAmount(context.previousPlan.metadata, 'minimumLiquidity')
	const pair = metadataPair(snapshot, context.previousPlan.metadata)
	if (pair === undefined || shareAmount === undefined || minimumLiquidity === undefined || !previousDirectActionMatches(snapshot, context, pair, method, shareAmount, minimumLiquidity)) return shareApprovalCleanup(snapshot, context)
	const approval = continuationShareApproval(context, pair.address)
	if (approval === 'cleanup-only') return shareApprovalCleanup(snapshot, context)
	return buildDirectShareLiquidityPlan(snapshot, options, pair, kind, id, method, shareAmount, minimumLiquidity, context.previousPlan.metadata, approval.confirmedApproval, approval.approvalStepId) ?? shareApprovalCleanup(snapshot, context)
}

export function directLiquidity(kind: DirectLiquidityKind): OperationDefinition {
	const details = {
		add: ['trading.liquidity.add-shares', 'addLiquidity'],
		initialize: ['trading.pair.initialize-shares', 'initialize'],
	} as const
	const [id, method] = details[kind]
	return {
		buildPlan(snapshot, options) {
			const pair = choose(
				snapshot.pairs.filter(candidate => inputMatches(options, 'pair', candidate.address)).filter(candidate => directLiquidityReady(snapshot, candidate, kind, options)),
				mixSeed(options.seed, id),
			)
			if (pair === undefined) return undefined
			const pool = poolForPair(snapshot, pair)
			if (pool === undefined) return undefined
			const shares = walletShares(snapshot, pool)
			if (shares === undefined) return undefined
			const available = amount(shares.yes) < amount(shares.no) ? amount(shares.yes) : amount(shares.no)
			const shareAmount = inputSpend(options, cappedTradingSpend(available), available, 0n, MAXIMUM_TRADING_SPEND)
			if (shareAmount === 0n) return undefined
			const expectedLiquidity = kind === 'initialize' ? shareAmount - MINIMUM_INITIAL_LIQUIDITY : proportionalLiquidity(pair, shareAmount, shareAmount)?.liquidity
			if (expectedLiquidity === undefined || expectedLiquidity <= 0n) return undefined
			const minimumLiquidity = inputInteger(options, 'minimumLiquidity', minimumAfterSlippage(expectedLiquidity), 1n, expectedLiquidity)
			return buildDirectShareLiquidityPlan(snapshot, options, pair, kind, id, method, shareAmount, minimumLiquidity, { minimumLiquidity: minimumLiquidity.toString(), pair: pair.address, pool: pool.address, shareAmount: shareAmount.toString() })
		},
		buildContinuationPlan(snapshot, options, context) {
			return buildDirectShareLiquidityContinuation(snapshot, options, context, kind, id, method)
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductPair',
		description: `${kind}s pair liquidity using wallet-owned shares or LP tokens.`,
		discoveryInputs: ['pair status/reserves', 'share balances/approvals', 'LP balance'],
		ecosystem: 'trading',
		evaluate(snapshot, options) {
			const possible = snapshot.pairs.some(pair => directLiquidityReady(snapshot, pair, kind, options))
			return eligible(possible ? undefined : `No pair has inventory eligible to ${kind}`)
		},
		id,
		label: `${kind} share liquidity`,
		method,
		risk: 'medium',
	}
}

const pairHasExcessBalances = (pair: PairSnapshot) => amount(pair.totalSupply) > 0n && (amount(pair.effectiveYesReserve) !== amount(pair.yesReserve) || amount(pair.effectiveNoReserve) !== amount(pair.noReserve))

export const syncPair: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pair = choose(snapshot.pairs.filter(pairHasExcessBalances), mixSeed(options.seed, syncPair.id))
		if (pair === undefined) return undefined
		return planBase({
			definitionId: syncPair.id,
			ecosystem: 'trading',
			label: syncPair.label,
			metadata: { pair: pair.address },
			postconditions: ['Stored reserves equal current pair share balances'],
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: twoWayConstantProductPairAbi, evidence: [eventEvidence(pair.address, 'Sync(uint256,uint256)')], functionName: 'sync', id: 'sync', label: 'Synchronize pair', to: pair.address })],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductPair',
	description: 'Permissionlessly synchronizes stored reserves with ERC-1155 balances.',
	discoveryInputs: ['trading pairs'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(snapshot.pairs.some(pairHasExcessBalances) ? undefined : 'No initialized pair has excess balances to synchronize'),
	id: 'trading.pair.sync',
	label: 'Synchronize pair',
	method: 'sync',
	risk: 'low',
}
