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

export async function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amountAttoRep: bigint, outcomeIndexes: bigint[], preparationAttoRep: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getZoltarAddress(),
		abi: Zoltar_Zoltar.abi,
		functionName: 'prepareAndSplitMigrationRep',
		args: [universeId, amountAttoRep, outcomeIndexes, preparationAttoRep],
	}))
	return { action: 'splitMigrationRep', amountAttoRep, hash, outcomeIndexes, universeId } satisfies ZoltarMigrationActionResult
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
