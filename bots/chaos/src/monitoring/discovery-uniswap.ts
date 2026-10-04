import { collectableUniswapFees } from '../core/uniswap-fees.ts'
import type { UniswapPositionSnapshot, UniverseUniswapPoolSnapshot } from '../operations/uniswap-types.ts'
import { canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import * as abis from '@zoltar/bot-shared/contracts/abi'
import { bigintToSafeNumber, getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { CANONICAL_PROXY_DEPLOYER, GENESIS_UNISWAP_FEE, genesisUniswapSeederDeployment } from '../core/genesis-uniswap.ts'
import { UNISWAP_POSITION_RANGES } from '../core/uniswap-ranges.ts'
import { chaosUniswapV3FeesAbi, chaosUniswapV3RouterAbi } from '../contracts/uniswap-abi.ts'
import { retirementUniswapV3PositionAbi } from '../contracts/retirement-abi.ts'
import { uniswapV3PositionKey } from '../state/retirement.ts'
import type { UniverseSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { DISCOVERY_RPC_QUEUE_LIMIT, drainConcurrent, mapWithConcurrency } from './discovery-client.ts'
import { requireGraphEdge } from './discovery-graph.ts'
import { PROXY_DEPLOYER_RUNTIME_CODE } from '@zoltar/core-shared/deployment/deploymentAddresses'

const hasCode = (code: string | undefined): code is string => code !== undefined && code !== '0x'
const UNISWAP_POOL_DISCOVERY_CONCURRENCY = Math.min(2, Math.floor(DISCOVERY_RPC_QUEUE_LIMIT / 6))

export async function discoverUniverseUniswap(context: EcosystemDiscoveryContext, universes: readonly UniverseSnapshot[], blockNumber: bigint, chainId: number) {
	const seeder = genesisUniswapSeederDeployment()
	const uniswapFactory = context.deployments.uniswapV3Factory ?? canonicalUniswapDeployment(chainId).factory
	const [factoryCode, proxyCode, seederCode] = await drainConcurrent([context.client.getCode({ address: uniswapFactory, blockNumber }), context.client.getCode({ address: CANONICAL_PROXY_DEPLOYER, blockNumber }), context.client.getCode({ address: seeder.address, blockNumber })])
	if (hasCode(proxyCode) && proxyCode.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE) throw new Error('Canonical proxy deployer has unexpected runtime code')
	if (hasCode(seederCode) && seederCode.toLowerCase() !== seeder.runtime.toLowerCase()) throw new Error('Genesis Uniswap seeder has unexpected runtime code')
	const [factory, authenticatedProxy, authenticatedSeeder] = [hasCode(factoryCode), hasCode(proxyCode), hasCode(seederCode)]
	const pools = await mapWithConcurrency(universes, UNISWAP_POOL_DISCOVERY_CONCURRENCY, async (universe): Promise<UniverseUniswapPoolSnapshot> => {
		if (!factory) return { initialized: false, liquidity: '0', repToken: universe.repToken, universeId: universe.id }
		const pool = getAddress(await context.client.readContract({ abi: abis.genesisUniswapV3FactoryAbi, address: uniswapFactory, args: [universe.repToken, context.deployments.weth, GENESIS_UNISWAP_FEE], blockNumber, functionName: 'getPool' }))
		if (pool === zeroAddress) return { initialized: false, liquidity: '0', repToken: universe.repToken, universeId: universe.id }
		const [poolFactory, token0, token1, fee, slot0, liquidity] = await drainConcurrent([
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'factory' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'token0' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'token1' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'fee' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'slot0' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'liquidity' }),
		])
		requireGraphEdge(getAddress(poolFactory), uniswapFactory, `Universe ${universe.id} Uniswap pool ${pool} factory edge`)
		const expected = [universe.repToken.toLowerCase(), context.deployments.weth.toLowerCase()].sort()
		const actual = [getAddress(token0).toLowerCase(), getAddress(token1).toLowerCase()].sort()
		if (actual[0] !== expected[0] || actual[1] !== expected[1] || fee !== BigInt(GENESIS_UNISWAP_FEE)) throw new Error(`Universe ${universe.id} Uniswap pool ${pool} has unexpected immutable token or fee bindings`)
		const details = context.wallet === undefined || slot0[0] === 0n ? {} : await discoverPoolInventory(context, pool, universe.repToken, bigintToSafeNumber(slot0[1]), blockNumber)
		return { initialized: slot0[0] !== 0n, liquidity: liquidity.toString(), pool, repToken: universe.repToken, universeId: universe.id, sqrtPriceX96: slot0[0].toString(), tick: bigintToSafeNumber(slot0[1]), ...details }
	})
	const router = canonicalUniswapDeployment(chainId).router
	let routerAuthenticated = false
	if (hasCode(await context.client.getCode({ address: router, blockNumber }))) {
		const [routerFactory, routerWeth] = await drainConcurrent([context.client.readContract({ abi: chaosUniswapV3RouterAbi, address: router, blockNumber, functionName: 'factory' }), context.client.readContract({ abi: chaosUniswapV3RouterAbi, address: router, blockNumber, functionName: 'WETH9' })])
		routerAuthenticated = getAddress(routerFactory).toLowerCase() === uniswapFactory.toLowerCase() && getAddress(routerWeth).toLowerCase() === context.deployments.weth.toLowerCase()
	}
	return { factory, pools, proxy: authenticatedProxy, seeder: authenticatedSeeder, router, routerAuthenticated }
}

async function discoverPoolInventory(context: EcosystemDiscoveryContext, pool: `0x${string}`, rep: `0x${string}`, tick: number, blockNumber: bigint) {
	const { client, wallet } = context
	if (wallet === undefined) return {}
	const [global0, global1, repBalanceAttoRep, wethBalanceAttoEth] = await drainConcurrent([
		client.readContract({ abi: chaosUniswapV3FeesAbi, address: pool, blockNumber, functionName: 'feeGrowthGlobal0X128' }),
		client.readContract({ abi: chaosUniswapV3FeesAbi, address: pool, blockNumber, functionName: 'feeGrowthGlobal1X128' }),
		client.readContract({ abi: abis.erc20Abi, address: rep, args: [pool], blockNumber, functionName: 'balanceOf' }),
		client.readContract({ abi: abis.erc20Abi, address: context.deployments.weth, args: [pool], blockNumber, functionName: 'balanceOf' }),
	])
	const positions: UniswapPositionSnapshot[] = []
	for (const range of UNISWAP_POSITION_RANGES) {
		const position = await client.readContract({ abi: retirementUniswapV3PositionAbi, address: pool, args: [uniswapV3PositionKey(wallet, range.tickLower, range.tickUpper)], blockNumber, functionName: 'positions' })
		let collectable0 = position[3]
		let collectable1 = position[4]
		if (position[0] > 0n) {
			const [lower, upper] = await drainConcurrent([client.readContract({ abi: chaosUniswapV3FeesAbi, address: pool, args: [range.tickLower], blockNumber, functionName: 'ticks' }), client.readContract({ abi: chaosUniswapV3FeesAbi, address: pool, args: [range.tickUpper], blockNumber, functionName: 'ticks' })])
			collectable0 = collectableUniswapFees(position[0], position[3], position[1], global0, lower[2], upper[2], tick, range.tickLower, range.tickUpper)
			collectable1 = collectableUniswapFees(position[0], position[4], position[2], global1, lower[3], upper[3], tick, range.tickLower, range.tickUpper)
		}
		positions.push({ ...range, liquidity: position[0].toString(), collectable0: collectable0.toString(), collectable1: collectable1.toString() })
	}
	return { positions, repBalanceAttoRep: repBalanceAttoRep.toString(), wethBalanceAttoEth: wethBalanceAttoEth.toString() }
}
