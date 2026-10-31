import { parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { requireAddressValue, requireBooleanValue, requireIntegerLikeValue } from './decoders.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { executeForkAuctionAction } from './securityPoolActions.js'

const portfolioAbi = parseAbi(['function forkController() view returns (address)', 'function isReady(uint248 universeId) view returns (bool)', 'function sourceGame(uint248 universeId,uint256 questionId) view returns (address)'])
async function portfolioParent(client: Pick<ReadClient, 'readContract'>, parent: Address) {
	return client.readContract({ address: getInfraContractAddresses().securityPoolFactory, abi: factoryArtifact.abi, functionName: 'getSecurityPoolPortfolio', args: [parent] })
}
async function boundQuestionTarget(client: Pick<ReadClient, 'readContract'>, portfolio: Address, parent: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	const infrastructure = getInfraContractAddresses()
	const [childUniverseId, questionId, controllerValue] = await Promise.all([
		client.readContract({ address: infrastructure.zoltar, abi: Zoltar_Zoltar.abi, functionName: 'getChildUniverseId', args: [universeId, BigInt(getReportingOutcomeValue(outcome))] }),
		client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'questionId' }),
		client.readContract({ address: portfolio, abi: portfolioAbi, functionName: 'forkController' }),
	])
	const controller = requireAddressValue(controllerValue, 'fork coordinator')
	const [ready, gameValue] = await Promise.all([client.readContract({ address: controller, abi: portfolioAbi, functionName: 'isReady', args: [childUniverseId] }), client.readContract({ address: portfolio, abi: portfolioAbi, functionName: 'sourceGame', args: [childUniverseId, questionId] })])
	if (!requireBooleanValue(ready, 'portfolio branch readiness')) throw new Error('Activate this shared branch in the portfolio first.')
	const game = requireAddressValue(gameValue, 'reporter source game')
	const source = game === zeroAddress ? parent : await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'securityPool' })
	return { source, childUniverseId }
}
export async function loadChildPoolPreparation(client: Pick<ReadClient, 'readContract'>, parent: Address, childUniverseId: bigint, outcome: ReportingOutcomeKey) {
	const address = getInfraContractAddresses().securityPoolFactory
	const [portfolio, originId] = await Promise.all([portfolioParent(client, parent), client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getSecurityPoolOriginId', args: [parent] })])
	const childPool = await client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getSecurityPool', args: [originId, childUniverseId] })
	if (portfolio !== zeroAddress) {
		const controller = requireAddressValue(await client.readContract({ address: portfolio, abi: portfolioAbi, functionName: 'forkController' }), 'fork coordinator')
		const branchReady = requireBooleanValue(await client.readContract({ address: controller, abi: portfolioAbi, functionName: 'isReady', args: [childUniverseId] }), 'portfolio branch readiness')
		const operational = childPool !== zeroAddress && Number(await client.readContract({ address: childPool, abi: poolArtifact.abi, functionName: 'systemState' })) === 0
		const history = await loadChildHistoryPreparation(client, childPool)
		return { portfolio, branchReady, sharedFeed: undefined, childPool, dependenciesPrepared: true, historyOutcomesInitialized: operational ? 3 : history.historyOutcomesInitialized, historyReady: operational }
	}
	const [coordinator, truthAuction] = await client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getChildPoolDependencies', args: [parent, BigInt(getReportingOutcomeValue(outcome))] })
	return { portfolio: undefined, branchReady: undefined, sharedFeed: undefined, childPool, ...(await loadChildHistoryPreparation(client, childPool)), dependenciesPrepared: coordinator !== zeroAddress && truthAuction !== zeroAddress }
}

export async function loadChildHistoryPreparation(client: Pick<ReadClient, 'readContract'>, childPool: Address) {
	const game = childPool === zeroAddress ? zeroAddress : await client.readContract({ address: childPool, abi: poolArtifact.abi, functionName: 'escalationGame' })
	const continuation = game !== zeroAddress && (await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'forkContinuation' }))
	const historyOutcomesInitialized = !continuation ? 0 : Number(requireIntegerLikeValue(await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'forkCarrySnapshotOutcomesInitialized' }), 'child history progress'))
	if (historyOutcomesInitialized < 0 || historyOutcomesInitialized > 3) throw new Error('Invalid child history progress')
	return { historyOutcomesInitialized, historyReady: childPool !== zeroAddress && (!continuation || historyOutcomesInitialized === 3) }
}

/** Each preparation is a separate wallet action; it never migrates anyone's REP. */
export async function prepareChildPool(client: WriteClient, parent: Address, universeId: bigint, outcome: ReportingOutcomeKey, kind: 'feed' | 'dependencies') {
	const portfolio = await portfolioParent(client, parent)
	if (portfolio !== zeroAddress) {
		if (kind !== 'feed') throw new Error('Portfolio questions do not deploy native truth auctions.')
		const target = await boundQuestionTarget(client, portfolio, parent, universeId, outcome)
		return executeForkAuctionAction('prepareChildPriceFeed', parent, universeId, async () =>
			writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: forkerArtifact.abi,
				functionName: 'preparePortfolioQuestion',
				args: [target.source, target.childUniverseId],
				reviewTitle: 'Prepare portfolio question',
				reviewDescription: 'Deploy this child question namespace. Its shared branch is already active; this does not migrate owner principal.',
			})),
		)
	}
	return await executeForkAuctionAction(
		kind === 'feed' ? 'prepareChildPriceFeed' : 'prepareChildDependencies',
		parent,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolFactory,
				abi: factoryArtifact.abi,
				functionName: kind === 'feed' ? 'preparePortfolioChildPriceFeed' : 'prepareChildPoolDependencies',
				args: [parent, BigInt(getReportingOutcomeValue(outcome))],
				reviewTitle: kind === 'feed' ? 'Prepare child price feed' : 'Prepare child pool contracts',
				reviewDescription: `Prepare ${kind === 'feed' ? 'the shared REP price feed' : 'the price coordinator and auction'} for the ${outcome} child universe. Your REP remains in its current vault until you choose a separate migration transaction.`,
			})),
	)
}

/** Copies one outcome per transaction and remains available after the registration deadline. */
export async function initializeChildDisputeHistory(client: WriteClient, parent: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	const portfolio = await portfolioParent(client, parent)
	if (portfolio !== zeroAddress) {
		const target = await boundQuestionTarget(client, portfolio, parent, universeId, outcome)
		return executeForkAuctionAction('initializeChildHistory', parent, universeId, async () =>
			writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: forkerArtifact.abi,
				functionName: 'materializePortfolioQuestion',
				args: [target.source, target.childUniverseId],
				reviewTitle: 'Initialize portfolio question',
				reviewDescription: 'Install one of the three reporter outcomes. The final step activates this question without extending its fixed response deadline.',
			})),
		)
	}
	return await executeForkAuctionAction(
		'initializeChildHistory',
		parent,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: forkerArtifact.abi,
				functionName: 'continueChildUniverse',
				args: [parent, BigInt(getReportingOutcomeValue(outcome))],
				reviewTitle: 'Initialize dispute history',
				reviewDescription: 'Initialize the next outcome of the registered child pool. This does not migrate your vault or extend the migration deadline.',
			})),
	)
}
