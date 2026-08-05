import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, type Hash, zeroAddress } from '@zoltar/shared/ethereum'
import { getLiquidationVaultRepBackingToTransfer } from '@zoltar/shared/liquidation'
import { usePeripheralsForkMigrationFixture, type PeripheralsForkMigrationFixture } from './fixture'
import { createCarryProof, SparseNullifierTree } from '../carryProofHelpers'
import { addRepToMigrationBalance, getMigrationRepBalanceAttoRep, getUniverseData, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { queueLiquidationAtForcedPrice } from '../../testSupport/simulator/utils/contracts/peripherals'
import { getQuestionResolution } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getForkActivationTime } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, peripherals_SecurityPool_SecurityPool, peripherals_tokens_ShareToken_ShareToken, ReputationToken_ReputationToken } from '../../types/contractArtifact'
import {
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock,
	test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerMaliciousEventEmitter,
} from '../../types/contractArtifact'

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
		approveAndDepositRepToVault,
		canLiquidate,
		handleOracleReporting,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		deployOriginSecurityPool,
		createQuestion,
		getQuestionId,
		balanceOfShares,
		balanceOfSharesInAttoEth,
		getEthRaiseCapAttoEth,
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
		getMigratedRepAttoRep,
		getOwnForkRepBuckets,
		getQuestionOutcome,
		getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame,
		initiateSecurityPoolFork,
		claimForkedEscalationDeposits,
		migrateRepToZoltar,
		migrateVault,
		migrateVaultWithUnresolvedEscalation,
		getForkedEscrowChildRepByOutcomeAndVault,
		startTruthAuction,
		forkUniverse,
		getRepTokenAddress,
		getTotalTheoreticalSupplyAttoRep,
		getZoltarAddress,
		getZoltarForkThreshold,
		getTotalRepPurchasedAttoRep,
		createCompleteSet,
		depositRepToVault,
		depositToEscalationGame,
		getSettlementCollateralAttoEth,
		getCurrentRetentionRate,
		getAwaitingForkContinuation,
		getTotalRepBackingUnits,
		getRepToken,
		getShareTokenSupplyAttoShares,
		getTotalPoolHeldRepAttoRep,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		getTotalAccruedFees,
		getTotalClaimableVaultFeesAttoEth,
		getTotalCoverageCommitmentAttoEth,
		backingUnitsToAttoRep,
		redeemCompleteSet,
		redeemFees,
		redeemRepFromVault,
		redeemShares,
		attoSharesToAttoEth,
		updateSettlementCollateral,
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
		statoblastSecurityMultiplierBps,
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

	const getMigrationProxyAddress = async () =>
		await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getMigrationProxyAddress',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddresses.securityPool],
		})

	const getOutcomeShareSupplies = async (shareToken: `0x${string}`, universeId: bigint) =>
		await Promise.all(
			[QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No].map(
				async outcome =>
					await client.readContract({
						abi: peripherals_tokens_ShareToken_ShareToken.abi,
						functionName: 'totalSupplyForOutcome',
						address: shareToken,
						args: [universeId, outcome],
					}),
			),
		)

	const getExecutedStagedOperation = async (transactionHash: Hash) => {
		const receipt = await client.waitForTransactionReceipt({ hash: transactionHash })
		for (const log of receipt.logs) {
			if (log.address.toLowerCase() !== securityPoolAddresses.priceOracleManagerAndOperatorQueuer.toLowerCase()) continue
			const decoded = decodeEventLog({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decoded.eventName === 'ExecutedStagedOperation') return decoded
		}
		throw new Error('missing ExecutedStagedOperation log')
	}

	const getTotalBadDebt = async (securityPool: `0x${string}`) =>
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'totalBadDebtAttoEth',
		})

	const getVaultBadDebt = async (securityPool: `0x${string}`, vault: `0x${string}`) =>
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'vaultBadDebtAttoEth',
			args: [vault],
		})

	const assertVaultMigrationPreservesParentFees = async (vaultClient: PeripheralsForkMigrationFixture['client'], migrate: () => Promise<void>) => {
		const beforeMigrationSnapshot = await mockWindow.anvilSnapshot()
		await updateVaultFees(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)
		const expectedParentFees = (await getSecurityVault(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)).claimableFeesAttoEth
		assert.ok(expectedParentFees > 0n, 'test setup should leave whole-attoETH parent fees ready to assign at migration')
		await mockWindow.anvilRevert(beforeMigrationSnapshot)

		await migrate()

		const parentVaultAfterMigration = await getSecurityVault(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)
		strictEqualTypeSafe(parentVaultAfterMigration.coverageCommitmentAttoEth, 0n, 'coverage commitment')
		strictEqualTypeSafe(parentVaultAfterMigration.claimableFeesAttoEth, expectedParentFees, 'coverage commitment')
		strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool), expectedParentFees, 'parent aggregate claimable fees should retain the migrated vaults redeemable fees')
		const parentBalanceAfterMigration = await getETHBalance(vaultClient, securityPoolAddresses.securityPool)
		assert.ok(parentBalanceAfterMigration >= expectedParentFees, `parent must retain enough ETH for checkpointed fees: balance ${parentBalanceAfterMigration}, fees ${expectedParentFees}`)

		const balanceBeforeRedemption = await getETHBalance(vaultClient, vaultClient.account.address)
		await redeemFees(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)
		strictEqualTypeSafe((await getETHBalance(vaultClient, vaultClient.account.address)) - balanceBeforeRedemption, expectedParentFees, 'migrated vault should redeem its checkpointed parent fees')
	}

	describe('child universe and own-fork entry', () => {
		const prefundedRepCases = (() => {
			let state = 0x5eedf00dn
			const nextAmount = () => {
				state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
				return (state % repDeposit) + 1n
			}
			return [{ name: 'one attoREP', amountAttoRep: 1n }, { name: 'maximum corpus amount', amountAttoRep: repDeposit }, ...Array.from({ length: 3 }, (_, index) => ({ name: `seeded fuzz case ${index + 1}`, amountAttoRep: nextAmount() }))]
		})()

		test.each(prefundedRepCases)('external fork initiation isolates prefunded REP for $name', async ({ name, amountAttoRep: prefundedRep }) => {
			const migrationProxyAddress = await getMigrationProxyAddress()
			const parentRepToken = getRepTokenAddress(genesisUniverse)

			assert.ok(!(await contractExists(client, migrationProxyAddress)), 'migration proxy should not exist before fork initiation')
			await transferRepToAddress(client, migrationProxyAddress, prefundedRep)
			strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, migrationProxyAddress), prefundedRep, 'predicted proxy should hold the unsolicited REP before deployment')

			await triggerExternalForkForSecurityPool(undefined, `prefunded proxy ${name}`)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'prefunding must not prevent the parent pool from entering fork mode')
			assert.ok(await contractExists(client, migrationProxyAddress), 'migration proxy should deploy successfully despite the prefund')
			strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, migrationProxyAddress), prefundedRep, 'unsolicited REP should remain isolated as proxy surplus')
			strictEqualTypeSafe(await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxyAddress), forkData.auctionableRepAtForkAttoRep, 'unsolicited REP must not enter the pool migration ledger')
		})

		test.each(prefundedRepCases)('own fork initiation isolates prefunded REP for $name', async ({ amountAttoRep: prefundedRep }) => {
			const migrationProxyAddress = await getMigrationProxyAddress()
			const baselineSnapshot = await mockWindow.anvilSnapshot()
			const baseline = await setupOwnForkWithEscrow()

			await mockWindow.anvilRevert(baselineSnapshot)
			await transferRepToAddress(client, migrationProxyAddress, prefundedRep)
			const prefunded = await setupOwnForkWithEscrow()

			strictEqualTypeSafe(prefunded.forkData.auctionableRepAtForkAttoRep, baseline.forkData.auctionableRepAtForkAttoRep, 'unsolicited REP must not increase own-fork auctionable REP')
			strictEqualTypeSafe(prefunded.ownForkRepBuckets.vaultRepAtForkAttoRep, baseline.ownForkRepBuckets.vaultRepAtForkAttoRep, 'unsolicited REP must not increase vault migration backing')
			strictEqualTypeSafe(prefunded.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, baseline.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, 'unsolicited REP must not increase aggregate escalation carry backing')
			strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(genesisUniverse), migrationProxyAddress), prefundedRep, 'unsolicited REP should remain isolated as proxy surplus after the own fork')
			strictEqualTypeSafe(await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxyAddress), prefunded.forkData.auctionableRepAtForkAttoRep, 'unsolicited REP must not enter the own-fork migration ledger')
		})

		test('allows delayed fork initialization for an escalation game unresolved at the universe fork', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

			const escalationGameEndDate = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getEscalationGameEndDate',
				address: securityPoolAddresses.escalationGame,
				args: [],
			})
			const forkTimeAtResolution = escalationGameEndDate
			const forkSourceQuestionData = {
				...questionData,
				title: 'delayed initialization fork source',
				endTime: forkTimeAtResolution - 1n,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await mockWindow.setTime(forkTimeAtResolution - 1n)
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)

			strictEqualTypeSafe((await getUniverseData(client, genesisUniverse)).forkTime, escalationGameEndDate, 'the external fork should occur exactly at escalation resolution')
			await mockWindow.setTime(escalationGameEndDate + 1n)
			strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'the escalation game should resolve after the universe fork')
			strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.None, 'the local outcome should remain unavailable after a fork-time-unresolved escalation game')
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'delayed initialization should enter fork mode')
			strictEqualTypeSafe((await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).unresolvedEscalationAtFork, true, 'the fork should preserve the unresolved escalation snapshot')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'delayed initialization should leave the child migration recoverable')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).disputeStakedRepAttoRep, 0n, 'unresolved migration should clear the parent escrow lock')
			strictEqualTypeSafe(await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address), 0n, 'optional vault cleanup should not create per-vault child escrow')
			const childYesState = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: yesSecurityPool.escalationGame,
				functionName: 'getOutcomeState',
				args: [QuestionOutcome.Yes],
			})
			strictEqualTypeSafe(childYesState.currentCarryTotalAttoRep, reportBond, 'delayed initialization should preserve the unresolved principal in aggregate carry')
		})

		test('rejects delayed fork initialization for an escalation game resolved before the universe fork', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
			const escalationGameEndDate = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getEscalationGameEndDate',
				address: securityPoolAddresses.escalationGame,
				args: [],
			})
			await mockWindow.setTime(escalationGameEndDate + 1n)
			strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'the escalation game should resolve before the universe fork')

			const forkSourceQuestionData = {
				...questionData,
				title: 'resolved before initialization fork source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)

			await assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Resolved/)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'a pre-fork-resolved game should leave the pool operational')
			strictEqualTypeSafe((await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).unresolvedEscalationAtFork, false, 'a pre-fork-resolved game should not be snapshotted as unresolved')
		})

		test('create child universe test', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, attackerClient.account.address, securityPoolCoverageCommitmentAttoEth)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
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
			const expectedChildAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverseId, questionId, statoblastSecurityMultiplierBps)

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
				settlementCollateralAttoEth: childSettlementCollateralAttoEth,
				currentRetentionRate: childCurrentRetentionRate,
				parent: childParent,
				priceOracleManagerAndOperatorQueuer: childManagerAddress,
				questionId: childStoredQuestionId,
				statoblastSecurityMultiplierBps: childStoredStatoblastSecurityMultiplierBps,
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
			strictEqualTypeSafe(childStoredStatoblastSecurityMultiplierBps, statoblastSecurityMultiplierBps, 'child multiplier should match')
			strictEqualTypeSafe(childCurrentRetentionRate, MAX_RETENTION_RATE, 'child retention rate should match')
			strictEqualTypeSafe(childSettlementCollateralAttoEth, 0n, 'child complete set collateral should default to zero during fork')
			strictEqualTypeSafe(await getLastPrice(client, childManagerAddress), await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 'child manager should inherit the parent price')
		})

		test('forkZoltarWithOwnEscalationGame auto-initiates the pool fork and ignores stray REP already sitting on the forker', async () => {
			const strayRep = 7n * 10n ** 18n

			const { forkData, forkThresholdAttoRep, ownForkRepBuckets, repBalanceAttoRep } = await setupOwnForkWithEscrow(strayRep)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'forkWithOwnEscalationGame should auto-initiate the parent pool fork')
			assert.ok(forkData.auctionableRepAtForkAttoRep > 0n, 'repAtFork should keep a positive child REP anchor after the own-game fork')
			assert.ok(forkData.auctionableRepAtForkAttoRep <= repBalanceAttoRep + forkThresholdAttoRep * 2n, 'repAtFork should stay bounded by the REP that actually participated in the own-game fork')
			strictEqualTypeSafe(ownForkRepBuckets.escrowSourceRepAtForkAttoRep, forkThresholdAttoRep * 2n, 'own-fork source escrow should equal the fork-triggering escalation principal')
			strictEqualTypeSafe(ownForkRepBuckets.vaultRepAtForkAttoRep + ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, forkData.auctionableRepAtForkAttoRep, 'own-fork child REP buckets should partition the full auctionable child REP anchor')
		})

		test('own-fork diagnostics retain the complete escalation backing available to every selected outcome', async () => {
			const { ownForkRepBuckets } = await setupOwnForkWithEscrow()
			const perSelectedOutcomeAttoRep = ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep
			assert.ok(perSelectedOutcomeAttoRep > 0n, 'test setup should have escalation backing for each selected outcome')

			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const afterYesChild = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(afterYesChild.escalationChildRepPerSelectedOutcomeAttoRep, perSelectedOutcomeAttoRep, 'creating one child must not make the diagnostic imply that another outcome lost its backing')

			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)
			const afterNoChild = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(afterNoChild.escalationChildRepPerSelectedOutcomeAttoRep, perSelectedOutcomeAttoRep, 'each selected outcome should independently retain the fork-time escalation backing amount')
			for (const outcome of [QuestionOutcome.Yes, QuestionOutcome.No]) {
				const universe = getChildUniverseId(genesisUniverse, outcome)
				const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, universe, questionId, statoblastSecurityMultiplierBps)
				const childGame = await getSecurityPoolsEscalationGame(client, childPool.securityPool)
				strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(universe), childGame), perSelectedOutcomeAttoRep, 'each created child should receive the complete per-selected-outcome escalation backing')
			}
		})

		test('initiateSecurityPoolFork reverts after the own-game fork and ignores stray REP transferred to the forker', async () => {
			const strayRep = 9n * 10n ** 18n

			const { forkData: forkDataBeforeStrayRep } = await setupOwnForkWithEscrow()
			await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRep)
			await assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Forked/)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 're-initiating after the own-game fork should leave the parent pool in PoolForked')
			strictEqualTypeSafe(forkData.auctionableRepAtForkAttoRep, forkDataBeforeStrayRep.auctionableRepAtForkAttoRep, 'repAtFork should ignore unrelated REP transferred to the forker after the own-game fork')
		})

		test('initiateSecurityPoolFork rejects an unauthorized pool before it can supply a delegate target', async () => {
			const collateral = 5n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, repDeposit / 4n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, collateral)
			await triggerExternalForkForSecurityPool(undefined, 'untrusted fork event emitter attack')

			const maliciousEmitterDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerMaliciousEventEmitter.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerMaliciousEventEmitter.evm.bytecode.object}`,
					args: [securityPoolAddresses.securityPool, addressString(TEST_ADDRESSES[1])],
				}),
			})
			const maliciousEmitterReceipt = await client.waitForTransactionReceipt({ hash: maliciousEmitterDeploymentHash })
			const maliciousEmitter = maliciousEmitterReceipt.contractAddress
			if (maliciousEmitter === undefined || maliciousEmitter === null) throw new Error('malicious event emitter address missing')

			const fakePoolDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.evm.bytecode.object}`,
					args: [genesisUniverse, addressString(GENESIS_REPUTATION_TOKEN), questionId, maliciousEmitter, zeroAddress],
				}),
			})
			const fakePoolReceipt = await client.waitForTransactionReceipt({ hash: fakePoolDeploymentHash })
			const fakePool = fakePoolReceipt.contractAddress
			if (fakePool === undefined || fakePool === null) throw new Error('fake pool address missing')
			const targetBalanceBeforeAttack = await getETHBalance(client, securityPoolAddresses.securityPool)
			const targetCollateralBeforeAttack = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			assert.ok(targetCollateralBeforeAttack > 0n, 'attack target should hold tracked complete-set collateral')

			await assert.rejects(initiateSecurityPoolFork(client, fakePool))

			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), targetBalanceBeforeAttack, 'untrusted delegate target must not drain canonical pool ETH')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), targetCollateralBeforeAttack, 'untrusted delegate target must not change canonical collateral accounting')
		})

		test('initiateSecurityPoolFork rejects a fake pool that borrows a canonical escalation game', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

			const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
			const parentRepToken = getRepTokenAddress(genesisUniverse)
			const gameBalanceBeforeAttack = await getERC20Balance(client, parentRepToken, escalationGame)
			const vaultBeforeAttack = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(gameBalanceBeforeAttack > 0n, 'canonical escalation game should hold participant REP')
			assert.ok(vaultBeforeAttack.disputeStakedRepAttoRep > 0n, 'canonical vault should record escalation escrow')

			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
			const forkQuestionData = {
				...questionData,
				title: 'borrowed escalation game attack fork source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkQuestionId = getQuestionId(forkQuestionData, outcomes)
			await createQuestion(attackerClient, forkQuestionData, outcomes)
			await mockWindow.setTime(forkQuestionData.endTime + 1n)
			await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(attackerClient, genesisUniverse, forkQuestionId)

			const forkerAddress = getInfraContractAddresses().securityPoolForker
			await mockWindow.impersonateAccount(forkerAddress)
			await mockWindow.setBalance(forkerAddress, 10n ** 18n)
			const forkerClient = createWriteClient(mockWindow, BigInt(forkerAddress), 0)
			await assert.rejects(
				writeContractAndWait(forkerClient, () =>
					forkerClient.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'drainAllRep',
						args: [forkerAddress],
					}),
				),
				/revert/,
			)

			const fakePoolDeploymentHash = await attackerClient.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.evm.bytecode.object}`,
					args: [genesisUniverse, addressString(GENESIS_REPUTATION_TOKEN), questionId, zeroAddress, escalationGame],
				}),
			})
			const fakePoolReceipt = await attackerClient.waitForTransactionReceipt({ hash: fakePoolDeploymentHash })
			const fakePool = fakePoolReceipt.contractAddress
			if (fakePool === undefined || fakePool === null) throw new Error('fake pool address missing')

			await assert.rejects(initiateSecurityPoolFork(attackerClient, fakePool), /Escalation game pool/)

			strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, escalationGame), gameBalanceBeforeAttack, 'fake pool must not drain a canonical escalation game')
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'failed attack must leave the canonical pool operational')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).disputeStakedRepAttoRep, vaultBeforeAttack.disputeStakedRepAttoRep, 'failed attack must leave canonical escrow accounting backed')
		})

		test('createChildUniverse rejects fake parents that try to reuse a legitimate pool as the child', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await triggerExternalForkForSecurityPool()

			const targetPool = securityPoolAddresses.securityPool
			const denominatorBeforeAttack = await getTotalRepBackingUnits(client, targetPool)
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
					args: [genesisUniverse, attackFactoryAddress, securityPoolAddresses.shareToken, questionId, statoblastSecurityMultiplierBps, 0n, 0n, attackerChosenDenominator],
				}),
			})
			const fakeParentReceipt = await client.waitForTransactionReceipt({ hash: fakeParentDeploymentHash })
			const fakeParentAddress = fakeParentReceipt.contractAddress
			if (fakeParentAddress === undefined || fakeParentAddress === null) throw new Error('fake parent address missing')

			await assert.rejects(createChildUniverse(client, fakeParentAddress, QuestionOutcome.Yes), /Migration closed|Invalid child/)

			strictEqualTypeSafe(await getTotalRepBackingUnits(client, targetPool), denominatorBeforeAttack, 'attack should not change the legitimate REP backing units denominator')
			strictEqualTypeSafe((await getSecurityPoolForkerForkData(client, targetPool)).truthAuction, targetForkDataBeforeAttack.truthAuction, 'attack should not overwrite the legitimate pool fork metadata')
		})

		test('escalation replay IDs separate factories that report the same origin', async () => {
			const forker = getInfraContractAddresses().securityPoolForker
			const canonicalOriginId = await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				address: getInfraContractAddresses().securityPoolFactory,
				functionName: 'getSecurityPoolOriginId',
				args: [securityPoolAddresses.securityPool],
			})
			const fakeFactoryDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.evm.bytecode.object}`,
					args: [],
				}),
			})
			const fakeFactoryReceipt = await client.waitForTransactionReceipt({ hash: fakeFactoryDeploymentHash })
			const fakeFactory = fakeFactoryReceipt.contractAddress
			if (fakeFactory === undefined || fakeFactory === null) throw new Error('fake escrow factory address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					address: fakeFactory,
					functionName: 'configureOriginId',
					args: [canonicalOriginId],
				}),
			)
			const fakeParentDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.evm.bytecode.object}`,
					args: [addressString(GENESIS_REPUTATION_TOKEN), fakeFactory, securityPoolAddresses.shareToken, forker, genesisUniverse, questionId, statoblastSecurityMultiplierBps],
				}),
			})
			const fakeParentReceipt = await client.waitForTransactionReceipt({ hash: fakeParentDeploymentHash })
			const fakeParent = fakeParentReceipt.contractAddress
			if (fakeParent === undefined || fakeParent === null) throw new Error('fake escrow parent address missing')
			const [canonicalDepositId, fakeDepositId] = await Promise.all(
				[securityPoolAddresses.securityPool, fakeParent].map(
					async pool =>
						await client.readContract({
							abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
							address: forker,
							functionName: 'getEscalationDepositId',
							args: [pool, QuestionOutcome.Yes, 0n],
						}),
				),
			)

			assert.notEqual(fakeDepositId, canonicalDepositId, 'an untrusted factory must not share the canonical replay namespace')
		})

		test('claimForkedEscalationDeposits rejects a fake child that injects a canonical escalation game', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forker = getInfraContractAddresses().securityPoolForker
			const genesisRep = addressString(GENESIS_REPUTATION_TOKEN)
			const forkThresholdAttoRep = await getZoltarForkThreshold(client, genesisUniverse)
			const fakeDisputeStakedRep = forkThresholdAttoRep * 2n
			const expectedDisputeStakedChildRep = fakeDisputeStakedRep - forkThresholdAttoRep / 5n
			const victimDeposit = repDeposit
			const forgedClaim = expectedDisputeStakedChildRep + victimDeposit

			const fakeFactoryDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.evm.bytecode.object}`,
					args: [],
				}),
			})
			const fakeFactoryReceipt = await client.waitForTransactionReceipt({ hash: fakeFactoryDeploymentHash })
			const fakeFactory = fakeFactoryReceipt.contractAddress
			if (fakeFactory === undefined || fakeFactory === null) throw new Error('fake escrow factory address missing')

			const fakeParentDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.evm.bytecode.object}`,
					args: [genesisRep, fakeFactory, securityPoolAddresses.shareToken, forker, genesisUniverse, questionId, statoblastSecurityMultiplierBps],
				}),
			})
			const fakeParentReceipt = await client.waitForTransactionReceipt({ hash: fakeParentDeploymentHash })
			const fakeParent = fakeParentReceipt.contractAddress
			if (fakeParent === undefined || fakeParent === null) throw new Error('fake escrow parent address missing')

			const fakeGameDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock.evm.bytecode.object}`,
					args: [fakeParent, genesisRep, client.account.address, forgedClaim],
				}),
			})
			const fakeGameReceipt = await client.waitForTransactionReceipt({ hash: fakeGameDeploymentHash })
			const fakeGame = fakeGameReceipt.contractAddress
			if (fakeGame === undefined || fakeGame === null) throw new Error('fake escalation game address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi,
					address: fakeParent,
					functionName: 'configureEscalationGame',
					args: [fakeGame],
				}),
			)
			await transferRepToAddress(client, fakeGame, fakeDisputeStakedRep)
			await forkZoltarWithOwnEscalationGame(client, fakeParent)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const childRep = getRepTokenAddress(yesUniverse)
			const victimClient = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveToken(victimClient, genesisRep, getZoltarAddress())
			await addRepToMigrationBalance(victimClient, genesisUniverse, victimDeposit)
			await splitMigrationRep(victimClient, genesisUniverse, victimDeposit, [QuestionOutcome.Yes])
			await deployOriginSecurityPool(victimClient, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const targetPool = getSecurityPoolAddresses(addressString(0n), yesUniverse, questionId, statoblastSecurityMultiplierBps, yesUniverse)
			await approveToken(victimClient, childRep, targetPool.securityPool)
			await depositRepToVault(victimClient, targetPool.securityPool, victimDeposit)
			await depositToEscalationGame(victimClient, targetPool.securityPool, QuestionOutcome.Yes, victimDeposit)
			const targetGame = await getSecurityPoolsEscalationGame(client, targetPool.securityPool)
			strictEqualTypeSafe(await getERC20Balance(client, childRep, targetGame), victimDeposit, 'canonical target game should begin with victim-funded child REP')

			const fakeChildDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.evm.bytecode.object}`,
					args: [fakeParent, fakeFactory, childRep, forker, targetPool.securityPool, targetGame, yesUniverse],
				}),
			})
			const fakeChildReceipt = await client.waitForTransactionReceipt({ hash: fakeChildDeploymentHash })
			const fakeChild = fakeChildReceipt.contractAddress
			if (fakeChild === undefined || fakeChild === null) throw new Error('fake escrow child address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					address: fakeFactory,
					functionName: 'configureChild',
					args: [fakeChild, targetPool.securityPool],
				}),
			)

			const attackerChildRepBefore = await getERC20Balance(client, childRep, client.account.address)
			await assert.rejects(claimForkedEscalationDeposits(client, fakeParent, client.account.address, QuestionOutcome.Yes, [0n]), /Child game/)

			strictEqualTypeSafe(await getERC20Balance(client, childRep, client.account.address), attackerChildRepBefore, 'rejected forged claim must not transfer child REP to the attacker')
			strictEqualTypeSafe(await getERC20Balance(client, childRep, targetGame), victimDeposit, 'rejected forged claim must leave the canonical target game funded')
			strictEqualTypeSafe((await getSecurityVault(client, targetPool.securityPool, victimClient.account.address)).disputeStakedRepAttoRep, victimDeposit, 'rejected forged claim must leave canonical victim escrow accounting backed')

			const deployAlternatingChildGame = async (forkResumedAt: bigint) => {
				const deploymentHash = await client.sendTransaction({
					data: encodeDeployData({
						abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock.abi,
						bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock.evm.bytecode.object}`,
						args: [fakeChild, forkResumedAt],
					}),
				})
				const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
				const game = receipt.contractAddress
				if (game === undefined || game === null) throw new Error('alternating child game address missing')
				return game
			}
			const firstChildGame = await deployAlternatingChildGame(1n)
			const secondChildGame = await deployAlternatingChildGame(0n)
			const validationHarnessDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness.abi,
					bytecode: `0x${test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness.evm.bytecode.object}`,
					args: [getZoltarAddress()],
				}),
			})
			const validationHarnessReceipt = await client.waitForTransactionReceipt({ hash: validationHarnessDeploymentHash })
			const validationHarness = validationHarnessReceipt.contractAddress
			if (validationHarness === undefined || validationHarness === null) throw new Error('child game validation harness address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					address: fakeChild,
					functionName: 'configureOperationalEscalationGames',
					args: [targetGame, firstChildGame],
				}),
			)
			await assert.rejects(
				writeContractAndWait(client, () =>
					client.writeContract({
						abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness.abi,
						address: validationHarness,
						functionName: 'finalizeEscalationStateAfterAuction',
						args: [fakeChild],
					}),
				),
				/Child game/,
			)
			strictEqualTypeSafe(
				await client.readContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					address: fakeChild,
					functionName: 'forkResumeCount',
				}),
				0n,
				'auction finalization must reject a child that switches to a game bound to another pool',
			)
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					address: fakeChild,
					functionName: 'configureOperationalEscalationGames',
					args: [firstChildGame, secondChildGame],
				}),
			)

			await migrateVaultWithUnresolvedEscalation(client, fakeParent, client.account.address, QuestionOutcome.Yes)
			strictEqualTypeSafe(
				await client.readContract({
					abi: test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					address: fakeChild,
					functionName: 'forkResumeCount',
				}),
				0n,
				'combined migration must use the first validated child game after the child changes its getter',
			)
		})
	})

	describe('liquidation and collateral accounting', () => {
		test('a partial liquidation preserves the pool-held vault REP backing reserve and a max request invokes the backstop', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const minimumRepDeposit = 10n * 10n ** 18n
			const targetCoverageCommitmentAttoEth = 2n * 10n ** 18n
			const coverageCommitmentAttoEthPrice = 2n * PRICE_PRECISION
			const liquidationPrice = 6n * PRICE_PRECISION

			await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, minimumRepDeposit)
			await manipulatePriceOracle(targetClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, coverageCommitmentAttoEthPrice)
			const coverageCommitmentAttoEthHash = await requestPriceIfNeededAndStageOperation(targetClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, targetClient.account.address, targetCoverageCommitmentAttoEth)
			const coverageCommitmentAttoEthLog = await getExecutedStagedOperation(coverageCommitmentAttoEthHash)
			assert.strictEqual(coverageCommitmentAttoEthLog.args.success, true, `minimum-REP target coverageCommitmentAttoEth setup failed with ${coverageCommitmentAttoEthLog.args.errorMessage}`)

			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit)
			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const executionHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, targetClient.account.address, 1n * 10n ** 18n)
			const executionLog = await getExecutedStagedOperation(executionHash)

			assert.strictEqual(executionLog.args.success, false, 'a partial liquidation must not consume the minimum pool-held vault REP backing reserve')
			strictEqualTypeSafe(executionLog.args.errorMessage, 'No liq', 'the unfunded partial request should report that no safe transfer exists')

			const backstopHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, targetClient.account.address, targetCoverageCommitmentAttoEth)
			const backstopLog = await getExecutedStagedOperation(backstopHash)
			assert.strictEqual(backstopLog.args.success, true, `max liquidation backstop failed with ${backstopLog.args.errorMessage}`)
			const targetAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			strictEqualTypeSafe(targetAfter.coverageCommitmentAttoEth, 0n, 'coverage commitment')
			assert.ok(liquidatorAfter.coverageCommitmentAttoEth > 0n, 'the liquidator should receive the safely funded coverage commitment slice')
			assert.ok(liquidatorAfter.coverageCommitmentAttoEth < targetCoverageCommitmentAttoEth, 'the liquidator must not receive a coverage commitment whose award is unavailable')
			strictEqualTypeSafe(await getVaultBadDebt(securityPoolAddresses.securityPool, targetClient.account.address), targetCoverageCommitmentAttoEth - liquidatorAfter.coverageCommitmentAttoEth, 'the backstop should record the untransferred residual')
		})

		test('liquidation transfers REP from the target to the liquidator', async () => {
			const securityPoolCoverageCommitmentAttoEth = 75n * 10n ** 18n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const initialPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			assert.ok(initialPrice > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), securityPoolCoverageCommitmentAttoEth, 'coverage commitment')

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			const targetFeesBeforeLiquidation = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).claimableFeesAttoEth
			assert.ok(targetFeesBeforeLiquidation > 0n, 'test setup should accrue fees to the target before liquidation')

			strictEqualTypeSafe(canLiquidate(initialPrice, securityPoolCoverageCommitmentAttoEth, repDeposit, statoblastSecurityMultiplierBps), false, 'Should not be able to liquidate yet')
			// REP/ETH increases to 10x, 10 REP = 1 ETH (rep drops in value)
			const forcedPrice = PRICE_PRECISION * 10n
			const coverageCommitmentTransferAttoEth = 20n * 10n ** 18n
			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, coverageCommitmentTransferAttoEth, forcedPrice)
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
			const totalRepBeforeLiquidation = await getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)
			const denominatorBeforeLiquidation = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
			const quotedRepMove = getLiquidationVaultRepBackingToTransfer(coverageCommitmentTransferAttoEth, forcedPrice)
			const expectedBackingUnitsMove = (quotedRepMove * denominatorBeforeLiquidation + totalRepBeforeLiquidation - 1n) / totalRepBeforeLiquidation
			const expectedRepMove = (expectedBackingUnitsMove * totalRepBeforeLiquidation) / denominatorBeforeLiquidation
			const expectedTargetClaimAfter = ((targetVaultBeforeLiquidation.vaultRepBackingAttoRep - expectedBackingUnitsMove) * totalRepBeforeLiquidation) / denominatorBeforeLiquidation
			const expectedLiquidatorClaimAfter = ((liquidatorVaultBeforeLiquidation.vaultRepBackingAttoRep + expectedBackingUnitsMove) * totalRepBeforeLiquidation) / denominatorBeforeLiquidation
			strictEqualTypeSafe(expectedRepMove, quotedRepMove, 'ceiling backingUnits conversion should preserve the complete quoted award after a pool donation')

			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			const currentPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			strictEqualTypeSafe(currentPrice, PRICE_PRECISION * 10n, 'Price did not increase!')

			strictEqualTypeSafe(canLiquidate(currentPrice, securityPoolCoverageCommitmentAttoEth, repDeposit, statoblastSecurityMultiplierBps), true, 'Should be able to liquidate now')

			const originalVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const originalClaim = await getVaultRepClaim(client.account.address)
			const liquidatorClaim = await getVaultRepClaim(liquidatorClient.account.address)
			strictEqualTypeSafe(originalVault.coverageCommitmentAttoEth, securityPoolCoverageCommitmentAttoEth - coverageCommitmentTransferAttoEth, 'original vault should keep only the non-transferred coverage commitment')
			strictEqualTypeSafe(originalVault.vaultRepBackingAttoRep, targetVaultBeforeLiquidation.vaultRepBackingAttoRep - expectedBackingUnitsMove, 'liquidation should move the share-rounded target backingUnits')
			strictEqualTypeSafe(originalClaim, expectedTargetClaimAfter, 'the target claim should use its exact remaining backingUnits at the live pool rate')
			assert.ok(originalVault.claimableFeesAttoEth >= targetFeesBeforeLiquidation, 'the target should retain every fee accrued before liquidation')
			strictEqualTypeSafe(liquidatorVault.coverageCommitmentAttoEth, coverageCommitmentTransferAttoEth, "liquidator doesn't have the liquidated security pool coverageCommitmentAttoEth")
			strictEqualTypeSafe(liquidatorClaim, expectedLiquidatorClaimAfter, 'the liquidator claim should use its exact resulting backingUnits at the live pool rate')
			strictEqualTypeSafe(liquidatorVault.claimableFeesAttoEth, 0n, 'the liquidator must not receive the targets accrued fees')
		})

		test('liquidation rejects attempts to liquidate the caller vault itself', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = 75n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(100000n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimBefore = await getVaultRepClaim(client.account.address)
			const coverageCommitmentTransferAttoEth = 20n * 10n ** 18n

			await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, coverageCommitmentTransferAttoEth), /Caller bad/)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfter = await getVaultRepClaim(client.account.address)

			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, targetVaultBefore.coverageCommitmentAttoEth, 'same-vault liquidation should not move target coverage commitment')
			strictEqualTypeSafe(targetVaultAfter.vaultRepBackingAttoRep, targetVaultBefore.vaultRepBackingAttoRep, 'same-vault liquidation should not move target backingUnits')
			strictEqualTypeSafe(targetClaimAfter, targetClaimBefore, 'same-vault liquidation should not move target REP')
		})

		test('liquidation quote is invalidated by an additional REP deposit', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = 75n * 10n ** 18n
			// Set the target's coverage commitment
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), securityPoolCoverageCommitmentAttoEth, 'coverage commitment')

			// Create liquidator and deposit rep
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

			// Create open interest
			const openInterestAmount = 50n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			await mockWindow.advanceTime(100000n)

			// Snapshot state before attack (just before queuing liquidation)
			const vaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const snapshotTargetBackingUnits = vaultBefore.vaultRepBackingAttoRep
			const snapshotTotalPoolHeldRepAttoRep = await getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)
			const snapshotTotalRepBackingUnits = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)

			const snapshotExpectedRepDeposit = (snapshotTargetBackingUnits * snapshotTotalPoolHeldRepAttoRep) / snapshotTotalRepBackingUnits

			// Queue liquidation (liquidator requests price to trigger liquidation)
			const forcedPrice = PRICE_PRECISION * 10n
			const coverageCommitmentTransferAttoEth = 20n * 10n ** 18n
			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, coverageCommitmentTransferAttoEth, forcedPrice)

			// Record liquidator's backingUnits before attack
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidatorBeforeBackingUnits = liquidatorVaultBefore.vaultRepBackingAttoRep

			// The target owner rescues the vault while liquidation is pending.
			const extraRepAmount = repDeposit * 5n
			await depositRepToVault(client, securityPoolAddresses.securityPool, extraRepAmount)

			// Capture state after deposit but before liquidation
			const vaultAfterDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfterDeposit = await getVaultRepClaim(client.account.address)
			const afterDepositBackingUnits = vaultAfterDeposit.vaultRepBackingAttoRep
			const denominatorAfter = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
			const totalRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

			// Trigger the queued liquidation by reporting the forced price
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

			// After liquidation, read final states
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, securityPoolCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(targetVaultAfter.vaultRepBackingAttoRep, afterDepositBackingUnits, 'the target must retain the backingUnits created by its rescue deposit')
			strictEqualTypeSafe(liquidatorVaultAfter.vaultRepBackingAttoRep, liquidatorBeforeBackingUnits, 'the stale liquidation must not move backingUnits to the liquidator')
			strictEqualTypeSafe(await getVaultRepClaim(client.account.address), targetClaimAfterDeposit, 'the target must retain its complete live REP claim')
			strictEqualTypeSafe(await getVaultRepClaim(liquidatorClient.account.address), repDeposit * 10n, 'the liquidator must not receive REP from a stale quote')
			approximatelyEqual(snapshotExpectedRepDeposit, repDeposit, 1n, 'the snapshot claim should still match the original REP deposit before the attack deposit')
			approximatelyEqual(totalRepAfter, repDeposit * 16n, 1n, 'the pool-held REP balance should include the additional attack deposit')
			approximatelyEqual(denominatorAfter, PRICE_PRECISION * repDeposit * 16n, 1n, 'backingUnits denominator should reflect the additional attack deposit')
		})

		test('a maximum liquidation clears target coverage commitment while leaving pool-held vault REP backing above the gross award', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			for (let withdrawalIndex = 0n; withdrawalIndex < 3n; withdrawalIndex++) {
				await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit / 5n)
				await mockWindow.advanceTime(10n * 60n)
			}
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit / 10n)
			await mockWindow.advanceTime(10n * 60n)
			const securityPoolCoverageCommitmentAttoEth = 20n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
			await mockWindow.advanceTime(100000n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetRepBeforeLiquidation = await getVaultRepClaim(client.account.address)
			const coverageCommitmentTransferAttoEth = securityPoolCoverageCommitmentAttoEth

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, coverageCommitmentTransferAttoEth, PRICE_PRECISION * 10n)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION * 10n)

			const targetVaultAfterFirstLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterFirstLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfterFirstLiquidation = await getVaultRepClaim(client.account.address)
			const liquidatorClaimAfterFirstLiquidation = await getVaultRepClaim(liquidatorClient.account.address)
			const expectedRepMove = getLiquidationVaultRepBackingToTransfer(coverageCommitmentTransferAttoEth, PRICE_PRECISION * 10n)
			strictEqualTypeSafe(targetVaultAfterFirstLiquidation.coverageCommitmentAttoEth, 0n, 'maximum liquidation should clear the full target coverage commitment when enough REP is available')
			assert.ok(targetVaultAfterFirstLiquidation.vaultRepBackingAttoRep < targetVaultBefore.vaultRepBackingAttoRep, 'max liquidation should reduce the target backingUnits')
			strictEqualTypeSafe(liquidatorVaultAfterFirstLiquidation.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth + coverageCommitmentTransferAttoEth, 'the liquidator should assume the full requested coverage commitment when the target has enough REP to pay the penalty')
			approximatelyEqual(targetClaimAfterFirstLiquidation, targetRepBeforeLiquidation - expectedRepMove, 1n, 'max liquidation should leave target REP above the capped gross award')
			approximatelyEqual(liquidatorClaimAfterFirstLiquidation, repDeposit * 2n + expectedRepMove, 1n, 'max liquidation should transfer vault REP backing to the liquidator')

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, coverageCommitmentTransferAttoEth, PRICE_PRECISION * 10n)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION * 10n)

			const targetVaultAfterSecondLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterSecondLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfterSecondLiquidation.coverageCommitmentAttoEth, targetVaultAfterFirstLiquidation.coverageCommitmentAttoEth, 'once fully liquidated, the vault should not change under the same price')
			strictEqualTypeSafe(targetVaultAfterSecondLiquidation.vaultRepBackingAttoRep, targetVaultAfterFirstLiquidation.vaultRepBackingAttoRep, 'a second same-price liquidation should not move more REP after coverage commitment is cleared')
			strictEqualTypeSafe(liquidatorVaultAfterSecondLiquidation.coverageCommitmentAttoEth, liquidatorVaultAfterFirstLiquidation.coverageCommitmentAttoEth, 'a second same-price liquidation should not move more coverage commitment after coverage commitment is cleared')
		})

		test('a maximum liquidation writes off a funded slice below the minimum assignable coverage commitment', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = 14n * 10n ** 17n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const coverageCommitmentTransferAttoEth = securityPoolCoverageCommitmentAttoEth
			const dustRoundingPrice = PRICE_PRECISION * 1000n

			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, dustRoundingPrice)
			const executionHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, coverageCommitmentTransferAttoEth)
			const executionLog = await getExecutedStagedOperation(executionHash)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			assert.strictEqual(executionLog.args.success, true, `full proportional liquidation failed with ${executionLog.args.errorMessage}`)
			strictEqualTypeSafe(targetVaultBefore.coverageCommitmentAttoEth, securityPoolCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, 0n, 'coverage commitment')
			strictEqualTypeSafe(targetVaultAfter.vaultRepBackingAttoRep, targetVaultBefore.vaultRepBackingAttoRep, 'an unassignable funded slice should not move target REP')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, 0n, 'a fresh liquidator must not receive a forbidden sub-minimum coverage commitment')
			strictEqualTypeSafe(await getVaultBadDebt(securityPoolAddresses.securityPool, client.account.address), securityPoolCoverageCommitmentAttoEth, 'coverage commitment')
		})

		test('liquidation can fully close a vault that only holds the minimum REP deposit', async () => {
			const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const minimumRepDeposit = 10n * 10n ** 18n
			const minimumCoverageCommitmentAttoEth = 1n * 10n ** 18n
			const coverageCommitmentAttoEthCreationPrice = 5n * 10n ** 18n
			const liquidationPrice = 61n * 10n ** 17n

			await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, minimumRepDeposit)
			await manipulatePriceOracleAndPerformOperation(targetClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, targetClient.account.address, minimumCoverageCommitmentAttoEth, coverageCommitmentAttoEthCreationPrice)

			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
			await mockWindow.advanceTime(100000n)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimBefore = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimBefore = await getVaultRepClaim(liquidatorClient.account.address)

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, targetClient.account.address, minimumCoverageCommitmentAttoEth, liquidationPrice)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfter = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimAfter = await getVaultRepClaim(liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultBefore.coverageCommitmentAttoEth, minimumCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(targetClaimBefore, minimumRepDeposit, 'setup should leave the target at the minimum REP deposit')
			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, 0n, 'full-close liquidation should clear the minimum-size target coverage commitment')
			const expectedAward = getLiquidationVaultRepBackingToTransfer(minimumCoverageCommitmentAttoEth, liquidationPrice)
			assert.ok(targetVaultAfter.vaultRepBackingAttoRep > 0n, 'exact-award liquidation should leave target REP beyond the 105% award')
			strictEqualTypeSafe(targetClaimAfter, targetClaimBefore - expectedAward, 'the target should retain REP beyond the exact 105% award')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth + minimumCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(liquidatorClaimAfter - liquidatorClaimBefore, expectedAward, 'the liquidator should receive the complete 105% award and no excess target REP')
		})

		test('liquidation can fully close a minimum-size vault when the computed REP penalty exceeds the remaining REP', async () => {
			const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const minimumRepDeposit = 10n * 10n ** 18n
			const minimumCoverageCommitmentAttoEth = 1n * 10n ** 18n
			const coverageCommitmentAttoEthCreationPrice = 5n * 10n ** 18n
			const liquidationPrice = 10n * 10n ** 18n

			await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, minimumRepDeposit)
			await manipulatePriceOracleAndPerformOperation(targetClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, targetClient.account.address, minimumCoverageCommitmentAttoEth, coverageCommitmentAttoEthCreationPrice)

			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
			await mockWindow.advanceTime(100000n)

			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidatorClaimBefore = await getVaultRepClaim(liquidatorClient.account.address)

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, targetClient.account.address, minimumCoverageCommitmentAttoEth, liquidationPrice)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfter = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimAfter = await getVaultRepClaim(liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, 0n, 'full-close liquidation should still clear the target coverage commitment when the computed REP penalty exceeds the vault balance')
			assert.ok(targetVaultAfter.vaultRepBackingAttoRep > 0n, 'a fully unfunded award must not transfer target vault REP backing')
			strictEqualTypeSafe(targetClaimAfter, minimumRepDeposit, 'the bad-debt backstop should leave target REP untouched')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth, 'the liquidator must not assume coverage commitment without a valid minimum-sized funded slice')
			strictEqualTypeSafe(liquidatorClaimAfter, liquidatorClaimBefore, 'the liquidator should not receive REP when no coverage commitment moves')
			strictEqualTypeSafe(await getVaultBadDebt(securityPoolAddresses.securityPool, targetClient.account.address), minimumCoverageCommitmentAttoEth, 'the explicit backstop should record the fully untransferred coverage commitment as bad debt')
		})

		test('queued liquidation becomes stale when the target adds even one unit of REP', async () => {
			const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const minimumRepDeposit = 10n * 10n ** 18n
			const minimumCoverageCommitmentAttoEth = 1n * 10n ** 18n
			const coverageCommitmentAttoEthCreationPrice = 5n * 10n ** 18n
			const liquidationPrice = 61n * 10n ** 17n
			const extraRepAmount = 1n

			await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, minimumRepDeposit)
			await manipulatePriceOracleAndPerformOperation(targetClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, targetClient.account.address, minimumCoverageCommitmentAttoEth, coverageCommitmentAttoEthCreationPrice)

			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
			await mockWindow.advanceTime(100000n)

			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const liquidatorClaimBefore = await getVaultRepClaim(liquidatorClient.account.address)

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, targetClient.account.address, minimumCoverageCommitmentAttoEth, liquidationPrice)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, extraRepAmount)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfter = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimAfter = await getVaultRepClaim(liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, minimumCoverageCommitmentAttoEth, 'a target backingUnits mutation should invalidate the queued coverage commitment transfer')
			strictEqualTypeSafe(targetClaimAfter, minimumRepDeposit + extraRepAmount, 'the rescue deposit must remain with the target vault')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(liquidatorClaimAfter, liquidatorClaimBefore, 'a stale liquidation must not move REP')
		})

		test('an unsolicited one-unit REP donation cannot cancel a queued liquidation', async () => {
			const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const minimumRepDeposit = 10n * 10n ** 18n
			const minimumCoverageCommitmentAttoEth = 1n * 10n ** 18n
			const coverageCommitmentAttoEthCreationPrice = 5n * 10n ** 18n
			const liquidationPrice = 61n * 10n ** 17n
			const extraRepAmount = 1n

			await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(targetClient, securityPoolAddresses.securityPool, minimumRepDeposit)
			await manipulatePriceOracleAndPerformOperation(targetClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, targetClient.account.address, minimumCoverageCommitmentAttoEth, coverageCommitmentAttoEthCreationPrice)

			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
			await mockWindow.advanceTime(100000n)

			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetBackingUnitsBefore = (await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)).vaultRepBackingAttoRep

			await queueLiquidationAtForcedPrice(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, targetClient.account.address, minimumCoverageCommitmentAttoEth, liquidationPrice)
			await writeContractAndWait(targetClient, () =>
				targetClient.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: addressString(GENESIS_REPUTATION_TOKEN),
					functionName: 'transfer',
					args: [securityPoolAddresses.securityPool, extraRepAmount],
				}),
			)
			const targetClaimAfterDonation = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimAfterDonation = await getVaultRepClaim(liquidatorClient.account.address)
			await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, targetClient.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfter = await getVaultRepClaim(targetClient.account.address)
			const liquidatorClaimAfter = await getVaultRepClaim(liquidatorClient.account.address)

			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, 0n, 'an unsolicited pool donation must not cancel the quoted coverage commitment transfer')
			assert.ok(targetVaultAfter.vaultRepBackingAttoRep > 0n, 'exact-award liquidation should preserve target backingUnits beyond the award')
			strictEqualTypeSafe(targetClaimAfter, targetClaimAfterDonation - getLiquidationVaultRepBackingToTransfer(minimumCoverageCommitmentAttoEth, liquidationPrice), 'the donation must not change the exact 105% award')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth + minimumCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(liquidatorClaimAfter, liquidatorClaimAfterDonation + getLiquidationVaultRepBackingToTransfer(minimumCoverageCommitmentAttoEth, liquidationPrice), 'the liquidator should receive the complete award without taking the target surplus')
			assert.ok(targetBackingUnitsBefore > 0n, 'the regression setup must queue a nonzero target backingUnits')
		})

		test('a smaller liquidation is capped so it leaves a valid target coverage commitment instead of promoting an unavailable award', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = 14n * 10n ** 17n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)
			await manipulatePriceOracleAndPerformOperation(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, liquidatorClient.account.address, 1n * 10n ** 18n)

			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetRepBefore = await getVaultRepClaim(client.account.address)
			const dustRevertingAmount = 8n * 10n ** 17n
			const dustRoundingPrice = PRICE_PRECISION * 400n

			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, dustRoundingPrice)
			const executionHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, dustRevertingAmount)
			const executionLog = await getExecutedStagedOperation(executionHash)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetRepAfter = await getVaultRepClaim(client.account.address)

			assert.strictEqual(executionLog.args.success, true, `dust-promoted liquidation failed with ${executionLog.args.errorMessage}`)
			const cappedCoverageCommitmentTransferAttoEth = securityPoolCoverageCommitmentAttoEth - 1n * 10n ** 18n
			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, 1n * 10n ** 18n, 'the capped partial liquidation should preserve the minimum valid target coverage commitment')
			assert.ok(targetVaultAfter.vaultRepBackingAttoRep > 0n, 'the partial liquidation should leave pool-held vault REP backing beyond the gross award')
			strictEqualTypeSafe(targetRepAfter, targetRepBefore - getLiquidationVaultRepBackingToTransfer(cappedCoverageCommitmentTransferAttoEth, dustRoundingPrice), 'the capped partial liquidation should move only its complete 105% award')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth + cappedCoverageCommitmentTransferAttoEth, 'the liquidator should receive only the capped coverage commitment')
			assert.ok(liquidatorVaultAfter.vaultRepBackingAttoRep > liquidatorVaultBefore.vaultRepBackingAttoRep, 'liquidator should receive the target REP bundle')
		})

		test('tiny liquidation preserves the bonus without a separate gain condition', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const roundingSensitivePrice = (PRICE_PRECISION * 45n) / 100n
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, roundingSensitivePrice)
			const setupPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			const setupTargetRep = await getVaultRepClaim(client.account.address)
			const targetCoverageCommitmentAttoEth = (setupTargetRep * PRICE_PRECISION * 10_000n) / (setupPrice * statoblastSecurityMultiplierBps)
			const coverageCommitmentAttoEthExecutionHash = await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, targetCoverageCommitmentAttoEth)
			const coverageCommitmentAttoEthExecutionLog = await getExecutedStagedOperation(coverageCommitmentAttoEthExecutionHash)
			assert.strictEqual(coverageCommitmentAttoEthExecutionLog.args.success, true, `rounding setup coverageCommitmentAttoEth failed with ${coverageCommitmentAttoEthExecutionLog.args.errorMessage}`)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)
			await manipulatePriceOracleAndPerformOperation(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, liquidatorClient.account.address, 1n * 10n ** 18n)
			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION)

			const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const tinyLiquidationAmount = 1n
			const actualPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			const targetRepClaim = await getVaultRepClaim(client.account.address)
			const liquidationThresholdPrice = (targetRepClaim * PRICE_PRECISION * 10_000n) / (targetVaultBefore.coverageCommitmentAttoEth * statoblastSecurityMultiplierBps)
			assert.ok(actualPrice > liquidationThresholdPrice, `rounding setup must be liquidatable: price ${actualPrice}, threshold ${liquidationThresholdPrice}`)
			assert.ok(((actualPrice - liquidationThresholdPrice) * 10000n) / actualPrice >= 1000n, `rounding setup must clear the coordinator distance: price ${actualPrice}, threshold ${liquidationThresholdPrice}`)

			const executionHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, tinyLiquidationAmount)
			const executionLog = await getExecutedStagedOperation(executionHash)

			const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)

			assert.strictEqual(executionLog.args.success, true, `tiny proportional liquidation failed with ${executionLog.args.errorMessage}`)
			strictEqualTypeSafe(targetVaultAfter.coverageCommitmentAttoEth, targetVaultBefore.coverageCommitmentAttoEth - tinyLiquidationAmount, 'tiny liquidation should move the requested coverage commitment')
			assert.ok(targetVaultAfter.vaultRepBackingAttoRep < targetVaultBefore.vaultRepBackingAttoRep, 'tiny liquidation should move the corresponding backingUnits fraction')
			strictEqualTypeSafe(liquidatorVaultAfter.coverageCommitmentAttoEth, liquidatorVaultBefore.coverageCommitmentAttoEth + tinyLiquidationAmount, 'caller should receive the requested coverage commitment')
			assert.ok(liquidatorVaultAfter.vaultRepBackingAttoRep > liquidatorVaultBefore.vaultRepBackingAttoRep, 'caller should receive the corresponding backingUnits fraction')
		})

		test('liquidation leaves escalation claims with their original depositor', async () => {
			const securityPoolCoverageCommitmentAttoEth = 200n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)

			strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolCoverageCommitmentAttoEth, repDeposit, statoblastSecurityMultiplierBps), false, 'vault should start safe before locking REP')

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

			const lockedDeposit = 600n * 10n ** 18n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

			const targetVaultAfterLock = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const targetClaimAfterLock = await getVaultRepClaim(client.account.address)

			strictEqualTypeSafe(targetVaultAfterLock.disputeStakedRepAttoRep, lockedDeposit, 'target vault should have the escalation principal marked as locked')
			strictEqualTypeSafe(targetClaimAfterLock, repDeposit - lockedDeposit, 'locking REP should move the committed principal out of the vault claim')
			strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolCoverageCommitmentAttoEth, targetClaimAfterLock, statoblastSecurityMultiplierBps), false, 'the escalation deposit should stop at multiplier-adjusted backing')

			const liquidationPrice = (PRICE_PRECISION * 3n) / 2n
			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationPrice)
			strictEqualTypeSafe(canLiquidate(liquidationPrice, securityPoolCoverageCommitmentAttoEth, targetClaimAfterLock, statoblastSecurityMultiplierBps), true, 'an adverse price move should make the boundary-backed vault liquidatable')
			const partialCoverageCommitmentAttoEth = securityPoolCoverageCommitmentAttoEth / 3n
			const partialLiquidationHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, partialCoverageCommitmentAttoEth)
			const partialLiquidationExecution = await getExecutedStagedOperation(partialLiquidationHash)
			strictEqualTypeSafe(partialLiquidationExecution.args.success, true, `partial bundled liquidation should execute: ${partialLiquidationExecution.args.errorMessage}`)

			const targetVaultAfterPartial = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterPartial = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			strictEqualTypeSafe(targetVaultAfterPartial.disputeStakedRepAttoRep, lockedDeposit, 'partial liquidation must leave the escalation claim with the target')
			strictEqualTypeSafe(targetVaultAfterPartial.coverageCommitmentAttoEth, securityPoolCoverageCommitmentAttoEth - partialCoverageCommitmentAttoEth, 'partial liquidation should leave the matching coverage commitment remainder')
			const partialVaultRepBackingAward = getLiquidationVaultRepBackingToTransfer(partialCoverageCommitmentAttoEth, liquidationPrice)
			approximatelyEqual(await getVaultRepClaim(client.account.address), repDeposit - lockedDeposit - partialVaultRepBackingAward, 2n, 'the partial award should come entirely from target pool-held vault REP backing')
			approximatelyEqual(await getVaultRepClaim(liquidatorClient.account.address), repDeposit * 2n + partialVaultRepBackingAward, 2n, 'the liquidator should receive the full bonus-priced pool-held vault REP backing')
			strictEqualTypeSafe(liquidatorVaultAfterPartial.disputeStakedRepAttoRep, 0n, 'partial liquidation must not give the liquidator dispute-staked REP')

			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION * 3n)
			const liquidationHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolCoverageCommitmentAttoEth - partialCoverageCommitmentAttoEth)
			const liquidationExecution = await getExecutedStagedOperation(liquidationHash)
			strictEqualTypeSafe(liquidationExecution.args.success, true, `remaining bundled liquidation should execute: ${liquidationExecution.args.errorMessage}`)

			const targetVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const liquidatorVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
			const targetClaimAfterLiquidation = await getVaultRepClaim(client.account.address)
			const liquidatorClaimAfterLiquidation = await getVaultRepClaim(liquidatorClient.account.address)
			const recordedBadDebt = await getVaultBadDebt(securityPoolAddresses.securityPool, client.account.address)

			strictEqualTypeSafe(targetVaultAfterLiquidation.disputeStakedRepAttoRep, lockedDeposit, 'full liquidation must leave the target escalation claim intact')
			strictEqualTypeSafe(targetVaultAfterLiquidation.coverageCommitmentAttoEth, 0n, 'liquidation should clear the target coverage commitment when enough pool-held vault REP backing is available')
			assert.ok(targetClaimAfterLiquidation <= 3n, 'the max funded award should consume pool-held vault REP backing up to conversion dust')
			assert.ok(recordedBadDebt > 0n, 'the untransferred residual should use the explicit bad-debt backstop')
			strictEqualTypeSafe(liquidatorVaultAfterLiquidation.coverageCommitmentAttoEth + recordedBadDebt, securityPoolCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), liquidatorVaultAfterLiquidation.coverageCommitmentAttoEth, 'coverage commitment')
			approximatelyEqual(liquidatorClaimAfterLiquidation, repDeposit * 3n - lockedDeposit, 3n, 'the liquidator should receive only the complete funded awards from pool-held vault REP backing')
			strictEqualTypeSafe(liquidatorVaultAfterLiquidation.disputeStakedRepAttoRep, 0n, 'the liquidator must never receive the non-tradeable escalation claim')

			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await triggerOwnGameFork(liquidatorClient, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(liquidatorClient, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const originalWalletRepBefore = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const liquidatorWalletRepBefore = await getERC20Balance(liquidatorClient, yesChildRepToken, liquidatorClient.account.address)

			await assert.rejects(claimForkedEscalationDeposits(liquidatorClient, securityPoolAddresses.securityPool, liquidatorClient.account.address, QuestionOutcome.Yes, [0n]))
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			assert.ok((await getERC20Balance(client, yesChildRepToken, client.account.address)) > originalWalletRepBefore, 'own-fork settlement should pay the committed depositor')
			strictEqualTypeSafe(await getERC20Balance(liquidatorClient, yesChildRepToken, liquidatorClient.account.address), liquidatorWalletRepBefore, 'own-fork settlement must not pay the liquidator')
		})

		test('minimum multiplier liquidation pays the full pool-held vault REP backing bonus and records untransferred residual bad debt', async () => {
			const minimumMultiplierBps = 10_002n
			const minimumMultiplierQuestion = {
				...questionData,
				title: 'minimum multiplier liquidation reserve',
			}
			const minimumMultiplierQuestionId = getQuestionId(minimumMultiplierQuestion, outcomes)
			await createQuestion(client, minimumMultiplierQuestion, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, minimumMultiplierQuestionId, minimumMultiplierBps)
			const minimumMultiplierPool = getSecurityPoolAddresses(addressString(0n), genesisUniverse, minimumMultiplierQuestionId, minimumMultiplierBps)

			const otherHolderClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			for (const vaultClient of [client, otherHolderClient, liquidatorClient]) {
				await approveToken(vaultClient, addressString(GENESIS_REPUTATION_TOKEN), minimumMultiplierPool.securityPool)
				await depositRepToVault(vaultClient, minimumMultiplierPool.securityPool, repDeposit)
			}

			const targetCoverageCommitmentAttoEth = 900n * 10n ** 18n
			const setupPrice = PRICE_PRECISION / 10n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, minimumMultiplierPool.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, targetCoverageCommitmentAttoEth, setupPrice)
			await mockWindow.setTime(minimumMultiplierQuestion.endTime + 10_000n)
			await manipulatePriceOracle(client, mockWindow, minimumMultiplierPool.priceOracleManagerAndOperatorQueuer, setupPrice)
			const escrowedRep = 900n * 10n ** 18n
			await depositToEscalationGame(client, minimumMultiplierPool.securityPool, QuestionOutcome.Yes, escrowedRep)

			const targetBefore = await getSecurityVault(client, minimumMultiplierPool.securityPool, client.account.address)
			const liquidatorBefore = await getSecurityVault(client, minimumMultiplierPool.securityPool, liquidatorClient.account.address)
			const otherHolderBefore = await getSecurityVault(client, minimumMultiplierPool.securityPool, otherHolderClient.account.address)
			const targetVaultRepBackingBeforeAttoRep = await backingUnitsToAttoRep(client, minimumMultiplierPool.securityPool, targetBefore.vaultRepBackingAttoRep)
			const liquidatorVaultRepBackingBefore = await backingUnitsToAttoRep(client, minimumMultiplierPool.securityPool, liquidatorBefore.vaultRepBackingAttoRep)
			const otherHolderVaultRepBackingBefore = await backingUnitsToAttoRep(client, minimumMultiplierPool.securityPool, otherHolderBefore.vaultRepBackingAttoRep)
			strictEqualTypeSafe(targetBefore.disputeStakedRepAttoRep, escrowedRep, 'setup should bind the escalation claim to the target')
			strictEqualTypeSafe(targetVaultRepBackingBeforeAttoRep, repDeposit - escrowedRep, 'setup should leave only the liquidation reserve as target pool-held vault REP backing')

			const liquidationPrice = 2n * PRICE_PRECISION
			const awardDenominator = liquidationPrice * 10_500n
			const maximumFundedCoverageCommitmentAttoEth = (targetVaultRepBackingBeforeAttoRep * PRICE_PRECISION * 10_000n) / awardDenominator
			const expectedAwardNumerator = maximumFundedCoverageCommitmentAttoEth * liquidationPrice * 10_500n
			const expectedAwardDenominator = PRICE_PRECISION * 10_000n
			const expectedFullAward = (expectedAwardNumerator + expectedAwardDenominator - 1n) / expectedAwardDenominator
			await mockWindow.advanceTime(5n * 60n + 1n)
			await queueLiquidationAtForcedPrice(liquidatorClient, minimumMultiplierPool.priceOracleManagerAndOperatorQueuer, client.account.address, targetCoverageCommitmentAttoEth, liquidationPrice)
			await handleOracleReporting(liquidatorClient, mockWindow, minimumMultiplierPool.priceOracleManagerAndOperatorQueuer, liquidationPrice)

			const targetAfter = await getSecurityVault(client, minimumMultiplierPool.securityPool, client.account.address)
			const liquidatorAfter = await getSecurityVault(client, minimumMultiplierPool.securityPool, liquidatorClient.account.address)
			const otherHolderAfter = await getSecurityVault(client, minimumMultiplierPool.securityPool, otherHolderClient.account.address)
			const liquidatorVaultRepBackingAfter = await backingUnitsToAttoRep(client, minimumMultiplierPool.securityPool, liquidatorAfter.vaultRepBackingAttoRep)
			const otherHolderVaultRepBackingAfter = await backingUnitsToAttoRep(client, minimumMultiplierPool.securityPool, otherHolderAfter.vaultRepBackingAttoRep)
			const expectedBadDebt = targetCoverageCommitmentAttoEth - maximumFundedCoverageCommitmentAttoEth

			strictEqualTypeSafe(targetAfter.coverageCommitmentAttoEth, 0n, 'the explicit backstop should clear the residual target coverage commitment')
			strictEqualTypeSafe(targetAfter.disputeStakedRepAttoRep, escrowedRep, 'bad-debt handling must not move the target escalation claim')
			strictEqualTypeSafe(liquidatorAfter.coverageCommitmentAttoEth, maximumFundedCoverageCommitmentAttoEth, 'the liquidator should assume only the coverage commitment whose complete award is available')
			strictEqualTypeSafe(liquidatorVaultRepBackingAfter - liquidatorVaultRepBackingBefore, expectedFullAward, 'the liquidator should receive the complete 105% pool-held vault REP backing award')
			assert.ok(liquidatorVaultRepBackingAfter * PRICE_PRECISION * 10_000n > liquidatorAfter.coverageCommitmentAttoEth * liquidationPrice * 10_500n, 'the liquidator should remain above the strengthened pool-held vault REP backing health reserve')
			strictEqualTypeSafe(otherHolderVaultRepBackingAfter, otherHolderVaultRepBackingBefore, 'liquidation and bad-debt recording must not dilute another holder')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, minimumMultiplierPool.securityPool), maximumFundedCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(await getVaultBadDebt(minimumMultiplierPool.securityPool, client.account.address), expectedBadDebt, 'the target should expose its recorded residual bad debt')
			strictEqualTypeSafe(await getTotalBadDebt(minimumMultiplierPool.securityPool), expectedBadDebt, 'the pool should expose cumulative bad debt for monitoring')
		})

		test('liquidation does not change own-fork claim authorization or payout', async () => {
			const securityPoolCoverageCommitmentAttoEth = 200n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)

			await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			const lockedDeposit = 600n * 10n ** 18n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
			await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, (PRICE_PRECISION * 3n) / 2n)
			const partialLiquidationHash = await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolCoverageCommitmentAttoEth / 3n)
			const partialLiquidationExecution = await getExecutedStagedOperation(partialLiquidationHash)
			strictEqualTypeSafe(partialLiquidationExecution.args.success, true, `partial liquidation should execute: ${partialLiquidationExecution.args.errorMessage}`)

			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await triggerOwnGameFork(liquidatorClient, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(liquidatorClient, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesChildRepToken = getRepTokenAddress(getChildUniverseId(genesisUniverse, QuestionOutcome.Yes))
			const originalBalanceBefore = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const liquidatorBalanceBefore = await getERC20Balance(liquidatorClient, yesChildRepToken, liquidatorClient.account.address)

			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			assert.ok((await getERC20Balance(client, yesChildRepToken, client.account.address)) > originalBalanceBefore, 'the committed depositor should receive the complete direct claim')
			strictEqualTypeSafe(await getERC20Balance(liquidatorClient, yesChildRepToken, liquidatorClient.account.address), liquidatorBalanceBefore, 'the liquidator must not receive any direct-claim payout')
		})

		test('locking REP in escalation preserves total collateral claims and only reduces the lockers withdrawable balance', async () => {
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const lockedDeposit = 100n * 10n ** 18n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

			const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			const firstVaultTotalClaim = await getVaultRepClaim(client.account.address)
			const secondVaultTotalClaim = await getVaultRepClaim(secondVaultClient.account.address)
			const availableRepBalance = await getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(firstVaultTotalClaim, repDeposit - lockedDeposit, 'locking REP should remove the committed principal from the vault claim')
			strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'locking REP should not reduce another vaults total collateral claim')
			strictEqualTypeSafe(firstVault.disputeStakedRepAttoRep, lockedDeposit, 'the lockers escalation principal should be tracked separately')
			strictEqualTypeSafe(firstVaultTotalClaim + firstVault.disputeStakedRepAttoRep, repDeposit, 'the lockers total position should be preserved across the two REP buckets')
			strictEqualTypeSafe(secondVault.disputeStakedRepAttoRep, 0n, 'the unrelated vault should have no dispute-staked REP')
			strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'the unrelated vault should keep its full vault REP')
			strictEqualTypeSafe(availableRepBalance, repDeposit * 2n - lockedDeposit, 'pool available REP should exclude only the escalation-locked principal')
		})
	})

	describe('open interest and share redemption', () => {
		for (const [label, forcedBalance] of [
			['one attoREP', 1n],
			['a large surplus', repDeposit],
		] as const) {
			test(`forced ${label} cannot brick the first complete-set mint`, async () => {
				const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
				await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
				await mockWindow.setBalance(securityPoolAddresses.securityPool, forcedBalance)

				await redeemFees(client, securityPoolAddresses.securityPool, addressString(TEST_ADDRESSES[4]))

				strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'unsolicited ETH should remain outside complete-set collateral before bootstrap')
				strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'fee reconciliation should not create complete-set supply')

				const depositor = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
				const depositAmount = 1n * 10n ** 18n
				await createCompleteSet(depositor, securityPoolAddresses.securityPool, depositAmount)

				const depositorShares = await balanceOfShares(depositor, securityPoolAddresses.shareToken, genesisUniverse, depositor.account.address)
				const expectedShares = depositAmount * PRICE_PRECISION
				strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), expectedShares, 'the first positive deposit should bootstrap positive complete-set supply')
				strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), depositAmount, 'only the depositor ETH should become complete-set collateral')
				strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), forcedBalance + depositAmount, 'the forced balance should remain isolated from complete-set accounting')
				strictEqualTypeSafe(depositorShares[0], expectedShares, 'the depositor should receive invalid shares')
				strictEqualTypeSafe(depositorShares[1], expectedShares, 'the depositor should receive yes shares')
				strictEqualTypeSafe(depositorShares[2], expectedShares, 'the depositor should receive no shares')
			})

			if (label === 'one attoREP')
				test('child liquidation leaves carried and local escalation claims with the target', async () => {
					const securityPoolCoverageCommitmentAttoEth = 200n * 10n ** 18n
					await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
					const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
					await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
					await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)

					await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 10000n)
					await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
					const lockedDeposit = 600n * 10n ** 18n
					await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
					await depositToEscalationGame(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.No, lockedDeposit)
					await depositRepToVault(client, securityPoolAddresses.securityPool, repDeposit)
					await triggerExternalForkForSecurityPool(undefined, 'carried liquidation-owner payout')
					await migrateRepToZoltar(liquidatorClient, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
					await createChildUniverse(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
					const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
					const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
					const reporterRep = 10n * 10n ** 18n
					await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
					await addRepToMigrationBalance(client, genesisUniverse, reporterRep)
					await splitMigrationRep(client, genesisUniverse, reporterRep, [QuestionOutcome.Yes])
					await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
					await migrateVault(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
					await mockWindow.advanceTime(8n * 7n * DAY + DAY)
					await startTruthAuction(liquidatorClient, yesPool.securityPool)
					if ((await getSystemState(liquidatorClient, yesPool.securityPool)) === SystemState.ForkTruthAuction) {
						await finalizeTruthAuction(liquidatorClient, yesPool.securityPool)
					}
					for (let progressCall = 0; progressCall < 16 && (await getAwaitingForkContinuation(liquidatorClient, yesPool.securityPool)); progressCall++) {
						await writeContractAndWait(liquidatorClient, () =>
							liquidatorClient.writeContract({
								abi: peripherals_SecurityPool_SecurityPool.abi,
								address: yesPool.securityPool,
								functionName: 'resumeForkedEscalationGame',
								args: [],
							}),
						)
					}
					strictEqualTypeSafe(await getAwaitingForkContinuation(liquidatorClient, yesPool.securityPool), false, 'bounded continuation progress should complete before child-local deposits')
					await manipulatePriceOracle(client, mockWindow, yesPool.priceOracleManagerAndOperatorQueuer)
					await depositToEscalationGame(client, yesPool.securityPool, QuestionOutcome.No, lockedDeposit)
					const targetChildVaultBefore = await getSecurityVault(client, yesPool.securityPool, client.account.address)
					const liquidatorChildVaultBefore = await getSecurityVault(client, yesPool.securityPool, liquidatorClient.account.address)
					const childLocalDeposit = targetChildVaultBefore.disputeStakedRepAttoRep
					assert.ok(childLocalDeposit > 0n, 'the resumed child should record its new local claim separately')
					assert.ok(targetChildVaultBefore.coverageCommitmentAttoEth > 0n, 'coverage commitment')
					const targetVaultRepBackingBeforeAttoRep = await getVaultRepClaim(client.account.address)
					const liquidatorVaultRepBackingBefore = await getVaultRepClaim(liquidatorClient.account.address)
					await manipulatePriceOracle(client, mockWindow, yesPool.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION * 4n)
					await requestPriceIfNeededAndStageOperation(liquidatorClient, yesPool.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, targetChildVaultBefore.coverageCommitmentAttoEth)
					const targetChildVaultAfter = await getSecurityVault(client, yesPool.securityPool, client.account.address)
					const liquidatorChildVaultAfter = await getSecurityVault(client, yesPool.securityPool, liquidatorClient.account.address)
					strictEqualTypeSafe(targetChildVaultAfter.disputeStakedRepAttoRep, childLocalDeposit, 'liquidation must not move the target claim')
					strictEqualTypeSafe(liquidatorChildVaultAfter.disputeStakedRepAttoRep, liquidatorChildVaultBefore.disputeStakedRepAttoRep, 'the liquidator must not receive dispute-staked REP')
					const grossLiquidationAward = getLiquidationVaultRepBackingToTransfer(targetChildVaultBefore.coverageCommitmentAttoEth, PRICE_PRECISION * 4n)
					const vaultRepBackingAwardAttoRep = grossLiquidationAward < targetVaultRepBackingBeforeAttoRep ? grossLiquidationAward : targetVaultRepBackingBeforeAttoRep
					approximatelyEqual(await getVaultRepClaim(client.account.address), targetVaultRepBackingBeforeAttoRep - vaultRepBackingAwardAttoRep, 2n, 'the liquidation award should come only from target pool-held vault REP backing')
					approximatelyEqual(await getVaultRepClaim(liquidatorClient.account.address), liquidatorVaultRepBackingBefore + vaultRepBackingAwardAttoRep, 2n, 'the liquidator should receive only the available pool-held vault REP backing award')
				})
		}

		test('forced ETH during migration remains surplus while accounted collateral moves to the child', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await triggerExternalForkForSecurityPool(undefined, 'forced ETH migration source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const forcedParentSurplus = 7n * 10n ** 18n
			const forcedChildSurplus = 11n * 10n ** 18n
			const parentRawBalanceBeforeForce = await getETHBalance(client, securityPoolAddresses.securityPool)
			await mockWindow.setBalance(securityPoolAddresses.securityPool, parentRawBalanceBeforeForce + forcedParentSurplus)
			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedChildSurplus)
			const parentSettlementCollateralAttoEthBeforeMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentSettlementCollateralAttoEthAfterMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const migratedCollateral = parentSettlementCollateralAttoEthBeforeMigration - parentSettlementCollateralAttoEthAfterMigration
			assert.ok(migratedCollateral > 0n, 'test setup should migrate positive accounted collateral')
			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), parentRawBalanceBeforeForce + forcedParentSurplus - migratedCollateral, 'parent migration should transfer only accounted collateral and retain forced surplus')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), forcedChildSurplus + migratedCollateral, 'child raw balance should separate forced surplus from migrated collateral')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'child collateral should remain unsettled until truth-auction finalization')
		})

		test('nonzero fee redemption does not classify forced ETH as complete-set collateral', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 100n * 10n ** 18n)
			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const vaultBeforeRedemption = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(vaultBeforeRedemption.claimableFeesAttoEth > 0n, 'test setup should accrue nonzero fees')
			const balanceBeforeForcedEth = await getETHBalance(client, securityPoolAddresses.securityPool)
			await mockWindow.setBalance(securityPoolAddresses.securityPool, balanceBeforeForcedEth + 1n)

			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)

			const collateralAfterRedemption = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const accruedFeesAfterRedemption = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), collateralAfterRedemption + accruedFeesAfterRedemption + 1n, 'forced ETH should remain isolated from collateral and fee accounting after the payout')
		})

		test('a zero-output complete-set mint reverts without retaining user ETH', async () => {
			const victim = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(1n)]: 3n,
						[formatStorageSlot(2n)]: 2n,
						[formatStorageSlot(5n)]: 1n,
					},
				},
			})
			await mockWindow.setBalance(securityPoolAddresses.securityPool, 2n)
			const victimBalanceBefore = await getETHBalance(client, victim.account.address)
			const poolBalanceBefore = await getETHBalance(client, securityPoolAddresses.securityPool)

			await assert.rejects(createCompleteSet(victim, securityPoolAddresses.securityPool, 1n), /Zero shares|Exchange rate undefined/)

			strictEqualTypeSafe(await getETHBalance(client, victim.account.address), victimBalanceBefore, 'a failed zero-output mint should refund all user ETH')
			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), poolBalanceBefore, 'a failed zero-output mint should not increase the pool balance')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 2n, 'a failed zero-output mint should not change collateral accounting')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 1n, 'a failed zero-output mint should not change share supply')
		})

		test('Open Interest Fees (non forking)', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			strictEqualTypeSafe(endTime > (await mockWindow.getTime()), true, 'question has already ended')
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			const aMonthFromNow = (await mockWindow.getTime()) + 2628000n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), securityPoolCoverageCommitmentAttoEth, 'coverage commitment')

			const openInterestAmount = 100n * 10n ** 18n
			await mockWindow.setTime(aMonthFromNow)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)

			await mockWindow.setTime(endTime + 10000n)

			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			const feesAccrued = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const ethBalanceAttoEthBefore = await getETHBalance(client, client.account.address)
			const securityVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(securityVault.coverageCommitmentAttoEth, securityPoolCoverageCommitmentAttoEth, 'Coverage commitment')
			const ethBalanceAttoEthAfter = await getETHBalance(client, client.account.address)
			strictEqualTypeSafe(ethBalanceAttoEthAfter - ethBalanceAttoEthBefore, securityVault.claimableFeesAttoEth, 'eth gained should be fees accrued')
			strictEqualTypeSafe(feesAccrued / 1000n, securityVault.claimableFeesAttoEth / 1000n, 'eth gained should be fees accrued (minus rounding issues)')
			const settlementCollateralAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(feesAccrued + settlementCollateralAttoEth, openInterestAmount, 'no eth lost')
			const timePassed = endTime - aMonthFromNow
			strictEqualTypeSafe(timePassed / 8640n, 3345n, 'not enough time passed')
			strictEqualTypeSafe(retentionRate, 999999987364000000n, 'retention rate did not match')
			const settlementCollateralAttoEthPercentage = Number((settlementCollateralAttoEth * 1000n) / openInterestAmount) / 10
			const expected = Number((1000n * rpow(retentionRate, timePassed, PRICE_PRECISION)) / PRICE_PRECISION) / 10
			strictEqualTypeSafe(settlementCollateralAttoEthPercentage, expected, 'return amount did not match')
			const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(contractBalance + ethBalanceAttoEthAfter - ethBalanceAttoEthBefore, openInterestAmount, 'contract balance + fees should equal initial open interest')
		})

		test('frequent public collateral updates do not strand extra fee residue', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 10n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			}
			await mockWindow.setTime(endTime + 10000n)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const splitVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const totalFeesOwed = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)

			assert.ok(totalFeesOwed > 0n, 'repeated public collateral updates should accrue nonzero fees in this setup')
			strictEqualTypeSafe(totalFeesOwed, splitVault.claimableFeesAttoEth, 'pool fee accounting should only record fees that the vault index can actually credit')
			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
			const remainingCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(contractBalance, remainingCollateral + (await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)), 'final fee settlement should leave every remaining attoETH in either collateral or redeemable fees')
		})

		test('frequent public collateral updates keep multi-vault fee accounting sweepable', async () => {
			const firstVaultCoverageCommitmentAttoEth = repDeposit / 8n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, firstVaultCoverageCommitmentAttoEth)

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			const secondVaultCoverageCommitmentAttoEth = repDeposit / 8n + 3n
			await manipulatePriceOracleAndPerformOperation(secondVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, secondVaultClient.account.address, secondVaultCoverageCommitmentAttoEth)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 10n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			}
			await mockWindow.setTime(endTime + 10000n)

			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			const totalFeesOwed = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const totalCreditedFees = firstVault.claimableFeesAttoEth + secondVault.claimableFeesAttoEth

			assert.ok(totalCreditedFees > 0n, 'repeated public collateral updates should accrue nonzero fees across both vaults in this setup')
			strictEqualTypeSafe(totalFeesOwed, totalCreditedFees, 'pool fee accounting should equal the sum of vault-creditable fees after both vaults sync')

			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			await redeemFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool), 0n, 'pool fee accounting should fully clear once every credited vault fee is redeemed')
		})

		test('final fork checkpoint returns aggregate-only fee dust to collateral after every vault syncs', async () => {
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, 1n * 10n ** 18n)
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n)
			await triggerExternalForkForSecurityPool(undefined, 'aggregate-only fee dust source')

			const firstVaultSlot = getMappingStorageSlot(client.account.address, 16n)
			const secondVaultSlot = getMappingStorageSlot(secondVaultClient.account.address, 16n)
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(6n)]: 0n,
						[formatStorageSlot(8n)]: PRICE_PRECISION / 2n,
						[formatStorageSlot(11n)]: 1n,
						[formatStorageSlot(12n)]: 2n,
						[formatStorageSlot(13n)]: 2n,
						[formatStorageSlot(firstVaultSlot + 1n)]: 1n,
						[formatStorageSlot(firstVaultSlot + 2n)]: 0n,
						[formatStorageSlot(firstVaultSlot + 3n)]: 0n,
						[formatStorageSlot(secondVaultSlot + 1n)]: 1n,
						[formatStorageSlot(secondVaultSlot + 2n)]: 0n,
						[formatStorageSlot(secondVaultSlot + 3n)]: 0n,
					},
				},
			})

			const collateralBeforeCheckpoints = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 1n, 'test setup should create one aggregate reserve attoETH while each vault remains below one attoETH')
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 1n, 'aggregate-only reserve must remain protected until every eligible vault checkpoints')
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 0n, 'final checkpoint should clear reserve attoETH that no vault can individually claim')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), collateralBeforeCheckpoints + 1n, 'non-claimable final reserve should return to parent collateral')
		})

		test('public vault fee checkpoints keep aggregate fees equal to vault-claimable fees', async () => {
			const vaultClients = [client, createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)]
			const coverageCommitmentAttoEthPerVault = (3n * 10n ** 18n) / 2n
			for (const vaultClient of vaultClients) {
				if (vaultClient.account.address !== client.account.address) {
					await approveAndDepositRepToVault(vaultClient, repDeposit, questionId)
				}
				await manipulatePriceOracleAndPerformOperation(vaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, vaultClient.account.address, coverageCommitmentAttoEthPerVault)
			}

			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), BigInt(vaultClients.length) * coverageCommitmentAttoEthPerVault, 'coverage commitment')

			const openInterestAmount = 1n * 10n ** 9n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 10n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			await mockWindow.advanceTime(1n)
			for (const vaultClient of vaultClients) {
				await updateVaultFees(client, securityPoolAddresses.securityPool, vaultClient.account.address)
			}

			const totalFeesOwed = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const vaults = await Promise.all(vaultClients.map(async vaultClient => await getSecurityVault(client, securityPoolAddresses.securityPool, vaultClient.account.address)))
			const totalCreditedVaultFees = vaults.reduce((sum, vault) => sum + vault.claimableFeesAttoEth, 0n)

			assert.ok(totalFeesOwed > 0n, 'the accrual step should produce a positive aggregate fee liability in this setup')
			assert.ok(totalCreditedVaultFees > 0n, 'fractional minimum-sized vaults should still receive some whole-attoETH fees in this setup')
			strictEqualTypeSafe(totalFeesOwed, totalCreditedVaultFees, 'coverage commitments')
		})

		test('coverage commitment', async () => {
			const firstVaultCoverageCommitmentAttoEth = repDeposit / 4n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, firstVaultCoverageCommitmentAttoEth)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 20n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			}

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, 0n)

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			const secondVaultCoverageCommitmentAttoEth = repDeposit / 4n + 3n
			await manipulatePriceOracleAndPerformOperation(secondVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, secondVaultClient.account.address, secondVaultCoverageCommitmentAttoEth)

			const collateralBeforeSecondAccrual = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)
			const expectedNextSecondDelta = collateralBeforeSecondAccrual - (collateralBeforeSecondAccrual * rpow(retentionRate, 1n, PRICE_PRECISION)) / PRICE_PRECISION

			await mockWindow.advanceTime(1n)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const secondVault = await getSecurityVault(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			assert.ok(secondVault.claimableFeesAttoEth <= expectedNextSecondDelta, 'coverage commitment')
		})

		test('coverage commitment', async () => {
			const firstVaultCoverageCommitmentAttoEth = repDeposit / 4n + 1n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, firstVaultCoverageCommitmentAttoEth)

			const openInterestAmount = 100n * 10n ** 18n
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - 40n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			}

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, 0n)
			const collateralAtZeroCoverageCommitmentAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)

			await mockWindow.advanceTime(30n)
			await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), collateralAtZeroCoverageCommitmentAttoEth, 'collateral should not decay while no vault backs the pool')

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			const secondVaultCoverageCommitmentAttoEth = repDeposit / 4n + 3n
			await manipulatePriceOracleAndPerformOperation(secondVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, secondVaultClient.account.address, secondVaultCoverageCommitmentAttoEth)

			const collateralBeforeSecondAccrual = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)
			const expectedNextSecondDelta = collateralBeforeSecondAccrual - (collateralBeforeSecondAccrual * rpow(retentionRate, 1n, PRICE_PRECISION)) / PRICE_PRECISION

			await mockWindow.advanceTime(1n)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const secondVault = await getSecurityVault(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			assert.ok(secondVault.claimableFeesAttoEth <= expectedNextSecondDelta, 'coverage commitment')
		})

		test('redeemCompleteSet exits at the fee-adjusted share exchange rate', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const redeemAmount = ensureDefined(firstHolderShares[0], 'first holder complete-set shares missing') / 2n
			const initialCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const initialShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			const initialAccruedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			assert.ok(initialAccruedFees > 0n, 'test setup should accrue open-interest fees before redemption')

			const balanceBeforeRedeem = await getETHBalance(client, firstHolder.account.address)
			await redeemCompleteSet(firstHolder, securityPoolAddresses.securityPool, redeemAmount)

			const collateralAfterRedeem = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const feesAfterRedeem = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - balanceBeforeRedeem
			const feeDelta = feesAfterRedeem - initialAccruedFees
			const firstHolderSharesAfterRedeem = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderSharesAfterRedeem = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const shareSupplyAfterRedeem = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			const feeDustTolerance = securityPoolCoverageCommitmentAttoEth / PRICE_PRECISION

			assert.ok(firstHolderPayout > 0n, 'redeeming complete sets should pay ETH to the holder')
			approximatelyEqual(collateralAfterRedeem + firstHolderPayout + feeDelta, initialCollateral, feeDustTolerance, 'complete-set redemption should conserve collateral after fee accrual up to bounded fee dust')
			strictEqualTypeSafe(shareSupplyAfterRedeem, initialShareSupply - redeemAmount, 'complete-set redemption should reduce share supply by the burned set amount')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[0], firstHolderShares[0] - redeemAmount, 'redeeming should burn the holders invalid-side share')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[1], firstHolderShares[1] - redeemAmount, 'redeeming should burn the holders yes-side share')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[2], firstHolderShares[2] - redeemAmount, 'redeeming should burn the holders no-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[0], secondHolderShares[0], 'redeeming should not burn another holders invalid-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[1], secondHolderShares[1], 'redeeming should not burn another holders yes-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[2], secondHolderShares[2], 'redeeming should not burn another holders no-side share')
			strictEqualTypeSafe(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, shareSupplyAfterRedeem), collateralAfterRedeem, 'remaining complete sets should keep the fee-adjusted exchange rate')
		})

		test('can set coverage commitment, mint complete sets and fork happily', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), securityPoolCoverageCommitmentAttoEth, 'coverage commitment')

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, forkThresholdAttoRep * 2n)

			const openInterestAmount = 100n * 10n ** 18n
			const maxGasFees = openInterestAmount / 4n
			const ethBalanceAttoEth = await getETHBalance(client, client.account.address)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			assert.ok((await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)) > 0n, 'contract did not record collateral after minting complete sets')
			const completeSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
			strictEqualTypeSafe(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
			strictEqualTypeSafe(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
			strictEqualTypeSafe(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, completeSetBalances[0]), openInterestAmount, 'Did not create enough complete sets')
			assert.ok(ethBalanceAttoEth - (await getETHBalance(client, client.account.address)) > maxGasFees, 'Did not lose eth to create complete sets')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
			await redeemCompleteSet(client, securityPoolAddresses.securityPool, completeSetBalances[0])
			assert.ok(ethBalanceAttoEth - (await getETHBalance(client, client.account.address)) < maxGasFees, 'Did not get ETH back from complete sets')
			const newCompleteSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
			strictEqualTypeSafe(newCompleteSetBalances[0], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(newCompleteSetBalances[1], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(newCompleteSetBalances[2], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets')

			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			const settlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const repBalanceAttoRep = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)

			// forking
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.ok(forkData.auctionableRepAtForkAttoRep > 0n, 'rep at fork should stay positive after the own-game fork')
			assert.ok(forkData.auctionableRepAtForkAttoRep <= repBalanceAttoRep + forkThresholdAttoRep * 2n, 'rep at fork should stay bounded by the REP that actually participated in the own-game fork')
			strictEqualTypeSafe(forkData.migratedRepAttoRep, 0n, 'migrated rep should be 0 so far')
			strictEqualTypeSafe(forkData.outcomeIndex, 0n, 'there should be no outcome')
			strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')
			const totalClaimableVaultFeesAttoEthRightAfterFork = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
			strictEqualTypeSafe(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), "Parent's original rep is gone")
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
			const migratedRepAttoRep = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(migratedRepAttoRep, 0n, 'escalation-only wallet claims should not count as migrated child-pool REP')
			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const yesStateAfterStart = await getSystemState(client, yesSecurityPool.securityPool)
			let externalAuctionCollateral = 0n
			if (yesStateAfterStart === SystemState.ForkTruthAuction) {
				const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
				const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtForkAttoRep
				const yesEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
				externalAuctionCollateral = yesEthRaiseCap
				await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repAtFork / 2n, yesEthRaiseCap)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(yesStateAfterStart, SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately when no child collateral remains to buy')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should become operational after the truth auction finalizes')

			const totalCollateral = (await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)) + (await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool))
			assert.ok(totalCollateral <= settlementCollateralAtForkAttoEth + externalAuctionCollateral, 'forked collateral should stay bounded by parent collateral at fork plus externally funded truth-auction ETH')

			const totalClaimableVaultFeesAttoEthAfterFork = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			assert.ok(totalClaimableVaultFeesAttoEthAfterFork >= totalClaimableVaultFeesAttoEthRightAfterFork, 'parent fee accounting should remain readable after the fork path settles child state')
		})

		test('redeemShares updates security-pool accounting as winning shares are redeemed', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

			const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const firstWinningShares = ensureDefined(firstHolderShares[1], 'first holder winning shares missing')
			const secondWinningShares = ensureDefined(secondHolderShares[1], 'second holder winning shares missing')
			const initialCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const initialShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			const initialAccruedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			assert.ok(initialCollateral > 0n, 'collateral should be positive before finalization')
			strictEqualTypeSafe(initialShareSupply, firstWinningShares + secondWinningShares, 'share supply should equal the minted winning-share balances')

			await finalizeQuestionAsYesWithoutFork()
			const firstHolderBalanceBeforeRedemption = await getETHBalance(client, firstHolder.account.address)
			await redeemShares(firstHolder, securityPoolAddresses.securityPool)

			const collateralAfterFirstRedemption = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const feesAfterFirstRedemption = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - firstHolderBalanceBeforeRedemption
			const feeDelta = feesAfterFirstRedemption - initialAccruedFees
			const feeDustTolerance = securityPoolCoverageCommitmentAttoEth / PRICE_PRECISION

			assert.ok(feeDelta > 0n, 'first redemption should accrue open-interest fees')
			approximatelyEqual(collateralAfterFirstRedemption + firstHolderPayout + feeDelta, initialCollateral, feeDustTolerance, 'collateral should shrink by fees and first winning redemption up to bounded fee dust')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), initialShareSupply - firstWinningShares, 'share supply should shrink after first winning redemption')
			approximatelyEqual(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, secondWinningShares), collateralAfterFirstRedemption, 10n, 'remaining winning shares should not be double counted')

			await redeemShares(secondHolder, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'collateral should be empty after all winning shares are redeemed')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'share supply should be empty after all winning shares are redeemed')
		})

		test('redeemShares reserves collateral for winning shares that migrate after child redemption begins', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 1n)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)
			const secondHolderParentShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const secondWinningShares = ensureDefined(secondHolderParentShares[1], 'second holder parent winning shares missing')
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational after migration accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'own-fork yes child should resolve as yes')

			const childCollateralBeforeRedemption = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeRedemption = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			const firstHolderChildShares = await balanceOfShares(firstHolder, yesSecurityPool.shareToken, yesUniverse, firstHolder.account.address)
			const firstHolderWinningShares = ensureDefined(firstHolderChildShares[1], 'migrated yes child winning shares missing')
			const secondHolderChildShares = await balanceOfShares(secondHolder, yesSecurityPool.shareToken, yesUniverse, secondHolder.account.address)

			assert.ok(childCollateralBeforeRedemption > 0n, `child branch should hold collateral before redemption: ${childCollateralBeforeRedemption}`)
			strictEqualTypeSafe(childShareSupplyBeforeRedemption, firstHolderWinningShares + secondWinningShares, 'child pricing supply should reserve every fork-time parent claim')
			strictEqualTypeSafe(ensureDefined(secondHolderChildShares[1], 'second holder yes child winning shares missing'), 0n, 'second holder should not have migrated winning shares into the child')

			const firstHolderBalanceBeforeRedemption = await getETHBalance(client, firstHolder.account.address)
			await redeemShares(firstHolder, yesSecurityPool.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - firstHolderBalanceBeforeRedemption

			const expectedFirstHolderPayout = (childCollateralBeforeRedemption * firstHolderWinningShares) / (firstHolderWinningShares + secondWinningShares)
			strictEqualTypeSafe(firstHolderPayout, expectedFirstHolderPayout, 'the early migrant should receive only its fork-time share of child collateral')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), childCollateralBeforeRedemption - expectedFirstHolderPayout, 'late winning claims should retain their collateral reserve')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), secondWinningShares, 'redemption should consume economic claims instead of replacing them with materialized supply')

			await migrateShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			const lateMigratedShares = await balanceOfShares(secondHolder, yesSecurityPool.shareToken, yesUniverse, secondHolder.account.address)
			strictEqualTypeSafe(ensureDefined(lateMigratedShares[1], 'late migrated winning shares missing'), secondWinningShares, 'source winning shares should remain migratable after child activation and redemption')
			await redeemShares(secondHolder, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'late winning redemption should consume the remaining child collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), 0n, 'all fork-time economic claims should be consumed after both holders redeem')
		})

		test('redeemShares accrues open-interest fees before paying winning shares', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const openInterestAmount = 10n * 10n ** 18n
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			const balanceBefore = await getETHBalance(client, openInterestHolder.account.address)

			await finalizeQuestionAsYesWithoutFork()
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)

			const balanceAfter = await getETHBalance(client, openInterestHolder.account.address)
			const accruedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const payout = balanceAfter - balanceBefore

			assert.ok(accruedFees > 0n, 'redeemShares should accrue fees before paying winning shares')
			assert.ok(payout < openInterestAmount, 'winner payout should be net of accrued fees')
			approximatelyEqual(payout + accruedFees, openInterestAmount, 1000n, 'payout plus fees should conserve open interest')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'all collateral should be consumed after sole winning redemption')
		})

		test('attoSharesToAttoEth returns zero for stale non-winning shares after all winning shares are redeemed', async () => {
			const completeSetAmountAttoShares = 1n * 10n ** 18n
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, completeSetAmountAttoShares)
			await finalizeQuestionAsYesWithoutFork()
			const shareBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address)
			const winningSharesAttoShares = ensureDefined(shareBalances[1], 'winning shares should exist before redemption')
			const winningShareSettlementCollateralAttoEth = await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, winningSharesAttoShares)

			assert.ok(winningShareSettlementCollateralAttoEth > 0n, 'winning shares should map to positive settlement collateral before redemption')
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining share supply')
			strictEqualTypeSafe(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, winningSharesAttoShares), 0n, 'once winning supply is exhausted, leftover losing shares should no longer map to any settlement collateral')

			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'repeat winning redemption should remain a no-op once collateral is exhausted')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'repeat winning redemption should preserve zero resolved share supply')
		})

		test('redeemShares and redeemRepFromVault stay available after an unrelated late fork once the question has finalized', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

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
			const sourceBalancesBeforeRejectedMigration = await balanceOfShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address)
			const assertFinalizedMarketMigrationRejected = async (boundary: string, rejection: RegExp) => {
				for (const sourceOutcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
					await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, sourceOutcome, [QuestionOutcome.Yes]), rejection, `${boundary}: finalized source outcome ${sourceOutcome.toString()} must not migrate`)
				}
				await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]), rejection, `${boundary}: finalized winning shares must not split across child outcomes`)
				assert.deepStrictEqual(await balanceOfShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address), sourceBalancesBeforeRejectedMigration, `${boundary}: rejected migration must preserve every funded source outcome balance`)
			}

			await assertFinalizedMarketMigrationRejected('immediately after the unrelated fork', /Resolved|resolved before fork/i)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes]), /Resolved|resolved before fork/i, 'at the migration deadline: funded finalized winning shares must not migrate')
			assert.deepStrictEqual(await balanceOfShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address), sourceBalancesBeforeRejectedMigration, 'at the migration deadline: rejected migration must preserve every funded source outcome balance')
			await mockWindow.setTime(migrationDeadline)
			await assertFinalizedMarketMigrationRejected('after the universe-level migration period', /Resolved|resolved before fork/i)
			const walletRepBeforeClaims = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should still complete after the unrelated fork')

			await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
			const walletRepAfterEscrowSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
			const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

			strictEqualTypeSafe(vaultAfterRedeem.vaultRepBackingAttoRep, 0n, 'rep redemption should still empty the vault after the unrelated fork')
			strictEqualTypeSafe(vaultAfterRedeem.disputeStakedRepAttoRep, 0n, 'rep redemption should leave no escrowed REP after the unrelated fork')
			strictEqualTypeSafe(walletRepAfterEscrowSettlement - walletRepBeforeClaims, reportBond, 'escrow settlement should return dispute-staked REP after the unrelated fork')
			strictEqualTypeSafe(walletRepAfterRedeem - walletRepAfterEscrowSettlement, repDeposit - reportBond, 'rep redemption should return vault-held REP after the unrelated fork')
		})
	})

	describe('multi-pool and scalar share migration', () => {
		test('two security pools with disagreement', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const openInterestAmount = 10n * 10n ** 18n
			const openInterestArray = [openInterestAmount, openInterestAmount, openInterestAmount]
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, attackerClient.account.address, securityPoolCoverageCommitmentAttoEth)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n

			const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
			const burnAmount = zoltarForkThreshold / 5n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
			assert.ok(repBalanceInGenesisPool > 0n, 'genesis pool should contain rep before the fork')
			assert.ok((await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool)) > 0n, 'coverage commitment should be non-zero')
			strictEqual18Decimal(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), repBalanceInGenesisPool * PRICE_PRECISION, 'REP backing units denominator should equal `pool balance * PRICE_PRECISION` prior fork')

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			assert.deepStrictEqual(await balanceOfSharesInAttoEth(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Did not create enough complete sets')
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkParentCollateralAtFork = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			// we migrate to yes
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const yesPoolBalance = await getERC20Balance(client, await getRepToken(client, yesSecurityPool.securityPool), yesSecurityPool.securityPool)
			assert.ok((await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, yesVault.vaultRepBackingAttoRep)) > 0n, 'the yes-side vault should still retain positive pool-held child REP backing')
			const migratedRepInYes = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			assert.ok(migratedRepInYes > 0n, 'yes pool should track migrated REP')
			assert.ok(migratedRepInYes < yesPoolBalance, 'migrated rep should stay below the full child REP balance when escrow payouts are carved out separately')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'yes is finalized')
			assert.ok((await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)) > 0n, 'yes child should retain some child-universe REP after migration')

			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'yes security pool exist')
			// attacker migrated to No
			const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
			const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, statoblastSecurityMultiplierBps)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
			strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'finalized as no')
			const migratedRepInNo = await getMigratedRepAttoRep(client, noSecurityPool.securityPool)
			assert.ok(migratedRepInNo > 0n, 'the no-side child should track some migrated REP')
			assert.ok((await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool)) > 0n, 'no child should retain some child-universe REP after migration')
			const parentEth = await getETHBalance(client, securityPoolAddresses.securityPool)
			const yesEth = await getETHBalance(client, yesSecurityPool.securityPool)
			const noEth = await getETHBalance(client, noSecurityPool.securityPool)
			const parentFees = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const yesFees = await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool)
			const noFees = await getTotalClaimableVaultFeesAttoEth(client, noSecurityPool.securityPool)
			assert.ok(parentEth + yesEth + noEth >= parentFees + yesFees + noFees, 'forked ETH should stay sufficient to cover the remaining fee liabilities across all pools')

			// invalid, no one migrated here
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid) // no one migrated, we need to create the universe as rep holders did not
			const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
			const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, statoblastSecurityMultiplierBps)

			const parentSettlementCollateralAttoEthAfterVaultMigrations = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			assert.deepStrictEqual(
				await balanceOfSharesInAttoEth(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])),
				openInterestArray.map(() => parentSettlementCollateralAttoEthAfterVaultMigrations),
				'Shares exist after fork',
			)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			const getCurrentOpenInterestArray = async (): Promise<[bigint, bigint, bigint]> => {
				const currentFees = (await getTotalAccruedFees(client, securityPoolAddresses.securityPool)) + (await getTotalAccruedFees(client, yesSecurityPool.securityPool))
				const result = openInterestArray.map(x => x - currentFees) as [bigint, bigint, bigint]
				return result
			}

			// auction yes
			const poolRepAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const auctionedEthInYes = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInYes) / poolRepAtForkAttoRep
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			let yesAuctionTick: bigint | undefined
			let yesAuctionEthRaiseCap = 0n
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				yesAuctionEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
				approximatelyEqual(yesAuctionEthRaiseCap, auctionedEthInYes, 10n, 'Need to buy half of open interest on yes')
				yesAuctionTick = await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, poolRepAtForkAttoRep / 4n, auctionedEthInYes)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			// auction no
			const auctionedEthInNo = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInNo) / poolRepAtForkAttoRep
			await startTruthAuction(client, noSecurityPool.securityPool)
			const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			let noAuctionTick: bigint | undefined
			let noAuctionEthRaiseCap = 0n
			if ((await getSystemState(client, noSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				noAuctionEthRaiseCap = await getEthRaiseCapAttoEth(client, noSecurityPool.truthAuction)
				approximatelyEqual(noAuctionEthRaiseCap, auctionedEthInNo, 10n, 'Need to buy half of open interest on no')
				noAuctionTick = await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, (poolRepAtForkAttoRep * 3n) / 4n, auctionedEthInNo)
			} else {
				strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'no child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, noSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			// auction invalid
			await startTruthAuction(client, invalidSecurityPool.securityPool)
			const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
			let invalidAuctionTick: bigint | undefined
			if ((await getSystemState(client, invalidSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				approximatelyEqual(await getEthRaiseCapAttoEth(client, invalidSecurityPool.truthAuction), ownForkParentCollateralAtFork, 10n, 'Need to buy all of open interest on invalid')
				invalidAuctionTick = await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, poolRepAtForkAttoRep - burnAmount - poolRepAtForkAttoRep / 1_000_000n, ownForkParentCollateralAtFork)
			} else {
				strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'invalid child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, invalidSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			await mockWindow.advanceTime(7n * DAY + DAY)

			// yes status: auction fully funds, 1/4 of rep balance is sold for eth
			if (yesAuctionTick !== undefined) {
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			const actualShares = await balanceOfSharesInAttoEth(client, yesSecurityPool.securityPool, yesSecurityPool.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualShares.length, 3, 'should have 3 outcomes')
			const yesChildCollateral = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			actualShares.forEach((value, idx) => approximatelyEqual(value, yesChildCollateral, 1000000000000000n, `share ${idx} should approximately equal the current yes child collateral`))

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
			let yesAuctionParticipantRep = 0n
			if (yesAuctionTick !== undefined) {
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address, [{ tick: yesAuctionTick, bidIndex: 0n }])
				const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
				yesAuctionParticipantRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.vaultRepBackingAttoRep)
				const yesClearingPrice = tickToPrice(yesAuctionTick)
				const expectedYesRep = (yesAuctionEthRaiseCap * 1_000_000_000_000_000_000n) / yesClearingPrice
				approximatelyEqual(yesAuctionParticipantRep, expectedYesRep, 1_000n, 'yes auction participant should get expected REP')
			}

			const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const originalYesVaultRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, originalYesVault.vaultRepBackingAttoRep)
			assert.ok(originalYesVaultRep > yesAuctionParticipantRep, 'original yes vault holder should retain the majority of REP backingUnits after the auction')
			strictEqualTypeSafe((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).vaultRepBackingAttoRep, 0n, 'attacker should have zero as they did not migrate to yes')

			const balancePriorYesRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, yesSecurityPool.securityPool)
			const currentShares = await getCurrentOpenInterestArray()
			const actualSharesAfterRedeem = await balanceOfSharesInAttoEth(client, yesSecurityPool.securityPool, securityPoolAddresses.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualSharesAfterRedeem[1], 0n, 'share1 should be zero')
			assert.strictEqual(actualSharesAfterRedeem[2], 0n, 'non-winning no shares should be worthless after the only winning claimant redeems')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorYesRedeemal + yesChildCollateral, 10n ** 15n, 'did not gain eth after redeeming yes shares')

			// no status: auction fully funds, 3/4 of rep balance is sold for eth
			if (noAuctionTick !== undefined) {
				await finalizeTruthAuction(client, noSecurityPool.securityPool)
			}
			const actualNoShares = await balanceOfSharesInAttoEth(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
			const noChildCollateral = await getSettlementCollateralAttoEth(client, noSecurityPool.securityPool)
			approximatelyEqual(actualNoShares[0], noChildCollateral, noChildCollateral, 'no share0 should be approximately expected')
			approximatelyEqual(actualNoShares[1], noChildCollateral, noChildCollateral, 'no share1 should be approximately expected')
			approximatelyEqual(actualNoShares[2], noChildCollateral, noChildCollateral, 'no share2 should be approximately expected')

			strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')

			// Read purchasedRep for no auction participant

			if (noAuctionTick !== undefined) {
				await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address, [{ tick: noAuctionTick, bidIndex: 0n }])
				const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
				const noAuctionParticipantRep = await backingUnitsToAttoRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.vaultRepBackingAttoRep)
				const noClearingPrice = tickToPrice(noAuctionTick)
				const expectedNoRep = (noAuctionEthRaiseCap * 1_000_000_000_000_000_000n) / noClearingPrice
				approximatelyEqual(noAuctionParticipantRep, expectedNoRep, 1_000n, 'no auction participant should get expected REP')
			}

			const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
			const originalNoVaultRep = await backingUnitsToAttoRep(client, noSecurityPool.securityPool, originalNoVault.vaultRepBackingAttoRep)
			approximatelyEqual(originalNoVaultRep, (repBalanceInGenesisPool * 1n) / 4n - burnAmount, repBalanceInGenesisPool, 'original no vault holder should hold rest 1/4 of rep')
			strictEqualTypeSafe((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).vaultRepBackingAttoRep, 0n, 'client should have zero as they did not migrate to no')
			const balancePriorNoRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, noSecurityPool.securityPool)
			const actualNoSharesAfterRedeem = await balanceOfSharesInAttoEth(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualNoSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualNoSharesAfterRedeem[1], 0n, 'non-winning yes shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualNoSharesAfterRedeem[2], 0n, 'no after redeem share2 should be zero')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorNoRedeemal + noChildCollateral, openInterestAmount, 'did not gain eth after redeeming no shares')

			// invalid status: auction 3/4 funds for all REP (minus 1/100 000). Open interest holders lose 50%
			if (invalidAuctionTick !== undefined) {
				await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
			}
			const actualInvalidShares = await balanceOfSharesInAttoEth(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
			const invalidChildCollateral = await getSettlementCollateralAttoEth(client, invalidSecurityPool.securityPool)
			approximatelyEqual(actualInvalidShares[0], invalidChildCollateral, invalidChildCollateral, 'invalid share0 should match')
			approximatelyEqual(actualInvalidShares[1], invalidChildCollateral, invalidChildCollateral, 'invalid share1 should match')
			approximatelyEqual(actualInvalidShares[2], invalidChildCollateral, invalidChildCollateral, 'invalid share2 should match')
			strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')

			// Read purchasedRep for invalid auction participant

			if (invalidAuctionTick !== undefined) {
				await claimAuctionProceeds(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address, [{ tick: invalidAuctionTick, bidIndex: 0n }])
				const invalidAuctionParticipantVault = await getSecurityVault(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)
				const invalidAuctionParticipantRep = await backingUnitsToAttoRep(client, invalidSecurityPool.securityPool, invalidAuctionParticipantVault.vaultRepBackingAttoRep)
				const invalidClearingPrice = tickToPrice(invalidAuctionTick)
				const expectedInvalidRep = (ownForkParentCollateralAtFork * 1_000_000_000_000_000_000n) / invalidClearingPrice
				approximatelyEqual(invalidAuctionParticipantRep, expectedInvalidRep, 1_000n, 'invalid auction participant should get expected REP')
			}

			// Resolved child pools must not accept new complete sets.
			const openInterestHolder2 = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			const additionalInvalidCompleteSetAmount = ensureDefined(currentShares[0], 'currentShares[0] is undefined')
			if (additionalInvalidCompleteSetAmount > 0n) {
				await assert.rejects(createCompleteSet(openInterestHolder2, invalidSecurityPool.securityPool, additionalInvalidCompleteSetAmount), /Resolved|Fork await/)
			}

			const balancePriorInvalidRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, invalidSecurityPool.securityPool)
			const actualInvalidSharesAfterRedeem1 = await balanceOfSharesInAttoEth(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualInvalidSharesAfterRedeem1[0], 0n, 'redeeming invalid shares should consume the winning invalid leg')
			assert.ok(actualInvalidSharesAfterRedeem1[1] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
			assert.ok(actualInvalidSharesAfterRedeem1[2] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorInvalidRedeemal + invalidChildCollateral, openInterestAmount * 1000n, 'did not gain eth after redeeming invalid shares')
		})

		test('preserves source share entitlements for independently timed scalar child migrations', async () => {
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
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, openInterestAmount)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, scalarQuestionId)

			const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
			const middleScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
			const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
			const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			for (const outcome of [...sortedScalarOutcomes, middleScalarOutcome]) {
				await createChildUniverse(client, securityPoolAddresses.securityPool, outcome)
			}
			const holderAddress = addressString(TEST_ADDRESSES[2])
			const parentBalancesBeforeMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			const parentYesBalance = ensureDefined(parentBalancesBeforeMigration[1], 'parent yes balance is undefined')
			const parentYesTokenId = await client.readContract({
				address: securityPoolAddresses.shareToken,
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'getTokenId',
				args: [genesisUniverse, QuestionOutcome.Yes],
			})

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, sortedScalarOutcomes)

			const parentBalancesAfterMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			strictEqualTypeSafe(parentBalancesAfterMigration[1], parentYesBalance, 'parent yes shares should remain as persistent child-claim entitlements')

			const lowScalarUniverse = getChildUniverseId(genesisUniverse, lowScalarOutcome)
			const lowScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, lowScalarUniverse, holderAddress)
			strictEqualTypeSafe(lowScalarBalances[0], 0n, 'invalid shares should stay at zero in the low scalar child universe')
			strictEqualTypeSafe(lowScalarBalances[1], parentYesBalance, 'yes shares should migrate into the low scalar child universe')
			strictEqualTypeSafe(lowScalarBalances[2], 0n, 'no shares should stay at zero in the low scalar child universe')
			strictEqualTypeSafe(
				await client.readContract({
					address: securityPoolAddresses.shareToken,
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					functionName: 'getMigratedShareAmountAttoShares',
					args: [parentYesTokenId, lowScalarUniverse, holderAddress],
				}),
				parentYesBalance,
				'the low child materialization should equal its persistent source entitlement',
			)

			const highScalarUniverse = getChildUniverseId(genesisUniverse, highScalarOutcome)
			const highScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, highScalarUniverse, holderAddress)
			strictEqualTypeSafe(highScalarBalances[0], 0n, 'invalid shares should stay at zero in the high scalar child universe')
			strictEqualTypeSafe(highScalarBalances[1], parentYesBalance, 'yes shares should migrate into the high scalar child universe')
			strictEqualTypeSafe(highScalarBalances[2], 0n, 'no shares should stay at zero in the high scalar child universe')
			strictEqualTypeSafe(
				await client.readContract({
					address: securityPoolAddresses.shareToken,
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					functionName: 'getMigratedShareAmountAttoShares',
					args: [parentYesTokenId, highScalarUniverse, holderAddress],
				}),
				parentYesBalance,
				'the high child materialization should equal its persistent source entitlement',
			)

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [middleScalarOutcome])
			const middleScalarUniverse = getChildUniverseId(genesisUniverse, middleScalarOutcome)
			const middleScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, middleScalarUniverse, holderAddress)
			strictEqualTypeSafe(middleScalarBalances[1], parentYesBalance, 'a later child selection should materialize the source entitlement independently')
			strictEqualTypeSafe(
				await client.readContract({
					address: securityPoolAddresses.shareToken,
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					functionName: 'getMigratedShareAmountAttoShares',
					args: [parentYesTokenId, middleScalarUniverse, holderAddress],
				}),
				parentYesBalance,
				'the later child materialization should equal its persistent source entitlement',
			)
			for (const childUniverse of [lowScalarUniverse, middleScalarUniverse, highScalarUniverse]) {
				const childYesTokenId = await client.readContract({
					address: securityPoolAddresses.shareToken,
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					functionName: 'getTokenId',
					args: [childUniverse, QuestionOutcome.Yes],
				})
				strictEqualTypeSafe(
					await client.readContract({
						address: securityPoolAddresses.shareToken,
						abi: peripherals_tokens_ShareToken_ShareToken.abi,
						functionName: 'totalSupply',
						args: [childYesTokenId],
					}),
					parentYesBalance,
					'each selected child supply should equal the independently materialized source entitlement',
				)
			}
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [middleScalarOutcome]), /ShareToken has no new shares to migrate/)

			await assert.rejects(
				openInterestHolder.writeContract({
					address: securityPoolAddresses.shareToken,
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					functionName: 'safeTransferFrom',
					args: [holderAddress, addressString(TEST_ADDRESSES[3]), parentYesTokenId, parentYesBalance],
				}),
				/ShareToken migrated source balance is locked/,
			)
		})

		test('rejects malformed and missing-child bulk targets while lazily creating one migration child', async () => {
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
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, openInterestAmount)
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

			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [5n]), /ShareToken target outcome is malformed for the fork question/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome, validScalarOutcome]), /ShareToken target outcomes must be provided in strictly increasing order/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [...sortedScalarOutcomes].reverse()), /ShareToken target outcomes must be provided in strictly increasing order/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, sortedScalarOutcomes), /ShareToken bulk migration requires canonical child pools/)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'rejected bulk migration should roll back automatic source-pool fork initiation')

			const parentBalancesAfterFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			strictEqualTypeSafe(parentBalancesAfterFailedMigrations[1], parentYesBalance, 'failed migrations should preserve the parent yes share balance')

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome])
			const lazilyCreatedUniverse = getChildUniverseId(genesisUniverse, validScalarOutcome)
			const lazilyCreatedBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, lazilyCreatedUniverse, holderAddress)
			strictEqualTypeSafe(lazilyCreatedBalances[1], parentYesBalance, 'a single missing target should create its canonical child and materialize the source balance')
		})

		test('can fork zero rep pools', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			for (let withdrawalIndex = 0n; withdrawalIndex < 5n; withdrawalIndex++) {
				const withdrawalAmount = withdrawalIndex === 4n ? repDeposit : repDeposit / 5n
				await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, withdrawalAmount)
				if (withdrawalIndex < 4n) await mockWindow.advanceTime(10n * 60n)
			}
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
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration needs to start')
			const migratedRepAttoRep = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(migratedRepAttoRep, 0n, 'correct amount rep migrated')
			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'child contract did not record the amount correctly')
		})
	})

	describe('child pool recovery', () => {
		test('redeemRepFromVault removes redeemed backingUnits from the child pool denominator once the child pool is operational', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
			const attackerClaimBeforeRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.vaultRepBackingAttoRep)
			const denominatorBeforeRedeem = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)

			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)

			const clientVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const denominatorAfterRedeem = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)
			const attackerClaimAfterRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.vaultRepBackingAttoRep)

			strictEqualTypeSafe(clientVaultAfterRedeem.vaultRepBackingAttoRep, 0n, 'redeeming a vault should zero out its child-REP backing units')
			assert.ok(denominatorAfterRedeem <= denominatorBeforeRedeem, 'redeeming a vault should not increase the child pool denominator')
			approximatelyEqual(attackerClaimAfterRedeem, attackerClaimBeforeRedeem, 10n, 'redeeming another vault should preserve the remaining vault claim up to rounding')
			await assert.rejects(redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address), /No redeemable REP/)
		})

		test('parent pool halts on fork while a migrated child can resume operational flows', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'parent pool should enter PoolForked after the universe fork is activated')
			await assert.rejects(depositRepToVault(client, securityPoolAddresses.securityPool, 1n), /Universe forked|Forked/)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtForkAttoRep
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
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
			assert.ok(childVaultBeforeRedeem.vaultRepBackingAttoRep > 0n, 'child migration should create redeemable vault backingUnits')
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			const childVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(childVaultAfterRedeem.vaultRepBackingAttoRep, 0n, 'operational child pool should allow redeemed backingUnits to clear')
		})

		test('child pool prices complete sets against all fork-time claims after balanced partial migration', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 2n * DAY)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const parentCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, parentCoverageCommitmentAttoEth)
			const migratedParentMintAmount = 5n * 10n ** 18n
			const unmigratedHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await createCompleteSet(client, securityPoolAddresses.securityPool, migratedParentMintAmount)
			await createCompleteSet(unmigratedHolder, securityPoolAddresses.securityPool, 5n * 10n ** 18n)
			const parentForkTimeShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)

			await triggerExternalForkForSecurityPool(undefined, 'complete-set child mint fork source')
			await approveToken(newMinter, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await addRepToMigrationBalance(newMinter, genesisUniverse, repDeposit)
			await splitMigrationRep(newMinter, genesisUniverse, repDeposit, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should wait in migration state before accounting is settled')
			await assert.rejects(createCompleteSet(client, yesSecurityPool.securityPool, 1n), /Pool not operational|Pool inactive/)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'partially migrated child pool should price unsettled accounting through a truth auction')
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtForkAttoRep
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(expectedEthToBuy > 0n, true, 'partial migration should leave ETH for the truth auction to buy')
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational after truth-auction accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.None, 'unrelated fork should leave the child pool question unresolved')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, yesSecurityPool.securityPool), parentCoverageCommitmentAttoEth, 'child pool should inherit the parent coverage commitment before minting new sets')

			const childMintAmount = 1n * 10n ** 18n
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const childCollateralBeforeMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(childShareSupplyBeforeMint, parentForkTimeShareSupply, 'child exchange-rate supply should reserve every fork-time parent claim')
			const outcomeSuppliesBeforeMint = await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse)
			const migratedCompleteSetSupply = migratedParentMintAmount * PRICE_PRECISION
			assert.deepStrictEqual(outcomeSuppliesBeforeMint, [migratedCompleteSetSupply, migratedCompleteSetSupply, migratedCompleteSetSupply], 'partial migration should materialize only the migrated ERC-1155 claims')

			await createCompleteSet(newMinter, yesSecurityPool.securityPool, childMintAmount)

			const childCollateralAfterMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			assert.ok(childCollateralAfterMint > childCollateralBeforeMint, 'child complete-set mint should increase collateral after fork accounting is settled')
			assert.ok(childCollateralAfterMint <= childCollateralBeforeMint + childMintAmount, 'child complete-set mint should accrue fees before adding new collateral')
			const updatedCollateralBeforeMint = childCollateralAfterMint - childMintAmount
			const expectedMintedShares = updatedCollateralBeforeMint === 0n ? childMintAmount * PRICE_PRECISION : (childMintAmount * childShareSupplyBeforeMint) / updatedCollateralBeforeMint
			const childShareSupplyAfterMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(childShareSupplyAfterMint, childShareSupplyBeforeMint + expectedMintedShares, 'child complete-set mint should add shares at the settled exchange rate')
			const materializedSupplyAfterMint = migratedCompleteSetSupply + expectedMintedShares
			assert.deepStrictEqual(await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse), [materializedSupplyAfterMint, materializedSupplyAfterMint, materializedSupplyAfterMint], 'successful child minting should add balanced materialized claims without erasing the late-migration reserve')

			await manipulatePriceOracle(newMinter, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer)
			await approveToken(newMinter, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)
			await depositRepToVault(newMinter, yesSecurityPool.securityPool, repDeposit / 10n)
			await depositToEscalationGame(newMinter, yesSecurityPool.securityPool, QuestionOutcome.Yes, reportBond)
			await mockWindow.advanceTime(10n * DAY)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should resolve as yes')

			const newMinterBalanceBeforeRedemption = await getETHBalance(client, newMinter.account.address)
			await redeemShares(newMinter, yesSecurityPool.securityPool)
			const newMinterPayout = (await getETHBalance(client, newMinter.account.address)) - newMinterBalanceBeforeRedemption
			assert.ok(newMinterPayout <= childMintAmount, `post-fork complete-set minter must not capture preexisting collateral: deposited ${childMintAmount}, redeemed ${newMinterPayout}`)
		})

		test('an uneven child mints and redeems complete sets against fork-time economic claims', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 2n * DAY)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const parentCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, parentCoverageCommitmentAttoEth)

			const parentMintAmount = 10n * 10n ** 18n
			const imbalancingMintAmount = 1n
			const imbalancer = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await createCompleteSet(client, securityPoolAddresses.securityPool, parentMintAmount)
			await createCompleteSet(imbalancer, securityPoolAddresses.securityPool, imbalancingMintAmount)
			const parentForkTimeShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			await triggerExternalForkForSecurityPool(undefined, 'uneven-share child mint fork source')
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateShares(imbalancer, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should be operational after fork accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.None, 'unrelated fork should leave the child question unresolved')
			assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) > 0n, 'test setup requires preexisting child collateral')
			const migratedBalances = await balanceOfShares(client, yesSecurityPool.shareToken, yesUniverse, client.account.address)
			strictEqualTypeSafe(ensureDefined(migratedBalances[0], 'invalid child balance missing'), parentMintAmount * PRICE_PRECISION, 'balanced holder should migrate invalid shares')
			strictEqualTypeSafe(ensureDefined(migratedBalances[1], 'yes child balance missing'), parentMintAmount * PRICE_PRECISION, 'yes supply should migrate unevenly')
			strictEqualTypeSafe(ensureDefined(migratedBalances[2], 'no child balance missing'), parentMintAmount * PRICE_PRECISION, 'balanced holder should migrate no shares')
			const economicSupplyBeforeMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			const migratedBalancedSupply = parentMintAmount * PRICE_PRECISION
			const migratedOutcomeSupplies = await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse)
			const migratedMaximumSupply = ensureDefined(migratedOutcomeSupplies[1], 'yes child supply missing')
			strictEqualTypeSafe(migratedOutcomeSupplies[0], migratedBalancedSupply, 'invalid supply should belong to the balanced holder')
			assert.ok(migratedMaximumSupply > migratedBalancedSupply, 'one-sided migration should make yes the maximum outcome supply')
			strictEqualTypeSafe(migratedOutcomeSupplies[2], migratedBalancedSupply, 'no supply should belong to the balanced holder')
			strictEqualTypeSafe(economicSupplyBeforeMint, parentForkTimeShareSupply, 'child accounting should use all fork-time parent claims as its solvency denominator')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await createCompleteSet(newMinter, yesSecurityPool.securityPool, 1n * 10n ** 18n)
			const collateralBeforeRedemption = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const supplyBeforeRedemption = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			assert.ok(supplyBeforeRedemption > economicSupplyBeforeMint, 'new complete sets should add economic claims even when migrated outcome supplies are uneven')
			const expectedRedemption = (collateralBeforeRedemption * migratedBalancedSupply) / supplyBeforeRedemption
			const balanceBeforeRedemption = await getETHBalance(client, client.account.address)
			await redeemCompleteSet(client, yesSecurityPool.securityPool, migratedBalancedSupply)
			strictEqualTypeSafe((await getETHBalance(client, client.account.address)) - balanceBeforeRedemption, expectedRedemption, 'balanced holder should redeem proportionally against all economic claims')

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralBeforeRedemption - expectedRedemption, 'redemption should debit only the proportional collateral payout')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), supplyBeforeRedemption - migratedBalancedSupply, 'redemption should reduce the economic claim denominator by the burned complete sets')
			const balancesAfterRedemption = await balanceOfShares(client, yesSecurityPool.shareToken, yesUniverse, client.account.address)
			strictEqualTypeSafe(balancesAfterRedemption[0], 0n, 'redemption should burn the holder invalid balance')
			strictEqualTypeSafe(balancesAfterRedemption[1], 0n, 'redemption should burn the holder yes balance')
			strictEqualTypeSafe(balancesAfterRedemption[2], 0n, 'redemption should burn the holder no balance')
		})

		test('child pool prices new complete sets from fork-time claims when no shares migrated', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 2n * DAY)
			const parentCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, parentCoverageCommitmentAttoEth)

			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await triggerExternalForkForSecurityPool(undefined, 'orphan-collateral child mint fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should be operational after fork accounting settles')
			assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) > 0n, 'test setup requires collateral without migrated shares')
			const forkTimeShareSupply = 10n * 10n ** 18n * PRICE_PRECISION
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), forkTimeShareSupply, 'zero migration should preserve the parent fork-time economic claims')
			assert.deepStrictEqual(await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse), [0n, 0n, 0n], 'economic claims should not require materialized child ERC-1155 balances')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			const collateralBeforeMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			await createCompleteSet(newMinter, yesSecurityPool.securityPool, 1n * 10n ** 18n)
			const mintedOutcomeSupplies = await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse)
			const mintedCompleteSets = ensureDefined(mintedOutcomeSupplies[0], 'new invalid child shares missing')
			assert.ok(mintedCompleteSets > 0n, 'fork-time economic claims should define a nonzero child exchange rate')
			assert.deepStrictEqual(mintedOutcomeSupplies, [mintedCompleteSets, mintedCompleteSets, mintedCompleteSets], 'post-fork complete-set minting should materialize balanced new claims')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), forkTimeShareSupply + mintedCompleteSets, 'new complete sets should add to the reserved economic claim supply')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralBeforeMint + 1n * 10n ** 18n, 'successful minting should add its collateral without exposing the preexisting reserve')
		})

		test('child pool with migrated shares but no collateral activates after settlement while still rejecting complete-set minting', async () => {
			const parentCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, parentCoverageCommitmentAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const parentMintAmount = 10n * 10n ** 18n
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, parentMintAmount)

			await triggerExternalForkForSecurityPool(undefined, 'zero-collateral child complete-set fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'an uncollateralized child must remain in its repair phase')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'test setup requires a zero-collateral child')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), parentMintAmount * PRICE_PRECISION, 'test setup requires migrated child complete-set shares')
			assert.deepStrictEqual(await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse), [parentMintAmount * PRICE_PRECISION, parentMintAmount * PRICE_PRECISION, parentMintAmount * PRICE_PRECISION], 'balanced migrated shares should match nominal supply even when collateral is still zero')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, yesSecurityPool.securityPool), 0n, 'inactive child financials must not expose parent mint capacity before repair')
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'ended settlement must release the child from truth-auction state even with no accepted bid ETH')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const childCollateralBeforeFailedMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeFailedMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
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
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), childCollateralBeforeFailedMint, 'failed child mint should not add collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), childShareSupplyBeforeFailedMint, 'failed child mint should not mint shares')
		})

		test('can claim parent escalation deposits before migrateVault', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const parentVaultBeforeEscalationClaim = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeEscalationClaim = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const migratedRepBeforeEscalation = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const yesVaultRepAfterEscalationClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, yesVault.vaultRepBackingAttoRep)
			const migratedRepAttoRep = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const walletRepAfterEscalationClaim = await getERC20Balance(client, yesChildRepToken, client.account.address)

			assert.ok(migratedRepAttoRep > 0n, 'some REP should be tracked as migrated')
			assert.ok(migratedRepAttoRep >= migratedRepBeforeEscalation, 'later vault migration should not reduce child migrated REP accounting')
			assert.ok(walletRepAfterEscalationClaim > walletRepBeforeEscalationClaim, 'claiming an own-fork escalation deposit should pay child REP directly to the wallet')
			assert.ok(parentVaultAfterMigration.disputeStakedRepAttoRep < parentVaultBeforeEscalationClaim.disputeStakedRepAttoRep, 'claiming a winning parent escalation deposit should reduce the parent escalation escrow')
			assert.ok(yesVault.vaultRepBackingAttoRep > 0n, 'vault migration should still create child REP backing units for pool-held REP')
			assert.ok(yesVaultRepAfterEscalationClaim > 0n, 'vault migration should create pool-held child-vault REP backing')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).vaultRepBackingAttoRep, 0n, 'parent vault should be emptied after migration')
		})
	})

	describe('vault and REP migration', () => {
		test('coverage commitment', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			const migratingVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(migratingVaultClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(migratingVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, migratingVaultClient.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await mockWindow.advanceTime(30n * DAY)

			const endTime = await getQuestionEndDate(client, questionId)
			if ((await mockWindow.getTime()) <= endTime) await mockWindow.setTime(endTime + 1n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			await assertVaultMigrationPreservesParentFees(migratingVaultClient, async () => {
				await migrateVault(migratingVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			})
		})

		test('coverage commitment', async () => {
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			const migratingVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(migratingVaultClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(migratingVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, migratingVaultClient.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await mockWindow.advanceTime(30n * DAY)
			await triggerExternalForkForSecurityPool(undefined, 'external parent fee checkpoint source')

			await assertVaultMigrationPreservesParentFees(migratingVaultClient, async () => {
				await migrateVault(migratingVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			})
		})

		test('createChildUniverse allows the exact external-fork migration deadline and rejects one second later', async () => {
			await triggerExternalForkForSecurityPool(undefined, 'external child creation deadline source')
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			strictEqualTypeSafe(await getRepToken(client, yesSecurityPool.securityPool), getRepTokenAddress(yesUniverse), 'createChildUniverse should still deploy the requested child branch at the inclusive external-fork deadline')

			await mockWindow.setTime(migrationDeadline + 1n)
			await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No), /(Migration closed|Own-fork window closed)/i)
		})

		test('createChildUniverse allows the exact own-fork migration deadline and rejects one second later', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			strictEqualTypeSafe(await getRepToken(client, yesSecurityPool.securityPool), getRepTokenAddress(yesUniverse), 'createChildUniverse should still deploy the requested own-fork child branch at the inclusive migration deadline')

			// Child creation mines at the inclusive deadline; the next transaction is one second later.
			await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No), /(Migration closed|Own-fork window closed)/i)
		})

		test('migrateShares remains available for an existing child after the migration deadline', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, openInterestAmount)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await triggerExternalForkForSecurityPool(undefined, 'share migration deadline source')
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY

			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

			const migratedYesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const migratedYesBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, migratedYesUniverse, openInterestHolder.account.address)
			assert.ok(ensureDefined(migratedYesBalances[1], 'migrated yes balance missing') > 0n, 'share migration should still succeed at the inclusive deadline')

			await mockWindow.setTime(migrationDeadline + 1n)

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			const lateMigratedBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, migratedYesUniverse, openInterestHolder.account.address)
			strictEqualTypeSafe(ensureDefined(lateMigratedBalances[2], 'late migrated no balance missing'), openInterestAmount * PRICE_PRECISION, 'unredeemed source shares should materialize in an existing child after the fork deadline')
		})

		test('migrateRepToZoltar should fund an already-created child pool with pool-held vault REP backing in own-fork mode', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			const poolHeldVaultRepBackingAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const childRepToken = getRepTokenAddress(yesUniverse)
			const forkerBalance = await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker)
			const childPoolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)

			strictEqualTypeSafe(forkerBalance, 0n, 'forker should not retain child REP after migrating to an already-created child pool')
			strictEqualTypeSafe(childPoolBalance, poolHeldVaultRepBackingAtForkAttoRep, 'child pool should receive only the pool-held vault REP backing in own-fork mode')
		})

		test('migrateRepToZoltar rejects after the migration window closes', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const migrationDeadline = (await mockWindow.getTime()) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline + 1n)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
			const migrationProxy = await getMigrationProxyAddress()
			const readClosedMigrationState = async () => ({
				childExists: await contractExists(client, yesChildPool),
				migrationBalance: await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxy),
				parentForkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
				parentRep: await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool),
			})
			const stateBefore = await readClosedMigrationState()

			await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /Closed/)
			assert.deepStrictEqual(await readClosedMigrationState(), stateBefore, 'closed migration must preserve the parent fork, proxy migration balance, REP, and child nondeployment')
		})

		test('migrateRepToZoltar allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childRepToken = getRepTokenAddress(yesUniverse)
			const poolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			assert.ok(poolBalance > 0n, 'migrateRepToZoltar should still split child REP at the inclusive migration deadline')
		})

		test('migrateRepToZoltar rejects once the child branch is already priced', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.setTime((await mockWindow.getTime()) + 60n * DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /Child closed/)
		})

		test('migrateVault preserves parent escalation claim state', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const winningDeposit = repDeposit / 2n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])
			const vaultAfterEscalationClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(vaultAfterEscalationClaim.vaultRepBackingAttoRep, 0n, 'own-fork escalation claims should not mint child backingUnits')
			strictEqualTypeSafe(vaultAfterEscalationClaim.coverageCommitmentAttoEth, 0n, 'claiming own-fork escalation should not migrate the parent coverage commitment')

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const vaultAfterVaultMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok(vaultAfterVaultMigration.vaultRepBackingAttoRep > 0n, 'migrateVault should populate child backingUnits from the unlocked parent vault state')
			strictEqualTypeSafe(vaultAfterVaultMigration.coverageCommitmentAttoEth, securityPoolCoverageCommitmentAttoEth, 'migrateVault should preserve the already-migrated parent coverage commitment')
		})

		test('migrateVault allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok(childVault.vaultRepBackingAttoRep > 0n, 'migrateVault should still migrate backingUnits at the inclusive deadline')
		})

		test('migrateVault allows the exact external-fork migration deadline and rejects one second later', async () => {
			const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(parentVaultBeforeFork.vaultRepBackingAttoRep > 0n, 'test setup should leave parent-vault REP backing units before the external fork')
			await triggerExternalForkForSecurityPool(undefined, 'external vault migration deadline source')

			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok(childVault.vaultRepBackingAttoRep > 0n, 'migrateVault should still move non-escrowed vault REP backing units at the inclusive external-fork deadline')

			await mockWindow.setTime(migrationDeadline + 1n)
			await assert.rejects(migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes), /migration window closed/i)
		})

		test('migrateVault cumulatively transfers external-fork collateral for multiple vaults', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const migratingVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(migratingVaultClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(migratingVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, migratingVaultClient.account.address, securityPoolCoverageCommitmentAttoEth)
			const settlementCollateralAttoEth = 1n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)

			const forkSourceData = {
				...questionData,
				title: 'non-own fork collateral source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceData, outcomes)
			await createQuestion(migratingVaultClient, forkSourceData, outcomes)
			await mockWindow.setTime(forkSourceData.endTime + 1n)
			await approveToken(migratingVaultClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(migratingVaultClient, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'this should be a non-own fork')

			const parentSettlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const migrationSnapshot = await mockWindow.anvilSnapshot()
			const runMigrationOrder = async (firstVaultClient: typeof client, secondVaultClient: typeof client) => {
				const parentEthBefore = await getETHBalance(client, securityPoolAddresses.securityPool)
				const childEthBefore = await getETHBalance(client, yesSecurityPool.securityPool)
				await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				await migrateVault(firstVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				const firstTransfer = (await getETHBalance(client, yesSecurityPool.securityPool)) - childEthBefore
				assert.ok(firstTransfer > 0n && firstTransfer < parentSettlementCollateralAtForkAttoEth, 'first of two external-fork vaults should transfer a strict collateral fraction')
				const secondMigrationHash = await migrateVault(secondVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				const secondMigrationReceipt = await client.getTransactionReceipt({ hash: secondMigrationHash })
				const migrationCheckpointLog = secondMigrationReceipt.logs
					.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
					.map(log =>
						decodeEventLog({
							abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
							data: log.data,
							topics: log.topics,
						}),
					)
					.find(log => log.eventName === 'VaultMigrationCheckpoint')
				if (migrationCheckpointLog === undefined) throw new Error('external VaultMigrationCheckpoint log missing')
				return {
					childTransfer: (await getETHBalance(client, yesSecurityPool.securityPool)) - childEthBefore,
					eventCollateralTransferred: migrationCheckpointLog.args.cumulativeSettlementCollateralTransferredAttoEth,
					parentSettlementCollateralAttoEth: await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool),
					parentTransfer: parentEthBefore - (await getETHBalance(client, securityPoolAddresses.securityPool)),
				}
			}

			const forwardOrder = await runMigrationOrder(client, migratingVaultClient)
			await mockWindow.anvilRevert(migrationSnapshot)
			const reverseOrder = await runMigrationOrder(migratingVaultClient, client)
			for (const result of [forwardOrder, reverseOrder]) {
				strictEqualTypeSafe(result.parentTransfer, parentSettlementCollateralAtForkAttoEth, 'migrating all external-fork vault REP should transfer the complete fork collateral snapshot')
				strictEqualTypeSafe(result.childTransfer, parentSettlementCollateralAtForkAttoEth, 'cumulative external-fork transfers should fund the child with the complete snapshot in either order')
				strictEqualTypeSafe(result.eventCollateralTransferred, parentSettlementCollateralAtForkAttoEth, 'the fork-neutral transfer event should report the complete external-fork cumulative collateral')
				strictEqualTypeSafe(result.parentSettlementCollateralAttoEth, 0n, 'complete external-fork migration should leave no parent collateral')
			}
		})

		test('external-fork truth auction repairs the snapshot collateral missing after partial vault migration', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const unmigratedVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(unmigratedVaultClient, repDeposit, questionId)
			await mockWindow.advanceTime(10n * 60n)
			await manipulatePriceOracleAndPerformOperation(unmigratedVaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, unmigratedVaultClient.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			const forkSourceData = {
				...questionData,
				title: 'external partial migration auction source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceData, outcomes)
			await createQuestion(unmigratedVaultClient, forkSourceData, outcomes)
			await mockWindow.setTime(forkSourceData.endTime + 1n)
			await approveToken(unmigratedVaultClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(unmigratedVaultClient, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const parentSettlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const migratedCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const expectedAuctionCollateral = parentSettlementCollateralAtForkAttoEth - migratedCollateral

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'partial external migration should require a truth auction')
			strictEqualTypeSafe(await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction), expectedAuctionCollateral, 'truth auction should price the missing share from the fixed fork collateral snapshot')
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, forkData.auctionableRepAtForkAttoRep / 2n, expectedAuctionCollateral)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const repairedCollateral = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const tickRoundingTolerance = expectedAuctionCollateral / 10_000n
			approximatelyEqual(repairedCollateral, migratedCollateral + expectedAuctionCollateral, tickRoundingTolerance, 'auction proceeds should add the missing snapshot collateral up to bounded tick-price rounding')
			approximatelyEqual(repairedCollateral, parentSettlementCollateralAtForkAttoEth, tickRoundingTolerance, 'partial migration plus truth auction should reconstruct the fork collateral snapshot up to bounded tick-price rounding')
		})

		test('directly forking the pool question preserves child branch semantics', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'direct Zoltar fork should not use own-fork accounting')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'matching-question child should resolve to its branch outcome')
		})

		test('nested universe fork rejects a child pool that is still in fork migration with Inactive', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const firstForkQuestion = {
				...questionData,
				title: 'outer fork while child remains in migration',
			}
			const firstForkQuestionId = getQuestionId(firstForkQuestion, outcomes)
			await createQuestion(client, firstForkQuestion, outcomes)
			const migrationAmount = (await getZoltarForkThreshold(client, genesisUniverse)) * 2n
			const repDonor = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await transferRepToAddress(repDonor, client.account.address, migrationAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, firstForkQuestionId)

			await addRepToMigrationBalance(client, genesisUniverse, migrationAmount)
			await splitMigrationRep(client, genesisUniverse, migrationAmount, [QuestionOutcome.Yes])
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			strictEqualTypeSafe(await getSystemState(client, yesChildPool.securityPool), SystemState.ForkMigration, 'nested-fork target child must remain in ForkMigration')
			const childRepToken = getRepTokenAddress(yesUniverse)
			const secondForkQuestion = {
				...questionData,
				title: 'inner fork against inactive child pool',
				endTime: await mockWindow.getTime(),
			}
			const secondForkQuestionId = getQuestionId(secondForkQuestion, outcomes)
			await createQuestion(client, secondForkQuestion, outcomes)
			await approveToken(client, childRepToken, getZoltarAddress())
			await forkUniverse(client, yesUniverse, secondForkQuestionId)

			const readInactiveForkState = async () => ({
				childPoolRep: await getERC20Balance(client, childRepToken, yesChildPool.securityPool),
				childState: await getSystemState(client, yesChildPool.securityPool),
				childUniverse: await getUniverseData(client, yesUniverse),
				childVault: await getSecurityVault(client, yesChildPool.securityPool, client.account.address),
				forkData: await getSecurityPoolForkerForkData(client, yesChildPool.securityPool),
				walletChildRep: await getERC20Balance(client, childRepToken, client.account.address),
			})
			const stateBefore = await readInactiveForkState()

			await assert.rejects(initiateSecurityPoolFork(client, yesChildPool.securityPool), /Inactive/)
			assert.deepStrictEqual(await readInactiveForkState(), stateBefore, 'inactive nested-fork rejection must preserve child state, fork data, REP balances, and vault accounting')
		})

		test('a fixed-outcome child rejects every recursive fork without burning funded shares', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, repDeposit / 4n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, 0n)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

			const fixedChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const fixedChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, fixedChildUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, fixedChildPool.securityPool)
			if ((await getSystemState(client, fixedChildPool.securityPool)) === SystemState.ForkTruthAuction) {
				const repairTarget = await getEthRaiseCapAttoEth(client, fixedChildPool.truthAuction)
				const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
				await participateAuction(client, fixedChildPool.truthAuction, parentForkData.auctionableRepAtForkAttoRep / 4n, repairTarget)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, fixedChildPool.securityPool)
			}
			strictEqualTypeSafe(await getSystemState(client, fixedChildPool.securityPool), SystemState.Operational, 'fixed child should be operational before the unrelated recursive fork')
			strictEqualTypeSafe(await getQuestionOutcome(client, fixedChildPool.securityPool), QuestionOutcome.Yes, 'matching first fork should fix the child outcome to yes')
			const childRepToken = await getRepToken(client, fixedChildPool.securityPool)
			const childForkThreshold = await getZoltarForkThreshold(client, fixedChildUniverse)
			const childBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[childBalanceSlot]: childForkThreshold * 4n,
					},
				},
			})
			await approveToken(client, childRepToken, fixedChildPool.securityPool)
			await depositRepToVault(client, fixedChildPool.securityPool, childForkThreshold * 3n)
			await manipulatePriceOracle(client, mockWindow, fixedChildPool.priceOracleManagerAndOperatorQueuer, PRICE_PRECISION)
			const fixedChildEscalationGameBeforeDeposit = await getSecurityPoolsEscalationGame(client, fixedChildPool.securityPool)
			const fixedChildGameRepBeforeDeposit = fixedChildEscalationGameBeforeDeposit === zeroAddress ? 0n : await getERC20Balance(client, childRepToken, fixedChildEscalationGameBeforeDeposit)
			const fixedChildPoolRepBeforeDeposit = await getERC20Balance(client, childRepToken, fixedChildPool.securityPool)
			const fixedChildVaultBeforeDeposit = await getSecurityVault(client, fixedChildPool.securityPool, client.account.address)
			const fixedChildBackingUnitsBeforeDeposit = await getTotalRepBackingUnits(client, fixedChildPool.securityPool)
			await assert.rejects(depositToEscalationGame(client, fixedChildPool.securityPool, QuestionOutcome.Yes, childForkThreshold), /Resolved/)
			const fixedChildEscalationGameAfterDeposit = await getSecurityPoolsEscalationGame(client, fixedChildPool.securityPool)
			strictEqualTypeSafe(fixedChildEscalationGameAfterDeposit, fixedChildEscalationGameBeforeDeposit, 'a fixed child should reject before deploying or replacing its escalation game')
			strictEqualTypeSafe(fixedChildEscalationGameAfterDeposit === zeroAddress ? 0n : await getERC20Balance(client, childRepToken, fixedChildEscalationGameAfterDeposit), fixedChildGameRepBeforeDeposit, 'a rejected fixed-child report must not transfer REP into the escalation game')
			strictEqualTypeSafe(await getERC20Balance(client, childRepToken, fixedChildPool.securityPool), fixedChildPoolRepBeforeDeposit, 'a rejected fixed-child report must preserve pool-held REP')
			assert.deepStrictEqual(await getSecurityVault(client, fixedChildPool.securityPool, client.account.address), fixedChildVaultBeforeDeposit, 'a rejected fixed-child report must preserve vault backingUnits and escrow')
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, fixedChildPool.securityPool), fixedChildBackingUnitsBeforeDeposit, 'a rejected fixed-child report must preserve aggregate backingUnits')
			await assert.rejects(
				client.simulateContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					address: fixedChildPool.securityPool,
					functionName: 'activateForkMode',
					args: [],
					account: getInfraContractAddresses().securityPoolForker,
				}),
				/Resolved/,
			)

			const unrelatedForkQuestionData = {
				...questionData,
				title: 'unrelated recursive fork against a fixed child',
				endTime: await mockWindow.getTime(),
			}
			const unrelatedForkQuestionId = getQuestionId(unrelatedForkQuestionData, outcomes)
			await createQuestion(client, unrelatedForkQuestionData, outcomes)
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[childBalanceSlot]: childForkThreshold * 2n,
					},
				},
			})
			await approveToken(client, childRepToken, getZoltarAddress())
			await forkUniverse(client, fixedChildUniverse, unrelatedForkQuestionId)

			const sourceBalancesBeforeRejectedMigration = await balanceOfShares(openInterestHolder, fixedChildPool.shareToken, fixedChildUniverse, openInterestHolder.account.address)
			assert.ok(ensureDefined(sourceBalancesBeforeRejectedMigration[1], 'fixed child winning balance missing') > 0n, 'test setup should preserve funded winning shares in the fixed child')
			await assert.rejects(initiateSecurityPoolFork(client, fixedChildPool.securityPool), /Resolved/)
			await assert.rejects(migrateShares(openInterestHolder, fixedChildPool.shareToken, fixedChildUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes]), /Resolved/)
			await assert.rejects(migrateShares(openInterestHolder, fixedChildPool.shareToken, fixedChildUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]), /Resolved/)
			assert.deepStrictEqual(await balanceOfShares(openInterestHolder, fixedChildPool.shareToken, fixedChildUniverse, openInterestHolder.account.address), sourceBalancesBeforeRejectedMigration, 'rejected scalar and bulk migrations must preserve every funded source balance')
			strictEqualTypeSafe(await getSystemState(client, fixedChildPool.securityPool), SystemState.Operational, 'rejected recursive fork attempts must leave the fixed child operational')

			const collateralBeforeRedemption = await getSettlementCollateralAttoEth(client, fixedChildPool.securityPool)
			const holderBalanceBeforeRedemption = await getETHBalance(client, openInterestHolder.account.address)
			await redeemShares(openInterestHolder, fixedChildPool.securityPool)
			assert.ok((await getETHBalance(client, openInterestHolder.account.address)) > holderBalanceBeforeRedemption, 'funded winning shares should remain redeemable after the rejected recursive fork')
			assert.ok(collateralBeforeRedemption > 0n, 'fixed child should hold funded collateral before redemption')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, fixedChildPool.securityPool), 0n, 'winning redemption should consume the fixed child collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, fixedChildPool.securityPool), 0n, 'winning redemption should consume the fixed child supply')
			const vaultRepBeforeRedemption = await getERC20Balance(client, childRepToken, client.account.address)
			await redeemRepFromVault(client, fixedChildPool.securityPool, client.account.address)
			assert.ok((await getERC20Balance(client, childRepToken, client.account.address)) > vaultRepBeforeRedemption, 'fixed-child vault REP should remain redeemable after every rejected deposit and fork path')
			strictEqualTypeSafe((await getSecurityVault(client, fixedChildPool.securityPool, client.account.address)).vaultRepBackingAttoRep, 0n, 'fixed-child REP redemption should consume the vault backingUnits claim')
		})

		test('a fixed-outcome child rejects recycling a redeemed complete set through a recursive matching fork', async () => {
			const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const victim = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const victimClaimAmount = 5n * 10n ** 18n
			const attackerMintAmount = 4n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, repDeposit / 4n)
			await createCompleteSet(victim, securityPoolAddresses.securityPool, victimClaimAmount)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			await migrateShares(victim, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(victim, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])

			const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, firstChildPool.securityPool)
			if ((await getSystemState(client, firstChildPool.securityPool)) === SystemState.ForkTruthAuction) {
				const repairTarget = await getEthRaiseCapAttoEth(client, firstChildPool.truthAuction)
				const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
				const winningTick = await participateAuction(client, firstChildPool.truthAuction, parentForkData.auctionableRepAtForkAttoRep / 4n, repairTarget)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, firstChildPool.securityPool)
				// The recursive-share scenario needs real assigned capacity. An unclaimed
				// auction allocation has no responsible vault and cannot back this mint.
				await claimAuctionProceeds(client, firstChildPool.securityPool, client.account.address, [{ tick: winningTick, bidIndex: 0n }])
			}

			strictEqualTypeSafe(await getQuestionOutcome(client, firstChildPool.securityPool), QuestionOutcome.Yes, 'first matching fork should resolve the first child as yes')
			const victimFirstChildShares = await balanceOfShares(victim, firstChildPool.shareToken, firstChildUniverse, victim.account.address)
			const victimEconomicClaim = ensureDefined(victimFirstChildShares[1], 'victim yes shares missing from first child')
			const attackerBalanceBeforeMint = await getETHBalance(client, attacker.account.address)
			await createCompleteSet(attacker, firstChildPool.securityPool, attackerMintAmount)
			const attackerBalanceAfterMint = await getETHBalance(client, attacker.account.address)
			strictEqualTypeSafe(attackerBalanceBeforeMint - attackerBalanceAfterMint, attackerMintAmount, 'the attacker should fund the temporary complete set')
			const attackerFirstChildShares = await balanceOfShares(attacker, firstChildPool.shareToken, firstChildUniverse, attacker.account.address)
			const attackerRetainedNoShares = ensureDefined(attackerFirstChildShares[2], 'attacker no shares missing from first child')
			assert.ok(attackerRetainedNoShares > 0n, 'the resolved fixed-outcome child should mint the attacker a reusable losing balance')
			await redeemShares(attacker, firstChildPool.securityPool)
			const attackerFirstRedemption = (await getETHBalance(client, attacker.account.address)) - attackerBalanceAfterMint
			assert.ok(attackerFirstRedemption * 100n > attackerMintAmount * 99n, 'the attacker should recover more than 99% of the temporary complete-set deposit before recycling its losing share')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, firstChildPool.securityPool), victimEconomicClaim, 'the first redemption should leave only the victim economic claim')
			const victimCollateral = await getSettlementCollateralAttoEth(client, firstChildPool.securityPool)
			const accruedFeesBeforeRecursiveFork = await getTotalAccruedFees(client, firstChildPool.securityPool)
			assert.ok(victimCollateral > 0n, 'the first child should retain collateral for the victim')

			const firstChildRepToken = await getRepToken(client, firstChildPool.securityPool)
			const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
			const initialForkMigrationBalance = await getMigrationRepBalanceAttoRep(client, genesisUniverse, client.account.address)
			if (initialForkMigrationBalance < firstChildForkThreshold) {
				await addRepToMigrationBalance(client, genesisUniverse, firstChildForkThreshold - initialForkMigrationBalance)
			}
			await splitMigrationRep(client, genesisUniverse, firstChildForkThreshold, [QuestionOutcome.Yes])
			assert.ok((await getERC20Balance(client, firstChildRepToken, client.account.address)) >= firstChildForkThreshold, 'the fork initiator should hold a normally migrated child REP threshold')
			const firstChildRepTotalSupply = await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: firstChildRepToken,
				functionName: 'totalSupply',
			})
			assert.ok(firstChildRepTotalSupply >= firstChildForkThreshold, 'the normally migrated child REP supply should cover the recursive fork threshold')
			await approveToken(client, firstChildRepToken, getZoltarAddress())
			await forkUniverse(client, firstChildUniverse, questionId)
			await assert.rejects(initiateSecurityPoolFork(client, firstChildPool.securityPool), /Resolved/)
			await assert.rejects(migrateShares(attacker, firstChildPool.shareToken, firstChildUniverse, QuestionOutcome.No, [QuestionOutcome.No]), /Resolved/)
			strictEqualTypeSafe(await getSystemState(client, firstChildPool.securityPool), SystemState.Operational, 'the rejected recursive fork should leave the fixed child operational')
			strictEqualTypeSafe(await getQuestionOutcome(client, firstChildPool.securityPool), QuestionOutcome.Yes, 'the rejected recursive fork should preserve the fixed outcome')

			const victimBalanceBeforeRedemption = await getETHBalance(client, victim.account.address)
			await redeemShares(victim, firstChildPool.securityPool)
			const victimRedemption = (await getETHBalance(client, victim.account.address)) - victimBalanceBeforeRedemption
			const feesAccruedBeforeVictimRedemption = (await getTotalAccruedFees(client, firstChildPool.securityPool)) - accruedFeesBeforeRecursiveFork
			approximatelyEqual(victimRedemption + feesAccruedBeforeVictimRedemption, victimCollateral, 10n, 'the rejected recursive fork must preserve the victim reserve apart from ordinary retention fees')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, firstChildPool.securityPool), 0n, 'the victim redemption should consume the remaining economic claims')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, firstChildPool.securityPool), 0n, 'the victim redemption should consume the remaining collateral')
		})

		test('an unrelated fork followed by a matching fork installs the second branch outcome across a recursive continuation', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const opposingClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(opposingClient, repDeposit, questionId)
			const recursiveDeposit = 2n * reportBond
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, recursiveDeposit)
			await depositToEscalationGame(opposingClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, recursiveDeposit)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())

			const firstForkQuestionData = {
				...questionData,
				title: 'first unrelated recursive fixed-outcome source',
			}
			const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
			await createQuestion(client, firstForkQuestionData, outcomes)
			await forkUniverse(client, genesisUniverse, firstForkQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

			const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, statoblastSecurityMultiplierBps)
			const firstChildGame = await getSecurityPoolsEscalationGame(client, firstChildPool.securityPool)
			strictEqualTypeSafe(
				await client.readContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: firstChildGame,
					functionName: 'fixedQuestionOutcome',
				}),
				BigInt(QuestionOutcome.None),
				'an unrelated first fork should leave the first continuation without a fixed outcome',
			)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, firstChildPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, firstChildPool.securityPool), SystemState.Operational, 'first recursive child should become operational before its own fork')

			const firstChildRepToken = await getRepToken(client, firstChildPool.securityPool)
			const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
			const firstChildBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[firstChildRepToken]: {
					stateDiff: {
						[firstChildBalanceSlot]: firstChildForkThreshold * 2n,
					},
				},
			})

			await forkUniverse(client, firstChildUniverse, questionId)
			await initiateSecurityPoolFork(client, firstChildPool.securityPool)
			await migrateRepToZoltar(client, firstChildPool.securityPool, [QuestionOutcome.No])
			await migrateVaultWithUnresolvedEscalation(client, firstChildPool.securityPool, client.account.address, QuestionOutcome.No)

			const secondChildUniverse = getChildUniverseId(firstChildUniverse, QuestionOutcome.No)
			const secondChildPool = getSecurityPoolAddresses(firstChildPool.securityPool, secondChildUniverse, questionId, statoblastSecurityMultiplierBps)
			const secondChildGame = await getSecurityPoolsEscalationGame(client, secondChildPool.securityPool)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, secondChildPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, secondChildPool.securityPool), SystemState.Operational, 'second recursive child should become operational before final resolution')
			const secondChildGameEndDate = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: secondChildGame,
				functionName: 'getEscalationGameEndDate',
			})
			await mockWindow.setTime(secondChildGameEndDate + 1n)

			strictEqualTypeSafe(await getQuestionOutcome(client, secondChildPool.securityPool), QuestionOutcome.No, 'recursive child pool should retain the canonical matching-question outcome')
			strictEqualTypeSafe(await getQuestionResolution(client, secondChildGame), QuestionOutcome.No, 'recursive continuation game should settle against the same canonical outcome')
		})

		test('a direct same-question fork rejects carried deposits that lose in the selected child branch', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'a direct same-question Zoltar fork should leave ownFork false')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the zero-collateral child should auto-finalize without entering a live auction')
			for (let progressCall = 0; progressCall < 16 && (await getAwaitingForkContinuation(client, yesSecurityPool.securityPool)); progressCall++) {
				await writeContractAndWait(client, () =>
					client.writeContract({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						address: yesSecurityPool.securityPool,
						functionName: 'resumeForkedEscalationGame',
						args: [],
					}),
				)
			}
			strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'bounded continuation progress should complete before child settlement')
			const escalationEndDate = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: yesEscalationGame,
				functionName: 'getEscalationGameEndDate',
			})
			await mockWindow.setTime(escalationEndDate + 1n)

			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'the child pool should use the selected yes branch')
			strictEqualTypeSafe(await getQuestionResolution(client, yesEscalationGame), QuestionOutcome.Yes, 'the child game should use the same selected branch for settlement')

			const noProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
				expectedOutcome: QuestionOutcome.No,
				parentDepositIndex: 0n,
				leafIndex: 0n,
				merkleMountainRangePeakIndex: 0n,
				merkleMountainRangeSiblings: [],
				nullifierSiblings: new SparseNullifierTree().getProof(0n),
			})
			const canonicalSettlementSnapshot = await mockWindow.anvilSnapshot()
			await mockWindow.addStateOverrides({
				[yesEscalationGame]: {
					stateDiff: {
						[formatStorageSlot(444n)]: BigInt(QuestionOutcome.No),
					},
				},
			})
			strictEqualTypeSafe(await getQuestionResolution(client, yesEscalationGame), QuestionOutcome.No, 'storage override should create a divergent game-local payout result')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'storage override must leave the canonical child branch unchanged')
			await assert.rejects(
				client.writeContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'withdrawForkedEscalationDeposits',
					args: [QuestionOutcome.No, [noProof]],
				}),
				/Pool\/game outcome mismatch/,
			)
			await mockWindow.anvilRevert(canonicalSettlementSnapshot)
			strictEqualTypeSafe(await getQuestionResolution(client, yesEscalationGame), QuestionOutcome.Yes, 'reverting the mismatch override should restore the canonical game result')

			const childRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeClaim = await getERC20Balance(client, childRepToken, client.account.address)
			await assert.rejects(
				client.writeContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'withdrawForkedEscalationDeposits',
					args: [QuestionOutcome.No, [noProof]],
				}),
				/Not winning outcome/,
			)
			strictEqualTypeSafe(await getERC20Balance(client, childRepToken, client.account.address), walletRepBeforeClaim, 'a carried no deposit must not win from a yes child')
		})

		test('migrateVault transfers pool-held vault REP backing for own forks', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, 2n * 10n ** 18n)
			await mockWindow.setTime(endTime - 1n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 2n * 10n ** 18n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const parentEthBeforeMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentAccruedFeesBeforeMigration = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const parentSettlementCollateralAttoEthBeforeMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			assert.ok(
				parentEthBeforeMigration >= parentAccruedFeesBeforeMigration + parentSettlementCollateralAttoEthBeforeMigration,
				`parent accounting must be solvent before migration: balance ${parentEthBeforeMigration}, fees ${parentAccruedFeesBeforeMigration}, collateral ${parentSettlementCollateralAttoEthBeforeMigration}`,
			)

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentEthAfterMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			assert.ok(parentEthAfterMigration < parentEthBeforeMigration, `own-fork unlocked migration should transfer collateral out of the parent: balance ${parentEthBeforeMigration}, collateral ${parentSettlementCollateralAttoEthBeforeMigration}, fees ${parentAccruedFeesBeforeMigration}`)
			strictEqualTypeSafe(parentEthBeforeMigration - parentEthAfterMigration, childEthAfterMigration - childEthBeforeMigration, 'own-fork unlocked migration should move matching collateral into the child')
		})

		test('own-fork non-escrowed vault migration values child REP backing units against the vault REP bucket', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 1n)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)

			const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const parentDenominatorBeforeFork = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(ownForkRepBuckets.vaultRepAtForkAttoRep > 0n, 'test setup should leave pool-held vault REP backing at fork')
			assert.ok(ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep > 0n, 'test setup should include separate dispute-staked REP at fork')
			const expectedChildRepClaim = (parentVaultBeforeFork.vaultRepBackingAttoRep * ownForkRepBuckets.vaultRepAtForkAttoRep) / parentDenominatorBeforeFork

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const childRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, childVault.vaultRepBackingAttoRep)
			strictEqualTypeSafe(childRepClaim, expectedChildRepClaim, 'child vault backingUnits should redeem the full migrated vault REP bucket')
		})

		test('own-fork unlocked migration transfers all pool collateral when all vault REP migrates', async () => {
			const settlementCollateralAttoEth = 2n * 10n ** 18n
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, settlementCollateralAttoEth)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 1n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)
			await transferRepToAddress(client, securityPoolAddresses.securityPool, 5n)
			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(ownForkRepBuckets.vaultRepAtForkAttoRep > 0n, 'test setup should leave pool-held vault REP backing at fork')
			assert.ok(ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep > 0n, 'test setup should include separate dispute-staked REP at fork')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const parentSettlementCollateralAttoEthBeforeMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)

			await migrateVault(secondVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migrationHash = await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migrationReceipt = await client.getTransactionReceipt({ hash: migrationHash })
			const migrationCheckpointLog = migrationReceipt.logs
				.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'VaultMigrationCheckpoint')
			if (migrationCheckpointLog === undefined) throw new Error('own-fork VaultMigrationCheckpoint log missing')

			const parentSettlementCollateralAttoEthAfterMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			assert.ok(parentSettlementCollateralAttoEthBeforeMigration > 0n, `test setup should leave collateral available before migration: ${parentSettlementCollateralAttoEthBeforeMigration}`)
			strictEqualTypeSafe(parentSettlementCollateralAttoEthAfterMigration, 0n, 'all remaining pool collateral should leave the parent when all vault REP migrates')
			strictEqualTypeSafe(childEthAfterMigration - childEthBeforeMigration, parentSettlementCollateralAttoEthBeforeMigration, 'the child should receive the full remaining migrated pool collateral')
			strictEqualTypeSafe(migrationCheckpointLog.args.cumulativeSettlementCollateralTransferredAttoEth, parentSettlementCollateralAttoEthBeforeMigration, 'the migration checkpoint should report the complete own-fork cumulative collateral')
			strictEqualTypeSafe(await getMigratedRepAttoRep(client, yesSecurityPool.securityPool), ownForkRepBuckets.vaultRepAtForkAttoRep, 'complete own-fork backingUnits migration should reconcile donated REP rounding residue')
		})
	})

	describe('own-fork escalation claims', () => {
		test('own-fork closes parent escalation withdrawals and preserves escrowed REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * forkThresholdAttoRep)
			const originalWinningDeposit = reportBond + 1n
			const originalLosingDeposit = reportBond
			const triggerWinningDeposit = forkThresholdAttoRep - originalWinningDeposit
			const triggerLosingDeposit = forkThresholdAttoRep - originalLosingDeposit

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

			strictEqualTypeSafe(clientVaultAfterFork.disputeStakedRepAttoRep, clientVaultBeforeFork.disputeStakedRepAttoRep, 'the own-fork transition should preserve the fully locked winning-side parent REP before any claim or migration succeeds')
			strictEqualTypeSafe(attackerVaultAfterFork.disputeStakedRepAttoRep, attackerVaultBeforeFork.disputeStakedRepAttoRep, 'the losing-side vault lock should stay in the parent through the own-fork transition')
			strictEqualTypeSafe(clientVaultAfterFailedWithdrawal.disputeStakedRepAttoRep, clientVaultAfterFork.disputeStakedRepAttoRep, 'a blocked parent withdrawal should not release any winning-side REP after the own-fork closes the pool')
			strictEqualTypeSafe(attackerVaultAfterFailedWithdrawal.disputeStakedRepAttoRep, attackerVaultAfterFork.disputeStakedRepAttoRep, 'a blocked parent withdrawal should not release any losing-side REP after the own-fork closes the pool')
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

		test('claimForkedEscalationDeposits pays own-fork child REP to the wallet without REP backing units', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 2n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migratedBeforeEscalation = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const childCollateralBeforeEscalation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)

			const claimHash = await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const walletRepAfterEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const migratedAfterEscalation = await getMigratedRepAttoRep(client, yesSecurityPool.securityPool)
			const childCollateralAfterEscalation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
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
			const sourceRepClaimedFromGame = parentGameClaimLogs.reduce((total, log) => total + log.args.amountToWithdrawAttoRep, 0n)

			strictEqualTypeSafe(migratedAfterEscalation, migratedBeforeEscalation, 'own-fork escalation claim should not increase child pool migrated REP accounting')
			strictEqualTypeSafe(parentVaultBeforeMigration.disputeStakedRepAttoRep - parentVaultAfterMigration.disputeStakedRepAttoRep, 2n * winningDeposit, 'migration should clear exactly the winning deposits principal from the parent escalation escrow')
			strictEqualTypeSafe(childCollateralAfterEscalation, childCollateralBeforeEscalation, 'own-fork escalation claim should not transfer pool collateral')
			strictEqualTypeSafe(childVaultAfterMigration.vaultRepBackingAttoRep, 0n, 'own-fork escalation claim should not mint child REP backing units')
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
				parentGameClaimLogs.map(log => log.args.originalDepositAmountAttoRep),
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
			strictEqualTypeSafe(claimLog.args.sourceRepClaimedAttoRep, sourceRepClaimedFromGame, 'claim log should report the source REP claimed from the parent game')
			strictEqualTypeSafe(claimLog.args.walletRepPaidAttoRep, walletRepAfterEscalation - walletRepBeforeEscalation, 'claim log should report the child REP paid to the wallet')
			strictEqualTypeSafe(claimLog.args.ownFork, true, 'claim log should mark own-fork wallet payouts')
		})

		test('claimForkedEscalationDeposits uses the claim outcome when paying own-fork wallet REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit * 5n
			await approveAndDepositRepToVault(client, repDeposit * 10n, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
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
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const claimDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(claimDeadline + 1n)

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /execution reverted|Reverted without a reason/i)
		})

		test('claimForkedEscalationDeposits allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
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
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should be operational before late claim settlement')

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		})
	})
})
