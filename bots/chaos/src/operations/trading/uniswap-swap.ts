import type { UniverseUniswapPoolSnapshot } from '../uniswap-types.ts'
import { chaosUniswapV3RouterAbi } from '../../contracts/uniswap-abi.ts'
import { GENESIS_UNISWAP_FEE } from '../../core/genesis-uniswap.ts'
import { inputMatches } from '../input-values.ts'
import { erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { allowance, erc20AllowanceEvidence, amount, choose, eligible, encodeStep, erc20WalletDebit, eventEvidence, mixSeed, optionAmount, planBase, planningDeadline, tokenInventory } from '../planning.ts'
import { openOracleCleanupPlan } from '../open-oracle/approvals.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationPlan, PlanningOptions } from '../types.ts'
import { metadataAddress, metadataPositiveAmount } from './continuations.ts'
import { MAXIMUM_TRADING_SPEND, minimumAfterSlippage, minimumOf } from './pricing.ts'

type Direction = 'rep-for-weth' | 'weth-for-rep'

function spend(snapshot: EcosystemSnapshot, options: PlanningOptions, pool: UniverseUniswapPoolSnapshot, direction: Direction) {
	const token = direction === 'rep-for-weth' ? pool.repToken : snapshot.deployments.weth
	const balance = amount(tokenInventory(snapshot, token)?.balance ?? '0')
	const reserve = direction === 'rep-for-weth' ? optionAmount(options, 'minimumRepReserveAttoRep', 0n) : 0n
	const maximum = optionAmount(options, direction === 'rep-for-weth' ? 'maxRepSpendAttoRep' : 'maxEthSpendAttoEth', MAXIMUM_TRADING_SPEND)
	const poolBalance = amount((direction === 'rep-for-weth' ? pool.repBalanceAttoRep : pool.wethBalanceAttoEth) ?? '0')
	return minimumOf([balance > reserve ? balance - reserve : 0n, maximum, MAXIMUM_TRADING_SPEND, poolBalance / 100n])
}

function outputMinimum(snapshot: EcosystemSnapshot, pool: UniverseUniswapPoolSnapshot, direction: Direction, amountIn: bigint) {
	const sqrtPrice = amount(pool.sqrtPriceX96 ?? '0')
	if (sqrtPrice === 0n) return 0n
	const tokenIn = direction === 'rep-for-weth' ? pool.repToken : snapshot.deployments.weth
	const zeroForOne = tokenIn.toLowerCase() < (direction === 'rep-for-weth' ? snapshot.deployments.weth : pool.repToken).toLowerCase()
	const net = (amountIn * BigInt(1_000_000 - GENESIS_UNISWAP_FEE)) / 1_000_000n
	const square = sqrtPrice * sqrtPrice
	return minimumAfterSlippage(zeroForOne ? (net * square) / (1n << 192n) : (net * (1n << 192n)) / square)
}

function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions, direction: Direction) {
	if (snapshot.universeUniswap?.routerAuthenticated !== true) return []
	return snapshot.universeUniswap.pools.filter(pool => pool.pool !== undefined && pool.initialized && amount(pool.liquidity) > 0n && inputMatches(options, 'universeId', pool.universeId) && outputMinimum(snapshot, pool, direction, spend(snapshot, options, pool, direction)) > 0n)
}

function swapPlan(snapshot: EcosystemSnapshot, definition: OperationDefinition, pool: UniverseUniswapPoolSnapshot, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, minimum: bigint, deadline: bigint, metadata: OperationPlan['metadata']) {
	const router = snapshot.universeUniswap?.router
	if (router === undefined || snapshot.universeUniswap?.routerAuthenticated !== true || pool.pool === undefined || deadline <= BigInt(snapshot.anchor.timestamp)) return undefined
	const steps = []
	if (allowance(tokenInventory(snapshot, tokenIn), router) < amountIn)
		steps.push(encodeStep({ abi: erc20Abi, args: [router, amountIn], evidence: [erc20AllowanceEvidence(tokenIn, snapshot.wallet.address, router, amountIn)], functionName: 'approve', id: 'approve-uniswap-swap', label: 'Approve Uniswap swap', to: tokenIn, walletAssetDebits: [] }))
	steps.push(
		encodeStep({
			abi: chaosUniswapV3RouterAbi,
			args: [{ tokenIn, tokenOut, fee: GENESIS_UNISWAP_FEE, recipient: snapshot.wallet.address, deadline, amountIn, amountOutMinimum: minimum, sqrtPriceLimitX96: 0n }],
			functionName: 'exactInputSingle',
			id: 'swap-uniswap',
			label: definition.label,
			to: router,
			evidence: [eventEvidence(pool.pool, 'Swap(address,address,int256,int256,uint160,uint128,int24)'), { kind: 'balance-change', account: snapshot.wallet.address, asset: tokenOut, direction: 'increase' }],
			walletAssetDebits: [erc20WalletDebit(tokenIn, amountIn, tokenIn === pool.repToken ? 'rep' : 'weth')],
		}),
	)
	return planBase({ definitionId: definition.id, ecosystem: 'trading', label: definition.label, risk: 'medium', snapshot, metadata, deadlineTimestamp: deadline.toString(), maximumCleanupTransactionCount: 1, postconditions: ['The signer receives at least the bounded minimum output before the deadline'], steps })
}

