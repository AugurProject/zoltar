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

	test('migrateVaultWithUnresolvedEscalation atomically moves unresolved parent locks into the child branch', async () => {
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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
			args: [securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes],
			account: client.account,
		})
		strictEqualTypeSafe(firstPreview.result, true, 'first bounded migration should report a remaining follow-up batch')
		const firstMigrationHash = await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
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
			args: [securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes],
			account: client.account,
		})
		strictEqualTypeSafe(secondPreview.result, false, 'second bounded migration should report completion')
		const secondMigrationHash = await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
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

	test('own-fork unresolved migration rejects after the child branch is already priced', async () => {
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
		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes))
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /Child not migrating/)
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

		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes))
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

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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

	test('child continuations preserve the parent escalation balances across child universes', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, 2n * reportBond)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)
		const parentInvalidOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Invalid)
		const parentYesOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoOutcomeState = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)

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
			const childSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier)
			const childEscalationGame = await getSecurityPoolsEscalationGame(client, childSecurityPool.securityPool)
			const invalidOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Invalid)
			const yesOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
			const noOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.No)
			const childTotalCost = await getEscalationGameTotalCost(client, childEscalationGame)

			strictEqualTypeSafe(invalidOutcomeState.balance, parentInvalidOutcomeState.balance, 'each child continuation should preserve the parent invalid balance')
			strictEqualTypeSafe(yesOutcomeState.balance, parentYesOutcomeState.balance, 'each child continuation should preserve the parent yes balance')
			strictEqualTypeSafe(noOutcomeState.balance, parentNoOutcomeState.balance, 'each child continuation should preserve the parent no balance')
			strictEqualTypeSafe(childTotalCost, 0n, 'child continuations should still start before continuation attrition becomes active')
		}
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

	test('migrateVaultWithUnresolvedEscalation scales child escrow when the child branch has less REP than the parent principal', async () => {
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
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
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

		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'an underfunded child branch should still clear the parent unresolved REP lock after the migration succeeds')
		strictEqualTypeSafe(childPoolExists, true, 'an underfunded child branch should deploy the child pool')
		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, childEscrowChildRep, 'the child vault escrow should match the child REP actually transferred into the continuation game')
		strictEqualTypeSafe(invalidOutcomeState.balance, parentInvalidOutcomeState.balance, 'the child invalid balance should stay aligned with the parent snapshot')
		strictEqualTypeSafe(yesOutcomeState.balance, parentYesOutcomeState.balance, 'the child yes balance should preserve the parent snapshot even when child REP backing is smaller')
		strictEqualTypeSafe(noOutcomeState.balance, parentNoOutcomeState.balance, 'the child no balance should stay aligned with the parent snapshot')
		assert.ok(childEscrowPrincipal > childEscrowChildRep, 'the child continuation game should retain more parent principal than child REP backing')
		strictEqualTypeSafe(childEscrowChildRep, 1n, 'the child continuation game should retain only the scaled child REP backing')
	})

	test('one unmigrated unresolved lock keeps the child continuation paused until the owner migrates after truth auction', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const unresolvedDeposit = reportBond
		const attackerUnresolvedDeposit = reportBond + 1n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, attackerUnresolvedDeposit)

		const externalForkQuestionData = {
			...questionData,
			title: 'griefing continuation race source',
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
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		assert.ok(await contractExists(client, childEscalationGame), 'child should initialize the paused continuation game as soon as the branch exists')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'child should await fork continuation while unresolved migration is pending')

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'one remaining parent lock should still keep the branch paused during the migration window')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child should become operational even before continuation migration')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should keep awaiting continuation funding after truth auction if another vault never migrates')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'forkResumedAt',
				args: [],
			}),
			0n,
			'the paused continuation should not resume until the remaining owner migrates',
		)

		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should clear the await marker once every unresolved owner has funded its carry')
		assert.ok(
			(await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: childEscalationGame,
				functionName: 'forkResumedAt',
				args: [],
			})) > 0n,
			'the continuation should resume as soon as the final unresolved owner migrates',
		)
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should remain paused while the losing vault withholds its carry funding')
		await assert.rejects(createCompleteSet(client, yesSecurityPool.securityPool, 1n * 10n ** 18n), /Fork await/)

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
		await migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, childEscalationGame), honestWinningDeposit, 'only the honest winners migrated child REP should fund the continuation game before the attacker claims')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should stay paused until the winning vault funds its own carried lock')

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

		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)
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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should keep waiting for the remaining carried funding even after pricing')

		const childCostAtResume = await getEscalationGameTotalCost(client, childEscalationGame)
		strictEqualTypeSafe(childCostAtResume, childCostDuringMigration, 'the paused continuation should keep its frozen fork-time cost after pricing')

		await mockWindow.advanceTime(DAY)
		strictEqualTypeSafe(await getEscalationGameTotalCost(client, childEscalationGame), childCostAtResume, 'child continuation cost should remain frozen while a carried loser still withholds funding')

		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the child should stop waiting once the last carried loser funds the continuation')
		const childCostAtFunding = await getEscalationGameTotalCost(client, childEscalationGame)
		strictEqualTypeSafe(childCostAtFunding, childCostAtResume, 'resuming the continuation should begin from the same frozen fork-time cost snapshot')

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
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child branch should become operational after the truth auction')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'the child should keep awaiting the late carried funding')

		const childVaultBeforeLateFunding = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childForkDataBeforeLateFunding = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childCollateralBeforeLateFunding = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		const childTotalAllowanceBeforeLateFunding = await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool)
		const parentVaultBeforeLateFunding = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(parentVaultBeforeLateFunding.repDepositShare > 0n, 'the late-funding vault should still retain ordinary pool ownership on the parent after the migration window closes')
		strictEqualTypeSafe(parentVaultBeforeLateFunding.securityBondAllowance, clientSecurityBondAllowance, 'the late-funding vault should still retain its ordinary parent security-bond allowance after the migration window closes')

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

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
		await migrateVaultWithUnresolvedEscalation(client, yesSecurityPool.securityPool, client.account.address, QuestionOutcome.Yes)

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
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

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
			args: [yesSecurityPool.securityPool, client.account.address, BigInt(QuestionOutcome.Yes)],
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

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

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

		await migrateVaultWithUnresolvedEscalation(client, firstChildPool.securityPool, client.account.address, QuestionOutcome.Yes)

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
