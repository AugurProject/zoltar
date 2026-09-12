import path from 'node:path'
import { effectiveAbiSourceHash } from './abi-provenance.ts'
import { type Abi, parseAbi } from './ethereum.ts'
import type { AbiCatalogEntry } from './types.ts'

type CatalogFile = {
	readonly sourceHash: string
	readonly contracts: Record<string, AbiCatalogEntry>
}

const catalogFile = (await Bun.file(path.resolve(import.meta.dir, '../config/abis.json')).json()) as CatalogFile

const kindToContractName: Readonly<Record<string, string>> = {
	ammFactory: 'TwoWayConstantProductFactory',
	ammPair: 'TwoWayConstantProductPair',
	deploymentStatusOracle: 'DeploymentStatusOracle',
	escalationGame: 'EscalationGame',
	escalationGameClaimDelegate: 'EscalationGameClaimDelegate',
	escalationGameFactory: 'EscalationGameFactory',
	escalationProofVerifier: 'EscalationGameProofVerifier',
	multicall3: 'Multicall3',
	liquidationApprovalRegistry: 'LiquidationApprovalRegistry',
	openOracle: 'OpenOracle',
	priceCoordinator: 'OpenOraclePriceCoordinator',
	priceCoordinatorFactory: 'PriceOracleManagerAndOperatorQueuerFactory',
	reputationToken: 'ReputationToken',
	scalarOutcomes: 'ScalarOutcomes',
	securityPool: 'SecurityPool',
	securityPoolFactory: 'SecurityPoolFactory',
	securityPoolForker: 'SecurityPoolForker',
	securityPoolOperationsDelegate: 'SecurityPoolOperationsDelegate',
	securityPoolUtils: 'SecurityPoolUtils',
	shareToken: 'ShareToken',
	shareTokenFactory: 'ShareTokenFactory',
	truthAuction: 'UniformPriceDualCapBatchAuction',
	truthAuctionFactory: 'UniformPriceDualCapBatchAuctionFactory',
	weth: 'WETH9',
	zoltar: 'Zoltar',
	zoltarQuestionData: 'ZoltarQuestionData',
}

const externalAbis: Readonly<Record<string, Abi>> = {
	uniswapV2Factory: parseAbi(['event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairIndex)']),
	uniswapV2Pair: parseAbi(['event Sync(uint112 reserve0,uint112 reserve1)']),
	uniswapV3Factory: parseAbi(['event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)']),
	uniswapV3Pool: parseAbi(['event Initialize(uint160 sqrtPriceX96,int24 tick)', 'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']),
	uniswapV4PoolManager: parseAbi([
		'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
		'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
	]),
}

export const abiSourceHash = effectiveAbiSourceHash(catalogFile.contracts, kindToContractName, externalAbis)

export const abiForKind = (kind: string): Abi | undefined => {
	const externalAbi = externalAbis[kind]
	if (externalAbi !== undefined) return externalAbi
	const name = kindToContractName[kind]
	const catalogAbi = name === undefined ? undefined : catalogFile.contracts[name]?.abi
	if (catalogAbi !== undefined) return catalogAbi
	// These deployed helper libraries expose no project ABI, but remain known contracts.
	if (kind === 'proxyDeployer' || kind === 'scalarOutcomes') return []
	return undefined
}

export const catalogAbis = (): readonly Abi[] => Object.values(catalogFile.contracts).map(({ abi }) => abi)
