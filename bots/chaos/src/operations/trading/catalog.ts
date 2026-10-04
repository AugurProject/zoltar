import { disabled } from '../planning.ts'
import type { OperationDefinition } from '../types.ts'
import { createPair, directLiquidity, syncPair } from './pair.ts'
import { deployTradingFactory, deployTradingRouter } from './roots.ts'
import { routerEthDefinition } from './router-eth.ts'
import { routerOwnedDefinition } from './router-owned.ts'
import { migrateShares } from './share-migration.ts'
import { swapDefinition } from './swap.ts'
import { addGenesisUniswapLiquidity, addUniverseUniswapLiquidity, createGenesisUniswapPool, createUniverseUniswapPool, deployGenesisUniswapSeeder, initializeGenesisUniswapPool, initializeUniverseUniswapPool, seedGenesisUniswapPool, seedUniverseUniswapPool } from './uniswap-seeding.ts'

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
	addGenesisUniswapLiquidity,
	createUniverseUniswapPool,
	initializeUniverseUniswapPool,
	seedUniverseUniswapPool,
	addUniverseUniswapLiquidity,
	createPair,
	directLiquidity('initialize'),
	directLiquidity('add'),
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
