import { beforeEach, describe, test } from 'bun:test'
import { getMaxRepBeingSoldAttoRep, getMinBidSizeAttoEth } from '../testSupport/simulator/utils/contracts/auction'
import { getTotalPoolHeldAttoRep, redeemRepFromVault, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { addRepToMigrationBalance, getZoltarForkThreshold, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from './statoblast/fixture'

describe('Recursive truth-auction ownership regression', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const assert: StatoblastTruthAuctionFixture['assert'] = fixture.assert
	const strictEqualTypeSafe: StatoblastTruthAuctionFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe

	const {
		DAY,
		OperationType,
		PRICE_PRECISION,
		QuestionOutcome,
		SystemState,
		TEST_ADDRESSES,
		approveAndDepositRepToVault,
		approveToken,
		claimAuctionProceeds,
		createCompleteSet,
		createQuestion,
		createWriteClient,
		finalizeTruthAuction,
		formatStorageSlot,
		forkUniverse,
		genesisUniverse,
		getChildUniverseId,
		getERC20Balance,
		getInfraContractAddresses,
		getMappingStorageSlot,
		getMigrationRepBalanceAttoRep,
		getQuestionEndDate,
		getRepToken,
		getTotalRepBackingUnits,
		getQuestionId,
		getRepTokenAddress,
		getSecurityPoolAddresses,
		getSecurityVault,
		getSystemState,
		getTotalRepPurchasedAttoRep,
		getZoltarAddress,
		initiateSecurityPoolFork,
		manipulatePriceOracleAndPerformOperation,
		manipulatePriceOracle,
		migrateRepToZoltar,
		migrateVault,
		outcomes,
		participateAuction,
		backingUnitsToAttoRep,
		depositToEscalationGame,
		reportBond,
		repDeposit,
		startTruthAuction,
		statoblastSecurityMultiplierBps,
	} = fixture

	let client: StatoblastTruthAuctionFixture['client']
	let mockWindow: StatoblastTruthAuctionFixture['mockWindow']
	let questionData: StatoblastTruthAuctionFixture['questionData']
	let questionId: StatoblastTruthAuctionFixture['questionId']
	let securityPoolAddresses: StatoblastTruthAuctionFixture['securityPoolAddresses']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		questionData = fixture.questionData
		questionId = fixture.questionId
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	test('three recursive full-cap auctions preserve only backed claims', async () => {
		const poolRep = 1_100n * PRICE_PRECISION
		const attackerRep = 990n * PRICE_PRECISION
		const passiveRep = poolRep - attackerRep
		const maxAuctionVaultHaircutDivisor = 1_000_000n
		const attacker = client
		const passiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		const auctionWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await manipulatePriceOracleAndPerformOperation(attacker, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, attacker.account.address, repDeposit)
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'the fixture pool should be empty before constructing the recursive scenario')

		await approveAndDepositRepToVault(attacker, attackerRep, questionId)
		await approveAndDepositRepToVault(passiveVault, passiveRep, questionId)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, PRICE_PRECISION)

		const initialAttackerVault = await getSecurityVault(client, securityPoolAddresses.securityPool, attacker.account.address)
		const initialAttackerOwnership = attackerRep * PRICE_PRECISION
		strictEqualTypeSafe(initialAttackerVault.repBackingUnits, initialAttackerOwnership, 'the attacker should begin with exactly ninety percent of REP backing units')
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), poolRep * PRICE_PRECISION, 'the initial ownership denominator should use the standard one-to-one REP scale')

		let currentUniverse = genesisUniverse
		let currentPool = securityPoolAddresses
		let thirdWinningTick: bigint | undefined

		for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
			const parentDenominator = await getTotalRepBackingUnits(client, currentPool.securityPool)
			const parentAttackerVault = await getSecurityVault(client, currentPool.securityPool, attacker.account.address)
			assert.ok(parentAttackerVault.repBackingUnits > 0n, `round ${roundIndex + 1}: the parent attacker claim should remain represented before migration`)
			const expectedMigratedRep = roundIndex === 0 ? attackerRep : (parentAttackerVault.repBackingUnits * poolRep) / parentDenominator

			const forkQuestionData = {
				...questionData,
				title: `audit recursive ownership reset fork ${roundIndex + 1}`,
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkQuestionId = getQuestionId(forkQuestionData, outcomes)
			await createQuestion(attacker, forkQuestionData, outcomes)
			await mockWindow.setTime(forkQuestionData.endTime + 1n)

			const currentRepToken = getRepTokenAddress(currentUniverse)
			await approveToken(attacker, currentRepToken, getZoltarAddress())
			const forkThreshold = await getZoltarForkThreshold(client, currentUniverse)
			assert.ok((await getERC20Balance(client, currentRepToken, attacker.account.address)) >= forkThreshold, `round ${roundIndex + 1}: the attacker should hold enough real REP to fund the unrelated universe fork`)
			await forkUniverse(attacker, currentUniverse, forkQuestionId)

			const remainingWalletRep = await getERC20Balance(client, currentRepToken, attacker.account.address)
			if (remainingWalletRep > 0n) await addRepToMigrationBalance(attacker, currentUniverse, remainingWalletRep)
			const walletMigrationRep = await getMigrationRepBalanceAttoRep(client, currentUniverse, attacker.account.address)
			await splitMigrationRep(attacker, currentUniverse, walletMigrationRep, [QuestionOutcome.Yes])

			await initiateSecurityPoolFork(client, currentPool.securityPool)
			await migrateRepToZoltar(client, currentPool.securityPool, [QuestionOutcome.Yes])
			await migrateVault(attacker, currentPool.securityPool, QuestionOutcome.Yes)

			const childUniverse = getChildUniverseId(currentUniverse, QuestionOutcome.Yes)
			const childPool = getSecurityPoolAddresses(currentPool.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
			const childAttackerVault = await getSecurityVault(client, childPool.securityPool, attacker.account.address)

			const childMigratedRep = (await fixture.getSecurityPoolForkerForkData(client, childPool.securityPool)).migratedAttoRep
			strictEqualTypeSafe(childMigratedRep, expectedMigratedRep, `round ${roundIndex + 1}: migrated REP should follow the production flooring path`)
			strictEqualTypeSafe(childAttackerVault.repBackingUnits, childMigratedRep, `round ${roundIndex + 1}: migration should normalize ownership into child-local REP units`)
			const migratedRepHaircut = (childMigratedRep + maxAuctionVaultHaircutDivisor - 1n) / maxAuctionVaultHaircutDivisor
			if (roundIndex === 2) {
				assert.ok(childMigratedRep > 0n, 'the third child should retain a positive migrated REP claim')
				strictEqualTypeSafe(migratedRepHaircut, 1n, 'the positive third-round migrated REP should reserve one atomic REP unit')
			}

			strictEqualTypeSafe(await getTotalRepBackingUnits(client, childPool.securityPool), poolRep, `round ${roundIndex + 1}: the child should use a bounded REP-denominated ownership scale before auction finalization`)
			strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, childPool.securityPool), poolRep, `round ${roundIndex + 1}: the real child pool should hold the full 100 REP fork inventory`)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, childPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, childPool.securityPool), SystemState.ForkTruthAuction, `round ${roundIndex + 1}: the child should enter its real truth auction`)

			const auctionCap = await getMaxRepBeingSoldAttoRep(client, childPool.truthAuction)
			strictEqualTypeSafe(auctionCap, poolRep - migratedRepHaircut, `round ${roundIndex + 1}: the auction cap should subtract the rounded-up migrated-REP haircut`)
			const minimumBid = await getMinBidSizeAttoEth(client, childPool.truthAuction)
			const winningTick = await participateAuction(auctionWinner, childPool.truthAuction, 1n, minimumBid)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, childPool.securityPool)
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, childPool.truthAuction), auctionCap, `round ${roundIndex + 1}: one qualifying minimum bid should purchase the full cap`)

			const expectedFinalDenominator = migratedRepHaircut === 0n ? poolRep * PRICE_PRECISION + childMigratedRep : poolRep * ((poolRep - 1n) / migratedRepHaircut + 1n)
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, childPool.securityPool), expectedFinalDenominator, `round ${roundIndex + 1}: finalization should install a bounded child-local auction scale`)

			if (roundIndex === 2) thirdWinningTick = winningTick
			currentUniverse = childUniverse
			currentPool = childPool
		}

		if (thirdWinningTick === undefined) throw new Error('Third-round winning tick was not recorded')
		const dilutedAttackerVault = await getSecurityVault(client, currentPool.securityPool, attacker.account.address)
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, currentPool.securityPool), poolRep * poolRep, 'the third auction should preserve its one-attoREP incumbent residue through the positive-residual scale')
		const dilutedAttackerClaim = await backingUnitsToAttoRep(client, currentPool.securityPool, dilutedAttackerVault.repBackingUnits)
		strictEqualTypeSafe(dilutedAttackerClaim, 0n, 'the sub-haircut migrated claim should not resurrect after a full-cap auction')

		await claimAuctionProceeds(auctionWinner, currentPool.securityPool, auctionWinner.account.address, [{ tick: thirdWinningTick, bidIndex: 0n }])
		const winnerVault = await getSecurityVault(client, currentPool.securityPool, auctionWinner.account.address)
		const winnerClaim = await backingUnitsToAttoRep(client, currentPool.securityPool, winnerVault.repBackingUnits)
		strictEqualTypeSafe(winnerClaim, poolRep - 1n, 'the third auction winner should receive all REP except the one atomic unit reserved by integer ownership rounding')
		assert.ok(dilutedAttackerVault.repBackingUnits + winnerVault.repBackingUnits <= (await getTotalRepBackingUnits(client, currentPool.securityPool)), 'aggregate configured ownership must not exceed the denominator')
		assert.ok(dilutedAttackerClaim + winnerClaim <= (await getTotalPoolHeldAttoRep(client, currentPool.securityPool)), 'aggregate immediately redeemable claims must not exceed pool-held REP')

		const childRepToken = await getRepToken(client, currentPool.securityPool)
		const reporterBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[reporterBalanceSlot]: repDeposit,
				},
			},
		})
		await approveToken(client, childRepToken, getInfraContractAddresses().openOracle)
		const questionEndTime = await getQuestionEndDate(client, questionId)
		if ((await mockWindow.getTime()) <= questionEndTime) await mockWindow.setTime(questionEndTime + 1n)
		await manipulatePriceOracle(client, mockWindow, currentPool.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(auctionWinner, currentPool.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)
		await withdrawFromEscalationGame(auctionWinner, currentPool.securityPool, QuestionOutcome.Yes, [0n])

		await redeemRepFromVault(auctionWinner, currentPool.securityPool, auctionWinner.account.address)
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, currentPool.securityPool, dilutedAttackerVault.repBackingUnits), 0n, 'the sub-haircut migrated claim should remain zero after the auction winner redeems')
		await assert.rejects(redeemRepFromVault(attacker, currentPool.securityPool, attacker.account.address), /No redeemable REP/)
	})
})
