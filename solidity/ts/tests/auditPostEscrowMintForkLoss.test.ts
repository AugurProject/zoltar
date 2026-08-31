import { beforeEach, describe, test } from 'bun:test'
import { getSettlementCollateralAttoEth, getTotalPoolHeldAttoRep } from '../testSupport/simulator/utils/contracts/securityPool'
import { getSecurityPoolForkerForkData } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './statoblast/fixture'

describe('Audit regression: post-escrow complete-set mint fork loss', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const assert: StatoblastForkMigrationFixture['assert'] = fixture.assert
	const strictEqualTypeSafe: StatoblastForkMigrationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe

	const {
		DAY,
		PRICE_PRECISION,
		QuestionOutcome,
		SystemState,
		TEST_ADDRESSES,
		createCompleteSet,
		createWriteClient,
		depositToEscalationGame,
		formatStorageSlot,
		genesisUniverse,
		getChildUniverseId,
		getEthRaiseCapAttoEth,
		getMappingStorageSlot,
		getSecurityPoolAddresses,
		getSystemState,
		manipulatePriceOracle,
		migrateVault,
		repDeposit,
		startTruthAuction,
		statoblastSecurityMultiplierBps,
		triggerExternalForkForSecurityPool,
	} = fixture

	let client: StatoblastForkMigrationFixture['client']
	let mockWindow: StatoblastForkMigrationFixture['mockWindow']
	let questionData: StatoblastForkMigrationFixture['questionData']
	let questionId: StatoblastForkMigrationFixture['questionId']
	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		questionData = fixture.questionData
		questionId = fixture.questionId
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	test('cannot mint collateral after all pool-held REP was escrowed', async () => {
		const victim = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const victimDepositAttoEth = 1n * 10n ** 18n

		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, 10n * PRICE_PRECISION)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit)

		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'the attacker should escrow every attoREP held by the pool')
		await assert.rejects(createCompleteSet(victim, securityPoolAddresses.securityPool, victimDepositAttoEth))
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'rejected unbacked minting must not add settlement collateral')
	})

	test('does not skip collateral repair when bad debt permits all pool-held REP to be escrowed', async () => {
		const settlementCollateralAttoEth = 1n * 10n ** 18n
		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, 10n * PRICE_PRECISION)
		await createCompleteSet(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)

		// Reconstruct the full-bad-debt accounting boundary so this regression isolates
		// fork finalization from the independent liquidation setup.
		await mockWindow.addStateOverrides({
			[securityPoolAddresses.securityPool]: {
				stateDiff: {
					[formatStorageSlot(21n)]: settlementCollateralAttoEth,
					[formatStorageSlot(getMappingStorageSlot(client.account.address, 22n))]: settlementCollateralAttoEth,
				},
			},
		})
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit)
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'bad-debt-adjusted zero OI should permit all REP to enter unresolved escrow')

		await triggerExternalForkForSecurityPool(undefined, 'zero-pool-rep collateral repair source')
		const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(parentForkData.auctionableAttoRepAtFork, 0n, 'the fork should snapshot no pool-held REP')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'missing collateral must start repair even when the pool-held REP denominator is zero')
		assert.ok((await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)) > 0n, 'the repair auction should raise the missing parent collateral from escrowed REP')
	})
})
