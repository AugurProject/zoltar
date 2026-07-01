import { beforeEach, describe, test } from 'bun:test'
import { usePeripheralsVaultAccountingFixture, type PeripheralsVaultAccountingFixture } from './fixture'

const depositRepEvent = {
	inputs: [
		{ name: 'vault', type: 'address' },
		{ name: 'repAmount', type: 'uint256' },
		{ name: 'poolOwnership', type: 'uint256' },
		{ name: 'poolOwnershipDenominator', type: 'uint256' },
	],
	name: 'DepositRep',
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
		approveAndDepositRep,
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
		getNonDecisionThreshold,
		getQuestionResolution,
		getStartBond,
		forkUniverse,
		getZoltarAddress,
		isIgnorableLogDecodeError,
		depositRep,
		depositToEscalationGame,
		getPoolOwnershipDenominator,
		getRepToken,
		getTotalRepBalance,
		getActiveVaultCount,
		getActiveVaults,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getVaultCount,
		getVaults,
		poolOwnershipToRep,
		redeemRep,
		updateVaultFees,
		withdrawFromEscalationGame,
		peripherals_EscalationGame_EscalationGame,
		peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
		peripherals_tokens_ShareToken_ShareToken,
		formatStorageSlot,
		reportBond,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
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

	test('can deposit rep and withdraw it', async () => {
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit, reportedRepEthPrice)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), reportedRepEthPrice, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance, 100n, 'Did not get rep back')
	})

	test('deposit events expose updated vault and pool ownership state', async () => {
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		const depositAmount = repDeposit / 10n
		const depositHash = await depositRep(client, securityPoolAddresses.securityPool, depositAmount)
		const receipt = await client.getTransactionReceipt({ hash: depositHash })
		const depositLogs = await client.getLogs({
			address: securityPoolAddresses.securityPool,
			event: depositRepEvent,
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		})
		const depositLog = ensureDefined(
			depositLogs.find(log => log.transactionHash === depositHash),
			'DepositRep log missing from deposit transaction',
		)
		const depositArgs = ensureDefined(depositLog.args, 'DepositRep log args missing')
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(depositArgs.vault, client.account.address, 'event should identify the updated vault')
		strictEqualTypeSafe(depositArgs.repAmount, depositAmount, 'event should include the deposited REP amount')
		strictEqualTypeSafe(depositArgs.poolOwnership, vault.repDepositShare, 'event should include updated vault ownership')
		strictEqualTypeSafe(depositArgs.poolOwnershipDenominator, poolOwnershipDenominator, 'event should include updated pool ownership denominator')
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
			completeSetCollateralAmount,
			currentRetentionRate: storedCurrentRetentionRate,
			parent,
			priceOracleManagerAndOperatorQueuer: managerAddress,
			questionId: storedQuestionId,
			securityMultiplier: storedSecurityMultiplier,
			securityPool: securityPoolAddress,
			shareToken: shareTokenAddress,
			truthAuction: truthAuctionAddress,
			universeId,
		} = deployment
		const expectedAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)

		strictEqualTypeSafe(deploymentCount, 1n, 'factory should know about the origin deployment')
		strictEqualTypeSafe(securityPoolAddress, expectedAddresses.securityPool, 'stored security pool address should match')
		strictEqualTypeSafe(truthAuctionAddress, expectedAddresses.truthAuction, 'stored truth auction address should match')
		strictEqualTypeSafe(managerAddress, expectedAddresses.priceOracleManagerAndOperatorQueuer, 'stored manager address should match')
		strictEqualTypeSafe(shareTokenAddress, expectedAddresses.shareToken, 'stored share token address should match')
		strictEqualTypeSafe(parent, addressString(0x0n), 'stored parent should be zero for origin deployment')
		strictEqualTypeSafe(universeId, genesisUniverse, 'stored universe should match')
		strictEqualTypeSafe(storedQuestionId, questionId, 'stored question id should match')
		strictEqualTypeSafe(storedSecurityMultiplier, securityMultiplier, 'stored security multiplier should match')
		strictEqualTypeSafe(storedCurrentRetentionRate, MAX_RETENTION_RATE, 'stored retention rate should match')
		strictEqualTypeSafe(completeSetCollateralAmount, 0n, 'origin deployments should not have complete set collateral')
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

		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await approveAndDepositRep(thirdClient, repDeposit, questionId)
		await depositRep(client, securityPoolAddresses.securityPool, repDeposit)

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

		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		strictEqualTypeSafe(await getVaultCount(client, securityPoolAddresses.securityPool), 2n, 'historical vault count should include both vaults')
		strictEqualTypeSafe(await getActiveVaultCount(client, securityPoolAddresses.securityPool), 2n, 'active vault count should include both funded vaults')

		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, reportedRepEthPrice)

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

		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await approveAndDepositRep(thirdClient, repDeposit, questionId)

		const newestFirstVaultsBeforeRemoval = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsBeforeRemoval, [thirdClient.account.address, attackerClient.account.address, client.account.address], 'active vault paging should list the most recently activated vaults first')

		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, reportedRepEthPrice)

		const newestFirstVaultsAfterRemoval = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsAfterRemoval, [thirdClient.account.address, client.account.address], 'removing a middle vault should preserve newest-first ordering for the remaining active vaults')

		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

		const newestFirstVaultsAfterTouch = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsAfterTouch, [client.account.address, thirdClient.account.address], 'updating an active vault should move it to the front of the newest-first active vault preview')
	})

	test('withdrawal after question end releases escalation lock without changing ownership in single-sided case', async () => {
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		assert.ok(poolOwnershipDenominator > 0n, 'poolOwnershipDenominator was zero')
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const vaultBeforeDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepBeforeDeposit = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const escalationGameAddress = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(escalationGameAddress, securityPoolAddresses.escalationGame, 'escalation game addresses do not match')

		assert.ok((await getNonDecisionThreshold(client, securityPoolAddresses.escalationGame)) > 10n * reportBond, 'fork threshold needs to be big enough')
		await mockWindow.advanceTime(10n * DAY)
		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		strictEqualTypeSafe(yesDeposits.length, 1, 'there should be one deposit')
		const yesDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(yesDeposit.depositIndex, 0n, 'index should be zero')
		strictEqualTypeSafe(yesDeposit.depositor, client.account.address, 'wrong depositor')
		strictEqualTypeSafe(yesDeposit.cumulativeAmount, reportBond, 'cumulative should be report bond')
		strictEqualTypeSafe(yesDeposit.amount, reportBond, 'amount should be report bond')
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
		strictEqualTypeSafe(claimLog?.args.amountToWithdraw, reportBond, 'single-sided winning withdrawal should pay back the full original REP principal')
		assert.ok(vaultBeforeWithdrawal.repDepositShare < vaultBeforeDeposit.repDepositShare, 'depositing into escalation should reduce the vaults unlocked ownership')
		strictEqualTypeSafe(vaultAfterWithdrawal.repDepositShare, vaultBeforeWithdrawal.repDepositShare, 'with escrow custody, settling a break-even deposit should not re-mint vault ownership')
		strictEqualTypeSafe(walletRepAfterWithdrawal - walletRepBeforeDeposit, reportBond, 'a break-even escalation round-trip should return REP to the wallet instead')
		strictEqualTypeSafe(vaultAfterWithdrawal.repInEscalationGame, 0n, 'escalation lock should be released after withdrawal')
	})

	test('withdrawFromEscalationGame shares the binding-capital reward pool across all reward-eligible winning deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

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

		const lockedRepBeforeWithdrawal = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repInEscalationGame
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
		const winningClaimAmount = winningClaimLogs.reduce((sum, log) => sum + (log?.args.amountToWithdraw ?? 0n), 0n)
		const vaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(winningClaimLogs.length, 4, 'one transaction should emit one claim event for each winning deposit')
		assert.deepStrictEqual(
			winningClaimLogs.map(log => log?.args.parentDepositIndex),
			[0n, 1n, 2n, 3n],
			'multi-claim events should identify each stable deposit index in call order',
		)
		assert.deepStrictEqual(
			winningClaimLogs.map(log => log?.args.originalDepositAmount),
			[firstWinningDeposit, secondWinningDeposit, thirdWinningDeposit, fourthWinningDeposit],
			'multi-claim events should preserve each original principal',
		)
		assert.deepStrictEqual(
			winningClaimLogs.map(log => log?.args.amountToWithdraw),
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
		strictEqualTypeSafe(vaultAfterWithdrawal.repInEscalationGame, 0n, 'winning withdrawals should unlock all deposited REP')
	})

	test('losing escalation deposits stay locked and reduce the losing vaults available REP claim after winner withdrawal', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

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
		strictEqualTypeSafe(losingVaultBeforeWithdrawal.repInEscalationGame, losingDeposit, 'losing-side REP should start fully locked')
		strictEqualTypeSafe(losingVaultAfterWithdrawal.repInEscalationGame, losingDeposit, 'losing-side REP should remain locked after the winner withdraws')
		strictEqualTypeSafe(losingClaimAfterWithdrawal, losingClaimBeforeWithdrawal, 'winning-side settlement should not affect the losing vaults unlocked claim once escalation REP is fully escrowed outside the pool')
		assert.ok(losingClaimAfterWithdrawal + losingVaultAfterWithdrawal.repInEscalationGame === repDeposit, 'the losing vaults total economic position should remain split across unlocked claim and escrowed REP until its own settlement')
	})

	test('withdrawRep only uses available REP and cannot drain another vaults locked escalation stake', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const availableRepBeforeWithdrawal = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const aliceWalletRepBeforeWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)

		const availableRepAfterWithdrawal = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const aliceWalletRepAfterWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const aliceVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const attackerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		strictEqualTypeSafe(availableRepBeforeWithdrawal, repDeposit * 2n - lockedDeposit, 'available REP should exclude the locked escalation deposit')
		strictEqualTypeSafe(aliceWalletRepAfterWithdrawal - aliceWalletRepBeforeWithdrawal, repDeposit, 'withdrawal should still allow the caller to exit its full unlocked collateral claim')
		strictEqualTypeSafe(availableRepAfterWithdrawal, repDeposit - lockedDeposit, 'remaining available REP should still exclude the locked stake after withdrawal')
		strictEqualTypeSafe(aliceVaultAfterWithdrawal.repDepositShare, 0n, 'full vault withdrawal should remove the callers ownership share')
		strictEqualTypeSafe(attackerVaultAfterWithdrawal.repInEscalationGame, lockedDeposit, 'the other vaults locked escalation stake should remain intact')
	})

	test('performWithdrawRep cannot run on a vault with active escalation escrow', async () => {
		const escrowedVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRep(escrowedVault, repDeposit, questionId)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(escrowedVault, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		const vaultBeforeWithdrawAttempt = await getSecurityVault(escrowedVault, securityPoolAddresses.securityPool, escrowedVault.account.address)
		const walletRepBeforeWithdrawAttempt = await getERC20Balance(escrowedVault, addressString(GENESIS_REPUTATION_TOKEN), escrowedVault.account.address)
		await manipulatePriceOracleAndPerformOperation(escrowedVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, escrowedVault.account.address, repDeposit - lockedDeposit)
		const vaultAfterWithdrawAttempt = await getSecurityVault(escrowedVault, securityPoolAddresses.securityPool, escrowedVault.account.address)
		const walletRepAfterWithdrawAttempt = await getERC20Balance(escrowedVault, addressString(GENESIS_REPUTATION_TOKEN), escrowedVault.account.address)
		strictEqualTypeSafe(vaultBeforeWithdrawAttempt.repInEscalationGame, lockedDeposit, 'test setup should create active escrow')
		strictEqualTypeSafe(vaultAfterWithdrawAttempt.repInEscalationGame, lockedDeposit, 'failed withdrawal should leave active escrow intact')
		strictEqualTypeSafe(vaultAfterWithdrawAttempt.repDepositShare, vaultBeforeWithdrawAttempt.repDepositShare, 'failed withdrawal should not change pool ownership')
		strictEqualTypeSafe(walletRepAfterWithdrawAttempt, walletRepBeforeWithdrawAttempt, 'failed withdrawal should not transfer REP')
	})

	test('redeemRep requires settled escalation deposits after question finalization', async () => {
		await finalizeQuestionAsYesWithoutFork()

		const walletRepBeforeRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await assert.rejects(redeemRep(client, securityPoolAddresses.securityPool, client.account.address), /Escalation deposits locked/)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const vaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		strictEqualTypeSafe(vaultAfterRedeem.repDepositShare, 0n, 'redeemRep should empty the vault after escalation settles')
		strictEqualTypeSafe(vaultAfterRedeem.repInEscalationGame, 0n, 'redeemRep should not recreate escrowed REP')
		strictEqualTypeSafe(walletRepAfterRedeem - walletRepAfterSettlement, repDeposit - reportBond, 'redeemRep should only return the vault-held REP claim after escalation settles')
		strictEqualTypeSafe(vaultAfterSettlement.repInEscalationGame, 0n, 'settling escalation should clear the remaining escrowed REP')
		strictEqualTypeSafe(walletRepAfterSettlement - walletRepBeforeRedeem, reportBond, 'settling escalation should return only the escrowed REP')
	})

	test('depositToEscalationGame burns enough ownership after the pool share price appreciates', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const benefactorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await mockWindow.setTime(endTime + 10000n)
		await transferRepToAddress(benefactorClient, securityPoolAddresses.securityPool, repDeposit)

		const vaultBeforeEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const totalRepBeforeEscrow = (await getVaultRepClaim(client.account.address)) + vaultBeforeEscrow.repInEscalationGame

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const vaultAfterEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const totalRepAfterEscrow = (await getVaultRepClaim(client.account.address)) + vaultAfterEscrow.repInEscalationGame

		assert.ok(totalRepAfterEscrow <= totalRepBeforeEscrow, 'moving REP into escalation should not increase the vaults total economic position after pool appreciation')
		strictEqualTypeSafe(vaultAfterEscrow.repInEscalationGame, reportBond, 'the escrowed REP principal should match the deposited escalation amount exactly')
	})

	test('depositToEscalationGame rechecks the local bond against the post-escrow REP balance', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const secondVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const escrowAmount = 200n * 10n ** 18n

		await approveAndDepositRep(secondVault, repDeposit, questionId)

		const totalRepBeforeEscrow = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		const vaultBeforeEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const ownershipToEscrow = (escrowAmount * poolOwnershipDenominator + totalRepBeforeEscrow - 1n) / totalRepBeforeEscrow
		const expectedRepAfterEscrow = ((vaultBeforeEscrow.repDepositShare - ownershipToEscrow) * (totalRepBeforeEscrow - escrowAmount)) / poolOwnershipDenominator
		const targetAllowance = expectedRepAfterEscrow + 1n

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance)
		await manipulatePriceOracleAndPerformOperation(secondVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, secondVault.account.address, 0n)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		assert.ok(vaultBeforeEscrow.repDepositShare > 0n, 'target vault should already be funded')
		assert.ok(totalRepBeforeEscrow - escrowAmount >= targetAllowance, 'the pool-wide bond should still be satisfied after escrow')
		assert.ok(expectedRepAfterEscrow < targetAllowance, 'the target vault should fall below its local allowance after escrow')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, escrowAmount)
		const vaultAfterEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(vaultAfterEscrow.repInEscalationGame >= escrowAmount, 'the escrowed REP should be accepted when the post-transfer denominator keeps the vault above its bond threshold')
		assert.ok((await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterEscrow.repDepositShare)) >= targetAllowance, 'the remaining claim should still satisfy the local bond after escrow')
	})

	test('oracle-staged collateral operations are rejected once escalation resolves', async () => {
		await finalizeQuestionAsYesWithoutFork()

		await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, 1n), /question already resolved, so staged operations are unavailable/)
	})

	test('oracle-staged security bond allowance updates can clear the allowance to zero', async () => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)

		const vaultAfterClearingAllowance = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(vaultAfterClearingAllowance.securityBondAllowance, 0n, 'setting the security bond allowance to zero should succeed')
	})

	test('withdrawFromEscalationGame gives later safety-boundary deposits a pro-rata share of the binding-capital reward pool', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingSide = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(firstWinner, repDeposit, questionId)
		await approveAndDepositRep(secondWinner, repDeposit, questionId)
		await approveAndDepositRep(losingSide, repDeposit, questionId)

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
		strictEqualTypeSafe(firstClaimLog?.args.amountToWithdraw, expectedFirstWinnerPayout, 'the first winning deposit should receive the pro-rata reward on its full 20 REP reward-eligible principal')
		strictEqualTypeSafe(secondClaimLog?.args.amountToWithdraw, expectedSecondWinnerPayout, 'the crossing deposit should receive reward on its 10 REP safety-boundary slice and principal only on its 4 REP excess slice')
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('withdrawFromEscalationGame shares the full reward pool across the actual winning principal when total winning principal stays below the reward cap', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingSide = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(firstWinner, repDeposit, questionId)
		await approveAndDepositRep(secondWinner, repDeposit, questionId)
		await approveAndDepositRep(losingSide, repDeposit, questionId)

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
		strictEqualTypeSafe(firstClaimLog?.args.amountToWithdraw, expectedFirstWinnerPayout, 'when total winning principal stays below the reward cap, the first winner should receive its pro-rata share of the full reward pool')
		strictEqualTypeSafe(secondClaimLog?.args.amountToWithdraw, expectedSecondWinnerPayout, 'when total winning principal stays below the reward cap, the second winner should also receive its pro-rata share of the full reward pool')
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('external fork blocks parent escalation withdrawals and preserves escrowed REP', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

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
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [aliceDeposit.depositIndex]), /Forked deposits must migrate first/)
		await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [bobDeposit.depositIndex]), /Forked deposits must migrate first/)

		const aliceVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const bobVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(aliceVaultAfter.repInEscalationGame, aliceVaultBefore.repInEscalationGame, 'alice lock should stay in the parent until migrated')
		strictEqualTypeSafe(bobVaultAfter.repInEscalationGame, bobVaultBefore.repInEscalationGame, 'bob lock should stay in the parent until migrated')
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

		const unsettledBefore = (await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === client.account.address && deposit.amount > 0n).map(deposit => deposit.depositIndex)
		strictEqualTypeSafe(unsettledBefore.length, 1, 'the winning deposit should be discoverable before settlement')
		strictEqualTypeSafe(unsettledBefore[0], 0n, 'the first winning deposit should be returned')

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])

		const unsettledAfter = (await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === client.account.address && deposit.amount > 0n).map(deposit => deposit.depositIndex)
		strictEqualTypeSafe(unsettledAfter.length, 0, 'settled winning deposits should disappear from discovery results')
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Deposit settled/)
	})

	test('withdrawFromEscalationGame rejects none outcome after an external fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
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

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.None, [0n]), /Invalid None outcome/)
	})

	test('losing escalation deposits can be settled after resolution and stop counting as locked collateral', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 1n)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

		await mockWindow.advanceTime(10n * DAY)

		const noDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const canceledCandidateDeposit = ensureDefined(noDeposits[0], 'no escalation deposit missing')
		const attackerVaultBeforeSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex])
		const attackerVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(attackerVaultAfterSettlement.repInEscalationGame, 0n, 'losing-side settlement should clear the resolved escalation lock')
		strictEqualTypeSafe(attackerVaultAfterSettlement.repDepositShare, attackerVaultBeforeSettlement.repDepositShare, 'settling a fully losing escalation deposit should not mint new vault ownership to the loser')
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
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier)
		await approveAndDepositRep(client, repDeposit, secondQuestionId)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await approveAndDepositRep(attackerClient, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
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
			firstYesDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === firstWinningDeposit),
			'first-pool winning deposit missing',
		).depositIndex
		const firstLosingIndex = ensureDefined(
			firstNoDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === losingDeposit),
			'first-pool losing deposit missing',
		).depositIndex
		const secondWinningIndex = ensureDefined(
			secondYesDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === firstWinningDeposit),
			'second-pool winning deposit missing',
		).depositIndex
		const secondLosingIndex = ensureDefined(
			secondNoDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === losingDeposit),
			'second-pool losing deposit missing',
		).depositIndex

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [firstLosingIndex])
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [firstWinningIndex])
		await withdrawFromEscalationGame(client, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes, [secondWinningIndex])
		await withdrawFromEscalationGame(client, secondSecurityPoolAddresses.securityPool, QuestionOutcome.No, [secondLosingIndex])

		const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const secondVault = await getSecurityVault(client, secondSecurityPoolAddresses.securityPool, client.account.address)
		const firstUnlockedRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, firstVault.repDepositShare)
		const secondUnlockedRep = await poolOwnershipToRep(client, secondSecurityPoolAddresses.securityPool, secondVault.repDepositShare)

		strictEqualTypeSafe(firstVault.repInEscalationGame, 0n, 'the first pool should have no remaining escalation locks after both settlements')
		strictEqualTypeSafe(secondVault.repInEscalationGame, 0n, 'the mirror pool should have no remaining escalation locks after both settlements')
		strictEqualTypeSafe(firstUnlockedRep, secondUnlockedRep, 'settling the winning and losing deposits in opposite orders should leave the same final unlocked vault claim')
	})
})
