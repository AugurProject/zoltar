import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { erc1155Abi, shareTokenAbi, tradingFactoryAbi, tradingPairAbi, tradingRouterAbi } from '../contracts/abi.ts'
import { amount, cappedSpend, choose, disabled, eligible, encodeStep, erc1155WalletDebit, erc20WalletDebit, eventEvidence, mixSeed, optionAmount, planBase, randomDeadline } from './planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, OperationStep, OperationWalletAssetDebit, PairSnapshot, PlanningOptions, PoolSnapshot, ShareInventory } from './types.ts'
import { validForkOutcomeRoutes } from './fork-outcomes.ts'
import { canCreateCompleteSet, projectedEthToShares, sharesToProjectedEth } from './pool-economics.ts'

const shareForPool = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => snapshot.wallet.shares.find(share => share.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && share.universeId === pool.universeId)
const poolForPair = (snapshot: EcosystemSnapshot, pair: PairSnapshot) => snapshot.pools.find(pool => pool.address.toLowerCase() === pair.pool.toLowerCase())
const shareTokenId = (universeId: string, outcome: number) => (amount(universeId) << 8n) | BigInt(outcome)
const TRANSACTION_VALIDITY_BLOCKS = 25n
const EXECUTOR_FINALITY_BLOCKS = 12n
const CONSERVATIVE_BLOCK_SECONDS = 15n
const BPS_DENOMINATOR = 10_000n
const TRADING_SLIPPAGE_BPS = 100n
const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n

function minimumAfterSlippage(value: bigint) {
	if (value <= 0n) return 0n
	const bounded = (value * (BPS_DENOMINATOR - TRADING_SLIPPAGE_BPS)) / BPS_DENOMINATOR
	return bounded > 0n ? bounded : 1n
}

function maximumAfterSlippage(value: bigint) {
	if (value <= 0n) return 0n
	return (value * (BPS_DENOMINATOR + TRADING_SLIPPAGE_BPS) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

function shareMigrationPoolReady(pool: PoolSnapshot, forkTime: string) {
	if (pool.systemState === 1) return true
	if (pool.systemState !== 0 || pool.forkActivationTime !== '0') return false
	return pool.escalationGame === zeroAddress || pool.questionOutcome === 3 || amount(pool.escalationGameEndTime) >= amount(forkTime)
}

function poolQuestion(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	return snapshot.questions.find(candidate => candidate.id === pool.questionId)
}

function lifecycleSafetySeconds(prerequisiteCount: number) {
	return (TRANSACTION_VALIDITY_BLOCKS + BigInt(prerequisiteCount) * (TRANSACTION_VALIDITY_BLOCKS + EXECUTOR_FINALITY_BLOCKS)) * CONSERVATIVE_BLOCK_SECONDS
}

function poolLifecycleOpen(snapshot: EcosystemSnapshot, pool: PoolSnapshot, prerequisiteCount = 0) {
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	const question = poolQuestion(snapshot, pool)
	return pool.systemState === 0 && !pool.awaitingForkContinuation && pool.questionOutcome === 3 && universe?.forkTime === '0' && question !== undefined && amount(snapshot.anchor.timestamp) + lifecycleSafetySeconds(prerequisiteCount) < amount(question.endTime)
}

function questionDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, seed: number) {
	const question = poolQuestion(snapshot, pool)
	if (question === undefined) return undefined
	const randomized = amount(randomDeadline(snapshot, seed))
	const protocolLastSecond = amount(question.endTime) - 1n
	return (randomized < protocolLastSecond ? randomized : protocolLastSecond).toString()
}

function protocolQuestionDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	const question = poolQuestion(snapshot, pool)
	return question === undefined ? undefined : (amount(question.endTime) - 1n).toString()
}

function ceilDivide(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) return undefined
	return (numerator + denominator - 1n) / denominator
}

function quoteExactInput(pair: PairSnapshot, yesForNo: boolean, input: bigint) {
	const reserveIn = amount(yesForNo ? pair.effectiveYesReserve : pair.effectiveNoReserve)
	const reserveOut = amount(yesForNo ? pair.effectiveNoReserve : pair.effectiveYesReserve)
	if (input <= 0n || reserveIn <= 0n || reserveOut <= 0n || pair.feeBps < 0 || pair.feeBps >= 10_000) return 0n
	const netInput = (input * BigInt(10_000 - pair.feeBps)) / 10_000n
	if (netInput === 0n) return 0n
	return (reserveOut * netInput) / (reserveIn + netInput)
}

