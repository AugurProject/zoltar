import { zeroHash } from './ethereum.ts'
import { generatedSystemInterfaces } from '../config/system-contracts.generated.ts'
import dependencyAbis from '../config/dependency-abis.json'
import dependencySources from '../config/dependency-abi-sources.json'

// Workflow fixtures cover the members we interpret specially. Complete upstream
// ABIs also decode ordinary calls and events without handwritten signatures.
const dependency = <TKind extends keyof typeof dependencyAbis>(kind: TKind, members: readonly string[]) => ({
	type: 'interface' as const,
	abi: dependencyAbis[kind],
	source: dependencySources[kind],
	members,
})

// Every supported contract belongs here, regardless of who owns its source.
export const systemInterfaces = {
	...generatedSystemInterfaces,
	proxyDeployer: { type: 'raw', reason: 'Zero-salt CREATE2 deployer accepts raw init code, without a Solidity ABI.' },
	delegationManager: dependency('delegationManager', ['redeemDelegations']),
	uniswapV2Factory: dependency('uniswapV2Factory', ['PairCreated']),
	uniswapV2Pair: dependency('uniswapV2Pair', ['Sync']),
	uniswapV3Factory: dependency('uniswapV3Factory', ['PoolCreated']),
	uniswapV3Pool: dependency('uniswapV3Pool', ['Initialize', 'Swap']),
	uniswapV4PoolManager: dependency('uniswapV4PoolManager', ['Initialize', 'Swap']),
} as const

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
