import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { getQuestionOutcome } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { getQuestionEndDate } from '../testSupport/simulator/utils/contracts/statoblast'
import { depositRepToVault, getSecurityVault, getTotalPoolHeldAttoRep } from '../testSupport/simulator/utils/contracts/securityPool'
import { approveAndDepositRepToVault, manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { TEST_ADDRESSES, GENESIS_REPUTATION_TOKEN } from '../testSupport/simulator/utils/constants'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import assert from '../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastVaultAccountingFixture, type StatoblastVaultAccountingFixture } from './statoblast/fixture'
import { advancePastOrdinaryEscalationDeadline, depositOrdinaryEscalationPrincipals, ordinaryEscalationPrincipals, redeemOwnVaultPayout, sweepResidualRep, withdrawFirstDepositOfEachOutcome } from './residualCaptureHelpers'

describe('Audit: pre-escalation residual capture', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const { repDeposit } = fixture

	let mockWindow: StatoblastVaultAccountingFixture['mockWindow']
	let client: StatoblastVaultAccountingFixture['client']
	let securityPoolAddresses: StatoblastVaultAccountingFixture['securityPoolAddresses']
	let questionId: StatoblastVaultAccountingFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	test('rejects vault admission as soon as the question ends', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)

		await assert.rejects(approveAndDepositRepToVault(attacker, repDeposit, questionId, (1n << 256n) - 1n))
	})

	test('keeps vault admission open before the question end timestamp and closes it exactly at the boundary', async () => {
		const depositor = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const questionEnd = await getQuestionEndDate(client, questionId)
		await approveToken(depositor, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

		// The harness mines the next transaction one second after the latest timestamp.
		await mockWindow.setTime(questionEnd - 2n)
		await depositRepToVault(depositor, securityPoolAddresses.securityPool, repDeposit)
		await mockWindow.setTime(questionEnd - 1n)
		await assert.rejects(depositRepToVault(depositor, securityPoolAddresses.securityPool, repDeposit))
	})

	test('prevents an exact-end deposit before the first dispute from capturing an honest vault residual', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const escalationDepositor = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		const { lowLosingPrincipal, totalPrincipal } = ordinaryEscalationPrincipals
		await approveAndDepositRepToVault(escalationDepositor, totalPrincipal, questionId)

		const questionEnd = await getQuestionEndDate(client, questionId)
		await approveToken(attacker, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await mockWindow.setTime(questionEnd - 600n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		// The next transaction is mined exactly at the question end timestamp.
		await mockWindow.setTime(questionEnd - 1n)

		const attackerDeposit = 10n * repDeposit
		const attackerWalletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		// The attacker orders this transaction at the first ended-question boundary and
		// immediately before the first dispute deposit. Admission must already be closed
		// even though the escalation game does not exist yet.
		await assert.rejects(depositRepToVault(attacker, securityPoolAddresses.securityPool, attackerDeposit, (1n << 256n) - 1n))
		const attackerVaultBeforeDispute = await getSecurityVault(client, securityPoolAddresses.securityPool, attacker.account.address)
		strictEqualTypeSafe(attackerVaultBeforeDispute.repBackingUnits, 0n, 'the rejected attacker should receive no residual-eligible backing units')
		strictEqualTypeSafe(attackerVaultBeforeDispute.underwritingLimitAttoEth, 0n, 'the rejected attacker should assume no open-interest allocation')
		await depositOrdinaryEscalationPrincipals(escalationDepositor, securityPoolAddresses.securityPool)

		const escalationGame = await advancePastOrdinaryEscalationDeadline(client, mockWindow, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'the dispute should resolve YES normally')

		await withdrawFirstDepositOfEachOutcome(attacker, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), escalationGame), lowLosingPrincipal, 'the low losing side should remain as terminal residual')

		const poolRepBeforeSweep = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
		await sweepResidualRep(attacker, escalationGame)
		strictEqualTypeSafe((await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)) - poolRepBeforeSweep, lowLosingPrincipal, 'the entire residual should enter the passive backing pool')

		const honestPayout = await redeemOwnVaultPayout(client, securityPoolAddresses.securityPool, addressString(GENESIS_REPUTATION_TOKEN))
		const attackerNetProfit = (await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)) - attackerWalletBefore
		const honestResidual = honestPayout - repDeposit
		const honestResidualShortfall = lowLosingPrincipal - honestResidual

		strictEqualTypeSafe(attackerNetProfit, 0n, 'the rejected attacker should receive no residual profit')
		strictEqualTypeSafe(honestResidual, lowLosingPrincipal, 'the pre-existing honest vault should receive the entire residual')
		strictEqualTypeSafe(honestResidualShortfall, 0n, 'the rejected attacker should not dilute the honest vault payout')
	})
})