function quoteExactOutput(pair: PairSnapshot, yesForNo: boolean, output: bigint) {
	const reserveIn = amount(yesForNo ? pair.effectiveYesReserve : pair.effectiveNoReserve)
	const reserveOut = amount(yesForNo ? pair.effectiveNoReserve : pair.effectiveYesReserve)
	if (output <= 0n || output >= reserveOut || reserveIn <= 0n || pair.feeBps < 0 || pair.feeBps >= 10_000) return undefined
	const netInput = ceilDivide(reserveIn * output, reserveOut - output)
	return netInput === undefined ? undefined : ceilDivide(netInput * 10_000n, BigInt(10_000 - pair.feeBps))
}

function removableLiquidity(pair: PairSnapshot) {
	const totalSupply = amount(pair.totalSupply)
	const liquidity = amount(pair.walletLiquidity) > 10n ** 15n ? 10n ** 15n : amount(pair.walletLiquidity)
	if (liquidity === 0n || totalSupply === 0n) return 0n
	if ((amount(pair.effectiveYesReserve) * liquidity) / totalSupply === 0n || (amount(pair.effectiveNoReserve) * liquidity) / totalSupply === 0n) return 0n
	return liquidity
}

function removableLiquidityQuote(pair: PairSnapshot, liquidity: bigint) {
	const totalSupply = amount(pair.totalSupply)
	if (liquidity <= 0n || totalSupply <= 0n) return undefined
	const yesOut = (amount(pair.effectiveYesReserve) * liquidity) / totalSupply
	const noOut = (amount(pair.effectiveNoReserve) * liquidity) / totalSupply
	return yesOut > 0n && noOut > 0n ? { noOut, yesOut } : undefined
}

function proportionalLiquidity(pair: PairSnapshot, maxYes: bigint, maxNo: bigint) {
	const yesReserve = amount(pair.effectiveYesReserve)
	const noReserve = amount(pair.effectiveNoReserve)
	const totalSupply = amount(pair.totalSupply)
	if (yesReserve === 0n || noReserve === 0n || totalSupply === 0n || maxYes === 0n || maxNo === 0n) return undefined
	const [yesUsed, noUsed] = maxYes * noReserve <= maxNo * yesReserve ? [maxYes, (maxYes * noReserve) / yesReserve] : [(maxNo * yesReserve) / noReserve, maxNo]
	if (yesUsed === 0n || noUsed === 0n) return undefined
	const yesLiquidity = (yesUsed * totalSupply) / yesReserve
	const noLiquidity = (noUsed * totalSupply) / noReserve
	const liquidity = yesLiquidity < noLiquidity ? yesLiquidity : noLiquidity
	return liquidity === 0n ? undefined : { liquidity, noUsed, yesUsed }
}

function ethToShares(pool: PoolSnapshot, attoEth: bigint) {
	return projectedEthToShares(pool, attoEth)
}

function sharesToEth(pool: PoolSnapshot, attoShares: bigint) {
	return sharesToProjectedEth(pool, attoShares)
}

function minimumPositivePayoutShares(pool: PoolSnapshot) {
	const supply = amount(pool.shareTokenSupplyAttoShares)
	const collateral = amount(pool.projectedSettlementCollateralAttoEth)
	return supply === 0n || collateral === 0n ? undefined : ceilDivide(supply, collateral)
}

function ethSpend(snapshot: EcosystemSnapshot, options: PlanningOptions, salt: string, minimum = 1n) {
	return cappedSpend(amount(snapshot.wallet.ethBalanceAttoEth), optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n), optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n), mixSeed(options.seed, salt), minimum)
}

type DirectLiquidityKind = 'initialize' | 'add' | 'remove'

function directLiquidityReady(snapshot: EcosystemSnapshot, pair: PairSnapshot, kind: DirectLiquidityKind) {
	if (kind === 'remove') return removableLiquidity(pair) > 0n
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
	if (pool === undefined || shares === undefined) return false
	const prerequisiteCount = shareApproval(shares, pair.address, snapshot.wallet.address).length
	if (!poolLifecycleOpen(snapshot, pool, prerequisiteCount)) return false
	const available = amount(shares.yes) < amount(shares.no) ? amount(shares.yes) : amount(shares.no)
	const spend = available > 10n ** 15n ? 10n ** 15n : available
	if (kind === 'initialize') return pair.status === 6 && amount(pair.effectiveYesReserve) === 0n && amount(pair.effectiveNoReserve) === 0n && spend > 1_000n
	return pair.status === 0 && proportionalLiquidity(pair, spend, spend) !== undefined
}

function shareApproval(inventory: ShareInventory, operator: `0x${string}`, owner: `0x${string}`) {
	const approved = Object.entries(inventory.isApprovedForAll).find(([address]) => address.toLowerCase() === operator.toLowerCase())?.[1] ?? false
	if (approved) return []
	return [
		encodeStep({
			abi: erc1155Abi,
			args: [operator, true],
			evidence: [{ abi: 'function isApprovedForAll(address account, address operator) view returns (bool)', args: [owner, operator], contract: inventory.shareToken, expected: 'true', functionName: 'isApprovedForAll', kind: 'storage-postcondition', relation: 'equals' }],
			functionName: 'setApprovalForAll',
			id: `approve-shares-${operator}`,
			label: 'Approve outcome shares',
			to: inventory.shareToken,
		}),
	]
}

