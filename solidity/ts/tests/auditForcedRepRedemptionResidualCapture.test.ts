import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastVaultAccountingFixture, type StatoblastVaultAccountingFixture } from './statoblast/fixture'

describe('Audit: forced REP redemption before escalation residual sweep', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const {
		assert,
		strictEqualTypeSafe,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		addressString,
		approveAndDepositRepToVault,
		getERC20Balance,
		getQuestionEndDate,
		getQuestionOutcome,
		QuestionOutcome,
		depositToEscalationGame,
		getSecurityPoolsEscalationGame,
		getTotalPoolHeldAttoRep,
		manipulatePriceOracle,
		redeemRepFromVault,
		withdrawFromEscalationGame,
		statoblast_EscalationGame_EscalationGame,
		repDeposit,
	} = fixture

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

	test('rejects forced redemption and preserves the honest vault share of later ordinary-game residual REP', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const escalationDepositor = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRepToVault(attacker, repDeposit, questionId)
		await approveAndDepositRepToVault(escalationDepositor, repDeposit, questionId)

		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const lowLosingPrincipal = 100n * 10n ** 18n
		const bindingLosingPrincipal = 200n * 10n ** 18n
		const winningPrincipal = 300n * 10n ** 18n
		await depositToEscalationGame(escalationDepositor, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, lowLosingPrincipal)
		await depositToEscalationGame(escalationDepositor, securityPoolAddresses.securityPool, QuestionOutcome.No, bindingLosingPrincipal)
		await depositToEscalationGame(escalationDepositor, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningPrincipal)
		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const escalationActivation = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'activationTime',
			args: [],
		})
		await mockWindow.setTime(escalationActivation + 49n * DAY + 1n)
		const directResolution = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getFinalQuestionResolution',
			args: [],
		})
		strictEqualTypeSafe(directResolution, BigInt(QuestionOutcome.Yes), 'the escalation game should expose the strict YES winner after its deadline')
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'the ordinary escalation game should resolve YES')

		const honestWalletBeforeAttempt = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await assert.rejects(redeemRepFromVault(attacker, securityPoolAddresses.securityPool, client.account.address), /Unauthorized/)
		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), honestWalletBeforeAttempt, 'a rejected forced redemption must not transfer the honest vault REP')

		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n])
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, [0n])
		await assert.rejects(redeemRepFromVault(attacker, securityPoolAddresses.securityPool, escalationDepositor.account.address), /Unauthorized/)

		const residualBeforeSweep = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), escalationGame)
		const poolRepBeforeSweep = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
		const sweepHash = await attacker.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'sweepResidualRepToSecurityPool',
			args: [],
		})
		await attacker.waitForTransactionReceipt({ hash: sweepHash })
		const poolRepAfterSweep = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(residualBeforeSweep, lowLosingPrincipal, 'the lower losing side should remain as material ordinary-game residual')
		strictEqualTypeSafe(poolRepAfterSweep - poolRepBeforeSweep, residualBeforeSweep, 'ordinary-game residual should become pool backing')

		await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
		const honestWalletAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const honestPayoutAfterSweep = honestWalletAfterRedeem - honestWalletBeforeAttempt
		assert.ok(honestPayoutAfterSweep > repDeposit + 30n * 10n ** 18n, 'the honest vault should retain its material pro-rata share of the later residual')
	})
})
