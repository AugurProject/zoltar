import { securityPoolFactoryAbi, securityPoolPortfolioAbi, securityPoolCapitalLedgerAbi, securityPoolCommitmentIndexAbi, securityPoolPortfolioForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { loadPortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { canonicalUintString } from '../core/units.ts'
import type { PortfolioCapitalSnapshot } from '../operations/portfolio-types.ts'
import type { PoolSnapshot, QuestionSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { requireGraphEdge } from './discovery-graph.ts'
import { contractSimulationReverted } from './discovery-client.ts'

/** Questions authenticate portfolio ownership; capital is read once per universe. */
export async function discoverPortfolioCapital(context: EcosystemDiscoveryContext, pools: readonly Pick<PoolSnapshot, 'address' | 'portfolio' | 'universeId' | 'questionId' | 'repToken'>[], blockNumber: bigint, questions: readonly QuestionSnapshot[] = []): Promise<PortfolioCapitalSnapshot[]> {
	const { client, deployments, wallet } = context
	if (wallet === undefined) return []
	const scopes = new Map<string, { portfolio: `0x${string}`; universeId: bigint; repToken: `0x${string}` }>()
	for (const pool of pools) {
		const portfolio = getAddress(await client.readContract({ address: deployments.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'getSecurityPoolPortfolio', args: [pool.address], blockNumber }))
		if (portfolio === zeroAddress) throw new Error(`Question ${pool.address} has no portfolio`)
		const universeId = BigInt(pool.universeId)
		const registered = await client.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'getPool', args: [BigInt(pool.questionId), universeId], blockNumber })
		requireGraphEdge(getAddress(registered), pool.address, 'Portfolio question binding')
		const key = `${portfolio.toLowerCase()}:${universeId}`
		const previous = scopes.get(key)
		if (previous !== undefined) requireGraphEdge(previous.repToken, pool.repToken, 'Portfolio universe REP binding')
		else scopes.set(key, { portfolio, universeId, repToken: pool.repToken })
	}
	const result: PortfolioCapitalSnapshot[] = []
	for (const scope of scopes.values()) {
		const factory = await client.readContract({ address: scope.portfolio, abi: securityPoolPortfolioAbi, functionName: 'factory', blockNumber })
		const zoltar = await client.readContract({ address: scope.portfolio, abi: securityPoolPortfolioAbi, functionName: 'zoltar', blockNumber })
		requireGraphEdge(getAddress(factory), deployments.securityPoolFactory, 'Portfolio factory binding')
		requireGraphEdge(getAddress(zoltar), deployments.zoltar, 'Portfolio protocol binding')
		const capital = await loadPortfolioCapitalSnapshot({ client, portfolio: scope.portfolio, universeId: scope.universeId, owner: wallet, blockNumber })
		const ledgerPortfolio = await client.readContract({ address: capital.capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'portfolio', blockNumber })
		const indexLedger = await client.readContract({ address: capital.commitmentIndex, abi: securityPoolCommitmentIndexAbi, functionName: 'portfolio', blockNumber })
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
