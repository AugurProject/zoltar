import { decodeFunctionData, encodeDeployData, getAddress, getCreate2Address, isAddress, toHex, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter } from '../../../../solidity/ts/types/contractArtifact.ts'
import { erc1155Abi, erc20Abi, genesisUniswapSeederAbi, shareTokenAbi, tradingFactoryAbi, tradingPairAbi, tradingRouterAbi, uniswapV3FactoryAbi, uniswapV3PoolAbi } from '../contracts/abi.ts'
import { CANONICAL_UNISWAP_V3_FACTORY, GENESIS_UNISWAP_FEE, GENESIS_UNISWAP_SQRT_PRICE_X96, GENESIS_UNISWAP_TICK_LOWER, GENESIS_UNISWAP_TICK_UPPER, genesisUniswapSeederDeployment } from '../core/genesis-uniswap.ts'
import { allowance, amount, cappedSpend, choose, disabled, eligible, encodeStep, erc1155WalletDebit, erc20AllowanceEvidence, erc20WalletDebit, eventEvidence, mixSeed, optionAmount, planBase, randomDeadline, tokenInventory } from './planning.ts'
import { timestampDeadlineHasRequiredSafety } from './timing.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationEvidence, OperationPlan, OperationPlanDraft, PairSnapshot, PlanningOptions, PoolSnapshot, ShareInventory } from './types.ts'
import { validForkOutcomeRoutes } from './fork-outcomes.ts'
import { canCreateCompleteSet, projectedEthToShares, sharesToProjectedEth } from './pool-economics.ts'

const shareForPool = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => snapshot.wallet.shares.find(share => share.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && share.universeId === pool.universeId)
const poolForPair = (snapshot: EcosystemSnapshot, pair: PairSnapshot) => snapshot.pools.find(pool => pool.address.toLowerCase() === pair.pool.toLowerCase())
const shareTokenId = (universeId: string, outcome: number) => (amount(universeId) << 8n) | BigInt(outcome)
const BPS_DENOMINATOR = 10_000n
const CANONICAL_PROXY_DEPLOYER = getAddress('0x7a0d94f55792c434d74a40883c6ed8545e406d12')
const ZERO_SALT = toHex(0, { size: 32 })
const GENESIS_TRADING_FEE_BPS = 30

function deploymentStep(id: string, label: string, to: Address, data: Hex, evidence: OperationEvidence[]) {
	return { data, evidence, gasLimit: '12000000', id, label, preflightCalls: [], to, walletAssetDebits: [] }
}

function tradingRootDeploymentPlans(snapshot: EcosystemSnapshot) {
	const factoryData = encodeDeployData({
		abi: trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.abi,
		args: [snapshot.deployments.securityPoolFactory, BigInt(GENESIS_TRADING_FEE_BPS)],
		bytecode: `0x${trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.evm.bytecode.object}`,
	})
	const factoryAddress = getCreate2Address({ bytecode: factoryData, from: CANONICAL_PROXY_DEPLOYER, salt: ZERO_SALT })
	const routerData = encodeDeployData({
		abi: trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.abi,
		args: [factoryAddress],
		bytecode: `0x${trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.evm.bytecode.object}`,
	})
	const routerAddress = getCreate2Address({ bytecode: routerData, from: CANONICAL_PROXY_DEPLOYER, salt: ZERO_SALT })
	return { factoryAddress, factoryData, routerAddress, routerData }
}

