import { collectCountedPages } from './discovery-registry.ts'
import { limitsWithDefaults } from './discovery-context.ts'
import { zoltarAbi, securityPoolFactoryAbi, securityPoolAbi, securityPoolCapitalLedgerAbi, securityPoolCommitmentIndexAbi, securityPoolForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { loadSecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { canonicalUintString } from '../core/units.ts'
import type { SecurityPoolCapitalSnapshot } from '../operations/security-pool-types.ts'
import type { PoolSnapshot, QuestionSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { requireGraphEdge } from './discovery-graph.ts'
import { contractSimulationReverted } from './discovery-client.ts'

/** Question bindings authenticate active scopes; the factory registry supplies questionless origins. Capital is read once per universe. */
export async function discoverSecurityPoolCapital(context: EcosystemDiscoveryContext, pools: readonly Pick<PoolSnapshot, 'address' | 'securityPool' | 'universeId' | 'questionId' | 'repToken'>[], blockNumber: bigint, questions: readonly QuestionSnapshot[] = []): Promise<SecurityPoolCapitalSnapshot[]> {
	const { client, deployments, wallet } = context
	if (wallet === undefined) return []
	const scopes = new Map<string, { securityPool: `0x${string}`; universeId: bigint; repToken: `0x${string}` }>()
	const authenticated = new Set<string>()
	const authenticateSecurityPool = async (securityPool: Address) => {
		const key = securityPool.toLowerCase()
		if (authenticated.has(key)) return
		const [factory, zoltar] = await Promise.all([client.readContract({ address: securityPool, abi: securityPoolAbi, functionName: 'factory', blockNumber }), client.readContract({ address: securityPool, abi: securityPoolAbi, functionName: 'zoltar', blockNumber })])
		requireGraphEdge(getAddress(factory), deployments.securityPoolFactory, 'Security pool factory binding')
		requireGraphEdge(getAddress(zoltar), deployments.zoltar, 'Security pool protocol binding')
		authenticated.add(key)
	}
	for (const pool of pools) {
		const securityPool = getAddress(await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'securityPoolOf', args: [pool.address], blockNumber }))
		if (securityPool === zeroAddress) throw new Error(`Question ${pool.address} has no security pool`)
		const universeId = BigInt(pool.universeId)
		const registered = await client.readContract({ address: securityPool, abi: securityPoolAbi, functionName: 'getPool', args: [BigInt(pool.questionId), universeId], blockNumber })
		requireGraphEdge(getAddress(registered), pool.address, 'Security pool question binding')
		await authenticateSecurityPool(securityPool)
		const key = `${securityPool.toLowerCase()}:${universeId}`
		const previous = scopes.get(key)
		if (previous !== undefined) requireGraphEdge(previous.repToken, pool.repToken, 'Security pool universe REP binding')
		else scopes.set(key, { securityPool, universeId, repToken: pool.repToken })
	}
	// The factory registry also contains completed security pools before their first question is admitted.
	const count = await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'securityPoolCount', blockNumber })
	const maximum = limitsWithDefaults(context.limits).maxPools
	if (count > BigInt(maximum)) throw new Error(`Security pool registry exceeds discovery limit ${maximum}`)
	const page = await collectCountedPages({
		count,
		start: 0n,
		maximumItems: maximum,
		pageSize: 32,
		label: 'Security pool registry',
		readPage: async (start, requested) => await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'securityPoolsRange', args: [start, requested], blockNumber }),
	})
	for (const securityPool of page.values) {
		await authenticateSecurityPool(securityPool)
		const setup = await client.readContract({ address: securityPool, abi: securityPoolAbi, functionName: 'setupStage', blockNumber })
		if (setup !== 4n) continue
		const universeId = await client.readContract({ address: securityPool, abi: securityPoolAbi, functionName: 'originUniverseId', blockNumber })
		const key = `${securityPool.toLowerCase()}:${universeId}`
		if (scopes.has(key)) continue
		const repToken = await client.readContract({ address: deployments.zoltar, abi: zoltarAbi, functionName: 'getRepToken', args: [universeId], blockNumber })
		scopes.set(key, { securityPool, universeId, repToken })
	}
	const result: SecurityPoolCapitalSnapshot[] = []
	for (const scope of scopes.values()) {
		const capital = await loadSecurityPoolCapitalSnapshot({ client, securityPool: scope.securityPool, universeId: scope.universeId, owner: wallet, blockNumber })
		const ledgerSecurityPool = await client.readContract({ address: capital.capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'securityPool', blockNumber })
		const indexLedger = await client.readContract({ address: capital.commitmentIndex, abi: securityPoolCommitmentIndexAbi, functionName: 'capitalLedger', blockNumber })
		const forkController = getAddress(await client.readContract({ address: scope.securityPool, abi: securityPoolAbi, functionName: 'forkController', blockNumber }))
		const forkSecurityPool = await client.readContract({ address: forkController, abi: securityPoolForkCoordinatorAbi, functionName: 'securityPool', blockNumber })
		requireGraphEdge(getAddress(ledgerSecurityPool), scope.securityPool, 'Capital security pool binding')
		requireGraphEdge(getAddress(indexLedger), capital.capitalLedger, 'Commitment ledger binding')
		requireGraphEdge(getAddress(forkSecurityPool), scope.securityPool, 'Fork controller security pool binding')
		requireGraphEdge(capital.repToken, scope.repToken, 'Capital REP binding')
		const admissibleQuestionIds: string[] = []
		const origin = await client.readContract({ address: scope.securityPool, abi: securityPoolAbi, functionName: 'originUniverseId', blockNumber })
		if (origin === scope.universeId && capital.forkTime === 0n && !capital.frozen && !capital.importing) {
			for (const question of questions) {
				if (question.kind !== 'binary' || pools.some(pool => pool.universeId === origin.toString() && pool.questionId === question.id && pool.securityPool.toLowerCase() === scope.securityPool.toLowerCase())) continue
				try {
					await client.simulateContract({ address: scope.securityPool, abi: securityPoolAbi, account: wallet, functionName: 'addQuestion', args: [BigInt(question.id)], blockNumber })
					admissibleQuestionIds.push(question.id)
				} catch (error) {
					if (!contractSimulationReverted(error)) throw error
				}
			}
		}
		result.push({
			admissibleQuestionIds,
			securityPool: scope.securityPool,
			universeId: canonicalUintString(scope.universeId),
			capitalLedger: capital.capitalLedger,
			commitmentIndex: capital.commitmentIndex,
			repToken: capital.repToken,
			priceFeed: capital.priceFeed,
			forkController,
			owner: wallet,
			positionId: canonicalUintString(capital.ownerAccount.positionId),
			principalAttoRep: canonicalUintString(capital.ownerPrincipalAttoRep),
			pledgedAttoRep: canonicalUintString(capital.positions.reduce((sum, position) => sum + position.rep, 0n)),
			commitmentAttoEth: canonicalUintString(capital.ownerCommitmentAttoEth),
			withdrawableAttoRep: canonicalUintString(capital.withdrawableAttoRep),
			feesAttoEth: canonicalUintString(capital.accruedFeesAttoEth),
			feesAttoRep: canonicalUintString(capital.accruedFeesAttoRep),
			targetHealthFactorBps: canonicalUintString(capital.ownerAccount.targetHealthFactorBps),
			minimumCommitmentAttoEth: canonicalUintString(capital.economics.minimumCommitmentAttoEth),
			securityMultiplierBps: canonicalUintString(capital.securityMultiplierBps),
			ownerConservativePrice: canonicalUintString(capital.ownerConservativePrice),
			ownerLiquidating: capital.positions.some(position => position.maxHealthyPrice < capital.liquidationPrice),
			priceValid: capital.priceValid,
			priceValidUntil: canonicalUintString(capital.priceValidUntil),
			forkTime: canonicalUintString(capital.forkTime),
			frozen: capital.frozen,
			importing: capital.importing,
			exported: capital.exported,
			retirementPending: capital.positions.some(position => position.batch !== 0n),
			retirementReady: capital.positions.some(position => position.retirementPreview?.status === 'ready'),
		})
	}
	return result
}
