import { beforeEach, describe, test } from 'bun:test'
import { type Address } from '@zoltar/shared/ethereum'
import { usePeripheralsEscalationMigrationFixture, type PeripheralsEscalationMigrationFixture } from './fixture'
import { peripherals_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { createCarryProof, readCarryLeafHash, SparseNullifierTree } from '../carryProofHelpers'

const createSingleLeafCarryProof = async (client: PeripheralsEscalationMigrationFixture['client'], escalationGameAddress: Address, expectedOutcome: number, parentDepositIndex: bigint) =>
	await createCarryProof(client, escalationGameAddress, {
		expectedOutcome,
		parentDepositIndex,
		leafIndex: 0n,
		merkleMountainRangePeakIndex: 0n,
		merkleMountainRangeSiblings: [],
		nullifierSiblings: new SparseNullifierTree().getProof(parentDepositIndex),
	})

const localDepositsExportedAbi = [
	{
		inputs: [
			{ name: 'vault', type: 'address' },
			{ name: 'repReceiver', type: 'address' },
			{ name: 'principalByOutcome', type: 'uint256[3]' },
			{ name: 'principalToTransfer', type: 'uint256' },
			{ name: 'exportCursor', type: 'uint256' },
			{ name: 'transferredRep', type: 'bool' },
		],
		name: 'LocalDepositsExported',
		type: 'event',
	},
] as const

const hasPendingUnresolvedEscalationMigrationAbi = [
	{
		inputs: [
			{ internalType: 'contract ISecurityPool', name: 'securityPool', type: 'address' },
			{ internalType: 'address', name: 'vault', type: 'address' },
		],
		name: 'hasPendingUnresolvedEscalationMigration',
		outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

describe('Peripherals: escalation migration', () => {
	const fixture = usePeripheralsEscalationMigrationFixture()
	const assert: PeripheralsEscalationMigrationFixture['assert'] = fixture.assert
	const approximatelyEqual: PeripheralsEscalationMigrationFixture['approximatelyEqual'] = fixture.approximatelyEqual
	const strictEqualTypeSafe: PeripheralsEscalationMigrationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	const {
		decodeEventLog,
		encodeAbiParameters,
		keccak256,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		contractExists,
		sortStringArrayByKeccak,
		getChildUniverseId,
		getERC20Balance,
		addressString,
		approveAndDepositRep,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		getScalarOutcomeIndex,
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
		getOwnForkRepBuckets,
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
		getTotalTheoreticalSupply,
		getZoltarAddress,
		getZoltarForkThreshold,
		createCompleteSet,
		depositRep,
		depositToEscalationGame,
		getCompleteSetCollateralAmount,
		getRepToken,
		getAwaitingForkContinuation,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		getTotalSecurityBondAllowance,
		poolOwnershipToRep,
		withdrawFromEscalationGame,
		peripherals_EscalationGame_EscalationGame,
		peripherals_SecurityPoolForker_SecurityPoolForker,
		getMigrationProxyAddressAbi,
		migrateVaultWithUnresolvedEscalationReturnAbi,
		formatStorageSlot,
		getMappingStorageSlot,
		reportBond,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
		outcomes,
	} = fixture

	let mockWindow: PeripheralsEscalationMigrationFixture['mockWindow']
	let client: PeripheralsEscalationMigrationFixture['client']
	let securityPoolAddresses: PeripheralsEscalationMigrationFixture['securityPoolAddresses']
	let questionData: PeripheralsEscalationMigrationFixture['questionData']
	let questionId: PeripheralsEscalationMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	const migrateAllUnresolvedEscalationPages = async (migrationClient: PeripheralsEscalationMigrationFixture['client'], pool: Address, vault: Address) => {
		for (let page = 0; page < 100; page += 1) {
			await migrateVaultWithUnresolvedEscalation(migrationClient, pool, vault)
			const pending = await migrationClient.readContract({
				abi: hasPendingUnresolvedEscalationMigrationAbi,
				address: getInfraContractAddresses().securityPoolForker,
				functionName: 'hasPendingUnresolvedEscalationMigration',
				args: [pool, vault],
			})
			if (!pending) return
		}
		throw new Error('Unresolved escalation migration exceeded the test page limit')
	}

	const prepareExternalForkWithUnresolvedDeposit = async (forkTitle: string, forkQuestionData: typeof questionData, forkOutcomes: string[], childOutcomeIndexes: bigint[]) => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, reportBond * 2n)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const forkClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = { ...forkQuestionData, title: forkTitle }
		await createQuestion(forkClient, externalForkQuestionData, forkOutcomes)
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, forkOutcomes)
		await approveToken(forkClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, childOutcomeIndexes)
	}

	const assertPagedDestinationsPreserveParentTotals = async (childOutcomeIndexes: bigint[]) => {
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const parentStates = {
			invalid: await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid),
			yes: await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes),
			no: await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No),
		}
		const firstPreview = await client.simulateContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			address: forkerAddress,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [securityPoolAddresses.securityPool, client.account.address],
			account: client.account,
		})
		strictEqualTypeSafe(firstPreview.result, true, 'the first destination page should report more work')
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		for (const [index, childOutcomeIndex] of childOutcomeIndexes.entries()) {
			const childUniverse = getChildUniverseId(genesisUniverse, childOutcomeIndex)
			const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier)
			strictEqualTypeSafe(await contractExists(client, childPool.securityPool), index === 0, 'the first transaction should deploy only its bounded destination page')
		}

		strictEqualTypeSafe(
			await client.readContract({
				abi: hasPendingUnresolvedEscalationMigrationAbi,
				address: forkerAddress,
				functionName: 'hasPendingUnresolvedEscalationMigration',
				args: [securityPoolAddresses.securityPool, client.account.address],
			}),
			true,
			'the stored destination cursor should keep the exported batch pending',
		)

		for (let index = 1; index < childOutcomeIndexes.length; index += 1) {
			const preview = await client.simulateContract({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				address: forkerAddress,
				functionName: 'migrateVaultWithUnresolvedEscalation',
				args: [securityPoolAddresses.securityPool, client.account.address],
				account: client.account,
			})
			strictEqualTypeSafe(preview.result, index < childOutcomeIndexes.length - 1, 'the destination cursor should report completion only on the final page')
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		}

		for (const childOutcomeIndex of childOutcomeIndexes) {
			const childUniverse = getChildUniverseId(genesisUniverse, childOutcomeIndex)
			const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier)
			const childGame = await getSecurityPoolsEscalationGame(client, childPool.securityPool)
			for (const [outcome, parentState] of [
				[QuestionOutcome.Invalid, parentStates.invalid],
				[QuestionOutcome.Yes, parentStates.yes],
				[QuestionOutcome.No, parentStates.no],
			] as const) {
				const childState = await getEscalationGameOutcomeState(client, childGame, outcome)
				strictEqualTypeSafe(childState.balance, parentState.balance, 'every paged child outcome balance should match the original parent game')
				strictEqualTypeSafe(childState.currentCarryTotal, parentState.currentCarryTotal, 'every paged child outcome carry total should match the original parent game')
			}
			strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, childPool.securityPool, QuestionOutcome.Yes, client.account.address), reportBond, 'every paged child should receive the complete parent principal')
		}
	}

	test('categorical external forks preserve parent escalation totals across every paged child', async () => {
		const categoricalOutcomes = sortStringArrayByKeccak(['North', 'South', 'East', 'West', 'Center'])
		const childOutcomeIndexes = [0n, 1n, 2n, 3n, 4n, 5n]
		await prepareExternalForkWithUnresolvedDeposit('categorical destination paging fork', questionData, categoricalOutcomes, childOutcomeIndexes)
		await assertPagedDestinationsPreserveParentTotals(childOutcomeIndexes)
	})

	test('scalar external forks preserve parent escalation totals across every paged child', async () => {
		const scalarQuestionData = {
			...questionData,
			numTicks: 100n,
			displayValueMin: 0n,
			displayValueMax: 100n * 10n ** 18n,
			answerUnit: 'points',
		}
		const childOutcomeIndexes = [0n, getScalarOutcomeIndex(scalarQuestionData, 0n), getScalarOutcomeIndex(scalarQuestionData, 25n), getScalarOutcomeIndex(scalarQuestionData, 50n), getScalarOutcomeIndex(scalarQuestionData, 100n)]
		await prepareExternalForkWithUnresolvedDeposit('scalar destination paging fork', scalarQuestionData, [], childOutcomeIndexes)
		await assertPagedDestinationsPreserveParentTotals(childOutcomeIndexes)
	})

	test('migrateVaultWithUnresolvedEscalation funds a registered child from the frozen parent carry without replaying local deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
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
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const childForkDataBeforeMigration = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childEscalationBalanceBeforeMigration = await getERC20Balance(client, childRepToken, childEscalationGame)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childForkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childEscalationBalanceAfterMigration = await getERC20Balance(client, childRepToken, childEscalationGame)
		const childOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
		const childForkSnapshotInitialized = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'forkCarrySnapshotInitialized',
			args: [],
		})
		const childDepositsAfterMigration = await getEscalationGameDeposits(client, childEscalationGame, QuestionOutcome.Yes)
		const childLocalDepositCount = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'getDepositsByOutcomeLength',
			args: [QuestionOutcome.Yes],
		})

		strictEqualTypeSafe(parentVaultBeforeMigration.repInEscalationGame, unresolvedDeposit, 'the parent lock should equal the unresolved principal before migration')
		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'atomic unresolved migration should clear the parent lock')
		assert.ok(childVaultAfterMigration.repInEscalationGame > 0n, 'the child vault should inherit unresolved escrow in the child token')
		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, childEscalationBalanceAfterMigration - childEscalationBalanceBeforeMigration, 'the child vault escrow should match the child REP actually transferred into the continuation game')
		strictEqualTypeSafe(childForkData.migratedRep, childForkDataBeforeMigration.migratedRep, 'unresolved migration should not change child migrated REP accounting')
		assert.ok(childEscalationBalanceAfterMigration > childEscalationBalanceBeforeMigration, 'the child continuation game should receive child REP funding for the migrated unresolved deposits')
		strictEqualTypeSafe(childForkSnapshotInitialized, true, 'the child continuation game should inherit the fork carry snapshot')
		strictEqualTypeSafe(childDepositsAfterMigration.length, 0, 'the child continuation game should not replay parent unresolved deposits as fresh local deposits')
		strictEqualTypeSafe(childLocalDepositCount, 0n, 'continuation deposits should remain represented through the inherited carry snapshot')
		assert.ok(childOutcomeState.currentLeafCount > 0n, 'the child continuation game should inherit unresolved carry state from the parent snapshot')
		strictEqualTypeSafe(childOutcomeState.currentCarryTotal, unresolvedDeposit, 'the child continuation game should track the migrated unresolved principal')
	})

	test('migrateVaultWithUnresolvedEscalation reports bounded unresolved batches until migration is complete', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const depositCount = 65
		const totalUnresolvedDeposit = BigInt(depositCount) * reportBond
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		if (vaultRepBeforeTopUp < totalUnresolvedDeposit) {
			await approveAndDepositRep(client, totalUnresolvedDeposit - vaultRepBeforeTopUp, questionId)
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

		const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const migrationProxyAddress = await client.readContract({
			abi: getMigrationProxyAddressAbi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'getMigrationProxyAddress',
			args: [securityPoolAddresses.securityPool],
		})
		const decodeLocalDepositsExported = async (transactionHash: `0x${string}`, missingMessage: string) => {
			const receipt = await client.getTransactionReceipt({ hash: transactionHash })
			return ensureDefined(
				receipt.logs
					.filter(log => log.address.toLowerCase() === parentEscalationGame.toLowerCase())
					.flatMap(log => {
						try {
							return [
								decodeEventLog({
									abi: localDepositsExportedAbi,
									data: log.data,
									topics: log.topics,
								}),
							]
						} catch (error) {
							if (error instanceof Error && error.name === 'AbiEventSignatureNotFoundError') return []
							throw error
						}
					})
					.find(log => log.eventName === 'LocalDepositsExported'),
				missingMessage,
			)
		}
		const firstPreview = await client.simulateContract({
			abi: migrateVaultWithUnresolvedEscalationReturnAbi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [securityPoolAddresses.securityPool, client.account.address],
			account: client.account,
		})
		strictEqualTypeSafe(firstPreview.result, true, 'first bounded migration should report a remaining follow-up batch')
		const firstMigrationHash = await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		const firstExportLog = await decodeLocalDepositsExported(firstMigrationHash, 'first LocalDepositsExported log missing')
		strictEqualTypeSafe(firstExportLog.args.vault.toLowerCase(), client.account.address.toLowerCase(), 'first export log should identify the vault')
		strictEqualTypeSafe(firstExportLog.args.repReceiver, migrationProxyAddress, 'first export log should identify the migration proxy receiver')
		assert.deepStrictEqual([...firstExportLog.args.principalByOutcome], [0n, BigInt(depositCount - 1) * reportBond, 0n], 'first export log should report the first bounded yes-principal batch')
		strictEqualTypeSafe(firstExportLog.args.principalToTransfer, BigInt(depositCount - 1) * reportBond, 'first export log should report the REP transferred in the first batch')
		strictEqualTypeSafe(firstExportLog.args.exportCursor, BigInt(depositCount - 1), 'first export log should expose the cursor after the bounded batch')
		strictEqualTypeSafe(firstExportLog.args.transferredRep, true, 'external-fork export should transfer REP')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: parentEscalationGame,
				functionName: 'hasUnexportedLocalDepositRefs',
				args: [client.account.address],
			}),
			true,
			'first migration should leave the final unresolved ref pending',
		)

		const secondPreview = await client.simulateContract({
			abi: migrateVaultWithUnresolvedEscalationReturnAbi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [securityPoolAddresses.securityPool, client.account.address],
			account: client.account,
		})
		strictEqualTypeSafe(secondPreview.result, false, 'second bounded migration should report completion')
		const secondMigrationHash = await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		const secondExportLog = await decodeLocalDepositsExported(secondMigrationHash, 'second LocalDepositsExported log missing')
		strictEqualTypeSafe(secondExportLog.args.vault.toLowerCase(), client.account.address.toLowerCase(), 'second export log should identify the vault')
		strictEqualTypeSafe(secondExportLog.args.repReceiver, migrationProxyAddress, 'second export log should identify the migration proxy receiver')
		assert.deepStrictEqual([...secondExportLog.args.principalByOutcome], [0n, reportBond, 0n], 'second export log should report the final yes-principal batch')
		strictEqualTypeSafe(secondExportLog.args.principalToTransfer, reportBond, 'second export log should report the REP transferred in the final batch')
		strictEqualTypeSafe(secondExportLog.args.exportCursor, BigInt(depositCount), 'second export log should expose the exhausted cursor')
		strictEqualTypeSafe(secondExportLog.args.transferredRep, true, 'external-fork follow-up export should transfer REP')

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'follow-up migration should clear all parent unresolved escrow')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: parentEscalationGame,
				functionName: 'hasUnexportedLocalDepositRefs',
				args: [client.account.address],
			}),
			false,
			'follow-up migration should exhaust the export cursor',
		)
	})

	test('own-fork continuation stays paused after pricing until its complete inherited carry is funded', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThreshold ? 3n * forkThreshold - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRep(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address))
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'pricing may make the child pool operational')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the own-fork escalation game must remain paused while inherited carry is unfunded')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'forkResumedAt',
			}),
			0n,
			'pricing must not resume an underfunded own-fork continuation',
		)

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should stop waiting after its complete inherited carry is funded')
		assert.ok(
			(await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'forkResumedAt',
			})) > 0n,
			'the fully funded own-fork continuation should resume',
		)
	})

	test('own-fork unresolved migration after the deadline only funds carried escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		if (vaultRepBeforeTopUp < 3n * forkThreshold) {
			await approveAndDepositRep(client, 3n * forkThreshold - vaultRepBeforeTopUp, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const forkTime = await mockWindow.getTime()
		await mockWindow.setTime(forkTime + 8n * 7n * DAY + 1n)
		const childVaultBefore = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const parentVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childCollateralBefore = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const parentCollateralBefore = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childCollateral = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const parentCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(childVault.repDepositShare, 0n, 'late unresolved migration must not move ordinary vault ownership')
		strictEqualTypeSafe(childVault.securityBondAllowance, 0n, 'late unresolved migration must not move ordinary bond allowance')
		strictEqualTypeSafe(childVault.repDepositShare, childVaultBefore.repDepositShare, 'late unresolved migration must preserve child ownership')
		strictEqualTypeSafe(childVault.securityBondAllowance, childVaultBefore.securityBondAllowance, 'late unresolved migration must preserve child allowance')
		strictEqualTypeSafe(parentVault.repDepositShare, parentVaultBefore.repDepositShare, 'late unresolved migration must preserve parent ownership')
		strictEqualTypeSafe(parentVault.securityBondAllowance, parentVaultBefore.securityBondAllowance, 'late unresolved migration must preserve parent allowance')
		strictEqualTypeSafe(parentVault.unpaidEthFees, parentVaultBefore.unpaidEthFees, 'late unresolved migration must preserve parent unpaid fees')
		strictEqualTypeSafe(parentVault.feeIndex, parentVaultBefore.feeIndex, 'late unresolved migration must preserve parent fee index')
		strictEqualTypeSafe(childCollateral, childCollateralBefore, 'late unresolved migration must preserve child collateral')
		strictEqualTypeSafe(parentCollateral, parentCollateralBefore, 'late unresolved migration must preserve parent collateral')
		assert.ok(childVault.repInEscalationGame > 0n, 'late unresolved migration should still fund carried escrow')
	})

	test('external-fork unresolved migration after the deadline only funds carried escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
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
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const forkTime = await mockWindow.getTime()
		await mockWindow.setTime(forkTime + 8n * 7n * DAY + 1n)
		const childVaultBefore = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const parentVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childCollateralBefore = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const parentCollateralBefore = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childCollateral = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const parentCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(childVault.repDepositShare, 0n, 'late unresolved migration must not move ordinary vault ownership')
		strictEqualTypeSafe(childVault.securityBondAllowance, 0n, 'late unresolved migration must not move ordinary bond allowance')
		strictEqualTypeSafe(childVault.repDepositShare, childVaultBefore.repDepositShare, 'late unresolved migration must preserve child ownership')
		strictEqualTypeSafe(childVault.securityBondAllowance, childVaultBefore.securityBondAllowance, 'late unresolved migration must preserve child allowance')
		strictEqualTypeSafe(parentVault.repDepositShare, parentVaultBefore.repDepositShare, 'late unresolved migration must preserve parent ownership')
		strictEqualTypeSafe(parentVault.securityBondAllowance, parentVaultBefore.securityBondAllowance, 'late unresolved migration must preserve parent allowance')
		strictEqualTypeSafe(parentVault.unpaidEthFees, parentVaultBefore.unpaidEthFees, 'late unresolved migration must preserve parent unpaid fees')
		strictEqualTypeSafe(parentVault.feeIndex, parentVaultBefore.feeIndex, 'late unresolved migration must preserve parent fee index')
		strictEqualTypeSafe(childCollateral, childCollateralBefore, 'late unresolved migration must preserve child collateral')
		strictEqualTypeSafe(parentCollateral, parentCollateralBefore, 'late unresolved migration must preserve parent collateral')
		assert.ok(childVault.repInEscalationGame > 0n, 'late unresolved migration should still fund carried escrow')
	})

	test('in-window external unresolved migration requires the vault owner to call it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

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

		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address))
	})

	test('migrateVaultWithUnresolvedEscalation clears parent escrow as dust when the child allocation rounds to zero', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, unresolvedDeposit + 1n)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThreshold ? 3n * forkThreshold - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRep(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		const ownForkChildRepAtForkSlot = formatStorageSlot(parentForkDataSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[ownForkChildRepAtForkSlot]: 0n,
				},
			},
		})

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentDepositsAfterMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoDepositsAfterMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const childPoolExists = await contractExists(client, yesSecurityPool.securityPool)
		const childVaultAfterMigration = childPoolExists ? await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address) : undefined

		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'zero child allocation should clear the parent unresolved REP lock as dust')
		strictEqualTypeSafe(parentDepositsAfterMigration.filter(deposit => deposit.amount > 0n).length, 0, 'zero child allocation should consume the parent unresolved deposits')
		strictEqualTypeSafe(parentNoDepositsAfterMigration.filter(deposit => deposit.amount > 0n).length, 0, 'zero child allocation should consume all unresolved parent deposits for the vault')
		strictEqualTypeSafe(childVaultAfterMigration?.repInEscalationGame ?? 0n, 0n, 'zero child allocation should not create child escrow')
	})

	test('migrateVaultWithUnresolvedEscalation in non-own fork carries escrow through the continuation snapshot without replaying local deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

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
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, yesEscalationGame, QuestionOutcome.Yes)
		const yesDepositsAfterMigration = await getEscalationGameDeposits(client, yesEscalationGame, QuestionOutcome.Yes)
		const childEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)

		strictEqualTypeSafe(yesDepositsAfterMigration.length, 0, 'non-own unresolved migration should not replay parent local deposits in the child game')
		strictEqualTypeSafe(yesOutcomeState.balance, unresolvedDeposit, 'non-own continuation should keep inherited resolution balances 1:1 with source REP')
		strictEqualTypeSafe(childEscrowPrincipal, unresolvedDeposit, 'non-own continuation should retain the original unresolved principal for proof settlement')
		strictEqualTypeSafe(childEscrowChildRep, unresolvedDeposit, 'non-own continuation should back the carried escrow 1:1 in child REP')
	})

	test('zero-REP registration rejects malformed outcomes without poisoning all-child carry migration', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'zero REP malformed registration source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[formatStorageSlot(parentForkDataSlot)]: 0n,
				},
			},
		})

		await assert.rejects(migrateRepToZoltar(attackerClient, securityPoolAddresses.securityPool, [QuestionOutcome.None]), /Malformed outcome/)
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isChildOutcomeRegistered',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddresses.securityPool, BigInt(QuestionOutcome.None)],
			}),
			false,
			'a malformed zero-REP outcome must not be registered',
		)

		await migrateRepToZoltar(attackerClient, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.Yes), questionId, securityMultiplier)
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address), reportBond, 'valid all-child carry migration should remain available after malformed registration reverts')
	})

	test('pre-created continuation children preserve the complete parent escalation balances', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
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
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isChildOutcomeRegistered',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddresses.securityPool, BigInt(QuestionOutcome.Invalid)],
			}),
			true,
			'creating a child pool should register its outcome without migrateRepToZoltar',
		)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)

		for (const childOutcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const childUniverse = getChildUniverseId(genesisUniverse, childOutcome)
			const childSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier)
			const childEscalationGame = await getSecurityPoolsEscalationGame(client, childSecurityPool.securityPool)
			const invalidOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Invalid)
			const yesOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
			const noOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.No)
			const childTotalCost = await getEscalationGameTotalCost(client, childEscalationGame)

			strictEqualTypeSafe(invalidOutcomeState.balance, parentInvalidState.balance, 'pre-created child must inherit the complete parent invalid balance')
			strictEqualTypeSafe(yesOutcomeState.balance, parentYesState.balance, 'pre-created child must inherit the complete parent yes balance')
			strictEqualTypeSafe(noOutcomeState.balance, parentNoState.balance, 'pre-created child must inherit the complete parent no balance')
			strictEqualTypeSafe(childTotalCost, 0n, 'child continuations should still start before continuation attrition becomes active')
		}

		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getForkedEscrowPrincipalByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.Invalid, attackerClient.account.address), 2n * reportBond, 'the create-only registered child should receive the other vaults invalid carry')
		strictEqualTypeSafe(
			(await getForkedEscrowPrincipalByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)) + (await getForkedEscrowPrincipalByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.No, client.account.address)),
			2n * reportBond,
			'the create-only registered child should receive all carry from the remaining vault',
		)
	})

	test('every continuation child receives the complete parent escalation game when vault migration finishes', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const otherClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(otherClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await depositToEscalationGame(otherClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		const parentInvalidState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid)
		const parentYesState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

		const externalForkQuestionData = {
			...questionData,
			title: 'fork-wide continuation accounting',
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

		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.Yes), questionId, securityMultiplier)
		const noPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, getChildUniverseId(genesisUniverse, QuestionOutcome.No), questionId, securityMultiplier)
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		const noGame = await getSecurityPoolsEscalationGame(client, noPool.securityPool)
		const emptyYesState = await getEscalationGameOutcomeState(client, yesGame, QuestionOutcome.Yes)
		const emptyNoState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.No)
		strictEqualTypeSafe(emptyYesState.balance, parentYesState.balance, 'pre-created yes branch must inherit the complete parent game')
		strictEqualTypeSafe(emptyNoState.balance, parentNoState.balance, 'pre-created no branch must inherit the complete parent game')

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(otherClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		await migrateAllUnresolvedEscalationPages(client, securityPoolAddresses.securityPool, client.account.address)
		for (const childGame of [yesGame, noGame]) {
			strictEqualTypeSafe(
				await client.readContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: childGame,
					functionName: 'isForkCarryFundingComplete',
				}),
				false,
				'every child must remain underfunded until the other vault migrates its parent escalation REP',
			)
		}
		await migrateAllUnresolvedEscalationPages(otherClient, securityPoolAddresses.securityPool, otherClient.account.address)
		for (const childGame of [yesGame, noGame]) {
			strictEqualTypeSafe(
				await client.readContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: childGame,
					functionName: 'isForkCarryFundingComplete',
				}),
				true,
				'every child must become fully funded after all parent escalation REP migrates',
			)
		}
		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid]), /Escalation destinations locked/)
		const yesState = await getEscalationGameOutcomeState(client, yesGame, QuestionOutcome.Yes)
		const noState = await getEscalationGameOutcomeState(client, noGame, QuestionOutcome.No)
		for (const [label, childGame] of [
			['yes', yesGame],
			['no', noGame],
		] as const) {
			for (const [outcomeLabel, outcome, parentState] of [
				['invalid', QuestionOutcome.Invalid, parentInvalidState],
				['yes', QuestionOutcome.Yes, parentYesState],
				['no', QuestionOutcome.No, parentNoState],
			] as const) {
				const childState = await getEscalationGameOutcomeState(client, childGame, outcome)
				strictEqualTypeSafe(childState.balance, parentState.balance, `${label} child ${outcomeLabel} balance must match the original parent game`)
				strictEqualTypeSafe(childState.currentCarryTotal, parentState.currentCarryTotal, `${label} child ${outcomeLabel} carry must match the original parent game`)
			}
		}
		strictEqualTypeSafe(yesState.balance, parentYesState.balance, 'the yes child must include escalation REP from the vault whose ordinary position chose the no child')
		strictEqualTypeSafe(noState.balance, parentNoState.balance, 'the no child must include escalation REP from the vault whose ordinary position chose the yes child')
	})

	test('claimForkedEscalationDeposits requires the vault owner to call it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = reportBond
		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(relayerClient, repDeposit, questionId)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		await assert.rejects(claimForkedEscalationDeposits(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
	})

	test('claimForkedEscalationDeposits requires an actual universe fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const nonDecisionThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 4n * nonDecisionThreshold)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, nonDecisionThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, nonDecisionThreshold)

		const nonDecisionTimestamp = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: securityPoolAddresses.escalationGame,
			functionName: 'nonDecisionTimestamp',
		})
		assert.ok(nonDecisionTimestamp > 0n, 'balanced threshold deposits should reach non-decision')
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'the parent should not be forked yet')
		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /Non-decision required/)
	})

	test('own-fork children preserve identical principal while outcome caps produce different child REP backing', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThreshold ? 3n * forkThreshold - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRep(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.ok(ownForkRepBuckets.unallocatedEscrowChildRep > 1n, 'the own-fork escrow bucket should support outcome-specific remaining backing')
		const parentAllocationSlot = BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [securityPoolAddresses.securityPool, 1n])))
		const yesAllocationSlot = BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [BigInt(QuestionOutcome.Yes), parentAllocationSlot])))
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[formatStorageSlot(yesAllocationSlot + 1n)]: ownForkRepBuckets.unallocatedEscrowChildRep - 1n,
				},
			},
		})
		const parentInvalidOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid)
		const parentYesOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		await migrateAllUnresolvedEscalationPages(client, securityPoolAddresses.securityPool, client.account.address)

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
		const noChildEscrowPrincipal = (await getForkedEscrowPrincipalByOutcomeAndVault(client, noSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)) + (await getForkedEscrowPrincipalByOutcomeAndVault(client, noSecurityPool.securityPool, QuestionOutcome.No, client.account.address))
		const noChildEscrowChildRep = (await getForkedEscrowChildRepByOutcomeAndVault(client, noSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)) + (await getForkedEscrowChildRepByOutcomeAndVault(client, noSecurityPool.securityPool, QuestionOutcome.No, client.account.address))

		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'an underfunded child branch should still clear the parent unresolved REP lock after the migration succeeds')
		strictEqualTypeSafe(childPoolExists, true, 'an underfunded child branch should deploy the child pool')
		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, childEscrowChildRep, 'the child vault escrow should match the child REP actually transferred into the continuation game')
		strictEqualTypeSafe(invalidOutcomeState.balance, parentInvalidOutcomeState.balance, 'the child invalid balance should stay aligned with the parent snapshot')
		strictEqualTypeSafe(yesOutcomeState.balance, parentYesOutcomeState.balance, 'the child yes balance should preserve the parent snapshot even when child REP backing is smaller')
		strictEqualTypeSafe(noOutcomeState.balance, parentNoOutcomeState.balance, 'the child no balance should stay aligned with the parent snapshot')
		strictEqualTypeSafe(childEscrowPrincipal, noChildEscrowPrincipal, 'every own-fork child must record identical source principal')
		assert.ok(childEscrowPrincipal > childEscrowChildRep, 'the capped yes continuation should retain more parent principal than child REP backing')
		strictEqualTypeSafe(childEscrowChildRep, 1n, 'the prior yes-outcome allocation should leave only one child REP of backing')
		assert.ok(noChildEscrowChildRep > childEscrowChildRep, 'the uncapped no continuation should receive more child REP backing than the previously allocated yes continuation')
	})

	test('late external-fork carry funding deploys every registered continuation destination', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'late registered continuation deployment source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await contractExists(client, yesSecurityPool.securityPool), true, 'the yes continuation should be deployed before the deadline')
		strictEqualTypeSafe(await contractExists(client, noSecurityPool.securityPool), false, 'the no continuation should remain registered but undeployed before late recovery')
		const parentYesState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await migrateAllUnresolvedEscalationPages(relayerClient, securityPoolAddresses.securityPool, client.account.address)

		strictEqualTypeSafe(await contractExists(client, noSecurityPool.securityPool), true, 'late recovery should deploy the previously registered no continuation')
		for (const [label, childPool] of [
			['yes', yesSecurityPool.securityPool],
			['no', noSecurityPool.securityPool],
		] as const) {
			const childGame = await getSecurityPoolsEscalationGame(client, childPool)
			const childYesState = await getEscalationGameOutcomeState(client, childGame, QuestionOutcome.Yes)
			strictEqualTypeSafe(childYesState.balance, parentYesState.balance, `${label} continuation should preserve the parent yes balance`)
			strictEqualTypeSafe(childYesState.currentCarryTotal, parentYesState.currentCarryTotal, `${label} continuation should preserve the parent yes carry total`)
			strictEqualTypeSafe(
				await client.readContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: childGame,
					functionName: 'isForkCarryFundingComplete',
				}),
				true,
				`${label} continuation should be fully funded by late recovery`,
			)
		}
	})

	test('an unmigrated losing external-fork lock can be force-funded after the deadline', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const winningDeposit = 3n * reportBond
		const losingDeposit = 2n * reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)

		const externalForkQuestionData = {
			...questionData,
			title: 'unmigrated losing continuation payout grief source',
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
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const childEscalationBalanceBeforeResume = await getERC20Balance(client, childRepToken, childEscalationGame)
		strictEqualTypeSafe(childEscalationBalanceBeforeResume, winningDeposit, 'only the migrated winning lock should fund the child continuation game before resolution')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child branch should still become operational after the migration window')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'every child should wait for the losing vault because escalation REP is fork-wide')

		let childResolution = await getQuestionResolution(client, childEscalationGame)
		for (let days = 0; days < 14 && childResolution === QuestionOutcome.None; days += 1) {
			await mockWindow.advanceTime(DAY)
			childResolution = await getQuestionResolution(client, childEscalationGame)
		}
		strictEqualTypeSafe(childResolution, QuestionOutcome.None, 'the child continuation should stay unresolved while the losing lock never migrates')

		const proof = await createSingleLeafCarryProof(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes, 0n)
		const walletBalanceBeforeClaim = await getERC20Balance(client, childRepToken, client.account.address)
		const childVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [QuestionOutcome.Yes, [proof]],
			}),
			/Question not finalized|Question open/,
		)
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, client.account.address), walletBalanceBeforeClaim, 'the honest winner should not receive child REP before the losing vault funds its carried lock')
		strictEqualTypeSafe((await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).repInEscalationGame, childVaultBeforeClaim.repInEscalationGame, 'the paused continuation should preserve the winner escrow while funding is incomplete')

		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should resume when a third party force-funds the losing carry after the deadline')

		childResolution = await getQuestionResolution(client, childEscalationGame)
		for (let days = 0; days < 14 && childResolution === QuestionOutcome.None; days += 1) {
			await mockWindow.advanceTime(DAY)
			childResolution = await getQuestionResolution(client, childEscalationGame)
		}
		strictEqualTypeSafe(childResolution, QuestionOutcome.Yes, 'the funded continuation should eventually resolve once the losing vault migrates')
		const claimHash = await client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			address: yesSecurityPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [proof]],
		})
		await client.waitForTransactionReceipt({ hash: claimHash })
		assert.ok((await getERC20Balance(client, childRepToken, client.account.address)) > walletBalanceBeforeClaim, 'the honest winner should receive child REP once all carried funding is present')
	})

	test('an unmigrated winning external-fork lock cannot free-ride on another vaults migrated child REP', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const honestWinningDeposit = 10n * reportBond
		const attackerWinningDeposit = reportBond
		const attackerLosingDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, honestWinningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, attackerWinningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, attackerLosingDeposit)

		const externalForkQuestionData = {
			...questionData,
			title: 'unmigrated winning continuation free ride source',
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
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, childEscalationGame), honestWinningDeposit, 'only the honest winners migrated child REP should fund the continuation game before the attacker claims')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should wait until every winning vault funds its carried lock')

		let childResolution = await getQuestionResolution(client, childEscalationGame)
		for (let days = 0; days < 14 && childResolution === QuestionOutcome.None; days += 1) {
			await mockWindow.advanceTime(DAY)
			childResolution = await getQuestionResolution(client, childEscalationGame)
		}
		strictEqualTypeSafe(childResolution, QuestionOutcome.None, 'the child continuation should remain unresolved until the winning vault migrates its own carry')

		const attackerLeafSibling = await readCarryLeafHash(client, securityPoolAddresses.escalationGame, 1n)
		const attackerProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			sourceNodeId: 2n,
			parentDepositIndex: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [attackerLeafSibling],
			nullifierSiblings: new SparseNullifierTree().getProof(1n),
		})
		const attackerWalletBeforeClaim = await getERC20Balance(client, childRepToken, attackerClient.account.address)
		const attackerParentVaultBeforeClaim = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		const childBalanceBeforeClaim = await getERC20Balance(client, childRepToken, childEscalationGame)
		await assert.rejects(
			attackerClient.writeContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [QuestionOutcome.Yes, [attackerProof]],
			}),
			/Question not finalized|Question open/,
		)
		const honestWinnerProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			sourceNodeId: 1n,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [await readCarryLeafHash(client, securityPoolAddresses.escalationGame, 2n)],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, attackerClient.account.address), attackerWalletBeforeClaim, 'the attacker should not extract child REP before migrating their own lock')
		strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)).repInEscalationGame, attackerParentVaultBeforeClaim.repInEscalationGame, 'the attackers parent lock should remain unmigrated while the child stays paused')
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, childEscalationGame), childBalanceBeforeClaim, 'the child continuation balance should not be drained by an unfunded claimant')
		await assert.rejects(
			client.writeContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [QuestionOutcome.Yes, [honestWinnerProof]],
			}),
			/Question not finalized|Question open/,
		)

		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should only resume once the winning vault funds its own carry')
	})

	test('large unresolved continuation migration snapshots carry totals without replaying imported deposit indexes', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const nonDecisionThreshold = (await getZoltarForkThreshold(client, genesisUniverse)) / 2n
		const capacity = nonDecisionThreshold / reportBond
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childOutcomeState = await getEscalationGameOutcomeState(client, yesEscalationGame, QuestionOutcome.Yes)
		assert.ok(childOutcomeState.currentCarryRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000', 'the child continuation should materialize a non-empty carry root')
		strictEqualTypeSafe(childOutcomeState.currentLeafCount, parentOutcomeStateBeforeMigration.currentLeafCount, 'continuation migration should preserve the parent carry leaf count')
		strictEqualTypeSafe(childOutcomeState.currentCarryTotal, parentOutcomeStateBeforeMigration.currentCarryTotal, 'snapshot-only migration should preserve the parent unresolved carry total')
	})

	test('external-fork continuation stays frozen after pricing until the remaining carried funding arrives', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childCostDuringMigration = await getEscalationGameTotalCost(client, childEscalationGame)
		approximatelyEqual(childCostDuringMigration, parentCostAtFork, 100000000000000n, 'the child continuation game should inherit the fork-time cost snapshot')

		await mockWindow.advanceTime(3n * DAY)
		strictEqualTypeSafe(await getEscalationGameTotalCost(client, childEscalationGame), childCostDuringMigration, 'continuation cost should stay frozen while the child is still in fork migration')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should become operational once migration completes')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should remain frozen until every parent escalation position is funded')

		const childCostAtResume = await getEscalationGameTotalCost(client, childEscalationGame)
		strictEqualTypeSafe(childCostAtResume, childCostDuringMigration, 'the paused continuation should keep its frozen fork-time cost after pricing')

		await mockWindow.advanceTime(DAY)
		strictEqualTypeSafe(await getEscalationGameTotalCost(client, childEscalationGame), childCostAtResume, 'child continuation cost should remain frozen while a carried loser still withholds funding')

		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should stop waiting once the last carried loser funds the continuation')
		const childCostAtFunding = await getEscalationGameTotalCost(client, childEscalationGame)
		// The funding transaction resumes the game at its block timestamp, so a subsequent read may include one simulator second of accrual.
		assert.ok(childCostAtFunding >= childCostAtResume, 'resuming the continuation should not reduce its frozen fork-time cost snapshot')
		approximatelyEqual(childCostAtFunding, childCostAtResume, 100000000000000n, 'resuming the continuation should begin from the same frozen fork-time cost snapshot')

		await mockWindow.advanceTime(DAY)
		assert.ok((await getEscalationGameTotalCost(client, childEscalationGame)) > childCostAtFunding, 'child continuation cost should advance again after the remaining carried funding arrives')
	})

	test('late external-fork carry funding does not reopen ordinary vault migration after pricing', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const clientSecurityBondAllowance = 3n * reportBond
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, clientSecurityBondAllowance)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)

		const externalForkQuestionData = {
			...questionData,
			title: 'late unresolved carry funding should not reopen ordinary migration',
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
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child branch should become operational after the truth auction')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should await every parent escalation position even when ordinary vault ownership chose another branch')

		const childVaultBeforeLateFunding = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childForkDataBeforeLateFunding = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childCollateralBeforeLateFunding = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const childTotalAllowanceBeforeLateFunding = await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool)
		const parentVaultBeforeLateFunding = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(parentVaultBeforeLateFunding.repDepositShare > 0n, 'the late-funding vault should still retain ordinary pool ownership on the parent after the migration window closes')
		strictEqualTypeSafe(parentVaultBeforeLateFunding.securityBondAllowance, clientSecurityBondAllowance, 'the late-funding vault should still retain its ordinary parent security-bond allowance after the migration window closes')

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)

		const childVaultAfterLateFunding = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childForkDataAfterLateFunding = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childCollateralAfterLateFunding = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const childTotalAllowanceAfterLateFunding = await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool)
		const parentVaultAfterLateFunding = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childEscrowAfterLateFunding = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)

		strictEqualTypeSafe(childVaultAfterLateFunding.repDepositShare, childVaultBeforeLateFunding.repDepositShare, 'late carried funding should not reopen ordinary child vault ownership migration after pricing')
		strictEqualTypeSafe(childVaultAfterLateFunding.securityBondAllowance, childVaultBeforeLateFunding.securityBondAllowance, 'late carried funding should not reopen ordinary child security-bond migration after pricing')
		strictEqualTypeSafe(childForkDataAfterLateFunding.migratedRep, childForkDataBeforeLateFunding.migratedRep, 'late carried funding should not alter child migrated REP after pricing')
		strictEqualTypeSafe(childForkDataAfterLateFunding.auctionedSecurityBondAllowance, childForkDataBeforeLateFunding.auctionedSecurityBondAllowance, 'late carried funding should not alter the child auctioned allowance after pricing')
		strictEqualTypeSafe(childCollateralAfterLateFunding, childCollateralBeforeLateFunding, 'late carried funding should not transfer new child collateral after pricing')
		strictEqualTypeSafe(childTotalAllowanceAfterLateFunding, childTotalAllowanceBeforeLateFunding, 'late carried funding should not change total child security-bond allowance after pricing')
		assert.ok(childEscrowAfterLateFunding > 0n, 'late carried funding should still record child forked escrow for the resumed continuation')
		strictEqualTypeSafe(parentVaultAfterLateFunding.repDepositShare, parentVaultBeforeLateFunding.repDepositShare, 'late carried funding should leave the parents ordinary pool ownership untouched')
		strictEqualTypeSafe(parentVaultAfterLateFunding.securityBondAllowance, parentVaultBeforeLateFunding.securityBondAllowance, 'late carried funding should leave the parents ordinary security-bond allowance untouched')
		strictEqualTypeSafe(parentVaultAfterLateFunding.repInEscalationGame, 0n, 'late carried funding should still clear the parents unresolved escalation lock')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should stop awaiting continuation once the last carried funding arrives')
	})

	test('forked continuation deposits can migrate again after a second unrelated fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childVaultAfterFirstMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)).currentCarryTotal, recursiveDeposit, 'the child continuation snapshot should carry the unresolved yes-side total before the second fork')
		strictEqualTypeSafe(childVaultAfterFirstMigration.repInEscalationGame, recursiveDeposit, 'the first migration should seed the child continuation vault escrow')

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
		await initiateSecurityPoolFork(client, yesSecurityPool.securityPool)
		await migrateRepToZoltar(client, yesSecurityPool.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, yesSecurityPool.securityPool, client.account.address)

		const grandchildUniverse = getChildUniverseId(yesUniverse, QuestionOutcome.Yes)
		const grandchildSecurityPool = getSecurityPoolAddresses(yesSecurityPool.securityPool, grandchildUniverse, questionId, securityMultiplier)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const grandchildVault = await getSecurityVault(client, grandchildSecurityPool.securityPool, client.account.address)
		const grandchildEscalationGame = await getSecurityPoolsEscalationGame(client, grandchildSecurityPool.securityPool)
		const grandchildOutcomeState = await getEscalationGameOutcomeState(client, grandchildEscalationGame, QuestionOutcome.Yes)

		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, 0n, 'the second migration should clear the carried lock from the child continuation vault')
		strictEqualTypeSafe(grandchildVault.repInEscalationGame, recursiveDeposit, 'the carried unresolved principal should survive into the grandchild continuation vault')
		strictEqualTypeSafe(grandchildOutcomeState.currentCarryTotal, recursiveDeposit, 'the recursive continuation migration should preserve the carried unresolved total by snapshot')
	})

	test('own-fork unresolved preparation on a continuation child includes inherited carried escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'continuation child should become operational before its own fork')

		const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
		const childForkThreshold = await getZoltarForkThreshold(client, yesUniverse)
		const childBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [client.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[childBalanceSlot]: childForkThreshold * 3n,
				},
			},
		})
		await approveToken(client, childRepToken, yesSecurityPool.securityPool)
		await depositRep(client, yesSecurityPool.securityPool, childForkThreshold * 3n)
		await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, childForkThreshold)
		await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.No, childForkThreshold)
		await forkZoltarWithOwnEscalationGame(client, yesSecurityPool.securityPool)
		await migrateRepToZoltar(client, yesSecurityPool.securityPool, [QuestionOutcome.Yes])
		const hash = await client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [yesSecurityPool.securityPool, client.account.address],
		})
		await client.waitForTransactionReceipt({ hash })

		const grandchildUniverse = getChildUniverseId(yesUniverse, QuestionOutcome.Yes)
		const grandchildSecurityPool = getSecurityPoolAddresses(yesSecurityPool.securityPool, grandchildUniverse, questionId, securityMultiplier)
		const grandchildVault = await getSecurityVault(client, grandchildSecurityPool.securityPool, client.account.address)
		assert.ok(grandchildVault.repInEscalationGame > 0n, 'own-fork unresolved migration on a continuation child should include inherited carried escrow')
	})

	test('many unresolved continuation deposits survive multiple unrelated forks recursively', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const recursiveDepositCount = 6n
		const depositIndexes: bigint[] = []
		for (let index = 0n; index < recursiveDepositCount; index += 1n) {
			depositIndexes.push(index)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		}

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
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
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No)

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address)

		const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, securityMultiplier)
		const firstChildEscalationGame = await getSecurityPoolsEscalationGame(client, firstChildPool.securityPool)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, firstChildEscalationGame, QuestionOutcome.Yes)).currentCarryTotal, recursiveDepositCount * reportBond, 'first child should inherit all unresolved yes-side principal by snapshot')

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
		await createChildUniverse(client, firstChildPool.securityPool, QuestionOutcome.Yes)
		await createChildUniverse(client, firstChildPool.securityPool, QuestionOutcome.No)

		await migrateVaultWithUnresolvedEscalation(client, firstChildPool.securityPool, client.account.address)

		const secondChildUniverse = getChildUniverseId(firstChildUniverse, QuestionOutcome.Yes)
		const secondChildPool = getSecurityPoolAddresses(firstChildPool.securityPool, secondChildUniverse, questionId, securityMultiplier)
		const secondChildEscalationGame = await getSecurityPoolsEscalationGame(client, secondChildPool.securityPool)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, secondChildEscalationGame, QuestionOutcome.Yes)).currentCarryTotal, recursiveDepositCount * reportBond, 'second child should inherit all unresolved yes-side principal from the first child by snapshot')
	})

	test('cannot refund an active escalation deposit before zoltar forks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Question not finalized|Question open/)
	})

	test('third parties can permissionlessly settle another vaults resolved escalation deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const ourDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(ourDeposit.depositor, client.account.address, 'wrong depositor')

		const clientVaultBeforeSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [ourDeposit.depositIndex])
		const clientVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(clientVaultAfterSettlement.repInEscalationGame, 0n, 'permissionless settlement should clear the owners lock')
		strictEqualTypeSafe(clientVaultAfterSettlement.repDepositShare >= clientVaultBeforeSettlement.repDepositShare, true, 'permissionless settlement should preserve or increase the owners vault claim')
	})
})
