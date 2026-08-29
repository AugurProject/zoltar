import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastVaultAccountingFixture, type StatoblastVaultAccountingFixture } from './statoblast/fixture'

describe('Audit: pre-escalation residual capture', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const {
		assert,
		strictEqualTypeSafe,
		createWriteClient,
		DAY,
		TEST_ADDRESSES,
		GENESIS_REPUTATION_TOKEN,
		addressString,
		approveToken,
		approveAndDepositRepToVault,
		depositRepToVault,
		depositToEscalationGame,
		getERC20Balance,
		getQuestionEndDate,
		getQuestionOutcome,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getTotalPoolHeldAttoRep,
		manipulatePriceOracle,
		redeemRepFromVault,
		withdrawFromEscalationGame,
		QuestionOutcome,
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

	test('rejects vault admission as soon as the question ends', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)

		await assert.rejects(approveAndDepositRepToVault(attacker, repDeposit, questionId, (1n << 256n) - 1n))
	})

	test('keeps vault admission open through the question end timestamp', async () => {
		const depositor = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const questionEnd = await getQuestionEndDate(client, questionId)
		await approveToken(depositor, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

		// The harness mines the next transaction one second after the latest timestamp.
		await mockWindow.setTime(questionEnd - 1n)
		await depositRepToVault(depositor, securityPoolAddresses.securityPool, repDeposit)
		await mockWindow.setTime(questionEnd)
		await assert.rejects(depositRepToVault(depositor, securityPoolAddresses.securityPool, repDeposit))
	})

	test('prevents a same-block deposit before the first dispute from capturing an honest vault residual', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const escalationDepositor = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const attoRep = 10n ** 18n
		const lowLosingPrincipal = 100n * attoRep
		const bindingLosingPrincipal = 200n * attoRep
		const winningPrincipal = 300n * attoRep
		const totalEscalationPrincipal = lowLosingPrincipal + bindingLosingPrincipal + winningPrincipal
		await approveAndDepositRepToVault(escalationDepositor, totalEscalationPrincipal, questionId)

		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const attackerDeposit = 10n * repDeposit
		const attackerWalletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		// The attacker orders this transaction immediately before the first dispute deposit.
		// Admission must already be closed even though the escalation game does not exist yet.
		await assert.rejects(approveAndDepositRepToVault(attacker, attackerDeposit, questionId, (1n << 256n) - 1n))
		const attackerVaultBeforeDispute = await getSecurityVault(client, securityPoolAddresses.securityPool, attacker.account.address)
		strictEqualTypeSafe(attackerVaultBeforeDispute.repBackingUnits, 0n, 'the rejected attacker should receive no residual-eligible backing units')
		strictEqualTypeSafe(attackerVaultBeforeDispute.capacityOwnershipAttoRep, 0n, 'the rejected attacker should assume no open-interest allocation')
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
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'the dispute should resolve YES normally')

		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n])
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, [0n])
		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), escalationGame), lowLosingPrincipal, 'the low losing side should remain as terminal residual')

		const poolRepBeforeSweep = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
		const sweepHash = await attacker.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'sweepResidualRepToSecurityPool',
			args: [],
		})
		await attacker.waitForTransactionReceipt({ hash: sweepHash })
		strictEqualTypeSafe((await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)) - poolRepBeforeSweep, lowLosingPrincipal, 'the entire residual should enter the passive backing pool')

		const honestWalletBeforeRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
		const attackerNetProfit = (await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)) - attackerWalletBefore
		const honestPayout = (await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)) - honestWalletBeforeRedeem
		const honestResidual = honestPayout - repDeposit
		const honestResidualShortfall = lowLosingPrincipal - honestResidual

		strictEqualTypeSafe(attackerNetProfit, 0n, 'the rejected attacker should receive no residual profit')
		strictEqualTypeSafe(honestResidual, lowLosingPrincipal, 'the pre-existing honest vault should receive the entire residual')
		strictEqualTypeSafe(honestResidualShortfall, 0n, 'the rejected attacker should not dilute the honest vault payout')
	})
})
