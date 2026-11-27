import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { WriteClient, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import * as zoltarCopy from '../copy/zoltar.js'
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
	const call = {
		address: getZoltarAddress(),
		abi: Zoltar_Zoltar.abi,
		functionName: 'prepareAndSplitMigrationRep',
		reviewTitle: zoltarCopy.migrateRep,
		args: [universeId, amountAttoRep, outcomeIndexes, preparationAttoRep],
	} as const
	let reviewRows: readonly { label: string; value: string }[] = []
	client.onTransactionPlan?.([
		{
			...call,
			contractAddress: call.address,
			readReviewRows: () => reviewRows,
			validateBeforeSubmit: async () => {
				const { number: blockNumber } = await client.getBlock()
				if (blockNumber === undefined) throw new Error(currentStateCheckFailed)
				const wallet = client.account.address
				const protocol = { address: call.address, abi: call.abi, blockNumber }
				const children = await Promise.all(outcomeIndexes.map(outcomeIndex => client.readContract({ ...protocol, functionName: 'getChildUniverseId', args: [universeId, outcomeIndex] })))
				const migrated = await client.readContract({ ...protocol, functionName: 'getChildMigrationRepAmountsAttoRep', args: [wallet, universeId, children] })
				if (migrated.length !== children.length) throw new Error(currentStateCheckFailed)
				const change = (label: string, before: bigint, after: bigint) => ({ label, value: `${formatCurrencyBalanceWithUnit(before, 'REP')} → ${formatCurrencyBalanceWithUnit(after, 'REP')}` })
				const burns = preparationAttoRep > 0n
				const [walletRep, migrationBalance] = burns
					? await Promise.all([
							client.readContract({ ...protocol, functionName: 'getRepToken', args: [universeId] }).then(address => client.readContract({ address, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [wallet], blockNumber })),
							client.readContract({ ...protocol, functionName: 'getMigrationRepBalanceAttoRep', args: [wallet, universeId] }),
						])
					: [0n, 0n]
				reviewRows = [
					...(burns ? [change(zoltarCopy.walletRep, walletRep, walletRep - preparationAttoRep), change(zoltarCopy.migrationBalance, migrationBalance, migrationBalance + preparationAttoRep)] : []),
					...children.map((child, index) => {
						const before = migrated[index]
						if (before === undefined) throw new Error(currentStateCheckFailed)
						return change(zoltarCopy.migratedToUniverse(child), before, before + amountAttoRep)
					}),
				]
			},
		},
	])
	const hash = await writeContractAndWait(client, () => call)
	return { action: 'splitMigrationRep', amountAttoRep, hash, outcomeIndexes, universeId } satisfies ZoltarMigrationActionResult
}

export async function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getZoltarAddress(),
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return { action: 'forkZoltar', hash, questionId: formatQuestionIdHex(questionId), universeId } satisfies ZoltarForkActionResult
}
