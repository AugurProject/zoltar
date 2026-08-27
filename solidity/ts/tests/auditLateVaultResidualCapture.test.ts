import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/shared/ethereum'
import { getTotalPoolHeldAttoRep, getTotalRepBackingUnits } from '../testSupport/simulator/utils/contracts/securityPool'
import { splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { useStatoblastEscalationMigrationFixture, type StatoblastEscalationMigrationFixture } from './statoblast/fixture'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'

describe('Ordinary escalation vault-deposit freeze', () => {
	const fixture = useStatoblastEscalationMigrationFixture()
	const {
		assert,
		strictEqualTypeSafe,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		getChildUniverseId,
		addressString,
		approveToken,
		approveAndDepositRepToVault,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		depositRepToVault,
		depositToEscalationGame,
		getERC20Balance,
		getQuestionEndDate,
		getQuestionResolution,
		createChildUniverse,
		initiateSecurityPoolFork,
		startTruthAuction,
		forkUniverse,
		getRepTokenAddress,
		getZoltarAddress,
		getZoltarForkThreshold,
		getRepToken,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		backingUnitsToAttoRep,
		manipulatePriceOracle,
		QuestionOutcome,
		SystemState,
		reportBond,
		repDeposit,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
		outcomes,
		statoblast_EscalationGame_EscalationGame,
		withdrawFromEscalationGame,
	} = fixture

	type TestClient = StatoblastEscalationMigrationFixture['client']

	let mockWindow: StatoblastEscalationMigrationFixture['mockWindow']
	let client: TestClient
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

	const depositRepFromWallet = async (depositor: TestClient, escalationGame: Address, outcome = QuestionOutcome.No, maximumDepositAttoRep = 100n * 10n ** 18n) => {
		const hash = await depositor.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'depositRepFromWallet',
			args: [outcome, maximumDepositAttoRep],
		})
		await depositor.waitForTransactionReceipt({ hash })
	}

	const readWalletDepositGuardState = async (depositor: TestClient, securityPool: Address, escalationGame: Address, repToken: Address, outcome = QuestionOutcome.No) => {
		const vault = await getSecurityVault(client, securityPool, depositor.account.address)
		return {
			depositorRep: await getERC20Balance(client, repToken, depositor.account.address),
			gameRep: await getERC20Balance(client, repToken, escalationGame),
			poolRep: await getTotalPoolHeldAttoRep(client, securityPool),
			vaultBackingUnits: vault.repBackingUnits,
			totalDisputeStake: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'totalDisputeStakedAttoRep',
				args: [],
			}),
			depositorDisputeStake: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'disputeStakedRepByVaultAttoRep',
				args: [depositor.account.address],
			}),
			outcomeDepositCount: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getDepositsByOutcomeLength',
				args: [outcome],
			}),
		}
	}

	const expectWalletDepositRejectionWithoutStateChange = async (depositor: TestClient, securityPool: Address, escalationGame: Address, repToken: Address, expectedError: RegExp, outcome = QuestionOutcome.No) => {
		const before = await readWalletDepositGuardState(depositor, securityPool, escalationGame, repToken, outcome)
		await assert.rejects(depositRepFromWallet(depositor, escalationGame, outcome), expectedError)
		assert.deepStrictEqual(await readWalletDepositGuardState(depositor, securityPool, escalationGame, repToken, outcome), before, 'rejected wallet deposit must not mutate balances, backing units, or dispute accounting')
	}

	const startOrdinaryGame = async () => {
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		return await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
	}

	const forkGenesisUniverseExternally = async (forkInitiator: TestClient, title: string) => {
		const externalForkQuestion = {
			...questionData,
			title,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestion, outcomes)
		await createQuestion(forkInitiator, externalForkQuestion, outcomes)
		await mockWindow.setTime(externalForkQuestion.endTime + 1n)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, genesisUniverse, externalForkQuestionId)
	}

	test('rejects late backing-unit minting while preserving wallet-funded escalation', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const escalationDepositor = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRepToVault(escalationDepositor, repDeposit, questionId)

		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const lowLosingPrincipal = 100n * 10n ** 18n
		const bindingLosingPrincipal = 200n * 10n ** 18n
		const winningPrincipal = 300n * 10n ** 18n
		await depositToEscalationGame(escalationDepositor, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, lowLosingPrincipal)
		await depositToEscalationGame(escalationDepositor, securityPoolAddresses.securityPool, QuestionOutcome.No, bindingLosingPrincipal)
		await depositToEscalationGame(escalationDepositor, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningPrincipal)
		await approveToken(attacker, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		// A participant that arrives after the ordinary game starts can still challenge the
		// prospective result, but its REP goes directly into dispute escrow and never
		// receives residual-eligible backing units.
		await approveToken(attacker, addressString(GENESIS_REPUTATION_TOKEN), escalationGame)
		const poolRepBeforeWalletDeposit = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
		const attackerWalletBeforeWalletDeposit = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		const gameRepBeforeWalletDeposit = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), escalationGame)
		const walletDepositHash = await attacker.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'depositRepFromWallet',
			args: [QuestionOutcome.No, 100n * 10n ** 18n],
		})
		await attacker.waitForTransactionReceipt({ hash: walletDepositHash })

		const gameRepAfterWalletDeposit = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), escalationGame)
		const acceptedWalletDeposit = gameRepAfterWalletDeposit - gameRepBeforeWalletDeposit
		assert.ok(acceptedWalletDeposit > 0n, 'the direct challenge should escrow wallet REP')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), poolRepBeforeWalletDeposit, 'wallet-funded escalation must not change pool-held REP')
		const attackerVaultAfterWalletDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, attacker.account.address)
		strictEqualTypeSafe(attackerVaultAfterWalletDeposit.repBackingUnits, 0n, 'wallet-funded escalation must not mint pool backing units')
		const attackerDisputeStake = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'disputeStakedRepByVaultAttoRep',
			args: [attacker.account.address],
		})
		strictEqualTypeSafe(attackerDisputeStake, acceptedWalletDeposit, 'the accepted wallet REP must be fully exposed to the escalation result')
		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address), attackerWalletBeforeWalletDeposit - acceptedWalletDeposit, 'the direct challenge must debit the attacker wallet by the escrowed amount')

		const escalationEnd = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(escalationEnd)
		strictEqualTypeSafe(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'the game must remain unresolved at the exact finalization boundary')

		const poolRepBeforeAttack = await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool)
		const attackerWalletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)

		// Without a game-lifecycle guard, this deposit mints backing units after every
		// existing position and the prospective terminal residual are public. Those units
		// then capture part of the imminent residual sweep despite bearing no dispute risk.
		await assert.rejects(depositRepToVault(attacker, securityPoolAddresses.securityPool, repDeposit, 1_000_000n))
		const attackerVault = await getSecurityVault(client, securityPoolAddresses.securityPool, attacker.account.address)
		strictEqualTypeSafe(attackerVault.repBackingUnits, 0n, 'the rejected deposit must not mint residual-eligible backing units')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), poolRepBeforeAttack, 'the rejected deposit must not change pool-held REP')
		const attackerWalletAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		strictEqualTypeSafe(attackerWalletAfter, attackerWalletBefore, 'the rejected deposit must leave the attacker wallet unchanged')

		await mockWindow.advanceTime(1n)
		strictEqualTypeSafe(await getQuestionResolution(client, escalationGame), QuestionOutcome.Yes, 'the unchanged game should resolve after the boundary')
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.No, [1n])
		const attackerDisputeStakeAfterLoss = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'disputeStakedRepByVaultAttoRep',
			args: [attacker.account.address],
		})
		strictEqualTypeSafe(attackerDisputeStakeAfterLoss, 0n, 'settlement should consume the wallet-funded losing stake')
		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address), attackerWalletBefore, 'a losing direct challenge must not refund the escrowed REP')
	})

	test('rejects wallet deposits into a non-current game without moving REP or dispute state', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const infra = getInfraContractAddresses()
		const deploymentHash = await attacker.sendTransaction({
			data: encodeDeployData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
				args: [securityPoolAddresses.securityPool, repToken, infra.escalationGameProofVerifier, infra.escalationGameClaimDelegate],
			}),
		})
		const deploymentReceipt = await attacker.waitForTransactionReceipt({ hash: deploymentHash })
		const orphanGame = deploymentReceipt.contractAddress
		if (orphanGame === undefined || orphanGame === null) throw new Error('orphan escalation game deployment address missing')
		const startHash = await attacker.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: orphanGame,
			functionName: 'start',
			args: [reportBond, 2n * reportBond],
		})
		await attacker.waitForTransactionReceipt({ hash: startHash })
		await approveToken(attacker, repToken, orphanGame)

		await expectWalletDepositRejectionWithoutStateChange(attacker, securityPoolAddresses.securityPool, orphanGame, repToken, /Game inactive/)
	})

	test('rejects wallet deposits after a universe fork and after the pool becomes inactive', async () => {
		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const escalationGame = await startOrdinaryGame()
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		await approveToken(forkInitiator, repToken, escalationGame)
		await forkGenesisUniverseExternally(forkInitiator, 'wallet deposit fork guard')

		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'the universe fork must precede the pool state transition')
		await expectWalletDepositRejectionWithoutStateChange(forkInitiator, securityPoolAddresses.securityPool, escalationGame, repToken, /Forked/)

		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'fork initiation must deactivate the parent pool')
		await expectWalletDepositRejectionWithoutStateChange(forkInitiator, securityPoolAddresses.securityPool, escalationGame, repToken, /Pool inactive/)
	})

	test('rejects continuation wallet deposits while keeping continuation vault deposits available', async () => {
		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 10_000n)

		const forkThresholdAttoRep = await getZoltarForkThreshold(client, genesisUniverse)
		const nonDecisionThresholdAttoRep = forkThresholdAttoRep / 2n + (forkThresholdAttoRep % 2n)
		const invalidPrincipalAttoRep = nonDecisionThresholdAttoRep - 3n
		const noPrincipalAttoRep = nonDecisionThresholdAttoRep - 2n
		const yesPrincipalAttoRep = nonDecisionThresholdAttoRep - 1n
		const totalPrincipalAttoRep = invalidPrincipalAttoRep + noPrincipalAttoRep + yesPrincipalAttoRep
		const parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentVaultRepAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, parentVault.repBackingUnits)
		assert.ok(parentVaultRepAttoRep < totalPrincipalAttoRep, 'fixture must require a pre-game top-up')
		await approveAndDepositRepToVault(client, totalPrincipalAttoRep - parentVaultRepAttoRep, questionId)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, invalidPrincipalAttoRep)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, noPrincipalAttoRep)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, yesPrincipalAttoRep)
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), 0n, 'parent vault backing must be fully escrowed')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'parent pool must have no auctionable REP')

		await forkGenesisUniverseExternally(forkInitiator, 'wallet deposit continuation guard')
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		const childRepToken = getRepTokenAddress(childUniverse)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, childPool.securityPool)
		const seedRepAttoRep = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: childPool.securityPool,
			functionName: 'minimumVaultRepDepositAttoRep',
			args: [],
		})
		await splitMigrationRep(forkInitiator, genesisUniverse, seedRepAttoRep, [QuestionOutcome.Yes])
		await approveToken(forkInitiator, childRepToken, childEscalationGame)
		await approveToken(forkInitiator, childRepToken, childPool.securityPool)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, childPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, childPool.securityPool), SystemState.Operational, 'zero auctionable REP must activate the continuation directly')
		await expectWalletDepositRejectionWithoutStateChange(forkInitiator, childPool.securityPool, childEscalationGame, childRepToken, /Fork game/)

		const childGameRepBeforeVaultDeposit = await getERC20Balance(client, childRepToken, childEscalationGame)
		await depositRepToVault(forkInitiator, childPool.securityPool, seedRepAttoRep)
		const childVault = await getSecurityVault(client, childPool.securityPool, forkInitiator.account.address)
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, childPool.securityPool, childVault.repBackingUnits), seedRepAttoRep, 'continuation initialization must not freeze ordinary vault deposits')
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, childEscalationGame), childGameRepBeforeVaultDeposit, 'continuation vault deposit must not enter game escrow')
	})
})
