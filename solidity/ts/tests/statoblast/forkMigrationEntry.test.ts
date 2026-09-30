import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { deployOriginSecurityPool, getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getQuestionResolution } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getRepToken, getSecurityPoolsEscalationGame, getSecurityVault, getSettlementCollateralAttoEth, getSystemState, getTotalRepBackingUnits } from '../../testSupport/simulator/utils/contracts/securityPool'
import {
	claimForkedEscalationDeposits,
	createChildUniverse,
	forkZoltarWithOwnEscalationGame,
	getForkedEscrowChildRepByOutcomeAndVault,
	getOwnForkRepBuckets,
	getQuestionOutcome,
	getSecurityPoolForkerForkData,
	initiateSecurityPoolFork,
	migrateRepToZoltar,
	migrateVault,
	migrateVaultWithUnresolvedEscalation,
} from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getLastPrice, getQuestionEndDate } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addRepToMigrationBalance, forkUniverse, getMigrationRepBalanceAttoRep, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPool_SecurityPool,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock,
	test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock,
} from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { reportBond, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, MAX_RETENTION_RATE, outcomes, transferRepToAddress, triggerExternalForkForSecurityPool, setupOwnForkWithEscrow, getYesChildPool } = fixture

	let mockWindow: StatoblastForkMigrationFixture['mockWindow']

	let client: StatoblastForkMigrationFixture['client']

	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']

	let questionData: StatoblastForkMigrationFixture['questionData']

	let questionId: StatoblastForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	const getMigrationProxyAddress = async () =>
		await client.readContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getMigrationProxyAddress',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddresses.securityPool],
		})

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
			strictEqualTypeSafe(await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxyAddress), forkData.auctionableAttoRepAtFork, 'unsolicited REP must not enter the pool migration ledger')
		})

		test.each(prefundedRepCases)('own fork initiation isolates prefunded REP for $name', async ({ amountAttoRep: prefundedRep }) => {
			const migrationProxyAddress = await getMigrationProxyAddress()
			const baselineSnapshot = await mockWindow.anvilSnapshot()
			const baseline = await setupOwnForkWithEscrow()

			await mockWindow.anvilRevert(baselineSnapshot)
			await transferRepToAddress(client, migrationProxyAddress, prefundedRep)
			const prefunded = await setupOwnForkWithEscrow()

			strictEqualTypeSafe(prefunded.forkData.auctionableAttoRepAtFork, baseline.forkData.auctionableAttoRepAtFork, 'unsolicited REP must not increase own-fork auctionable REP')
			strictEqualTypeSafe(prefunded.ownForkRepBuckets.vaultRepAtForkAttoRep, baseline.ownForkRepBuckets.vaultRepAtForkAttoRep, 'unsolicited REP must not increase vault migration backing')
			strictEqualTypeSafe(prefunded.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, baseline.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, 'unsolicited REP must not increase aggregate escalation carry backing')
			strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(genesisUniverse), migrationProxyAddress), prefundedRep, 'unsolicited REP should remain isolated as proxy surplus after the own fork')
			strictEqualTypeSafe(await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxyAddress), prefunded.forkData.auctionableAttoRepAtFork, 'unsolicited REP must not enter the own-fork migration ledger')
		})

		const startYesEscalationAfterQuestionEnd = async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
			return await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate', address: securityPoolAddresses.escalationGame, args: [] })
		}

		test('allows delayed fork initialization for an escalation game unresolved at the universe fork', async () => {
			const escalationGameEndDate = await startYesEscalationAfterQuestionEnd()

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
			strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'getFeeEpochEndTime' }), escalationGameEndDate, 'a fork at the unresolved escalation deadline must use the fork-time fee cutoff')
			await mockWindow.setTime(escalationGameEndDate + 1n)
			strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'the escalation game should resolve after the universe fork')
			strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.None, 'the local outcome should remain unavailable after a fork-time-unresolved escalation game')
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'delayed initialization should enter fork mode')
			strictEqualTypeSafe((await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).unresolvedEscalationAtFork, true, 'the fork should preserve the unresolved escalation snapshot')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'delayed initialization should leave the child migration recoverable')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).disputeStakedAttoRep, 0n, 'unresolved migration should clear the parent escrow lock')
			strictEqualTypeSafe(await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address), 0n, 'optional vault cleanup should not create per-vault child escrow')
			const childYesState = await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: yesSecurityPool.escalationGame,
				functionName: 'getOutcomeState',
				args: [QuestionOutcome.Yes],
			})
			strictEqualTypeSafe(childYesState.currentCarryTotalAttoRep, reportBond, 'delayed initialization should preserve the unresolved principal in aggregate carry')
		})

		test.each([{ forkOffset: 1n }, { forkOffset: DAY }])('rejects delayed fork initialization for an escalation game resolved before the universe fork (fork offset: $forkOffset)', async ({ forkOffset }) => {
			const escalationGameEndDate = await startYesEscalationAfterQuestionEnd()
			const questionEndDate = await getQuestionEndDate(client, questionId)

			const forkSourceQuestionData = {
				...questionData,
				title: 'resolved before initialization fork source',
				endTime: escalationGameEndDate - 1n,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await mockWindow.setTime(escalationGameEndDate + forkOffset - 1n)
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
			strictEqualTypeSafe((await getUniverseData(client, genesisUniverse)).forkTime, escalationGameEndDate + forkOffset, 'the external fork should occur at the requested offset after the escalation deadline')
			strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'the escalation game should resolve before the universe fork')
			strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'a fork after the escalation deadline must preserve the finalized outcome')
			strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'getFeeEpochEndTime' }), questionEndDate, 'a fork after escalation finalization must preserve the original question-end fee cutoff')

			await assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Resolved/)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'a pre-fork-resolved game should leave the pool operational')
			strictEqualTypeSafe((await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).unresolvedEscalationAtFork, false, 'a pre-fork-resolved game should not be snapshotted as unresolved')
		})

		test('create child universe test', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await setVaultCapacityFixture(attackerClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, attackerClient.account.address, securityPoolUnderwritingLimitAttoEth)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)

			const factoryAddress = getInfraContractAddresses().securityPoolFactory
			const deploymentCount = await client.readContract({
				abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'securityPoolDeploymentCount',
				address: factoryAddress,
				args: [],
			})
			const childUniverseId = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
			const expectedChildAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverseId, questionId, statoblastSecurityMultiplierBps)

			const deployments = await client.readContract({
				abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
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
				openOraclePriceCoordinator: childManagerAddress,
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
			strictEqualTypeSafe(childManagerAddress, expectedChildAddresses.openOraclePriceCoordinator, 'child manager should be queryable')
			strictEqualTypeSafe(childShareTokenAddress, expectedChildAddresses.shareToken, 'child share token should be queryable')
			strictEqualTypeSafe(childParent, securityPoolAddresses.securityPool, 'child parent should match the origin security pool')
			strictEqualTypeSafe(childStoredUniverseId, childUniverseId, 'child universe id should match')
			strictEqualTypeSafe(childStoredQuestionId, questionId, 'child question id should match')
			strictEqualTypeSafe(childStoredStatoblastSecurityMultiplierBps, statoblastSecurityMultiplierBps, 'child multiplier should match')
			strictEqualTypeSafe(childCurrentRetentionRate, MAX_RETENTION_RATE, 'child retention rate should match')
			strictEqualTypeSafe(childSettlementCollateralAttoEth, 0n, 'child complete set collateral should default to zero during fork')
			strictEqualTypeSafe(await getLastPrice(client, childManagerAddress), await getLastPrice(client, securityPoolAddresses.openOraclePriceCoordinator), 'child manager should inherit the parent price')
		})

		test('forkZoltarWithOwnEscalationGame auto-initiates the pool fork and ignores stray REP already sitting on the forker', async () => {
			const strayRep = 7n * 10n ** 18n

			const { forkData, forkThresholdAttoRep, ownForkRepBuckets, repBalanceAttoRep } = await setupOwnForkWithEscrow(strayRep)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'forkWithOwnEscalationGame should auto-initiate the parent pool fork')
			assert.ok(forkData.auctionableAttoRepAtFork > 0n, 'repAtFork should keep a positive child REP anchor after the own-game fork')
			assert.ok(forkData.auctionableAttoRepAtFork <= repBalanceAttoRep + forkThresholdAttoRep * 2n, 'repAtFork should stay bounded by the REP that actually participated in the own-game fork')
			strictEqualTypeSafe(ownForkRepBuckets.escrowSourceRepAtForkAttoRep, forkThresholdAttoRep * 2n, 'own-fork source escrow should equal the fork-triggering escalation principal')
			strictEqualTypeSafe(ownForkRepBuckets.vaultRepAtForkAttoRep + ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, forkData.auctionableAttoRepAtFork, 'own-fork child REP buckets should partition the full auctionable child REP anchor')
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
			strictEqualTypeSafe(forkData.auctionableAttoRepAtFork, forkDataBeforeStrayRep.auctionableAttoRepAtFork, 'repAtFork should ignore unrelated REP transferred to the forker after the own-game fork')
		})

		test('initiateSecurityPoolFork rejects an unauthorized pool before it can change canonical pool state', async () => {
			const collateral = 5n * 10n ** 18n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, collateral)
			await triggerExternalForkForSecurityPool(undefined, 'untrusted fork event emitter attack')

			const fakePoolDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.evm.bytecode.object}`,
					args: [genesisUniverse, addressString(GENESIS_REPUTATION_TOKEN), questionId, zeroAddress],
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
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

			const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
			const parentRepToken = getRepTokenAddress(genesisUniverse)
			const gameBalanceBeforeAttack = await getERC20Balance(client, parentRepToken, escalationGame)
			const vaultBeforeAttack = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(gameBalanceBeforeAttack > 0n, 'canonical escalation game should hold participant REP')
			assert.ok(vaultBeforeAttack.disputeStakedAttoRep > 0n, 'canonical vault should record escalation escrow')

			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[5])
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
			const forkerClient = createWriteClient(mockWindow, BigInt(forkerAddress))
			await assert.rejects(
				writeContractAndWait(forkerClient, () =>
					forkerClient.writeContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'drainAllRep',
						args: [forkerAddress],
					}),
				),
				/revert/,
			)

			const fakePoolDeploymentHash = await attackerClient.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.evm.bytecode.object}`,
					args: [genesisUniverse, addressString(GENESIS_REPUTATION_TOKEN), questionId, escalationGame],
				}),
			})
			const fakePoolReceipt = await attackerClient.waitForTransactionReceipt({ hash: fakePoolDeploymentHash })
			const fakePool = fakePoolReceipt.contractAddress
			if (fakePool === undefined || fakePool === null) throw new Error('fake pool address missing')

			await assert.rejects(initiateSecurityPoolFork(attackerClient, fakePool), /Escalation game pool/)

			strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, escalationGame), gameBalanceBeforeAttack, 'fake pool must not drain a canonical escalation game')
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'failed attack must leave the canonical pool operational')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).disputeStakedAttoRep, vaultBeforeAttack.disputeStakedAttoRep, 'failed attack must leave canonical escrow accounting backed')
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
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock.evm.bytecode.object}`,
					args: [targetPool, targetPool],
				}),
			})
			const attackFactoryReceipt = await client.waitForTransactionReceipt({ hash: attackFactoryDeploymentHash })
			const attackFactoryAddress = ensureDefined(attackFactoryReceipt.contractAddress, 'attack factory address missing')

			const fakeParentDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock.evm.bytecode.object}`,
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
				abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				address: getInfraContractAddresses().securityPoolFactory,
				functionName: 'getSecurityPoolOriginId',
				args: [securityPoolAddresses.securityPool],
			})
			const fakeFactoryDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.evm.bytecode.object}`,
					args: [],
				}),
			})
			const fakeFactoryReceipt = await client.waitForTransactionReceipt({ hash: fakeFactoryDeploymentHash })
			const fakeFactory = fakeFactoryReceipt.contractAddress
			if (fakeFactory === undefined || fakeFactory === null) throw new Error('fake escrow factory address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					address: fakeFactory,
					functionName: 'configureOriginId',
					args: [canonicalOriginId],
				}),
			)
			const fakeParentDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.evm.bytecode.object}`,
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
							abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
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
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.evm.bytecode.object}`,
					args: [],
				}),
			})
			const fakeFactoryReceipt = await client.waitForTransactionReceipt({ hash: fakeFactoryDeploymentHash })
			const fakeFactory = fakeFactoryReceipt.contractAddress
			if (fakeFactory === undefined || fakeFactory === null) throw new Error('fake escrow factory address missing')

			const fakeParentDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.evm.bytecode.object}`,
					args: [genesisRep, fakeFactory, securityPoolAddresses.shareToken, forker, genesisUniverse, questionId, statoblastSecurityMultiplierBps],
				}),
			})
			const fakeParentReceipt = await client.waitForTransactionReceipt({ hash: fakeParentDeploymentHash })
			const fakeParent = fakeParentReceipt.contractAddress
			if (fakeParent === undefined || fakeParent === null) throw new Error('fake escrow parent address missing')

			const fakeGameDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock.evm.bytecode.object}`,
					args: [fakeParent, genesisRep, client.account.address, forgedClaim],
				}),
			})
			const fakeGameReceipt = await client.waitForTransactionReceipt({ hash: fakeGameDeploymentHash })
			const fakeGame = fakeGameReceipt.contractAddress
			if (fakeGame === undefined || fakeGame === null) throw new Error('fake escalation game address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi,
					address: fakeParent,
					functionName: 'configureEscalationGame',
					args: [fakeGame],
				}),
			)
			await transferRepToAddress(client, fakeGame, fakeDisputeStakedRep)
			await forkZoltarWithOwnEscalationGame(client, fakeParent)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const childRep = getRepTokenAddress(yesUniverse)
			const victimClient = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveToken(victimClient, genesisRep, getZoltarAddress())
			await addRepToMigrationBalance(victimClient, genesisUniverse, 2n * victimDeposit)
			await splitMigrationRep(victimClient, genesisUniverse, 2n * victimDeposit, [QuestionOutcome.Yes])
			const victimQuestionData = {
				...questionData,
				title: 'canonical future game targeted by fake child',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const victimQuestionId = getQuestionId(victimQuestionData, outcomes)
			await createQuestion(victimClient, victimQuestionData, outcomes)
			await deployOriginSecurityPool(victimClient, yesUniverse, victimQuestionId, statoblastSecurityMultiplierBps)
			const targetPool = getSecurityPoolAddresses(addressString(0n), yesUniverse, victimQuestionId, statoblastSecurityMultiplierBps, yesUniverse)
			await approveToken(victimClient, childRep, targetPool.securityPool)
			await depositRepToVault(victimClient, targetPool.securityPool, victimDeposit)
			await mockWindow.setTime(victimQuestionData.endTime + 1n)
			await manipulatePriceOracle(victimClient, mockWindow, targetPool.openOraclePriceCoordinator)
			await depositToEscalationGame(victimClient, targetPool.securityPool, QuestionOutcome.Yes, victimDeposit)
			const targetGame = await getSecurityPoolsEscalationGame(client, targetPool.securityPool)
			strictEqualTypeSafe(await getERC20Balance(client, childRep, targetGame), victimDeposit, 'canonical target game should begin with victim-funded child REP')

			const fakeChildDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.evm.bytecode.object}`,
					args: [fakeParent, fakeFactory, childRep, forker, targetPool.securityPool, targetGame, yesUniverse],
				}),
			})
			const fakeChildReceipt = await client.waitForTransactionReceipt({ hash: fakeChildDeploymentHash })
			const fakeChild = fakeChildReceipt.contractAddress
			if (fakeChild === undefined || fakeChild === null) throw new Error('fake escrow child address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi,
					address: fakeFactory,
					functionName: 'configureChild',
					args: [fakeChild, targetPool.securityPool],
				}),
			)

			const attackerChildRepBefore = await getERC20Balance(client, childRep, client.account.address)
			await assert.rejects(claimForkedEscalationDeposits(client, fakeParent, client.account.address, QuestionOutcome.Yes, [0n]))

			strictEqualTypeSafe(await getERC20Balance(client, childRep, client.account.address), attackerChildRepBefore, 'rejected forged claim must not transfer child REP to the attacker')
			strictEqualTypeSafe(await getERC20Balance(client, childRep, targetGame), victimDeposit, 'rejected forged claim must leave the canonical target game funded')
			strictEqualTypeSafe((await getSecurityVault(client, targetPool.securityPool, victimClient.account.address)).disputeStakedAttoRep, victimDeposit, 'rejected forged claim must leave canonical victim escrow accounting backed')

			const deployAlternatingChildGame = async (forkResumedAt: bigint) => {
				const deploymentHash = await client.sendTransaction({
					data: encodeDeployData({
						abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock.abi,
						bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock.evm.bytecode.object}`,
						args: [fakeChild, forkResumedAt],
					}),
				})
				const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
				const game = receipt.contractAddress
				if (game === undefined || game === null) throw new Error('alternating child game address missing')
				return game
			}
			const firstChildGame = await deployAlternatingChildGame(1n)
			await deployAlternatingChildGame(0n)
			const validationHarnessDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness.abi,
					bytecode: `0x${test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness.evm.bytecode.object}`,
					args: [getZoltarAddress()],
				}),
			})
			const validationHarnessReceipt = await client.waitForTransactionReceipt({ hash: validationHarnessDeploymentHash })
			const validationHarness = validationHarnessReceipt.contractAddress
			if (validationHarness === undefined || validationHarness === null) throw new Error('child game validation harness address missing')
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					address: fakeChild,
					functionName: 'configureOperationalEscalationGames',
					args: [targetGame, firstChildGame],
				}),
			)
			await assert.rejects(
				writeContractAndWait(client, () =>
					client.writeContract({
						abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerChildGameValidationHarness.abi,
						address: validationHarness,
						functionName: 'finalizeEscalationStateAfterAuction',
						args: [fakeChild],
					}),
				),
				/Child game/,
			)
			strictEqualTypeSafe(
				await client.readContract({
					abi: test_statoblast_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi,
					address: fakeChild,
					functionName: 'forkResumeCount',
				}),
				0n,
				'auction finalization must reject a child that switches to a game bound to another pool',
			)
		})
	})
})
