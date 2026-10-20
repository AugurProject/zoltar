import { createRegistryIndex, readIncrementalRegistry, type RegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
export { createSecurityPool, getOriginSecurityPoolAddress, originSecurityPoolExists } from './securityPoolCreation.js'
import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'

import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool, SecurityPoolRegistryPage } from '../types/contracts.js'
import { getProtocolPageOffset } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { readWithRpcStateRetries } from '@zoltar/ui-core-shared/lib/rpcStateRetries.js'

import { requireSecurityPoolDeploymentTupleArray, type SecurityPoolDeploymentTuple } from './helpers.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

import { loadSecurityPoolDetails } from './securityPoolSnapshot.js'
import { SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT } from './securityVaultQueries.js'
export { loadSecurityPoolVaultSummary, loadSecurityVaultDetails } from './securityVaultQueries.js'

const securityPoolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
type LoadAllSecurityPoolsOptions = {
	accountAddress?: Address
	selectedSecurityPoolAddress?: Address | string
	vaultDetailMode?: 'all' | 'selected'
}

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

async function loadListedSecurityPools(
	client: ReadClient,
	deployments: readonly SecurityPoolDeploymentTuple[],
	options: {
		accountAddress?: Address
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
		vaultPreviewLimit: bigint
	},
) {
	return await Promise.all(deployments.map(async deployment => await loadSecurityPoolDetails(client, deployment, options)))
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

function uniqueDeployments(deployments: readonly SecurityPoolDeploymentTuple[]) {
	return [...new Map(deployments.map(deployment => [deployment.securityPool.toLowerCase(), deployment])).values()]
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

/** Loads a pool's registry lineage. Only a pool this session just created (`expectDeployment`) is re-read while RPC caches catch up; any other unknown address is not found after one read. */
export async function loadSecurityPoolLineage(client: ReadClient, securityPoolAddress: Address, accountAddress?: Address, registryIndex?: RegistryIndex<SecurityPoolDeploymentTuple>, { expectDeployment = false }: { expectDeployment?: boolean } = {}) {
	const readRegistry = async () => {
		const anchor = await loadDeploymentRegistryAnchor(client)
		const deployments = await loadDeploymentRegistry(client, anchor, registryIndex)
		await requireDeploymentRegistryAnchor(client, anchor)
		return { anchor, deployments }
	}
	const { anchor, deployments } = expectDeployment ? await readWithRpcStateRetries(readRegistry, ({ deployments }) => deployments.some(deployment => sameAddress(deployment.securityPool, securityPoolAddress))) : await readRegistry()
	const selected = deployments.filter(deployment => sameAddress(deployment.securityPool, securityPoolAddress))
	const selectedDeployment = selected[0]
	if (selectedDeployment === undefined) {
		await requireDeploymentRegistryAnchor(client, anchor)
		return []
	}
	const children = deployments.filter(deployment => sameAddress(deployment.parent, securityPoolAddress))
	const parent = deployments.filter(deployment => sameAddress(deployment.securityPool, selectedDeployment.parent))
	const pools = await loadListedSecurityPools(client, uniqueDeployments([...parent, ...selected, ...children]), {
		...(accountAddress === undefined ? {} : { accountAddress }),
		selectedSecurityPoolAddress: securityPoolAddress,
		vaultDetailMode: 'selected',
		vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
	})
	await requireDeploymentRegistryAnchor(client, anchor)
	return applyChildForkActivityHints(pools)
}

export async function loadSecurityPoolChildren(client: ReadClient, parentAddress: Address, accountAddress?: Address) {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const deployments = (await loadDeploymentRegistry(client, anchor)).filter(deployment => sameAddress(deployment.parent, parentAddress))
	const pools = await loadListedSecurityPools(client, deployments, {
		...(accountAddress === undefined ? {} : { accountAddress }),
		selectedSecurityPoolAddress: parentAddress,
		vaultDetailMode: 'selected',
		vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
	})
	await requireDeploymentRegistryAnchor(client, anchor)
	return pools
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

/** One page of the factory's pool registry, newest deployment first, with pool summaries only (no vault positions). */
export async function loadSecurityPoolPage(client: ReadClient, pageIndex: number, pageSize: number): Promise<SecurityPoolRegistryPage> {
	const skippedCount = getProtocolPageOffset(pageIndex, pageSize)
	const poolCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: securityPoolFactoryAbi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	if (skippedCount >= poolCount) return { pageIndex, pageSize, poolCount, pools: [] }
	const endIndex = poolCount - skippedCount
	const startIndex = endIndex > BigInt(pageSize) ? endIndex - BigInt(pageSize) : 0n
	const deployments = await loadSecurityPoolDeployments(client, startIndex, endIndex - startIndex)
	const pools = await loadListedSecurityPools(client, [...deployments].reverse(), { vaultDetailMode: 'selected', vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT })
	return { pageIndex, pageSize, poolCount, pools: applyChildForkActivityHints(pools) }
}

export async function loadAllSecurityPools(client: ReadClient, options: LoadAllSecurityPoolsOptions = {}): Promise<ListedSecurityPool[]> {
	const deploymentCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	const deployments = await loadSecurityPoolDeployments(client, 0n, deploymentCount)
	const pools = await loadListedSecurityPools(client, deployments, {
		...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
		...(options.selectedSecurityPoolAddress === undefined ? {} : { selectedSecurityPoolAddress: options.selectedSecurityPoolAddress }),
		vaultDetailMode: options.vaultDetailMode ?? 'all',
		vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
	})
	return applyChildForkActivityHints(pools)
}