export function uniswapSwapDefinition(direction: Direction): OperationDefinition {
	const definition: OperationDefinition = {
		id: `trading.uniswap.swap-${direction}`,
		label: direction === 'rep-for-weth' ? 'Swap REP for WETH on Uniswap' : 'Swap WETH for REP on Uniswap',
		classification: 'selectable',
		contract: 'UniswapV3SwapRouter',
		method: 'exactInputSingle',
		ecosystem: 'trading',
		risk: 'medium',
		description: 'Swaps bounded REP/WETH through the authenticated V3 router with a minimum output, deadline and wallet recipient.',
		discoveryInputs: ['authenticated REP/WETH pool price, balances, router bindings and wallet allowances'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options, direction).length > 0 ? undefined : 'No funded REP/WETH pool has a bounded executable swap candidate'),
		buildPlan(snapshot, options) {
			const pool = choose(candidates(snapshot, options, direction), mixSeed(options.seed, definition.id))
			const router = snapshot.universeUniswap?.router
			if (pool?.pool === undefined || router === undefined) return undefined
			const amountIn = spend(snapshot, options, pool, direction)
			const minimum = outputMinimum(snapshot, pool, direction, amountIn)
			const deadline = planningDeadline(snapshot, options, mixSeed(options.seed, `${definition.id}:deadline`))
			if (deadline === undefined) return undefined
			const tokenIn = direction === 'rep-for-weth' ? pool.repToken : snapshot.deployments.weth
			const tokenOut = direction === 'rep-for-weth' ? snapshot.deployments.weth : pool.repToken
			return swapPlan(snapshot, definition, pool, tokenIn, tokenOut, amountIn, minimum, BigInt(deadline), { pool: pool.pool, universeId: pool.universeId, router, tokenIn, tokenOut, amountIn: amountIn.toString(), minimumOutput: minimum.toString(), deadline: deadline.toString() })
		},
		buildContinuationPlan(snapshot, options, context) {
			const { metadata } = context.previousPlan
			const router = metadataAddress(metadata, 'router')
			const tokenIn = metadataAddress(metadata, 'tokenIn')
			const tokenOut = metadataAddress(metadata, 'tokenOut')
			const amountIn = metadataPositiveAmount(metadata, 'amountIn')
			const minimum = metadataPositiveAmount(metadata, 'minimumOutput')
			const deadline = metadataPositiveAmount(metadata, 'deadline')
			if (router === undefined || tokenIn === undefined || tokenOut === undefined || amountIn === undefined || minimum === undefined || deadline === undefined) return undefined
			const cleanup = () => {
				const plan = openOracleCleanupPlan(snapshot, context, [{ id: 'approve-uniswap-swap', token: tokenIn, spender: router, required: amountIn }], 'Revoke Uniswap swap approval', 'medium')
				return plan === undefined ? undefined : { ...plan, ecosystem: 'trading' as const }
			}
			if (context.continuationDisposition === 'cleanup-only' || context.confirmedStepIds.includes('swap-uniswap')) return cleanup()
			const pool = snapshot.universeUniswap?.pools.find(candidate => candidate.pool === metadata['pool'] && candidate.universeId === metadata['universeId'])
			if (
				pool === undefined ||
				!pool.initialized ||
				amount(pool.liquidity) === 0n ||
				router !== snapshot.universeUniswap?.router ||
				tokenIn !== (direction === 'rep-for-weth' ? pool.repToken : snapshot.deployments.weth) ||
				tokenOut !== (direction === 'rep-for-weth' ? snapshot.deployments.weth : pool.repToken) ||
				spend(snapshot, options, pool, direction) < amountIn
			)
				return cleanup()
			return swapPlan(snapshot, definition, pool, tokenIn, tokenOut, amountIn, minimum, deadline, metadata) ?? cleanup()
		},
	}
	return definition
}
