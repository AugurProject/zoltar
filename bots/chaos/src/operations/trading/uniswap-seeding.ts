import { canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { erc20Abi, genesisUniswapV3FactoryAbi, genesisUniswapV3PoolStateAbi, genesisUniswapV3SeederAbi } from '@zoltar/bot-shared/contracts/abi'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { CANONICAL_PROXY_DEPLOYER, GENESIS_UNISWAP_FEE, GENESIS_UNISWAP_SQRT_PRICE_X96, GENESIS_UNISWAP_TICK_LOWER, GENESIS_UNISWAP_TICK_UPPER, genesisUniswapSeederDeployment } from '../../core/genesis-uniswap.ts'
import { allowance, amount, eligible, encodeStep, erc20AllowanceEvidence, erc20WalletDebit, optionAmount, planBase, tokenInventory } from '../planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationPlanDraft, PlanningOptions } from '../types.ts'
import { metadataAddress } from './continuations.ts'
import { minimumOf } from './pricing.ts'
import { deploymentStep } from './roots.ts'

type SeedScope = 'genesis' | 'universe'

const GET_POOL_ABI = 'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)'
const MAXIMUM_SEED_AMOUNT = 10n ** 15n

export const deployGenesisUniswapSeeder: OperationDefinition = {
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
			steps: [deploymentStep('deploy-genesis-uniswap-seeder', 'Deploy Uniswap V3 seeding helper', CANONICAL_PROXY_DEPLOYER, deployment.data, [{ kind: 'receipt-success' }])],
		})
	},
	classification: 'selectable',
	contract: 'GenesisUniswapV3Seeder',
	description: 'Deterministically deploys the stateless helper used to mint canonical REP/WETH positions.',
	discoveryInputs: ['deterministic helper deployment'],
	ecosystem: 'trading',
	evaluate: snapshot => {
		const state = snapshot.genesisUniswap ?? snapshot.universeUniswap
		return eligible(state?.proxy === true ? undefined : 'Canonical proxy deployer is unavailable', state?.seeder === false ? undefined : 'Uniswap seeding helper is already deployed')
	},
	id: 'trading.genesis-uniswap.deploy-seeder',
	label: 'Deploy genesis Uniswap seeder',
	method: 'fallback',
	risk: 'medium',
}

function genesisRep(snapshot: EcosystemSnapshot) {
	return snapshot.universes.find(universe => universe.id === '0')?.repToken
}

const uniswapFactory = (snapshot: EcosystemSnapshot) => snapshot.deployments.uniswapV3Factory ?? canonicalUniswapDeployment(snapshot.chainId).factory

function createPoolStep(snapshot: EcosystemSnapshot, factory: Address, rep: Address, id: string, label: string) {
	return encodeStep({
		abi: genesisUniswapV3FactoryAbi,
		args: [rep, snapshot.deployments.weth, GENESIS_UNISWAP_FEE],
		evidence: [{ abi: GET_POOL_ABI, args: [rep, snapshot.deployments.weth, GENESIS_UNISWAP_FEE.toString()], contract: factory, expected: '0', functionName: 'getPool', kind: 'storage-postcondition', relation: 'greater-than' }],
		functionName: 'createPool',
		id,
		label,
		to: factory,
		walletAssetDebits: [],
	})
}

/** Bounded REP and WETH amounts a seed may spend, or `undefined` when the resulting position would be empty. */
function uniswapSeedAmounts(snapshot: EcosystemSnapshot, options: PlanningOptions, repToken: Address) {
	const repInventory = tokenInventory(snapshot, repToken)
	const wethInventory = tokenInventory(snapshot, snapshot.deployments.weth)
	if (repInventory === undefined || wethInventory === undefined) return undefined
	const maximumRep = optionAmount(options, 'maxRepSpendAttoRep', MAXIMUM_SEED_AMOUNT)
	const minimumRepReserve = optionAmount(options, 'minimumRepReserveAttoRep', 0n)
	const maximumWeth = optionAmount(options, 'maxEthSpendAttoEth', MAXIMUM_SEED_AMOUNT)
	const repBalance = amount(repInventory.balance)
	const spendableRep = repBalance > minimumRepReserve ? repBalance - minimumRepReserve : 0n
	const repAmount = minimumOf([spendableRep, maximumRep, MAXIMUM_SEED_AMOUNT])
	const wethAmountAttoEth = minimumOf([amount(wethInventory.balance), maximumWeth, MAXIMUM_SEED_AMOUNT])
	if (repAmount === 0n || wethAmountAttoEth === 0n || (repAmount < wethAmountAttoEth ? repAmount : wethAmountAttoEth) / 2n === 0n) return undefined
	return { repAmount, wethAmountAttoEth }
}

