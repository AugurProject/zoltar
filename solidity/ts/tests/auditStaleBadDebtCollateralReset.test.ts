import { beforeEach, describe, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './statoblast/fixture'

describe('Audit PoC: stale bad debt survives a collateral reset', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const {
		GENESIS_REPUTATION_TOKEN,
		OperationType,
		PRICE_PRECISION,
		TEST_ADDRESSES,
		addressString,
		approveToken,
		assert,
		createCompleteSet,
		createWriteClient,
		depositRepToVault,
		getQuestionEndDate,
		getSecurityVault,
		getShareTokenSupplyAttoShares,
		getSettlementCollateralAttoEth,
		getTotalPoolHeldAttoRep,
		getVaultRepClaim,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		redeemCompleteSet,
		repDeposit,
		strictEqualTypeSafe,
	} = fixture

	let client: StatoblastForkMigrationFixture['client']
	let mockWindow: StatoblastForkMigrationFixture['mockWindow']
	let questionId: StatoblastForkMigrationFixture['questionId']
	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		questionId = fixture.questionId
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	test('clears bad debt before accepting a new collateral generation', async () => {
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const liquidationReceiver = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const victim = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd - 200_000n)
		await manipulatePriceOracle(client, mockWindow, coordinator, PRICE_PRECISION)

		await approveToken(liquidationReceiver, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRepToVault(liquidationReceiver, securityPool, repDeposit * 10n, 1_000_000_000n)

		const originalCollateralAttoEth = 30n * 10n ** 18n
		await createCompleteSet(client, securityPool, originalCollateralAttoEth, true)
		const underfundedPrice = 2_000n * PRICE_PRECISION
		await mockWindow.advanceTime(100_000n)
		await manipulatePriceOracleAndPerformOperation(liquidationReceiver, mockWindow, coordinator, OperationType.Liquidation, client.account.address, originalCollateralAttoEth, underfundedPrice)

		const badDebtAttoEth = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'totalBadDebtAttoEth',
		})
		const defaultedVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.ok(badDebtAttoEth > 0n, 'the underfunded liquidation should record real bad debt')
		const defaultedVaultResidualRepAttoRep = await getVaultRepClaim(client.account.address)
		assert.ok(defaultedVaultResidualRepAttoRep > 0n, 'the defaulted vault should retain residual REP that it can move out of pool inventory')
		assert.ok(defaultedVault.capacityOwnershipAttoRep > 0n, 'the defaulted vault should retain the capacity paired with its uncovered debt')
		const minimumVaultRepDepositAttoRep = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'minimumVaultRepDepositAttoRep',
		})
		assert.ok(defaultedVaultResidualRepAttoRep < minimumVaultRepDepositAttoRep, 'liquidation rounding should leave less than one valid vault deposit behind')

		await redeemCompleteSet(client, securityPool, await getShareTokenSupplyAttoShares(client, securityPool))
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPool), 0n, 'redeeming the original complete sets should empty settlement collateral')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'totalBadDebtAttoEth' }), 0n, 'bad debt should end with the collateral generation that created it')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'vaultBadDebtAttoEth', args: [client.account.address] }), 0n, 'the defaulted vault should expose no bad debt in the next collateral generation')

		const receiverRepClaim = await getVaultRepClaim(liquidationReceiver.account.address)
		await manipulatePriceOracleAndPerformOperation(liquidationReceiver, mockWindow, coordinator, OperationType.WithdrawRep, liquidationReceiver.account.address, receiverRepClaim, underfundedPrice)
		strictEqualTypeSafe(await getVaultRepClaim(liquidationReceiver.account.address), 0n, 'the funded vault should be able to exit once settlement collateral is zero')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPool), defaultedVaultResidualRepAttoRep, 'only sub-deposit REP dust should remain after the funded vault exits')

		const staleMintingCapacityAttoEth = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'getCurrentMintingCapacityAttoEth',
		})
		assert.ok(staleMintingCapacityAttoEth >= 1n * 10n ** 18n, 'the regression should retain enough nominal stale capacity to attempt a significant mint')
		await assert.rejects(createCompleteSet(victim, securityPool, 1n * 10n ** 18n, true), /Pool backing insufficient/)
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPool), 0n, 'the rejected fresh mint should not start a new undercollateralized generation')
	})
})
