import { beforeEach, describe, test } from 'bun:test'
import { usePeripheralsEscalationMigrationFixture, type PeripheralsEscalationMigrationFixture } from './fixture'

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
		getRepToken,
		getAwaitingForkContinuation,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
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
					.map(log =>
						decodeEventLog({
							abi: peripherals_EscalationGame_EscalationGame.abi,
							data: log.data,
							topics: log.topics,
						}),
					)
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

	test('migrateVaultWithUnresolvedEscalation rejects after the child branch is already priced', async () => {
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
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /Child not migrating/)
	})

	test('migrateVaultWithUnresolvedEscalation requires the vault owner to call it', async () => {
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
		strictEqualTypeSafe(invalidOutcomeState.balance + yesOutcomeState.balance + noOutcomeState.balance, childEscrowChildRep, 'own-fork continuation resolution balances should be scaled into child REP units')
		assert.ok(childEscrowPrincipal > childEscrowChildRep, 'the child continuation game should retain more parent principal than child REP backing')
		strictEqualTypeSafe(childEscrowChildRep, 1n, 'the child continuation game should retain only the scaled child REP backing')
	})

	test('one unmigrated unresolved lock cannot keep the child continuation branch frozen after the migration window', async () => {
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
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the migration deadline should clear the await marker even if another vault never migrates')
		await assert.rejects(migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes), /ar/)
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

	test('forked continuation freezes escalation cost until the child pool becomes operational', async () => {
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

		const childCostAtResume = await getEscalationGameTotalCost(client, childEscalationGame)
		strictEqualTypeSafe(childCostAtResume, childCostDuringMigration, 'resuming the continuation game should start from the frozen fork-time cost')

		await mockWindow.advanceTime(DAY)
		assert.ok((await getEscalationGameTotalCost(client, childEscalationGame)) > childCostAtResume, 'child continuation cost should advance again after the pool becomes operational')
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

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Question not finalized/)
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
