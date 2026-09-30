import { twoWayConstantProductRouterAbi } from '@zoltar/bot-shared/contracts/abi'
import type { AbiValue, Address } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { ethSpend } from '../input-funding.ts'
import { inputInteger, inputMatches } from '../input-values.ts'
import { amount, choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'
import { canCreateCompleteSet, projectedEthToShares } from '../pool-economics.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, PairSnapshot, PlanningOptions, PoolSnapshot } from '../types.ts'
import { ethRouterDeadline, ethRouterOraclePriceIsSafe, poolForPair, poolLifecycleOpen } from './pool-state.ts'
import { maximumAfterSlippage, minimumAfterSlippage, proportionalLiquidity, quoteExactInput } from './pricing.ts'

type RouterEthKind = 'create-and-initialize' | 'initialize' | 'add' | 'enter'

const MINIMUM_INITIAL_LIQUIDITY = 1_000n

const routerEthMinimumSpend = (kind: RouterEthKind) => (kind === 'create-and-initialize' || kind === 'initialize' ? 2_002n : 1n)

const routerEthPoolReady = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, spend: bigint) => poolLifecycleOpen(snapshot, pool, options) && ethRouterOraclePriceIsSafe(snapshot, pool, options) && canCreateCompleteSet(pool, spend)

function unpairedPoolReady(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, spend: bigint, paired: ReadonlySet<string>) {
	return !paired.has(pool.address.toLowerCase()) && routerEthPoolReady(snapshot, pool, options, spend) && projectedEthToShares(pool, spend) > MINIMUM_INITIAL_LIQUIDITY
}

function routerEthPairReady(snapshot: EcosystemSnapshot, pair: PairSnapshot, kind: Exclude<RouterEthKind, 'create-and-initialize'>, options: PlanningOptions, spend: bigint) {
	if (pair.status !== (kind === 'initialize' ? 6 : 0)) return false
	const pool = poolForPair(snapshot, pair)
	if (pool === undefined || !routerEthPoolReady(snapshot, pool, options, spend)) return false
	const minted = projectedEthToShares(pool, spend)
	if (kind === 'initialize') return minted > MINIMUM_INITIAL_LIQUIDITY && amount(pair.effectiveYesReserve) === 0n && amount(pair.effectiveNoReserve) === 0n
	if (kind === 'add') return proportionalLiquidity(pair, minted, minted) !== undefined
	return minted > 0n && [true, false].some(yesForNo => quoteExactInput(pair, yesForNo, minted) > 0n)
}

/** Picks the pool (create-and-initialize) or pair (other kinds) the router workflow targets. */
function routerEthTarget(snapshot: EcosystemSnapshot, kind: RouterEthKind, options: PlanningOptions, id: string, spend: bigint) {
	if (kind === 'create-and-initialize') {
		const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
		const pool = choose(
			snapshot.pools.filter(candidate => inputMatches(options, 'target', candidate.address) && unpairedPoolReady(snapshot, candidate, options, spend, paired)),
			mixSeed(options.seed, id),
		)
		return pool === undefined ? undefined : { pair: undefined, pool, target: pool.address }
	}
	const pair = choose(
		snapshot.pairs.filter(candidate => {
			if (!inputMatches(options, 'target', candidate.address)) return false
			if (options.genesisInitializationTarget?.pair !== undefined && !sameAddress(candidate.address, options.genesisInitializationTarget.pair)) return false
			return routerEthPairReady(snapshot, candidate, kind, options, spend)
		}),
		mixSeed(options.seed, id),
	)
	const pool = pair === undefined ? undefined : poolForPair(snapshot, pair)
	return pair === undefined || pool === undefined ? undefined : { pair, pool, target: pair.address }
}