function seederApprovalStep(snapshot: EcosystemSnapshot, scope: SeedScope, token: Address, seeder: Address, required: bigint, index: 0 | 1) {
	return encodeStep({ abi: erc20Abi, args: [seeder, required], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, seeder, required)], functionName: 'approve', id: `approve-${scope}-token${index.toString()}`, label: `Approve ${scope} token${index.toString()}`, to: token, walletAssetDebits: [] })
}

/** Orders the REP/WETH pair, bounds liquidity and builds the approval and seed steps shared by genesis and child-universe seeding. */
function uniswapSeedSteps(snapshot: EcosystemSnapshot, scope: SeedScope, pool: Address, rep: Address, amounts: { repAmount: bigint; wethAmountAttoEth: bigint }, seedLabel: string) {
	const { weth } = snapshot.deployments
	const seeder = genesisUniswapSeederDeployment().address
	const token0 = rep.toLowerCase() < weth.toLowerCase() ? rep : weth
	const token1 = token0 === rep ? weth : rep
	const maximum0 = token0 === rep ? amounts.repAmount : amounts.wethAmountAttoEth
	const maximum1 = token1 === rep ? amounts.repAmount : amounts.wethAmountAttoEth
	const liquidity = (maximum0 < maximum1 ? maximum0 : maximum1) / 2n
	if (liquidity === 0n) return undefined
	const steps = []
	if (allowance(tokenInventory(snapshot, token0), seeder) < maximum0) steps.push(seederApprovalStep(snapshot, scope, token0, seeder, maximum0, 0))
	if (allowance(tokenInventory(snapshot, token1), seeder) < maximum1) steps.push(seederApprovalStep(snapshot, scope, token1, seeder, maximum1, 1))
	steps.push(
		encodeStep({
			abi: genesisUniswapV3SeederAbi,
			args: [pool, token0, token1, GENESIS_UNISWAP_TICK_LOWER, GENESIS_UNISWAP_TICK_UPPER, liquidity, maximum0, maximum1, snapshot.wallet.address],
			evidence: [{ kind: 'receipt-success' }],
			functionName: 'seed',
			id: `seed-${scope}-uniswap-pool`,
			label: seedLabel,
			to: seeder,
			walletAssetDebits: [erc20WalletDebit(token0, maximum0, token0 === rep ? 'rep' : 'weth'), erc20WalletDebit(token1, maximum1, token1 === rep ? 'rep' : 'weth')],
		}),
	)
	return { liquidity, maximum0, maximum1, seeder, steps, token0, token1 }
}

/** Revokes every seeder allowance a confirmed step of the previous seed plan created. */
function seederAllowanceCleanup(snapshot: EcosystemSnapshot, context: OperationContinuationContext, scope: SeedScope, definition: OperationDefinition): OperationPlanDraft | undefined {
	const token0 = metadataAddress(context.previousPlan.metadata, 'token0')
	const token1 = metadataAddress(context.previousPlan.metadata, 'token1')
	const seeder = metadataAddress(context.previousPlan.metadata, 'seeder')
	if (token0 === undefined || token1 === undefined || seeder === undefined) return undefined
	const plannedStepIds = new Set(context.previousPlan.steps.map(step => step.id))
	const confirmedStepIds = new Set(context.confirmedStepIds)
	const steps = [token0, token1].flatMap((token, index) => {
		const approvalId = `approve-${scope}-token${index.toString()}`
		if (!plannedStepIds.has(approvalId) || !confirmedStepIds.has(approvalId) || allowance(tokenInventory(snapshot, token), seeder) === 0n) return []
		return [
			encodeStep({
				abi: erc20Abi,
				args: [seeder, 0n],
				evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, seeder, 0n)],
				functionName: 'approve',
				id: `revoke-${scope}-token${index.toString()}`,
				label: `Revoke ${scope} token${index.toString()} allowance`,
				to: token,
				walletAssetDebits: [],
			}),
		]
	})
	if (steps.length === 0) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: definition.id,
		ecosystem: 'trading',
		label: `Clean up ${definition.label}`,
		metadata: context.previousPlan.metadata,
		postconditions: ['Every confirmed workflow-created seeder allowance is zero'],
		risk: 'medium',
		snapshot,
		steps,
	})
}

const refreshedOrCleanup = (refreshed: OperationPlanDraft | undefined, context: OperationContinuationContext, cleanup: () => OperationPlanDraft | undefined) => (refreshed !== undefined && JSON.stringify(refreshed.metadata) === JSON.stringify(context.previousPlan.metadata) ? refreshed : cleanup())

