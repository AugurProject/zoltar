import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { SystemState } from '../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import type { WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN } from '../testSupport/simulator/utils/constants'
import { getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { backingUnitsToAttoRep, depositToEscalationGame, getSecurityPoolsEscalationGame, getSecurityVault, getSystemState, getTotalPoolHeldAttoRep, getTotalRepBackingUnits, redeemRepFromVault, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { createChildUniverse, initiateSecurityPoolFork, startTruthAuction } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { getQuestionEndDate } from '../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getRepTokenAddress, getZoltarAddress, getZoltarForkThreshold } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { approveToken, getChildUniverseId, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import type { StatoblastEscalationMigrationFixture } from './statoblast/fixture'

const ATTO_REP = 10n ** 18n
const lowLosingPrincipal = 100n * ATTO_REP
const bindingLosingPrincipal = 200n * ATTO_REP
const winningPrincipal = 300n * ATTO_REP

// Ordinary-game stakes whose strict YES resolution leaves the low losing Invalid side as residual REP.
export const ordinaryEscalationPrincipals = {
	lowLosingPrincipal,
	bindingLosingPrincipal,
	winningPrincipal,
	totalPrincipal: lowLosingPrincipal + bindingLosingPrincipal + winningPrincipal,
}

export async function depositOrdinaryEscalationPrincipals(depositor: WriteClient, securityPool: Address) {
	await depositToEscalationGame(depositor, securityPool, QuestionOutcome.Invalid, lowLosingPrincipal)
	await depositToEscalationGame(depositor, securityPool, QuestionOutcome.No, bindingLosingPrincipal)
	await depositToEscalationGame(depositor, securityPool, QuestionOutcome.Yes, winningPrincipal)
}

export async function advancePastOrdinaryEscalationDeadline(client: WriteClient, mockWindow: AnvilWindowEthereum, securityPool: Address) {
	const escalationGame = await getSecurityPoolsEscalationGame(client, securityPool)
	const activationTime = await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGame,
		functionName: 'activationTime',
		args: [],
	})
	await mockWindow.setTime(activationTime + 49n * DAY + 1n)
	return escalationGame
}

export async function withdrawFirstDepositOfEachOutcome(withdrawer: WriteClient, securityPool: Address) {
	await withdrawFromEscalationGame(withdrawer, securityPool, QuestionOutcome.Yes, [0n])
	await withdrawFromEscalationGame(withdrawer, securityPool, QuestionOutcome.No, [0n])
	await withdrawFromEscalationGame(withdrawer, securityPool, QuestionOutcome.Invalid, [0n])
}

export async function sweepResidualRep(sweeper: WriteClient, escalationGame: Address) {
	const hash = await sweeper.writeContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGame,
		functionName: 'sweepResidualRepToSecurityPool',
		args: [],
	})
	return await sweeper.waitForTransactionReceipt({ hash })
}

export async function redeemOwnVaultPayout(client: WriteClient, securityPool: Address, repToken: Address) {
	const walletBeforeRedeem = await getERC20Balance(client, repToken, client.account.address)
	await redeemRepFromVault(client, securityPool, client.account.address)
	return (await getERC20Balance(client, repToken, client.account.address)) - walletBeforeRedeem
}

export async function forkGenesisUniverseExternally(fixture: StatoblastEscalationMigrationFixture, forkInitiator: WriteClient, title: string) {
	const { mockWindow, questionData, outcomes, genesisUniverse } = fixture
	const externalForkQuestion = {
		...questionData,
		title,
		endTime: (await mockWindow.getTime()) + DAY,
	}
	const externalForkQuestionId = getQuestionId(externalForkQuestion, outcomes)
	await createQuestion(forkInitiator, externalForkQuestion, outcomes)
	await mockWindow.setTime(externalForkQuestion.endTime + 1n)
	await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
	await forkUniverse(forkInitiator, genesisUniverse, externalForkQuestionId)
}

// Escrows the whole parent vault in an ordinary game whose three sides each stay just below the non-decision threshold.
export async function escrowParentVaultBelowNonDecisionThreshold(fixture: StatoblastEscalationMigrationFixture) {
	const { client, mockWindow, securityPoolAddresses, questionId, genesisUniverse } = fixture
	const forkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
	const nonDecisionThreshold = forkThreshold / 2n + (forkThreshold % 2n)
	const invalidPrincipal = nonDecisionThreshold - 3n
	const noPrincipal = nonDecisionThreshold - 2n
	const yesPrincipal = nonDecisionThreshold - 1n
	const totalPrincipal = invalidPrincipal + noPrincipal + yesPrincipal

	const parentVaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
	const parentRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, parentVaultBeforeTopUp.repBackingUnits)
	assert.ok(parentRepBeforeTopUp < totalPrincipal, 'fixture vault must fit below the audit target')
	await approveAndDepositRepToVault(client, totalPrincipal - parentRepBeforeTopUp, questionId)
	const questionEnd = await getQuestionEndDate(client, questionId)
	await mockWindow.setTime(questionEnd + 10_000n)
	await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)

	await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, invalidPrincipal)
	await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, noPrincipal)
	await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, yesPrincipal)
	strictEqualTypeSafe(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), 0n, 'all parent REP backing units must be escrowed')
	strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'all parent pool-held REP must be held by the escalation game')
	return { nonDecisionThreshold, noPrincipal, yesPrincipal, totalPrincipal }
}

export async function createYesContinuationChild(fixture: StatoblastEscalationMigrationFixture) {
	const { client, securityPoolAddresses, questionId, genesisUniverse, statoblastSecurityMultiplierBps } = fixture
	await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
	await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

	const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
	const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
	const childRepToken = getRepTokenAddress(childUniverse)
	const childGame = await getSecurityPoolsEscalationGame(client, childPool.securityPool)
	const seedRep = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		address: childPool.securityPool,
		functionName: 'minimumVaultRepDepositAttoRep',
		args: [],
	})
	return { childPool, childRepToken, childGame, seedRep }
}

export async function activateContinuationWithoutAuction(fixture: StatoblastEscalationMigrationFixture, childSecurityPool: Address) {
	const { client, mockWindow } = fixture
	await mockWindow.advanceTime(8n * 7n * DAY + DAY)
	await startTruthAuction(client, childSecurityPool)
	strictEqualTypeSafe(await getSystemState(client, childSecurityPool), SystemState.Operational, 'zero pool-held REP must skip the auction and activate the continuation')
}
