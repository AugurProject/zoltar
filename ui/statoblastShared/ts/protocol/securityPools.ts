import { createRegistryIndex, readIncrementalRegistry, type RegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio } from '../contractArtifact.js'

import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool } from '../types/contracts.js'

import { requireSecurityPoolDeploymentTupleArray, type SecurityPoolDeploymentTuple } from './helpers.js'
import { requireAddressValue, requireArrayValue } from './decoders.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

import { loadSecurityPoolDetails } from './securityPoolSnapshot.js'

const securityPoolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
const securityPoolPortfolioAbi = statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio.abi
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

function isCanonicalAnchor(client: ReadClient) {
	return async (candidate: DeploymentRegistryAnchor) => {
		const block = await client.getBlock({ blockNumber: candidate.blockNumber })
		return block.hash?.toLowerCase() === candidate.blockHash.toLowerCase()
	}
}

async function loadDeploymentRegistry(client: ReadClient, anchor: DeploymentRegistryAnchor, index: RegistryIndex<SecurityPoolDeploymentTuple> = createRegistryIndex()): Promise<readonly SecurityPoolDeploymentTuple[]> {
	const factory = getInfraContractAddresses().securityPoolFactory
	return await readIncrementalRegistry({
		index,
		key: factory.toLowerCase(),
		anchor,
		loadCount: async () => await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentCount', args: [], blockNumber: anchor.blockNumber }),
		loadRange: async (start, count) => await loadSecurityPoolDeployments(client, start, count, anchor.blockNumber),
		isCanonical: isCanonicalAnchor(client),
	})
}

async function loadPortfolioRegistry(client: ReadClient, anchor: DeploymentRegistryAnchor): Promise<readonly Address[]> {
	const factory = getInfraContractAddresses().securityPoolFactory
	return await readIncrementalRegistry({
		index: createRegistryIndex<Address>(),
		key: `${factory.toLowerCase()}:portfolios`,
		anchor,
		loadCount: async () => await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'portfolioCount', args: [], blockNumber: anchor.blockNumber }),
		loadRange: async (start, count) =>
			requireArrayValue(await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'portfoliosRange', args: [start, count], blockNumber: anchor.blockNumber }), 'registered portfolios').map(portfolio => requireAddressValue(portfolio, 'registered portfolio')),
		isCanonical: isCanonicalAnchor(client),
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
 * Portfolios that open in this universe, most recently registered first. The factory registers a portfolio when its
 * setup configures its price feed, so a portfolio still in setup can only be opened by its address. Any caller can
 * register its own address the same way, so only addresses that answer as a portfolio with a capital ledger in this
 * universe are listed; a portfolio keeps one ledger per universe it can open in.
 */
export async function loadRegisteredPortfolios(client: ReadClient, universeId: bigint): Promise<RegisteredPortfolio[]> {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const portfolios = await loadPortfolioRegistry(client, anchor)
	// One multicall request at the anchor block. viem splits a large batch into several calls, all at that block.
	const reads =
		portfolios.length === 0
			? []
			: await readOptionalMulticall(
					client,
					portfolios.flatMap(portfolio => [
						{ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'capitalLedger', args: [universeId] },
						{ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'questionCount', args: [] },
					]),
					anchor.blockNumber,
				)
	await requireDeploymentRegistryAnchor(client, anchor)
	const listed: RegisteredPortfolio[] = []
	for (const [index, portfolio] of portfolios.entries()) {
		const ledger = reads[2 * index]
		const questions = reads[2 * index + 1]
		// An address that does not answer as a portfolio, or has no ledger here, is skipped rather than failing the list.
		if (ledger?.status !== 'success' || questions?.status !== 'success') continue
		if (typeof ledger.result !== 'string' || sameAddress(ledger.result, zeroAddress) || typeof questions.result !== 'bigint') continue
		listed.push({ portfolio, questionCount: Number(questions.result) })
	}
	return listed.reverse()
}
