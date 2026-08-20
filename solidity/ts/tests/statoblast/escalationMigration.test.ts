import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { createCarryProof, readCarryLeafHash, SparseNullifierTree } from '../carryProofHelpers'
import { useStatoblastEscalationMigrationFixture, type StatoblastEscalationMigrationFixture } from './fixture'

const localUnresolvedPrincipalAbi = [
	{
		inputs: [
			{ name: 'vault', type: 'address' },
			{ name: 'outcome', type: 'uint8' },
		],
		name: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
		outputs: [{ name: '', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

const CARRY_PROOF_GAS_LIMIT = 3_000_000n
const RECURSIVE_ANCESTOR_CHECK_GAS_LIMIT = 8_000_000n
const RECURSIVE_CARRY_MIGRATION_GAS_LIMIT = 30_000_000n

describe('Statoblast: escalation migration', () => {
	const fixture = useStatoblastEscalationMigrationFixture()
	const assert: StatoblastEscalationMigrationFixture['assert'] = fixture.assert
	const approximatelyEqual: StatoblastEscalationMigrationFixture['approximatelyEqual'] = fixture.approximatelyEqual
	const strictEqualTypeSafe: StatoblastEscalationMigrationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	const {
		encodeAbiParameters,
		keccak256,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		contractExists,
		getChildUniverseId,
		getERC20Balance,
		addressString,
		approveAndDepositRepToVault,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		getQuestionEndDate,
		OperationType,
		QuestionOutcome,
		SystemState,
		ensureDefined,
		createChildUniverse,
		finalizeTruthAuction,
		getForkedEscrowChildRepByOutcomeAndVault,
		getForkedEscrowPrincipalByOutcomeAndVault,
		getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame,
		initiateSecurityPoolFork,
		claimForkedEscalationDeposits,
		migrateRepToZoltar,
		migrateVault,
		migrateVaultWithUnresolvedEscalation,
		startTruthAuction,
		getEscalationGameDeposits,
		getEscalationGameOutcomeState,
		getEscalationGameTotalCost,
		getQuestionResolution,
		forkUniverse,
		getRepTokenAddress,
		getTotalTheoreticalSupplyAttoRep,
		getZoltarAddress,
		getZoltarForkThreshold,
		createCompleteSet,
		depositRepToVault,
		depositToEscalationGame,
		getRepToken,
		getAwaitingForkContinuation,
		getVaultCount,
		getVaults,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		backingUnitsToAttoRep,
		withdrawFromEscalationGame,
		statoblast_EscalationGame_EscalationGame,
		statoblast_SecurityPoolForker_SecurityPoolForker,
		formatStorageSlot,
		getMappingStorageSlot,
		reportBond,
		repDeposit,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
		outcomes,
	} = fixture

	let mockWindow: StatoblastEscalationMigrationFixture['mockWindow']
	let client: StatoblastEscalationMigrationFixture['client']
	let securityPoolAddresses: StatoblastEscalationMigrationFixture['securityPoolAddresses']
	let questionData: StatoblastEscalationMigrationFixture['questionData']
	let questionId: StatoblastEscalationMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	async function completeForkContinuation(securityPool: Address) {
		for (let progressCall = 0; progressCall < 16 && (await getAwaitingForkContinuation(client, securityPool)); progressCall++) {
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: securityPool,
					functionName: 'resumeForkedEscalationGame',
					args: [],
				}),
			)
		}
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, securityPool), false, 'bounded continuation progress should complete')
	}

	async function refreshCurrentPrice() {
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
	}

	test('unfunded vault escalation deposit exposes REP too low and rolls back game deployment and pool state', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
		const unfundedVault = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const readDepositGuardState = async () => ({
			escalationGame: await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool),
			poolRep: await getERC20Balance(client, repToken, securityPoolAddresses.securityPool),
			vault: await getSecurityVault(client, securityPoolAddresses.securityPool, unfundedVault.account.address),
		})
		const stateBefore = await readDepositGuardState()

		await assert.rejects(depositToEscalationGame(unfundedVault, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond), /REP too low/)
		assert.deepStrictEqual(await readDepositGuardState(), stateBefore, 'unfunded escalation deposit must roll back game deployment, REP, and vault accounting')
	})

	test('unresolved migration rejects forks without unresolved deposits and preserves parent and child state', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestion = {
			...questionData,
			title: 'resolved-only external fork',
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestion, outcomes)
		await createQuestion(forkInitiator, externalForkQuestion, outcomes)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const parentRepToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const readMigrationGuardState = async () => ({
			childExists: await contractExists(client, yesChildPool),
			forkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
			parentGameRep: await getERC20Balance(client, parentRepToken, parentGame),
			parentPoolRep: await getERC20Balance(client, parentRepToken, securityPoolAddresses.securityPool),
			parentVault: await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address),
		})
		const stateBefore = await readMigrationGuardState()

		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /execution reverted|Reverted without a reason/i)
		assert.deepStrictEqual(await readMigrationGuardState(), stateBefore, 'missing unresolved deposits must not deploy a child or move parent REP and vault accounting')
	})

	test('external fork escalation claims expose Own fork required and preserve unresolved deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await approveAndDepositRepToVault(client, 3n * forkThresholdAttoRep, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)

		const externalForker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalQuestion = {
			...questionData,
			title: 'external fork after escalation non-decision',
		}
		const externalQuestionId = getQuestionId(externalQuestion, outcomes)
		await createQuestion(externalForker, externalQuestion, outcomes)
		await approveToken(externalForker, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(externalForker, genesisUniverse, externalQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const readOwnForkGuardState = async () => ({
			forkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
			gameRep: await getERC20Balance(client, repToken, parentGame),
			noDeposits: await getEscalationGameDeposits(client, parentGame, QuestionOutcome.No),
			parentVault: await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address),
			yesDeposits: await getEscalationGameDeposits(client, parentGame, QuestionOutcome.Yes),
		})
		const stateBefore = await readOwnForkGuardState()
		const yesDeposit = ensureDefined(stateBefore.yesDeposits[0], 'external-fork yes deposit is undefined')

		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [yesDeposit.depositIndex]), /execution reverted|Reverted without a reason/i)
		assert.deepStrictEqual(await readOwnForkGuardState(), stateBefore, 'wrong fork mode claim must preserve fork data, deposits, REP, and vault accounting')
	})

	test('forked escalation claim exposes Child not migrating after the selected child activates', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await approveAndDepositRepToVault(client, 3n * forkThresholdAttoRep, questionId)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
		await mockWindow.advanceTime(8n * 7n * DAY + 1n)
		await startTruthAuction(client, yesChildPool)
		if ((await getSystemState(client, yesChildPool)) === SystemState.ForkTruthAuction) {
			await mockWindow.advanceTime(7n * DAY + 1n)
			await finalizeTruthAuction(client, yesChildPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesChildPool), SystemState.Operational, 'selected child must be active before testing the claim guard')

		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const readChildStateGuard = async () => ({
			childPoolRep: await getERC20Balance(client, childRepToken, yesChildPool),
			childState: await getSystemState(client, yesChildPool),
			deposits: await getEscalationGameDeposits(client, parentGame, QuestionOutcome.Yes),
			parentGameRep: await getERC20Balance(client, repToken, parentGame),
			parentVault: await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address),
		})
		const stateBefore = await readChildStateGuard()
		const deposit = ensureDefined(stateBefore.deposits[0], 'own-fork yes deposit is undefined')

		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [deposit.depositIndex]), /execution reverted|Reverted without a reason/i)
		assert.deepStrictEqual(await readChildStateGuard(), stateBefore, 'inactive claim path must preserve the activated child, deposits, REP, and parent vault')
	})

	test("own-fork claims reject another vault owner's deposit and roll back consumption, child deployment, and REP state", async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
		const otherVault = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(otherVault, repDeposit, questionId)
		await depositToEscalationGame(otherVault, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const parentRepToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, parentRepToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await approveAndDepositRepToVault(client, 3n * forkThresholdAttoRep, questionId)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const readWrongVaultState = async () => ({
			childExists: await contractExists(client, yesChildPool),
			clientVault: await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address),
			deposits: await getEscalationGameDeposits(client, parentGame, QuestionOutcome.Yes),
			otherVault: await getSecurityVault(client, securityPoolAddresses.securityPool, otherVault.account.address),
			parentGameRep: await getERC20Balance(client, parentRepToken, parentGame),
			parentPoolRep: await getERC20Balance(client, parentRepToken, securityPoolAddresses.securityPool),
		})
		const stateBefore = await readWrongVaultState()
		const otherVaultDeposit = ensureDefined(stateBefore.deposits[0], 'other vault deposit is undefined')
		strictEqualTypeSafe(otherVaultDeposit.depositor, otherVault.account.address, 'the selected deposit must belong to the other vault')

		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [otherVaultDeposit.depositIndex]), /execution reverted|Wrong deposit vault/i)
		assert.deepStrictEqual(await readWrongVaultState(), stateBefore, 'wrong-vault claim must roll back deposit consumption, child deployment, REP balances, and both vaults')
	})

	test('resolved escalation withdrawal rejects mixed-vault batches and rolls back every deposit and vault mutation', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const losingVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRepToVault(secondWinner, repDeposit, questionId)
		await approveAndDepositRepToVault(losingVault, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 2n * reportBond)
		await depositToEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 2n * reportBond)
		await depositToEscalationGame(losingVault, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		await mockWindow.advanceTime(60n * DAY)
		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'mixed-vault withdrawal setup must resolve to yes')

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const readMixedVaultState = async () => ({
			clientVault: await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address),
			gameRep: await getERC20Balance(client, repToken, securityPoolAddresses.escalationGame),
			poolRep: await getERC20Balance(client, repToken, securityPoolAddresses.securityPool),
			secondWinnerVault: await getSecurityVault(client, securityPoolAddresses.securityPool, secondWinner.account.address),
			yesDeposits: await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes),
		})
		const stateBefore = await readMixedVaultState()
		const firstDeposit = ensureDefined(stateBefore.yesDeposits[0], 'first winning deposit is undefined')
		const secondDeposit = ensureDefined(stateBefore.yesDeposits[1], 'second winning deposit is undefined')

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [firstDeposit.depositIndex, secondDeposit.depositIndex]), /One vault/)
		assert.deepStrictEqual(await readMixedVaultState(), stateBefore, 'mixed-vault withdrawal must roll back deposit settlement, REP movement, and both vault updates')
	})

	test('optional vault migration clears unresolved parent dispute-staked REP accounting without creating child escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const securityPoolCapacityOwnershipAttoRep = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, securityPoolCapacityOwnershipAttoRep)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'forked unresolved migration source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const childForkDataBeforeMigration = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childEscalationBalanceBeforeMigration = await getERC20Balance(client, childRepToken, childEscalationGame)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childForkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childEscalationBalanceAfterMigration = await getERC20Balance(client, childRepToken, childEscalationGame)
		const childOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
		const childForkSnapshotInitialized = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'forkCarrySnapshotInitialized',
			args: [],
		})
		const childDepositsAfterMigration = await getEscalationGameDeposits(client, childEscalationGame, QuestionOutcome.Yes)
		const childLocalDepositCount = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'getDepositsByOutcomeLength',
			args: [QuestionOutcome.Yes],
		})

		strictEqualTypeSafe(parentVaultBeforeMigration.disputeStakedAttoRep, unresolvedDeposit, 'parent dispute-staked REP should equal the unresolved principal before migration')
		strictEqualTypeSafe(parentVaultAfterMigration.disputeStakedAttoRep, 0n, 'atomic unresolved migration should clear parent dispute-staked REP accounting')
		strictEqualTypeSafe(childVaultAfterMigration.disputeStakedAttoRep, 0n, 'the aggregate-funded child should not create a per-vault escalation lock')
		strictEqualTypeSafe(childForkData.migratedAttoRep, childForkDataBeforeMigration.migratedAttoRep, 'unresolved migration should not change child migrated REP accounting')
		strictEqualTypeSafe(childEscalationBalanceAfterMigration, childEscalationBalanceBeforeMigration, 'vault materialization should reuse the aggregate backing placed in the selected child at creation')
		strictEqualTypeSafe(childForkSnapshotInitialized, true, 'the child continuation game should inherit the fork carry snapshot')
		strictEqualTypeSafe(childDepositsAfterMigration.length, 0, 'the child continuation game should not replay parent unresolved deposits as fresh local deposits')
		strictEqualTypeSafe(childLocalDepositCount, 0n, 'continuation deposits should remain represented through the inherited carry snapshot')
		assert.ok(childOutcomeState.currentLeafCount > 0n, 'the child continuation game should inherit unresolved carry state from the parent snapshot')
		strictEqualTypeSafe(childOutcomeState.currentCarryTotalAttoRep, unresolvedDeposit, 'the child continuation game should track the migrated unresolved principal')
	})

	test('optional vault migration clears aggregate parent totals without copying them into child vault state', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const depositCount = 65
		const totalUnresolvedDeposit = BigInt(depositCount) * reportBond
		const minimumRemainingVaultRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 100_000n
		const requiredVaultRep = totalUnresolvedDeposit + minimumRemainingVaultRep
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repBackingUnits)
		if (vaultRepBeforeTopUp < requiredVaultRep) {
			await approveAndDepositRepToVault(client, requiredVaultRep - vaultRepBeforeTopUp, questionId)
		}
		for (let index = 0; index < depositCount; index += 1) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		}
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'bounded unresolved migration source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		strictEqualTypeSafe(
			await client.readContract({
				abi: localUnresolvedPrincipalAbi,
				address: securityPoolAddresses.escalationGame,
				functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
				args: [client.account.address, QuestionOutcome.Yes],
			}),
			totalUnresolvedDeposit,
			'aggregate source accounting should include every local deposit',
		)

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		strictEqualTypeSafe(parentVaultAfterMigration.disputeStakedAttoRep, 0n, 'aggregate migration should clear all parent unresolved escrow')
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address), 0n, 'the child should rely on its aggregate carry snapshot rather than per-vault escrow')
	})

	test('own-fork unresolved migration rejects after the child branch is already priced', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repBackingUnits)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThresholdAttoRep ? 3n * forkThresholdAttoRep - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRepToVault(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes))
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /execution reverted|Reverted without a reason/i)
	})

	test('own-fork unresolved migration expires without moving the vault', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const securityPoolCapacityOwnershipAttoRep = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, securityPoolCapacityOwnershipAttoRep)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repBackingUnits)
		if (vaultRepBeforeTopUp < 3n * forkThresholdAttoRep) {
			await approveAndDepositRepToVault(client, 3n * forkThresholdAttoRep - vaultRepBeforeTopUp, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const forkTime = await mockWindow.getTime()
		await mockWindow.setTime(forkTime + 8n * 7n * DAY + 1n)
		const parentVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /execution reverted|Reverted without a reason/i)
		const parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(parentVault.disputeStakedAttoRep, parentVaultBefore.disputeStakedAttoRep, 'expired migration must leave unresolved parent dispute-staked REP accounting untouched')
		strictEqualTypeSafe(parentVault.repBackingUnits, parentVaultBefore.repBackingUnits, 'expired migration must leave parent backingUnits untouched')
	})

	test('external-fork unresolved migration expires without requiring another user to process it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const securityPoolCapacityOwnershipAttoRep = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, securityPoolCapacityOwnershipAttoRep)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'late external-fork unresolved migration source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const forkTime = await mockWindow.getTime()
		await mockWindow.setTime(forkTime + 8n * 7n * DAY + 1n)
		const parentVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /execution reverted|Reverted without a reason/i)
		const parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(parentVault.disputeStakedAttoRep, parentVaultBefore.disputeStakedAttoRep, 'the inactive vault remains untouched after expiry')
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address), 0n, 'the child should not materialize an expired vault')
	})

	test('in-window external unresolved migration requires the vault owner to call it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'relayed unresolved migration source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(relayerClient, otherQuestionData, outcomes)
		await approveToken(relayerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(relayerClient, genesisUniverse, otherQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const vaultBeforeRelayedAttempt = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /execution reverted|Reverted without a reason/i)
		assert.deepStrictEqual(await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address), vaultBeforeRelayedAttempt, 'a rejected relayer must not mutate the parent vault')
	})

	test('migrateVaultWithUnresolvedEscalation clears parent escrow as dust when the child allocation rounds to zero', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, unresolvedDeposit + 1n)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repBackingUnits)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThresholdAttoRep ? 3n * forkThresholdAttoRep - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRepToVault(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const parentYesDepositsBeforeMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoDepositsBeforeMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		const ownForkChildRepAtForkSlot = formatStorageSlot(parentForkDataSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[ownForkChildRepAtForkSlot]: 0n,
				},
			},
		})

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentDepositsAfterMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoDepositsAfterMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const childPoolExists = await contractExists(client, yesSecurityPool.securityPool)
		const childVaultAfterMigration = childPoolExists ? await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address) : undefined

		strictEqualTypeSafe(parentVaultAfterMigration.disputeStakedAttoRep, 0n, 'zero child allocation should clear the parent unresolved REP lock as dust')
		assert.deepStrictEqual(parentDepositsAfterMigration, parentYesDepositsBeforeMigration, 'the immutable parent proof commitment should retain every yes deposit leaf')
		assert.deepStrictEqual(parentNoDepositsAfterMigration, parentNoDepositsBeforeMigration, 'the immutable parent proof commitment should retain every no deposit leaf')
		strictEqualTypeSafe(childVaultAfterMigration?.disputeStakedAttoRep ?? 0n, 0n, 'zero child allocation should not create child escrow')
	})

	test('non-own fork claims rely on the continuation snapshot without replaying local deposits or vault escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'parent for non-own unresolved migration',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, yesEscalationGame, QuestionOutcome.Yes)
		const yesDepositsAfterMigration = await getEscalationGameDeposits(client, yesEscalationGame, QuestionOutcome.Yes)
		const childEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)

		strictEqualTypeSafe(yesDepositsAfterMigration.length, 0, 'non-own unresolved migration should not replay parent local deposits in the child game')
		strictEqualTypeSafe(yesOutcomeState.balanceAttoRep, unresolvedDeposit, 'non-own continuation should keep inherited resolution balances 1:1 with source REP')
		strictEqualTypeSafe(yesOutcomeState.currentCarryTotalAttoRep, unresolvedDeposit, 'the aggregate snapshot should retain the unresolved principal for proof settlement')
		strictEqualTypeSafe(childEscrowPrincipal, 0n, 'non-own continuation should not create per-vault principal accounting')
		strictEqualTypeSafe(childEscrowChildRep, 0n, 'non-own continuation should not create per-vault child REP accounting')
	})

	test('an unrelated fork carries dispute-staked REP 1:1 and burns the winner haircut only when the child settles', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const losingClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(losingClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 2n * reportBond)
		await depositToEscalationGame(losingClient, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

		const externalForkQuestionData = {
			...questionData,
			title: 'unrelated fork preserves escalation principal',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(losingClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(losingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(losingClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		const disputeStakedRepBucketsAttoRep = await client.readContract({
			address: getInfraContractAddresses().securityPoolForker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getOwnForkRepBuckets',
			args: [securityPoolAddresses.securityPool],
		})
		strictEqualTypeSafe(disputeStakedRepBucketsAttoRep[2], 3n * reportBond, 'the unrelated fork should snapshot all dispute-staked REP')
		strictEqualTypeSafe(disputeStakedRepBucketsAttoRep[1], disputeStakedRepBucketsAttoRep[2], 'unrelated escalation carry should remain exactly 1:1')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesPool.securityPool)
		if ((await getSystemState(client, yesPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesPool.securityPool)
		}
		await completeForkContinuation(yesPool.securityPool)
		const escalationEndDate = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: yesGame,
			functionName: 'getEscalationGameEndDate',
		})
		await mockWindow.setTime(escalationEndDate + DAY)
		strictEqualTypeSafe(await getQuestionResolution(client, yesGame), QuestionOutcome.Yes, 'the unrelated continuation should resolve from its escalation deposits')

		const winningProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		const childRepToken = getRepTokenAddress(yesUniverse)
		const theoreticalSupplyBeforeClaim = await getTotalTheoreticalSupplyAttoRep(client, childRepToken)
		const hash = await client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: yesPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [winningProof]],
		})
		await client.waitForTransactionReceipt({ hash })
		strictEqualTypeSafe(theoreticalSupplyBeforeClaim - (await getTotalTheoreticalSupplyAttoRep(client, childRepToken)), (reportBond * 2n) / 5n, 'the unrelated continuation should burn the winner haircut at settlement')
	})

	test('each lazily created continuation starts from the complete parent escalation totals', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, 2n * reportBond)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)
		const parentInvalidState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid)
		const parentYesState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const externalForkQuestionData = {
			...questionData,
			title: 'parent for preserved continuation balances',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)

		for (const childOutcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const childUniverse = getChildUniverseId(genesisUniverse, childOutcome)
			const childSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
			const childEscalationGame = await getSecurityPoolsEscalationGame(client, childSecurityPool.securityPool)
			const invalidOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Invalid)
			const yesOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
			const noOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.No)
			const childTotalCost = await getEscalationGameTotalCost(client, childEscalationGame)

			strictEqualTypeSafe(invalidOutcomeState.balanceAttoRep, parentInvalidState.balanceAttoRep, 'each child must inherit the complete parent invalid balance')
			strictEqualTypeSafe(yesOutcomeState.balanceAttoRep, parentYesState.balanceAttoRep, 'each child must inherit the complete parent yes balance')
			strictEqualTypeSafe(noOutcomeState.balanceAttoRep, parentNoState.balanceAttoRep, 'each child must inherit the complete parent no balance')
			strictEqualTypeSafe(invalidOutcomeState.currentCarryTotalAttoRep, parentInvalidState.currentCarryTotalAttoRep, 'each child must inherit the complete parent invalid carry')
			strictEqualTypeSafe(yesOutcomeState.currentCarryTotalAttoRep, parentYesState.currentCarryTotalAttoRep, 'each child must inherit the complete parent yes carry')
			strictEqualTypeSafe(noOutcomeState.currentCarryTotalAttoRep, parentNoState.currentCarryTotalAttoRep, 'each child must inherit the complete parent no carry')
			strictEqualTypeSafe(childTotalCost, 0n, 'child continuations should still start before continuation attrition becomes active')
		}
	})

	test('late children retain the canonical fork snapshot after an own-fork parent claim', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		await refreshCurrentPrice()
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
		if (vaultAttoRep < 2n * forkThresholdAttoRep) await approveAndDepositRepToVault(client, 2n * forkThresholdAttoRep - vaultAttoRep, questionId)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		const invalidPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid), questionId, statoblastSecurityMultiplierBps)
		const invalidGame = await getSecurityPoolsEscalationGame(client, invalidPool.securityPool)
		const forkSnapshotBeforeClaim = await Promise.all([QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No].map(async outcome => await getEscalationGameOutcomeState(client, invalidGame, outcome)))

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const effectiveSnapshotAfterClaim = await Promise.all([QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No].map(async outcome => await getEscalationGameOutcomeState(client, invalidGame, outcome)))
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)
		const noPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.No), questionId, statoblastSecurityMultiplierBps)
		const noGame = await getSecurityPoolsEscalationGame(client, noPool.securityPool)
		const lateForkSnapshot = await Promise.all([QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No].map(async outcome => await getEscalationGameOutcomeState(client, noGame, outcome)))

		assert.ok(effectiveSnapshotAfterClaim[QuestionOutcome.Yes].currentCarryTotalAttoRep < forkSnapshotBeforeClaim[QuestionOutcome.Yes].currentCarryTotalAttoRep, 'the direct claim should remove its effective inherited principal without rewriting the carry tree')
		assert.deepStrictEqual(lateForkSnapshot, effectiveSnapshotAfterClaim, 'current and late children must expose the same immutable carry tree with the same direct-claim liability adjustment')
	})

	test('a vault materializes its entitlement only in child universes it selects', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const parentInvalidState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid)
		const parentYesState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

		const forkClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const forkQuestionData = { ...questionData, title: 'lazy selected continuation children' }
		await createQuestion(forkClient, forkQuestionData, outcomes)
		await approveToken(forkClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkClient, genesisUniverse, getQuestionId(forkQuestionData, outcomes))
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		const invalidPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid), questionId, statoblastSecurityMultiplierBps)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const noPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.No), questionId, statoblastSecurityMultiplierBps)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const entitlementAfterYes = await client.readContract({
			address: getInfraContractAddresses().securityPoolForker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getEscalationMigrationEntitlementStatus',
			args: [securityPoolAddresses.securityPool, client.account.address],
		})
		strictEqualTypeSafe(entitlementAfterYes[0], true, 'the first selected child should persist the vault entitlement')
		assert.deepStrictEqual(entitlementAfterYes[2], [false, true, false], 'only the selected yes child should be marked materialized')
		const parentVaultAfterExport = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(parentVaultAfterExport.repBackingUnits, 0n, 'the parent vault should have no remaining REP backing after migration')
		strictEqualTypeSafe(parentVaultAfterExport.capacityOwnershipAttoRep, 0n, 'the parent vault should have no remaining capacity ownership after migration')
		strictEqualTypeSafe(parentVaultAfterExport.disputeStakedAttoRep, 0n, 'the exported escalation entitlement should clear the parent vault escrow')
		const parentVaultCount = await getVaultCount(client, securityPoolAddresses.securityPool)
		const parentVaults = await getVaults(client, securityPoolAddresses.securityPool, 0n, parentVaultCount)
		strictEqualTypeSafe(
			parentVaults.some(vault => vault.toLowerCase() === client.account.address.toLowerCase()),
			true,
			'a fully migrated vault should remain discoverable in the parent vault registry',
		)
		strictEqualTypeSafe(await contractExists(client, yesPool.securityPool), true, 'the selected yes child should be created')
		strictEqualTypeSafe(await contractExists(client, invalidPool.securityPool), false, 'the unused invalid child should not be created')
		strictEqualTypeSafe(await contractExists(client, noPool.securityPool), false, 'the unused no child should not be created')
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		const yesState = await getEscalationGameOutcomeState(client, yesGame, QuestionOutcome.Yes)
		strictEqualTypeSafe(yesState.balanceAttoRep, parentYesState.balanceAttoRep, 'the selected child should inherit the parent balance')
		strictEqualTypeSafe(yesState.currentCarryTotalAttoRep, parentYesState.currentCarryTotalAttoRep, 'the selected child should inherit the parent carry')

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.No)
		const entitlementAfterNo = await client.readContract({
			address: getInfraContractAddresses().securityPoolForker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getEscalationMigrationEntitlementStatus',
			args: [securityPoolAddresses.securityPool, client.account.address],
		})
		assert.deepStrictEqual(entitlementAfterNo[2], [false, true, true], 'yes and no should be marked materialized while invalid remains untouched')
		strictEqualTypeSafe(await contractExists(client, noPool.securityPool), true, 'a second child should be created only when the vault selects it')
		strictEqualTypeSafe(await contractExists(client, invalidPool.securityPool), false, 'selecting another child should still leave invalid undeployed')
		const noGame = await getSecurityPoolsEscalationGame(client, noPool.securityPool)
		const lateInvalidState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.Invalid)
		const lateYesState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.Yes)
		const lateNoState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.No)
		strictEqualTypeSafe(lateInvalidState.balanceAttoRep, parentInvalidState.balanceAttoRep, 'a child created after the first vault export should still inherit the parent invalid balance')
		strictEqualTypeSafe(lateYesState.balanceAttoRep, parentYesState.balanceAttoRep, 'a child created after the first vault export should still inherit the parent yes balance')
		strictEqualTypeSafe(lateNoState.balanceAttoRep, parentNoState.balanceAttoRep, 'a child created after the first vault export should still inherit the parent no balance')
		strictEqualTypeSafe(lateInvalidState.currentCarryTotalAttoRep, parentInvalidState.currentCarryTotalAttoRep, 'late child creation should preserve the parent invalid carry')
		strictEqualTypeSafe(lateYesState.currentCarryTotalAttoRep, parentYesState.currentCarryTotalAttoRep, 'late child creation should preserve the parent yes carry')
		strictEqualTypeSafe(lateNoState.currentCarryTotalAttoRep, parentNoState.currentCarryTotalAttoRep, 'late child creation should preserve the parent no carry')
		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /execution reverted|Reverted without a reason/i)
	})

	test('selected branches share parent game totals while materializing only the selecting vault', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const otherClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(otherClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await depositToEscalationGame(otherClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		const parentYesState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

		const externalForkQuestionData = {
			...questionData,
			title: 'branch-local continuation accounting',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(otherClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(otherClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(otherClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)

		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.Yes), questionId, statoblastSecurityMultiplierBps)
		const noPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.No), questionId, statoblastSecurityMultiplierBps)
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		const noGame = await getSecurityPoolsEscalationGame(client, noPool.securityPool)
		const initialYesState = await getEscalationGameOutcomeState(client, yesGame, QuestionOutcome.Yes)
		const initialNoState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.No)
		strictEqualTypeSafe(initialYesState.balanceAttoRep, parentYesState.balanceAttoRep, 'the yes child starts from the complete parent yes balance')
		strictEqualTypeSafe(initialNoState.balanceAttoRep, parentNoState.balanceAttoRep, 'the no child starts from the complete parent no balance')

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(otherClient, securityPoolAddresses.securityPool, otherClient.account.address, QuestionOutcome.No)
		const yesState = await getEscalationGameOutcomeState(client, yesGame, QuestionOutcome.Yes)
		const noState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.No)
		strictEqualTypeSafe(yesState.balanceAttoRep, parentYesState.balanceAttoRep, 'materializing a vault must not rebase the yes child balance')
		strictEqualTypeSafe(noState.balanceAttoRep, parentNoState.balanceAttoRep, 'materializing a vault must not rebase the no child balance')
		strictEqualTypeSafe(yesState.currentCarryTotalAttoRep, parentYesState.currentCarryTotalAttoRep, 'materializing a vault must not rebase the yes child carry')
		strictEqualTypeSafe(noState.currentCarryTotalAttoRep, parentNoState.currentCarryTotalAttoRep, 'materializing a vault must not rebase the no child carry')
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesPool.securityPool, QuestionOutcome.No, otherClient.account.address), 0n, 'the yes child should not materialize the other vault')
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, noPool.securityPool, QuestionOutcome.Yes, client.account.address), 0n, 'the no child should not materialize the other vault')
	})

	test('claimForkedEscalationDeposits requires the vault owner to call it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const winningDeposit = reportBond
		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(relayerClient, repDeposit, questionId)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		await assert.rejects(claimForkedEscalationDeposits(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
	})

	test('claimForkedEscalationDeposits requires an actual universe fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const nonDecisionThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * nonDecisionThresholdAttoRep)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, nonDecisionThresholdAttoRep)

		const nonDecisionTimestamp = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: securityPoolAddresses.escalationGame,
			functionName: 'nonDecisionTimestamp',
		})
		assert.ok(nonDecisionTimestamp > 0n, 'balanced threshold deposits should reach non-decision')
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'the parent should not be forked yet')
		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /execution reverted|Reverted without a reason/i)
	})

	test('an underfunded child remains incomplete instead of scaling per-vault escalation claims', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repBackingUnits)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThresholdAttoRep ? 3n * forkThresholdAttoRep - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRepToVault(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		const ownForkChildRepAtForkSlot = formatStorageSlot(parentForkDataSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[ownForkChildRepAtForkSlot]: 1n,
				},
			},
		})
		const parentInvalidOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid)
		const parentYesOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childPoolExists = await contractExists(client, yesSecurityPool.securityPool)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const invalidOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Invalid)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
		const noOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.No)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childYesEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.No, client.account.address)
		const childYesEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.No, client.account.address)
		const childEscrowPrincipal = childYesEscrowPrincipal + childNoEscrowPrincipal
		const childEscrowChildRep = childYesEscrowChildRep + childNoEscrowChildRep

		strictEqualTypeSafe(parentVaultAfterMigration.disputeStakedAttoRep, 0n, 'an underfunded child branch should still clear the parent unresolved REP lock after the migration succeeds')
		strictEqualTypeSafe(childPoolExists, true, 'an underfunded child branch should deploy the child pool')
		strictEqualTypeSafe(childVaultAfterMigration.disputeStakedAttoRep, 0n, 'underfunding should not create scaled vault escrow')
		strictEqualTypeSafe(invalidOutcomeState.balanceAttoRep, parentInvalidOutcomeState.balanceAttoRep, 'the child invalid balance should stay aligned with the parent snapshot')
		strictEqualTypeSafe(yesOutcomeState.balanceAttoRep, parentYesOutcomeState.balanceAttoRep, 'the child yes balance should preserve the parent snapshot even when child REP backing is smaller')
		strictEqualTypeSafe(noOutcomeState.balanceAttoRep, parentNoOutcomeState.balanceAttoRep, 'the child no balance should stay aligned with the parent snapshot')
		strictEqualTypeSafe(childEscrowPrincipal, 0n, 'the child should not allocate inherited principal per vault')
		strictEqualTypeSafe(childEscrowChildRep, 0n, 'the child should not scale inherited REP into per-vault escrow')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'isForkCarryFundingComplete', args: [] }), false, 'one attoREP of child REP must not fund a larger inherited carry')
	})

	test('large unresolved continuation migration snapshots carry totals without replaying imported deposit indexes', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const nonDecisionThresholdAttoRep = (await getZoltarForkThreshold(client, genesisUniverse)) / 2n
		const capacity = nonDecisionThresholdAttoRep / reportBond
		const requestedDepositCount = 12n
		let depositCount = capacity > requestedDepositCount ? requestedDepositCount : capacity
		if (depositCount > 1n) depositCount -= 1n
		else depositCount = 1n
		for (let index = 0n; index < depositCount; index += 1n) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + index)
		}

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'large imported scan race source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)

		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const parentOutcomeStateBeforeMigration = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childOutcomeState = await getEscalationGameOutcomeState(client, yesEscalationGame, QuestionOutcome.Yes)
		assert.ok(childOutcomeState.currentCarryRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000', 'the child continuation should materialize a non-empty carry root')
		strictEqualTypeSafe(childOutcomeState.currentLeafCount, parentOutcomeStateBeforeMigration.currentLeafCount, 'continuation migration should preserve the parent carry leaf count')
		strictEqualTypeSafe(childOutcomeState.currentCarryTotalAttoRep, parentOutcomeStateBeforeMigration.currentCarryTotalAttoRep, 'snapshot-only migration should preserve the parent unresolved carry total')
	})

	test('external-fork continuation resumes without migrating another vault', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 2n * reportBond)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		await mockWindow.advanceTime(4n * DAY)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const theoreticalSupplySlot = formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[theoreticalSupplySlot]: repDeposit * 10n,
				},
			},
		})

		const forkSourceQuestionData = {
			...questionData,
			title: 'forked continuation timing source question',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(attackerClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		const parentCostAtFork = await getEscalationGameTotalCost(client, securityPoolAddresses.escalationGame)
		assert.ok(parentCostAtFork > 0n, 'the parent escalation game should accrue a positive cost before the unrelated fork')
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childCostDuringMigration = await getEscalationGameTotalCost(client, childEscalationGame)
		approximatelyEqual(childCostDuringMigration, parentCostAtFork, reportBond / 10_000n, 'the child continuation game should inherit the fork-time cost snapshot')

		await mockWindow.advanceTime(3n * DAY)
		strictEqualTypeSafe(await getEscalationGameTotalCost(client, childEscalationGame), childCostDuringMigration, 'continuation cost should stay frozen while the child is still in fork migration')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		const forkElapsedAtStartBeforeResume = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'forkElapsedAtStart',
			args: [],
		})
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should become operational once migration completes')
		await completeForkContinuation(yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should not wait for another vault to migrate')

		const forkElapsedAtStartAfterResume = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'forkElapsedAtStart',
			args: [],
		})
		strictEqualTypeSafe(forkElapsedAtStartAfterResume, forkElapsedAtStartBeforeResume, 'resuming the continuation must preserve its frozen fork-time elapsed value')
		const forkResumedAt = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'forkResumedAt',
			args: [],
		})
		assert.ok(forkResumedAt > 0n, 'pricing should resume the child continuation')
		// Exercise a post-resume block explicitly instead of depending on how quickly
		// the local or CI RPC serves the reads after the pricing transaction.
		await mockWindow.advanceTime(6n)
		const latestBlock = await client.getBlock()
		assert.ok(latestBlock.timestamp >= forkResumedAt, 'the latest block should not predate continuation resumption')
		const expectedChildCostAtResume = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'computeIterativeAttritionCostAttoRep',
			args: [forkElapsedAtStartBeforeResume + (latestBlock.timestamp - forkResumedAt)],
		})
		const childCostAtResume = await getEscalationGameTotalCost(client, childEscalationGame)
		strictEqualTypeSafe(childCostAtResume, expectedChildCostAtResume, 'the resumed continuation should add only post-resume block time to its frozen fork-time elapsed value')
		assert.ok(childCostAtResume >= childCostDuringMigration, 'resuming the continuation must not reduce its frozen fork-time cost')

		await mockWindow.advanceTime(DAY)
		assert.ok((await getEscalationGameTotalCost(client, childEscalationGame)) > childCostAtResume, 'child continuation cost should advance without the other vault')
		const attackerParentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		assert.ok(attackerParentVault.disputeStakedAttoRep > 0n, 'the inactive vault should remain untouched in the parent')
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.No, attackerClient.account.address), 0n, 'the caller vault should not migrate another vault into its child')
	})

	test('a migrated winner settles from aggregate child backing when the losing vault does not migrate', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		await refreshCurrentPrice()
		const losingClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const winningVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const winningVaultRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, winningVault.repBackingUnits)
		if (winningVaultRep < forkThresholdAttoRep) await approveAndDepositRepToVault(client, forkThresholdAttoRep - winningVaultRep, questionId)
		await approveAndDepositRepToVault(losingClient, forkThresholdAttoRep, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
		await depositToEscalationGame(losingClient, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)
		const ownForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const parentPoolRepBeforeFork = await getERC20Balance(client, await getRepToken(client, securityPoolAddresses.securityPool), securityPoolAddresses.securityPool)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const ownForkBuckets = await client.readContract({
			address: getInfraContractAddresses().securityPoolForker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getOwnForkRepBuckets',
			args: [securityPoolAddresses.securityPool],
		})
		const ownForkHaircut = ownForkThreshold / 5n
		strictEqualTypeSafe(ownForkBuckets[0], parentPoolRepBeforeFork, 'an escalation-triggered fork should preserve ordinary pool-held REP 1:1')
		strictEqualTypeSafe(ownForkBuckets[2] - ownForkBuckets[1], ownForkHaircut, 'the escalation escrow should pay the own-question fork haircut exactly once')
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		const losingParentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, losingClient.account.address)
		assert.ok(losingParentVault.disputeStakedAttoRep > 0n, 'the losing vault should remain unmigrated in the parent')
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesPool.securityPool, QuestionOutcome.No, losingClient.account.address), 0n, 'the selected child must not authorize the non-migrating losing vault')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesPool.securityPool)
		if ((await getSystemState(client, yesPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesPool.securityPool)
		}
		await completeForkContinuation(yesPool.securityPool)
		const escalationEndDate = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: yesGame,
			functionName: 'getEscalationGameEndDate',
		})
		await mockWindow.setTime(escalationEndDate + 1n)
		strictEqualTypeSafe(await getQuestionResolution(client, yesGame), QuestionOutcome.Yes, 'the selected child should resolve to its fork outcome')

		const losingProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.No,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
			sourceNodeId: 2n,
		})
		await assert.rejects(
			losingClient.writeContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesPool.securityPool,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [QuestionOutcome.No, [losingProof]],
			}),
			/Not winning outcome/,
		)
		const winningProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		const childRepToken = getRepTokenAddress(yesUniverse)
		const theoreticalSupplyBeforeClaim = await getTotalTheoreticalSupplyAttoRep(client, childRepToken)
		const winnerBalanceBefore = await getERC20Balance(client, childRepToken, client.account.address)
		const hash = await client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: yesPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [winningProof]],
		})
		await client.waitForTransactionReceipt({ hash })
		assert.ok((await getERC20Balance(client, childRepToken, client.account.address)) - winnerBalanceBefore > forkThresholdAttoRep, 'the migrated winner should receive principal plus its preserved reward without the losing vault migrating')
		strictEqualTypeSafe(await getTotalTheoreticalSupplyAttoRep(client, childRepToken), theoreticalSupplyBeforeClaim, 'settlement must not burn a second haircut after the own-question fork paid it')
	})

	test("multiple migrated winners settle in reverse order without using another vault owner's logical entitlement", async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		await refreshCurrentPrice()
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const losingClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const firstWinningPrincipal = forkThresholdAttoRep / 2n
		const secondWinningPrincipal = forkThresholdAttoRep - firstWinningPrincipal
		const firstWinnerVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const firstWinnerRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, firstWinnerVault.repBackingUnits)
		if (firstWinnerRep < firstWinningPrincipal) await approveAndDepositRepToVault(client, firstWinningPrincipal - firstWinnerRep, questionId)
		await approveAndDepositRepToVault(secondWinner, secondWinningPrincipal, questionId)
		await approveAndDepositRepToVault(losingClient, forkThresholdAttoRep, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningPrincipal)
		await depositToEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningPrincipal)
		await depositToEscalationGame(losingClient, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(secondWinner, securityPoolAddresses.securityPool, secondWinner.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesPool.securityPool, QuestionOutcome.No, losingClient.account.address), 0n, 'the aggregate physical backing must not create a logical claim for the losing vault')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesPool.securityPool)
		if ((await getSystemState(client, yesPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesPool.securityPool)
		}
		await completeForkContinuation(yesPool.securityPool)
		const escalationEndDate = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: yesGame,
			functionName: 'getEscalationGameEndDate',
		})
		await mockWindow.setTime(escalationEndDate + 1n)

		const firstLeafHash = await readCarryLeafHash(client, securityPoolAddresses.escalationGame, 1n)
		const secondLeafHash = await readCarryLeafHash(client, securityPoolAddresses.escalationGame, 2n)
		const nullifierTree = new SparseNullifierTree()
		const secondProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [firstLeafHash],
			nullifierSiblings: nullifierTree.getProof(1n),
			sourceNodeId: 2n,
		})
		nullifierTree.consume(1n)
		const firstProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [secondLeafHash],
			nullifierSiblings: nullifierTree.getProof(0n),
			sourceNodeId: 1n,
		})
		const childRepToken = getRepTokenAddress(yesUniverse)
		const secondWinnerBalanceBefore = await getERC20Balance(client, childRepToken, secondWinner.account.address)
		let hash = await secondWinner.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: yesPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [secondProof]],
		})
		await secondWinner.waitForTransactionReceipt({ hash })
		const firstWinnerBalanceBefore = await getERC20Balance(client, childRepToken, client.account.address)
		hash = await client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: yesPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [firstProof]],
		})
		await client.waitForTransactionReceipt({ hash })

		assert.ok((await getERC20Balance(client, childRepToken, secondWinner.account.address)) - secondWinnerBalanceBefore > secondWinningPrincipal, 'the second appended winner should receive its reward when settled first')
		assert.ok((await getERC20Balance(client, childRepToken, client.account.address)) - firstWinnerBalanceBefore > firstWinningPrincipal, 'the first appended winner should remain solvent when settled second')
	})

	test('a directly claimed parent deposit is invalid in every current and late child while its same-outcome remainder stays claimable', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		await refreshCurrentPrice()
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const firstYesDeposit = forkThresholdAttoRep / 3n
		const secondYesDeposit = forkThresholdAttoRep - firstYesDeposit
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
		if (vaultAttoRep < 2n * forkThresholdAttoRep) await approveAndDepositRepToVault(client, 2n * forkThresholdAttoRep - vaultAttoRep, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstYesDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondYesDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const noPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.No), questionId, statoblastSecurityMultiplierBps)
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		const noGame = await getSecurityPoolsEscalationGame(client, noPool.securityPool)
		const depositIds = await Promise.all(
			[securityPoolAddresses.securityPool, yesPool.securityPool, noPool.securityPool].map(
				async securityPool =>
					await client.readContract({
						address: getInfraContractAddresses().securityPoolForker,
						abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
						functionName: 'getEscalationDepositId',
						args: [securityPool, QuestionOutcome.Yes, 0n],
					}),
			),
		)
		strictEqualTypeSafe(depositIds[0], depositIds[1], 'a carried deposit should retain its global id in the matching child')
		strictEqualTypeSafe(depositIds[0], depositIds[2], 'a carried deposit should retain its global id in every sibling child')
		strictEqualTypeSafe(
			await client.readContract({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isEscalationDepositClaimedDirectly',
				args: [yesPool.securityPool, QuestionOutcome.Yes, 0n],
			}),
			true,
			'a replay lookup from a descendant parent should find a direct claim recorded in the root pool',
		)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		for (const childPool of [yesPool.securityPool, noPool.securityPool]) {
			await startTruthAuction(client, childPool)
			if ((await getSystemState(client, childPool)) === SystemState.ForkTruthAuction) await finalizeTruthAuction(client, childPool)
			await completeForkContinuation(childPool)
		}
		const [yesEndDate, noEndDate] = await Promise.all(
			[yesGame, noGame].map(
				async escalationGame =>
					await client.readContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'getEscalationGameEndDate',
					}),
			),
		)
		await mockWindow.setTime((yesEndDate > noEndDate ? yesEndDate : noEndDate) + 1n)

		const firstLeafHash = await readCarryLeafHash(client, securityPoolAddresses.escalationGame, 1n)
		const secondLeafHash = await readCarryLeafHash(client, securityPoolAddresses.escalationGame, 2n)
		const firstProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [secondLeafHash],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		const secondProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [firstLeafHash],
			nullifierSiblings: new SparseNullifierTree().getProof(1n),
			sourceNodeId: 2n,
		})

		await assert.rejects(
			client.writeContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesPool.securityPool,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [QuestionOutcome.Yes, [firstProof]],
			}),
			/Parent deposit claimed/,
		)
		const walletRepBeforeSecondClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		const secondClaimHash = await client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: yesPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [secondProof]],
		})
		const secondClaimReceipt = await client.waitForTransactionReceipt({ hash: secondClaimHash })
		assert.ok(secondClaimReceipt.gasUsed < CARRY_PROOF_GAS_LIMIT, `carry-proof verification used ${secondClaimReceipt.gasUsed.toString()} gas, above the ${CARRY_PROOF_GAS_LIMIT.toString()} ceiling`)
		assert.ok((await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)) > walletRepBeforeSecondClaim, 'the untouched same-outcome deposit should remain claimable')
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, yesGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep, 0n, 'the direct claim and the remaining winning proof should retire all winning principal without vault migration')
		const yesPoolRepBeforeSweep = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesPool.securityPool)
		const sweepHash = await client.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: yesGame,
			functionName: 'sweepResidualRepToSecurityPool',
			args: [],
		})
		await client.waitForTransactionReceipt({ hash: sweepHash })
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesPool.securityPool), yesPoolRepBeforeSweep, 'fork-continuation residual must not enter child ownership after only winners claim')
		await assert.rejects(
			client.writeContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: noPool.securityPool,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [QuestionOutcome.Yes, [firstProof]],
			}),
			/Parent deposit claimed/,
		)
	})

	test('forked continuation deposits can migrate again after a second unrelated fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		const recursiveDeposit = 2n * reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, recursiveDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, recursiveDeposit)

		const firstForkQuestionData = {
			...questionData,
			title: 'first recursive continuation fork source question',
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(attackerClient, firstForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, firstForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childVaultAfterFirstMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep, recursiveDeposit, 'the child continuation snapshot should carry the unresolved yes-side total before the second fork')
		strictEqualTypeSafe(childVaultAfterFirstMigration.disputeStakedAttoRep, 0n, 'recursive carry should remain aggregate-backed instead of seeding child vault escrow')

		const secondForkQuestionData = {
			...questionData,
			title: 'second recursive continuation fork source question',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const secondForkQuestionId = getQuestionId(secondForkQuestionData, outcomes)
		await createQuestion(attackerClient, secondForkQuestionData, outcomes)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child continuation pool should become operational before the second fork')

		const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
		const childForkThreshold = await getZoltarForkThreshold(client, yesUniverse)
		const childBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [attackerClient.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[childBalanceSlot]: childForkThreshold * 2n,
				},
			},
		})

		await forkUniverse(attackerClient, yesUniverse, secondForkQuestionId)
		const recursiveInitiationHash = await initiateSecurityPoolFork(client, yesSecurityPool.securityPool)
		const recursiveInitiationReceipt = await client.getTransactionReceipt({ hash: recursiveInitiationHash })
		assert.ok(recursiveInitiationReceipt.gasUsed < RECURSIVE_ANCESTOR_CHECK_GAS_LIMIT, `recursive fork initiation used ${recursiveInitiationReceipt.gasUsed.toString()} gas, above the ${RECURSIVE_ANCESTOR_CHECK_GAS_LIMIT.toString()} ceiling`)
		await migrateRepToZoltar(client, yesSecurityPool.securityPool, [QuestionOutcome.Yes])
		const recursiveMigrationHash = await migrateVaultWithUnresolvedEscalation(client, yesSecurityPool.securityPool, client.account.address, QuestionOutcome.Yes)
		const recursiveMigrationReceipt = await client.getTransactionReceipt({ hash: recursiveMigrationHash })
		assert.ok(recursiveMigrationReceipt.gasUsed < RECURSIVE_CARRY_MIGRATION_GAS_LIMIT, `recursive carry migration used ${recursiveMigrationReceipt.gasUsed.toString()} gas, above the ${RECURSIVE_CARRY_MIGRATION_GAS_LIMIT.toString()} ceiling`)

		const grandchildUniverse = getChildUniverseId(yesUniverse, QuestionOutcome.Yes)
		const grandchildSecurityPool = getSecurityPoolAddresses(yesSecurityPool.securityPool, grandchildUniverse, questionId, statoblastSecurityMultiplierBps)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const grandchildVault = await getSecurityVault(client, grandchildSecurityPool.securityPool, client.account.address)
		const grandchildEscalationGame = await getSecurityPoolsEscalationGame(client, grandchildSecurityPool.securityPool)
		const grandchildOutcomeState = await getEscalationGameOutcomeState(client, grandchildEscalationGame, QuestionOutcome.Yes)

		strictEqualTypeSafe(childVaultAfterMigration.disputeStakedAttoRep, 0n, 'the second migration should clear the carried lock from the child continuation vault')
		strictEqualTypeSafe(grandchildVault.disputeStakedAttoRep, 0n, 'the grandchild should keep recursive carry in aggregate state rather than vault escrow')
		strictEqualTypeSafe(grandchildOutcomeState.currentCarryTotalAttoRep, recursiveDeposit, 'the recursive continuation migration should preserve the carried unresolved total by snapshot')
	})

	test('an unrelated continuation with an inherited threshold tie can trigger its own fork without a synthetic deposit', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		const forkThresholdAttoRep = await getZoltarForkThreshold(client, genesisUniverse)
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		await depositRepToVault(attackerClient, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)

		const unrelatedQuestionData = {
			...questionData,
			title: 'inherited threshold tie fork source question',
		}
		const unrelatedQuestionId = getQuestionId(unrelatedQuestionData, outcomes)
		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const forkInitiatorBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [forkInitiator.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[addressString(GENESIS_REPUTATION_TOKEN)]: {
				stateDiff: {
					[forkInitiatorBalanceSlot]: 2n * forkThresholdAttoRep,
				},
			},
		})
		await createQuestion(forkInitiator, unrelatedQuestionData, outcomes)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, genesisUniverse, unrelatedQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the unrelated continuation should become operational before its own fork')

		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'nonDecisionState',
				args: [],
			}),
			2n,
			'the child should identify the inherited threshold tie explicitly',
		)
		strictEqualTypeSafe(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'nonDecisionTimestamp',
				args: [],
			}),
			0n,
			'the child should not fabricate a local non-decision timestamp',
		)
		strictEqualTypeSafe(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'canTriggerOwnFork',
				args: [],
			}),
			true,
			'an inherited threshold tie without a fixed outcome should authorize the child fork',
		)

		await forkZoltarWithOwnEscalationGame(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.PoolForked, 'the inherited tie should trigger the own-fork transition directly')
	})

	test('own-fork unresolved preparation on a continuation child includes inherited carried escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		const recursiveDeposit = 2n * reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, recursiveDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, recursiveDeposit)

		const firstForkQuestionData = {
			...questionData,
			title: 'own fork inherited carry source question',
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(attackerClient, firstForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, firstForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'continuation child should become operational before its own fork')
		await completeForkContinuation(yesSecurityPool.securityPool)

		const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
		const childForkThreshold = await getZoltarForkThreshold(client, yesUniverse)
		const childBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [client.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[childBalanceSlot]: childForkThreshold * 4n,
				},
			},
		})
		await approveToken(client, childRepToken, yesSecurityPool.securityPool)
		await depositRepToVault(client, yesSecurityPool.securityPool, childForkThreshold * 3n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
		await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, childForkThreshold)
		await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.No, childForkThreshold)
		await forkZoltarWithOwnEscalationGame(client, yesSecurityPool.securityPool)
		await migrateRepToZoltar(client, yesSecurityPool.securityPool, [QuestionOutcome.Yes])
		const hash = await client.writeContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [yesSecurityPool.securityPool, client.account.address, BigInt(QuestionOutcome.Yes)],
		})
		await client.waitForTransactionReceipt({ hash })

		const grandchildUniverse = getChildUniverseId(yesUniverse, QuestionOutcome.Yes)
		const grandchildSecurityPool = getSecurityPoolAddresses(yesSecurityPool.securityPool, grandchildUniverse, questionId, statoblastSecurityMultiplierBps)
		const grandchildVault = await getSecurityVault(client, grandchildSecurityPool.securityPool, client.account.address)
		const grandchildEscalationGame = await getSecurityPoolsEscalationGame(client, grandchildSecurityPool.securityPool)
		strictEqualTypeSafe(grandchildVault.disputeStakedAttoRep, 0n, 'recursive inherited carry should not create grandchild vault escrow')
		assert.ok((await getEscalationGameOutcomeState(client, grandchildEscalationGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep > 0n, 'the grandchild aggregate snapshot should retain inherited carry')
	})

	test('many unresolved continuation deposits survive multiple unrelated forks recursively', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		const recursiveDepositCount = 6n
		const depositIndexes: bigint[] = []
		for (let index = 0n; index < recursiveDepositCount; index += 1n) {
			depositIndexes.push(index)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		}

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		const firstForkQuestionData = {
			...questionData,
			title: 'first recursive wide continuation fork',
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(attackerClient, firstForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, firstForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, statoblastSecurityMultiplierBps)
		const firstChildEscalationGame = await getSecurityPoolsEscalationGame(client, firstChildPool.securityPool)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, firstChildEscalationGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep, recursiveDepositCount * reportBond, 'first child should inherit all unresolved yes-side principal by snapshot')

		const firstChildRepToken = await getRepToken(client, firstChildPool.securityPool)
		const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
		const firstChildBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [attackerClient.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[firstChildRepToken]: {
				stateDiff: {
					[firstChildBalanceSlot]: firstChildForkThreshold * 2n,
				},
			},
		})

		const secondForkQuestionData = {
			...questionData,
			title: 'second recursive wide continuation fork',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const secondForkQuestionId = getQuestionId(secondForkQuestionData, outcomes)
		await createQuestion(attackerClient, secondForkQuestionData, outcomes)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, firstChildPool.securityPool)
		if ((await getSystemState(client, firstChildPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, firstChildPool.securityPool)
		}
		strictEqualTypeSafe(await getQuestionResolution(client, firstChildEscalationGame), QuestionOutcome.None, 'the first child continuation should still be unresolved when the second unrelated fork begins')

		await forkUniverse(attackerClient, firstChildUniverse, secondForkQuestionId)
		await initiateSecurityPoolFork(client, firstChildPool.securityPool)
		await migrateRepToZoltar(client, firstChildPool.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])

		await migrateVaultWithUnresolvedEscalation(client, firstChildPool.securityPool, client.account.address, QuestionOutcome.Yes)

		const secondChildUniverse = getChildUniverseId(firstChildUniverse, QuestionOutcome.Yes)
		const secondChildPool = getSecurityPoolAddresses(firstChildPool.securityPool, secondChildUniverse, questionId, statoblastSecurityMultiplierBps)
		const secondChildEscalationGame = await getSecurityPoolsEscalationGame(client, secondChildPool.securityPool)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, secondChildEscalationGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep, recursiveDepositCount * reportBond, 'second child should inherit all unresolved yes-side principal from the first child by snapshot')
	})

	test('cannot refund an active escalation deposit before zoltar forks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Question not finalized|Question open/)
	})

	test("third parties can permissionlessly settle another vault owner's resolved escalation deposits", async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await refreshCurrentPrice()
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const ourDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(ourDeposit.depositor, client.account.address, 'wrong depositor')

		const clientVaultBeforeSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [ourDeposit.depositIndex])
		const clientVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(clientVaultAfterSettlement.disputeStakedAttoRep, 0n, 'permissionless settlement should clear the owners lock')
		strictEqualTypeSafe(clientVaultAfterSettlement.repBackingUnits >= clientVaultBeforeSettlement.repBackingUnits, true, 'permissionless settlement should preserve or increase the owners vault claim')
	})
})