export const createGenesisUniswapPool: OperationDefinition = {
	buildPlan(snapshot) {
		const rep = genesisRep(snapshot)
		if (rep === undefined) return undefined
		const factory = uniswapFactory(snapshot)
		return planBase({
			definitionId: createGenesisUniswapPool.id,
			ecosystem: 'trading',
			label: createGenesisUniswapPool.label,
			metadata: { factory, fee: GENESIS_UNISWAP_FEE, rep, weth: snapshot.deployments.weth },
			postconditions: ['The configured Uniswap V3 factory returns the canonical genesis REP/WETH fee-tier pool'],
			risk: 'medium',
			snapshot,
			steps: [createPoolStep(snapshot, factory, rep, 'create-genesis-uniswap-pool', 'Create REP/WETH pool')],
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

export const initializeGenesisUniswapPool: OperationDefinition = {
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
			steps: [encodeStep({ abi: genesisUniswapV3PoolStateAbi, args: [GENESIS_UNISWAP_SQRT_PRICE_X96], functionName: 'initialize', id: 'initialize-genesis-uniswap-pool', label: 'Initialize REP/WETH pool', to: pool, walletAssetDebits: [] })],
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

export const seedGenesisUniswapPool: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = snapshot.genesisUniswap?.pool
		const rep = genesisRep(snapshot)
		if (pool === undefined || rep === undefined) return undefined
		const amounts = uniswapSeedAmounts(snapshot, options, rep)
		const seed = amounts === undefined ? undefined : uniswapSeedSteps(snapshot, 'genesis', pool, rep, amounts, 'Seed REP/WETH liquidity')
		if (seed === undefined) return undefined
		const { liquidity, maximum0, maximum1, seeder, steps, token0, token1 } = seed
		return planBase({
			definitionId: seedGenesisUniswapPool.id,
			ecosystem: 'trading',
			label: seedGenesisUniswapPool.label,
			maximumCleanupTransactionCount: 2,
			metadata: { liquidity: liquidity.toString(), maximum0: maximum0.toString(), maximum1: maximum1.toString(), pool, seeder, token0, token1 },
			postconditions: ['The authenticated genesis REP/WETH pool has nonzero active liquidity using bounded token transfers'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const cleanup = () => seederAllowanceCleanup(snapshot, context, 'genesis', seedGenesisUniswapPool)
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		return refreshedOrCleanup(seedGenesisUniswapPool.buildPlan(snapshot, options), context, cleanup)
	},
	classification: 'selectable',
	contract: 'GenesisUniswapV3Seeder',
	description: 'Seeds a bounded full-range REP/WETH position owned by the operator wallet.',
	discoveryInputs: ['authenticated pool liquidity, wallet REP/WETH balances and helper allowances'],
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

const childUniswapPool = (snapshot: EcosystemSnapshot, state: 'missing' | 'uninitialized' | 'unseeded', feasible: (repToken: Address) => boolean = () => true) =>
	snapshot.universeUniswap?.pools
		.filter(candidate => candidate.universeId !== '0')
		.filter(candidate => {
			if (state === 'missing') return candidate.pool === undefined
			if (state === 'uninitialized') return candidate.pool !== undefined && !candidate.initialized
			return candidate.pool !== undefined && candidate.initialized && amount(candidate.liquidity) === 0n
		})
		.filter(candidate => feasible(candidate.repToken))
		.sort((left, right) => {
			const leftId = amount(left.universeId)
			const rightId = amount(right.universeId)
			if (leftId < rightId) return -1
			if (leftId > rightId) return 1
			return 0
		})[0]

const seedableChildUniswapPool = (snapshot: EcosystemSnapshot, options: PlanningOptions) => childUniswapPool(snapshot, 'unseeded', repToken => uniswapSeedAmounts(snapshot, options, repToken) !== undefined)

export const createUniverseUniswapPool: OperationDefinition = {
	buildPlan(snapshot) {
		const target = childUniswapPool(snapshot, 'missing')
		if (target === undefined) return undefined
		const factory = uniswapFactory(snapshot)
		return planBase({
			definitionId: createUniverseUniswapPool.id,
			ecosystem: 'trading',
			label: createUniverseUniswapPool.label,
			metadata: { factory, fee: GENESIS_UNISWAP_FEE, rep: target.repToken, universeId: target.universeId, weth: snapshot.deployments.weth },
			postconditions: ['The configured Uniswap V3 factory returns the canonical universe REP/WETH fee-tier pool'],
			risk: 'medium',
			snapshot,
			steps: [createPoolStep(snapshot, factory, target.repToken, 'create-universe-uniswap-pool', `Create universe ${target.universeId} REP/WETH pool`)],
		})
	},
	classification: 'selectable',
	contract: 'UniswapV3Factory',
	description: 'Creates the fixed-fee REP/WETH pool for the lowest canonical child universe that does not have one.',
	discoveryInputs: ['canonical universe REP tokens, configured WETH and authenticated Uniswap V3 factory'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(snapshot.universeUniswap?.factory === true ? undefined : 'Configured Uniswap V3 factory has no code', childUniswapPool(snapshot, 'missing') !== undefined ? undefined : 'Every discovered child-universe REP token already has a pool'),
	id: 'trading.universe-uniswap.create-pool',
	label: 'Create child-universe REP/WETH pool',
	method: 'createPool',
	risk: 'medium',
}

export const initializeUniverseUniswapPool: OperationDefinition = {
	buildPlan(snapshot) {
		const target = childUniswapPool(snapshot, 'uninitialized')
		if (target?.pool === undefined) return undefined
		return planBase({
			definitionId: initializeUniverseUniswapPool.id,
			ecosystem: 'trading',
			label: initializeUniverseUniswapPool.label,
			metadata: { pool: target.pool, sqrtPriceX96: GENESIS_UNISWAP_SQRT_PRICE_X96.toString(), universeId: target.universeId },
			postconditions: ['The canonical universe REP/WETH pool has the configured deterministic initial sqrt price'],
			risk: 'medium',
			snapshot,
			steps: [encodeStep({ abi: genesisUniswapV3PoolStateAbi, args: [GENESIS_UNISWAP_SQRT_PRICE_X96], functionName: 'initialize', id: 'initialize-universe-uniswap-pool', label: `Initialize universe ${target.universeId} REP/WETH pool`, to: target.pool, walletAssetDebits: [] })],
		})
	},
	classification: 'selectable',
	contract: 'UniswapV3Pool',
	description: 'Initializes an authenticated child-universe REP/WETH pool at the deterministic 1:1 policy price.',
	discoveryInputs: ['authenticated per-universe REP/WETH pool slot0'],
	ecosystem: 'trading',
	evaluate: snapshot => eligible(childUniswapPool(snapshot, 'uninitialized') !== undefined ? undefined : 'Every discovered child-universe REP/WETH pool is initialized'),
	id: 'trading.universe-uniswap.initialize-pool',
	label: 'Initialize child-universe REP/WETH pool',
	method: 'initialize',
	risk: 'medium',
}

export const seedUniverseUniswapPool: OperationDefinition = {
	buildPlan(snapshot, options) {
		const target = seedableChildUniswapPool(snapshot, options)
		if (target?.pool === undefined) return undefined
		const amounts = uniswapSeedAmounts(snapshot, options, target.repToken)
		const seed = amounts === undefined ? undefined : uniswapSeedSteps(snapshot, 'universe', target.pool, target.repToken, amounts, `Seed universe ${target.universeId} REP/WETH liquidity`)
		if (seed === undefined) return undefined
		const { liquidity, maximum0, maximum1, seeder, steps, token0, token1 } = seed
		return planBase({
			definitionId: seedUniverseUniswapPool.id,
			ecosystem: 'trading',
			label: seedUniverseUniswapPool.label,
			maximumCleanupTransactionCount: 2,
			metadata: { liquidity: liquidity.toString(), maximum0: maximum0.toString(), maximum1: maximum1.toString(), pool: target.pool, rep: target.repToken, seeder, token0, token1, universeId: target.universeId },
			postconditions: ['The authenticated child-universe REP/WETH pool has nonzero active liquidity using bounded token transfers'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const cleanup = () => seederAllowanceCleanup(snapshot, context, 'universe', seedUniverseUniswapPool)
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const universeId = context.previousPlan.metadata['universeId']
		const pool = metadataAddress(context.previousPlan.metadata, 'pool')
		if (typeof universeId !== 'string' || pool === undefined || snapshot.universeUniswap === undefined) return cleanup()
		const exactPools = snapshot.universeUniswap.pools.filter(candidate => candidate.universeId === universeId && candidate.pool?.toLowerCase() === pool.toLowerCase())
		return refreshedOrCleanup(seedUniverseUniswapPool.buildPlan({ ...snapshot, universeUniswap: { ...snapshot.universeUniswap, pools: exactPools } }, options), context, cleanup)
	},
	classification: 'selectable',
	contract: 'GenesisUniswapV3Seeder',
	description: 'Seeds a bounded full-range REP/WETH position for an authenticated child universe, owned by the operator wallet.',
	discoveryInputs: ['authenticated per-universe pool liquidity, wallet REP/WETH balances and helper allowances'],
	ecosystem: 'trading',
	evaluate: (snapshot, options) => eligible(snapshot.universeUniswap?.seeder === true ? undefined : 'Deploy the Uniswap seeder first', seedableChildUniswapPool(snapshot, options) !== undefined ? undefined : 'No initialized child-universe REP/WETH pool without liquidity has spendable REP and WETH'),
	id: 'trading.universe-uniswap.seed-pool',
	label: 'Seed child-universe REP/WETH pool',
	method: 'seed',
	risk: 'medium',
}