const createPair: OperationDefinition = {
	buildPlan(snapshot, options) {
		const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
		const pool = choose(
			snapshot.pools.filter(candidate => !paired.has(candidate.address.toLowerCase())),
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
					abi: tradingFactoryAbi,
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

function directLiquidity(kind: DirectLiquidityKind): OperationDefinition {
	const details = {
		add: ['trading.liquidity.add-shares', 'addLiquidity'],
		initialize: ['trading.pair.initialize-shares', 'initialize'],
		remove: ['trading.liquidity.remove-shares', 'removeLiquidity'],
	} as const
	const [id, method] = details[kind]
	return {
		buildPlan(snapshot, options) {
			const pair = choose(
				snapshot.pairs.filter(candidate => directLiquidityReady(snapshot, candidate, kind)),
				mixSeed(options.seed, id),
			)
			if (pair === undefined) return undefined
			const pool = poolForPair(snapshot, pair)
			if (pool === undefined) return undefined
			let steps: OperationStep[] = []
			let args: readonly unknown[]
			let walletAssetDebits: OperationWalletAssetDebit[] = []
			if (kind === 'remove') {
				const liquidity = removableLiquidity(pair)
				const quote = removableLiquidityQuote(pair, liquidity)
				if (quote === undefined) return undefined
				args = [liquidity, minimumAfterSlippage(quote.yesOut), minimumAfterSlippage(quote.noOut), snapshot.wallet.address]
				walletAssetDebits = [erc20WalletDebit(pair.address, liquidity, 'lp-token')]
			} else {
				const shares = shareForPool(snapshot, pool)
				if (shares === undefined) return undefined
				steps = shareApproval(shares, pair.address, snapshot.wallet.address)
				const available = amount(shares.yes) < amount(shares.no) ? amount(shares.yes) : amount(shares.no)
				const spend = available > 10n ** 15n ? 10n ** 15n : available
				const expectedLiquidity = kind === 'initialize' ? spend - 1_000n : proportionalLiquidity(pair, spend, spend)?.liquidity
				if (expectedLiquidity === undefined || expectedLiquidity <= 0n) return undefined
				args = [spend, spend, minimumAfterSlippage(expectedLiquidity), snapshot.wallet.address]
				walletAssetDebits = [erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 1), spend), erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 2), spend)]
			}
			let signature = 'LiquidityRemoved(address,address,uint256,uint256,uint256)'
			if (kind === 'initialize') signature = 'LiquidityInitialized(address,address,uint256,uint256,uint256)'
			else if (kind === 'add') signature = 'LiquidityAdded(address,address,uint256,uint256,uint256)'
			steps.push(encodeStep({ abi: tradingPairAbi, args, evidence: [eventEvidence(pair.address, signature)], functionName: method, id: method, label: `${kind} direct liquidity`, to: pair.address, walletAssetDebits }))
			const deadlineTimestamp = kind === 'remove' ? undefined : protocolQuestionDeadline(snapshot, pool)
			return planBase({ deadlineTimestamp, definitionId: id, ecosystem: 'trading', label: `${kind} share liquidity`, metadata: { pair: pair.address }, postconditions: ['Pair reserves and wallet LP balance change consistently'], risk: 'medium', snapshot, steps })
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductPair',
		description: `${kind}s pair liquidity using wallet-owned shares or LP tokens.`,
		discoveryInputs: ['pair status/reserves', 'share balances/approvals', 'LP balance'],
		ecosystem: 'trading',
		evaluate(snapshot) {
			const possible = snapshot.pairs.some(pair => directLiquidityReady(snapshot, pair, kind))
			return eligible(possible ? undefined : `No pair has inventory eligible to ${kind}`)
		},
		id,
		label: `${kind} share liquidity`,
		method,
		risk: 'medium',
	}
}

