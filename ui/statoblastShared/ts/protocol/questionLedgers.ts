import * as copy from '../copy/questionPage.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import { isReadCheckpointRecent } from './readCheckpoint.js'
import { checkStatoblastEntries } from './statoblastEntries.js'
import { loadQuestionLedgerDetails } from './questionLedgerSnapshot.js'

const questionEntryMessages = {
	'invalid-pool': copy.poolContractMissing,
	'non-statoblast-contract': copy.foreignPoolContract,
	'unregistered-question': copy.questionNotRegistered,
	'unprepared-question': copy.questionUnprepared,
}

export class StatoblastQuestionEntryError extends Error {
	constructor(readonly status: keyof typeof questionEntryMessages) {
		super(questionEntryMessages[status])
	}
}

type DeploymentRegistryAnchor = Readonly<{ blockHash: `0x${string}`; blockNumber: bigint; timestamp: bigint; observedAt: number }>

export type QuestionReadCheckpoint = {
	anchor?: DeploymentRegistryAnchor
	ledger?: Address
	question?: Awaited<ReturnType<typeof loadQuestionLedgerDetails>>
	sharesFacts?: Awaited<ReturnType<typeof readSharesFacts>>
}

async function loadDeploymentRegistryAnchor(client: ReadClient): Promise<DeploymentRegistryAnchor> {
	const observedAt = Date.now()
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error(copy.questionBlockUnverified)
	return { blockHash: block.hash, blockNumber: block.number, timestamp: block.timestamp, observedAt }
}

async function isDeploymentRegistryAnchorCurrent(client: ReadClient, anchor: DeploymentRegistryAnchor) {
	const block = await client.getBlock({ blockNumber: anchor.blockNumber })
	return block.hash?.toLowerCase() === anchor.blockHash.toLowerCase()
}

export async function loadStatoblastQuestion(client: ReadClient, pool: Address, questionId: bigint, universeId: bigint, useSessionCache = true, includeSharesFacts = false, checkpoint: QuestionReadCheckpoint = {}) {
	const resetCheckpoint = () => {
		delete checkpoint.anchor
		delete checkpoint.ledger
		delete checkpoint.question
		delete checkpoint.sharesFacts
	}
	const checkAnchor = async (anchor: DeploymentRegistryAnchor) => {
		if (await isDeploymentRegistryAnchorCurrent(client, anchor)) return
		resetCheckpoint()
		throw new Error(copy.questionChangedDuringRefresh)
	}
	const savedAnchor = checkpoint.anchor
	if (savedAnchor !== undefined && !isReadCheckpointRecent(savedAnchor.observedAt)) resetCheckpoint()
	const read = async (resuming: boolean) => {
		if (resuming && savedAnchor !== undefined) await checkAnchor(savedAnchor)
		const anchor = (checkpoint.anchor ??= await loadDeploymentRegistryAnchor(client))
		if (checkpoint.ledger === undefined) {
			const [checked] = await checkStatoblastEntries(client, [{ pool, questionId, universeId }], anchor.blockNumber, useSessionCache)
			if (checked?.status === 'failed') throw checked.error
			if (checked?.status !== 'question') {
				delete checkpoint.anchor
				const status = checked?.status === 'pool' || checked === undefined ? 'invalid-pool' : checked.status
				throw new StatoblastQuestionEntryError(status)
			}
			checkpoint.ledger = checked.ledger
		}
		const ledger = checkpoint.ledger
		const [question, sharesFacts] = await Promise.all([
			checkpoint.question ??
				loadQuestionLedgerDetails(client, ledger, questionId, universeId, anchor.blockNumber).then(result => {
					if (checkpoint.anchor === anchor) checkpoint.question = result
					return result
				}),
			includeSharesFacts
				? (checkpoint.sharesFacts ??
					readSharesFacts(client, pool, universeId, anchor.blockNumber)
						.then(result => {
							if (checkpoint.anchor === anchor) checkpoint.sharesFacts = result
							return result
						})
						.catch(error => {
							if (resuming) throw error
							return undefined
						}))
				: undefined,
		])
		await checkAnchor(anchor)
		return { question, sharesFacts, block: { number: anchor.blockNumber, timestamp: anchor.timestamp }, observedAt: anchor.observedAt }
	}
	if (checkpoint.anchor === undefined) return await read(false)
	try {
		return await read(true)
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error
		resetCheckpoint()
		return await read(false)
	}
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
