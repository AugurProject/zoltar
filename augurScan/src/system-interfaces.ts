import { type Abi, parseAbi, zeroHash } from './ethereum.ts'

type SystemInterface = { readonly type: 'artifact'; readonly name: string } | { readonly type: 'interface'; readonly abi: Abi; readonly source: string; readonly scope: string } | { readonly type: 'raw'; readonly reason: string }

const artifact = (name: string) => ({ type: 'artifact', name }) as const

// Every supported contract belongs here, regardless of who owns its source.
export const systemInterfaces = {
	ammFactory: artifact('TwoWayConstantProductFactory'),
	ammPair: artifact('TwoWayConstantProductPair'),
	deploymentStatusOracle: artifact('DeploymentStatusOracle'),
	escalationGame: artifact('EscalationGame'),
	escalationGameClaimDelegate: artifact('EscalationGameClaimDelegate'),
	escalationGameFactory: artifact('EscalationGameFactory'),
	escalationProofVerifier: artifact('EscalationGameProofVerifier'),
	multicall3: artifact('Multicall3'),
	liquidationApprovalRegistry: artifact('LiquidationApprovalRegistry'),
	openOracle: artifact('OpenOracle'),
	priceCoordinator: artifact('OpenOraclePriceCoordinator'),
	priceCoordinatorFactory: artifact('PriceOracleManagerAndOperatorQueuerFactory'),
	reputationToken: artifact('ReputationToken'),
	securityPool: artifact('SecurityPool'),
	securityPoolFactory: artifact('SecurityPoolFactory'),
	securityPoolForker: artifact('SecurityPoolForker'),
	securityPoolOperationsDelegate: artifact('SecurityPoolOperationsDelegate'),
	securityPoolUtils: artifact('SecurityPoolUtils'),
	shareToken: artifact('ShareToken'),
	shareTokenFactory: artifact('ShareTokenFactory'),
	truthAuction: artifact('UniformPriceDualCapBatchAuction'),
	truthAuctionFactory: artifact('UniformPriceDualCapBatchAuctionFactory'),
	weth: artifact('WETH9'),
	zoltar: artifact('Zoltar'),
	zoltarQuestionData: artifact('ZoltarQuestionData'),
	// USDC uses the same ERC-20, permit and transfer-authorization interface.
	usdc: artifact('ERC20Authorization'),
	proxyDeployer: { type: 'raw', reason: 'Zero-salt CREATE2 deployer accepts raw init code, without a Solidity ABI.' },
	delegationManager: {
		type: 'interface',
		source: 'https://github.com/MetaMask/delegation-framework/blob/main/src/DelegationManager.sol',
		scope: 'Wallet delegation redemption',
		abi: parseAbi(['function redeemDelegations(bytes[] _permissionContexts,bytes32[] _modes,bytes[] _executionCallDatas)']),
	},
	uniswapV2Factory: {
		type: 'interface',
		source: 'https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Factory.sol',
		scope: 'REP price discovery and observations; event decoding',
		abi: parseAbi(['event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairIndex)']),
	},
	uniswapV2Pair: {
		type: 'interface',
		source: 'https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol',
		scope: 'REP price discovery and observations; event decoding',
		abi: parseAbi(['event Sync(uint112 reserve0,uint112 reserve1)']),
	},
	uniswapV3Factory: {
		type: 'interface',
		source: 'https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Factory.sol',
		scope: 'REP price discovery and observations; event decoding',
		abi: parseAbi(['event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)']),
	},
	uniswapV3Pool: {
		type: 'interface',
		source: 'https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Pool.sol',
		scope: 'REP price discovery and observations; event decoding',
		abi: parseAbi(['event Initialize(uint160 sqrtPriceX96,int24 tick)', 'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']),
	},
	uniswapV4PoolManager: {
		type: 'interface',
		source: 'https://github.com/Uniswap/v4-core/blob/main/src/PoolManager.sol',
		scope: 'REP price discovery and observations; event decoding',
		abi: parseAbi([
			'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
			'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
		]),
	},
} as const satisfies Readonly<Record<string, SystemInterface>>

export type SystemContractKind = keyof typeof systemInterfaces

export const supportedWrappers = {
	proxyDeployer: { format: 'zero-salt-create2-initcode' },
	delegationManager: {
		functionName: 'redeemDelegations',
		modes: {
			single: { code: zeroHash, allowFailure: false },
			singleAllowFailure: { code: `0x0001${'00'.repeat(30)}`, allowFailure: true },
		},
	},
} as const satisfies Partial<Record<SystemContractKind, unknown>>
