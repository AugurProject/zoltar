import { createRegistryIndex, readIncrementalRegistry, type RegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'

import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool } from '../types/contracts.js'

import { requireSecurityPoolDeploymentTupleArray, type SecurityPoolDeploymentTuple } from './helpers.js'
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