/** Router call arguments and evidence for one ETH-funded workflow, or `undefined` when the pair cannot quote it. */
function routerEthCall(snapshot: EcosystemSnapshot, kind: RouterEthKind, options: PlanningOptions, target: Address, pair: PairSnapshot | undefined, minted: bigint, longOutcome: number | undefined, deadline: bigint): { args: readonly AbiValue[]; evidence: OperationEvidence[] } | undefined {
	if (kind === 'create-and-initialize' || kind === 'initialize') {
		const liquidity = minted - MINIMUM_INITIAL_LIQUIDITY
		return {
			args: [target, 5_000n, inputInteger(options, 'minimumLiquidity', minimumAfterSlippage(liquidity), 1n, liquidity), snapshot.wallet.address, deadline],
			evidence: kind === 'create-and-initialize' ? [eventEvidence(snapshot.deployments.tradingFactory, 'PairCreated(address,address,uint248,address,uint256)')] : [eventEvidence(target, 'LiquidityInitialized(address,address,uint256,uint256,uint256)')],
		}
	}
	if (kind === 'add') {
		const quoted = pair === undefined ? undefined : proportionalLiquidity(pair, minted, minted)
		if (quoted === undefined) return undefined
		return {
			args: [target, maximumAfterSlippage(quoted.yesUsed), maximumAfterSlippage(quoted.noUsed), inputInteger(options, 'minimumLiquidity', minimumAfterSlippage(quoted.liquidity), 1n, quoted.liquidity), snapshot.wallet.address, deadline],
			evidence: [eventEvidence(target, 'LiquidityAdded(address,address,uint256,uint256,uint256)')],
		}
	}
	if (pair === undefined || longOutcome === undefined) return undefined
	const expectedLong = minted + quoteExactInput(pair, longOutcome === 2, minted)
	return {
		args: [target, longOutcome, inputInteger(options, 'minimumOutput', minimumAfterSlippage(expectedLong), 1n, expectedLong), snapshot.wallet.address, deadline],
		evidence: [eventEvidence(target, 'Swap(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256)')],
	}
}

function buildRouterEthPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, kind: RouterEthKind, id: string, method: string) {
	const spend = ethSpend(snapshot, options, id, routerEthMinimumSpend(kind))
	if (spend === 0n) return undefined
	const selected = routerEthTarget(snapshot, kind, options, id, spend)
	if (selected === undefined) return undefined
	const { pair, pool, target } = selected
	const deadline = ethRouterDeadline(snapshot, pool, options, mixSeed(options.seed, `${id}:deadline`))
	if (deadline === undefined) return undefined
	const minted = projectedEthToShares(pool, spend)
	const enterOutcomes = pair === undefined ? [] : [1, 2].filter(outcome => inputMatches(options, 'longOutcome', String(outcome)) && quoteExactInput(pair, outcome === 2, minted) > 0n)
	const longOutcome = kind === 'enter' ? choose(enterOutcomes, mixSeed(options.seed, 'long-outcome')) : undefined
	if (kind === 'enter' && longOutcome === undefined) return undefined
	const call = routerEthCall(snapshot, kind, options, target, pair, minted, longOutcome, BigInt(deadline))
	if (call === undefined) return undefined
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: id,
		ecosystem: 'trading',
		label: `Router ${kind}`,
		metadata: { target },
		postconditions: [kind === 'enter' ? 'Wallet receives invalid insurance and directional long shares' : 'Wallet LP balance increases and unused shares return to the wallet'],
		risk: 'medium',
		snapshot,
		steps: [encodeStep({ abi: twoWayConstantProductRouterAbi, args: call.args, evidence: call.evidence, functionName: method, id: method, label: `Router ${kind}`, to: snapshot.deployments.tradingRouter, value: spend })],
	})
}

export function routerEthDefinition(kind: RouterEthKind): OperationDefinition {
	const details = {
		add: ['trading.liquidity.add-eth', 'addLiquidityWithEth'],
		'create-and-initialize': ['trading.pair.create-and-initialize', 'createPairAndInitializeWithEth'],
		enter: ['trading.position.enter', 'enterPosition'],
		initialize: ['trading.pair.initialize-eth', 'initializeWithEth'],
	} as const
	const [id, method] = details[kind]
	return {
		requiredTradingDeployment: ['factory', 'router'],
		buildPlan(snapshot, options) {
			return buildRouterEthPlan(snapshot, options, kind, id, method)
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductRouter',
		description: `Executes the router's ${kind} ETH-funded workflow with a fresh deadline.`,
		discoveryInputs: ['pair/pool lifecycle', 'ETH reserve', 'factory mapping'],
		ecosystem: 'trading',
		evaluate(snapshot, options) {
			const spend = ethSpend(snapshot, options, id, routerEthMinimumSpend(kind))
			const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
			const target = kind === 'create-and-initialize' ? snapshot.pools.some(pool => unpairedPoolReady(snapshot, pool, options, spend, paired)) : snapshot.pairs.some(pair => routerEthPairReady(snapshot, pair, kind, options, spend))
			return eligible(target ? undefined : 'No pair/pool is in the required lifecycle state', spend === 0n ? 'No spendable ETH above reserve' : undefined)
		},
		id,
		label: `Router ${kind}`,
		method,
		risk: 'medium',
	}
}
