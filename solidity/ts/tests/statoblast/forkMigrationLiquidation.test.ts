import { encodeAbiParameters, keccak256, type Address } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getCurrentRetentionRate, getSecurityVault, getSettlementCollateralAttoEth, getTotalPoolHeldAttoRep, getTotalRepBackingUnits, getTotalUnderwritingLimitAttoEth, updateVaultFees } from '../../testSupport/simulator/utils/contracts/securityPool'
import { migrateRepToZoltar, migrateVault } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { executeStagedOperation, getLastPrice, getQuestionEndDate, getStagedOperationCounter, OperationType, queueDelegatedLiquidationAtForcedPrice, queueLiquidationAtForcedPrice, requestPriceIfNeededAndStageOperation } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, canLiquidate, handleOracleReporting, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, setVaultCapacityFixture } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { approximatelyEqual, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { ReputationToken_ReputationToken, statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

const LIQUIDATION_APPROVAL_TYPEHASH = keccak256(
	new TextEncoder().encode('LiquidationApproval(address securityPool,address receiverVault,address operator,address targetVault,uint256 maxCumulativeDebtAttoEth,uint256 maxDebtPerLiquidationAttoEth,uint256 minPostLiquidationHealthFactorBps,uint256 validAfter,uint256 validUntil,uint256 nonce)'),
)

function getLiquidationApprovalId(params: { securityPool: Address; receiverVault: Address; operator: Address; targetVault: Address; maxCumulativeDebtAttoEth: bigint; maxDebtPerLiquidationAttoEth: bigint; minPostLiquidationHealthFactorBps: bigint; validAfter: bigint; validUntil: bigint; nonce: bigint }) {
	return keccak256(
		encodeAbiParameters(
			[{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
			[LIQUIDATION_APPROVAL_TYPEHASH, params.securityPool, params.receiverVault, params.operator, params.targetVault, params.maxCumulativeDebtAttoEth, params.maxDebtPerLiquidationAttoEth, params.minPostLiquidationHealthFactorBps, params.validAfter, params.validUntil, params.nonce],
		),
	)
}

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { reportBond, PRICE_PRECISION, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, MAX_RETENTION_RATE, getVaultRepClaim, triggerExternalForkForSecurityPool } = fixture

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

	describe('liquidation and collateral accounting', () => {
		const prepareMinimumDebtLiquidation = async (receiverLimitAttoEth = 0n) => {
			const targetUnderwritingLimitAttoEth = 75n * 10n ** 18n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, targetUnderwritingLimitAttoEth)
			const receiverClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveToken(receiverClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(receiverClient, securityPoolAddresses.securityPool, repDeposit * 10n, 2_000_000_000n)
			await setVaultCapacityFixture(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, receiverClient.account.address, receiverLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 30n * 10n ** 18n)
			await mockWindow.advanceTime(100000n)
			return { receiverClient, forcedPrice: PRICE_PRECISION * 200n }
		}

		test('liquidation transfers REP from the target to the liquidator', async () => {
			const securityPoolUnderwritingLimitAttoEth = 75n * 10n ** 18n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, securityPoolUnderwritingLimitAttoEth)
			const initialPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			assert.ok(initialPrice > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), securityPoolUnderwritingLimitAttoEth, 'capacity ownership')

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n, 2_000_000_000n)
			const openInterestAmount = 30n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			const targetFeesBeforeLiquidation = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).claimableFeesAttoEth
			assert.ok(targetFeesBeforeLiquidation > 0n, 'test setup should accrue fees to the target before liquidation')

			strictEqualTypeSafe(canLiquidate(initialPrice, securityPoolUnderwritingLimitAttoEth, repDeposit, statoblastSecurityMultiplierBps), false, 'Should not be able to liquidate yet')
			// REP/ETH increases until the target's live open interest exceeds its backing.
			const forcedPrice = PRICE_PRECISION * 200n
			const liquidationDebtAttoEth = 20n * 10n ** 18n
			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, liquidationDebtAttoEth, forcedPrice)
			await writeContractAndWait(liquidatorClient, () =>
				liquidatorClient.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: addressString(GENESIS_REPUTATION_TOKEN),
					functionName: 'transfer',
					args: [securityPoolAddresses.securityPool, 1n],
				}),
			)
			const targetVaultBeforeLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultBeforeLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimBeforeLiquidation = await getVaultRepClaim(client.account.address)
			const liquidatorClaimBeforeLiquidation = await getVaultRepClaim(liquidatorClient.account.address)

			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const currentPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			strictEqualTypeSafe(currentPrice, forcedPrice, 'Price did not increase!')

			strictEqualTypeSafe(canLiquidate(currentPrice, securityPoolUnderwritingLimitAttoEth, repDeposit, statoblastSecurityMultiplierBps), true, 'Should be able to liquidate now')

			const originalVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const originalClaim = await getVaultRepClaim(client.account.address)
			const liquidatorClaim = await getVaultRepClaim(liquidatorClient.account.address)
			assert.ok(originalVault.underwritingLimitAttoEth < targetVaultBeforeLiquidation.underwritingLimitAttoEth, 'liquidation should reduce target capacity ownership')
			assert.ok(originalVault.repBackingUnits < targetVaultBeforeLiquidation.repBackingUnits, 'liquidation should move target backing units')
			assert.ok(originalVault.claimableFeesAttoEth >= targetFeesBeforeLiquidation, 'the target should retain every fee accrued before liquidation')
			assert.ok(liquidatorVault.underwritingLimitAttoEth > liquidatorVaultBeforeLiquidation.underwritingLimitAttoEth, 'receiver should gain the moved capacity ownership')
			strictEqualTypeSafe(originalVault.underwritingLimitAttoEth + liquidatorVault.underwritingLimitAttoEth, targetVaultBeforeLiquidation.underwritingLimitAttoEth + liquidatorVaultBeforeLiquidation.underwritingLimitAttoEth, 'liquidation should conserve target and receiver capacity ownership')
			strictEqualTypeSafe(originalVault.repBackingUnits + liquidatorVault.repBackingUnits, targetVaultBeforeLiquidation.repBackingUnits + liquidatorVaultBeforeLiquidation.repBackingUnits, 'liquidation should conserve target and receiver backing units')
			strictEqualTypeSafe(originalClaim + liquidatorClaim, targetClaimBeforeLiquidation + liquidatorClaimBeforeLiquidation, 'liquidation should conserve target and receiver REP claims')
			assert.ok(liquidatorVault.claimableFeesAttoEth >= liquidatorVaultBeforeLiquidation.claimableFeesAttoEth, 'the receiver should retain fees accrued from its own pre-liquidation ownership')
		})

		test('receiver existing debt permits accepting a liquidation slice below the debt floor', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation(5n * 10n ** 17n)
			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const receiverVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			const receiverOpenInterestBefore = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getVaultUnderwritingLimitAttoEth',
				args: [receiverClient.account.address],
			})

			await queueLiquidationAtForcedPrice(receiverClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, 75n * 10n ** 16n, forcedPrice)
			await handleOracleReporting(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const receiverVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			const receiverOpenInterestAfter = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getVaultUnderwritingLimitAttoEth',
				args: [receiverClient.account.address],
			})

			assert.ok(receiverOpenInterestBefore < 1n * 10n ** 18n, 'receiver setup should begin below the debt floor')
			assert.ok(receiverOpenInterestAfter >= 1n * 10n ** 18n, 'the receiver resulting position should satisfy the debt floor')
			assert.ok(targetVaultAfter.underwritingLimitAttoEth < targetVaultBefore.underwritingLimitAttoEth, 'the target should lose capacity ownership')
			assert.ok(receiverVaultAfter.underwritingLimitAttoEth > receiverVaultBefore.underwritingLimitAttoEth, 'the receiver should accept the sub-floor liquidation slice')
		})

		test('real coordinator delegated liquidation consumes exactly the receiver debt increase within its reservation', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation(5n * 10n ** 17n)
			const operatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const requestedDebtAttoEth = 75n * 10n ** 16n
			const registryAddress = await client.readContract({
				address: securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'liquidationApprovalRegistry',
			})
			const approval = {
				securityPool: securityPoolAddresses.securityPool,
				receiverVault: receiverClient.account.address,
				operator: operatorClient.account.address,
				targetVault: client.account.address,
				maxCumulativeDebtAttoEth: 2n * 10n ** 18n,
				maxDebtPerLiquidationAttoEth: 1n * 10n ** 18n,
				minPostLiquidationHealthFactorBps: 10_000n,
				validAfter: 0n,
				validUntil: 9_999_999_999n,
				nonce: 1n,
			}
			const approvalId = getLiquidationApprovalId(approval)
			await writeContractAndWait(receiverClient, () =>
				receiverClient.writeContract({
					address: registryAddress,
					abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
					functionName: 'setLiquidationApproval',
					args: [approval],
				}),
			)

			const receiverVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			const operatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, operatorClient.account.address)
			await queueDelegatedLiquidationAtForcedPrice(operatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, receiverClient.account.address, requestedDebtAttoEth, approvalId, forcedPrice)
			const reservedState = await client.readContract({
				address: registryAddress,
				abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
				functionName: 'getLiquidationApproval',
				args: [approvalId],
			})
			strictEqualTypeSafe(reservedState.reservedDebtAttoEth, requestedDebtAttoEth, 'the real coordinator should reserve requested debt at queue time')
			strictEqualTypeSafe(reservedState.consumedDebtAttoEth, 0n, 'queueing must not consume approval quota')
			await writeContractAndWait(receiverClient, () =>
				receiverClient.writeContract({
					address: registryAddress,
					abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
					functionName: 'revokeLiquidationApproval',
					args: [approvalId],
				}),
			)

			await handleOracleReporting(operatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const receiverOpenInterestAfter = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getVaultUnderwritingLimitAttoEth',
				args: [receiverClient.account.address],
			})
			const receiverDebtIncreaseAttoEth = receiverOpenInterestAfter - receiverVaultBefore.underwritingLimitAttoEth
			const settledState = await client.readContract({
				address: registryAddress,
				abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
				functionName: 'getLiquidationApproval',
				args: [approvalId],
			})
			const operatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, operatorClient.account.address)
			assert.ok(receiverDebtIncreaseAttoEth > 0n, 'delegated liquidation should move receiver debt')
			strictEqualTypeSafe(settledState.consumedDebtAttoEth, receiverDebtIncreaseAttoEth, 'consumed approval quota must equal the receiver live debt increase')
			assert.ok(receiverDebtIncreaseAttoEth <= requestedDebtAttoEth, 'receiver debt must not exceed the staged reservation')
			assert.ok(receiverDebtIncreaseAttoEth <= approval.maxDebtPerLiquidationAttoEth, 'receiver debt must not exceed the per-liquidation approval limit')
			strictEqualTypeSafe(settledState.reservedDebtAttoEth, 0n, 'terminal delegated execution must clear its reservation')
			strictEqualTypeSafe(settledState.revoked, true, 'revocation should survive without cancelling the staged reservation')
			strictEqualTypeSafe(settledState.availableDebtAttoEth + settledState.reservedDebtAttoEth + settledState.consumedDebtAttoEth, approval.maxCumulativeDebtAttoEth, 'approval quota must remain conserved')
			strictEqualTypeSafe(operatorVaultAfter.underwritingLimitAttoEth, operatorVaultBefore.underwritingLimitAttoEth, 'the operator must not receive delegated capacity ownership')
		})

		test('real coordinator permissionless expiry cleanup releases delegated approval reservation without a valid price', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation()
			const operatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const cleanerClient = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const requestedDebtAttoEth = 5n * 10n ** 17n
			const validForSeconds = 60n
			const coordinatorAddress = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
			const registryAddress = await client.readContract({
				address: coordinatorAddress,
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'liquidationApprovalRegistry',
			})
			const approval = {
				securityPool: securityPoolAddresses.securityPool,
				receiverVault: receiverClient.account.address,
				operator: operatorClient.account.address,
				targetVault: client.account.address,
				maxCumulativeDebtAttoEth: 2n * 10n ** 18n,
				maxDebtPerLiquidationAttoEth: 1n * 10n ** 18n,
				minPostLiquidationHealthFactorBps: 10_000n,
				validAfter: 0n,
				validUntil: 9_999_999_999n,
				nonce: 2n,
			}
			const approvalId = getLiquidationApprovalId(approval)
			await writeContractAndWait(receiverClient, () =>
				receiverClient.writeContract({
					address: registryAddress,
					abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
					functionName: 'setLiquidationApproval',
					args: [approval],
				}),
			)
			await queueDelegatedLiquidationAtForcedPrice(operatorClient, coordinatorAddress, client.account.address, receiverClient.account.address, requestedDebtAttoEth, approvalId, forcedPrice, validForSeconds)
			const operationId = await getStagedOperationCounter(client, coordinatorAddress)
			const settlementTime = await client.readContract({
				address: coordinatorAddress,
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'settlementTime',
			})
			await mockWindow.advanceTime(settlementTime + validForSeconds + 1n)
			await executeStagedOperation(cleanerClient, coordinatorAddress, operationId)

			const cleanedState = await client.readContract({
				address: registryAddress,
				abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
				functionName: 'getLiquidationApproval',
				args: [approvalId],
			})
			strictEqualTypeSafe(cleanedState.availableDebtAttoEth, approval.maxCumulativeDebtAttoEth, 'expiry cleanup must restore all reserved quota')
			strictEqualTypeSafe(cleanedState.reservedDebtAttoEth, 0n, 'expired operation must retain no reservation')
			strictEqualTypeSafe(cleanedState.consumedDebtAttoEth, 0n, 'expiry cleanup must consume no receiver quota')
		})

		test('receiver resulting debt below the minimum rejects a funded liquidation slice without recording bad debt', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation()
			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const receiverVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			const totalBadDebtBefore = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'totalBadDebtAttoEth',
			})

			await queueLiquidationAtForcedPrice(receiverClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, 5n * 10n ** 17n, forcedPrice)
			await handleOracleReporting(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const receiverVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			strictEqualTypeSafe(targetVaultAfter.underwritingLimitAttoEth, targetVaultBefore.underwritingLimitAttoEth, 'a rejected receiver must not change target ownership')
			strictEqualTypeSafe(receiverVaultAfter.underwritingLimitAttoEth, receiverVaultBefore.underwritingLimitAttoEth, 'a rejected receiver must not receive ownership')
			strictEqualTypeSafe(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'totalBadDebtAttoEth' }), totalBadDebtBefore, 'a receiver-specific rejection must not create avoidable bad debt')
		})

		test('liquidation rejects target debt dust', async () => {
			const { receiverClient } = await prepareMinimumDebtLiquidation()
			const forcedPrice = PRICE_PRECISION * 90n
			const targetVaultBeforeDustAttempt = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const receiverVaultBeforeDustAttempt = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			const targetOpenInterestBefore = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getVaultUnderwritingLimitAttoEth',
				args: [client.account.address],
			})

			await queueLiquidationAtForcedPrice(receiverClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, targetOpenInterestBefore - 5n * 10n ** 17n, forcedPrice)
			await handleOracleReporting(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const targetVaultAfterDustAttempt = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const receiverVaultAfterDustAttempt = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)
			strictEqualTypeSafe(targetVaultAfterDustAttempt.underwritingLimitAttoEth, targetVaultBeforeDustAttempt.underwritingLimitAttoEth, 'target debt dust should reject the entire transfer')
			strictEqualTypeSafe(receiverVaultAfterDustAttempt.underwritingLimitAttoEth, receiverVaultBeforeDustAttempt.underwritingLimitAttoEth, 'target debt dust should not reach the receiver')
		})

		test('liquidation permits the exact zero-target debt boundary', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation()
			const receiverVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)

			await queueLiquidationAtForcedPrice(receiverClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, 75n * 10n ** 18n, forcedPrice)
			await handleOracleReporting(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			strictEqualTypeSafe(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultUnderwritingLimitAttoEth', args: [client.account.address] }), 0n, 'a full-target liquidation should permit the zero-debt boundary')
			assert.ok((await getSecurityVault(client, securityPoolAddresses.securityPool, receiverClient.account.address)).underwritingLimitAttoEth > receiverVaultBefore.underwritingLimitAttoEth, 'the receiver should gain ownership when the target is fully liquidated')
		})

		test('incomplete liquidation retains commitments through fee decay without recording fictitious losses', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation()
			const underfundedPrice = forcedPrice * 10n
			await queueLiquidationAtForcedPrice(receiverClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, 30n * 10n ** 18n, underfundedPrice)
			await handleOracleReporting(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, underfundedPrice)
			const totalBadDebtAttoEth = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'totalBadDebtAttoEth',
			})
			strictEqualTypeSafe(totalBadDebtAttoEth, 0n, 'incomplete liquidation must not write off a retained commitment')
			const residualBefore = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).underwritingLimitAttoEth
			assert.ok(residualBefore > 0n, 'an unaccepted commitment must remain visible')
			let settlementCollateralAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const initialCollateralAttoEth = settlementCollateralAttoEth
			for (let interval = 0; interval < 2; interval++) {
				await mockWindow.advanceTime(10n * 365n * DAY)
				await updateVaultFees(receiverClient, securityPoolAddresses.securityPool, receiverClient.account.address)
				settlementCollateralAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			}
			assert.ok(settlementCollateralAttoEth < initialCollateralAttoEth, 'retained commitments continue earning fees')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).underwritingLimitAttoEth, residualBefore, 'fee decay must not erase residual commitments')

			await manipulatePriceOracleAndPerformOperation(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, receiverClient.account.address, 1n, underfundedPrice)
			await assert.rejects(depositToEscalationGame(receiverClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond), /Pool backing insufficient/)
		})

		test('vault migration preserves retained commitments, backing and fees without writing off exposure', async () => {
			const { receiverClient, forcedPrice } = await prepareMinimumDebtLiquidation()
			const underfundedPrice = forcedPrice * 10n
			await queueLiquidationAtForcedPrice(receiverClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, 30n * 10n ** 18n, underfundedPrice)
			await handleOracleReporting(receiverClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, underfundedPrice)
			const parentBackingAttoRep = await getVaultRepClaim(client.account.address)
			await triggerExternalForkForSecurityPool(undefined, 'retained commitment migration source')
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const parentVaultBadDebtAttoEth = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'vaultBadDebtAttoEth',
				args: [client.account.address],
			})
			const parentTotalBadDebtAttoEth = await client.readContract({
				address: securityPoolAddresses.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'totalBadDebtAttoEth',
			})
			strictEqualTypeSafe(parentVaultBadDebtAttoEth, 0n, 'failed liquidation must retain exposure without manufacturing a loss offset')
			const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			strictEqualTypeSafe(await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'vaultBadDebtAttoEth', args: [client.account.address] }), parentVaultBadDebtAttoEth, 'child vault should retain the migrated bad-debt offset')
			strictEqualTypeSafe(await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'totalBadDebtAttoEth' }), parentTotalBadDebtAttoEth, 'child pool should retain aggregate bad-debt accounting')
			const childVault = await getSecurityVault(client, yesPool.securityPool, client.account.address)
			strictEqualTypeSafe(childVault.underwritingLimitAttoEth, parentVaultBeforeMigration.underwritingLimitAttoEth, 'migration should preserve capacity ownership')
			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultUnderwritingLimitAttoEth', args: [client.account.address] }), parentVaultBeforeMigration.underwritingLimitAttoEth, 'child vault inherits its parent commitment')
			strictEqualTypeSafe(childVault.claimableFeesAttoEth + parentVaultAfterMigration.claimableFeesAttoEth, parentVaultBeforeMigration.claimableFeesAttoEth, 'migration should preserve accrued vault fees without changing their existing pool entitlement')
			strictEqualTypeSafe(childVault.feeIndex, await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'feeIndex' }), 'the migrated capacity should start from the child fee index')
			strictEqualTypeSafe(await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'backingUnitsToAttoRep', args: [childVault.repBackingUnits] }), parentBackingAttoRep, 'migration should preserve pool-held REP backing')
			strictEqualTypeSafe(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'vaultBadDebtAttoEth', args: [client.account.address] }), 0n, 'parent vault bad debt should be consumed by migration')

			const childVaultBeforeRepeat = await getSecurityVault(client, yesPool.securityPool, client.account.address)
			const childFactorsBeforeRepeat = await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultCapacityBackingFactorsBps', args: [client.account.address] })
			const childTotalBadDebtBeforeRepeat = await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'totalBadDebtAttoEth' })
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			assert.deepStrictEqual(await getSecurityVault(client, yesPool.securityPool, client.account.address), childVaultBeforeRepeat, 'repeating migration to the same child should preserve the child vault economics')
			assert.deepStrictEqual(
				await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultCapacityBackingFactorsBps', args: [client.account.address] }),
				childFactorsBeforeRepeat,
				'repeating migration to the same child should preserve derived backing factors',
			)
			strictEqualTypeSafe(await client.readContract({ address: yesPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'totalBadDebtAttoEth' }), childTotalBadDebtBeforeRepeat, 'repeating migration to the same child should preserve aggregate bad debt')
		})

		test('liquidation rejects attempts to use the target vault as the receiver', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = 75n * 10n ** 18n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, securityPoolUnderwritingLimitAttoEth)
			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimBefore = await getVaultRepClaim(client.account.address)
			const liquidationDebtAttoEth = 20n * 10n ** 18n

			await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationDebtAttoEth), /Receiver is target/)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfter = await getVaultRepClaim(client.account.address)

			strictEqualTypeSafe(targetVaultAfter.underwritingLimitAttoEth, targetVaultBefore.underwritingLimitAttoEth, 'same-vault liquidation should not move target capacity ownership')
			strictEqualTypeSafe(targetVaultAfter.repBackingUnits, targetVaultBefore.repBackingUnits, 'same-vault liquidation should not move target backingUnits')
			strictEqualTypeSafe(targetClaimAfter, targetClaimBefore, 'same-vault liquidation should not move target REP')
		})

		test('liquidation quote is invalidated by an additional REP deposit', async () => {
			const securityPoolUnderwritingLimitAttoEth = 75n * 10n ** 18n
			// Set the target's capacity ownership
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, securityPoolUnderwritingLimitAttoEth)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), securityPoolUnderwritingLimitAttoEth, 'capacity ownership')

			// Create liquidator and deposit rep
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

			// Create open interest
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(100000n)

			// Snapshot state before attack (just before queuing liquidation)
			const vaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const snapshotTargetBackingUnits = vaultBefore.repBackingUnits
			const snapshotTotalPoolHeldAttoRep = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
			const snapshotTotalRepBackingUnits = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)

			const snapshotExpectedRepDeposit = (snapshotTargetBackingUnits * snapshotTotalPoolHeldAttoRep) / snapshotTotalRepBackingUnits

			// Queue liquidation (liquidator requests price to trigger liquidation)
			const forcedPrice = PRICE_PRECISION * 10n
			const liquidationDebtAttoEth = 20n * 10n ** 18n
			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, liquidationDebtAttoEth, forcedPrice)

			// Record liquidator's backingUnits before attack
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidatorBeforeBackingUnits = liquidatorVaultBefore.repBackingUnits

			// The target owner rescues the vault while liquidation is pending.
			const extraRepAmount = repDeposit * 5n
			await depositRepToVault(client, securityPoolAddresses.securityPool, extraRepAmount)

			// Capture state after deposit but before liquidation
			const vaultAfterDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfterDeposit = await getVaultRepClaim(client.account.address)
			const afterDepositBackingUnits = vaultAfterDeposit.repBackingUnits
			const denominatorAfter = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
			const totalRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

			// Trigger the queued liquidation by reporting the forced price
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			// After liquidation, read final states
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

			strictEqualTypeSafe(targetVaultAfter.underwritingLimitAttoEth, vaultAfterDeposit.underwritingLimitAttoEth, 'the stale liquidation must not change the rescued target capacity ownership')
			strictEqualTypeSafe(targetVaultAfter.repBackingUnits, afterDepositBackingUnits, 'the target must retain the backingUnits created by its rescue deposit')
			strictEqualTypeSafe(liquidatorVaultAfter.repBackingUnits, liquidatorBeforeBackingUnits, 'the stale liquidation must not move backingUnits to the liquidator')
			strictEqualTypeSafe(await getVaultRepClaim(client.account.address), targetClaimAfterDeposit, 'the target must retain its complete live REP claim')
			strictEqualTypeSafe(await getVaultRepClaim(liquidatorClient.account.address), repDeposit * 10n, 'the liquidator must not receive REP from a stale quote')
			approximatelyEqual(snapshotExpectedRepDeposit, repDeposit, 1n, 'the snapshot claim should still match the original REP deposit before the attack deposit')
			approximatelyEqual(totalRepAfter, repDeposit * 16n, 1n, 'the pool-held REP balance should include the additional attack deposit')
			approximatelyEqual(denominatorAfter, PRICE_PRECISION * repDeposit * 16n, 1n, 'backingUnits denominator should reflect the additional attack deposit')
		})

		test('queued liquidation becomes stale when the target adds even one unit of REP', async () => {
			const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const minimumRepDeposit = await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'minimumVaultRepDepositAttoRep' })
			const minimumUnderwritingLimitAttoEth = 10n * 10n ** 18n
			const underwritingLimitAttoEthCreationPrice = 5n * 10n ** 18n
			const liquidationPrice = 61n * 10n ** 17n
			const extraRepAmount = 1n

			await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, minimumRepDeposit)
			await setVaultCapacityFixture(targetClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, targetClient.account.address, minimumUnderwritingLimitAttoEth, underwritingLimitAttoEthCreationPrice)

			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n, 2_000_000_000n)
			await createCompleteSet(targetClient, securityPoolAddresses.securityPool, 19n * 10n ** 16n)
			await mockWindow.advanceTime(100000n)

			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidatorClaimBefore = await getVaultRepClaim(liquidatorClient.account.address)

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, targetClient.account.address, minimumUnderwritingLimitAttoEth, liquidationPrice)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, extraRepAmount)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfter = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimAfter = await getVaultRepClaim(liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfter.underwritingLimitAttoEth, minimumUnderwritingLimitAttoEth, 'a rescue deposit invalidates the queued liquidation without raising the commitment')
			strictEqualTypeSafe(targetClaimAfter, minimumRepDeposit + extraRepAmount, 'the rescue deposit must remain with the target vault')
			strictEqualTypeSafe(liquidatorVaultAfter.underwritingLimitAttoEth, liquidatorVaultBefore.underwritingLimitAttoEth, 'capacity ownership')
			strictEqualTypeSafe(liquidatorClaimAfter, liquidatorClaimBefore, 'a stale liquidation must not move REP')
		})

		test('locking REP in escalation preserves total collateral claims and only reduces the lockers withdrawable balance', async () => {
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

			const lockedDeposit = 100n * 10n ** 18n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

			const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			const firstVaultTotalClaim = await getVaultRepClaim(client.account.address)
			const secondVaultTotalClaim = await getVaultRepClaim(secondVaultClient.account.address)
			const availableRepBalance = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(firstVaultTotalClaim, repDeposit - lockedDeposit, 'locking REP should remove the committed principal from the vault claim')
			strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'locking REP should not reduce another vaults total collateral claim')
			strictEqualTypeSafe(firstVault.disputeStakedAttoRep, lockedDeposit, 'the lockers escalation principal should be tracked separately')
			strictEqualTypeSafe(firstVaultTotalClaim + firstVault.disputeStakedAttoRep, repDeposit, 'the lockers total position should be preserved across the two REP buckets')
			strictEqualTypeSafe(secondVault.disputeStakedAttoRep, 0n, 'the unrelated vault should have no dispute-staked REP')
			strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'the unrelated vault should keep its full vault REP')
			strictEqualTypeSafe(availableRepBalance, repDeposit * 2n - lockedDeposit, 'pool available REP should exclude only the escalation-locked principal')
		})
	})
})
