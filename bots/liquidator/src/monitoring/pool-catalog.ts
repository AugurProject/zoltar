import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import { securityPoolAbi, securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import { formatDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import type { Address } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from './vault-positions.ts'

type CatalogPool = {
	address: string
	parent: string
	questionId: string
	universeId: string
	multiplierBps: string
	metrics?: { systemState: string; totalPoolHeldRep: string; vaultCount: string }
}

export type PoolCatalogPage = {
	chainId: number
	page: number
	pageCount: string
	total: string
	block: string
	pools: CatalogPool[]
}

const PAGE_SIZE = 12n

export async function loadPoolCatalog(client: ReadClient, factory: Address, chainId: number, page: number): Promise<PoolCatalogPage> {
	if (!Number.isSafeInteger(page) || page < 0) throw new Error('Pool page must be a non-negative safe integer')
	const block = await client.getBlock()
	if (block.number === undefined || block.hash === undefined) throw new Error('Pool registry block is unavailable')
	const blockNumber = block.number
	const total = await client.readContract({ abi: securityPoolFactoryAbi, address: factory, functionName: 'securityPoolDeploymentCount', args: [], blockNumber })
	const start = BigInt(page) * PAGE_SIZE
	const remaining = start >= total ? 0n : total - start
	const count = remaining < PAGE_SIZE ? remaining : PAGE_SIZE
	const deployments = count === 0n ? [] : await client.readContract({ abi: securityPoolFactoryAbi, address: factory, functionName: 'securityPoolDeploymentsRange', args: [start, count], blockNumber })
	const pools: CatalogPool[] = []
	for (const deployment of deployments) {
		const pool: CatalogPool = {
			address: deployment.securityPool,
			parent: deployment.parent,
			questionId: deployment.questionId.toString(),
			universeId: deployment.universeId.toString(),
			multiplierBps: deployment.statoblastSecurityMultiplierBps.toString(),
		}
		try {
			const [systemState, totalRep, vaultCount] = await Promise.all([
				client.readContract({ abi: securityPoolAbi, address: deployment.securityPool, functionName: 'systemState', args: [], blockNumber }),
				client.readContract({ abi: securityPoolAbi, address: deployment.securityPool, functionName: 'getTotalPoolHeldAttoRep', args: [], blockNumber }),
				client.readContract({ abi: securityPoolAbi, address: deployment.securityPool, functionName: 'getVaultCount', args: [], blockNumber }),
			])
			pool.metrics = { systemState: systemState.toString(), totalPoolHeldRep: formatDecimalAmount(totalRep), vaultCount: vaultCount.toString() }
		} catch (error) {
			// Keep discovery available and retain the failure in protected operator logs.
			console.warn(`Pool catalog metrics unavailable for ${pool.address}: ${errorMessage(error)}`)
		}
		pools.push(pool)
	}
	if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new Error('Pool registry block changed during discovery')
	return { chainId, page, pageCount: ((total + PAGE_SIZE - 1n) / PAGE_SIZE).toString(), total: total.toString(), block: blockNumber.toString(), pools }
}
