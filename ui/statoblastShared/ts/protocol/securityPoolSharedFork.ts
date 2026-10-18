import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { loadPortfolioSharedForkPosition, type PortfolioSharedForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { portfolioReadClient } from './securityPoolPortfolio.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadPortfolioForkOutcome } from './securityPoolPortfolioFork.js'
import { requireForkDataView } from './forkData.js'
import { getForkMigrationEndsAt, getUnresolvedEscalationMigrationSubmissionGuard } from './forkMigrationTiming.js'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
} from '../contractArtifact.js'
import * as forkCopy from '../copy/portfolioFork.js'
import * as copy from '../copy/portfolioSharedFork.js'

export async function loadSharedForkOutcome(client: ReadClient, snapshot: PortfolioSharedForkSnapshot, outcomeIndex: bigint, universeId = snapshot.universeId) {
	const result = await loadPortfolioForkOutcome(client, { zoltar: getInfraContractAddresses().zoltar, universeId, outcomeIndex, blockNumber: snapshot.blockNumber })
	if ((await client.getBlock({ blockNumber: snapshot.blockNumber })).hash !== snapshot.blockHash) throw new Error(copy.historyChanged)
	return result
}

export async function loadSharedForkPreparation(client: ReadClient, snapshot: PortfolioSharedForkSnapshot, positionId: bigint, outcomeIndex?: bigint) {
	const position = await loadPortfolioSharedForkPosition({ client: portfolioReadClient(client), snapshot, positionId, ...(outcomeIndex === undefined ? {} : { outcomeIndex }) })
	let reason: string | undefined
	let needsPreparation = false
	let migrationEndsAt: bigint | undefined
	let systemState: number | undefined
	let individualForkReason: string | undefined
	if (position.pool === zeroAddress) reason = copy.noSourcePool
	else {
		const [state, factory, forker, resolved] = await Promise.all([
			client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'systemState', blockNumber: snapshot.blockNumber }),
			client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'securityPoolFactory', blockNumber: snapshot.blockNumber }),
			client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'securityPoolForker', blockNumber: snapshot.blockNumber }),
			client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'isEscalationResolved', blockNumber: snapshot.blockNumber }),
		])
		systemState = Number(state)
		if (outcomeIndex !== undefined) {
			if (systemState !== 1) individualForkReason = forkCopy.notForked
			else {
				const vault = await client.readContract({ address: snapshot.portfolio, abi: portfolioArtifact.abi, functionName: 'vaultOf', args: [snapshot.owner], blockNumber: snapshot.blockNumber })
				if (vault !== zeroAddress) {
					const [holdings, debt, game] = await Promise.all([
						client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'securityVaults', args: [vault], blockNumber: snapshot.blockNumber }),
						client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'vaultBadDebtAttoEth', args: [vault], blockNumber: snapshot.blockNumber }),
						client.readContract({ address: position.pool, abi: poolArtifact.abi, functionName: 'escalationGame', blockNumber: snapshot.blockNumber }),
					])
					if (holdings[0] > 0n || holdings[1] > 0n || debt > 0n) individualForkReason = forkCopy.existingPosition
					else if (game !== zeroAddress && (await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'disputeStakedRepByVaultAttoRep', args: [vault], blockNumber: snapshot.blockNumber })) > 0n) individualForkReason = forkCopy.existingEscrow
				}
			}
		}
		if (outcomeIndex !== undefined && !resolved) {
			if (systemState !== 1) reason = forkCopy.notForked
			else {
				const fork = requireForkDataView(await client.readContract({ address: forker, abi: forkerArtifact.abi, functionName: 'forkData', args: [position.pool], blockNumber: snapshot.blockNumber }))
				migrationEndsAt = getForkMigrationEndsAt(fork.forkActivationTime)
				reason = getUnresolvedEscalationMigrationSubmissionGuard({ currentTimestamp: snapshot.timestamp, migrationEndsAt })
			}
			if (reason === undefined) {
				const childUniverseId = await client.readContract({ address: getInfraContractAddresses().zoltar, abi: Zoltar_Zoltar.abi, functionName: 'getChildUniverseId', args: [snapshot.universeId, outcomeIndex], blockNumber: snapshot.blockNumber })
				const [originId, feed, dependencies] = await Promise.all([
					client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'getSecurityPoolOriginId', args: [position.pool], blockNumber: snapshot.blockNumber }),
					client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'sharedPriceFeeds', args: [snapshot.portfolio, childUniverseId], blockNumber: snapshot.blockNumber }),
					client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'getChildPoolDependencies', args: [position.pool, outcomeIndex], blockNumber: snapshot.blockNumber }),
				])
				if (feed === zeroAddress) reason = forkCopy.childFeed
				else if (dependencies[0] === zeroAddress || dependencies[1] === zeroAddress) reason = forkCopy.childContracts
				else {
					const child = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'getSecurityPool', args: [originId, childUniverseId], blockNumber: snapshot.blockNumber })
					if (child === zeroAddress) reason = forkCopy.childPool
					else {
						const game = await client.readContract({ address: child, abi: poolArtifact.abi, functionName: 'escalationGame', blockNumber: snapshot.blockNumber })
						if (game !== zeroAddress && !(await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'isForkCarryFundingComplete', blockNumber: snapshot.blockNumber }))) reason = forkCopy.childHistory
					}
				}
			}
			needsPreparation = reason === forkCopy.notForked || reason === forkCopy.childFeed || reason === forkCopy.childContracts || reason === forkCopy.childPool || reason === forkCopy.childHistory
		}
	}
	if ((await client.getBlock({ blockNumber: snapshot.blockNumber })).hash !== snapshot.blockHash) throw new Error(copy.historyChanged)
	return { ...position, reason, needsPreparation, migrationEndsAt, systemState, individualForkReason }
}
