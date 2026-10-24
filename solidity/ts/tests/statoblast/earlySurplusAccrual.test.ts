import { describe, expect, test } from 'bun:test'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getQuestionEndDate } from '../../testSupport/simulator/utils/contracts/statoblast'
import { withdrawFromEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { advancePastOrdinaryEscalationDeadline } from '../residualCaptureHelpers'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact } from '../../types/contractArtifact'

describe('Statoblast: irrevocable ordinary surplus accrual', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const token = addressString(GENESIS_REPUTATION_TOKEN)

	test('credits backing while reports arrive and preserves the complete winner payout', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses, repDeposit } = fixture
		const pool = securityPoolAddresses.securityPool
		const game = securityPoolAddresses.escalationGame
		const reporter = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const unit = 10n ** 18n
		await approveToken(reporter, token, pool)
		await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 1n)
		const report = async (outcome: QuestionOutcome, amount: bigint) => {
			await writeContractAndWait(reporter, () => reporter.writeContract({ address: pool, abi: poolArtifact.abi, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		}
		await report(QuestionOutcome.Invalid, 100n * unit)
		await report(QuestionOutcome.No, 200n * unit)
		expect(await getERC20Balance(client, token, pool)).toBe(repDeposit)
		await report(QuestionOutcome.Yes, 300n * unit)
		expect(await getERC20Balance(client, token, pool)).toBe(repDeposit + 100n * unit)
		expect(await getERC20Balance(client, token, game)).toBe(500n * unit)
		await advancePastOrdinaryEscalationDeadline(client, mockWindow, pool)
		await writeContractAndWait(client, () => client.writeContract({ address: game, abi: gameArtifact.abi, functionName: 'settleOrdinaryGame' }))
		expect(await getERC20Balance(client, token, pool)).toBe(repDeposit + 100n * unit)
		const before = await getERC20Balance(client, token, reporter.account.address)
		await withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [0n])
		expect((await getERC20Balance(client, token, reporter.account.address)) - before).toBe(420n * unit)
		expect(await getERC20Balance(client, token, game)).toBe(0n)
	})
})