const deployTradingFactory: OperationDefinition = {
	buildPlan(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot)
		if (deployment.factoryAddress !== snapshot.deployments.tradingFactory) return undefined
		return planBase({
			definitionId: deployTradingFactory.id,
			ecosystem: 'trading',
			label: deployTradingFactory.label,
			metadata: { factory: deployment.factoryAddress },
			postconditions: ['The deterministic trading factory references the configured SecurityPoolFactory'],
			risk: 'medium',
			snapshot,
			steps: [
				deploymentStep('deploy-trading-factory', 'Deploy trading factory', CANONICAL_PROXY_DEPLOYER, deployment.factoryData, [
					{ abi: 'function securityPoolFactory() view returns (address)', args: [], contract: deployment.factoryAddress, expected: snapshot.deployments.securityPoolFactory, functionName: 'securityPoolFactory', kind: 'storage-postcondition', relation: 'equals' },
				]),
			],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductFactory',
	description: 'Deterministically deploys the configured trading factory through the authenticated canonical proxy deployer.',
	discoveryInputs: ['configured trading roots and canonical proxy deployment'],
	ecosystem: 'trading',
	evaluate(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot)
		return eligible(snapshot.tradingDeployment?.factory === false ? undefined : 'Trading factory is already deployed', deployment.factoryAddress === snapshot.deployments.tradingFactory ? undefined : 'Configured trading factory does not match the deterministic deployment plan')
	},
	id: 'trading.root.deploy-factory',
	label: 'Deploy trading factory',
	method: 'fallback',
	risk: 'medium',
}

const deployTradingRouter: OperationDefinition = {
	buildPlan(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot)
		if (deployment.routerAddress !== snapshot.deployments.tradingRouter) return undefined
		return planBase({
			definitionId: deployTradingRouter.id,
			ecosystem: 'trading',
			label: deployTradingRouter.label,
			metadata: { router: deployment.routerAddress },
			postconditions: ['The deterministic trading router references the configured trading factory'],
			risk: 'medium',
			snapshot,
			steps: [
				deploymentStep('deploy-trading-router', 'Deploy trading router', CANONICAL_PROXY_DEPLOYER, deployment.routerData, [
					{ abi: 'function factory() view returns (address)', args: [], contract: deployment.routerAddress, expected: snapshot.deployments.tradingFactory, functionName: 'factory', kind: 'storage-postcondition', relation: 'equals' },
				]),
			],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductRouter',
	description: 'Deterministically deploys the configured trading router through the authenticated canonical proxy deployer.',
	discoveryInputs: ['configured trading roots and canonical proxy deployment'],
	ecosystem: 'trading',
	evaluate(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot)
		return eligible(
			snapshot.tradingDeployment?.factory === true ? undefined : 'Deploy the trading factory first',
			snapshot.tradingDeployment?.router === false ? undefined : 'Trading router is already deployed',
			deployment.routerAddress === snapshot.deployments.tradingRouter ? undefined : 'Configured trading router does not match the deterministic deployment plan',
		)
	},
	id: 'trading.root.deploy-router',
	label: 'Deploy trading router',
	method: 'fallback',
	risk: 'medium',
}

const deployGenesisUniswapSeeder: OperationDefinition = {
	buildPlan(snapshot) {
		const deployment = genesisUniswapSeederDeployment()
		return planBase({
			definitionId: deployGenesisUniswapSeeder.id,
			ecosystem: 'trading',
			label: deployGenesisUniswapSeeder.label,
			metadata: { seeder: deployment.address },
			postconditions: ['The deterministic, stateless Uniswap V3 seeding helper has deployed code'],
			risk: 'medium',
			snapshot,
			steps: [deploymentStep('deploy-genesis-uniswap-seeder', 'Deploy Uniswap V3 seeding helper', CANONICAL_PROXY_DEPLOYER, deployment.data, [])],
		})
	},
	classification: 'selectable',
	contract: 'GenesisUniswapV3Seeder',
	description: 'Deterministically deploys the stateless helper used to mint the genesis REP/WETH position.',
	discoveryInputs: ['deterministic helper deployment'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(snapshot.genesisUniswap?.proxy === true ? undefined : 'Canonical proxy deployer is unavailable', snapshot.genesisUniswap?.seeder === false ? undefined : 'Genesis Uniswap seeding helper is already deployed'),
	id: 'trading.genesis-uniswap.deploy-seeder',
	label: 'Deploy genesis Uniswap seeder',
	method: 'fallback',
	risk: 'medium',
}

function genesisRep(snapshot: EcosystemSnapshot) {
	return snapshot.universes.find(universe => universe.id === '0')?.repToken
}

const createGenesisUniswapPool: OperationDefinition = {
	buildPlan(snapshot) {
		const rep = genesisRep(snapshot)
		if (rep === undefined) return undefined
		const uniswapFactory = snapshot.deployments.uniswapV3Factory ?? CANONICAL_UNISWAP_V3_FACTORY
		return planBase({
			definitionId: createGenesisUniswapPool.id,
			ecosystem: 'trading',
			label: createGenesisUniswapPool.label,
			metadata: { factory: uniswapFactory, fee: GENESIS_UNISWAP_FEE, rep, weth: snapshot.deployments.weth },
			postconditions: ['The configured Uniswap V3 factory returns the canonical genesis REP/WETH fee-tier pool'],
			risk: 'medium',
			snapshot,
			steps: [encodeStep({ abi: uniswapV3FactoryAbi, args: [rep, snapshot.deployments.weth, GENESIS_UNISWAP_FEE], evidence: [], functionName: 'createPool', id: 'create-genesis-uniswap-pool', label: 'Create REP/WETH pool', to: uniswapFactory, walletAssetDebits: [] })],
		})
	},
	classification: 'selectable',
	contract: 'UniswapV3Factory',
	description: 'Creates the genesis REP/WETH pool at the fixed 1% fee tier.',
	discoveryInputs: ['genesis REP token, configured WETH and authenticated Uniswap V3 factory'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(snapshot.genesisUniswap?.factory === true ? undefined : 'Configured Uniswap V3 factory has no code', snapshot.genesisUniswap?.pool === undefined ? undefined : 'Genesis REP/WETH pool already exists'),
	id: 'trading.genesis-uniswap.create-pool',
	label: 'Create genesis REP/WETH pool',
	method: 'createPool',
	risk: 'medium',
}

const initializeGenesisUniswapPool: OperationDefinition = {
	buildPlan(snapshot) {
		const pool = snapshot.genesisUniswap?.pool
		if (pool === undefined) return undefined
		return planBase({
			definitionId: initializeGenesisUniswapPool.id,
			ecosystem: 'trading',
			label: initializeGenesisUniswapPool.label,
			metadata: { pool, sqrtPriceX96: GENESIS_UNISWAP_SQRT_PRICE_X96.toString() },
			postconditions: ['The genesis REP/WETH pool has a 1:1 initial sqrt price'],
			risk: 'medium',
			snapshot,
			steps: [encodeStep({ abi: uniswapV3PoolAbi, args: [GENESIS_UNISWAP_SQRT_PRICE_X96], evidence: [], functionName: 'initialize', id: 'initialize-genesis-uniswap-pool', label: 'Initialize REP/WETH pool', to: pool, walletAssetDebits: [] })],
		})
	},
	classification: 'selectable',
	contract: 'UniswapV3Pool',
	description: 'Initializes the genesis REP/WETH pool at a deterministic 1:1 price.',
	discoveryInputs: ['authenticated genesis REP/WETH pool slot0'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(snapshot.genesisUniswap?.pool === undefined ? 'Create the genesis REP/WETH pool first' : undefined, snapshot.genesisUniswap?.initialized === false ? undefined : 'Genesis REP/WETH pool is already initialized'),
	id: 'trading.genesis-uniswap.initialize-pool',
	label: 'Initialize genesis REP/WETH pool',
	method: 'initialize',
	risk: 'medium',
}

const seedGenesisUniswapPool: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = snapshot.genesisUniswap?.pool
		const rep = genesisRep(snapshot)
		if (pool === undefined || rep === undefined) return undefined
		const repInventory = tokenInventory(snapshot, rep)
		const wethInventory = tokenInventory(snapshot, snapshot.deployments.weth)
		if (repInventory === undefined || wethInventory === undefined) return undefined
		const maximumRep = optionAmount(options, 'maxRepSpendAttoRep', 10n ** 15n)
		const maximumWeth = optionAmount(options, 'maxEthSpendAttoEth', 10n ** 15n)
		const amount0 = [amount(repInventory.balance), maximumRep, 10n ** 15n].reduce((minimum, value) => (value < minimum ? value : minimum))
		const amount1 = [amount(wethInventory.balance), maximumWeth, 10n ** 15n].reduce((minimum, value) => (value < minimum ? value : minimum))
		if (amount0 === 0n || amount1 === 0n) return undefined
		const seeder = genesisUniswapSeederDeployment().address
		const token0 = rep.toLowerCase() < snapshot.deployments.weth.toLowerCase() ? rep : snapshot.deployments.weth
		const token1 = token0 === rep ? snapshot.deployments.weth : rep
		const maximum0 = token0 === rep ? amount0 : amount1
		const maximum1 = token1 === rep ? amount0 : amount1
		const liquidity = (maximum0 < maximum1 ? maximum0 : maximum1) / 2n
		if (liquidity === 0n) return undefined
		const steps = []
		if (allowance(tokenInventory(snapshot, token0), seeder) !== maximum0)
			steps.push(encodeStep({ abi: erc20Abi, args: [seeder, maximum0], evidence: [erc20AllowanceEvidence(token0, snapshot.wallet.address, seeder, maximum0)], functionName: 'approve', id: 'approve-genesis-token0', label: 'Approve genesis token0', to: token0, walletAssetDebits: [] }))
		if (allowance(tokenInventory(snapshot, token1), seeder) !== maximum1)
			steps.push(encodeStep({ abi: erc20Abi, args: [seeder, maximum1], evidence: [erc20AllowanceEvidence(token1, snapshot.wallet.address, seeder, maximum1)], functionName: 'approve', id: 'approve-genesis-token1', label: 'Approve genesis token1', to: token1, walletAssetDebits: [] }))
		steps.push(
			encodeStep({
				abi: genesisUniswapSeederAbi,
				args: [pool, token0, token1, GENESIS_UNISWAP_TICK_LOWER, GENESIS_UNISWAP_TICK_UPPER, liquidity, maximum0, maximum1, snapshot.wallet.address],
				evidence: [],
				functionName: 'seed',
				id: 'seed-genesis-uniswap-pool',
				label: 'Seed REP/WETH liquidity',
				to: seeder,
				walletAssetDebits: [erc20WalletDebit(token0, maximum0, token0 === rep ? 'rep' : 'weth'), erc20WalletDebit(token1, maximum1, token1 === rep ? 'rep' : 'weth')],
			}),
		)
		return planBase({
			definitionId: seedGenesisUniswapPool.id,
			ecosystem: 'trading',
			label: seedGenesisUniswapPool.label,
			maximumCleanupTransactionCount: 2,
			metadata: { liquidity: liquidity.toString(), maximum0: maximum0.toString(), maximum1: maximum1.toString(), pool, seeder, token0, token1 },
			postconditions: ['The authenticated genesis REP/WETH pool has nonzero active liquidity and exact approvals are consumed'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const cleanup = () => {
			const token0 = metadataAddress(context.previousPlan.metadata, 'token0')
			const token1 = metadataAddress(context.previousPlan.metadata, 'token1')
			const seeder = metadataAddress(context.previousPlan.metadata, 'seeder')
			if (token0 === undefined || token1 === undefined || seeder === undefined) return undefined
			const steps = [token0, token1].flatMap((token, index) =>
				allowance(tokenInventory(snapshot, token), seeder) === 0n
					? []
					: [encodeStep({ abi: erc20Abi, args: [seeder, 0n], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, seeder, 0n)], functionName: 'approve', id: `revoke-genesis-token${index.toString()}`, label: `Revoke genesis token${index.toString()} allowance`, to: token, walletAssetDebits: [] })],
			)
			if (steps.length === 0) return undefined
			return planBase({
				continuationDisposition: 'cleanup-only',
				definitionId: seedGenesisUniswapPool.id,
				ecosystem: 'trading',
				label: `Clean up ${seedGenesisUniswapPool.label}`,
				metadata: context.previousPlan.metadata,
				postconditions: ['Every confirmed workflow-created seeder allowance is zero'],
				risk: 'medium',
				snapshot,
				steps,
			})
		}
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const refreshed = seedGenesisUniswapPool.buildPlan(snapshot, options)
		return refreshed !== undefined && JSON.stringify(refreshed.metadata) === JSON.stringify(context.previousPlan.metadata) ? refreshed : cleanup()
	},
	classification: 'selectable',
	contract: 'GenesisUniswapV3Seeder',
	description: 'Seeds a bounded full-range REP/WETH position owned by the operator wallet.',
	discoveryInputs: ['authenticated pool liquidity, wallet REP/WETH balances and exact helper allowances'],
	ecosystem: 'trading',
	evaluate: snapshot => {
		const rep = genesisRep(snapshot)
		const seeder = genesisUniswapSeederDeployment().address
		return eligible(
			snapshot.genesisUniswap?.initialized === true ? undefined : 'Initialize the genesis REP/WETH pool first',
			snapshot.genesisUniswap?.seeder === true ? undefined : 'Deploy the genesis Uniswap seeder first',
			amount(snapshot.genesisUniswap?.liquidity ?? '0') === 0n ? undefined : 'Genesis REP/WETH pool is already seeded',
			rep !== undefined && allowance(tokenInventory(snapshot, rep), seeder) >= 0n ? undefined : 'Genesis REP inventory is unavailable',
		)
	},
	id: 'trading.genesis-uniswap.seed-pool',
	label: 'Seed genesis REP/WETH pool',
	method: 'seed',
	risk: 'medium',
}
const TRADING_SLIPPAGE_BPS = 100n
const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n
const ORACLE_PRICE_VALIDITY_SECONDS = 300n

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

function poolLifecycleOpen(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, prerequisiteCount = 0) {
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	const question = poolQuestion(snapshot, pool)
	if (pool.systemState !== 0 || pool.awaitingForkContinuation || pool.questionOutcome !== 3 || universe?.forkTime !== '0' || question === undefined) return false
	const endTime = amount(question.endTime)
	return endTime > 0n && timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), endTime - 1n, options, prerequisiteCount)
}

function questionDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, seed: number) {
	const question = poolQuestion(snapshot, pool)
	if (question === undefined) return undefined
	const randomized = amount(randomDeadline(snapshot, seed))
	const protocolLastSecond = amount(question.endTime) - 1n
	return (randomized < protocolLastSecond ? randomized : protocolLastSecond).toString()
}

function oraclePriceExpiry(pool: PoolSnapshot) {
	return amount(pool.lastOracleSettlementTimestamp) + ORACLE_PRICE_VALIDITY_SECONDS
}

function ethRouterOraclePriceIsSafe(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions) {
	return pool.oraclePriceValid && timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), oraclePriceExpiry(pool), options)
}

function ethRouterDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, seed: number) {
	const question = questionDeadline(snapshot, pool, seed)
	if (question === undefined) return undefined
	const questionBound = BigInt(question)
	const oracleBound = oraclePriceExpiry(pool)
	const deadline = questionBound < oracleBound ? questionBound : oracleBound
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options) ? deadline.toString() : undefined
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

function directLiquidityReady(snapshot: EcosystemSnapshot, pair: PairSnapshot, kind: DirectLiquidityKind, options: PlanningOptions) {
	if (kind === 'remove') return removableLiquidity(pair) > 0n
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
	if (pool === undefined || shares === undefined) return false
	const prerequisiteCount = shareApproval(shares, pair.address, snapshot.wallet.address).length
	if (!poolLifecycleOpen(snapshot, pool, options, prerequisiteCount)) return false
	const available = amount(shares.yes) < amount(shares.no) ? amount(shares.yes) : amount(shares.no)
	const spend = available > 10n ** 15n ? 10n ** 15n : available
	if (kind === 'initialize') return pair.status === 6 && amount(pair.effectiveYesReserve) === 0n && amount(pair.effectiveNoReserve) === 0n && spend > 1_000n
	return pair.status === 0 && proportionalLiquidity(pair, spend, spend) !== undefined
}

function buildDirectShareLiquidityPlan(
	snapshot: EcosystemSnapshot,
	options: PlanningOptions,
	pair: PairSnapshot,
	kind: Exclude<DirectLiquidityKind, 'remove'>,
	id: string,
	method: 'addLiquidity' | 'initialize',
	shareAmount: bigint,
	minimumLiquidity: bigint,
	metadata: OperationPlan['metadata'],
	confirmedApproval = false,
	approvalStepId?: string,
) {
	if (shareAmount > 10n ** 15n) return undefined
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
	if (pool === undefined || shares === undefined || amount(shares.yes) < shareAmount || amount(shares.no) < shareAmount) return undefined
	const steps = shareApproval(shares, pair.address, snapshot.wallet.address, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	if (!poolLifecycleOpen(snapshot, pool, options, steps.length)) return undefined
	let expectedLiquidity: bigint | undefined
	let signature: string
	if (kind === 'initialize') {
		if (pair.status !== 6 || amount(pair.effectiveYesReserve) !== 0n || amount(pair.effectiveNoReserve) !== 0n || shareAmount <= 1_000n) return undefined
		expectedLiquidity = shareAmount - 1_000n
		signature = 'LiquidityInitialized(address,address,uint256,uint256,uint256)'
	} else {
		if (pair.status !== 0) return undefined
		expectedLiquidity = proportionalLiquidity(pair, shareAmount, shareAmount)?.liquidity
		signature = 'LiquidityAdded(address,address,uint256,uint256,uint256)'
	}
	if (expectedLiquidity === undefined || expectedLiquidity < minimumLiquidity) return undefined
	steps.push(
		encodeStep({
			abi: tradingPairAbi,
			args: [shareAmount, shareAmount, minimumLiquidity, snapshot.wallet.address],
			evidence: [eventEvidence(pair.address, signature)],
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

function buildDirectShareLiquidityContinuation(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, kind: Exclude<DirectLiquidityKind, 'remove'>, id: string, method: 'addLiquidity' | 'initialize') {
	if (context.continuationDisposition === 'cleanup-only') return shareApprovalCleanup(snapshot, context)
	const shareAmount = metadataPositiveAmount(context.previousPlan.metadata, 'shareAmount')
	const minimumLiquidity = metadataPositiveAmount(context.previousPlan.metadata, 'minimumLiquidity')
	const pair = metadataPair(snapshot, context.previousPlan.metadata)
	if (pair === undefined || shareAmount === undefined || minimumLiquidity === undefined || !previousDirectActionMatches(snapshot, context, pair, method, shareAmount, minimumLiquidity)) return shareApprovalCleanup(snapshot, context)
	const approval = confirmedShareApproval(context, pair.address)
	if (approval === undefined && hasConfirmedShareApprovalStep(context)) return shareApprovalCleanup(snapshot, context)
	return buildDirectShareLiquidityPlan(snapshot, options, pair, kind, id, method, shareAmount, minimumLiquidity, context.previousPlan.metadata, approval !== undefined, approval === undefined ? undefined : nextShareApprovalStepId(context, pair.address)) ?? shareApprovalCleanup(snapshot, context)
}

function shareApproval(inventory: ShareInventory, operator: `0x${string}`, owner: `0x${string}`, stepId = `approve-shares-${operator}`) {
	const approved = Object.entries(inventory.isApprovedForAll).find(([address]) => address.toLowerCase() === operator.toLowerCase())?.[1] ?? false
	if (approved) return []
	return [
		encodeStep({
			abi: erc1155Abi,
			args: [operator, true],
			evidence: [{ abi: 'function isApprovedForAll(address account, address operator) view returns (bool)', args: [owner, operator], contract: inventory.shareToken, expected: 'true', functionName: 'isApprovedForAll', kind: 'storage-postcondition', relation: 'equals' }],
			functionName: 'setApprovalForAll',
			id: stepId,
			label: 'Approve outcome shares',
			to: inventory.shareToken,
		}),
	]
}

function metadataAddress(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined
}

function metadataPositiveAmount(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined
	return BigInt(value)
}

function metadataOutcome(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return value === 1 || value === 2 ? value : undefined
}

function metadataPair(snapshot: EcosystemSnapshot, metadata: OperationPlan['metadata']) {
	const pairAddress = metadataAddress(metadata, 'pair')
	const poolAddress = metadataAddress(metadata, 'pool')
	if (pairAddress === undefined || poolAddress === undefined) return undefined
	return snapshot.pairs.find(candidate => candidate.address.toLowerCase() === pairAddress.toLowerCase() && candidate.pool.toLowerCase() === poolAddress.toLowerCase())
}

function previousAction(context: OperationContinuationContext, id: string) {
	return context.previousPlan.steps.find(step => step.id === id)
}

function sameAddress(value: unknown, expected: Address) {
	return typeof value === 'string' && isAddress(value) && value.toLowerCase() === expected.toLowerCase()
}

function previousDirectActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, method: 'addLiquidity' | 'initialize', shareAmount: bigint, minimumLiquidity: bigint) {
	const step = previousAction(context, method)
	if (step === undefined || step.to.toLowerCase() !== pair.address.toLowerCase()) return false
	try {
		const call = decodeFunctionData({ abi: tradingPairAbi, data: step.data })
		if (method === 'initialize') {
			return call.functionName === 'initialize' && call.args[0] === shareAmount && call.args[1] === shareAmount && call.args[2] === minimumLiquidity && sameAddress(call.args[3], snapshot.wallet.address)
		}
		return call.functionName === 'addLiquidity' && call.args[0] === shareAmount && call.args[1] === shareAmount && call.args[2] === minimumLiquidity && sameAddress(call.args[3], snapshot.wallet.address)
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

function previousSwapActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, mode: 'exact-input' | 'exact-output', yesForNo: boolean, principal: bigint, bound: bigint) {
	const method = mode === 'exact-input' ? 'swapExactInput' : 'swapExactOutput'
	const step = previousAction(context, method)
	if (step === undefined || step.to.toLowerCase() !== pair.address.toLowerCase()) return false
	try {
		const call = decodeFunctionData({ abi: tradingPairAbi, data: step.data })
		if (mode === 'exact-input') {
			return call.functionName === 'swapExactInput' && call.args[0] === yesForNo && call.args[1] === principal && call.args[2] === bound && sameAddress(call.args[3], snapshot.wallet.address)
		}
		return call.functionName === 'swapExactOutput' && call.args[0] === yesForNo && call.args[1] === principal && call.args[2] === bound && sameAddress(call.args[3], snapshot.wallet.address)
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

function previousRouterRemoveActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, router: Address, liquidity: bigint, minimumYes: bigint, minimumNo: bigint) {
	const step = previousAction(context, 'removeLiquidity')
	if (step === undefined || step.to.toLowerCase() !== router.toLowerCase()) return false
	try {
		const call = decodeFunctionData({ abi: tradingRouterAbi, data: step.data })
		return call.functionName === 'removeLiquidity' && sameAddress(call.args[0], pair.address) && call.args[1] === liquidity && call.args[2] === minimumYes && call.args[3] === minimumNo && sameAddress(call.args[4], snapshot.wallet.address)
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

function previousRouterRedeemActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pool: PoolSnapshot, router: Address, completeAmount: bigint, minimumEthAttoEth: bigint) {
	const step = previousAction(context, 'redeemCompleteSet')
	if (step === undefined || step.to.toLowerCase() !== router.toLowerCase()) return false
	try {
		const call = decodeFunctionData({ abi: tradingRouterAbi, data: step.data })
		return call.functionName === 'redeemCompleteSet' && sameAddress(call.args[0], pool.address) && call.args[1] === completeAmount && call.args[2] === minimumEthAttoEth && sameAddress(call.args[3], snapshot.wallet.address)
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

function previousRouterExitActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, router: Address, longOutcome: 1 | 2, completeAmount: bigint, maximumLong: bigint, minimumEthAttoEth: bigint) {
	const step = previousAction(context, 'exitPosition')
	if (step === undefined || step.to.toLowerCase() !== router.toLowerCase()) return false
	try {
		const call = decodeFunctionData({ abi: tradingRouterAbi, data: step.data })
		return call.functionName === 'exitPosition' && sameAddress(call.args[0], pair.address) && call.args[1] === BigInt(longOutcome) && call.args[2] === completeAmount && call.args[3] === maximumLong && call.args[4] === minimumEthAttoEth && sameAddress(call.args[5], snapshot.wallet.address)
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

function longOutcome(longYes: boolean): 1 | 2 {
	return longYes ? 1 : 2
}

function confirmedShareApproval(context: OperationContinuationContext, expectedOperator?: Address) {
	const confirmed = new Set(context.confirmedStepIds)
	const approvalSteps = context.previousPlan.steps.filter(step => confirmed.has(step.id) && (step.id.startsWith('approve-shares-') || step.id.startsWith('reapprove-shares-')))
	const approvals = approvalSteps.flatMap(step => {
		const idOperator = step.id.slice(-42)
		if (!isAddress(idOperator)) return []
		try {
			const call = decodeFunctionData({ abi: erc1155Abi, data: step.data })
			const calldataOperator = call.functionName === 'setApprovalForAll' ? call.args[0] : undefined
			const approved = call.functionName === 'setApprovalForAll' ? call.args[1] : undefined
			if (typeof calldataOperator !== 'string' || !isAddress(calldataOperator) || approved !== true) return []
			const normalized = getAddress(calldataOperator)
			if (normalized.toLowerCase() !== idOperator.toLowerCase() || (expectedOperator !== undefined && normalized.toLowerCase() !== expectedOperator.toLowerCase())) return []
			return [{ operator: normalized, token: step.to }]
		} catch (error) {
			if (error instanceof Error) return []
			throw error
		}
	})
	if (approvals.length !== approvalSteps.length) return undefined
	const unique = [...new Map(approvals.map(approval => [`${approval.token.toLowerCase()}:${approval.operator.toLowerCase()}`, approval])).values()]
	return unique.length === 1 ? unique[0] : undefined
}

function hasConfirmedShareApprovalStep(context: OperationContinuationContext) {
	const confirmed = new Set(context.confirmedStepIds)
	return context.previousPlan.steps.some(step => confirmed.has(step.id) && (step.id.startsWith('approve-shares-') || step.id.startsWith('reapprove-shares-')))
}

function confirmedLpApproval(context: OperationContinuationContext) {
	const confirmed = new Set(context.confirmedStepIds)
	const approvals = context.previousPlan.steps.filter(step => confirmed.has(step.id) && (step.id === 'approve-lp' || step.id.startsWith('reapprove-lp-')))
	const decoded = approvals.flatMap(approval => {
		try {
			const call = decodeFunctionData({ abi: tradingPairAbi, data: approval.data })
			const spender = call.functionName === 'approve' ? call.args[0] : undefined
			return typeof spender === 'string' && isAddress(spender) ? [{ spender: getAddress(spender), token: approval.to }] : []
		} catch (error) {
			if (error instanceof Error) return []
			throw error
		}
	})
	if (decoded.length !== approvals.length) return undefined
	const unique = [...new Map(decoded.map(approval => [`${approval.token.toLowerCase()}:${approval.spender.toLowerCase()}`, approval])).values()]
	return unique.length === 1 ? unique[0] : undefined
}

function hasConfirmedLpApprovalStep(context: OperationContinuationContext) {
	const confirmed = new Set(context.confirmedStepIds)
	return context.previousPlan.steps.some(step => confirmed.has(step.id) && (step.id === 'approve-lp' || step.id.startsWith('reapprove-lp-')))
}

function nextShareApprovalStepId(context: OperationContinuationContext, operator: Address) {
	const confirmed = new Set(context.confirmedStepIds)
	const reusable = context.previousPlan.steps.find(step => !confirmed.has(step.id) && step.id.startsWith('reapprove-shares-') && step.id.slice(-42).toLowerCase() === operator.toLowerCase())
	if (reusable !== undefined) return reusable.id
	let ordinal = 1
	while (context.previousPlan.steps.some(step => step.id === `reapprove-shares-${ordinal}-${operator}`)) ordinal += 1
	return `reapprove-shares-${ordinal}-${operator}`
}

function nextLpApprovalStepId(context: OperationContinuationContext) {
	const confirmed = new Set(context.confirmedStepIds)
	const reusable = context.previousPlan.steps.find(step => !confirmed.has(step.id) && step.id.startsWith('reapprove-lp-'))
	if (reusable !== undefined) return reusable.id
	let ordinal = 1
	while (context.previousPlan.steps.some(step => step.id === `reapprove-lp-${ordinal}`)) ordinal += 1
	return `reapprove-lp-${ordinal}`
}

function shareApprovalCleanup(snapshot: EcosystemSnapshot, context: OperationContinuationContext): OperationPlanDraft | undefined {
	const approval = confirmedShareApproval(context)
	if (approval === undefined) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'trading',
		label: `Clean up ${context.previousPlan.label}`,
		metadata: context.previousPlan.metadata,
		postconditions: ['The workflow-owned outcome-share operator approval is revoked'],
		risk: 'medium',
		snapshot,
		steps: [
			encodeStep({
				abi: erc1155Abi,
				args: [approval.operator, false],
				evidence: [
					{
						abi: 'function isApprovedForAll(address account, address operator) view returns (bool)',
						args: [snapshot.wallet.address, approval.operator],
						contract: approval.token,
						expected: 'false',
						functionName: 'isApprovedForAll',
						kind: 'storage-postcondition',
						relation: 'equals',
					},
				],
				functionName: 'setApprovalForAll',
				id: `revoke-shares-${approval.operator}`,
				label: 'Revoke outcome-share approval',
				to: approval.token,
			}),
		],
	})
}

function lpApprovalCleanup(snapshot: EcosystemSnapshot, context: OperationContinuationContext): OperationPlanDraft | undefined {
	const approval = confirmedLpApproval(context)
	if (approval === undefined) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'trading',
		label: `Clean up ${context.previousPlan.label}`,
		metadata: context.previousPlan.metadata,
		postconditions: ['The workflow-owned LP allowance is zero'],
		risk: 'medium',
		snapshot,
		steps: [
			encodeStep({
				abi: tradingPairAbi,
				args: [approval.spender, 0n],
				evidence: [
					{
						abi: 'function allowance(address owner, address spender) view returns (uint256)',
						args: [snapshot.wallet.address, approval.spender],
						contract: approval.token,
						expected: '0',
						functionName: 'allowance',
						kind: 'storage-postcondition',
						relation: 'equals',
					},
				],
				functionName: 'approve',
				id: 'revoke-lp',
				label: 'Revoke LP allowance',
				to: approval.token,
			}),
		],
	})
}

const createPair: OperationDefinition = {
	buildPlan(snapshot, options) {
		const paired = new Set(snapshot.pairs.map(pair => pair.pool.toLowerCase()))
		const pool = choose(
			snapshot.pools.filter(candidate => !paired.has(candidate.address.toLowerCase()) && (options.genesisInitializationTarget?.pool === undefined || candidate.address.toLowerCase() === options.genesisInitializationTarget.pool.toLowerCase())),
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
				snapshot.pairs.filter(candidate => directLiquidityReady(snapshot, candidate, kind, options)),
				mixSeed(options.seed, id),
			)
			if (pair === undefined) return undefined
			const pool = poolForPair(snapshot, pair)
			if (pool === undefined) return undefined
			if (kind !== 'remove') {
				const shares = shareForPool(snapshot, pool)
				if (shares === undefined) return undefined
				const available = amount(shares.yes) < amount(shares.no) ? amount(shares.yes) : amount(shares.no)
				const shareAmount = available > 10n ** 15n ? 10n ** 15n : available
				const expectedLiquidity = kind === 'initialize' ? shareAmount - 1_000n : proportionalLiquidity(pair, shareAmount, shareAmount)?.liquidity
				if (expectedLiquidity === undefined || expectedLiquidity <= 0n) return undefined
				const minimumLiquidity = minimumAfterSlippage(expectedLiquidity)
				const shareMethod = kind === 'initialize' ? 'initialize' : 'addLiquidity'
				return buildDirectShareLiquidityPlan(snapshot, options, pair, kind, id, shareMethod, shareAmount, minimumLiquidity, { minimumLiquidity: minimumLiquidity.toString(), pair: pair.address, pool: pool.address, shareAmount: shareAmount.toString() })
			}
			const liquidity = removableLiquidity(pair)
			const quote = removableLiquidityQuote(pair, liquidity)
			if (quote === undefined) return undefined
			return planBase({
				definitionId: id,
				ecosystem: 'trading',
				label: `${kind} share liquidity`,
				metadata: { pair: pair.address },
				postconditions: ['Pair reserves and wallet LP balance change consistently'],
				risk: 'medium',
				snapshot,
				steps: [
					encodeStep({
						abi: tradingPairAbi,
						args: [liquidity, minimumAfterSlippage(quote.yesOut), minimumAfterSlippage(quote.noOut), snapshot.wallet.address],
						evidence: [eventEvidence(pair.address, 'LiquidityRemoved(address,address,uint256,uint256,uint256)')],
						functionName: method,
						id: method,
						label: `${kind} direct liquidity`,
						to: pair.address,
						walletAssetDebits: [erc20WalletDebit(pair.address, liquidity, 'lp-token')],
					}),
				],
			})
		},
		...(kind === 'remove'
			? {}
			: {
					buildContinuationPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext) {
						return buildDirectShareLiquidityContinuation(snapshot, options, context, kind, id, kind === 'initialize' ? 'initialize' : 'addLiquidity')
					},
				}),
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

function buildSwapPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, mode: 'exact-input' | 'exact-output', yesForNo: boolean, principal: bigint, bound: bigint, metadata: OperationPlan['metadata'], confirmedApproval = false, approvalStepId?: string) {
	if ((mode === 'exact-input' && principal > 10n ** 15n) || (mode === 'exact-output' && bound > 10n ** 15n) || pair.status !== 0) return undefined
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
	if (pool === undefined || shares === undefined) return undefined
	const steps = shareApproval(shares, pair.address, snapshot.wallet.address, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	if (!poolLifecycleOpen(snapshot, pool, options, steps.length)) return undefined
	const inputBalance = amount(yesForNo ? shares.yes : shares.no)
	let args: readonly unknown[]
	let maximumInput: bigint
	if (mode === 'exact-input') {
		if (inputBalance < principal || quoteExactInput(pair, yesForNo, principal) < bound) return undefined
		maximumInput = principal
		args = [yesForNo, principal, bound, snapshot.wallet.address]
	} else {
		const requiredInput = quoteExactOutput(pair, yesForNo, principal)
		if (requiredInput === undefined || requiredInput > bound || inputBalance < bound) return undefined
		maximumInput = bound
		args = [yesForNo, principal, bound, snapshot.wallet.address]
	}
	const method = mode === 'exact-input' ? 'swapExactInput' : 'swapExactOutput'
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

function buildSwapContinuation(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, mode: 'exact-input' | 'exact-output') {
	if (context.continuationDisposition === 'cleanup-only') return shareApprovalCleanup(snapshot, context)
	const direction = context.previousPlan.metadata['direction']
	let yesForNo: boolean | undefined
	if (direction === 'YES-to-NO') yesForNo = true
	else if (direction === 'NO-to-YES') yesForNo = false
	const principal = metadataPositiveAmount(context.previousPlan.metadata, mode === 'exact-input' ? 'inputAmount' : 'outputAmount')
	const bound = metadataPositiveAmount(context.previousPlan.metadata, mode === 'exact-input' ? 'minimumOutput' : 'maximumInput')
	const pair = metadataPair(snapshot, context.previousPlan.metadata)
	if (pair === undefined || yesForNo === undefined || principal === undefined || bound === undefined || !previousSwapActionMatches(snapshot, context, pair, mode, yesForNo, principal, bound)) return shareApprovalCleanup(snapshot, context)
	const approval = confirmedShareApproval(context, pair.address)
	if (approval === undefined && hasConfirmedShareApprovalStep(context)) return shareApprovalCleanup(snapshot, context)
	return buildSwapPlan(snapshot, options, pair, mode, yesForNo, principal, bound, context.previousPlan.metadata, approval !== undefined, approval === undefined ? undefined : nextShareApprovalStepId(context, pair.address)) ?? shareApprovalCleanup(snapshot, context)
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
				if (pool === undefined || shares === undefined || !poolLifecycleOpen(snapshot, pool, options, shareApproval(shares, pair.address, snapshot.wallet.address).length)) return []
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
			const { maximumInput, pair, pool, quote, spend, yesForNo } = candidate
			const direction = yesForNo ? 'YES-to-NO' : 'NO-to-YES'
			return mode === 'exact-input'
				? buildSwapPlan(snapshot, options, pair, mode, yesForNo, spend, minimumAfterSlippage(quote), { direction, inputAmount: spend.toString(), minimumOutput: minimumAfterSlippage(quote).toString(), pair: pair.address, pool: pool.address })
				: buildSwapPlan(snapshot, options, pair, mode, yesForNo, 1n, maximumInput, { direction, maximumInput: maximumInput.toString(), outputAmount: '1', pair: pair.address, pool: pool.address })
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
				const pool = poolForPair(snapshot, pair)
				const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
				if (pair.status !== 0 || pool === undefined || shares === undefined || !poolLifecycleOpen(snapshot, pool, options, shareApproval(shares, pair.address, snapshot.wallet.address).length)) return false
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
							snapshot.pools.filter(candidate => !paired.has(candidate.address.toLowerCase()) && poolLifecycleOpen(snapshot, candidate, options) && ethRouterOraclePriceIsSafe(snapshot, candidate, options) && canCreateCompleteSet(candidate, spend) && ethToShares(candidate, spend) > 1_000n),
							mixSeed(options.seed, id),
						)
					: undefined
			const pair =
				kind === 'create-and-initialize'
					? undefined
					: choose(
							snapshot.pairs.filter(candidate => {
								if (options.genesisInitializationTarget?.pair !== undefined && candidate.address.toLowerCase() !== options.genesisInitializationTarget.pair.toLowerCase()) return false
								if (candidate.status !== (kind === 'initialize' ? 6 : 0)) return false
								const candidatePool = poolForPair(snapshot, candidate)
								if (candidatePool === undefined || !poolLifecycleOpen(snapshot, candidatePool, options) || !ethRouterOraclePriceIsSafe(snapshot, candidatePool, options) || !canCreateCompleteSet(candidatePool, spend)) return false
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
			const deadline = ethRouterDeadline(snapshot, candidatePool, options, mixSeed(options.seed, `${id}:deadline`))
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
					? snapshot.pools.some(pool => !paired.has(pool.address.toLowerCase()) && poolLifecycleOpen(snapshot, pool, options) && ethRouterOraclePriceIsSafe(snapshot, pool, options) && canCreateCompleteSet(pool, spend) && ethToShares(pool, spend) > 1_000n)
					: snapshot.pairs.some(pair => {
							if (pair.status !== (kind === 'initialize' ? 6 : 0)) return false
							const pool = poolForPair(snapshot, pair)
							if (pool === undefined || !poolLifecycleOpen(snapshot, pool, options) || !ethRouterOraclePriceIsSafe(snapshot, pool, options) || !canCreateCompleteSet(pool, spend)) return false
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

function lpApproval(snapshot: EcosystemSnapshot, pair: PairSnapshot, liquidity: bigint, stepId = 'approve-lp') {
	const inventory = snapshot.wallet.lpTokens.find(candidate => candidate.pair.toLowerCase() === pair.address.toLowerCase())
	if (amount(inventory?.allowanceToRouter ?? '0') >= liquidity) return []
	return [
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
			id: stepId,
			label: 'Approve LP token',
			to: pair.address,
		}),
	]
}

function buildRouterRemovePlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, liquidity: bigint, minimumYes: bigint, minimumNo: bigint, metadata: OperationPlan['metadata'], confirmedApproval = false, approvalStepId?: string) {
	if (liquidity > 10n ** 15n || amount(pair.walletLiquidity) < liquidity) return undefined
	const inventory = snapshot.wallet.lpTokens.find(candidate => candidate.pair.toLowerCase() === pair.address.toLowerCase())
	const quote = removableLiquidityQuote(pair, liquidity)
	if (inventory === undefined || amount(inventory.balance) < liquidity || quote === undefined || quote.yesOut < minimumYes || quote.noOut < minimumNo) return undefined
	const steps = lpApproval(snapshot, pair, liquidity, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	const deadline = randomDeadline(snapshot, mixSeed(options.seed, 'trading.liquidity.remove:deadline'))
	if (!timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), BigInt(deadline), options, steps.length)) return undefined
	steps.push(
		encodeStep({
			abi: tradingRouterAbi,
			args: [pair.address, liquidity, minimumYes, minimumNo, snapshot.wallet.address, BigInt(deadline)],
			evidence: [eventEvidence(pair.address, 'LiquidityRemoved(address,address,uint256,uint256,uint256)')],
			functionName: 'removeLiquidity',
			id: 'removeLiquidity',
			label: 'Router remove',
			to: snapshot.deployments.tradingRouter,
			walletAssetDebits: [erc20WalletDebit(pair.address, liquidity, 'lp-token')],
		}),
	)
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: 'trading.liquidity.remove',
		ecosystem: 'trading',
		label: 'Router remove',
		maximumCleanupTransactionCount,
		metadata,
		postconditions: ['LP balance decreases and outcome shares return'],
		risk: 'medium',
		snapshot,
		steps,
	})
}

function buildRouterRedeemPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, completeAmount: bigint, minimumEthAttoEth: bigint, metadata: OperationPlan['metadata'], confirmedApproval = false, approvalStepId?: string) {
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
	const universe = pool === undefined ? undefined : snapshot.universes.find(candidate => candidate.id === pool.universeId)
	if (pool === undefined || shares === undefined || pool.systemState !== 0 || universe?.forkTime !== '0') return undefined
	if (amount(shares.invalid) < completeAmount || amount(shares.yes) < completeAmount || amount(shares.no) < completeAmount || sharesToEth(pool, completeAmount) < minimumEthAttoEth) return undefined
	const steps = shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	const deadline = randomDeadline(snapshot, mixSeed(options.seed, 'trading.complete-set.redeem:deadline'))
	if (!timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), BigInt(deadline), options, steps.length)) return undefined
	steps.push(
		encodeStep({
			abi: tradingRouterAbi,
			args: [pool.address, completeAmount, minimumEthAttoEth, snapshot.wallet.address, BigInt(deadline)],
			evidence: [eventEvidence(pool.address, 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)')],
			functionName: 'redeemCompleteSet',
			id: 'redeemCompleteSet',
			label: 'Router redeem',
			to: snapshot.deployments.tradingRouter,
			walletAssetDebits: [0, 1, 2].map(outcome => erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, outcome), completeAmount)),
		}),
	)
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: 'trading.complete-set.redeem',
		ecosystem: 'trading',
		label: 'Router redeem',
		maximumCleanupTransactionCount,
		metadata,
		postconditions: ['Complete sets redeem to ETH and wallet share balances decrease'],
		risk: 'medium',
		snapshot,
		steps,
	})
}

function buildRouterExitPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, pair: PairSnapshot, longOutcome: 1 | 2, completeAmount: bigint, maximumLong: bigint, minimumEthAttoEth: bigint, metadata: OperationPlan['metadata'], confirmedApproval = false, approvalStepId?: string) {
	const pool = poolForPair(snapshot, pair)
	const shares = pool === undefined ? undefined : shareForPool(snapshot, pool)
	if (pool === undefined || shares === undefined || pair.status !== 0 || amount(shares.invalid) < completeAmount || amount(longOutcome === 1 ? shares.yes : shares.no) < maximumLong) return undefined
	const steps = shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address, approvalStepId)
	const maximumCleanupTransactionCount = steps.length > 0 || confirmedApproval ? 1 : undefined
	if (!poolLifecycleOpen(snapshot, pool, options, steps.length)) return undefined
	const requiredSwapInput = quoteExactOutput(pair, longOutcome === 1, completeAmount)
	if (requiredSwapInput === undefined || requiredSwapInput + completeAmount > maximumLong || sharesToEth(pool, completeAmount) < minimumEthAttoEth) return undefined
	const deadline = questionDeadline(snapshot, pool, mixSeed(options.seed, 'trading.position.exit:deadline'))
	if (deadline === undefined || !timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), BigInt(deadline), options, steps.length)) return undefined
	steps.push(
		encodeStep({
			abi: tradingRouterAbi,
			args: [pair.address, longOutcome, completeAmount, maximumLong, minimumEthAttoEth, snapshot.wallet.address, BigInt(deadline)],
			evidence: [eventEvidence(pair.address, 'Swap(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256)'), eventEvidence(pool.address, 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)')],
			functionName: 'exitPosition',
			id: 'exitPosition',
			label: 'Router exit',
			to: snapshot.deployments.tradingRouter,
			walletAssetDebits: [erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, 0), completeAmount), erc1155WalletDebit(shares.shareToken, shareTokenId(shares.universeId, longOutcome), maximumLong)],
		}),
	)
	return planBase({
		deadlineTimestamp: deadline,
		definitionId: 'trading.position.exit',
		ecosystem: 'trading',
		label: 'Router exit',
		maximumCleanupTransactionCount,
		metadata,
		postconditions: ['Complete sets redeem to ETH and wallet share balances decrease'],
		risk: 'medium',
		snapshot,
		steps,
	})
}

