import { beforeEach, describe, test } from 'bun:test'
import { statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization } from '../../types/contractArtifact'
import { useStatoblastVaultAccountingFixture, type StatoblastVaultAccountingFixture } from './fixture'

describe('Statoblast REP authorization entry points', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const { QuestionOutcome, depositToEscalationGame, getAnvilWindowEthereum, getQuestionEndDate, manipulatePriceOracle, reportBond } = fixture

	let mockWindow: StatoblastVaultAccountingFixture['mockWindow']
	let client: StatoblastVaultAccountingFixture['client']
	let securityPoolAddresses: StatoblastVaultAccountingFixture['securityPoolAddresses']
	let questionId: bigint

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	const initializeEscalationGame = async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10_000n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		return securityPoolAddresses.escalationGame
	}

	test('genesis REP escalation deposits reject ERC-2612 permit routing', async () => {
		const escalationGame = await initializeEscalationGame()
		await fixture.assert.rejects(
			client.writeContract({
				abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi,
				address: escalationGame,
				functionName: 'depositRepOnOutcomeWithPermit',
				args: [QuestionOutcome.Yes, reportBond, 9_000_000_000n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
			}),
			/Genesis REP does not support permit/,
		)
	})

	test('genesis REP escalation deposits reject ERC-3009 authorization routing', async () => {
		const escalationGame = await initializeEscalationGame()
		await fixture.assert.rejects(
			client.writeContract({
				abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi,
				address: escalationGame,
				functionName: 'depositRepOnOutcomeWithAuthorization',
				args: [client.account.address, QuestionOutcome.No, reportBond * 4n, 0n, 9_000_000_000n, `0x${'00'.repeat(32)}`, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
			}),
			/Genesis REP does not support authorization/,
		)
	})
})
