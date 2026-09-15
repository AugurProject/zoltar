import { loadPoolDeploymentDate } from './pool-deployment-date.ts'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import { securityPoolAbi, securityPoolFactoryAbi, zoltarQuestionDataAbi } from '@zoltar/bot-shared/contracts/abi'
import { formatDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from './vault-positions.ts'

type CatalogPool = {
	address: string
	parent: string
	questionId: string
	universeId: string
	multiplierBps: string
	deploymentDate?: string
	questionDates?: { startTime: string; endTime: string }
	metrics?: { systemState: string; totalPoolHeldRep: string; vaultCount: string }
}

export type PoolCatalogPage = {
	chainId: number
	page: number
	pageCount: string
	total: string
	pools: CatalogPool[]
}

const PAGE_SIZE = 12n

async function findPoolDeployment(client: ReadClient, factory: Address, address: Address, blockNumber: bigint) {
	const originId = await client.readContract({ abi: securityPoolFactoryAbi, address: factory, functionName: 'getSecurityPoolOriginId', args: [address], blockNumber })
	if (BigInt(originId) === 0n) return []
	const universeId = await client.readContract({ abi: securityPoolAbi, address, functionName: 'universeId', args: [], blockNumber })
	const registered = await client.readContract({ abi: securityPoolFactoryAbi, address: factory, functionName: 'getSecurityPool', args: [originId, universeId], blockNumber })
	if (registered.toLowerCase() !== address.toLowerCase()) return []
	const [parent, questionId, statoblastSecurityMultiplierBps] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address, functionName: 'parent', args: [], blockNumber }),
		client.readContract({ abi: securityPoolAbi, address, functionName: 'questionId', args: [], blockNumber }),
		client.readContract({ abi: securityPoolAbi, address, functionName: 'statoblastSecurityMultiplierBps', args: [], blockNumber }),
	])
	return [{ securityPool: address, parent, universeId, questionId, statoblastSecurityMultiplierBps }]
}

export async function loadPoolCatalog(client: ReadClient, factory: Address, chainId: number, page: number, searchAddress?: Address, monitoredAddresses?: readonly Address[]): Promise<PoolCatalogPage> {
	if (!Number.isSafeInteger(page) || page < 0) throw new Error('Pool page must be a non-negative safe integer')
	const block = await client.getBlock()
	if (block.number === undefined || block.hash === undefined) throw new Error('Pool registry block is unavailable')
	const blockNumber = block.number
	const monitored = monitoredAddresses === undefined ? undefined : [...new Set(monitoredAddresses.map(address => getAddress(address)))]
	let match: Awaited<ReturnType<typeof findPoolDeployment>> | undefined
	if (searchAddress !== undefined) {
		const address = getAddress(searchAddress)
		match = monitored === undefined || monitored.includes(address) ? await findPoolDeployment(client, factory, address, blockNumber) : []
	}
	let total: bigint
	if (match !== undefined) total = BigInt(match.length)
	else if (monitored !== undefined) total = BigInt(monitored.length)
	else total = await client.readContract({ abi: securityPoolFactoryAbi, address: factory, functionName: 'securityPoolDeploymentCount', args: [], blockNumber })
	const start = BigInt(page) * PAGE_SIZE
	const remaining = start >= total ? 0n : total - start
	const count = remaining < PAGE_SIZE ? remaining : PAGE_SIZE
	let deployments: Readonly<Awaited<ReturnType<typeof findPoolDeployment>>> = match ?? []
	if (match === undefined && count > 0n) {
		if (monitored === undefined) deployments = await client.readContract({ abi: securityPoolFactoryAbi, address: factory, functionName: 'securityPoolDeploymentsRange', args: [start, count], blockNumber })
		else deployments = (await Promise.all(monitored.slice(Number(start), Number(start + count)).map(address => findPoolDeployment(client, factory, address, blockNumber)))).flat()
	}
	const pools = await Promise.all(
		deployments.map(async deployment => {
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
			try {
				const questionData = await client.readContract({ abi: securityPoolAbi, address: deployment.securityPool, functionName: 'questionData', args: [], blockNumber })
				const [createdAt, question] = await Promise.all([
					client.readContract({ abi: zoltarQuestionDataAbi, address: questionData, functionName: 'questionCreatedTimestamp', args: [deployment.questionId], blockNumber }),
					client.readContract({ abi: zoltarQuestionDataAbi, address: questionData, functionName: 'questions', args: [deployment.questionId], blockNumber }),
				])
				if (createdAt > 0n) pool.questionDates = { startTime: question[2].toString(), endTime: question[3].toString() }
			} catch (error) {
				console.warn(`Pool catalog question dates unavailable for ${pool.address}: ${errorMessage(error)}`)
			}

			try {
				const deploymentDate = await loadPoolDeploymentDate(client, factory, deployment.securityPool, blockNumber)
				if (deploymentDate !== undefined) pool.deploymentDate = deploymentDate
			} catch (error) {
				console.warn(`Pool catalog deployment date unavailable for ${pool.address}: ${errorMessage(error)}`)
			}
			return pool
		}),
	)
	if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new Error('Pool registry block changed during discovery')
	return { chainId, page: searchAddress === undefined ? page : 0, pageCount: ((total + PAGE_SIZE - 1n) / PAGE_SIZE).toString(), total: total.toString(), pools }
}
