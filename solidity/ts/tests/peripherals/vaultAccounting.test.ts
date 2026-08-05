import { beforeEach, describe, test } from 'bun:test'
import { peripherals_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { usePeripheralsVaultAccountingFixture, type PeripheralsVaultAccountingFixture } from './fixture'

const depositRepToVaultEvent = {
	inputs: [
		{ name: 'vault', type: 'address', indexed: true },
		{ name: 'repAmountAttoRep', type: 'uint256' },
		{ name: 'repBackingUnits', type: 'uint256' },
		{ name: 'totalRepBackingUnits', type: 'uint256' },
	],
	name: 'RepDepositedToVault',
	type: 'event',
} as const

describe('Peripherals: vault accounting', () => {
	const fixture = usePeripheralsVaultAccountingFixture()
	const assert: PeripheralsVaultAccountingFixture['assert'] = fixture.assert
	const approximatelyEqual: PeripheralsVaultAccountingFixture['approximatelyEqual'] = fixture.approximatelyEqual
	const strictEqualTypeSafe: PeripheralsVaultAccountingFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	const {
		decodeEventLog,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		getERC20Balance,
		ensureProxyDeployerDeployed,
		setupTestAccounts,
		addressString,
		approveAndDepositRepToVault,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		deployOriginSecurityPool,
		ensureDeploymentStatusOracleDeployed,
		getAnvilWindowEthereum,
		setBaselineSnapshot,
		initializePeripheralsBaseline,
		getDeploymentStatusOracleAddress,
		getDeploymentStepAddresses,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		loadDeploymentStatusOracleMask,
		createQuestion,
		getQuestionId,
		getLastPrice,
		getQuestionEndDate,
		OperationType,
		requestPriceIfNeededAndStageOperation,
		QuestionOutcome,
		ensureDefined,
		getQuestionOutcome,
		getEscalationGameDeposits,
		getNonDecisionThresholdAttoRep,
		getQuestionResolution,
		getStartBond,
		forkUniverse,
		getZoltarAddress,
		isIgnorableLogDecodeError,
		depositRepToVault,
		depositToEscalationGame,
		getTotalRepBackingUnits,
		getRepToken,
		getTotalPoolHeldRepAttoRep,
		getActiveVaultCount,
		getActiveVaults,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getVaultCount,
		getVaults,
		backingUnitsToAttoRep,
		redeemFees,
		redeemRepFromVault,
		updateVaultFees,
		withdrawFromEscalationGame,
		peripherals_EscalationGame_EscalationGame,
		peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
		peripherals_tokens_ShareToken_ShareToken,
		formatStorageSlot,
		reportBond,
		repDeposit,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
		reportedRepEthPrice,
		MAX_RETENTION_RATE,
		outcomes,
		transferRepToAddress,
		getVaultRepClaim,
		finalizeQuestionAsYesWithoutFork,
	} = fixture

	let mockWindow: PeripheralsVaultAccountingFixture['mockWindow']
	let client: PeripheralsVaultAccountingFixture['client']
	let securityPoolAddresses: PeripheralsVaultAccountingFixture['securityPoolAddresses']
	let questionData: PeripheralsVaultAccountingFixture['questionData']
	let questionId: PeripheralsVaultAccountingFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	const withdrawRepAcrossFreshOracleRounds = async (vaultClient: PeripheralsVaultAccountingFixture['client'], amount: bigint) => {
		for (let withdrawalIndex = 0n; withdrawalIndex < 5n; withdrawalIndex++) {
			const withdrawalAmount = withdrawalIndex === 4n ? amount : amount / 5n
			await manipulatePriceOracleAndPerformOperation(vaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, vaultClient.account.address, withdrawalAmount, reportedRepEthPrice)
			if (withdrawalIndex < 4n) await mockWindow.advanceTime(10n * 60n)
		}
	}

	test('can deposit rep and withdraw it', async () => {
		const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawRepAcrossFreshOracleRounds(client, repDeposit)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), reportedRepEthPrice, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance + repDeposit, 100n, 'Did not get rep back')
	})

	test('deposit events expose updated vault and REP backing units state', async () => {
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		const depositAmount = repDeposit / 10n
		const depositHash = await depositRepToVault(client, securityPoolAddresses.securityPool, depositAmount)
		const receipt = await client.getTransactionReceipt({ hash: depositHash })
		const depositLogs = await client.getLogs({
			address: securityPoolAddresses.securityPool,
			event: depositRepToVaultEvent,
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		})
		const depositLog = ensureDefined(
			depositLogs.find(log => log.transactionHash === depositHash),
			'RepDepositedToVault log missing from deposit transaction',
		)
		const depositArgs = ensureDefined(depositLog.args, 'RepDepositedToVault log args missing')
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const totalRepBackingUnits = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(depositArgs.vault, client.account.address, 'event should identify the updated vault')
		strictEqualTypeSafe(depositArgs.repAmountAttoRep, depositAmount, 'event should include the deposited REP amount')
		strictEqualTypeSafe(depositArgs.repBackingUnits, vault.repBackingUnits, 'event should include updated vault backingUnits')
		strictEqualTypeSafe(depositArgs.totalRepBackingUnits, totalRepBackingUnits, 'event should include updated REP backing units denominator')
	})

	test('zero-fee redemption emits no redemption checkpoint and does not call the recipient', async () => {
		const redemptionHash = await redeemFees(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken)
		const receipt = await client.getTransactionReceipt({ hash: redemptionHash })
		const poolLogs = receipt.logs.filter(log => log.address.toLowerCase() === securityPoolAddresses.securityPool.toLowerCase())
		const decodedPoolLogs = poolLogs.map(log =>
			decodeEventLog({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				data: log.data,
				topics: log.topics,
			}),
		)
		assert.strictEqual(
			decodedPoolLogs.some(log => log.eventName === 'PoolAccountingCheckpoint' && log.args.reason === 2n),
			false,
			'a true zero-fee redemption should not emit a fee-redemption checkpoint',
		)
	})

	test('share token metadata includes the question id', async () => {
		const name = await client.readContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			functionName: 'name',
			address: securityPoolAddresses.shareToken,
			args: [],
		})
		const symbol = await client.readContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			functionName: 'symbol',
			address: securityPoolAddresses.shareToken,
			args: [],
		})

		assert.strictEqual(name, `Shares-${questionId}`, 'share token name should include the question id')
		assert.strictEqual(symbol, `SHARE-${questionId}`, 'share token symbol should include the question id')
	})

	test('security pool factory stores deployments for direct query', async () => {
		const factoryAddress = getInfraContractAddresses().securityPoolFactory
		const deploymentCount = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentCount',
			address: factoryAddress,
			args: [],
		})
		const deployments = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			address: factoryAddress,
			args: [0n, deploymentCount],
		})
		const deployment = ensureDefined(deployments[0], 'origin deployment missing')
		const {
			settlementCollateralAttoEth,
			currentRetentionRate: storedCurrentRetentionRate,
			parent,
			priceOracleManagerAndOperatorQueuer: managerAddress,
			questionId: storedQuestionId,
			statoblastSecurityMultiplierBps: storedStatoblastSecurityMultiplierBps,
			securityPool: securityPoolAddress,
			shareToken: shareTokenAddress,
			truthAuction: truthAuctionAddress,
			universeId,
		} = deployment
		const expectedAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps)

		strictEqualTypeSafe(deploymentCount, 1n, 'factory should know about the origin deployment')
		strictEqualTypeSafe(securityPoolAddress, expectedAddresses.securityPool, 'stored security pool address should match')
		strictEqualTypeSafe(truthAuctionAddress, expectedAddresses.truthAuction, 'stored truth auction address should match')
		strictEqualTypeSafe(managerAddress, expectedAddresses.priceOracleManagerAndOperatorQueuer, 'stored manager address should match')
		strictEqualTypeSafe(shareTokenAddress, expectedAddresses.shareToken, 'stored share token address should match')
		strictEqualTypeSafe(parent, addressString(0x0n), 'stored parent should be zero for origin deployment')
		strictEqualTypeSafe(universeId, genesisUniverse, 'stored universe should match')
		strictEqualTypeSafe(storedQuestionId, questionId, 'stored question id should match')
		strictEqualTypeSafe(storedStatoblastSecurityMultiplierBps, statoblastSecurityMultiplierBps, 'stored security multiplier should match')
		strictEqualTypeSafe(storedCurrentRetentionRate, MAX_RETENTION_RATE, 'stored retention rate should match')
		strictEqualTypeSafe(settlementCollateralAttoEth, 0n, 'origin deployments should not have complete set collateral')
		strictEqualTypeSafe(await getLastPrice(client, managerAddress), 0n, 'origin manager should start with a zero price')
	})

	test('deployment status oracle returns the deployment bitmask in one read', async () => {
		const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		assert.notStrictEqual(await client.getCode({ address: deploymentStatusOracleAddress }), '0x', 'deployment status oracle should be deployed')
		strictEqualTypeSafe(deploymentMask, (1n << BigInt(getDeploymentStepAddresses().length)) - 1n, 'all deployment steps should be deployed after ensureInfraDeployed')
	})

	test('deployment status oracle reports missing contracts from a partial deployment', async () => {
		const partialWindow = getAnvilWindowEthereum()
		const partialClient = createWriteClient(partialWindow, TEST_ADDRESSES[0], 0)
		await partialWindow.resetToCleanState()
		await setupTestAccounts(partialWindow)
		await ensureProxyDeployerDeployed(partialClient)
		await ensureDeploymentStatusOracleDeployed(partialClient)

		const deploymentMask = await loadDeploymentStatusOracleMask(partialClient)

		strictEqualTypeSafe(deploymentMask, 1n, 'only the proxy deployer should be marked deployed before the rest of infra')
		await initializePeripheralsBaseline()
		await setBaselineSnapshot()
	})

	test('security pool exposes vault paging without duplicate entries', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const thirdClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await approveAndDepositRepToVault(thirdClient, repDeposit, questionId)
		await depositRepToVault(client, securityPoolAddresses.securityPool, repDeposit)

		const vaultCount = await getVaultCount(client, securityPoolAddresses.securityPool)
		const firstPage = await getVaults(client, securityPoolAddresses.securityPool, 0n, 2n)
		const secondPage = await getVaults(client, securityPoolAddresses.securityPool, 2n, 2n)
		const emptyPage = await getVaults(client, securityPoolAddresses.securityPool, 3n, 1n)

		strictEqualTypeSafe(vaultCount, 3n, 'vault count should track unique vault addresses')
		assert.deepStrictEqual(firstPage, [client.account.address, attackerClient.account.address], 'first page should include the first two vaults in insertion order')
		assert.deepStrictEqual(secondPage, [thirdClient.account.address], 'second page should include the remaining vault')
		assert.deepStrictEqual(emptyPage, [], 'out of range paging should return an empty array')
	})

	test('active vault paging excludes zero-balance historical vaults', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

		strictEqualTypeSafe(await getVaultCount(client, securityPoolAddresses.securityPool), 2n, 'historical vault count should include both vaults')
		strictEqualTypeSafe(await getActiveVaultCount(client, securityPoolAddresses.securityPool), 2n, 'active vault count should include both funded vaults')

		await withdrawRepAcrossFreshOracleRounds(attackerClient, repDeposit)

		const historicalVaultCount = await getVaultCount(client, securityPoolAddresses.securityPool)
		const activeVaultCount = await getActiveVaultCount(client, securityPoolAddresses.securityPool)
		const activeVaults = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, activeVaultCount)

		strictEqualTypeSafe(historicalVaultCount, 2n, 'historical vault count should remain append only')
		strictEqualTypeSafe(activeVaultCount, 1n, 'active vault count should prune fully exited vaults')
		assert.deepStrictEqual(activeVaults, [client.account.address], 'active vault paging should only return currently active vaults')
	})

	test('active vault paging stays newest-first after vault removal and later vault updates', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const thirdClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await approveAndDepositRepToVault(thirdClient, repDeposit, questionId)

		const newestFirstVaultsBeforeRemoval = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsBeforeRemoval, [thirdClient.account.address, attackerClient.account.address, client.account.address], 'active vault paging should list the most recently activated vaults first')

		await withdrawRepAcrossFreshOracleRounds(attackerClient, repDeposit)

		const newestFirstVaultsAfterRemoval = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsAfterRemoval, [thirdClient.account.address, client.account.address], 'removing a middle vault should preserve newest-first ordering for the remaining active vaults')

		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

		const newestFirstVaultsAfterTouch = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsAfterTouch, [client.account.address, thirdClient.account.address], 'updating an active vault should move it to the front of the newest-first active vault preview')
	})

	test('updateVaultFees emits no accounting checkpoints for an empty vault after accrual is capped', async () => {
		const emptyVaultPrivateKey = TEST_ADDRESSES[4]
		if (emptyVaultPrivateKey === undefined) throw new Error('empty vault test address missing')
		const emptyVault = addressString(emptyVaultPrivateKey)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 1n)
		await updateVaultFees(client, securityPoolAddresses.securityPool, emptyVault)

		const noOpHash = await updateVaultFees(client, securityPoolAddresses.securityPool, emptyVault)
		const noOpReceipt = await client.getTransactionReceipt({ hash: noOpHash })
		const poolLogs = noOpReceipt.logs.filter(log => log.address.toLowerCase() === securityPoolAddresses.securityPool.toLowerCase())

		assert.deepStrictEqual(poolLogs, [], 'a true no-op vault checkpoint should not emit pool accounting events')
	})

	test('withdrawal after question end releases escalation lock without changing backingUnits in single-sided case', async () => {
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		const totalRepBackingUnits = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
		assert.ok(totalRepBackingUnits > 0n, 'totalRepBackingUnits was zero')
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const vaultBeforeDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepBeforeDeposit = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const escalationGameAddress = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(escalationGameAddress, securityPoolAddresses.escalationGame, 'escalation game addresses do not match')

		assert.ok((await getNonDecisionThresholdAttoRep(client, securityPoolAddresses.escalationGame)) > 10n * reportBond, 'fork threshold needs to be big enough')
		await mockWindow.advanceTime(10n * DAY)
		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		strictEqualTypeSafe(yesDeposits.length, 1, 'there should be one deposit')
		const yesDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(yesDeposit.depositIndex, 0n, 'index should be zero')
		strictEqualTypeSafe(yesDeposit.depositor, client.account.address, 'wrong depositor')
		strictEqualTypeSafe(yesDeposit.cumulativeAmountAttoRep, reportBond, 'cumulative should be report bond')
		strictEqualTypeSafe(yesDeposit.amountAttoRep, reportBond, 'amount should be report bond')
		strictEqualTypeSafe(await getStartBond(client, securityPoolAddresses.escalationGame), reportBond, 'report bond matches')

		const vaultBeforeWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const ourDeposits = yesDeposits.filter(deposit => BigInt(deposit.depositor) === BigInt(client.account.address))
		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question has resolved')
		const withdrawalHash = await withdrawFromEscalationGame(
			client,
			securityPoolAddresses.securityPool,
			QuestionOutcome.Yes,
			ourDeposits.map(deposit => deposit.depositIndex),
		)
		const withdrawalReceipt = await client.waitForTransactionReceipt({ hash: withdrawalHash })
		const claimLog = withdrawalReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')

		const walletRepAfterWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const vaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(claimLog?.args.amountToWithdrawAttoRep, reportBond, 'single-sided winning withdrawal should pay back the full original REP principal')
		assert.ok(vaultBeforeWithdrawal.repBackingUnits < vaultBeforeDeposit.repBackingUnits, "depositing into escalation should reduce the vault's pool-held REP backing units")
		strictEqualTypeSafe(vaultAfterWithdrawal.repBackingUnits, vaultBeforeWithdrawal.repBackingUnits, 'with escrow custody, settling a break-even deposit should not re-mint vault backingUnits')
		strictEqualTypeSafe(walletRepAfterWithdrawal - walletRepBeforeDeposit, reportBond, 'a break-even escalation round-trip should return REP to the wallet instead')
		strictEqualTypeSafe(vaultAfterWithdrawal.disputeStakedRepAttoRep, 0n, 'escalation lock should be released after withdrawal')
	})

	test('depositToEscalationGame rejects at exact market end and succeeds one second later', async () => {
		const endTime = await getQuestionEndDate(client, questionId)

		// The Anvil harness mines mutating transactions one second after the latest block timestamp.
		// Setting time to endTime - 1 makes the next transaction execute exactly at endTime.
		await mockWindow.setTime(endTime - 1n)
		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond), /Question active/)

		// Resetting to endTime makes the next transaction execute at endTime + 1, the first valid second.
		await mockWindow.setTime(endTime)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const yesDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(yesDeposits.length, 1, 'there should be one accepted report after market end')
		strictEqualTypeSafe(yesDeposit.depositIndex, 0n, 'first accepted post-close report should use deposit index zero')
		strictEqualTypeSafe(yesDeposit.amountAttoRep, reportBond, 'accepted report amount should match the requested report bond')
	})

	test('withdrawFromEscalationGame shares the binding-capital reward pool across all reward-eligible winning deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

		const firstWinningDeposit = 5n * 10n ** 18n
		const secondWinningDeposit = 5n * 10n ** 18n
		const thirdWinningDeposit = 5n * 10n ** 18n
		const fourthWinningDeposit = 2n * 10n ** 18n
		const losingDeposit = 10n * 10n ** 18n
		const totalWinningPrincipal = firstWinningDeposit + secondWinningDeposit + thirdWinningDeposit + fourthWinningDeposit
		const totalPrincipalLocked = totalWinningPrincipal + losingDeposit
		const expectedBindingCapital = losingDeposit
		const expectedRewardEligibleCap = 15n * 10n ** 18n
		const expectedRewardBonusPool = 6n * 10n ** 18n
		const expectedGrossWinningPayout = 23n * 10n ** 18n
		const expectedWinnerProfit = expectedGrossWinningPayout - totalWinningPrincipal
		const expectedResidualHaircut = totalPrincipalLocked - expectedGrossWinningPayout

		// The fixed 15 REP reward window is intentionally consumed by the earliest accepted
		// winning principal. The later 2 REP deposit lands entirely in the principal-only excess.
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, thirdWinningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, fourthWinningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(50n * DAY)

		const lockedRepBeforeWithdrawal = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).disputeStakedRepAttoRep
		const withdrawalHash = await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n, 1n, 2n, 3n])
		const withdrawalReceipt = await client.waitForTransactionReceipt({ hash: withdrawalHash })
		const winningClaimLogs = withdrawalReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.filter(log => log?.eventName === 'ClaimDeposit')
		const winningClaimAmount = winningClaimLogs.reduce((sum, log) => sum + (log?.args.amountToWithdrawAttoRep ?? 0n), 0n)
		const vaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(winningClaimLogs.length, 4, 'one transaction should emit one claim event for each winning deposit')
		assert.deepStrictEqual(
			winningClaimLogs.map(log => log?.args.parentDepositIndex),
			[0n, 1n, 2n, 3n],
			'multi-claim events should identify each stable deposit index in call order',
		)
		assert.deepStrictEqual(
			winningClaimLogs.map(log => log?.args.originalDepositAmountAttoRep),
			[firstWinningDeposit, secondWinningDeposit, thirdWinningDeposit, fourthWinningDeposit],
			'multi-claim events should preserve each original principal',
		)
		assert.deepStrictEqual(
			winningClaimLogs.map(log => log?.args.amountToWithdrawAttoRep),
			[7n * 10n ** 18n, 7n * 10n ** 18n, 7n * 10n ** 18n, 2n * 10n ** 18n],
			'multi-claim events should expose each new payout value',
		)
		assert.ok(
			winningClaimLogs.every(log => log?.args.transferredRep === true),
			'security-pool winner withdrawals should transfer REP',
		)
		strictEqualTypeSafe(lockedRepBeforeWithdrawal, totalWinningPrincipal, 'winner should have exactly the winning-side principal locked before withdrawal')
		strictEqualTypeSafe(expectedBindingCapital, losingDeposit, 'single losing side should set the binding capital in this scenario')
		strictEqualTypeSafe(expectedRewardEligibleCap, expectedBindingCapital + expectedBindingCapital / 2n, 'reward-eligible cap should extend 50% beyond binding capital')
		strictEqualTypeSafe(expectedRewardBonusPool, (expectedBindingCapital * 3n) / 5n, 'binding-capital reward pool should equal the unburned 60% share')
		strictEqualTypeSafe(expectedGrossWinningPayout, 7n * 10n ** 18n + 7n * 10n ** 18n + 7n * 10n ** 18n + 2n * 10n ** 18n, 'gross winning payout should match the pooled reward schedule')
		strictEqualTypeSafe(expectedWinnerProfit, expectedGrossWinningPayout - totalWinningPrincipal, 'winner profit should equal payout minus winning principal')
		strictEqualTypeSafe(winningClaimAmount, expectedGrossWinningPayout, 'winning withdrawals should emit the expected gross payout across all reward-eligible deposits')
		strictEqualTypeSafe(totalPrincipalLocked - totalWinningPrincipal, losingDeposit, 'losing side should contribute 10 REP of principal')
		strictEqualTypeSafe(expectedResidualHaircut, 4n * 10n ** 18n, '40% of the 10 REP binding-capital region should remain as slashed residual in the pool')
		strictEqualTypeSafe(vaultAfterWithdrawal.disputeStakedRepAttoRep, 0n, 'winning withdrawals should unlock all deposited REP')
	})

	test('losing escalation deposits stay locked and reduce the losing vaults available REP claim after winner withdrawal', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

		const winningDeposit = 20n * 10n ** 18n
		const losingDeposit = 10n * 10n ** 18n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(60n * DAY)

		const losingVaultBeforeWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		const losingClaimBeforeWithdrawal = await getVaultRepClaim(attackerClient.account.address)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])

		const losingVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		const losingClaimAfterWithdrawal = await getVaultRepClaim(attackerClient.account.address)
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(losingVaultBeforeWithdrawal.disputeStakedRepAttoRep, losingDeposit, 'losing-side REP should start fully locked')
		strictEqualTypeSafe(losingVaultAfterWithdrawal.disputeStakedRepAttoRep, losingDeposit, 'losing-side REP should remain locked after the winner withdraws')
		strictEqualTypeSafe(losingClaimAfterWithdrawal, losingClaimBeforeWithdrawal, "winning-side settlement should not affect the losing vault's pool-held REP backing once dispute-staked REP is fully escrowed outside the pool")
		assert.ok(losingClaimAfterWithdrawal + losingVaultAfterWithdrawal.disputeStakedRepAttoRep === repDeposit, "the losing vault's total economic position should remain split across pool-held REP backing and dispute-staked REP until its own settlement")
	})

	test('withdrawRep only uses available REP and cannot drain another vaults locked escalation stake', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const availableRepBeforeWithdrawal = await getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)
		const aliceWalletRepBeforeWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await withdrawRepAcrossFreshOracleRounds(client, repDeposit)

		const availableRepAfterWithdrawal = await getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)
		const aliceWalletRepAfterWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const aliceVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const attackerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		strictEqualTypeSafe(availableRepBeforeWithdrawal, repDeposit * 2n - lockedDeposit, 'available REP should exclude the locked escalation deposit')
		strictEqualTypeSafe(aliceWalletRepAfterWithdrawal - aliceWalletRepBeforeWithdrawal, repDeposit, 'withdrawal should still allow the caller to exit its full unlocked collateral claim')
		strictEqualTypeSafe(availableRepAfterWithdrawal, repDeposit - lockedDeposit, 'remaining available REP should still exclude the locked stake after withdrawal')
		strictEqualTypeSafe(aliceVaultAfterWithdrawal.repBackingUnits, 0n, 'full vault withdrawal should remove the callers backingUnits share')
		strictEqualTypeSafe(attackerVaultAfterWithdrawal.disputeStakedRepAttoRep, lockedDeposit, 'the other vaults locked escalation stake should remain intact')
	})

	test('withdrawRepFromVault cannot run on a vault with active escalation escrow', async () => {
		const escrowedVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRepToVault(escrowedVault, repDeposit, questionId)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(escrowedVault, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		const vaultBeforeWithdrawAttempt = await getSecurityVault(escrowedVault, securityPoolAddresses.securityPool, escrowedVault.account.address)
		const walletRepBeforeWithdrawAttempt = await getERC20Balance(escrowedVault, addressString(GENESIS_REPUTATION_TOKEN), escrowedVault.account.address)
		await manipulatePriceOracleAndPerformOperation(escrowedVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, escrowedVault.account.address, repDeposit - lockedDeposit)
		const vaultAfterWithdrawAttempt = await getSecurityVault(escrowedVault, securityPoolAddresses.securityPool, escrowedVault.account.address)
		const walletRepAfterWithdrawAttempt = await getERC20Balance(escrowedVault, addressString(GENESIS_REPUTATION_TOKEN), escrowedVault.account.address)
		strictEqualTypeSafe(vaultBeforeWithdrawAttempt.disputeStakedRepAttoRep, lockedDeposit, 'test setup should create active escrow')
		strictEqualTypeSafe(vaultAfterWithdrawAttempt.disputeStakedRepAttoRep, lockedDeposit, 'failed withdrawal should leave active escrow intact')
		strictEqualTypeSafe(vaultAfterWithdrawAttempt.repBackingUnits, vaultBeforeWithdrawAttempt.repBackingUnits, 'failed withdrawal should not change REP backing units')
		strictEqualTypeSafe(walletRepAfterWithdrawAttempt, walletRepBeforeWithdrawAttempt, 'failed withdrawal should not transfer REP')
	})

	test('redeemRepFromVault requires settled escalation deposits after question finalization', async () => {
		await finalizeQuestionAsYesWithoutFork()

		const walletRepBeforeRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await assert.rejects(redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address), /Escrow locked|Escrow/)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const vaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		strictEqualTypeSafe(vaultAfterRedeem.repBackingUnits, 0n, 'redeemRepFromVault should empty the vault after escalation settles')
		strictEqualTypeSafe(vaultAfterRedeem.disputeStakedRepAttoRep, 0n, 'redeemRepFromVault should not recreate escrowed REP')
		strictEqualTypeSafe(walletRepAfterRedeem - walletRepAfterSettlement, repDeposit - reportBond, 'redeemRepFromVault should only return the vault-held REP claim after escalation settles')
		strictEqualTypeSafe(vaultAfterSettlement.disputeStakedRepAttoRep, 0n, 'settling escalation should clear the remaining escrowed REP')
		strictEqualTypeSafe(walletRepAfterSettlement - walletRepBeforeRedeem, reportBond, 'settling escalation should return only the escrowed REP')
	})

	test('depositToEscalationGame burns enough backingUnits after the pool share price appreciates', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const benefactorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const vaultBeforeDonation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBackingBeforeDonationAttoRep = await getVaultRepClaim(client.account.address)
		await mockWindow.setTime(endTime + 10000n)
		await transferRepToAddress(benefactorClient, securityPoolAddresses.securityPool, repDeposit)

		const vaultBeforeEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBackingAfterDonationAttoRep = await getVaultRepClaim(client.account.address)
		const totalRepBeforeEscrow = vaultRepBackingAfterDonationAttoRep + vaultBeforeEscrow.disputeStakedRepAttoRep
		strictEqualTypeSafe(vaultBeforeEscrow.repBackingUnits, vaultBeforeDonation.repBackingUnits, 'a direct pool-held REP donation must not mint REP backing units')
		assert.ok(vaultRepBackingAfterDonationAttoRep > vaultRepBackingBeforeDonationAttoRep, 'unchanged REP backing units must convert to more vault REP backing after a pool-held REP donation')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const vaultAfterEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const totalRepAfterEscrow = (await getVaultRepClaim(client.account.address)) + vaultAfterEscrow.disputeStakedRepAttoRep

		assert.ok(totalRepAfterEscrow <= totalRepBeforeEscrow, 'moving REP into escalation should not increase the vaults total economic position after pool appreciation')
		strictEqualTypeSafe(vaultAfterEscrow.disputeStakedRepAttoRep, reportBond, 'the escrowed REP principal should match the deposited escalation amount exactly')
	})

	test('depositToEscalationGame rechecks the local bond against the post-escrow REP balance', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const secondVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const escrowAmount = 200n * 10n ** 18n

		await approveAndDepositRepToVault(secondVault, repDeposit, questionId)

		const totalRepBeforeEscrow = await getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)
		const totalRepBackingUnits = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
		const vaultBeforeEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const backingUnitsToEscrow = (escrowAmount * totalRepBackingUnits + totalRepBeforeEscrow - 1n) / totalRepBeforeEscrow
		const expectedRepAfterEscrow = ((vaultBeforeEscrow.repBackingUnits - backingUnitsToEscrow) * (totalRepBeforeEscrow - escrowAmount)) / totalRepBackingUnits
		const targetCoverageCommitmentAttoEth = expectedRepAfterEscrow + 1n

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, targetCoverageCommitmentAttoEth)
		await manipulatePriceOracleAndPerformOperation(secondVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, secondVault.account.address, 0n)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		assert.ok(vaultBeforeEscrow.repBackingUnits > 0n, 'target vault should already be funded')
		assert.ok(totalRepBeforeEscrow - escrowAmount >= targetCoverageCommitmentAttoEth, 'the pool-wide bond should still be satisfied after escrow')
		assert.ok(expectedRepAfterEscrow < targetCoverageCommitmentAttoEth, 'coverage commitment')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, escrowAmount)
		const vaultAfterEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(vaultAfterEscrow.disputeStakedRepAttoRep >= escrowAmount, 'the escrowed REP should be accepted when the post-transfer denominator keeps the vault above its bond threshold')
		assert.ok((await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vaultAfterEscrow.repBackingUnits)) >= targetCoverageCommitmentAttoEth, 'the remaining claim should still satisfy the local bond after escrow')
	})

	test('oracle-staged collateral operations are rejected once escalation resolves', async () => {
		await finalizeQuestionAsYesWithoutFork()

		await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, 1n), /question already resolved, so staged operations are unavailable/)
	})

	test('coverage commitment', async () => {
		const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, 0n)

		const vaultAfterClearingCoverageCommitmentAttoEth = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(vaultAfterClearingCoverageCommitmentAttoEth.coverageCommitmentAttoEth, 0n, 'setting the coverage commitment to zero should succeed')
	})

	test('withdrawFromEscalationGame gives later safety-boundary deposits a pro-rata share of the binding-capital reward pool', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingSide = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRepToVault(firstWinner, repDeposit, questionId)
		await approveAndDepositRepToVault(secondWinner, repDeposit, questionId)
		await approveAndDepositRepToVault(losingSide, repDeposit, questionId)

		const firstWinningDeposit = 20n * 10n ** 18n
		const secondWinningDeposit = 14n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n
		const expectedFirstWinnerPayout = 28n * 10n ** 18n
		const expectedSecondWinnerPayout = 18n * 10n ** 18n

		// This explicitly documents the intended same-side ordering rule: once the first winner has
		// filled the binding-capital region, the later deposit only earns bonus on its overlap with
		// the remaining safety-boundary depth.
		await depositToEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningDeposit)
		await depositToEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningDeposit)
		await depositToEscalationGame(losingSide, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(60n * DAY)

		const firstWithdrawalHash = await withdrawFromEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const secondWithdrawalHash = await withdrawFromEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const firstReceipt = await client.waitForTransactionReceipt({ hash: firstWithdrawalHash })
		const secondReceipt = await client.waitForTransactionReceipt({ hash: secondWithdrawalHash })
		const firstClaimLog = firstReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const secondClaimLog = secondReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const firstWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, firstWinner.account.address)
		const secondWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, secondWinner.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(firstClaimLog?.args.amountToWithdrawAttoRep, expectedFirstWinnerPayout, 'the first winning deposit should receive the pro-rata reward on its full 20 REP reward-eligible principal')
		strictEqualTypeSafe(secondClaimLog?.args.amountToWithdrawAttoRep, expectedSecondWinnerPayout, 'the crossing deposit should receive reward on its 10 REP safety-boundary slice and principal only on its 4 REP excess slice')
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.disputeStakedRepAttoRep, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.disputeStakedRepAttoRep, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('withdrawFromEscalationGame shares the full reward pool across the actual winning principal when total winning principal stays below the reward cap', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingSide = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRepToVault(firstWinner, repDeposit, questionId)
		await approveAndDepositRepToVault(secondWinner, repDeposit, questionId)
		await approveAndDepositRepToVault(losingSide, repDeposit, questionId)

		const firstWinningDeposit = 14n * 10n ** 18n
		const secondWinningDeposit = 10n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n
		const expectedFirstWinnerPayout = 21n * 10n ** 18n
		const expectedSecondWinnerPayout = 15n * 10n ** 18n

		await depositToEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningDeposit)
		await depositToEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningDeposit)
		await depositToEscalationGame(losingSide, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(60n * DAY)

		const firstWithdrawalHash = await withdrawFromEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const secondWithdrawalHash = await withdrawFromEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const firstReceipt = await client.waitForTransactionReceipt({ hash: firstWithdrawalHash })
		const secondReceipt = await client.waitForTransactionReceipt({ hash: secondWithdrawalHash })
		const firstClaimLog = firstReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const secondClaimLog = secondReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const firstWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, firstWinner.account.address)
		const secondWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, secondWinner.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(firstClaimLog?.args.amountToWithdrawAttoRep, expectedFirstWinnerPayout, 'when total winning principal stays below the reward cap, the first winner should receive its pro-rata share of the full reward pool')
		strictEqualTypeSafe(secondClaimLog?.args.amountToWithdrawAttoRep, expectedSecondWinnerPayout, 'when total winning principal stays below the reward cap, the second winner should also receive its pro-rata share of the full reward pool')
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.disputeStakedRepAttoRep, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.disputeStakedRepAttoRep, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('external fork blocks parent escalation withdrawals and preserves escrowed REP', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 1n)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

		const aliceDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const bobDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const aliceDeposit = ensureDefined(aliceDeposits[0], 'alice escalation deposit missing')
		const bobDeposit = ensureDefined(bobDeposits[0], 'bob escalation deposit missing')

		const aliceVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const bobVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const theoreticalSupplySlot = formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[theoreticalSupplySlot]: repDeposit * 10n,
				},
			},
		})

		const otherQuestionData = {
			...questionData,
			title: 'fork source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)

		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.None, 'external fork should leave the parent question unresolved')
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [aliceDeposit.depositIndex]), /Migrate deposits first/)
		await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [bobDeposit.depositIndex]), /Migrate deposits first/)

		const aliceVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const bobVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(aliceVaultAfter.disputeStakedRepAttoRep, aliceVaultBefore.disputeStakedRepAttoRep, 'alice lock should stay in the parent until migrated')
		strictEqualTypeSafe(bobVaultAfter.disputeStakedRepAttoRep, bobVaultBefore.disputeStakedRepAttoRep, 'bob lock should stay in the parent until migrated')
	})

	test('withdrawFromEscalationGame rejects wrong outcome after normal resolution', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n]), /Bad deposit index/)
	})

	test('winning escalation settlement cannot be processed twice and unsettled deposit discovery updates accordingly', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		const unsettledBefore = (await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === client.account.address && deposit.amountAttoRep > 0n).map(deposit => deposit.depositIndex)
		strictEqualTypeSafe(unsettledBefore.length, 1, 'the winning deposit should be discoverable before settlement')
		strictEqualTypeSafe(unsettledBefore[0], 0n, 'the first winning deposit should be returned')

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])

		const unsettledAfter = (await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === client.account.address && deposit.amountAttoRep > 0n).map(deposit => deposit.depositIndex)
		strictEqualTypeSafe(unsettledAfter.length, 0, 'settled winning deposits should disappear from discovery results')
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Deposit settled/)
	})

	test('withdrawFromEscalationGame rejects none outcome after an external fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const theoreticalSupplySlot = formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[theoreticalSupplySlot]: repDeposit * 10n,
				},
			},
		})

		const otherQuestionData = {
			...questionData,
			title: 'fork none outcome source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.None, [0n]), /Invalid outcome/)
	})

	test('losing escalation deposits can be settled after resolution and stop counting as locked collateral', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 1n)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

		await mockWindow.advanceTime(10n * DAY)

		const noDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const canceledCandidateDeposit = ensureDefined(noDeposits[0], 'no escalation deposit missing')
		const attackerVaultBeforeSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex])
		const attackerVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(attackerVaultAfterSettlement.disputeStakedRepAttoRep, 0n, 'losing-side settlement should clear the resolved escalation lock')
		strictEqualTypeSafe(attackerVaultAfterSettlement.repBackingUnits, attackerVaultBeforeSettlement.repBackingUnits, 'settling a fully losing escalation deposit should not mint new vault backingUnits to the loser')
		await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex]), /Deposit settled/)
	})

	test('mixed-outcome settlements from one vault are settlement-order independent after exchange-rate changes', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const secondQuestionData = {
			...questionData,
			title: 'mixed outcome order independence mirror pool',
		}
		const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
		await createQuestion(client, secondQuestionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
		await approveAndDepositRepToVault(client, repDeposit, secondQuestionId)
		await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
		await approveAndDepositRepToVault(attackerClient, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinningDeposit = 2n * reportBond
		const interveningDeposit = 3n * reportBond
		const losingDeposit = reportBond
		for (const poolAddress of [securityPoolAddresses.securityPool, secondSecurityPoolAddresses.securityPool]) {
			await depositToEscalationGame(client, poolAddress, QuestionOutcome.Yes, firstWinningDeposit)
			await depositToEscalationGame(attackerClient, poolAddress, QuestionOutcome.Yes, interveningDeposit)
			await depositToEscalationGame(client, poolAddress, QuestionOutcome.No, losingDeposit)
		}
		await mockWindow.advanceTime(10n * DAY)

		const firstYesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const firstNoDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const secondEscalationGame = await getSecurityPoolsEscalationGame(client, secondSecurityPoolAddresses.securityPool)
		const secondYesDeposits = await getEscalationGameDeposits(client, secondEscalationGame, QuestionOutcome.Yes)
		const secondNoDeposits = await getEscalationGameDeposits(client, secondEscalationGame, QuestionOutcome.No)

		const firstWinningIndex = ensureDefined(
			firstYesDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amountAttoRep === firstWinningDeposit),
			'first-pool winning deposit missing',
		).depositIndex
		const firstLosingIndex = ensureDefined(
			firstNoDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amountAttoRep === losingDeposit),
			'first-pool losing deposit missing',
		).depositIndex
		const secondWinningIndex = ensureDefined(
			secondYesDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amountAttoRep === firstWinningDeposit),
			'second-pool winning deposit missing',
		).depositIndex
		const secondLosingIndex = ensureDefined(
			secondNoDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amountAttoRep === losingDeposit),
			'second-pool losing deposit missing',
		).depositIndex

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [firstLosingIndex])
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [firstWinningIndex])
		await withdrawFromEscalationGame(client, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes, [secondWinningIndex])
		await withdrawFromEscalationGame(client, secondSecurityPoolAddresses.securityPool, QuestionOutcome.No, [secondLosingIndex])

		const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const secondVault = await getSecurityVault(client, secondSecurityPoolAddresses.securityPool, client.account.address)
		const firstPoolHeldVaultRepBackingAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, firstVault.repBackingUnits)
		const secondPoolHeldVaultRepBackingAttoRep = await backingUnitsToAttoRep(client, secondSecurityPoolAddresses.securityPool, secondVault.repBackingUnits)

		strictEqualTypeSafe(firstVault.disputeStakedRepAttoRep, 0n, 'the first pool should have no remaining escalation locks after both settlements')
		strictEqualTypeSafe(secondVault.disputeStakedRepAttoRep, 0n, 'the mirror pool should have no remaining escalation locks after both settlements')
		strictEqualTypeSafe(firstPoolHeldVaultRepBackingAttoRep, secondPoolHeldVaultRepBackingAttoRep, 'settling the winning and losing deposits in opposite orders should leave the same final pool-held vault REP backing')
	})
})
