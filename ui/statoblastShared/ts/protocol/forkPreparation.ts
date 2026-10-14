import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { requireIntegerLikeValue } from './decoders.js'
import { executeForkAuctionAction } from './securityPoolActions.js'

export async function loadChildPoolPreparation(client: Pick<ReadClient, 'readContract'>, parent: Address, childUniverseId: bigint, outcome: ReportingOutcomeKey) {
	const address = getInfraContractAddresses().securityPoolFactory
	const [portfolio, originId, dependencies] = await Promise.all([
		client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getSecurityPoolPortfolio', args: [parent] }),
		client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getSecurityPoolOriginId', args: [parent] }),
		client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getChildPoolDependencies', args: [parent, BigInt(getReportingOutcomeValue(outcome))] }),
	])
	const [coordinator, truthAuction] = dependencies
	const sharedFeed = portfolio === zeroAddress ? undefined : await client.readContract({ address, abi: factoryArtifact.abi, functionName: 'sharedPriceFeeds', args: [portfolio, childUniverseId] })
	const childPool = await client.readContract({ address, abi: factoryArtifact.abi, functionName: 'getSecurityPool', args: [originId, childUniverseId] })
	return { sharedFeed, childPool, ...(await loadChildHistoryPreparation(client, childPool)), dependenciesPrepared: coordinator !== zeroAddress && truthAuction !== zeroAddress }
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
