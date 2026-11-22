import { collectCountedPages } from './discovery-registry.ts'
import { limitsWithDefaults } from './discovery-context.ts'
import { zoltarAbi, securityPoolFactoryAbi, securityPoolPortfolioAbi, securityPoolCapitalLedgerAbi, securityPoolCommitmentIndexAbi, securityPoolPortfolioForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { loadPortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { canonicalUintString } from '../core/units.ts'
import type { PortfolioCapitalSnapshot } from '../operations/portfolio-types.ts'
import type { PoolSnapshot, QuestionSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { requireGraphEdge } from './discovery-graph.ts'
import { contractSimulationReverted } from './discovery-client.ts'

/** Question bindings authenticate active scopes; the factory registry supplies questionless origins. Capital is read once per universe. */
export async function discoverPortfolioCapital(context: EcosystemDiscoveryContext, pools: readonly Pick<PoolSnapshot, 'address' | 'portfolio' | 'universeId' | 'questionId' | 'repToken'>[], blockNumber: bigint, questions: readonly QuestionSnapshot[] = []): Promise<PortfolioCapitalSnapshot[]> {
	const { client, deployments, wallet } = context
	if (wallet === undefined) return []
	const scopes = new Map<string, { portfolio: `0x${string}`; universeId: bigint; repToken: `0x${string}` }>()
	const authenticated = new Set<string>()
	const authenticatePortfolio = async (portfolio: Address) => {
		const key = portfolio.toLowerCase()
		if (authenticated.has(key)) return
		const [factory, zoltar] = await Promise.all([client.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'factory', blockNumber }), client.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'zoltar', blockNumber })])
		requireGraphEdge(getAddress(factory), deployments.securityPoolFactory, 'Portfolio factory binding')
		requireGraphEdge(getAddress(zoltar), deployments.zoltar, 'Portfolio protocol binding')
		authenticated.add(key)
	}
	for (const pool of pools) {
		const portfolio = getAddress(await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'getSecurityPoolPortfolio', args: [pool.address], blockNumber }))
		if (portfolio === zeroAddress) throw new Error(`Question ${pool.address} has no portfolio`)
		const universeId = BigInt(pool.universeId)
		const registered = await client.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'getPool', args: [BigInt(pool.questionId), universeId], blockNumber })
		requireGraphEdge(getAddress(registered), pool.address, 'Portfolio question binding')
		await authenticatePortfolio(portfolio)
		const key = `${portfolio.toLowerCase()}:${universeId}`
		const previous = scopes.get(key)
		if (previous !== undefined) requireGraphEdge(previous.repToken, pool.repToken, 'Portfolio universe REP binding')
		else scopes.set(key, { portfolio, universeId, repToken: pool.repToken })
	}
	// The factory registry also contains completed portfolios before their first question is admitted.
	const count = await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'portfolioCount', blockNumber })
	const maximum = limitsWithDefaults(context.limits).maxPools
	if (count > BigInt(maximum)) throw new Error(`Portfolio registry exceeds discovery limit ${maximum}`)
	const page = await collectCountedPages({
		count,
		start: 0n,
		maximumItems: maximum,
		pageSize: 32,
		label: 'Portfolio registry',
		readPage: async (start, requested) => await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'portfoliosRange', args: [start, requested], blockNumber }),
	})
	for (const portfolio of page.values) {
		await authenticatePortfolio(portfolio)
		const setup = await client.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'setupStage', blockNumber })
		if (setup !== 4n) continue
		const universeId = await client.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'originUniverseId', blockNumber })
		const key = `${portfolio.toLowerCase()}:${universeId}`
		if (scopes.has(key)) continue
		const repToken = await client.readContract({ address: deployments.zoltar, abi: zoltarAbi, functionName: 'getRepToken', args: [universeId], blockNumber })
		scopes.set(key, { portfolio, universeId, repToken })
	}
	const result: PortfolioCapitalSnapshot[] = []
	for (const scope of scopes.values()) {
		const capital = await loadPortfolioCapitalSnapshot({ client, portfolio: scope.portfolio, universeId: scope.universeId, owner: wallet, blockNumber })
		const ledgerPortfolio = await client.readContract({ address: capital.capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'portfolio', blockNumber })
		const indexLedger = await client.readContract({ address: capital.commitmentIndex, abi: securityPoolCommitmentIndexAbi, functionName: 'capitalLedger', blockNumber })
		const forkController = getAddress(await client.readContract({ address: scope.portfolio, abi: securityPoolPortfolioAbi, functionName: 'forkController', blockNumber }))
		const forkPortfolio = await client.readContract({ address: forkController, abi: securityPoolPortfolioForkCoordinatorAbi, functionName: 'portfolio', blockNumber })
		requireGraphEdge(getAddress(ledgerPortfolio), scope.portfolio, 'Capital portfolio binding')
		requireGraphEdge(getAddress(indexLedger), capital.capitalLedger, 'Commitment ledger binding')
		requireGraphEdge(getAddress(forkPortfolio), scope.portfolio, 'Fork controller portfolio binding')
		requireGraphEdge(capital.repToken, scope.repToken, 'Capital REP binding')
		const admissibleQuestionIds: string[] = []
		const origin = await client.readContract({ address: scope.portfolio, abi: securityPoolPortfolioAbi, functionName: 'originUniverseId', blockNumber })
		if (origin === scope.universeId && capital.forkTime === 0n && !capital.frozen && !capital.importing) {
			for (const question of questions) {
				if (question.kind !== 'binary' || pools.some(pool => pool.universeId === origin.toString() && pool.questionId === question.id && pool.portfolio.toLowerCase() === scope.portfolio.toLowerCase())) continue
				try {
					await client.simulateContract({ address: scope.portfolio, abi: securityPoolPortfolioAbi, account: wallet, functionName: 'addQuestion', args: [BigInt(question.id)], blockNumber })
					admissibleQuestionIds.push(question.id)
				} catch (error) {
					if (!contractSimulationReverted(error)) throw error
				}
			}
		}
		result.push({
			admissibleQuestionIds,
			portfolio: scope.portfolio,
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
