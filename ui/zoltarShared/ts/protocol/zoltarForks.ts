import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { WriteClient, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { getQuestionIdHex } from './helpers.js'
import { getZoltarAddress } from './zoltarDeploymentHelpers.js'
import { writeContractAndWait } from './core.js'

export async function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getZoltarAddress(),
		abi: Zoltar_Zoltar.abi,
		functionName: 'deployChild',
		args: [universeId, outcomeIndex],
	}))
	return { action: 'createChildUniverse', hash, outcomeIndex, universeId } satisfies ZoltarChildUniverseActionResult
}

export async function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amountAttoRep: bigint, outcomeIndexes: bigint[], maxPreparationAttoRep: bigint) {
	const sortedOutcomeIndexes = outcomeIndexes.toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))
	const hash = await writeContractAndWait(client, () => ({
		address: getZoltarAddress(),
		abi: Zoltar_Zoltar.abi,
		functionName: 'prepareAndSplitMigrationRep',
		args: [universeId, amountAttoRep, sortedOutcomeIndexes, maxPreparationAttoRep],
	}))
	return { action: 'splitMigrationRep', amountAttoRep, hash, outcomeIndexes: sortedOutcomeIndexes, universeId } satisfies ZoltarMigrationActionResult
}

export async function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getZoltarAddress(),
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return { action: 'forkZoltar', hash, questionId: getQuestionIdHex(questionId), universeId } satisfies ZoltarForkActionResult
}
