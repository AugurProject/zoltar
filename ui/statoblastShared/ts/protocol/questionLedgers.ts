import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { readOptionalMulticall, readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_QuestionLedger_QuestionLedger, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import { checkStatoblastEntries } from './statoblastEntries.js'
import { loadQuestionLedgerDetails } from './questionLedgerSnapshot.js'

type DeploymentRegistryAnchor = Readonly<{ blockHash: `0x${string}`; blockNumber: bigint; timestamp: bigint }>

async function loadDeploymentRegistryAnchor(client: ReadClient): Promise<DeploymentRegistryAnchor> {
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error('Question ledger deployment head is missing its canonical identity')
	return { blockHash: block.hash, blockNumber: block.number, timestamp: block.timestamp }
}

async function requireDeploymentRegistryAnchor(client: ReadClient, anchor: DeploymentRegistryAnchor, changedMessage = 'Question ledger deployments changed during discovery') {
	const block = await client.getBlock({ blockNumber: anchor.blockNumber })
	if (block.hash?.toLowerCase() !== anchor.blockHash.toLowerCase()) throw new Error(changedMessage)
}

export async function loadStatoblastQuestion(client: ReadClient, pool: Address, questionId: bigint, universeId: bigint, useSessionCache = true, includeSharesFacts = false) {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const [checked] = await checkStatoblastEntries(client, [{ pool, questionId, universeId }], anchor.blockNumber, useSessionCache)
	if (checked?.status === 'failed') throw checked.error
	if (checked?.status === 'unregistered-question') throw new Error('Question not registered')
	if (checked?.status === 'unprepared-question') throw new Error('Question pool unavailable')
	if (checked?.status === 'non-statoblast-contract') throw new Error('This contract is not a Statoblast security pool.')
	if (checked?.status !== 'question') throw new Error('No contract exists at this security pool address.')
	const [question, sharesFacts] = await Promise.all([loadCheckedQuestionLedger(client, checked.ledger, universeId, anchor.blockNumber), includeSharesFacts ? readSharesFacts(client, checked.pool, universeId, anchor.blockNumber).catch(() => undefined) : undefined])
	await requireDeploymentRegistryAnchor(client, anchor, 'Question changed during refresh.')
	return { question, sharesFacts, block: { number: anchor.blockNumber, timestamp: anchor.timestamp } }
}

async function readSharesFacts(client: ReadClient, pool: Address, universeId: bigint, blockNumber: bigint) {
	const contract = { abi: statoblast_SecurityPool_SecurityPool.abi, address: pool }
	const [collateral, capacity, annual, purchase, minimum] = await readOptionalMulticall(
		client,
		[
			{ ...contract, functionName: 'collateralToken' },
			{ ...contract, functionName: 'availableMintCapacity', args: [universeId] },
			{ ...contract, functionName: 'annualFeeBps' },
			{ ...contract, functionName: 'purchaseFeeBps' },
			{ ...contract, functionName: 'minimumPurchaseFeeAttoEth' },
		],
		blockNumber,
	)
	return {
		collateral: collateral.status === 'success' ? collateral.result : undefined,
		capacity: capacity.status === 'success' ? capacity.result : undefined,
		annualFeeBps: annual.status === 'success' ? annual.result : undefined,
		purchaseFeeBps: purchase.status === 'success' ? purchase.result : undefined,
		minimumPurchaseFee: minimum.status === 'success' ? minimum.result : undefined,
	}
}

async function loadCheckedQuestionLedger(client: ReadClient, questionLedger: Address, universeId: bigint, blockNumber: bigint) {
	const pool = { abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedger }
	const [manager, parent, questionId, multiplier] = await readRequiredMulticall(
		client,
		[
			{ ...pool, functionName: 'openOraclePriceCoordinator' },
			{ ...pool, functionName: 'parent' },
			{ ...pool, functionName: 'questionId' },
			{ ...pool, functionName: 'statoblastSecurityMultiplierBps' },
		],
		blockNumber,
	)
	const priorityFee = await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: getAddress(manager), functionName: 'initialReportPriorityFeeAttoEthPerGas', blockNumber })
	return await loadQuestionLedgerDetails(client, { questionLedger, openOraclePriceCoordinator: getAddress(manager), parent: getAddress(parent), universeId, questionId, statoblastSecurityMultiplierBps: multiplier, initialReportPriorityFeeAttoEthPerGas: priorityFee }, blockNumber)
}
