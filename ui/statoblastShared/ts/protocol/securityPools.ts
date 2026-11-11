import { createRegistryIndex, readIncrementalRegistry, type RegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'

import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool } from '../types/contracts.js'

import { requireSecurityPoolDeploymentTupleArray, type SecurityPoolDeploymentTuple } from './helpers.js'
import { requireAddressValue } from './decoders.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

import { loadSecurityPoolDetails } from './securityPoolSnapshot.js'

const securityPoolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
async function loadSecurityPoolDeployments(client: ReadClient, startIndex: bigint, count: bigint, blockNumber?: bigint) {
	if (count === 0n) return [] as readonly SecurityPoolDeploymentTuple[]
	return requireSecurityPoolDeploymentTupleArray(
		await client.readContract({
			address: getInfraContractAddresses().securityPoolFactory,
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			args: [startIndex, count],
			blockNumber,
		}),
		'security pool deployments range',
	)
}

async function loadListedSecurityPools(client: ReadClient, deployments: readonly SecurityPoolDeploymentTuple[]) {
	return await Promise.all(deployments.map(deployment => loadSecurityPoolDetails(client, deployment)))
}

type DeploymentRegistryAnchor = Readonly<{ blockHash: `0x${string}`; blockNumber: bigint }>

async function loadDeploymentRegistryAnchor(client: ReadClient): Promise<DeploymentRegistryAnchor> {
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error('Security pool deployment head is missing its canonical identity')
	return { blockHash: block.hash, blockNumber: block.number }
}

async function requireDeploymentRegistryAnchor(client: ReadClient, anchor: DeploymentRegistryAnchor) {
	const block = await client.getBlock({ blockNumber: anchor.blockNumber })
	if (block.hash?.toLowerCase() !== anchor.blockHash.toLowerCase()) throw new Error('Security pool deployments changed during discovery')
}

async function loadDeploymentRegistry(client: ReadClient, anchor: DeploymentRegistryAnchor, index: RegistryIndex<SecurityPoolDeploymentTuple> = createRegistryIndex()): Promise<readonly SecurityPoolDeploymentTuple[]> {
	const factory = getInfraContractAddresses().securityPoolFactory
	return await readIncrementalRegistry({
		index,
		key: factory.toLowerCase(),
		anchor,
		loadCount: async () => await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentCount', args: [], blockNumber: anchor.blockNumber }),
		loadRange: async (start, count) => await loadSecurityPoolDeployments(client, start, count, anchor.blockNumber),
		isCanonical: async candidate => {
			const block = await client.getBlock({ blockNumber: candidate.blockNumber })
			return block.hash?.toLowerCase() === candidate.blockHash.toLowerCase()
		},
	})
}

function applyChildForkActivityHints(pools: ListedSecurityPool[]) {
	return pools.map(pool => {
		if (pool.hasForkActivity) return pool
		if (!pools.some(candidate => sameAddress(candidate.parent, pool.securityPoolAddress))) return pool
		return {
			...pool,
			hasForkActivity: true,
		}
	})
}

export async function loadAllSecurityPools(client: ReadClient): Promise<ListedSecurityPool[]> {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const deployments = await loadDeploymentRegistry(client, anchor)
	const pools = await loadListedSecurityPools(client, deployments)
	await requireDeploymentRegistryAnchor(client, anchor)
	return applyChildForkActivityHints(pools)
}

export type RegisteredPortfolio = { portfolio: Address; questionCount: number }

/**
 * Portfolios with at least one question registered in this universe, most recent registration first.
 * Each portfolio keeps a capital ledger per universe, so only these open in it. The factory registers
 * question pools, not portfolios, so a portfolio without a question here can only be opened by its address.
 */
export async function loadRegisteredPortfolios(client: ReadClient, universeId: bigint): Promise<RegisteredPortfolio[]> {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const deployments = (await loadDeploymentRegistry(client, anchor)).filter(deployment => deployment.universeId === universeId)
	const factory = getInfraContractAddresses().securityPoolFactory
	// One multicall request at the anchor block. viem splits a large batch into several calls, all at that block.
	const portfolios =
		deployments.length === 0
			? []
			: await readRequiredMulticall(
					client,
					deployments.map(deployment => ({ address: factory, abi: securityPoolFactoryAbi, functionName: 'getSecurityPoolPortfolio', args: [deployment.securityPool] })),
					anchor.blockNumber,
				)
	await requireDeploymentRegistryAnchor(client, anchor)
	const registrations = deployments.map((deployment, index) => ({ questionId: deployment.questionId, portfolio: requireAddressValue(portfolios[index], 'question portfolio') }))
	const questions = new Map<Address, Set<bigint>>()
	for (const { portfolio, questionId } of [...registrations].reverse()) {
		if (portfolio === zeroAddress) continue
		const known = questions.get(portfolio) ?? new Set<bigint>()
		known.add(questionId)
		questions.set(portfolio, known)
	}
	return Array.from(questions, ([portfolio, ids]) => ({ portfolio, questionCount: ids.size }))
}