function swapDefinition(mode: 'exact-input' | 'exact-output'): OperationDefinition {
	const id = `trading.swap.${mode}`
	const method = mode === 'exact-input' ? 'swapExactInput' : 'swapExactOutput'
	return {
		buildPlan(snapshot, options) {
			const candidates = snapshot.pairs.flatMap(pair => {
				if (pair.status !== 0) return []
				const pool = poolForPair(snapshot, pair)
				const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
				if (pool === undefined || shares === undefined || !poolLifecycleOpen(snapshot, pool, shareApproval(shares, pair.address, snapshot.wallet.address).length)) return []
				return [true, false].flatMap(yesForNo => {
					const inputBalance = amount(yesForNo ? shares.yes : shares.no)
					const spend = inputBalance > 10n ** 15n ? 10n ** 15n : inputBalance
					const quote = mode === 'exact-input' ? quoteExactInput(pair, yesForNo, spend) : quoteExactOutput(pair, yesForNo, 1n)
					if (quote === undefined || quote === 0n) return []
					const maximumInput = mode === 'exact-output' ? maximumAfterSlippage(quote) : spend
					if (maximumInput > spend) return []
					return [{ maximumInput, pair, pool, quote, shares, spend, yesForNo }]
				})
			})
			const candidate = choose(candidates, mixSeed(options.seed, id))
			if (candidate === undefined) return undefined
			const { maximumInput, pair, pool, quote, shares, spend, yesForNo } = candidate
			const steps = shareApproval(shares, pair.address, snapshot.wallet.address)
			const args = mode === 'exact-input' ? [yesForNo, spend, minimumAfterSlippage(quote), snapshot.wallet.address] : [yesForNo, 1n, maximumInput, snapshot.wallet.address]
			steps.push(
				encodeStep({
					abi: tradingPairAbi,
					args,
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
				definitionId: id,
				ecosystem: 'trading',
				label: `Swap ${mode}`,
				metadata: { direction: yesForNo ? 'YES-to-NO' : 'NO-to-YES', pair: pair.address },
				postconditions: ['Swap event reserve values match stored pair reserves'],
				risk: 'medium',
				snapshot,
				steps,
			})
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductPair',
		description: `Trades wallet-owned directional shares through the pair's ${mode} path.`,
		discoveryInputs: ['pair status/reserves', 'share balances/approval'],
		ecosystem: 'trading',
		evaluate(snapshot) {
			const found = snapshot.pairs.some(pair => {
				const pool = poolForPair(snapshot, pair)
				const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
				if (pair.status !== 0 || pool === undefined || shares === undefined || !poolLifecycleOpen(snapshot, pool, shareApproval(shares, pair.address, snapshot.wallet.address).length)) return false
				return [true, false].some(yesForNo => {
					const inputBalance = amount(yesForNo ? shares.yes : shares.no)
					const spend = inputBalance > 10n ** 15n ? 10n ** 15n : inputBalance
					const quote = mode === 'exact-input' ? quoteExactInput(pair, yesForNo, spend) : quoteExactOutput(pair, yesForNo, 1n)
					return quote !== undefined && quote > 0n && (mode === 'exact-input' || maximumAfterSlippage(quote) <= spend)
				})
			})
			return eligible(found ? undefined : 'No open pair has tradable wallet shares')
		},
		id,
		label: `Swap ${mode}`,
		method,
		risk: 'medium',
	}
}

const syncPair: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pair = choose(
			snapshot.pairs.filter(candidate => amount(candidate.totalSupply) > 0n && (amount(candidate.effectiveYesReserve) !== amount(candidate.yesReserve) || amount(candidate.effectiveNoReserve) !== amount(candidate.noReserve))),
			mixSeed(options.seed, syncPair.id),
		)
		if (pair === undefined) return undefined
		return planBase({
			definitionId: syncPair.id,
			ecosystem: 'trading',
			label: syncPair.label,
			metadata: { pair: pair.address },
			postconditions: ['Stored reserves equal current pair share balances'],
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: tradingPairAbi, evidence: [eventEvidence(pair.address, 'Sync(uint256,uint256)')], functionName: 'sync', id: 'sync', label: 'Synchronize pair', to: pair.address })],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductPair',
	description: 'Permissionlessly synchronizes stored reserves with ERC-1155 balances.',
	discoveryInputs: ['trading pairs'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(snapshot.pairs.some(pair => amount(pair.totalSupply) > 0n && (amount(pair.effectiveYesReserve) !== amount(pair.yesReserve) || amount(pair.effectiveNoReserve) !== amount(pair.noReserve))) ? undefined : 'No initialized pair has excess balances to synchronize'),
	id: 'trading.pair.sync',
	label: 'Synchronize pair',
	method: 'sync',
	risk: 'low',
}

function routerEthDefinition(kind: 'create-and-initialize' | 'initialize' | 'add' | 'enter'): OperationDefinition {
	const details = {
		add: ['trading.liquidity.add-eth', 'addLiquidityWithEth'],
		'create-and-initialize': ['trading.pair.create-and-initialize', 'createPairAndInitializeWithEth'],
		enter: ['trading.position.enter', 'enterPosition'],
		initialize: ['trading.pair.initialize-eth', 'initializeWithEth'],
	} as const
	const [id, method] = details[kind]
	return {
		buildPlan(snapshot, options) {
			const spend = ethSpend(snapshot, options, id, kind === 'create-and-initialize' || kind === 'initialize' ? 2_002n : 1n)
			if (spend === 0n) return undefined
			const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
			const pool =
				kind === 'create-and-initialize'
					? choose(
							snapshot.pools.filter(candidate => !paired.has(candidate.address.toLowerCase()) && poolLifecycleOpen(snapshot, candidate) && candidate.oraclePriceValid && canCreateCompleteSet(candidate, spend) && ethToShares(candidate, spend) > 1_000n),
							mixSeed(options.seed, id),
						)
					: undefined
			const pair =
				kind === 'create-and-initialize'
					? undefined
					: choose(
							snapshot.pairs.filter(candidate => {
								if (candidate.status !== (kind === 'initialize' ? 6 : 0)) return false
								const candidatePool = poolForPair(snapshot, candidate)
								if (candidatePool === undefined || !poolLifecycleOpen(snapshot, candidatePool) || !candidatePool.oraclePriceValid || !canCreateCompleteSet(candidatePool, spend)) return false
								const minted = ethToShares(candidatePool, spend)
								if (kind === 'initialize') return minted > 1_000n && amount(candidate.effectiveYesReserve) === 0n && amount(candidate.effectiveNoReserve) === 0n
								if (kind === 'add') return proportionalLiquidity(candidate, minted, minted) !== undefined
								return minted > 0n && [true, false].some(yesForNo => quoteExactInput(candidate, yesForNo, minted) > 0n)
							}),
							mixSeed(options.seed, id),
						)
			if (pool === undefined && pair === undefined) return undefined
			const target = pool?.address ?? pair?.address
			if (target === undefined) return undefined
			const candidatePool = pool ?? (pair === undefined ? undefined : poolForPair(snapshot, pair))
			if (candidatePool === undefined) return undefined
			const deadline = questionDeadline(snapshot, candidatePool, mixSeed(options.seed, `${id}:deadline`))
			if (deadline === undefined) return undefined
			const minted = ethToShares(candidatePool, spend)
			const enterOutcomes = pair === undefined ? [] : [1, 2].filter(outcome => quoteExactInput(pair, outcome === 2, minted) > 0n)
			const longOutcome = kind === 'enter' ? choose(enterOutcomes, mixSeed(options.seed, 'long-outcome')) : undefined
			if (kind === 'enter' && longOutcome === undefined) return undefined
			let args: readonly unknown[]
			let evidence: OperationEvidence[]
			if (kind === 'create-and-initialize' || kind === 'initialize') {
				args = [target, 5_000n, minimumAfterSlippage(minted - 1_000n), snapshot.wallet.address, BigInt(deadline)]
				evidence = kind === 'create-and-initialize' ? [eventEvidence(snapshot.deployments.tradingFactory, 'PairCreated(address,address,uint248,address,uint256)')] : [eventEvidence(target, 'LiquidityInitialized(address,address,uint256,uint256,uint256)')]
			} else if (kind === 'add') {
				const liquidity = pair === undefined ? undefined : proportionalLiquidity(pair, minted, minted)?.liquidity
				if (liquidity === undefined) return undefined
				args = [target, minimumAfterSlippage(liquidity), snapshot.wallet.address, BigInt(deadline)]
				evidence = [eventEvidence(target, 'LiquidityAdded(address,address,uint256,uint256,uint256)')]
			} else {
				if (pair === undefined || longOutcome === undefined) return undefined
				const additionalLong = quoteExactInput(pair, longOutcome === 2, minted)
				args = [target, longOutcome, minimumAfterSlippage(minted + additionalLong), snapshot.wallet.address, BigInt(deadline)]
				evidence = [eventEvidence(target, 'Swap(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256)')]
			}
			return planBase({
				deadlineTimestamp: deadline,
				definitionId: id,
				ecosystem: 'trading',
				label: `Router ${kind}`,
				metadata: { target },
				postconditions: [kind === 'enter' ? 'Wallet receives invalid insurance and directional long shares' : 'Wallet LP balance increases and unused shares return to the wallet'],
				risk: 'medium',
				snapshot,
				steps: [encodeStep({ abi: tradingRouterAbi, args, evidence, functionName: method, id: method, label: `Router ${kind}`, to: snapshot.deployments.tradingRouter, value: spend })],
			})
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductRouter',
		description: `Executes the router's ${kind} ETH-funded workflow with a fresh deadline.`,
		discoveryInputs: ['pair/pool lifecycle', 'ETH reserve', 'factory mapping'],
		ecosystem: 'trading',
		evaluate(snapshot, options) {
			const spend = ethSpend(snapshot, options, id, kind === 'create-and-initialize' || kind === 'initialize' ? 2_002n : 1n)
			const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
			const target =
				kind === 'create-and-initialize'
					? snapshot.pools.some(pool => !paired.has(pool.address.toLowerCase()) && poolLifecycleOpen(snapshot, pool) && pool.oraclePriceValid && canCreateCompleteSet(pool, spend) && ethToShares(pool, spend) > 1_000n)
					: snapshot.pairs.some(pair => {
							if (pair.status !== (kind === 'initialize' ? 6 : 0)) return false
							const pool = poolForPair(snapshot, pair)
							if (pool === undefined || !poolLifecycleOpen(snapshot, pool) || !pool.oraclePriceValid || !canCreateCompleteSet(pool, spend)) return false
							const minted = ethToShares(pool, spend)
							if (kind === 'initialize') return minted > 1_000n && amount(pair.effectiveYesReserve) === 0n && amount(pair.effectiveNoReserve) === 0n
							if (kind === 'add') return proportionalLiquidity(pair, minted, minted) !== undefined
							return minted > 0n && [true, false].some(yesForNo => quoteExactInput(pair, yesForNo, minted) > 0n)
						})
			return eligible(target ? undefined : 'No pair/pool is in the required lifecycle state', spend === 0n ? 'No spendable ETH above reserve' : undefined)
		},
		id,
		label: `Router ${kind}`,
		method,
		risk: 'medium',
	}
}

function routerOwnedDefinition(kind: 'exit' | 'redeem' | 'remove'): OperationDefinition {
	const details = {
		exit: ['trading.position.exit', 'exitPosition'],
		redeem: ['trading.complete-set.redeem', 'redeemCompleteSet'],
		remove: ['trading.liquidity.remove', 'removeLiquidity'],
	} as const
	const [id, method] = details[kind]
	return {
		buildPlan(snapshot, options) {
			const pair = choose(
				snapshot.pairs.filter(candidate => {
					if (kind === 'remove') return removableLiquidity(candidate) > 0n
					const pool = poolForPair(snapshot, candidate)
					const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
					if (pool === undefined || shares === undefined || amount(shares.invalid) === 0n) return false
					if (kind === 'redeem') {
						const universe = snapshot.universes.find(universe => universe.id === pool?.universeId)
						const complete = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
						return pool?.systemState === 0 && universe?.forkTime === '0' && complete > 0n && sharesToEth(pool, complete) > 0n
					}
					if (candidate.status !== 0 || !poolLifecycleOpen(snapshot, pool, shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address).length)) return false
					const complete = minimumPositivePayoutShares(pool)
					if (complete === undefined || amount(shares.invalid) < complete) return false
					return [true, false].some(longYes => {
						const requiredSwapInput = quoteExactOutput(candidate, longYes, complete)
						const longBalance = amount(longYes ? shares.yes : shares.no)
						return requiredSwapInput !== undefined && longBalance >= complete + requiredSwapInput
					})
				}),
				mixSeed(options.seed, id),
			)
			if (pair === undefined) return undefined
			const pool = poolForPair(snapshot, pair)
			if (pool === undefined) return undefined
			const deadline = kind === 'exit' ? questionDeadline(snapshot, pool, mixSeed(options.seed, `${id}:deadline`)) : randomDeadline(snapshot, mixSeed(options.seed, `${id}:deadline`))
			if (deadline === undefined) return undefined
			let steps = []
			let args: readonly unknown[]
			let walletAssetDebits: OperationWalletAssetDebit[] = []
			if (kind === 'remove') {
				const liquidity = removableLiquidity(pair)
				const quote = removableLiquidityQuote(pair, liquidity)
				if (quote === undefined) return undefined
				const lpInventory = snapshot.wallet.lpTokens.find(inventory => inventory.pair.toLowerCase() === pair.address.toLowerCase())
				if (amount(lpInventory?.allowanceToRouter ?? '0') < liquidity) {
					steps.push(
						encodeStep({
							abi: tradingPairAbi,
							args: [snapshot.deployments.tradingRouter, liquidity],
							evidence: [
								{
									abi: 'function allowance(address owner, address spender) view returns (uint256)',
									args: [snapshot.wallet.address, snapshot.deployments.tradingRouter],
									contract: pair.address,
									expected: liquidity.toString(),
									functionName: 'allowance',
									kind: 'storage-postcondition',
									relation: 'equals',
								},
							],
							functionName: 'approve',
							id: 'approve-lp',
							label: 'Approve LP token',
							to: pair.address,
						}),
					)
				}
				args = [pair.address, liquidity, minimumAfterSlippage(quote.yesOut), minimumAfterSlippage(quote.noOut), snapshot.wallet.address, BigInt(deadline)]
				walletAssetDebits = [erc20WalletDebit(pair.address, liquidity, 'lp-token')]
			} else {
				const shares = shareForPool(snapshot, pool)
				if (shares === undefined) return undefined
				steps = shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address)
				if (kind === 'redeem') {
					const complete = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
					args = [pool.address, complete, minimumAfterSlippage(sharesToEth(pool, complete)), snapshot.wallet.address, BigInt(deadline)]
					walletAssetDebits = [0, 1, 2].map(outcome => erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, outcome), complete))
				} else {
					const complete = minimumPositivePayoutShares(pool)
					if (complete === undefined || amount(shares.invalid) < complete) return undefined
					const routes = [true, false].flatMap(longYes => {
						const requiredSwapInput = quoteExactOutput(pair, longYes, complete)
						const longBalance = amount(longYes ? shares.yes : shares.no)
						const maximumSwapInput = requiredSwapInput === undefined ? undefined : maximumAfterSlippage(requiredSwapInput)
						return maximumSwapInput !== undefined && longBalance >= complete + maximumSwapInput ? [{ complete, longOutcome: longYes ? 1 : 2, maximumLong: complete + maximumSwapInput }] : []
					})
					const route = choose(routes, mixSeed(options.seed, `${id}:direction`))
					if (route === undefined) return undefined
					args = [pair.address, route.longOutcome, route.complete, route.maximumLong, minimumAfterSlippage(sharesToEth(pool, route.complete)), snapshot.wallet.address, BigInt(deadline)]
					walletAssetDebits = [erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 0), route.complete), erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, route.longOutcome), route.maximumLong)]
				}
			}
			let evidence: OperationEvidence[]
			if (kind === 'remove') evidence = [eventEvidence(pair.address, 'LiquidityRemoved(address,address,uint256,uint256,uint256)')]
			else if (kind === 'redeem') evidence = [eventEvidence(pool.address, 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)')]
			else evidence = [eventEvidence(pair.address, 'Swap(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256)'), eventEvidence(pool.address, 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)')]
			steps.push(encodeStep({ abi: tradingRouterAbi, args, evidence, functionName: method, id: method, label: `Router ${kind}`, to: snapshot.deployments.tradingRouter, walletAssetDebits }))
			return planBase({
				deadlineTimestamp: deadline,
				definitionId: id,
				ecosystem: 'trading',
				label: `Router ${kind}`,
				metadata: { pair: pair.address },
				postconditions: [kind === 'remove' ? 'LP balance decreases and outcome shares return' : 'Complete sets redeem to ETH and wallet share balances decrease'],
				risk: 'medium',
				snapshot,
				steps,
			})
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductRouter',
		description: `Executes router ${kind} using only wallet-owned LP/outcome inventory.`,
		discoveryInputs: ['wallet shares/LP balance and approvals', 'pair lifecycle'],
		ecosystem: 'trading',
		evaluate(snapshot) {
			const found = snapshot.pairs.some(pair => {
				if (kind === 'remove') return removableLiquidity(pair) > 0n
				const pool = poolForPair(snapshot, pair)
				const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
				if (pool === undefined || shares === undefined || amount(shares.invalid) === 0n) return false
				if (kind === 'redeem') {
					const universe = snapshot.universes.find(universe => universe.id === pool?.universeId)
					const complete = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
					return pool?.systemState === 0 && universe?.forkTime === '0' && complete > 0n && sharesToEth(pool, complete) > 0n
				}
				if (pair.status !== 0 || !poolLifecycleOpen(snapshot, pool, shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address).length)) return false
				const complete = minimumPositivePayoutShares(pool)
				if (complete === undefined || amount(shares.invalid) < complete) return false
				return [true, false].some(longYes => {
					const requiredSwapInput = quoteExactOutput(pair, longYes, complete)
					return requiredSwapInput !== undefined && amount(longYes ? shares.yes : shares.no) >= complete + maximumAfterSlippage(requiredSwapInput)
				})
			})
			return eligible(found ? undefined : `No wallet inventory is eligible to ${kind}`)
		},
		id,
		label: `Router ${kind}`,
		method,
		risk: 'medium',
	}
}

