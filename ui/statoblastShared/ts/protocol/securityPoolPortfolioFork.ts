import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { formatScalarOutcomeIndexLabel } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolPortfolioForkController_SecurityPoolPortfolioForkController as sharedForkArtifact,
} from '../contractArtifact.js'
import { getForkMigrationEndsAt, getUnresolvedEscalationMigrationSubmissionGuard } from './forkMigrationTiming.js'
import { requireForkDataView } from './forkData.js'
import * as copy from '../copy/portfolioFork.js'
import * as portfolioCopy from '../copy/portfolio.js'
import * as sharedForkCopy from '../copy/portfolioSharedFork.js'

export type PortfolioForkClaimSelection = { portfolio: Address; owner: Address; questionId: bigint; originUniverseId: bigint; positionId: bigint; intervalId: bigint; outcomeIndex: bigint }

/** Resolves the source universe's fork question without assuming a fixed number of branches. */
export async function loadPortfolioForkOutcome(client: Pick<ReadClient, 'readContract'>, parameters: { zoltar: Address; universeId: bigint; outcomeIndex: bigint; blockNumber: bigint }) {
	const { zoltar, universeId, outcomeIndex, blockNumber } = parameters
	const [universe, questionData] = await Promise.all([client.readContract({ address: zoltar, abi: Zoltar_Zoltar.abi, functionName: 'universes', args: [universeId], blockNumber }), client.readContract({ address: zoltar, abi: Zoltar_Zoltar.abi, functionName: 'zoltarQuestionData', blockNumber })])
	const forkQuestionId = universe[1]
	const [question, firstLabels] = await Promise.all([
		client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'questions', args: [forkQuestionId], blockNumber }),
		client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getOutcomeLabels', args: [forkQuestionId, 0n, 1n], blockNumber }),
	])
	const [questionTitle, , , , numTicks, displayValueMin, displayValueMax, answerUnit] = question
	let outcomeLabel: string | undefined
	if (firstLabels.length === 0 && numTicks > 0n) outcomeLabel = formatScalarOutcomeIndexLabel({ numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeIndex)
	else if (outcomeIndex === 0n) outcomeLabel = copy.invalid
	else {
		const labels = await client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getOutcomeLabels', args: [forkQuestionId, outcomeIndex - 1n, 1n], blockNumber })
		outcomeLabel = labels[0]
	}
	return { questionTitle, outcomeLabel }
}

/** Reads only the selected allocation and branch; every accounting read uses the same mined block. */
export async function loadPortfolioForkClaimState(client: Pick<ReadClient, 'readContract' | 'getBlock'>, selection: PortfolioForkClaimSelection) {
	const block = await client.getBlock()
	if (block.number === undefined || block.hash === undefined) throw new Error(portfolioCopy.snapshotFailed)
	const blockNumber = block.number
	const [parent, vault, ledger, ownerShares, controller] = await Promise.all([
		client.readContract({ address: selection.portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [selection.questionId, selection.originUniverseId], blockNumber }),
		client.readContract({ address: selection.portfolio, abi: portfolioArtifact.abi, functionName: 'vaultOf', args: [selection.owner], blockNumber }),
		client.readContract({ address: selection.portfolio, abi: portfolioArtifact.abi, functionName: 'recoveryLedger', blockNumber }),
		client.readContract({ address: selection.portfolio, abi: portfolioArtifact.abi, functionName: 'getOwnerPositionShares', args: [selection.positionId, selection.owner], blockNumber }),
		client.readContract({ address: selection.portfolio, abi: portfolioArtifact.abi, functionName: 'forkController', blockNumber }),
	])
	const [systemState, factory, forker, zoltar, game, interval, sharedChoice] = await Promise.all([
		client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'systemState', blockNumber }),
		client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'securityPoolFactory', blockNumber }),
		client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'securityPoolForker', blockNumber }),
		client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'escalationGame', blockNumber }),
		client.readContract({ address: ledger, abi: recoveryArtifact.abi, functionName: 'getOwnerInterval', args: [selection.owner, selection.intervalId], blockNumber }),
		client.readContract({ address: controller, abi: sharedForkArtifact.abi, functionName: 'isIntervalSelected', args: [0n, selection.owner, selection.intervalId], blockNumber }),
	])
	let reason: string | undefined
	let questionTitle: string | undefined
	let outcomeLabel: string | undefined
	if (ownerShares === 0n) reason = portfolioCopy.noPositionClaim
	else if (!interval.active || interval.shares !== ownerShares || interval.startPosition > selection.positionId || (!interval.open && interval.endPosition < selection.positionId)) reason = portfolioCopy.recoveryHistoryChanged
	else if (sharedChoice) reason = sharedForkCopy.selectedFallback
	else if (Number(systemState) !== 1) reason = copy.notForked
	if (reason === undefined && vault !== zeroAddress) {
		const [position, debt, escrow] = await Promise.all([
			client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'securityVaults', args: [vault], blockNumber }),
			client.readContract({ address: parent, abi: poolArtifact.abi, functionName: 'vaultBadDebtAttoEth', args: [vault], blockNumber }),
			game === zeroAddress ? Promise.resolve(0n) : client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'disputeStakedRepByVaultAttoRep', args: [vault], blockNumber }),
		])
		if (position[0] > 0n || position[1] > 0n || debt > 0n) reason = copy.existingPosition
		else if (escrow > 0n) reason = copy.existingEscrow
	}
	if (reason === undefined) {
		const outcome = await loadPortfolioForkOutcome(client, { zoltar, universeId: selection.originUniverseId, outcomeIndex: selection.outcomeIndex, blockNumber })
		questionTitle = outcome.questionTitle
		outcomeLabel = outcome.outcomeLabel
		if (outcomeLabel === undefined) reason = copy.chooseOutcome
	}
	if (reason === undefined) {
		const fork = requireForkDataView(await client.readContract({ address: forker, abi: forkerArtifact.abi, functionName: 'forkData', args: [parent], blockNumber }))
		reason = getUnresolvedEscalationMigrationSubmissionGuard({ currentTimestamp: block.timestamp, migrationEndsAt: getForkMigrationEndsAt(fork.forkActivationTime) })
	}
	if (reason === undefined) {
		const childUniverseId = await client.readContract({ address: zoltar, abi: Zoltar_Zoltar.abi, functionName: 'getChildUniverseId', args: [selection.originUniverseId, selection.outcomeIndex], blockNumber })
		const [originId, feed, dependencies] = await Promise.all([
			client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'getSecurityPoolOriginId', args: [parent], blockNumber }),
			client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'sharedPriceFeeds', args: [selection.portfolio, childUniverseId], blockNumber }),
			client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'getChildPoolDependencies', args: [parent, selection.outcomeIndex], blockNumber }),
		])
		const child = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'getSecurityPool', args: [originId, childUniverseId], blockNumber })
		if (feed === zeroAddress) reason = copy.childFeed
		else if (dependencies[0] === zeroAddress || dependencies[1] === zeroAddress) reason = copy.childContracts
		else if (child === zeroAddress) reason = copy.childPool
		else {
			const childGame = await client.readContract({ address: child, abi: poolArtifact.abi, functionName: 'escalationGame', blockNumber })
			if (childGame !== zeroAddress && !(await client.readContract({ address: childGame, abi: gameArtifact.abi, functionName: 'isForkCarryFundingComplete', blockNumber }))) reason = copy.childHistory
		}
	}
	if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new Error(portfolioCopy.snapshotFailed)
	return { parent, reason, questionTitle, outcomeLabel }
}
