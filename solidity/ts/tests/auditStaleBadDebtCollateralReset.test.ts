import { setUnderwritingLimit } from '../testSupport/simulator/utils/contracts/securityPool'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { createCompleteSet, depositRepToVault, getSecurityVault, getShareTokenSupplyAttoShares, getSettlementCollateralAttoEth, getTotalPoolHeldAttoRep, redeemCompleteSet } from '../testSupport/simulator/utils/contracts/securityPool'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { OperationType, getQuestionEndDate } from '../testSupport/simulator/utils/contracts/statoblast'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import assert from '../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './statoblast/fixture'

describe('Audit PoC: stale bad debt survives a collateral reset', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const { PRICE_PRECISION, getVaultRepClaim, repDeposit } = fixture

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

	test('retains failed commitments across redemption and blocks a fresh underbacked generation', async () => {
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const liquidationReceiver = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const victim = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd - 200_000n)
		await manipulatePriceOracle(client, mockWindow, coordinator, PRICE_PRECISION)

		await approveToken(liquidationReceiver, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRepToVault(liquidationReceiver, securityPool, repDeposit * 10n, 2_000_000_000n)

		const originalCollateralAttoEth = 30n * 10n ** 18n
		await setUnderwritingLimit(client, securityPool, originalCollateralAttoEth)
		await createCompleteSet(client, securityPool, originalCollateralAttoEth)
		const underfundedPrice = 2_000n * PRICE_PRECISION
		await mockWindow.advanceTime(100_000n)
		await manipulatePriceOracleAndPerformOperation(liquidationReceiver, mockWindow, coordinator, OperationType.Liquidation, client.account.address, originalCollateralAttoEth / 2n, underfundedPrice)

		const badDebtAttoEth = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'totalBadDebtAttoEth',
		})
		const defaultedVault = await getSecurityVault(client, securityPool, client.account.address)
		strictEqualTypeSafe(badDebtAttoEth, 0n, 'an incomplete transfer must retain its commitment without recording fictitious bad debt')
		const defaultedVaultResidualRepAttoRep = await getVaultRepClaim(client.account.address)
		assert.ok(defaultedVaultResidualRepAttoRep > 0n, 'the defaulted vault should retain residual REP backing')
		assert.ok(defaultedVault.underwritingLimitAttoEth > 0n, 'the defaulted vault should retain the capacity paired with its uncovered debt')
		const minimumVaultRepDepositAttoRep = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'minimumVaultRepDepositAttoRep',
		})
		assert.ok(defaultedVaultResidualRepAttoRep >= minimumVaultRepDepositAttoRep, 'partial liquidation preserves the target minimum REP reserve')

		await redeemCompleteSet(client, securityPool, await getShareTokenSupplyAttoShares(client, securityPool))
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPool), 0n, 'redeeming the original complete sets should empty settlement collateral')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'totalBadDebtAttoEth' }), 0n, 'bad debt should end with the collateral generation that created it')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'vaultBadDebtAttoEth', args: [client.account.address] }), 0n, 'the defaulted vault should expose no bad debt in the next collateral generation')

		await setUnderwritingLimit(liquidationReceiver, securityPool, 0n)
		const receiverRepClaim = await getVaultRepClaim(liquidationReceiver.account.address)
		await manipulatePriceOracleAndPerformOperation(liquidationReceiver, mockWindow, coordinator, OperationType.WithdrawRep, liquidationReceiver.account.address, receiverRepClaim, underfundedPrice)
		strictEqualTypeSafe(await getVaultRepClaim(liquidationReceiver.account.address), receiverRepClaim, 'zero collateral must not allow withdrawal of REP needed by the remaining commitments')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPool), receiverRepClaim + defaultedVaultResidualRepAttoRep, 'the rejected withdrawal must preserve all pool-held REP')
		await manipulatePriceOracle(client, mockWindow, coordinator, underfundedPrice * 100n)

		const backedMintingCapacityAttoEth = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'getCurrentMintingCapacityAttoEth',
		})
		strictEqualTypeSafe(backedMintingCapacityAttoEth, 0n, 'underbacked standing commitments must close minting even after collateral redemption')
		await assert.rejects(createCompleteSet(victim, securityPool, 1n * 10n ** 18n, true), /Pool backing insufficient/)
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPool), 0n, 'the rejected fresh mint should not start a new undercollateralized generation')
	})
})