type ShareMigrationRoute = {
	deadline?: bigint
	fromId: bigint
	shares: ShareInventory
	sourceBalance: bigint
	targetOutcome: string
}

function shareMigrationRouteAvailability(snapshot: EcosystemSnapshot, pool: PoolSnapshot, targetOutcome: string): { deadline?: bigint } | undefined {
	const childExists = snapshot.pools.some(child => child.parent.toLowerCase() === pool.address.toLowerCase() && child.forkOutcomeIndex === targetOutcome)
	if (childExists || pool.systemState === 0) return {}
	const activation = amount(pool.forkActivationTime)
	if (activation === 0n) return undefined
	const deadline = activation + FORK_MIGRATION_WINDOW_SECONDS
	return amount(snapshot.anchor.timestamp) + lifecycleSafetySeconds(0) <= deadline ? { deadline } : undefined
}

function shareMigrationRoutes(snapshot: EcosystemSnapshot): ShareMigrationRoute[] {
	return snapshot.pools.flatMap(pool => {
		const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
		const forkQuestion = universe === undefined ? undefined : snapshot.questions.find(question => question.id === universe.forkQuestionId)
		const shares = shareForPool(snapshot, pool)
		const targetOutcomes = validForkOutcomeRoutes(forkQuestion, universe?.knownChildOutcomes)
		if (universe === undefined || universe.forkTime === '0' || !shareMigrationPoolReady(pool, universe.forkTime) || targetOutcomes.length === 0 || shares === undefined) return []
		return [shares.invalid, shares.yes, shares.no].flatMap((balance, sourceOutcome) => {
			const sourceBalance = amount(balance)
			if (sourceBalance === 0n) return []
			return targetOutcomes.flatMap(targetOutcome => {
				const progress = amount(shares.migrationProgressByRoute[`${sourceOutcome.toString()}:${targetOutcome}`] ?? sourceBalance.toString())
				if (progress > sourceBalance) throw new Error(`Share migration progress for ${pool.address} route ${sourceOutcome.toString()}:${targetOutcome} exceeds the wallet source balance`)
				if (progress === sourceBalance) return []
				const availability = shareMigrationRouteAvailability(snapshot, pool, targetOutcome)
				return availability === undefined ? [] : [{ ...availability, fromId: shareTokenId(pool.universeId, sourceOutcome), shares, sourceBalance, targetOutcome }]
			})
		})
	})
}

