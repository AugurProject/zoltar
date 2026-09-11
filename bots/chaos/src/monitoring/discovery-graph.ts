import { coordinatorAbi, securityPoolAbi } from '../contracts/abi.ts'
import { type ChaosReadClient, drainConcurrent, sameAddress } from './discovery-client.ts'
import { type Address, getAddress } from '@zoltar/bot-shared/ethereum'

export function requireGraphEdge(actual: Address, expected: Address, label: string) {
	if (!sameAddress(actual, expected)) throw new Error(`${label} points to ${actual}, expected ${expected}`)
}

interface PoolProtocolBindingAuthentication {
	blockNumber: bigint
	canonicalRepToken: Address
	client: ChaosReadClient
	configuredOpenOracle: Address
	configuredWeth: Address
	coordinator: Address
	pool: Address
}

/** Authenticates the immutable oracle and token bindings that authorize pool transactions. */

/** Authenticates the immutable oracle and token bindings that authorize pool transactions. */
export async function authenticatePoolProtocolBindings(authentication: PoolProtocolBindingAuthentication) {
	const { blockNumber, canonicalRepToken, client, configuredOpenOracle, configuredWeth, coordinator, pool } = authentication
	const [poolOpenOracle, coordinatorOpenOracle, coordinatorWeth, coordinatorRepToken] = await drainConcurrent([
		client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'openOracle' }),
		client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'openOracle' }),
		client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'weth' }),
		client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'reputationToken' }),
	])
	requireGraphEdge(getAddress(poolOpenOracle), configuredOpenOracle, `Pool ${pool} OpenOracle edge`)
	requireGraphEdge(getAddress(coordinatorOpenOracle), configuredOpenOracle, `Coordinator ${coordinator} OpenOracle edge`)
	requireGraphEdge(getAddress(coordinatorWeth), configuredWeth, `Coordinator ${coordinator} WETH edge`)
	requireGraphEdge(getAddress(coordinatorRepToken), canonicalRepToken, `Coordinator ${coordinator} REP edge`)
}

interface PoolGraphIdentity {
	pool: Address
	poolFactory: Address
	configuredFactory: Address
	poolForker: Address
	configuredForker: Address
	poolZoltar: Address
	configuredZoltar: Address
	poolQuestionData: Address
	configuredQuestionData: Address
	poolCoordinator: Address
	deploymentCoordinator: Address
	coordinatorPool: Address
	poolShareToken: Address
	deploymentShareToken: Address
	poolRepToken: Address
	universeRepToken: Address
	poolTruthAuction: Address
	deploymentTruthAuction: Address
	poolUniverseId: string
	deploymentUniverseId: string
	poolQuestionId: string
	deploymentQuestionId: string
}

export function assertCanonicalPoolGraph(identity: PoolGraphIdentity) {
	requireGraphEdge(identity.poolFactory, identity.configuredFactory, `Pool ${identity.pool} security-pool-factory edge`)
	requireGraphEdge(identity.poolForker, identity.configuredForker, `Pool ${identity.pool} forker edge`)
	requireGraphEdge(identity.poolZoltar, identity.configuredZoltar, `Pool ${identity.pool} Zoltar edge`)
	requireGraphEdge(identity.poolQuestionData, identity.configuredQuestionData, `Pool ${identity.pool} question-data edge`)
	requireGraphEdge(identity.poolCoordinator, identity.deploymentCoordinator, `Pool ${identity.pool} coordinator edge`)
	requireGraphEdge(identity.coordinatorPool, identity.pool, `Coordinator ${identity.deploymentCoordinator} pool edge`)
	requireGraphEdge(identity.poolShareToken, identity.deploymentShareToken, `Pool ${identity.pool} share-token edge`)
	requireGraphEdge(identity.poolRepToken, identity.universeRepToken, `Pool ${identity.pool} REP edge`)
	requireGraphEdge(identity.poolTruthAuction, identity.deploymentTruthAuction, `Pool ${identity.pool} truth-auction edge`)
	if (identity.poolUniverseId !== identity.deploymentUniverseId || identity.poolQuestionId !== identity.deploymentQuestionId) {
		throw new Error(`Pool ${identity.pool} immutable question identity does not match its canonical factory deployment`)
	}
}

interface PairGraphIdentity {
	pair: Address
	pairFactory: Address
	configuredFactory: Address
	pairPool: Address
	pool: Address
	pairShareToken: Address
	poolShareToken: Address
	pairUniverseId: string
	poolUniverseId: string
	pairQuestionId: string
	poolQuestionId: string
}

export function assertCanonicalPairGraph(identity: PairGraphIdentity) {
	requireGraphEdge(identity.pairFactory, identity.configuredFactory, `Pair ${identity.pair} factory edge`)
	requireGraphEdge(identity.pairPool, identity.pool, `Pair ${identity.pair} security-pool edge`)
	requireGraphEdge(identity.pairShareToken, identity.poolShareToken, `Pair ${identity.pair} share-token edge`)
	if (identity.pairUniverseId !== identity.poolUniverseId || identity.pairQuestionId !== identity.poolQuestionId) throw new Error(`Pair ${identity.pair} immutable question identity does not match pool ${identity.pool}`)
}
