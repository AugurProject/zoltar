import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './statoblast/fixture'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'

describe('Audit PoC: fixed-outcome child synthetic bad debt', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const {
		assert,
		strictEqualTypeSafe,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		addressString,
		approveToken,
		approveAndDepositRepToVault,
		createChildUniverse,
		createCompleteSet,
		depositRepToVault,
		forkUniverse,
		getChildUniverseId,
		getERC20Balance,
		getLastPrice,
		getQuestionEndDate,
		getQuestionOutcome,
		getRepTokenAddress,
		getSecurityPoolAddresses,
		getSecurityVault,
		getSystemState,
		getZoltarAddress,
		initiateSecurityPoolFork,
		manipulatePriceOracle,
		migrateRepToZoltar,
		migrateVault,
		OperationType,
		PRICE_PRECISION,
		QuestionOutcome,
		redeemRepFromVault,
		repDeposit,
		requestPriceIfNeededAndStageOperation,
		startTruthAuction,
		statoblastSecurityMultiplierBps,
		SystemState,
		genesisUniverse,
	} = fixture

	let mockWindow: StatoblastForkMigrationFixture['mockWindow']
	let client: StatoblastForkMigrationFixture['client']
	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']
	let questionId: StatoblastForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	test('recycles redeemed REP to erase real capacity and seize an honest migrated vault', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const badDebtRecorder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRepToVault(attacker, repDeposit, questionId)

		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION)
		await createCompleteSet(client, securityPoolAddresses.securityPool, repDeposit - repDeposit / 10n)

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, questionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		const childRep = getRepTokenAddress(childUniverse)
		await mockWindow.advanceTime(8n * 7n * DAY + 1n)
		await startTruthAuction(attacker, child.securityPool)

		strictEqualTypeSafe(await getSystemState(client, child.securityPool), SystemState.Operational, 'all pool-held REP migrated, so the fixed-outcome child should finalize without an auction')
		strictEqualTypeSafe(await getQuestionOutcome(client, child.securityPool), QuestionOutcome.Yes, 'the matching fork should make the child question final')

		const victimVaultBefore = await getSecurityVault(client, child.securityPool, client.account.address)
		const victimRepBefore = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: child.securityPool,
			functionName: 'backingUnitsToAttoRep',
			args: [victimVaultBefore.repBackingUnits],
		})
		const victimOpenInterestBefore = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: child.securityPool,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [client.account.address],
		})
		assert.ok(victimRepBefore * PRICE_PRECISION * 10_000n >= victimOpenInterestBefore * PRICE_PRECISION * statoblastSecurityMultiplierBps, 'the honest migrated vault should be healthy at the inherited price before the attack')
		const victimRepImmediatelyBeforeAttempt = victimRepBefore
		const attackerWalletBefore = await getERC20Balance(client, childRep, attacker.account.address)
		await redeemRepFromVault(attacker, child.securityPool, attacker.account.address)
		const recycledRep = (await getERC20Balance(client, childRep, attacker.account.address)) - attackerWalletBefore
		assert.ok(recycledRep > 0n, 'the attacker should redeem migrated REP while retaining capacity ownership')

		const ghostVault = await getSecurityVault(client, child.securityPool, attacker.account.address)
		strictEqualTypeSafe(ghostVault.repBackingUnits, 0n, 'redemption should empty the attacker REP claim')
		assert.ok(ghostVault.capacityOwnershipAttoRep > 0n, 'redemption currently leaves unbacked capacity behind')

		strictEqualTypeSafe(
			await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: child.securityPool,
				functionName: 'isEscalationResolved',
				args: [],
			}),
			true,
			'the inherited fixed outcome must close collateralized operations even though the child stays operational for redemptions',
		)
		strictEqualTypeSafe(await getLastPrice(client, child.priceOracleManagerAndOperatorQueuer), PRICE_PRECISION, 'the fixed-outcome child should inherit the original REP price')
		const ghostOpenInterest = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: child.securityPool,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [attacker.account.address],
		})
		await assert.rejects(requestPriceIfNeededAndStageOperation(badDebtRecorder, child.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, attacker.account.address, ghostOpenInterest), /question already resolved/)
		await approveToken(attacker, childRep, child.securityPool)
		await assert.rejects(depositRepToVault(attacker, child.securityPool, recycledRep, 1_000_000n))

		strictEqualTypeSafe(
			await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: child.securityPool,
				functionName: 'totalBadDebtAttoEth',
				args: [],
			}),
			0n,
			'the rejected ghost liquidation must not create synthetic bad debt',
		)

		const victimVaultAfter = await getSecurityVault(client, child.securityPool, client.account.address)
		const victimRepAfter = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: child.securityPool,
			functionName: 'backingUnitsToAttoRep',
			args: [victimVaultAfter.repBackingUnits],
		})
		strictEqualTypeSafe(victimRepAfter, victimRepImmediatelyBeforeAttempt, 'the honest migrated vault must retain all REP after the blocked attack')
		strictEqualTypeSafe(await getERC20Balance(client, childRep, attacker.account.address), attackerWalletBefore + recycledRep, 'the attacker must recover only its own redeemed REP')
	})
})