function buildRouterOwnedContinuation(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext, kind: 'exit' | 'redeem' | 'remove') {
	const cleanup = () => (kind === 'remove' ? lpApprovalCleanup(snapshot, context) : shareApprovalCleanup(snapshot, context))
	if (context.continuationDisposition === 'cleanup-only') return cleanup()
	const routerAddress = metadataAddress(context.previousPlan.metadata, 'router')
	const pair = metadataPair(snapshot, context.previousPlan.metadata)
	if (pair === undefined || routerAddress === undefined || routerAddress.toLowerCase() !== snapshot.deployments.tradingRouter.toLowerCase()) return cleanup()
	if (kind === 'remove') {
		const liquidity = metadataPositiveAmount(context.previousPlan.metadata, 'liquidity')
		const minimumYes = metadataPositiveAmount(context.previousPlan.metadata, 'minimumYes')
		const minimumNo = metadataPositiveAmount(context.previousPlan.metadata, 'minimumNo')
		if (liquidity === undefined || minimumYes === undefined || minimumNo === undefined || !previousRouterRemoveActionMatches(snapshot, context, pair, routerAddress, liquidity, minimumYes, minimumNo)) return cleanup()
		const approval = confirmedLpApproval(context)
		if (approval === undefined && hasConfirmedLpApprovalStep(context)) return cleanup()
		return buildRouterRemovePlan(snapshot, options, pair, liquidity, minimumYes, minimumNo, context.previousPlan.metadata, approval !== undefined, approval === undefined ? undefined : nextLpApprovalStepId(context)) ?? cleanup()
	}
	const completeAmount = metadataPositiveAmount(context.previousPlan.metadata, 'completeAmount')
	const minimumEthAttoEth = metadataPositiveAmount(context.previousPlan.metadata, 'minimumEthAttoEth')
	const pool = poolForPair(snapshot, pair)
	if (completeAmount === undefined || minimumEthAttoEth === undefined || pool === undefined) return cleanup()
	const approval = confirmedShareApproval(context, snapshot.deployments.tradingRouter)
	if (approval === undefined && hasConfirmedShareApprovalStep(context)) return cleanup()
	const approvalStepId = approval === undefined ? undefined : nextShareApprovalStepId(context, snapshot.deployments.tradingRouter)
	if (kind === 'redeem') {
		if (!previousRouterRedeemActionMatches(snapshot, context, pool, routerAddress, completeAmount, minimumEthAttoEth)) return cleanup()
		return buildRouterRedeemPlan(snapshot, options, pair, completeAmount, minimumEthAttoEth, context.previousPlan.metadata, approval !== undefined, approvalStepId) ?? cleanup()
	}
	const longOutcome = metadataOutcome(context.previousPlan.metadata, 'longOutcome')
	const maximumLong = metadataPositiveAmount(context.previousPlan.metadata, 'maximumLong')
	if (longOutcome === undefined || maximumLong === undefined || !previousRouterExitActionMatches(snapshot, context, pair, routerAddress, longOutcome, completeAmount, maximumLong, minimumEthAttoEth)) return cleanup()
	return buildRouterExitPlan(snapshot, options, pair, longOutcome, completeAmount, maximumLong, minimumEthAttoEth, context.previousPlan.metadata, approval !== undefined, approvalStepId) ?? cleanup()
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
					if (candidate.status !== 0 || !poolLifecycleOpen(snapshot, pool, options, shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address).length)) return false
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
			if (kind === 'remove') {
				const liquidity = removableLiquidity(pair)
				const quote = removableLiquidityQuote(pair, liquidity)
				if (quote === undefined) return undefined
				const minimumYes = minimumAfterSlippage(quote.yesOut)
				const minimumNo = minimumAfterSlippage(quote.noOut)
				return buildRouterRemovePlan(snapshot, options, pair, liquidity, minimumYes, minimumNo, { liquidity: liquidity.toString(), minimumNo: minimumNo.toString(), minimumYes: minimumYes.toString(), pair: pair.address, pool: pool.address, router: snapshot.deployments.tradingRouter })
			}
			const shares = shareForPool(snapshot, pool)
			if (shares === undefined) return undefined
			if (kind === 'redeem') {
				const completeAmount = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
				const minimumEthAttoEth = minimumAfterSlippage(sharesToEth(pool, completeAmount))
				return buildRouterRedeemPlan(snapshot, options, pair, completeAmount, minimumEthAttoEth, { completeAmount: completeAmount.toString(), minimumEthAttoEth: minimumEthAttoEth.toString(), pair: pair.address, pool: pool.address, router: snapshot.deployments.tradingRouter })
			}
			const completeAmount = minimumPositivePayoutShares(pool)
			if (completeAmount === undefined || amount(shares.invalid) < completeAmount) return undefined
			const routes = [true, false].flatMap(longYes => {
				const requiredSwapInput = quoteExactOutput(pair, longYes, completeAmount)
				const longBalance = amount(longYes ? shares.yes : shares.no)
				const maximumSwapInput = requiredSwapInput === undefined ? undefined : maximumAfterSlippage(requiredSwapInput)
				return maximumSwapInput !== undefined && longBalance >= completeAmount + maximumSwapInput ? [{ longOutcome: longOutcome(longYes), maximumLong: completeAmount + maximumSwapInput }] : []
			})
			const route = choose(routes, mixSeed(options.seed, `${id}:direction`))
			if (route === undefined) return undefined
			const minimumEthAttoEth = minimumAfterSlippage(sharesToEth(pool, completeAmount))
			return buildRouterExitPlan(snapshot, options, pair, route.longOutcome, completeAmount, route.maximumLong, minimumEthAttoEth, {
				completeAmount: completeAmount.toString(),
				longOutcome: route.longOutcome,
				maximumLong: route.maximumLong.toString(),
				minimumEthAttoEth: minimumEthAttoEth.toString(),
				pair: pair.address,
				pool: pool.address,
				router: snapshot.deployments.tradingRouter,
			})
		},
		buildContinuationPlan(snapshot, options, context) {
			return buildRouterOwnedContinuation(snapshot, options, context, kind)
		},
		classification: 'selectable',
		contract: 'TwoWayConstantProductRouter',
		description: `Executes router ${kind} using only wallet-owned LP/outcome inventory.`,
		discoveryInputs: ['wallet shares/LP balance and approvals', 'pair lifecycle'],
		ecosystem: 'trading',
		evaluate(snapshot, options) {
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
				if (pair.status !== 0 || !poolLifecycleOpen(snapshot, pool, options, shareApproval(shares, snapshot.deployments.tradingRouter, snapshot.wallet.address).length)) return false
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

function shareMigrationRouteAvailability(snapshot: EcosystemSnapshot, pool: PoolSnapshot, targetOutcome: string, options: PlanningOptions): { deadline?: bigint } | undefined {
	const childExists = snapshot.pools.some(child => child.parent.toLowerCase() === pool.address.toLowerCase() && child.forkOutcomeIndex === targetOutcome)
	if (childExists || pool.systemState === 0) return {}
	const activation = amount(pool.forkActivationTime)
	if (activation === 0n) return undefined
	const deadline = activation + FORK_MIGRATION_WINDOW_SECONDS
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options) ? { deadline } : undefined
}

function shareMigrationRoutes(snapshot: EcosystemSnapshot, options: PlanningOptions): ShareMigrationRoute[] {
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
				const availability = shareMigrationRouteAvailability(snapshot, pool, targetOutcome, options)
				return availability === undefined ? [] : [{ ...availability, fromId: shareTokenId(pool.universeId, sourceOutcome), shares, sourceBalance, targetOutcome }]
			})
		})
	})
}

const migrateShares: OperationDefinition = {
	buildPlan(snapshot, options) {
		const route = choose(shareMigrationRoutes(snapshot, options), mixSeed(options.seed, migrateShares.id))
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
		const found = shareMigrationRoutes(snapshot, options).length > 0
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
	deployTradingFactory,
	deployTradingRouter,
	deployGenesisUniswapSeeder,
	createGenesisUniswapPool,
	initializeGenesisUniswapPool,
	seedGenesisUniswapPool,
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