const migrateShares: OperationDefinition = {
	buildPlan(snapshot, options) {
		const route = choose(shareMigrationRoutes(snapshot), mixSeed(options.seed, migrateShares.id))
		if (route === undefined) return undefined
		return planBase({
			...(route.deadline === undefined ? {} : { deadlineTimestamp: route.deadline.toString() }),
			definitionId: migrateShares.id,
			ecosystem: 'trading',
			label: migrateShares.label,
			metadata: { fromId: route.fromId.toString(), shareToken: route.shares.shareToken, targetOutcome: route.targetOutcome },
			postconditions: ['Source shares lock and the previously unmigrated child-universe delta materializes'],
			risk: 'irreversible',
			snapshot,
			steps: [
				encodeStep({
					abi: shareTokenAbi,
					args: [route.fromId, [BigInt(route.targetOutcome)]],
					evidence: [eventEvidence(route.shares.shareToken, 'Migrate(address,uint256,uint256,uint256)')],
					functionName: 'migrate',
					id: 'migrate-shares',
					label: 'Migrate shares to child universe',
					to: route.shares.shareToken,
					walletAssetDebits: [erc1155WalletDebit(route.shares.shareToken, route.fromId, route.sourceBalance)],
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'ShareToken',
	description: 'Migrates wallet-owned source-universe shares into a canonical child branch.',
	discoveryInputs: ['forked source pool', 'share balances', 'child pool routing'],
	ecosystem: 'trading',
	evaluate(snapshot, options) {
		const found = shareMigrationRoutes(snapshot).length > 0
		return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', found ? undefined : 'No fork share route has anchored unmigrated progress')
	},
	id: 'trading.shares.migrate',
	label: 'Migrate forked shares',
	method: 'migrate',
	risk: 'irreversible',
}

const shareApprovalDefinition: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'prerequisite',
	contract: 'ShareToken',
	description: 'ERC-1155 operator approval is automatically prepended to pair/router workflows.',
	discoveryInputs: ['isApprovedForAll'],
	ecosystem: 'trading',
	evaluate: () => disabled('Prerequisites are composed into selectable plans'),
	id: 'token.shares.approve',
	label: 'Approve outcome shares',
	method: 'setApprovalForAll',
	risk: 'medium',
}

const lpApprovalDefinition: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'prerequisite',
	contract: 'TwoWayConstantProductPair',
	description: 'A bounded LP-token allowance is automatically prepended to router liquidity removal.',
	discoveryInputs: ['wallet LP balance', 'router LP allowance'],
	ecosystem: 'trading',
	evaluate: () => disabled('Prerequisites are composed into selectable plans'),
	id: 'trading.lp.approve',
	label: 'Approve LP token',
	method: 'approve',
	risk: 'medium',
}

export const TRADING_OPERATIONS: readonly OperationDefinition[] = [
	createPair,
	directLiquidity('initialize'),
	directLiquidity('add'),
	directLiquidity('remove'),
	swapDefinition('exact-input'),
	swapDefinition('exact-output'),
	syncPair,
	routerEthDefinition('create-and-initialize'),
	routerEthDefinition('initialize'),
	routerEthDefinition('add'),
	routerEthDefinition('enter'),
	routerOwnedDefinition('exit'),
	routerOwnedDefinition('redeem'),
	routerOwnedDefinition('remove'),
	migrateShares,
	shareApprovalDefinition,
	lpApprovalDefinition,
]
