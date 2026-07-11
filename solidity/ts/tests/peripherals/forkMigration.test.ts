import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/shared/ethereum'
import { usePeripheralsForkMigrationFixture, type PeripheralsForkMigrationFixture } from './fixture'
import { getExpectedLiquidationRepMove } from './liquidationTestHelpers'
import { getUniverseData } from '../../testsuite/simulator/utils/contracts/zoltar'
import { peripherals_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock, test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock } from '../../types/contractArtifact'

describe('Peripherals: fork migration', () => {
	const fixture = usePeripheralsForkMigrationFixture()

	const assert: PeripheralsForkMigrationFixture['assert'] = fixture.assert

	const approximatelyEqual: PeripheralsForkMigrationFixture['approximatelyEqual'] = fixture.approximatelyEqual

	const strictEqual18Decimal: PeripheralsForkMigrationFixture['strictEqual18Decimal'] = fixture.strictEqual18Decimal

	const strictEqualTypeSafe: PeripheralsForkMigrationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe

	const {
		decodeEventLog,
		sortBigIntsAscending,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		contractExists,
		getChildUniverseId,
		getERC20Balance,
		getETHBalance,
		addressString,
		rpow,
		approveAndDepositRep,
		canLiquidate,
		handleOracleReporting,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		balanceOfShares,
		balanceOfSharesInCash,
		getEthRaiseCap,
		getLastPrice,
		getQuestionEndDate,
		migrateShares,
		OperationType,
		participateAuction,
		requestPriceIfNeededAndStageOperation,
		getScalarOutcomeIndex,
		tickToPrice,
		QuestionOutcome,
		SystemState,
		ensureDefined,
		claimAuctionProceeds,
		createChildUniverse,
		finalizeTruthAuction,
		getMigratedRep,
		getOwnForkRepBuckets,
		getQuestionOutcome,
		getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame,
		initiateSecurityPoolFork,
		claimForkedEscalationDeposits,
		migrateRepToZoltar,
		migrateVault,
		startTruthAuction,
		forkUniverse,
		getRepTokenAddress,
		getTotalTheoreticalSupply,
		getZoltarAddress,
		getZoltarForkThreshold,
		getTotalRepPurchased,
		createCompleteSet,
		depositRep,
		depositToEscalationGame,
		getCompleteSetCollateralAmount,
		getCurrentRetentionRate,
		getPoolOwnershipDenominator,
		getRepToken,
		getShareTokenSupply,
		getTotalRepBalance,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		getTotalFeesOwedToVaults,
		getTotalSecurityBondAllowance,
		poolOwnershipToRep,
		redeemCompleteSet,
		redeemFees,
		redeemRep,
		redeemShares,
		sharesToCash,
		updateCollateralAmount,
		updateVaultFees,
		withdrawFromEscalationGame,
		peripherals_EscalationGame_EscalationGame,
		peripherals_SecurityPoolForker_SecurityPoolForker,
		peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
		formatStorageSlot,
		getMappingStorageSlot,
		reportBond,
		PRICE_PRECISION,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
		MAX_RETENTION_RATE,
		outcomes,
		transferRepToAddress,
		getVaultRepClaim,
		finalizeQuestionAsYesWithoutFork,
		triggerExternalForkForSecurityPool,
		setupOwnForkWithEscrow,
	} = fixture

	let mockWindow: PeripheralsForkMigrationFixture['mockWindow']

	let client: PeripheralsForkMigrationFixture['client']

	let securityPoolAddresses: PeripheralsForkMigrationFixture['securityPoolAddresses']

	let questionData: PeripheralsForkMigrationFixture['questionData']

	let questionId: PeripheralsForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	describe('child universe and own-fork entry', () => {
		test('create child universe test', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)

			const factoryAddress = getInfraContractAddresses().securityPoolFactory
			const deploymentCount = await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'securityPoolDeploymentCount',
				address: factoryAddress,
				args: [],
			})
			const childUniverseId = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
			const expectedChildAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverseId, questionId, securityMultiplier)

			const deployments = await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'securityPoolDeploymentsRange',
				address: factoryAddress,
				args: [0n, deploymentCount],
			})
			const matchingChildDeployment = ensureDefined(
				deployments.find((deployment: { parent: `0x${string}`; universeId: bigint }) => deployment.parent === securityPoolAddresses.securityPool && deployment.universeId === childUniverseId),
				'child deployment not found',
			)
			const {
				completeSetCollateralAmount: childCompleteSetCollateralAmount,
				currentRetentionRate: childCurrentRetentionRate,
				parent: childParent,
				priceOracleManagerAndOperatorQueuer: childManagerAddress,
				questionId: childStoredQuestionId,
				securityMultiplier: childStoredSecurityMultiplier,
				securityPool: childSecurityPoolAddress,
				shareToken: childShareTokenAddress,
				truthAuction: childTruthAuctionAddress,
				universeId: childStoredUniverseId,
			} = matchingChildDeployment

			strictEqualTypeSafe(deploymentCount > 1n, true, 'factory should track more than one deployment')
			strictEqualTypeSafe(childSecurityPoolAddress, expectedChildAddresses.securityPool, 'child deployment should be queryable')
			strictEqualTypeSafe(childTruthAuctionAddress, expectedChildAddresses.truthAuction, 'child truth auction should be queryable')
			strictEqualTypeSafe(childManagerAddress, expectedChildAddresses.priceOracleManagerAndOperatorQueuer, 'child manager should be queryable')
			strictEqualTypeSafe(childShareTokenAddress, expectedChildAddresses.shareToken, 'child share token should be queryable')
			strictEqualTypeSafe(childParent, securityPoolAddresses.securityPool, 'child parent should match the origin security pool')
			strictEqualTypeSafe(childStoredUniverseId, childUniverseId, 'child universe id should match')
			strictEqualTypeSafe(childStoredQuestionId, questionId, 'child question id should match')
			strictEqualTypeSafe(childStoredSecurityMultiplier, securityMultiplier, 'child multiplier should match')
			strictEqualTypeSafe(childCurrentRetentionRate, MAX_RETENTION_RATE, 'child retention rate should match')
			strictEqualTypeSafe(childCompleteSetCollateralAmount, 0n, 'child complete set collateral should default to zero during fork')
			strictEqualTypeSafe(await getLastPrice(client, childManagerAddress), await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 'child manager should inherit the parent price')
		})

		test('forkZoltarWithOwnEscalationGame auto-initiates the pool fork and ignores stray REP already sitting on the forker', async () => {
			const strayRep = 7n * 10n ** 18n

			const { forkData, forkThreshold, ownForkRepBuckets, repBalance } = await setupOwnForkWithEscrow(strayRep)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'forkWithOwnEscalationGame should auto-initiate the parent pool fork')
			assert.ok(forkData.auctionableRepAtFork > 0n, 'repAtFork should keep a positive child REP anchor after the own-game fork')
			assert.ok(forkData.auctionableRepAtFork <= repBalance + forkThreshold * 2n, 'repAtFork should stay bounded by the REP that actually participated in the own-game fork')
			strictEqualTypeSafe(ownForkRepBuckets.escrowSourceRepAtFork, forkThreshold * 2n, 'own-fork source escrow should equal the fork-triggering escalation principal')
			strictEqualTypeSafe(ownForkRepBuckets.vaultRepAtFork + ownForkRepBuckets.unallocatedEscrowChildRep, forkData.auctionableRepAtFork, 'own-fork child REP buckets should partition the full auctionable child REP anchor')
		})

		test('initiateSecurityPoolFork reverts after the own-game fork and ignores stray REP transferred to the forker', async () => {
			const strayRep = 9n * 10n ** 18n

			const { forkData: forkDataBeforeStrayRep } = await setupOwnForkWithEscrow()
			await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRep)
			await assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Already forked/)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 're-initiating after the own-game fork should leave the parent pool in PoolForked')
			strictEqualTypeSafe(forkData.auctionableRepAtFork, forkDataBeforeStrayRep.auctionableRepAtFork, 'repAtFork should ignore unrelated REP transferred to the forker after the own-game fork')
		})

		test('createChildUniverse rejects fake parents that try to reuse a legitimate pool as the child', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await triggerExternalForkForSecurityPool()

			const targetPool = securityPoolAddresses.securityPool
			const denominatorBeforeAttack = await getPoolOwnershipDenominator(client, targetPool)
			const targetForkDataBeforeAttack = await getSecurityPoolForkerForkData(client, targetPool)
			const attackerChosenDenominator = denominatorBeforeAttack + 123n

			const attackFactoryDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock.evm.bytecode.object}`,
					args: [targetPool, targetPool],
				}),
			})
			const attackFactoryReceipt = await client.waitForTransactionReceipt({ hash: attackFactoryDeploymentHash })
			const attackFactoryAddress = ensureDefined(attackFactoryReceipt.contractAddress, 'attack factory address missing')

			const fakeParentDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock.evm.bytecode.object}`,
					args: [genesisUniverse, attackFactoryAddress, securityPoolAddresses.shareToken, questionId, securityMultiplier, 0n, 0n, attackerChosenDenominator],
				}),
			})
			const fakeParentReceipt = await client.waitForTransactionReceipt({ hash: fakeParentDeploymentHash })
			const fakeParentAddress = fakeParentReceipt.contractAddress
			if (fakeParentAddress === undefined || fakeParentAddress === null) throw new Error('fake parent address missing')

			await assert.rejects(createChildUniverse(client, fakeParentAddress, QuestionOutcome.Yes), /Invalid child deployment/)

			strictEqualTypeSafe(await getPoolOwnershipDenominator(client, targetPool), denominatorBeforeAttack, 'attack should not change the legitimate pool ownership denominator')
			strictEqualTypeSafe((await getSecurityPoolForkerForkData(client, targetPool)).truthAuction, targetForkDataBeforeAttack.truthAuction, 'attack should not overwrite the legitimate pool fork metadata')
		})
	})

	describe('liquidation and collateral accounting', () => {
		test('liquidation transfers REP from the target to the liquidator', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = 75n * 10n ** 18n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const initialPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			assert.ok(initialPrice > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(100000n)

			strictEqualTypeSafe(canLiquidate(initialPrice, securityPoolAllowance, repDeposit, 2n), false, 'Should not be able to liquidate yet')
			// REP/ETH increases to 10x, 10 REP = 1 ETH (rep drops in value)
			const forcedPrice = PRICE_PRECISION * 10n
			const liquidationAmount = 25n * 10n ** 18n
			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationAmount)

			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const currentPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			strictEqualTypeSafe(currentPrice, PRICE_PRECISION * 10n, 'Price did not increase!')

			strictEqualTypeSafe(canLiquidate(currentPrice, securityPoolAllowance, repDeposit, 2n), true, 'Should be able to liquidate now')

			const originalVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const originalClaim = await getVaultRepClaim(client.account.address)
			const liquidatorClaim = await getVaultRepClaim(liquidatorClient.account.address)
			const expectedRepMove = getExpectedLiquidationRepMove(liquidationAmount, forcedPrice)
			strictEqualTypeSafe(originalVault.securityBondAllowance, securityPoolAllowance - liquidationAmount, 'original vault should keep only the non-liquidated security bonds')
			approximatelyEqual(originalClaim, repDeposit - expectedRepMove, 1n, 'liquidation should seize REP from the target claim')
			strictEqualTypeSafe(liquidatorVault.securityBondAllowance, liquidationAmount, "liquidator doesn't have the liquidated security pool allowance")
			approximatelyEqual(liquidatorClaim, repDeposit * 10n + expectedRepMove, 1n, 'liquidator should receive the seized REP bonus')
		})

		test('liquidation rejects attempts to liquidate the caller vault itself', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = 75n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(100000n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimBefore = await getVaultRepClaim(client.account.address)
			const liquidationAmount = 25n * 10n ** 18n

			await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationAmount), /Caller bad/)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfter = await getVaultRepClaim(client.account.address)

			strictEqualTypeSafe(targetVaultAfter.securityBondAllowance, targetVaultBefore.securityBondAllowance, 'same-vault liquidation should not move target debt')
			strictEqualTypeSafe(targetVaultAfter.repDepositShare, targetVaultBefore.repDepositShare, 'same-vault liquidation should not move target ownership')
			strictEqualTypeSafe(targetClaimAfter, targetClaimBefore, 'same-vault liquidation should not move target REP')
		})

		test('liquidation should use snapshot to prevent blocking via additional rep deposit', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = 75n * 10n ** 18n
			// Set the target's security bond allowance
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

			// Create liquidator and deposit rep
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

			// Create open interest
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(100000n)

			// Snapshot state before attack (just before queuing liquidation)
			const vaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const snapshotTargetOwnership = vaultBefore.repDepositShare
			const snapshotTotalRep = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
			const snapshotDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)

			const snapshotExpectedRepDeposit = (snapshotTargetOwnership * snapshotTotalRep) / snapshotDenominator

			// Queue liquidation (liquidator requests price to trigger liquidation)
			const forcedPrice = PRICE_PRECISION * 10n
			const liquidationAmount = 25n * 10n ** 18n
			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationAmount)

			// Record liquidator's ownership before attack
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidatorBeforeOwnership = liquidatorVaultBefore.repDepositShare

			// Attacker (the target vault owner) deposits additional REP while liquidation is pending
			const extraRepAmount = repDeposit * 5n
			await depositRep(client, securityPoolAddresses.securityPool, extraRepAmount)

			// Capture state after deposit but before liquidation
			const vaultAfterDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const afterDepositOwnership = vaultAfterDeposit.repDepositShare
			const denominatorAfter = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
			const totalRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

			// Trigger the queued liquidation by reporting the forced price
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			// After liquidation, read final states
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

			strictEqualTypeSafe(targetVaultAfter.securityBondAllowance, securityPoolAllowance - liquidationAmount, 'target security bond allowance should decrease by the liquidated amount')

			const targetOwnershipChange = afterDepositOwnership - targetVaultAfter.repDepositShare
			const liquidatorOwnershipChange = liquidatorVaultAfter.repDepositShare - liquidatorBeforeOwnership
			const expectedRepMove = getExpectedLiquidationRepMove(liquidationAmount, forcedPrice)

			assert.ok(targetOwnershipChange > 0n, 'liquidation should reduce the targets ownership even after an extra deposit')
			assert.ok(liquidatorOwnershipChange > 0n, 'liquidation should increase the liquidators ownership')
			approximatelyEqual((await getVaultRepClaim(liquidatorClient.account.address)) - repDeposit * 10n, expectedRepMove, 2n, 'liquidation should still be sized from the queued snapshot rather than the later deposit')
			approximatelyEqual(snapshotExpectedRepDeposit, repDeposit, 1n, 'the snapshot claim should still match the original REP deposit before the attack deposit')
			approximatelyEqual(totalRepAfter, repDeposit * 16n, 1n, 'the pool REP balance should include the additional attack deposit')
			approximatelyEqual(denominatorAfter, PRICE_PRECISION * repDeposit * 16n, 1n, 'ownership denominator should reflect the additional attack deposit')
		})

		test('a max liquidation can clear the full target debt and seize REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = 75n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
			await mockWindow.advanceTime(100000n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidationAmount = securityPoolAllowance

			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationAmount)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION * 10n)

			const targetVaultAfterFirstLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterFirstLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfterFirstLiquidation = await getVaultRepClaim(client.account.address)
			const liquidatorClaimAfterFirstLiquidation = await getVaultRepClaim(liquidatorClient.account.address)
			const expectedRepMove = getExpectedLiquidationRepMove(liquidationAmount, PRICE_PRECISION * 10n)

			strictEqualTypeSafe(targetVaultAfterFirstLiquidation.securityBondAllowance, 0n, 'max liquidation should clear the full target debt when enough REP is available')
			assert.ok(targetVaultAfterFirstLiquidation.repDepositShare < targetVaultBefore.repDepositShare, 'max liquidation should reduce the target ownership')
			strictEqualTypeSafe(liquidatorVaultAfterFirstLiquidation.securityBondAllowance, liquidatorVaultBefore.securityBondAllowance + liquidationAmount, 'the liquidator should absorb the full requested debt when the target has enough REP to pay the penalty')
			approximatelyEqual(targetClaimAfterFirstLiquidation, repDeposit - expectedRepMove, 1n, 'max liquidation should leave the target with the post-penalty REP remainder')
			approximatelyEqual(liquidatorClaimAfterFirstLiquidation, repDeposit * 2n + expectedRepMove, 1n, 'max liquidation should pay the liquidator the seized REP')

			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationAmount)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION * 10n)

			const targetVaultAfterSecondLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterSecondLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfterSecondLiquidation.securityBondAllowance, targetVaultAfterFirstLiquidation.securityBondAllowance, 'once fully liquidated, the vault should not change under the same price')
			strictEqualTypeSafe(targetVaultAfterSecondLiquidation.repDepositShare, targetVaultAfterFirstLiquidation.repDepositShare, 'a second same-price liquidation should not move more REP after debt is cleared')
			strictEqualTypeSafe(liquidatorVaultAfterSecondLiquidation.securityBondAllowance, liquidatorVaultAfterFirstLiquidation.securityBondAllowance, 'a second same-price liquidation should not move more debt after debt is cleared')
		})

		test('liquidation leaves state unchanged when the only safe dust-avoiding chunk would strand caller debt dust', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = 14n * 10n ** 17n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidationAmount = securityPoolAllowance
			const dustRoundingPrice = PRICE_PRECISION * 1000n

			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, dustRoundingPrice)
			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, liquidationAmount)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultBefore.securityBondAllowance, securityPoolAllowance, 'setup should leave the target at the configured allowance')
			strictEqualTypeSafe(targetVaultAfter.securityBondAllowance, targetVaultBefore.securityBondAllowance, 'liquidation should fail when the only dust-safe target chunk would leave the caller below the minimum debt floor')
			strictEqualTypeSafe(targetVaultAfter.repDepositShare, targetVaultBefore.repDepositShare, 'failed liquidation should not move target REP')
			strictEqualTypeSafe(liquidatorVaultAfter.securityBondAllowance, 0n, 'failed liquidation should not move debt to the liquidator')
		})

		test('liquidation leaves state unchanged when a smaller chunk would leave forbidden target debt dust', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = 14n * 10n ** 17n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const dustRevertingAmount = 8n * 10n ** 17n
			const dustRoundingPrice = PRICE_PRECISION * 1000n

			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, dustRoundingPrice)
			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, dustRevertingAmount)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfter.securityBondAllowance, targetVaultBefore.securityBondAllowance, 'a dust-reverting liquidation should leave the target allowance unchanged')
			strictEqualTypeSafe(targetVaultAfter.repDepositShare, targetVaultBefore.repDepositShare, 'a dust-reverting liquidation should leave the target REP claim unchanged')
			strictEqualTypeSafe(liquidatorVaultAfter.securityBondAllowance, liquidatorVaultBefore.securityBondAllowance, 'a dust-reverting liquidation should not move debt to the liquidator')
			strictEqualTypeSafe(liquidatorVaultAfter.repDepositShare, liquidatorVaultBefore.repDepositShare, 'a dust-reverting liquidation should not move REP to the liquidator')
		})

		test('liquidation leaves state unchanged when a tiny chunk would not improve target health after rounding', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const targetAllowance = 130n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)
			await manipulatePriceOracleAndPerformOperation(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, liquidatorClient.account.address, 1n * 10n ** 18n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const roundingSensitivePrice = (PRICE_PRECISION * 4n) / 10n
			const tinyLiquidationAmount = 1n

			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, tinyLiquidationAmount)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, roundingSensitivePrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfter.securityBondAllowance, targetVaultBefore.securityBondAllowance, 'a non-improving rounded liquidation should not change target debt')
			strictEqualTypeSafe(targetVaultAfter.repDepositShare, targetVaultBefore.repDepositShare, 'a non-improving rounded liquidation should not change target REP')
			strictEqualTypeSafe(liquidatorVaultAfter.securityBondAllowance, liquidatorVaultBefore.securityBondAllowance, 'a non-improving rounded liquidation should not change caller debt')
			strictEqualTypeSafe(liquidatorVaultAfter.repDepositShare, liquidatorVaultBefore.repDepositShare, 'a non-improving rounded liquidation should not change caller REP')
		})

		test('liquidation can seize unlocked REP without touching escalation-locked REP', async () => {
			const securityPoolAllowance = 200n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)

			strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolAllowance, repDeposit, 2n), false, 'vault should start safe before locking REP')

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

			const lockedDeposit = 700n * 10n ** 18n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

			const targetVaultAfterLock = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfterLock = await getVaultRepClaim(client.account.address)

			strictEqualTypeSafe(targetVaultAfterLock.repInEscalationGame, lockedDeposit, 'target vault should have the escalation principal marked as locked')
			strictEqualTypeSafe(targetClaimAfterLock, repDeposit - lockedDeposit, 'locking REP should move the committed principal out of the vault claim')
			strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolAllowance, targetClaimAfterLock, 2n), true, 'the vault should become liquidatable once its unlocked vault REP falls below the required backing')

			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolAllowance)

			const targetVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfterLiquidation = await getVaultRepClaim(client.account.address)
			const liquidatorClaimAfterLiquidation = await getVaultRepClaim(liquidatorClient.account.address)

			const expectedRepMove = getExpectedLiquidationRepMove(securityPoolAllowance, PRICE_PRECISION)
			strictEqualTypeSafe(targetVaultAfterLiquidation.repInEscalationGame, lockedDeposit, 'liquidation should leave the targets escalation commitment untouched')
			strictEqualTypeSafe(targetVaultAfterLiquidation.securityBondAllowance, 0n, 'liquidation should clear the unlocked-vault debt when enough unlocked REP is available')
			approximatelyEqual(targetClaimAfterLiquidation, repDeposit - lockedDeposit - expectedRepMove, 1n, 'liquidation should seize only unlocked vault REP')
			strictEqualTypeSafe(liquidatorVaultAfterLiquidation.securityBondAllowance, securityPoolAllowance, 'the liquidator should absorb the executed debt amount')
			approximatelyEqual(liquidatorClaimAfterLiquidation, repDeposit * 2n + expectedRepMove, 1n, 'the liquidator should receive the unlocked REP seized from the target')
		})

		test('locking REP in escalation preserves total collateral claims and only reduces the lockers withdrawable balance', async () => {
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondVaultClient, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const lockedDeposit = 100n * 10n ** 18n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

			const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			const firstVaultTotalClaim = await getVaultRepClaim(client.account.address)
			const secondVaultTotalClaim = await getVaultRepClaim(secondVaultClient.account.address)
			const availableRepBalance = await getTotalRepBalance(client, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(firstVaultTotalClaim, repDeposit - lockedDeposit, 'locking REP should remove the committed principal from the vault claim')
			strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'locking REP should not reduce another vaults total collateral claim')
			strictEqualTypeSafe(firstVault.repInEscalationGame, lockedDeposit, 'the lockers escalation principal should be tracked separately')
			strictEqualTypeSafe(firstVaultTotalClaim + firstVault.repInEscalationGame, repDeposit, 'the lockers total position should be preserved across the two REP buckets')
			strictEqualTypeSafe(secondVault.repInEscalationGame, 0n, 'the unrelated vault should have no locked REP')
			strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'the unrelated vault should keep its full vault REP')
			strictEqualTypeSafe(availableRepBalance, repDeposit * 2n - lockedDeposit, 'pool available REP should exclude only the escalation-locked principal')
		})
	})

	describe('open interest and share redemption', () => {
		test('Open Interest Fees (non forking)', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			strictEqualTypeSafe(endTime > (await mockWindow.getTime()), true, 'question has already ended')
			const securityPoolAllowance = repDeposit / 4n
			const aMonthFromNow = (await mockWindow.getTime()) + 2628000n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

			const openInterestAmount = 100n * 10n ** 18n
			await mockWindow.setTime(aMonthFromNow)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)

			await mockWindow.setTime(endTime + 10000n)

			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			const feesAccrued = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			const ethBalanceBefore = await getETHBalance(client, client.account.address)
			const securityVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(securityVault.securityBondAllowance, securityPoolAllowance, 'securityPoolAllowance is all ours')
			const ethBalanceAfter = await getETHBalance(client, client.account.address)
			strictEqualTypeSafe(ethBalanceAfter - ethBalanceBefore, securityVault.unpaidEthFees, 'eth gained should be fees accrued')
			strictEqualTypeSafe(feesAccrued / 1000n, securityVault.unpaidEthFees / 1000n, 'eth gained should be fees accrued (minus rounding issues)')
			const completeSetCollateralAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(feesAccrued + completeSetCollateralAmount, openInterestAmount, 'no eth lost')
			const timePassed = endTime - aMonthFromNow
			strictEqualTypeSafe(timePassed / 8640n, 3345n, 'not enough time passed')
			strictEqualTypeSafe(retentionRate, 999999987364000000n, 'retention rate did not match')
			const completeSetCollateralAmountPercentage = Number((completeSetCollateralAmount * 1000n) / openInterestAmount) / 10
			const expected = Number((1000n * rpow(retentionRate, timePassed, PRICE_PRECISION)) / PRICE_PRECISION) / 10
			strictEqualTypeSafe(completeSetCollateralAmountPercentage, expected, 'return amount did not match')
			const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(contractBalance + ethBalanceAfter - ethBalanceBefore, openInterestAmount, 'contract balance + fees should equal initial open interest')
		})

		test('frequent public collateral updates do not strand extra fee residue', async () => {
			const securityPoolAllowance = repDeposit / 4n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 10n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateCollateralAmount(client, securityPoolAddresses.securityPool)
			}
			await mockWindow.setTime(endTime + 10000n)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const splitVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const totalFeesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)

			assert.ok(totalFeesOwed > 0n, 'repeated public collateral updates should accrue nonzero fees in this setup')
			strictEqualTypeSafe(totalFeesOwed, splitVault.unpaidEthFees, 'pool fee accounting should only record fees that the vault index can actually credit')
			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
			const remainingCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(contractBalance, remainingCollateral + (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)), 'final fee settlement should leave every remaining wei in either collateral or redeemable fees')
		})

		test('frequent public collateral updates keep multi-vault fee accounting sweepable', async () => {
			const firstVaultAllowance = repDeposit / 8n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, firstVaultAllowance)

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondVaultClient, repDeposit, questionId)
			const secondVaultAllowance = repDeposit / 8n + 3n
			await manipulatePriceOracleAndPerformOperation(secondVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, secondVaultClient.account.address, secondVaultAllowance)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 10n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateCollateralAmount(client, securityPoolAddresses.securityPool)
			}
			await mockWindow.setTime(endTime + 10000n)

			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			const totalFeesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			const totalCreditedFees = firstVault.unpaidEthFees + secondVault.unpaidEthFees

			assert.ok(totalCreditedFees > 0n, 'repeated public collateral updates should accrue nonzero fees across both vaults in this setup')
			strictEqualTypeSafe(totalFeesOwed, totalCreditedFees, 'pool fee accounting should equal the sum of vault-creditable fees after both vaults sync')

			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			await redeemFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			strictEqualTypeSafe(await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool), 0n, 'pool fee accounting should fully clear once every credited vault fee is redeemed')
		})

		test('allowance handoff does not pay old fee residue to the new vault', async () => {
			const firstVaultAllowance = repDeposit / 4n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, firstVaultAllowance)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 20n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateCollateralAmount(client, securityPoolAddresses.securityPool)
			}

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondVaultClient, repDeposit, questionId)
			const secondVaultAllowance = repDeposit / 4n + 3n
			await manipulatePriceOracleAndPerformOperation(secondVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, secondVaultClient.account.address, secondVaultAllowance)

			const collateralBeforeSecondAccrual = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)
			const expectedNextSecondDelta = collateralBeforeSecondAccrual - (collateralBeforeSecondAccrual * rpow(retentionRate, 1n, PRICE_PRECISION)) / PRICE_PRECISION

			await mockWindow.advanceTime(1n)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const secondVault = await getSecurityVault(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			assert.ok(secondVault.unpaidEthFees <= expectedNextSecondDelta, 'new allowance holder should not inherit denominator residue that accrued before the handoff')
		})

		test('zero-allowance gaps do not charge the next vault for idle time', async () => {
			const firstVaultAllowance = repDeposit / 4n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, firstVaultAllowance)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 40n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateCollateralAmount(client, securityPoolAddresses.securityPool)
			}

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)
			const collateralAtZeroAllowance = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)

			await mockWindow.advanceTime(30n)
			await updateCollateralAmount(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), collateralAtZeroAllowance, 'collateral should not decay while no vault backs the pool')

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondVaultClient, repDeposit, questionId)
			const secondVaultAllowance = repDeposit / 4n + 3n
			await manipulatePriceOracleAndPerformOperation(secondVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, secondVaultClient.account.address, secondVaultAllowance)

			const collateralBeforeSecondAccrual = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)
			const expectedNextSecondDelta = collateralBeforeSecondAccrual - (collateralBeforeSecondAccrual * rpow(retentionRate, 1n, PRICE_PRECISION)) / PRICE_PRECISION

			await mockWindow.advanceTime(1n)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const secondVault = await getSecurityVault(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			assert.ok(secondVault.unpaidEthFees <= expectedNextSecondDelta, 'new allowance holder should only accrue fees for time after the zero-allowance gap ends')
		})

		test('redeemCompleteSet exits at the fee-adjusted share exchange rate', async () => {
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const redeemAmount = ensureDefined(firstHolderShares[0], 'first holder complete-set shares missing') / 2n
			const initialCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const initialShareSupply = await getShareTokenSupply(client, securityPoolAddresses.securityPool)
			const initialFeesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			assert.ok(initialFeesOwed > 0n, 'test setup should accrue open-interest fees before redemption')

			const balanceBeforeRedeem = await getETHBalance(client, firstHolder.account.address)
			await redeemCompleteSet(firstHolder, securityPoolAddresses.securityPool, redeemAmount)

			const collateralAfterRedeem = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const feesAfterRedeem = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - balanceBeforeRedeem
			const feeDelta = feesAfterRedeem - initialFeesOwed
			const firstHolderSharesAfterRedeem = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderSharesAfterRedeem = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const shareSupplyAfterRedeem = await getShareTokenSupply(client, securityPoolAddresses.securityPool)
			const feeDustTolerance = securityPoolAllowance / PRICE_PRECISION

			assert.ok(firstHolderPayout > 0n, 'redeeming complete sets should pay ETH to the holder')
			approximatelyEqual(collateralAfterRedeem + firstHolderPayout + feeDelta, initialCollateral, feeDustTolerance, 'complete-set redemption should conserve collateral after fee accrual up to bounded fee dust')
			strictEqualTypeSafe(shareSupplyAfterRedeem, initialShareSupply - redeemAmount, 'complete-set redemption should reduce share supply by the burned set amount')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[0], firstHolderShares[0] - redeemAmount, 'redeeming should burn the holders invalid-side share')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[1], firstHolderShares[1] - redeemAmount, 'redeeming should burn the holders yes-side share')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[2], firstHolderShares[2] - redeemAmount, 'redeeming should burn the holders no-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[0], secondHolderShares[0], 'redeeming should not burn another holders invalid-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[1], secondHolderShares[1], 'redeeming should not burn another holders yes-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[2], secondHolderShares[2], 'redeeming should not burn another holders no-side share')
			strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, shareSupplyAfterRedeem), collateralAfterRedeem, 'remaining complete sets should keep the fee-adjusted exchange rate')
		})

		test('can set security bonds allowance, mint complete sets and fork happily', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, forkThreshold * 2n)

			const openInterestAmount = 100n * 10n ** 18n
			const maxGasFees = openInterestAmount / 4n
			const ethBalance = await getETHBalance(client, client.account.address)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			assert.ok((await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)) > 0n, 'contract did not record collateral after minting complete sets')
			const completeSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
			strictEqualTypeSafe(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
			strictEqualTypeSafe(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
			strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, completeSetBalances[0]), openInterestAmount, 'Did not create enough complete sets')
			assert.ok(ethBalance - (await getETHBalance(client, client.account.address)) > maxGasFees, 'Did not lose eth to create complete sets')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
			await redeemCompleteSet(client, securityPoolAddresses.securityPool, completeSetBalances[0])
			assert.ok(ethBalance - (await getETHBalance(client, client.account.address)) < maxGasFees, 'Did not get ETH back from complete sets')
			const newCompleteSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
			strictEqualTypeSafe(newCompleteSetBalances[0], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(newCompleteSetBalances[1], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(newCompleteSetBalances[2], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets')

			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			const collateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)

			// forking
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.ok(forkData.auctionableRepAtFork > 0n, 'rep at fork should stay positive after the own-game fork')
			assert.ok(forkData.auctionableRepAtFork <= repBalance + forkThreshold * 2n, 'rep at fork should stay bounded by the REP that actually participated in the own-game fork')
			strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
			strictEqualTypeSafe(forkData.outcomeIndex, 0n, 'there should be no outcome')
			strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')
			const totalFeesOwedToVaultsRightAfterFork = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
			strictEqualTypeSafe(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), "Parent's original rep is gone")
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
			const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(migratedRep, 0n, 'escalation-only wallet claims should not count as migrated child-pool REP')
			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const yesStateAfterStart = await getSystemState(client, yesSecurityPool.securityPool)
			if (yesStateAfterStart === SystemState.ForkTruthAuction) {
				const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
				const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
				const yesEthRaiseCap = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
				await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repAtFork, yesEthRaiseCap)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(yesStateAfterStart, SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately when no child collateral remains to buy')
				strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should become operational after the truth auction finalizes')

			const totalCollateral = (await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)) + (await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool))
			assert.ok(totalCollateral <= collateralAtFork, 'forked collateral should stay conserved across the parent and child pools')

			const totalFeesOwedToVaultsAfterFork = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			assert.ok(totalFeesOwedToVaultsAfterFork >= totalFeesOwedToVaultsRightAfterFork, 'parent fee accounting should remain readable after the fork path settles child state')
		})

		test('redeemShares updates security-pool accounting as winning shares are redeemed', async () => {
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

			const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const firstWinningShares = ensureDefined(firstHolderShares[1], 'first holder winning shares missing')
			const secondWinningShares = ensureDefined(secondHolderShares[1], 'second holder winning shares missing')
			const initialCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const initialShareSupply = await getShareTokenSupply(client, securityPoolAddresses.securityPool)
			const initialFeesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			assert.ok(initialCollateral > 0n, 'collateral should be positive before finalization')
			strictEqualTypeSafe(initialShareSupply, firstWinningShares + secondWinningShares, 'share supply should equal the minted winning-share balances')

			await finalizeQuestionAsYesWithoutFork()
			const firstHolderBalanceBeforeRedemption = await getETHBalance(client, firstHolder.account.address)
			await redeemShares(firstHolder, securityPoolAddresses.securityPool)

			const collateralAfterFirstRedemption = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const feesAfterFirstRedemption = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - firstHolderBalanceBeforeRedemption
			const feeDelta = feesAfterFirstRedemption - initialFeesOwed
			const feeDustTolerance = securityPoolAllowance / PRICE_PRECISION

			assert.ok(feeDelta > 0n, 'first redemption should accrue open-interest fees')
			approximatelyEqual(collateralAfterFirstRedemption + firstHolderPayout + feeDelta, initialCollateral, feeDustTolerance, 'collateral should shrink by fees and first winning redemption up to bounded fee dust')
			strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), initialShareSupply - firstWinningShares, 'share supply should shrink after first winning redemption')
			approximatelyEqual(await sharesToCash(client, securityPoolAddresses.securityPool, secondWinningShares), collateralAfterFirstRedemption, 10n, 'remaining winning shares should not be double counted')

			await redeemShares(secondHolder, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'collateral should be empty after all winning shares are redeemed')
			strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'share supply should be empty after all winning shares are redeemed')
		})

		test('redeemShares accrues open-interest fees before paying winning shares', async () => {
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const openInterestAmount = 10n * 10n ** 18n
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			const balanceBefore = await getETHBalance(client, openInterestHolder.account.address)

			await finalizeQuestionAsYesWithoutFork()
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)

			const balanceAfter = await getETHBalance(client, openInterestHolder.account.address)
			const feesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			const payout = balanceAfter - balanceBefore

			assert.ok(feesOwed > 0n, 'redeemShares should accrue fees before paying winning shares')
			assert.ok(payout < openInterestAmount, 'winner payout should be net of accrued fees')
			approximatelyEqual(payout + feesOwed, openInterestAmount, 1000n, 'payout plus fees should conserve open interest')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'all collateral should be consumed after sole winning redemption')
		})

		test('sharesToCash returns zero for stale non-winning shares after all winning shares are redeemed', async () => {
			const completeSetAmount = 1n * 10n ** 18n
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, completeSetAmount)
			await finalizeQuestionAsYesWithoutFork()
			const shareBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address)
			const winningShares = ensureDefined(shareBalances[1], 'winning shares should exist before redemption')
			const winningShareCashValue = await sharesToCash(client, securityPoolAddresses.securityPool, winningShares)

			assert.ok(winningShareCashValue > 0n, 'winning shares should map to a positive cash value before redemption')
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining collateral')
			strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining share supply')
			strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, winningShares), 0n, 'once winning supply is exhausted, leftover losing shares should no longer map to any cash value')
		})

		test('redeemShares and redeemRep stay available after an unrelated late fork once the question has finalized', async () => {
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 5n * 10n ** 18n)
			await finalizeQuestionAsYesWithoutFork()

			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
			const repTotalSupplySlot = formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)
			await mockWindow.addStateOverrides({
				[repToken]: {
					stateDiff: {
						[repTotalSupplySlot]: repDeposit * 10n,
					},
				},
			})

			const lateForkQuestionData = {
				...questionData,
				title: 'late unrelated fork',
				endTime: await mockWindow.getTime(),
			}
			const lateForkQuestionId = getQuestionId(lateForkQuestionData, outcomes)
			await createQuestion(attackerClient, lateForkQuestionData, outcomes)
			await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(attackerClient, genesisUniverse, lateForkQuestionId)

			strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'late unrelated fork should not erase finalized market outcome')
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'late unrelated Zoltar fork should not initiate this security pool fork')
			const walletRepBeforeClaims = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should still complete after the unrelated fork')

			await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
			const walletRepAfterEscrowSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)
			const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

			strictEqualTypeSafe(vaultAfterRedeem.repDepositShare, 0n, 'rep redemption should still empty the vault after the unrelated fork')
			strictEqualTypeSafe(vaultAfterRedeem.repInEscalationGame, 0n, 'rep redemption should leave no escrowed REP after the unrelated fork')
			strictEqualTypeSafe(walletRepAfterEscrowSettlement - walletRepBeforeClaims, reportBond, 'escrow settlement should return locked REP after the unrelated fork')
			strictEqualTypeSafe(walletRepAfterRedeem - walletRepAfterEscrowSettlement, repDeposit - reportBond, 'rep redemption should return vault-held REP after the unrelated fork')
		})
	})

	describe('multi-pool and scalar share migration', () => {
		test('two security pools with disagreement', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const openInterestAmount = 10n * 10n ** 18n
			const openInterestArray = [openInterestAmount, openInterestAmount, openInterestAmount]
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n

			const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
			const burnAmount = zoltarForkThreshold / 5n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
			assert.ok(repBalanceInGenesisPool > 0n, 'genesis pool should contain rep before the fork')
			assert.ok((await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)) > 0n, 'security bond allowance should be non-zero')
			strictEqual18Decimal(await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool), repBalanceInGenesisPool * PRICE_PRECISION, 'Pool ownership denominator should equal `pool balance * PRICE_PRECISION` prior fork')

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			assert.deepStrictEqual(await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Did not create enough complete sets')
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkParentCollateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			// we migrate to yes
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const yesPoolBalance = await getERC20Balance(client, await getRepToken(client, yesSecurityPool.securityPool), yesSecurityPool.securityPool)
			assert.ok((await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare)) > 0n, 'the yes-side vault should still retain a positive unlocked child REP claim')
			const migratedRepInYes = await getMigratedRep(client, yesSecurityPool.securityPool)
			assert.ok(migratedRepInYes > 0n, 'yes pool should track migrated REP')
			assert.ok(migratedRepInYes < yesPoolBalance, 'migrated rep should stay below the full child REP balance when escrow payouts are carved out separately')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'yes is finalized')
			assert.ok((await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)) > 0n, 'yes child should retain some child-universe REP after migration')

			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'yes security pool exist')
			const feesOwed = (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)) + (await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool))

			// attacker migrated to No
			const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
			const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
			strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'finalized as no')
			const migratedRepInNo = await getMigratedRep(client, noSecurityPool.securityPool)
			assert.ok(migratedRepInNo > 0n, 'the no-side child should track some migrated REP')
			assert.ok((await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool)) > 0n, 'no child should retain some child-universe REP after migration')
			const parentEth = await getETHBalance(client, securityPoolAddresses.securityPool)
			const yesEth = await getETHBalance(client, yesSecurityPool.securityPool)
			const noEth = await getETHBalance(client, noSecurityPool.securityPool)
			const parentFees = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
			const yesFees = await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool)
			const noFees = await getTotalFeesOwedToVaults(client, noSecurityPool.securityPool)
			assert.ok(parentEth + yesEth + noEth >= parentFees + yesFees + noFees, 'forked ETH should stay sufficient to cover the remaining fee liabilities across all pools')

			// invalid, no one migrated here
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid) // no one migrated, we need to create the universe as rep holders did not
			const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
			const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)

			assert.deepStrictEqual(
				await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])),
				openInterestArray.map(x => x - feesOwed),
				'Shares exist after fork',
			)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			const getCurrentOpenInterestArray = async (): Promise<[bigint, bigint, bigint]> => {
				const currentFees = (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)) + (await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool))
				const result = openInterestArray.map(x => x - currentFees) as [bigint, bigint, bigint]
				return result
			}

			// auction yes
			const poolRepAtFork = ownForkRepBuckets.vaultRepAtFork
			const auctionedEthInYes = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInYes) / poolRepAtFork
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			let yesAuctionTick: bigint | undefined
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				approximatelyEqual(await getEthRaiseCap(client, yesSecurityPool.truthAuction), auctionedEthInYes, 10n, 'Need to buy half of open interest on yes')
				yesAuctionTick = await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, poolRepAtFork / 4n, auctionedEthInYes)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			// auction no
			const auctionedEthInNo = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInNo) / poolRepAtFork
			await startTruthAuction(client, noSecurityPool.securityPool)
			const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			let noAuctionTick: bigint | undefined
			if ((await getSystemState(client, noSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				approximatelyEqual(await getEthRaiseCap(client, noSecurityPool.truthAuction), auctionedEthInNo, 10n, 'Need to buy half of open interest on no')
				noAuctionTick = await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, (poolRepAtFork * 3n) / 4n, auctionedEthInNo)
			} else {
				strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'no child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchased(client, noSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			// auction invalid
			await startTruthAuction(client, invalidSecurityPool.securityPool)
			const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
			let invalidAuctionTick: bigint | undefined
			if ((await getSystemState(client, invalidSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				approximatelyEqual(await getEthRaiseCap(client, invalidSecurityPool.truthAuction), ownForkParentCollateralAtFork, 10n, 'Need to buy all of open interest on invalid')
				invalidAuctionTick = await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, poolRepAtFork - burnAmount - poolRepAtFork / 1_000_000n, ownForkParentCollateralAtFork)
			} else {
				strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'invalid child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchased(client, invalidSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			await mockWindow.advanceTime(7n * DAY + DAY)

			// yes status: auction fully funds, 1/4 of rep balance is sold for eth
			if (yesAuctionTick !== undefined) {
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			const actualShares = await balanceOfSharesInCash(client, yesSecurityPool.securityPool, yesSecurityPool.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualShares.length, 3, 'should have 3 outcomes')
			const yesChildCollateral = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			actualShares.forEach((value, idx) => approximatelyEqual(value, yesChildCollateral, 1000000000000000n, `share ${idx} should approximately equal the current yes child collateral`))

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
			let yesAuctionParticipantRep = 0n
			if (yesAuctionTick !== undefined) {
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address, [{ tick: yesAuctionTick, bidIndex: 0n }])
				const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
				yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repDepositShare)
				const yesClearingPrice = tickToPrice(yesAuctionTick)
				const expectedYesRep = (auctionedEthInYes * 1_000_000_000_000_000_000n) / yesClearingPrice
				approximatelyEqual(yesAuctionParticipantRep, expectedYesRep, 1_000n, 'yes auction participant should get expected REP')
			}

			const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const originalYesVaultRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalYesVault.repDepositShare)
			assert.ok(originalYesVaultRep > yesAuctionParticipantRep, 'original yes vault holder should retain the majority of REP ownership after the auction')
			strictEqualTypeSafe((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).repDepositShare, 0n, 'attacker should have zero as they did not migrate to yes')

			const balancePriorYesRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, yesSecurityPool.securityPool)
			const currentShares = await getCurrentOpenInterestArray()
			const actualSharesAfterRedeem = await balanceOfSharesInCash(client, yesSecurityPool.securityPool, securityPoolAddresses.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualSharesAfterRedeem[1], 0n, 'share1 should be zero')
			assert.strictEqual(actualSharesAfterRedeem[2], 0n, 'non-winning no shares should be worthless after the only winning claimant redeems')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorYesRedeemal + yesChildCollateral, 10n ** 15n, 'did not gain eth after redeeming yes shares')

			// no status: auction fully funds, 3/4 of rep balance is sold for eth
			if (noAuctionTick !== undefined) {
				await finalizeTruthAuction(client, noSecurityPool.securityPool)
			}
			const actualNoShares = await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
			const noChildCollateral = await getCompleteSetCollateralAmount(client, noSecurityPool.securityPool)
			approximatelyEqual(actualNoShares[0], noChildCollateral, noChildCollateral, 'no share0 should be approximately expected')
			approximatelyEqual(actualNoShares[1], noChildCollateral, noChildCollateral, 'no share1 should be approximately expected')
			approximatelyEqual(actualNoShares[2], noChildCollateral, noChildCollateral, 'no share2 should be approximately expected')

			strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')

			// Read purchasedRep for no auction participant

			if (noAuctionTick !== undefined) {
				await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address, [{ tick: noAuctionTick, bidIndex: 0n }])
				const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
				const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repDepositShare)
				const noClearingPrice = tickToPrice(noAuctionTick)
				const expectedNoRep = (auctionedEthInNo * 1_000_000_000_000_000_000n) / noClearingPrice
				approximatelyEqual(noAuctionParticipantRep, expectedNoRep, 1_000n, 'no auction participant should get expected REP')
			}

			const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
			const originalNoVaultRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, originalNoVault.repDepositShare)
			approximatelyEqual(originalNoVaultRep, (repBalanceInGenesisPool * 1n) / 4n - burnAmount, repBalanceInGenesisPool, 'original no vault holder should hold rest 1/4 of rep')
			strictEqualTypeSafe((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).repDepositShare, 0n, 'client should have zero as they did not migrate to no')
			const balancePriorNoRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, noSecurityPool.securityPool)
			const actualNoSharesAfterRedeem = await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualNoSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualNoSharesAfterRedeem[1], 0n, 'non-winning yes shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualNoSharesAfterRedeem[2], 0n, 'no after redeem share2 should be zero')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorNoRedeemal + noChildCollateral, openInterestAmount, 'did not gain eth after redeeming no shares')

			// invalid status: auction 3/4 funds for all REP (minus 1/100 000). Open interest holders lose 50%
			if (invalidAuctionTick !== undefined) {
				await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
			}
			const actualInvalidShares = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
			const invalidChildCollateral = await getCompleteSetCollateralAmount(client, invalidSecurityPool.securityPool)
			approximatelyEqual(actualInvalidShares[0], invalidChildCollateral, invalidChildCollateral, 'invalid share0 should match')
			approximatelyEqual(actualInvalidShares[1], invalidChildCollateral, invalidChildCollateral, 'invalid share1 should match')
			approximatelyEqual(actualInvalidShares[2], invalidChildCollateral, invalidChildCollateral, 'invalid share2 should match')
			strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')

			// Read purchasedRep for invalid auction participant

			if (invalidAuctionTick !== undefined) {
				await claimAuctionProceeds(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address, [{ tick: invalidAuctionTick, bidIndex: 0n }])
				const invalidAuctionParticipantVault = await getSecurityVault(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)
				const invalidAuctionParticipantRep = await poolOwnershipToRep(client, invalidSecurityPool.securityPool, invalidAuctionParticipantVault.repDepositShare)
				const invalidClearingPrice = tickToPrice(invalidAuctionTick)
				const expectedInvalidRep = (ownForkParentCollateralAtFork * 1_000_000_000_000_000_000n) / invalidClearingPrice
				approximatelyEqual(invalidAuctionParticipantRep, expectedInvalidRep, 1_000n, 'invalid auction participant should get expected REP')
			}

			// try creating new complete sets
			const openInterestHolder2 = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			const additionalInvalidCompleteSetAmount = ensureDefined(currentShares[0], 'currentShares[0] is undefined')
			if (additionalInvalidCompleteSetAmount > 0n) {
				await createCompleteSet(openInterestHolder2, invalidSecurityPool.securityPool, additionalInvalidCompleteSetAmount)
			}

			const balancePriorInvalidRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, invalidSecurityPool.securityPool)
			const actualInvalidSharesAfterRedeem1 = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualInvalidSharesAfterRedeem1[0], 0n, 'redeeming invalid shares should consume the winning invalid leg')
			assert.ok(actualInvalidSharesAfterRedeem1[1] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
			assert.ok(actualInvalidSharesAfterRedeem1[2] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorInvalidRedeemal + invalidChildCollateral, openInterestAmount * 1000n, 'did not gain eth after redeeming invalid shares')

			if (additionalInvalidCompleteSetAmount > 0n) {
				const balancePriorInvalidRedeemal2 = await getETHBalance(client, addressString(TEST_ADDRESSES[4]))
				await redeemShares(openInterestHolder2, invalidSecurityPool.securityPool)
				const actualInvalidSharesAfterRedeem2 = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[4]))
				assert.strictEqual(actualInvalidSharesAfterRedeem2[0], 0n, 'redeeming invalid shares should consume the winning invalid leg for the second holder as well')
				assert.ok((await getETHBalance(client, addressString(TEST_ADDRESSES[4]))) > balancePriorInvalidRedeemal2, 'redeeming invalid shares should increase the second holder ETH balance')
			}
		})

		test('can migrate shares into arbitrary scalar child universes after an external scalar fork', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const scalarForkQuestion = {
				title: 'scalar fork',
				description: '',
				startTime: 0n,
				endTime: await mockWindow.getTime(),
				numTicks: 10n,
				displayValueMin: 0n,
				displayValueMax: 10n,
				answerUnit: 'km',
			}
			const scalarQuestionId = getQuestionId(scalarForkQuestion, [])

			await createQuestion(client, scalarForkQuestion, [])
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, openInterestAmount)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, scalarQuestionId)

			const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
			const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
			const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
			const holderAddress = addressString(TEST_ADDRESSES[2])
			const parentBalancesBeforeMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			const parentYesBalance = ensureDefined(parentBalancesBeforeMigration[1], 'parent yes balance is undefined')

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, sortedScalarOutcomes)

			const parentBalancesAfterMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			strictEqualTypeSafe(parentBalancesAfterMigration[1], 0n, 'parent yes shares should be burned after migration')

			const lowScalarUniverse = getChildUniverseId(genesisUniverse, lowScalarOutcome)
			const lowScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, lowScalarUniverse, holderAddress)
			strictEqualTypeSafe(lowScalarBalances[0], 0n, 'invalid shares should stay at zero in the low scalar child universe')
			strictEqualTypeSafe(lowScalarBalances[1], parentYesBalance, 'yes shares should migrate into the low scalar child universe')
			strictEqualTypeSafe(lowScalarBalances[2], 0n, 'no shares should stay at zero in the low scalar child universe')

			const highScalarUniverse = getChildUniverseId(genesisUniverse, highScalarOutcome)
			const highScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, highScalarUniverse, holderAddress)
			strictEqualTypeSafe(highScalarBalances[0], 0n, 'invalid shares should stay at zero in the high scalar child universe')
			strictEqualTypeSafe(highScalarBalances[1], parentYesBalance, 'yes shares should migrate into the high scalar child universe')
			strictEqualTypeSafe(highScalarBalances[2], 0n, 'no shares should stay at zero in the high scalar child universe')
		})

		test('rejects malformed, duplicate, and unsorted share migration target outcomes', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const scalarForkQuestion = {
				title: 'scalar fork',
				description: '',
				startTime: 0n,
				endTime: await mockWindow.getTime(),
				numTicks: 10n,
				displayValueMin: 0n,
				displayValueMax: 10n,
				answerUnit: 'km',
			}
			const scalarQuestionId = getQuestionId(scalarForkQuestion, [])

			await createQuestion(client, scalarForkQuestion, [])
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, openInterestAmount)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, scalarQuestionId)

			const holderAddress = addressString(TEST_ADDRESSES[2])
			const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
			const validScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
			const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
			const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
			const parentBalancesBeforeFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			const parentYesBalance = ensureDefined(parentBalancesBeforeFailedMigrations[1], 'parent yes balance is undefined')

			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [5n]), /target outcome is malformed/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome, validScalarOutcome]), /strictly increasing order/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [...sortedScalarOutcomes].reverse()), /strictly increasing order/)

			const parentBalancesAfterFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			strictEqualTypeSafe(parentBalancesAfterFailedMigrations[1], parentYesBalance, 'failed migrations should preserve the parent yes share balance')
		})

		test('can fork zero rep pools', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)
			strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
			approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
			approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance + repDeposit, 100n, 'Did not get rep back')

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration needs to start')
			const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(migratedRep, 0n, 'correct amount rep migrated')
			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), 0n, 'child contract did not record the amount correctly')
		})
	})

	describe('child pool recovery', () => {
		test('redeemRep removes redeemed ownership from the child pool denominator once the child pool is operational', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
			const attackerClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)
			const denominatorBeforeRedeem = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)

			await redeemRep(client, yesSecurityPool.securityPool, client.account.address)

			const clientVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const denominatorAfterRedeem = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
			const attackerClaimAfterRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)

			strictEqualTypeSafe(clientVaultAfterRedeem.repDepositShare, 0n, 'redeeming a vault should zero out its child-pool ownership')
			assert.ok(denominatorAfterRedeem <= denominatorBeforeRedeem, 'redeeming a vault should not increase the child pool denominator')
			approximatelyEqual(attackerClaimAfterRedeem, attackerClaimBeforeRedeem, 10n, 'redeeming another vault should preserve the remaining vault claim up to rounding')
			await assert.rejects(redeemRep(client, yesSecurityPool.securityPool, client.account.address), /No redeemable REP/)
		})

		test('parent pool halts on fork while a migrated child can resume operational flows', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'parent pool should enter PoolForked after the universe fork is activated')
			await assert.rejects(depositRep(client, securityPoolAddresses.securityPool, 1n), /Universe forked|Forked/)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
			const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
				await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational once migration and truth-auction processing finish')

			const childVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok(childVaultBeforeRedeem.repDepositShare > 0n, 'child migration should create redeemable vault ownership')
			await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
			const childVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(childVaultAfterRedeem.repDepositShare, 0n, 'operational child pool should allow redeemed ownership to clear')
		})

		test('child pool complete-set minting waits for settled fork accounting', async () => {
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const parentAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, parentAllowance)
			const parentMintAmount = 5n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, parentMintAmount)

			await triggerExternalForkForSecurityPool(undefined, 'complete-set child mint fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should wait in migration state before accounting is settled')
			await assert.rejects(createCompleteSet(client, yesSecurityPool.securityPool, 1n), /Pool not operational|Pool inactive/)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'partially migrated child pool should price unsettled accounting through a truth auction')
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
			const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
			strictEqualTypeSafe(expectedEthToBuy > 0n, true, 'partial migration should leave ETH for the truth auction to buy')
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational after truth-auction accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.None, 'unrelated fork should leave the child pool question unresolved')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool), parentAllowance, 'child pool should inherit parent security-bond capacity before minting new sets')

			const childMintAmount = 1n * 10n ** 18n
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const childCollateralBeforeMint = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeMint = await getShareTokenSupply(client, yesSecurityPool.securityPool)

			await createCompleteSet(client, yesSecurityPool.securityPool, childMintAmount)

			const childCollateralAfterMint = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			assert.ok(childCollateralAfterMint > childCollateralBeforeMint, 'child complete-set mint should increase collateral after fork accounting is settled')
			assert.ok(childCollateralAfterMint <= childCollateralBeforeMint + childMintAmount, 'child complete-set mint should accrue fees before adding new collateral')
			const updatedCollateralBeforeMint = childCollateralAfterMint - childMintAmount
			const expectedMintedShares = updatedCollateralBeforeMint === 0n ? childMintAmount * PRICE_PRECISION : (childMintAmount * childShareSupplyBeforeMint) / updatedCollateralBeforeMint
			strictEqualTypeSafe(await getShareTokenSupply(client, yesSecurityPool.securityPool), childShareSupplyBeforeMint + expectedMintedShares, 'child complete-set mint should add shares at the settled exchange rate')
		})

		test('child pool blocks complete-set minting when migrated shares have no collateral', async () => {
			const parentAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, parentAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const parentMintAmount = 10n * 10n ** 18n
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, parentMintAmount)

			await triggerExternalForkForSecurityPool(undefined, 'zero-collateral child complete-set fork source')
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should be operational after fork accounting settles')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), 0n, 'test setup requires a zero-collateral child')
			strictEqualTypeSafe(await getShareTokenSupply(client, yesSecurityPool.securityPool), parentMintAmount * PRICE_PRECISION, 'test setup requires migrated child complete-set shares')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool), parentAllowance, 'test setup requires inherited mint capacity')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const childCollateralBeforeFailedMint = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeFailedMint = await getShareTokenSupply(client, yesSecurityPool.securityPool)
			const childMintRejected = await newMinter
				.simulateContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					functionName: 'createCompleteSet',
					address: yesSecurityPool.securityPool,
					args: [],
					account: newMinter.account,
					value: 1n * 10n ** 18n,
				})
				.then(
					() => false,
					error => {
						if (!(error instanceof Error)) throw error
						return true
					},
				)
			strictEqualTypeSafe(childMintRejected, true, 'zero-collateral child should reject new complete-set minting')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), childCollateralBeforeFailedMint, 'failed child mint should not add collateral')
			strictEqualTypeSafe(await getShareTokenSupply(client, yesSecurityPool.securityPool), childShareSupplyBeforeFailedMint, 'failed child mint should not mint shares')
		})

		test('can migrate escalation deposits before migrateVault', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const parentVaultBeforeEscalationMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeEscalationMigration = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const migratedRepBeforeEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const yesVaultRepAfterEscalationMigration = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare)
			const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const walletRepAfterEscalationMigration = await getERC20Balance(client, yesChildRepToken, client.account.address)

			assert.ok(migratedRep > 0n, 'some REP should be tracked as migrated')
			assert.ok(migratedRep >= migratedRepBeforeEscalation, 'later vault migration should not reduce child migrated REP accounting')
			assert.ok(walletRepAfterEscalationMigration > walletRepBeforeEscalationMigration, 'own-fork escalation migration should pay child REP directly to the wallet')
			assert.ok(parentVaultAfterMigration.repInEscalationGame < parentVaultBeforeEscalationMigration.repInEscalationGame, 'migrating a winning escalation deposit should reduce the parent escalation escrow')
			assert.ok(yesVault.repDepositShare > 0n, 'vault migration should still create child ownership for the unlocked pool REP')
			assert.ok(yesVaultRepAfterEscalationMigration > 0n, 'vault migration should create a child-pool claim from unlocked pool REP')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repDepositShare, 0n, 'parent vault should be emptied after migration')
		})
	})

	describe('vault and REP migration', () => {
		test('createChildUniverse allows the exact external-fork migration deadline and rejects one second later', async () => {
			await triggerExternalForkForSecurityPool(undefined, 'external child creation deadline source')
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			strictEqualTypeSafe(await getRepToken(client, yesSecurityPool.securityPool), getRepTokenAddress(yesUniverse), 'createChildUniverse should still deploy the requested child branch at the inclusive external-fork deadline')

			await mockWindow.setTime(migrationDeadline)
			await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No), /(Migration closed|Own-fork window closed)/i)
		})

		test('createChildUniverse allows the exact own-fork migration deadline and rejects one second later', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			strictEqualTypeSafe(await getRepToken(client, yesSecurityPool.securityPool), getRepTokenAddress(yesUniverse), 'createChildUniverse should still deploy the requested own-fork child branch at the inclusive migration deadline')

			await mockWindow.setTime(migrationDeadline)
			await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No), /(Migration closed|Own-fork window closed)/i)
		})

		test('migrateShares allows the exact migration deadline and rejects one second later', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, openInterestAmount)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await triggerExternalForkForSecurityPool(undefined, 'share migration deadline source')
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY

			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

			const migratedYesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const migratedYesBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, migratedYesUniverse, openInterestHolder.account.address)
			assert.ok(ensureDefined(migratedYesBalances[1], 'migrated yes balance missing') > 0n, 'share migration should still succeed at the inclusive deadline')

			await mockWindow.setTime(migrationDeadline)

			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.No]), /migration window closed/i)
		})

		test('migrateRepToZoltar should fund an already-created child pool with the unlocked vault REP in own-fork mode', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			const unlockedVaultRepAtFork = ownForkRepBuckets.vaultRepAtFork

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const childRepToken = getRepTokenAddress(yesUniverse)
			const forkerBalance = await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker)
			const childPoolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)

			strictEqualTypeSafe(forkerBalance, 0n, 'forker should not retain child REP after migrating to an already-created child pool')
			strictEqualTypeSafe(childPoolBalance, unlockedVaultRepAtFork, 'child pool should receive only the unlocked vault REP in own-fork mode')
		})

		test('migrateRepToZoltar rejects after the migration window closes', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const migrationDeadline = (await mockWindow.getTime()) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline + 1n)

			await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /closed/i)
		})

		test('migrateRepToZoltar allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const childRepToken = getRepTokenAddress(yesUniverse)
			const poolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			assert.ok(poolBalance > 0n, 'migrateRepToZoltar should still split child REP at the inclusive migration deadline')
		})

		test('migrateRepToZoltar rejects once the child branch is already priced', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			await mockWindow.setTime((await mockWindow.getTime()) + 60n * DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /Child closed/)
		})

		test('migrateVault preserves escalation migration state', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const winningDeposit = repDeposit / 2n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])
			const vaultAfterEscalationMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(vaultAfterEscalationMigration.repDepositShare, 0n, 'own-fork escalation claims should not mint child ownership')
			strictEqualTypeSafe(vaultAfterEscalationMigration.securityBondAllowance, 0n, 'claiming own-fork escalation should not migrate the parent bond allowance')

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const vaultAfterVaultMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok(vaultAfterVaultMigration.repDepositShare > 0n, 'migrateVault should populate child ownership from the unlocked parent vault state')
			strictEqualTypeSafe(vaultAfterVaultMigration.securityBondAllowance, securityPoolAllowance, 'migrateVault should preserve the already-migrated parent bond allowance')
		})

		test('migrateVault allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok(childVault.repDepositShare > 0n, 'migrateVault should still migrate ownership at the inclusive deadline')
		})

		test('migrateVault allows the exact external-fork migration deadline and rejects one second later', async () => {
			const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(parentVaultBeforeFork.repDepositShare > 0n, 'test setup should leave unlocked parent vault ownership before the external fork')
			await triggerExternalForkForSecurityPool(undefined, 'external vault migration deadline source')

			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok(childVault.repDepositShare > 0n, 'migrateVault should still move unlocked vault ownership at the inclusive external-fork deadline')

			await mockWindow.setTime(migrationDeadline + 1n)
			await assert.rejects(migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes), /migration window closed/i)
		})

		test('migrateVault transfers unlocked REP collateral for non-own forks', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const collateralAmount = 1n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, collateralAmount)

			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const forkSourceData = {
				...questionData,
				title: 'non-own fork collateral source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceData, outcomes)
			await createQuestion(attackerClient, forkSourceData, outcomes)
			await mockWindow.setTime(forkSourceData.endTime + 1n)
			await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(attackerClient, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'this should be a non-own fork')

			const vaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const parentDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
			const parentCollateralBefore = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const migratedRepExpected = (vaultBeforeMigration.repDepositShare * forkData.auctionableRepAtFork) / parentDenominator
			const expectedCollateralTransfer = (parentCollateralBefore * migratedRepExpected) / forkData.auctionableRepAtFork
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const parentEthBefore = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthBefore = await getETHBalance(client, yesSecurityPool.securityPool)

			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentEthAfter = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthAfter = await getETHBalance(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(parentEthBefore - parentEthAfter, expectedCollateralTransfer, 'unlocked vault migration should transfer ETH collateral from parent to child')
			strictEqualTypeSafe(childEthAfter - childEthBefore, expectedCollateralTransfer, 'unlocked vault migration should fund the child with the transferred ETH collateral')
		})

		test('migrateVault transfers unlocked REP collateral for own forks', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 2n * 10n ** 18n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 2n * 10n ** 18n)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const parentEthBeforeMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentEthAfterMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			assert.ok(parentEthAfterMigration < parentEthBeforeMigration, 'own-fork unlocked migration should transfer collateral out of the parent')
			strictEqualTypeSafe(parentEthBeforeMigration - parentEthAfterMigration, childEthAfterMigration - childEthBeforeMigration, 'own-fork unlocked migration should move matching collateral into the child')
		})

		test('own-fork unlocked vault migration values child ownership against the vault REP bucket', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 4n * forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)

			const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const parentDenominatorBeforeFork = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(ownForkRepBuckets.vaultRepAtFork > 0n, 'test setup should leave unlocked vault REP at fork')
			assert.ok(ownForkRepBuckets.unallocatedEscrowChildRep > 0n, 'test setup should include separate escalation REP at fork')
			const expectedChildRepClaim = (parentVaultBeforeFork.repDepositShare * ownForkRepBuckets.vaultRepAtFork) / parentDenominatorBeforeFork

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const childRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, childVault.repDepositShare)
			strictEqualTypeSafe(childRepClaim, expectedChildRepClaim, 'child vault ownership should redeem the full migrated vault REP bucket')
		})

		test('own-fork unlocked migration transfers all pool collateral when all vault REP migrates', async () => {
			const collateralAmount = 2n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, collateralAmount)
			await createCompleteSet(client, securityPoolAddresses.securityPool, collateralAmount)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 4n * forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(ownForkRepBuckets.vaultRepAtFork > 0n, 'test setup should leave unlocked vault REP at fork')
			assert.ok(ownForkRepBuckets.unallocatedEscrowChildRep > 0n, 'test setup should include separate escalation REP at fork')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const parentCollateralBeforeMigration = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentCollateralAfterMigration = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			assert.ok(parentCollateralBeforeMigration > 0n, 'test setup should leave collateral available before migration')
			strictEqualTypeSafe(parentCollateralAfterMigration, 0n, 'all remaining pool collateral should leave the parent when all vault REP migrates')
			strictEqualTypeSafe(childEthAfterMigration - childEthBeforeMigration, parentCollateralBeforeMigration, 'the child should receive the full remaining migrated pool collateral')
		})
	})

	describe('own-fork escalation claims', () => {
		test('own-fork closes parent escalation withdrawals and preserves escrowed REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 4n * forkThreshold)
			const originalWinningDeposit = reportBond + 1n
			const originalLosingDeposit = reportBond
			const triggerWinningDeposit = forkThreshold - originalWinningDeposit
			const triggerLosingDeposit = forkThreshold - originalLosingDeposit

			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, originalWinningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, originalLosingDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, triggerWinningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, triggerLosingDeposit)

			const clientVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const attackerVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const clientVaultAfterFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const attackerVaultAfterFork = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

			await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Pool inactive/)
			await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n]), /Pool inactive/)

			const clientVaultAfterFailedWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const attackerVaultAfterFailedWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

			strictEqualTypeSafe(clientVaultAfterFork.repInEscalationGame, clientVaultBeforeFork.repInEscalationGame, 'the own-fork transition should preserve the fully locked winning-side parent REP before any claim or migration succeeds')
			strictEqualTypeSafe(attackerVaultAfterFork.repInEscalationGame, attackerVaultBeforeFork.repInEscalationGame, 'the losing-side vault lock should stay in the parent through the own-fork transition')
			strictEqualTypeSafe(clientVaultAfterFailedWithdrawal.repInEscalationGame, clientVaultAfterFork.repInEscalationGame, 'a blocked parent withdrawal should not release any winning-side REP after the own-fork closes the pool')
			strictEqualTypeSafe(attackerVaultAfterFailedWithdrawal.repInEscalationGame, attackerVaultAfterFork.repInEscalationGame, 'a blocked parent withdrawal should not release any losing-side REP after the own-fork closes the pool')
		})

		test('claimForkedEscalationDeposits rejects unresolved deposits after an unrelated external fork', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 10n)

			const forkSourceQuestionData = {
				...questionData,
				title: 'external fork source question for unresolved escalation migration',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		})

		test('claimForkedEscalationDeposits pays own-fork child REP to the wallet without pool ownership', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 2n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migratedBeforeEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
			const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const childCollateralBeforeEscalation = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)

			const claimHash = await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const walletRepAfterEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const migratedAfterEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
			const childCollateralAfterEscalation = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			const claimReceipt = await client.getTransactionReceipt({ hash: claimHash })
			const claimLog = claimReceipt.logs
				.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'ClaimForkedEscalationDepositsToWallet')
			if (claimLog === undefined) throw new Error('ClaimForkedEscalationDepositsToWallet log missing')
			const parentGameClaimLogs = claimReceipt.logs
				.filter(log => log.address.toLowerCase() === parentEscalationGame.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.filter(log => log.eventName === 'ClaimDeposit')
			const sourceRepClaimedFromGame = parentGameClaimLogs.reduce((total, log) => total + log.args.amountToWithdraw, 0n)

			strictEqualTypeSafe(migratedAfterEscalation, migratedBeforeEscalation, 'own-fork escalation claim should not increase child pool migrated REP accounting')
			strictEqualTypeSafe(parentVaultBeforeMigration.repInEscalationGame - parentVaultAfterMigration.repInEscalationGame, 2n * winningDeposit, 'migration should clear exactly the winning deposits principal from the parent escalation escrow')
			strictEqualTypeSafe(childCollateralAfterEscalation, childCollateralBeforeEscalation, 'own-fork escalation claim should not transfer pool collateral')
			strictEqualTypeSafe(childVaultAfterMigration.repDepositShare, 0n, 'own-fork escalation claim should not mint child pool ownership')
			assert.ok(walletRepAfterEscalation > walletRepBeforeEscalation, 'own-fork escalation claim should pay child REP directly to the wallet')
			strictEqualTypeSafe(parentGameClaimLogs.length, 2, 'own-fork wallet claim should emit one parent-game claim log per source deposit')
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.depositor.toLowerCase()),
				[client.account.address.toLowerCase(), client.account.address.toLowerCase()],
				'parent-game claim logs should identify the source vault',
			)
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.outcome),
				[BigInt(QuestionOutcome.Yes), BigInt(QuestionOutcome.Yes)],
				'parent-game claim logs should identify the claimed outcome',
			)
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.parentDepositIndex),
				[0n, 1n],
				'parent-game claim logs should identify each source deposit index',
			)
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.originalDepositAmount),
				[winningDeposit, winningDeposit],
				'parent-game claim logs should include each source principal',
			)
			assert.ok(
				parentGameClaimLogs.every(log => log.args.transferredRep === false),
				'own-fork source claims should leave parent REP in the game',
			)
			strictEqualTypeSafe(claimLog.args.parent.toLowerCase(), securityPoolAddresses.securityPool.toLowerCase(), 'claim log should identify the parent pool')
			strictEqualTypeSafe(claimLog.args.vault.toLowerCase(), client.account.address.toLowerCase(), 'claim log should identify the paid vault')
			strictEqualTypeSafe(claimLog.args.outcomeIndex, BigInt(QuestionOutcome.Yes), 'claim log should identify the winning outcome')
			assert.deepStrictEqual([...claimLog.args.depositIndexes], [0n, 1n], 'claim log should identify the claimed deposit indexes')
			strictEqualTypeSafe(claimLog.args.sourceRepClaimed, sourceRepClaimedFromGame, 'claim log should report the source REP claimed from the parent game')
			strictEqualTypeSafe(claimLog.args.walletRepPaid, walletRepAfterEscalation - walletRepBeforeEscalation, 'claim log should report the child REP paid to the wallet')
			strictEqualTypeSafe(claimLog.args.ownFork, true, 'claim log should mark own-fork wallet payouts')
		})

		test('claimForkedEscalationDeposits uses the claim outcome when paying own-fork wallet REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit * 5n
			await approveAndDepositRep(client, repDeposit * 10n, questionId)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
			const parentOutcomeIndexSlot = formatStorageSlot(parentForkDataSlot + 15n)
			await mockWindow.addStateOverrides({
				[getInfraContractAddresses().securityPoolForker]: {
					stateDiff: {
						[parentOutcomeIndexSlot]: BigInt(QuestionOutcome.No),
					},
				},
			})

			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(parentForkData.outcomeIndex, BigInt(QuestionOutcome.No), 'storage override should poison the parent fork outcome bucket for the regression')

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const walletRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

			const walletRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
			assert.ok(walletRepAfterClaim > walletRepBeforeClaim, 'own-fork wallet payout should follow the claim outcome even when the parent bucket is poisoned')
		})

		test('claimForkedEscalationDeposits rejects after the own-fork migration window closes', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const claimDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(claimDeadline + 1n)

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /Claim window closed/)
		})

		test('claimForkedEscalationDeposits allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const claimDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(claimDeadline - 1n)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const walletRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)

			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const walletRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
			assert.ok(walletRepAfterClaim > walletRepBeforeClaim, 'claiming at the inclusive deadline should still pay child REP')
		})

		test('claimForkedEscalationDeposits rejects once the child branch is already priced', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should be operational before late claim settlement')

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		})
	})
})
