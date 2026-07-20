import { beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import type { Address } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { BURN_ADDRESS, DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { approveAndDepositRep, handleOracleReporting, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import {
	executeStagedOperation,
	getActiveStagedOperationCount,
	getActiveStagedOperations,
	getPendingSettlementOperationCount,
	getPendingSettlementOperationIds,
	getQueuedOperationEthCost,
	getEthRaiseCap,
	getQuestionEndDate,
	getRequestPriceEthCost,
	getStagedOperation,
	getStagedOperationCounter,
	migrateShares,
	OperationType,
	participateAuction,
	queueLiquidationAtForcedPrice,
	requestPriceIfNeededAndStageOperationWithValue,
} from '../testSupport/simulator/utils/contracts/peripherals'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed, forkUniverse, getMigrationRepBalance, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getUniverseTheoreticalSupply, getZoltarAddress, getZoltarForkThreshold } from '../testSupport/simulator/utils/contracts/zoltar'
import {
	claimAuctionProceeds,
	createChildUniverse,
	finalizeTruthAuction,
	getForkedEscrowChildRepByOutcomeAndVault,
	getForkedEscrowPrincipalByOutcomeAndVault,
	getMigrationProxyAddress,
	getOwnForkRepBuckets,
	getSecurityPoolForkerForkData,
	initiateSecurityPoolFork,
	migrateRepToZoltar,
	migrateVault,
	migrateVaultWithUnresolvedEscalation,
	startTruthAuction,
} from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameDeposits, getEscrowedRepByVault, getTotalEscrowedRep } from '../testSupport/simulator/utils/contracts/escalationGame'
import {
	createCompleteSet,
	depositRep,
	depositToEscalationGame,
	getActiveVaultCount,
	getActiveVaults,
	getCompleteSetCollateralAmount,
	getPoolOwnershipDenominator,
	getSecurityVault,
	getShareTokenSupply,
	getSystemState,
	getTotalAccruedFees,
	getTotalFeesOwedToVaults,
	getTotalRepBalance,
	getTotalSecurityBondAllowance,
	poolOwnershipToRep,
	redeemRep,
} from '../testSupport/simulator/utils/contracts/securityPool'
import { approveToken, contractExists, getChildUniverseId as deriveChildUniverseId, getERC20Balance, getETHBalance, setupTestAccounts, sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { SystemState } from '../testSupport/simulator/types/peripheralTypes'
import { ensureDefined, strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { computeClearing, deployUniformPriceDualCapBatchAuction, finalize as finalizeAuction, getEthRaised, getTotalRepPurchased, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../testSupport/simulator/utils/contracts/auction'
import { getUniformPriceDualCapBatchAuctionAddress } from '../testSupport/simulator/utils/contracts/deployments'
import { priceToClosestTick, tickToPrice } from '../testSupport/simulator/utils/tickMath'
import { peripherals_EscalationGame_EscalationGame } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const genesisUniverse = 0n
const securityMultiplier = 2n
const repDeposit = 1000n * 10n ** 18n
const AUCTION_TIME = 604800n

type EscrowAccountingSnapshot = {
	escalationGameTokenBalance: bigint
	escrowedRepByVault: readonly bigint[]
	poolVaultLocks: readonly bigint[]
	totalEscrowedRep: bigint
}

const assertEscrowAccountingSnapshot = (snapshot: EscrowAccountingSnapshot, label: string, { tokenBacking = 'exact' }: { tokenBacking?: 'at-least' | 'exact' | 'none' } = {}) => {
	strictEqualTypeSafe(snapshot.escrowedRepByVault.length, snapshot.poolVaultLocks.length, `${label}: pool and escalation-game vault pages should cover the same actors`)
	for (const [index, escrowedRep] of snapshot.escrowedRepByVault.entries()) {
		strictEqualTypeSafe(escrowedRep, ensureDefined(snapshot.poolVaultLocks[index], `${label}: pool vault lock ${index.toString()} is missing`), `${label}: pool and escalation-game vault locks should match for actor ${index.toString()}`)
	}
	strictEqualTypeSafe(
		snapshot.escrowedRepByVault.reduce((sum, amount) => sum + amount, 0n),
		snapshot.totalEscrowedRep,
		`${label}: per-vault escalation escrow should sum to the game total`,
	)
	if (tokenBacking === 'exact') strictEqualTypeSafe(snapshot.escalationGameTokenBalance, snapshot.totalEscrowedRep, `${label}: escalation-game token backing should equal recorded escrow`)
	if (tokenBacking === 'at-least') assert.ok(snapshot.escalationGameTokenBalance >= snapshot.totalEscrowedRep, `${label}: prefunded escalation-game token balance should cover recorded escrow`)
}

const assertEscrowMigrationConservation = ({ childSourcePrincipal, parentRemainingPrincipal, sourcePrincipalAtFork }: { childSourcePrincipal: bigint; parentRemainingPrincipal: bigint; sourcePrincipalAtFork: bigint }, label: string) => {
	strictEqualTypeSafe(parentRemainingPrincipal + childSourcePrincipal, sourcePrincipalAtFork, `${label}: parent remainder plus child source principal should conserve the fork-time escrow entitlement`)
}

type HarnessContext = {
	questionId: bigint
	questionEndDate: bigint
	securityPool: Address
}

const readPoolAccountingSnapshot = async (snapshotClient: WriteClient, securityPool: Address) => ({
	systemState: await getSystemState(snapshotClient, securityPool),
	ethBalance: await getETHBalance(snapshotClient, securityPool),
	repBalance: await getTotalRepBalance(snapshotClient, securityPool),
	completeSetCollateral: await getCompleteSetCollateralAmount(snapshotClient, securityPool),
	poolOwnershipDenominator: await getPoolOwnershipDenominator(snapshotClient, securityPool),
	totalSecurityBondAllowance: await getTotalSecurityBondAllowance(snapshotClient, securityPool),
	totalFeesOwedToVaults: await getTotalFeesOwedToVaults(snapshotClient, securityPool),
})

const shuffle = <T>(values: readonly T[], seed: bigint): T[] => {
	const result = [...values]
	let state = seed & ((1n << 64n) - 1n)
	const next = () => {
		state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
		return state
	}
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Number(next() % BigInt(index + 1))
		;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
	}
	return result
}

const getQuestionOutcomes = () => sortStringArrayByKeccak(['Yes', 'No'])

const getStatefulInvariantSeeds = () => {
	const configuredSeed = process.env['ZOLTAR_INVARIANT_SEED']
	if (configuredSeed !== undefined) return [BigInt(configuredSeed)]
	return [0x51a7en, 0xc011a7n, 0xdeadbeefn]
}

describe('Peripherals invariant harness', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let context: HarnessContext

	const createClient = (index: number) => createWriteClient(mockWindow, ensureDefined(TEST_ADDRESSES[index], `TEST_ADDRESSES[${index}] is undefined`), 0)

	const buildContext = async (): Promise<HarnessContext> => {
		const currentTimestamp = await mockWindow.getTime()
		const questionData = {
			title: `invariant harness ${currentTimestamp}`,
			description: '',
			startTime: 0n,
			endTime: currentTimestamp + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		await approveAndDepositRep(client, repDeposit, questionId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		return {
			questionId,
			questionEndDate: questionData.endTime,
			securityPool: addresses.securityPool,
		}
	}

	const getChildUniverseIdForOutcome = (outcome: QuestionOutcome) => deriveChildUniverseId(genesisUniverse, BigInt(outcome))

	const assertSecurityPoolEscrowAccounting = async ({ actors, escalationGame, label, repToken, securityPool }: { actors: readonly WriteClient[]; escalationGame: Address; label: string; repToken: Address; securityPool: Address }) => {
		if (!(await contractExists(client, escalationGame))) return
		const [escrowedRepByVault, poolVaults, totalEscrowedRep, escalationGameTokenBalance, systemState] = await Promise.all([
			Promise.all(actors.map(actor => getEscrowedRepByVault(client, escalationGame, actor.account.address))),
			Promise.all(actors.map(actor => getSecurityVault(client, securityPool, actor.account.address))),
			getTotalEscrowedRep(client, escalationGame),
			getERC20Balance(client, repToken, escalationGame),
			getSystemState(client, securityPool),
		])
		let tokenBacking: 'at-least' | 'exact' | 'none' = 'exact'
		if (systemState === SystemState.PoolForked) tokenBacking = 'none'
		else if (systemState === SystemState.ForkMigration) tokenBacking = 'at-least'
		assertEscrowAccountingSnapshot(
			{
				escalationGameTokenBalance,
				escrowedRepByVault,
				poolVaultLocks: poolVaults.map(vault => vault.repInEscalationGame),
				totalEscrowedRep,
			},
			label,
			{ tokenBacking },
		)
	}

	const triggerExternalForkForSecurityPool = async (forkingClient: WriteClient | undefined = undefined, titlePrefix = 'external fork source') => {
		const effectiveForkingClient = forkingClient ?? createClient(5)
		const now = await mockWindow.getTime()
		const forkSourceQuestionData = {
			title: `${titlePrefix} ${now}`,
			description: '',
			startTime: 0n,
			endTime: now + DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = getQuestionOutcomes()
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(effectiveForkingClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(effectiveForkingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(effectiveForkingClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, context.securityPool)
	}

	const setupFinalizedTruthAuctionWithMixedBids = async () => {
		const endTime = await getQuestionEndDate(client, context.questionId)
		await mockWindow.setTime(endTime + 10000n)
		const attackerClient = createClient(1)
		await approveAndDepositRep(attackerClient, repDeposit, context.questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createClient(2)
		await createCompleteSet(openInterestHolder, context.securityPool, openInterestAmount)
		await triggerExternalForkForSecurityPool(undefined, 'mixed bids fork source')
		await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
		await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, context.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(context.securityPool, yesUniverse, context.questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, context.securityPool)).auctionableRepAtFork
		const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
		const losingBidder = createClient(3)
		const winningBidder = createClient(4)
		const losingEth = expectedEthToBuy / 10n
		assert.ok(losingEth > 0n, 'losing bid should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		const winningTick = await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		return {
			yesSecurityPool,
			losingBidder,
			winningBidder,
			losingEth,
			losingTick,
			winningTick,
		}
	}

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		context = await buildContext()
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
	})

	test('escrow accounting model rejects dropped and duplicated migration backing', () => {
		const balancedSnapshot = {
			escalationGameTokenBalance: 30n,
			escrowedRepByVault: [10n, 20n],
			poolVaultLocks: [10n, 20n],
			totalEscrowedRep: 30n,
		} as const
		assertEscrowAccountingSnapshot(balancedSnapshot, 'balanced mutation fixture')
		expect(() => assertEscrowAccountingSnapshot({ ...balancedSnapshot, escalationGameTokenBalance: 29n }, 'dropped backing mutation')).toThrow(/token backing should equal recorded escrow/)
		expect(() => assertEscrowAccountingSnapshot({ ...balancedSnapshot, escrowedRepByVault: [10n, 21n] }, 'duplicated vault mutation')).toThrow(/pool and escalation-game vault locks should match/)
		assertEscrowMigrationConservation({ childSourcePrincipal: 20n, parentRemainingPrincipal: 10n, sourcePrincipalAtFork: 30n }, 'balanced migration fixture')
		expect(() => assertEscrowMigrationConservation({ childSourcePrincipal: 19n, parentRemainingPrincipal: 10n, sourcePrincipalAtFork: 30n }, 'dropped migration mutation')).toThrow(/conserve the fork-time escrow entitlement/)
		expect(() => assertEscrowMigrationConservation({ childSourcePrincipal: 21n, parentRemainingPrincipal: 10n, sourcePrincipalAtFork: 30n }, 'duplicated migration mutation')).toThrow(/conserve the fork-time escrow entitlement/)
	})

	test('replayable multi-pool action traces preserve lifecycle accounting', async () => {
		const seedBaseline = await mockWindow.anvilSnapshot()
		let currentSeedBaseline = seedBaseline
		const parentRepToken = getRepTokenAddress(genesisUniverse)
		const secondSecurityMultiplier = 3n

		for (const seed of getStatefulInvariantSeeds()) {
			const trace: string[] = []
			const runAction = async (name: string, action: () => Promise<unknown>) => {
				trace.push(name)
				try {
					await action()
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					throw new Error(`Stateful invariant seed ${seed.toString()} failed after ${trace.join(' -> ')}: ${message}`, { cause: error })
				}
			}

			const assertPoolAccounting = async (securityPool: Address, label: string) => {
				const activeVaultCount = await getActiveVaultCount(client, securityPool)
				const activeVaults = await getActiveVaults(client, securityPool, 0n, activeVaultCount + 1n)
				const vaults = await Promise.all(activeVaults.map(vault => getSecurityVault(client, securityPool, vault)))
				const totalAllowanceFromVaults = vaults.reduce((sum, vault) => sum + vault.securityBondAllowance, 0n)
				const totalOwnershipFromVaults = vaults.reduce((sum, vault) => sum + vault.repDepositShare, 0n)
				const totalRep = await getTotalRepBalance(client, securityPool)
				const totalClaims = (await Promise.all(vaults.map(vault => poolOwnershipToRep(client, securityPool, vault.repDepositShare)))).reduce((sum, claim) => sum + claim, 0n)
				const collateral = await getCompleteSetCollateralAmount(client, securityPool)
				const feesOwed = await getTotalFeesOwedToVaults(client, securityPool)
				const ethBalance = await getETHBalance(client, securityPool)

				strictEqualTypeSafe(BigInt(activeVaults.length), activeVaultCount, `${label}: active-vault count should match its page`)
				assert.strictEqual(new Set(activeVaults).size, activeVaults.length, `${label}: active-vault page should not duplicate actors`)
				strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, securityPool), totalRep, `${label}: recorded REP should equal the token balance`)
				strictEqualTypeSafe(totalAllowanceFromVaults, await getTotalSecurityBondAllowance(client, securityPool), `${label}: aggregate allowance should equal the sum of vault allowances`)
				strictEqualTypeSafe(totalOwnershipFromVaults, await getPoolOwnershipDenominator(client, securityPool), `${label}: ownership denominator should equal active vault ownership`)
				assert.ok(totalClaims <= totalRep, `${label}: rounded vault claims must not exceed pool REP`)
				assert.ok(totalRep - totalClaims <= activeVaultCount, `${label}: aggregate REP rounding dust should be bounded by active vault count`)
				assert.ok(collateral + feesOwed <= ethBalance, `${label}: collateral and allocated fee obligations must remain ETH-backed`)
				assert.ok((await getTotalSecurityBondAllowance(client, securityPool)) >= collateral, `${label}: open interest must remain backed by aggregate allowance`)
			}

			const parentSupplyBeforeActions = await getUniverseTheoreticalSupply(client, genesisUniverse)
			const burnBalanceBeforeActions = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))
			const assertParentSupplyAccounting = async (label: string) => {
				const currentSupply = await getUniverseTheoreticalSupply(client, genesisUniverse)
				const currentBurnBalance = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))
				strictEqualTypeSafe(parentSupplyBeforeActions - currentSupply, currentBurnBalance - burnBalanceBeforeActions, `${label}: parent theoretical-supply decrease should equal intentional REP burns`)
			}

			await runAction('deploy second pool', async () => {
				await deployOriginSecurityPool(client, genesisUniverse, context.questionId, secondSecurityMultiplier)
			})
			const firstPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier)
			const secondPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, secondSecurityMultiplier)
			const actorA = createClient(1)
			const actorB = createClient(2)
			const actorC = createClient(3)
			const actors = [client, actorA, actorB, actorC]
			await runAction('deploy and start interleaved accounting auction', async () => {
				await deployUniformPriceDualCapBatchAuction(client, client.account.address)
				await startAuction(client, getUniformPriceDualCapBatchAuctionAddress(client.account.address), 100n * 10n ** 18n, 100n * 10n ** 18n)
			})
			const accountingAuction = getUniformPriceDualCapBatchAuctionAddress(client.account.address)
			let actorAAuctionTick: bigint | undefined
			let actorBAuctionTick: bigint | undefined
			for (const actor of actors) {
				await approveToken(actor, parentRepToken, firstPoolAddresses.securityPool)
				await approveToken(actor, parentRepToken, secondPoolAddresses.securityPool)
			}

			const depositActions = shuffle(
				[
					{ name: 'actor A deposits in first pool', execute: async () => await depositRep(actorA, firstPoolAddresses.securityPool, repDeposit) },
					{ name: 'actor B deposits in first pool', execute: async () => await depositRep(actorB, firstPoolAddresses.securityPool, repDeposit) },
					{ name: 'creator deposits in second pool', execute: async () => await depositRep(client, secondPoolAddresses.securityPool, repDeposit) },
					{ name: 'actor A deposits in second pool', execute: async () => await depositRep(actorA, secondPoolAddresses.securityPool, repDeposit) },
					{ name: 'actor B deposits in second pool', execute: async () => await depositRep(actorB, secondPoolAddresses.securityPool, repDeposit) },
					{ name: 'actor C deposits in first pool', execute: async () => await depositRep(actorC, firstPoolAddresses.securityPool, repDeposit / 2n) },
					{ name: 'actor C deposits in second pool', execute: async () => await depositRep(actorC, secondPoolAddresses.securityPool, repDeposit / 3n) },
					{
						name: 'actor A bids during pool deposits',
						execute: async () => {
							actorAAuctionTick = await participateAuction(actorA, accountingAuction, 60n * 10n ** 18n, 60n * 10n ** 18n)
						},
					},
					{
						name: 'actor B bids during pool deposits',
						execute: async () => {
							actorBAuctionTick = await participateAuction(actorB, accountingAuction, 40n * 10n ** 18n, 60n * 10n ** 18n)
						},
					},
				],
				seed,
			)
			for (const action of depositActions) {
				await runAction(action.name, action.execute)
				await assertPoolAccounting(firstPoolAddresses.securityPool, `${action.name}, first pool`)
				await assertPoolAccounting(secondPoolAddresses.securityPool, `${action.name}, second pool`)
				await assertParentSupplyAccounting(action.name)
			}

			const allowanceActions = shuffle(
				[
					{
						name: 'creator sets first-pool allowance',
						execute: async () => await manipulatePriceOracleAndPerformOperation(client, mockWindow, firstPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 3n),
					},
					{
						name: 'actor A sets first-pool allowance',
						execute: async () => await manipulatePriceOracleAndPerformOperation(actorA, mockWindow, firstPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, actorA.account.address, repDeposit / 5n),
					},
					{
						name: 'creator sets second-pool allowance',
						execute: async () => await manipulatePriceOracleAndPerformOperation(client, mockWindow, secondPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n),
					},
					{
						name: 'actor B sets second-pool allowance',
						execute: async () => await manipulatePriceOracleAndPerformOperation(actorB, mockWindow, secondPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, actorB.account.address, repDeposit / 6n),
					},
				],
				seed ^ 0xa110aacen,
			)
			for (const action of allowanceActions) {
				await runAction(action.name, action.execute)
				await assertPoolAccounting(firstPoolAddresses.securityPool, `${action.name}, first pool`)
				await assertPoolAccounting(secondPoolAddresses.securityPool, `${action.name}, second pool`)
				await assertParentSupplyAccounting(action.name)
			}

			const openInterestActions = shuffle(
				[
					{ name: 'actor B opens first-pool complete sets', execute: async () => await createCompleteSet(actorB, firstPoolAddresses.securityPool, 20n * 10n ** 18n) },
					{ name: 'actor C opens first-pool complete sets', execute: async () => await createCompleteSet(actorC, firstPoolAddresses.securityPool, 15n * 10n ** 18n) },
					{ name: 'actor A opens second-pool complete sets', execute: async () => await createCompleteSet(actorA, secondPoolAddresses.securityPool, 25n * 10n ** 18n) },
					{ name: 'actor C opens second-pool complete sets', execute: async () => await createCompleteSet(actorC, secondPoolAddresses.securityPool, 10n * 10n ** 18n) },
				],
				seed ^ 0xc011a7n,
			)
			for (const action of openInterestActions) {
				await runAction(action.name, action.execute)
				await assertPoolAccounting(firstPoolAddresses.securityPool, `${action.name}, first pool`)
				await assertPoolAccounting(secondPoolAddresses.securityPool, `${action.name}, second pool`)
				await assertParentSupplyAccounting(action.name)
			}

			await runAction('advance target question to reporting', async () => await mockWindow.setTime(context.questionEndDate + 1n))
			await runAction('refresh first-pool price for escalation', async () => await manipulatePriceOracleAndPerformOperation(client, mockWindow, firstPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 3n))
			const escalationActions = shuffle(
				[
					{ name: 'actor A escrows first-pool REP on yes', execute: async () => await depositToEscalationGame(actorA, firstPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 10n) },
					{ name: 'actor B escrows first-pool REP on no', execute: async () => await depositToEscalationGame(actorB, firstPoolAddresses.securityPool, QuestionOutcome.No, repDeposit / 10n) },
				],
				seed ^ 0xe5ca1a7en,
			)
			for (const action of escalationActions) {
				await runAction(action.name, action.execute)
				await assertPoolAccounting(firstPoolAddresses.securityPool, action.name)
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: firstPoolAddresses.escalationGame, label: `${action.name}, parent escalation`, repToken: parentRepToken, securityPool: firstPoolAddresses.securityPool })
				await assertParentSupplyAccounting(action.name)
			}
			const actorAEscrowAtFork = (await getSecurityVault(client, firstPoolAddresses.securityPool, actorA.account.address)).repInEscalationGame
			const actorBEscrowAtFork = (await getSecurityVault(client, firstPoolAddresses.securityPool, actorB.account.address)).repInEscalationGame
			assert.ok(actorAEscrowAtFork > 0n, 'actor A should have unresolved escrow before the fork')
			assert.ok(actorBEscrowAtFork > 0n, 'actor B should have unresolved escrow before the fork')
			const parentYesDepositsAtFork = await getEscalationGameDeposits(client, firstPoolAddresses.escalationGame, QuestionOutcome.Yes)
			const parentNoDepositsAtFork = await getEscalationGameDeposits(client, firstPoolAddresses.escalationGame, QuestionOutcome.No)
			if (actorAAuctionTick === undefined || actorBAuctionTick === undefined) throw new Error('seeded auction bids were not executed')
			const actorATick = actorAAuctionTick
			const actorBTick = actorBAuctionTick
			await runAction('finalize interleaved accounting auction', async () => await finalizeAuction(client, accountingAuction))
			const auctionBalanceBeforeClaims = await getETHBalance(client, accountingAuction)
			const actorAEthBeforeClaims = await getETHBalance(client, actorA.account.address)
			const actorBEthBeforeClaims = await getETHBalance(client, actorB.account.address)
			const auctionClaimActions = shuffle(
				[
					{ name: 'actor A claims interleaved auction', execute: async () => await withdrawBids(client, accountingAuction, actorA.account.address, [{ tick: actorATick, bidIndex: 0n }]) },
					{ name: 'actor B claims interleaved auction', execute: async () => await withdrawBids(client, accountingAuction, actorB.account.address, [{ tick: actorBTick, bidIndex: 0n }]) },
				],
				seed ^ 0xa0c710n,
			)
			for (const action of auctionClaimActions) {
				await runAction(action.name, action.execute)
				await assertParentSupplyAccounting(action.name)
			}
			const bidderClaimDelta = (await getETHBalance(client, actorA.account.address)) - actorAEthBeforeClaims + ((await getETHBalance(client, actorB.account.address)) - actorBEthBeforeClaims)
			strictEqualTypeSafe(bidderClaimDelta, auctionBalanceBeforeClaims - (await getETHBalance(client, accountingAuction)), 'interleaved bidder payouts must reconcile to the auction ETH decrease')
			await assert.rejects(withdrawBids(client, accountingAuction, actorA.account.address, [{ tick: actorATick, bidIndex: 0n }]), /already been claimed/i)

			await runAction('fork shared universe and freeze first pool', async () => await triggerExternalForkForSecurityPool(createClient(5), `stateful seed ${seed.toString()}`))
			await assertParentSupplyAccounting('shared universe fork')
			await runAction('freeze second pool', async () => await initiateSecurityPoolFork(client, secondPoolAddresses.securityPool))
			await assertParentSupplyAccounting('second pool fork initiation')
			strictEqualTypeSafe(await getSystemState(client, firstPoolAddresses.securityPool), SystemState.PoolForked, 'first parent pool should be forked')
			strictEqualTypeSafe(await getSystemState(client, secondPoolAddresses.securityPool), SystemState.PoolForked, 'second parent pool should be forked')

			await runAction('create first-pool yes child', async () => await createChildUniverse(client, firstPoolAddresses.securityPool, QuestionOutcome.Yes))
			await runAction('create second-pool yes child', async () => await createChildUniverse(client, secondPoolAddresses.securityPool, QuestionOutcome.Yes))
			const yesUniverse = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
			const yesRepToken = getRepTokenAddress(yesUniverse)
			const firstYesPoolAddresses = getSecurityPoolAddresses(firstPoolAddresses.securityPool, yesUniverse, context.questionId, securityMultiplier)
			const secondYesPoolAddresses = getSecurityPoolAddresses(secondPoolAddresses.securityPool, yesUniverse, context.questionId, secondSecurityMultiplier)
			const firstYesPool = firstYesPoolAddresses.securityPool
			const secondYesPool = secondYesPoolAddresses.securityPool
			const parentSupplyAfterLocking = await getUniverseTheoreticalSupply(client, genesisUniverse)
			const burnBalanceAfterLocking = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))

			const migrationActions = shuffle(
				[
					{ name: 'split first-pool REP to yes', execute: async () => await migrateRepToZoltar(client, firstPoolAddresses.securityPool, [QuestionOutcome.Yes]) },
					{ name: 'repeat first-pool REP split', execute: async () => await migrateRepToZoltar(actorC, firstPoolAddresses.securityPool, [QuestionOutcome.Yes]) },
					{ name: 'migrate creator from first pool', execute: async () => await migrateVault(client, firstPoolAddresses.securityPool, QuestionOutcome.Yes) },
					{ name: 'migrate actor A and unresolved first-pool escrow', execute: async () => await migrateVaultWithUnresolvedEscalation(actorA, firstPoolAddresses.securityPool, actorA.account.address, QuestionOutcome.Yes) },
					{ name: 'migrate actor B and unresolved first-pool escrow', execute: async () => await migrateVaultWithUnresolvedEscalation(actorB, firstPoolAddresses.securityPool, actorB.account.address, QuestionOutcome.Yes) },
					{ name: 'split second-pool REP to yes', execute: async () => await migrateRepToZoltar(client, secondPoolAddresses.securityPool, [QuestionOutcome.Yes]) },
					{ name: 'repeat second-pool REP split', execute: async () => await migrateRepToZoltar(actorC, secondPoolAddresses.securityPool, [QuestionOutcome.Yes]) },
					{ name: 'migrate creator from second pool', execute: async () => await migrateVault(client, secondPoolAddresses.securityPool, QuestionOutcome.Yes) },
					{ name: 'migrate actor A from second pool', execute: async () => await migrateVault(actorA, secondPoolAddresses.securityPool, QuestionOutcome.Yes) },
					{ name: 'migrate actor B from second pool', execute: async () => await migrateVault(actorB, secondPoolAddresses.securityPool, QuestionOutcome.Yes) },
				],
				seed ^ 0xf07cn,
			)
			for (const action of migrationActions) {
				await runAction(action.name, action.execute)
				strictEqualTypeSafe(await getUniverseTheoreticalSupply(client, genesisUniverse), parentSupplyAfterLocking, `${action.name}: child migration must not burn parent REP again`)
				strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS)), burnBalanceAfterLocking, `${action.name}: child migration must not move parent REP after locking`)
				assert.ok((await getERC20Balance(client, yesRepToken, firstYesPool)) <= (await getSecurityPoolForkerForkData(client, firstPoolAddresses.securityPool)).auctionableRepAtFork, `${action.name}: first child pool mint must stay backed by its fork balance`)
				assert.ok((await getERC20Balance(client, yesRepToken, secondYesPool)) <= (await getSecurityPoolForkerForkData(client, secondPoolAddresses.securityPool)).auctionableRepAtFork, `${action.name}: second child pool mint must stay backed by its fork balance`)
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: firstPoolAddresses.escalationGame, label: `${action.name}, parent escalation`, repToken: parentRepToken, securityPool: firstPoolAddresses.securityPool })
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: firstYesPoolAddresses.escalationGame, label: `${action.name}, child escalation`, repToken: yesRepToken, securityPool: firstYesPool })
			}

			for (const [parentPool, childPool, vaultClients] of [
				[firstPoolAddresses.securityPool, firstYesPool, [client, actorA, actorB]],
				[secondPoolAddresses.securityPool, secondYesPool, [client, actorA, actorB]],
			] as const) {
				for (const vaultClient of vaultClients) {
					strictEqualTypeSafe((await getSecurityVault(client, parentPool, vaultClient.account.address)).repDepositShare, 0n, 'migrated parent ownership should be consumed exactly once')
					assert.ok((await getSecurityVault(client, childPool, vaultClient.account.address)).repDepositShare > 0n, 'migrated child vault should receive ownership')
				}
			}
			strictEqualTypeSafe((await getSecurityVault(client, firstPoolAddresses.securityPool, actorA.account.address)).repInEscalationGame, 0n, 'actor A parent escrow entitlement should be consumed exactly once')
			strictEqualTypeSafe((await getSecurityVault(client, firstPoolAddresses.securityPool, actorB.account.address)).repInEscalationGame, 0n, 'actor B parent escrow entitlement should be consumed exactly once')
			const actorAChildEscrow = (await getSecurityVault(client, firstYesPool, actorA.account.address)).repInEscalationGame
			const actorBChildEscrow = (await getSecurityVault(client, firstYesPool, actorB.account.address)).repInEscalationGame
			strictEqualTypeSafe(actorAChildEscrow, 0n, 'actor A should not need a per-vault child escrow lock')
			strictEqualTypeSafe(actorBChildEscrow, 0n, 'actor B should not need a per-vault child escrow lock')
			const actorAChildSourcePrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, firstYesPool, QuestionOutcome.Yes, actorA.account.address)
			const actorBChildSourcePrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, firstYesPool, QuestionOutcome.No, actorB.account.address)
			strictEqualTypeSafe(actorAChildSourcePrincipal, 0n, 'actor A principal should remain in aggregate carry rather than per-vault escrow')
			strictEqualTypeSafe(actorBChildSourcePrincipal, 0n, 'actor B principal should remain in aggregate carry rather than per-vault escrow')
			strictEqualTypeSafe(await getForkedEscrowChildRepByOutcomeAndVault(client, firstYesPool, QuestionOutcome.Yes, actorA.account.address), 0n, 'actor A should not receive separate child REP backing')
			strictEqualTypeSafe(await getForkedEscrowChildRepByOutcomeAndVault(client, firstYesPool, QuestionOutcome.No, actorB.account.address), 0n, 'actor B should not receive separate child REP backing')
			const childYesState = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: firstYesPoolAddresses.escalationGame,
				functionName: 'getOutcomeState',
				args: [QuestionOutcome.Yes],
			})
			const childNoState = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: firstYesPoolAddresses.escalationGame,
				functionName: 'getOutcomeState',
				args: [QuestionOutcome.No],
			})
			assert.ok(childYesState.currentCarryTotal >= actorAEscrowAtFork, 'aggregate Yes carry should preserve actor A fork-time principal')
			assert.ok(childNoState.currentCarryTotal >= actorBEscrowAtFork, 'aggregate No carry should preserve actor B fork-time principal')
			assert.deepStrictEqual(await getEscalationGameDeposits(client, firstPoolAddresses.escalationGame, QuestionOutcome.Yes), parentYesDepositsAtFork, 'exported parent Yes deposits should remain in the immutable proof commitment')
			assert.deepStrictEqual(await getEscalationGameDeposits(client, firstPoolAddresses.escalationGame, QuestionOutcome.No), parentNoDepositsAtFork, 'exported parent No deposits should remain in the immutable proof commitment')
			strictEqualTypeSafe((await getEscalationGameDeposits(client, firstYesPoolAddresses.escalationGame, QuestionOutcome.Yes)).length, 0, 'child escalation should carry parent Yes escrow without replaying local deposits')
			strictEqualTypeSafe((await getEscalationGameDeposits(client, firstYesPoolAddresses.escalationGame, QuestionOutcome.No)).length, 0, 'child escalation should carry parent No escrow without replaying local deposits')

			await mockWindow.anvilRevert(currentSeedBaseline)
			currentSeedBaseline = await mockWindow.anvilSnapshot()
		}
	})

	test('model-backed action handler preserves accounting across adversarial lifecycle interleavings', async () => {
		const handlerBaseline = await mockWindow.anvilSnapshot()
		let currentHandlerBaseline = handlerBaseline
		const parentRepToken = getRepTokenAddress(genesisUniverse)
		const secondSecurityMultiplier = 3n
		const configuredSeed = process.env['ZOLTAR_INVARIANT_SEED']
		const seeds = configuredSeed === undefined ? [0xa11ce5n, 0xbadc0den, 0xdecafbadn] : [BigInt(configuredSeed)]

		for (const seed of seeds) {
			const trace: string[] = []
			const completed = new Set<string>()
			let randomState = seed & ((1n << 64n) - 1n)
			const nextRandom = () => {
				randomState = (randomState * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
				return randomState
			}
			const failWithTrace = (error: unknown): never => {
				const message = error instanceof Error ? error.message : String(error)
				throw new Error(`Adversarial invariant seed ${seed.toString()} failed after ${trace.join(' -> ')}: ${message}`, { cause: error })
			}

			await deployOriginSecurityPool(client, genesisUniverse, context.questionId, secondSecurityMultiplier)
			const firstPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier)
			const secondPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, secondSecurityMultiplier)
			const yesUniverse = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
			const firstYesPoolAddresses = getSecurityPoolAddresses(firstPool.securityPool, yesUniverse, context.questionId, securityMultiplier)
			const secondYesPoolAddresses = getSecurityPoolAddresses(secondPool.securityPool, yesUniverse, context.questionId, secondSecurityMultiplier)
			const secondYesPool = secondYesPoolAddresses.securityPool
			const secondYesRepToken = getRepTokenAddress(yesUniverse)
			const actorA = createClient(1)
			const actorB = createClient(2)
			const actorC = createClient(3)
			const actors = [client, actorA, actorB, actorC]
			for (const actor of actors) {
				await approveToken(actor, parentRepToken, firstPool.securityPool)
				await approveToken(actor, parentRepToken, secondPool.securityPool)
			}
			await deployUniformPriceDualCapBatchAuction(client, client.account.address)
			const accountingAuction = getUniformPriceDualCapBatchAuctionAddress(client.account.address)

			const parentSupplyAtStart = await getUniverseTheoreticalSupply(client, genesisUniverse)
			const burnBalanceAtStart = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))
			const forkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
			let actorAAuctionTick: bigint | undefined
			let actorBAuctionTick: bigint | undefined
			let actorAFirstEscrowSourceAtFork = 0n

			const assertPoolAccounting = async (securityPool: Address, label: string) => {
				const activeVaultCount = await getActiveVaultCount(client, securityPool)
				const activeVaults = await getActiveVaults(client, securityPool, 0n, activeVaultCount + 1n)
				const vaults = await Promise.all(activeVaults.map(vault => getSecurityVault(client, securityPool, vault)))
				const aggregateAllowance = vaults.reduce((sum, vault) => sum + vault.securityBondAllowance, 0n)
				const aggregateOwnership = vaults.reduce((sum, vault) => sum + vault.repDepositShare, 0n)
				const totalRep = await getTotalRepBalance(client, securityPool)
				const roundedClaims = (await Promise.all(vaults.map(vault => poolOwnershipToRep(client, securityPool, vault.repDepositShare)))).reduce((sum, claim) => sum + claim, 0n)
				const collateral = await getCompleteSetCollateralAmount(client, securityPool)
				const feesOwed = await getTotalFeesOwedToVaults(client, securityPool)
				const systemState = await getSystemState(client, securityPool)
				strictEqualTypeSafe(BigInt(activeVaults.length), activeVaultCount, `${label}: active vault page should match count`)
				const totalAllowance = await getTotalSecurityBondAllowance(client, securityPool)
				if (systemState === SystemState.PoolForked) assert.ok(aggregateAllowance <= totalAllowance, `${label}: consumed fork allowances cannot exceed the frozen allowance snapshot`)
				else strictEqualTypeSafe(aggregateAllowance, totalAllowance, `${label}: allowances should reconcile`)
				const ownershipDenominator = await getPoolOwnershipDenominator(client, securityPool)
				if (systemState === SystemState.PoolForked) assert.ok(aggregateOwnership <= ownershipDenominator, `${label}: consumed fork entitlements cannot exceed the frozen ownership snapshot`)
				else strictEqualTypeSafe(aggregateOwnership, ownershipDenominator, `${label}: ownership should reconcile`)
				strictEqualTypeSafe(await getERC20Balance(client, parentRepToken, securityPool), totalRep, `${label}: REP balance should reconcile`)
				assert.ok(roundedClaims <= totalRep, `${label}: rounded claims cannot exceed pool REP`)
				assert.ok(totalRep - roundedClaims <= activeVaultCount, `${label}: REP rounding dust should be bounded`)
				assert.ok(collateral + feesOwed <= (await getETHBalance(client, securityPool)), `${label}: ETH obligations should remain backed`)
				assert.ok(totalAllowance >= collateral, `${label}: open interest should remain allowance-backed`)
			}

			const readModelSnapshot = async () => ({
				burnBalance: await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS)),
				firstPool: await readPoolAccountingSnapshot(client, firstPool.securityPool),
				firstVaults: await Promise.all(actors.map(actor => getSecurityVault(client, firstPool.securityPool, actor.account.address))),
				parentSupply: await getUniverseTheoreticalSupply(client, genesisUniverse),
				secondPool: await readPoolAccountingSnapshot(client, secondPool.securityPool),
				secondVaults: await Promise.all(actors.map(actor => getSecurityVault(client, secondPool.securityPool, actor.account.address))),
			})
			const readSecondChildEntitlementSnapshot = async () => ({
				childForkData: await getSecurityPoolForkerForkData(client, secondYesPool),
				childPool: await readPoolAccountingSnapshot(client, secondYesPool),
				childRepTokenBalance: await getERC20Balance(client, secondYesRepToken, secondYesPool),
				childVault: await getSecurityVault(client, secondYesPool, actorA.account.address),
				parentForkData: await getSecurityPoolForkerForkData(client, secondPool.securityPool),
			})

			const assertGlobalAccounting = async (label: string) => {
				strictEqualTypeSafe(parentSupplyAtStart - (await getUniverseTheoreticalSupply(client, genesisUniverse)), (await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))) - burnBalanceAtStart, `${label}: theoretical supply reduction should equal intentional burns`)
				await assertPoolAccounting(firstPool.securityPool, `${label}, first pool`)
				await assertPoolAccounting(secondPool.securityPool, `${label}, second pool`)
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: firstPool.escalationGame, label: `${label}, first parent escalation`, repToken: parentRepToken, securityPool: firstPool.securityPool })
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: secondPool.escalationGame, label: `${label}, second parent escalation`, repToken: parentRepToken, securityPool: secondPool.securityPool })
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: firstYesPoolAddresses.escalationGame, label: `${label}, first child escalation`, repToken: secondYesRepToken, securityPool: firstYesPoolAddresses.securityPool })
				await assertSecurityPoolEscrowAccounting({ actors, escalationGame: secondYesPoolAddresses.escalationGame, label: `${label}, second child escalation`, repToken: secondYesRepToken, securityPool: secondYesPool })
			}

			type HandlerAction = {
				name: string
				enabled: () => boolean
				execute: () => Promise<unknown>
			}
			const actions: HandlerAction[] = [
				{
					name: 'start independent auction',
					enabled: () => true,
					execute: async () => await startAuction(client, accountingAuction, 100n * 10n ** 18n, 100n * 10n ** 18n),
				},
				{
					name: 'premature vault migration is atomic',
					enabled: () => true,
					execute: async () => {
						const before = await readModelSnapshot()
						await assert.rejects(migrateVault(actorA, firstPool.securityPool, QuestionOutcome.Yes), /Parent not forked/)
						assert.deepStrictEqual(await readModelSnapshot(), before, 'failed pre-fork migration should preserve the complete accounting model')
					},
				},
				{
					name: 'creator funds own-fork capacity',
					enabled: () => true,
					execute: async () => await depositRep(client, firstPool.securityPool, 2n * forkThreshold + repDeposit),
				},
				{
					name: 'actor A deposits first pool',
					enabled: () => true,
					execute: async () => await depositRep(actorA, firstPool.securityPool, repDeposit),
				},
				{
					name: 'actor B deposits first pool',
					enabled: () => true,
					execute: async () => await depositRep(actorB, firstPool.securityPool, repDeposit * 2n),
				},
				{
					name: 'actor A deposits second pool',
					enabled: () => true,
					execute: async () => await depositRep(actorA, secondPool.securityPool, repDeposit),
				},
				{
					name: 'actor B deposits second pool',
					enabled: () => true,
					execute: async () => await depositRep(actorB, secondPool.securityPool, repDeposit),
				},
				{
					name: 'actor C deposits withdrawable REP',
					enabled: () => true,
					execute: async () => await depositRep(actorC, secondPool.securityPool, repDeposit),
				},
				{
					name: 'actor A sets liquidatable allowance',
					enabled: () => completed.has('actor A deposits first pool'),
					execute: async () => await manipulatePriceOracleAndPerformOperation(actorA, mockWindow, firstPool.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, actorA.account.address, 75n * 10n ** 18n),
				},
				{
					name: 'actor B opens first-pool interest',
					enabled: () => completed.has('actor A sets liquidatable allowance'),
					execute: async () => await createCompleteSet(actorB, firstPool.securityPool, 50n * 10n ** 18n),
				},
				{
					name: 'actor C withdraws before fork',
					enabled: () => completed.has('actor C deposits withdrawable REP'),
					execute: async () => await manipulatePriceOracleAndPerformOperation(actorC, mockWindow, secondPool.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, actorC.account.address, repDeposit),
				},
				{
					name: 'self-liquidation is consumed atomically',
					enabled: () => completed.has('actor B opens first-pool interest'),
					execute: async () => {
						const before = await readModelSnapshot()
						await assert.rejects(queueLiquidationAtForcedPrice(actorA, firstPool.priceOracleManagerAndOperatorQueuer, actorA.account.address, 10n * 10n ** 18n, 10n * 10n ** 18n), /Caller bad/)
						assert.deepStrictEqual(await readModelSnapshot(), before, 'rejected self-liquidation should preserve the complete accounting model')
					},
				},
				{
					name: 'actor B liquidates actor A',
					enabled: () => completed.has('self-liquidation is consumed atomically') && completed.has('actor B deposits first pool'),
					execute: async () => {
						await queueLiquidationAtForcedPrice(actorB, firstPool.priceOracleManagerAndOperatorQueuer, actorA.account.address, 25n * 10n ** 18n, 10n * 10n ** 18n)
						await handleOracleReporting(actorB, mockWindow, firstPool.priceOracleManagerAndOperatorQueuer, 10n * 10n ** 18n)
					},
				},
				{
					name: 'actor A bids before lifecycle fork',
					enabled: () => completed.has('start independent auction'),
					execute: async () => {
						actorAAuctionTick = await participateAuction(actorA, accountingAuction, 60n * 10n ** 18n, 60n * 10n ** 18n)
					},
				},
				{
					name: 'actor B bids before lifecycle fork',
					enabled: () => completed.has('start independent auction'),
					execute: async () => {
						actorBAuctionTick = await participateAuction(actorB, accountingAuction, 40n * 10n ** 18n, 60n * 10n ** 18n)
					},
				},
				{
					name: 'advance into reporting',
					enabled: () => ['creator funds own-fork capacity', 'actor B liquidates actor A', 'actor C withdraws before fork', 'actor A bids before lifecycle fork', 'actor B bids before lifecycle fork'].every(name => completed.has(name)),
					execute: async () => await mockWindow.setTime(context.questionEndDate + 1n),
				},
				{
					name: 'refresh first-pool reporting price',
					enabled: () => completed.has('advance into reporting'),
					execute: async () => {
						const actorAVault = await getSecurityVault(client, firstPool.securityPool, actorA.account.address)
						await manipulatePriceOracleAndPerformOperation(actorA, mockWindow, firstPool.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, actorA.account.address, actorAVault.securityBondAllowance)
					},
				},
				{
					name: 'actor A reports yes',
					enabled: () => completed.has('refresh first-pool reporting price'),
					execute: async () => {
						await depositToEscalationGame(actorA, firstPool.securityPool, QuestionOutcome.Yes, 10n * 10n ** 18n)
						actorAFirstEscrowSourceAtFork = (await getSecurityVault(client, firstPool.securityPool, actorA.account.address)).repInEscalationGame
					},
				},
				{
					name: 'own escalation triggers universe fork',
					enabled: () => completed.has('actor A reports yes'),
					execute: async () => await triggerOwnGameFork(client, firstPool.securityPool),
				},
				{
					name: 'freeze second pool after universe fork',
					enabled: () => completed.has('own escalation triggers universe fork'),
					execute: async () => await initiateSecurityPoolFork(client, secondPool.securityPool),
				},
				{
					name: 'finalize independent auction',
					enabled: () => completed.has('advance into reporting'),
					execute: async () => await finalizeAuction(client, accountingAuction),
				},
				{
					name: 'actor A claims auction',
					enabled: () => completed.has('finalize independent auction') && actorAAuctionTick !== undefined,
					execute: async () => await withdrawBids(client, accountingAuction, actorA.account.address, [{ tick: ensureDefined(actorAAuctionTick, 'actor A tick missing'), bidIndex: 0n }]),
				},
				{
					name: 'actor A double claim is atomic',
					enabled: () => completed.has('actor A claims auction') && actorAAuctionTick !== undefined,
					execute: async () => {
						const before = await readModelSnapshot()
						const auctionBalanceBefore = await getETHBalance(client, accountingAuction)
						await assert.rejects(withdrawBids(client, accountingAuction, actorA.account.address, [{ tick: ensureDefined(actorAAuctionTick, 'actor A tick missing'), bidIndex: 0n }]), /already been claimed/i)
						assert.deepStrictEqual(await readModelSnapshot(), before, 'double claim should preserve pool and supply accounting')
						strictEqualTypeSafe(await getETHBalance(client, accountingAuction), auctionBalanceBefore, 'double claim should preserve auction escrow')
					},
				},
				{
					name: 'actor B claims auction',
					enabled: () => completed.has('finalize independent auction') && actorBAuctionTick !== undefined,
					execute: async () => await withdrawBids(client, accountingAuction, actorB.account.address, [{ tick: ensureDefined(actorBAuctionTick, 'actor B tick missing'), bidIndex: 0n }]),
				},
				{
					name: 'create first yes child',
					enabled: () => completed.has('own escalation triggers universe fork'),
					execute: async () => await createChildUniverse(client, firstPool.securityPool, QuestionOutcome.Yes),
				},
				{
					name: 'create second yes child',
					enabled: () => completed.has('freeze second pool after universe fork'),
					execute: async () => await createChildUniverse(client, secondPool.securityPool, QuestionOutcome.Yes),
				},
				{
					name: 'split first pool REP',
					enabled: () => completed.has('create first yes child'),
					execute: async () => await migrateRepToZoltar(client, firstPool.securityPool, [QuestionOutcome.Yes]),
				},
				{
					name: 'split second pool REP',
					enabled: () => completed.has('create second yes child'),
					execute: async () => await migrateRepToZoltar(client, secondPool.securityPool, [QuestionOutcome.Yes]),
				},
				{
					name: 'migrate creator unresolved first vault',
					enabled: () => completed.has('split first pool REP'),
					execute: async () => await migrateVaultWithUnresolvedEscalation(client, firstPool.securityPool, client.account.address, QuestionOutcome.Yes),
				},
				{
					name: 'migrate actor A unresolved first vault',
					enabled: () => completed.has('split first pool REP'),
					execute: async () => await migrateVaultWithUnresolvedEscalation(actorA, firstPool.securityPool, actorA.account.address, QuestionOutcome.Yes),
				},
				{
					name: 'migrate actor A second vault',
					enabled: () => completed.has('split second pool REP'),
					execute: async () => await migrateVault(actorA, secondPool.securityPool, QuestionOutcome.Yes),
				},
				{
					name: 'repeat second vault migration is atomic',
					enabled: () => completed.has('migrate actor A second vault'),
					execute: async () => {
						const parentBefore = await readModelSnapshot()
						const childBefore = await readSecondChildEntitlementSnapshot()
						await migrateVault(actorA, secondPool.securityPool, QuestionOutcome.Yes)
						assert.deepStrictEqual(await readModelSnapshot(), parentBefore, 'repeated migration should not recreate a parent entitlement')
						assert.deepStrictEqual(await readSecondChildEntitlementSnapshot(), childBefore, 'repeated migration should not duplicate child ownership, allowance, REP, or migrated allocation')
					},
				},
			]
			const requiredTerminalActions = ['actor A double claim is atomic', 'actor B claims auction', 'migrate creator unresolved first vault', 'migrate actor A unresolved first vault', 'repeat second vault migration is atomic']

			for (let step = 0; step < 100 && !requiredTerminalActions.every(name => completed.has(name)); step += 1) {
				const enabledActions = actions.filter(action => !completed.has(action.name) && action.enabled())
				if (enabledActions.length === 0) failWithTrace(new Error('action handler reached a nonterminal dead end'))
				const action = enabledActions[Number(nextRandom() % BigInt(enabledActions.length))]
				if (action === undefined) failWithTrace(new Error('seed selected an unavailable action'))
				trace.push(action.name)
				try {
					await action.execute()
					completed.add(action.name)
					await assertGlobalAccounting(action.name)
				} catch (error) {
					failWithTrace(error)
				}
			}
			assert.ok(
				requiredTerminalActions.every(name => completed.has(name)),
				`seed ${seed.toString()} should reach every terminal entitlement`,
			)
			assert.ok(trace.indexOf('finalize independent auction') < trace.indexOf('migrate actor A unresolved first vault') || trace.indexOf('finalize independent auction') < trace.indexOf('migrate actor A second vault'), 'independent auction actions should cross lifecycle action classes')
			strictEqualTypeSafe(await getSystemState(client, firstPool.securityPool), SystemState.PoolForked, 'own-fork parent should remain frozen')
			strictEqualTypeSafe(await getSystemState(client, secondPool.securityPool), SystemState.PoolForked, 'external parent should remain frozen')

			const firstYesPool = firstYesPoolAddresses.securityPool
			assert.ok((await getSecurityVault(client, firstYesPool, client.account.address)).repDepositShare > 0n, 'creator ownership should migrate to own-fork child')
			const actorAChildVault = await getSecurityVault(client, firstYesPool, actorA.account.address)
			strictEqualTypeSafe(actorAChildVault.repInEscalationGame, 0n, 'actor A should not need a per-vault own-fork child escrow lock')
			strictEqualTypeSafe((await getSecurityVault(client, firstPool.securityPool, actorA.account.address)).repInEscalationGame, 0n, 'actor A source escrow should be consumed from the parent exactly once')
			const actorAChildSourcePrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, firstYesPool, QuestionOutcome.Yes, actorA.account.address)
			const actorAChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, firstYesPool, QuestionOutcome.Yes, actorA.account.address)
			strictEqualTypeSafe(actorAChildSourcePrincipal, 0n, 'handler should retain actor A principal in aggregate carry')
			strictEqualTypeSafe(actorAChildRep, 0n, 'handler should not create separate actor A child REP backing')
			const actorACarryState = await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: firstYesPoolAddresses.escalationGame,
				functionName: 'getOutcomeState',
				args: [QuestionOutcome.Yes],
			})
			assert.ok(actorACarryState.currentCarryTotal >= actorAFirstEscrowSourceAtFork, 'handler aggregate carry should preserve actor A fork-time principal')
			const actorAParentYesDeposits = (await getEscalationGameDeposits(client, firstPool.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === actorA.account.address)
			strictEqualTypeSafe(actorAParentYesDeposits.length, 1, 'handler should preserve one immutable parent Yes deposit commitment for actor A')
			strictEqualTypeSafe(ensureDefined(actorAParentYesDeposits[0], 'handler parent Yes deposit is missing').amount, actorAFirstEscrowSourceAtFork, 'handler parent deposit commitment should preserve the exact source principal')
			strictEqualTypeSafe((await getEscalationGameDeposits(client, firstYesPoolAddresses.escalationGame, QuestionOutcome.Yes)).length, 0, 'handler child should carry escrow without replaying it as a local deposit')
			assert.ok((await getSecurityVault(client, secondYesPool, actorA.account.address)).repDepositShare > 0n, 'actor A ownership should migrate to external-fork child')
			strictEqualTypeSafe((await getSecurityVault(client, secondPool.securityPool, actorA.account.address)).repDepositShare, 0n, 'second parent entitlement should be consumed once')

			await mockWindow.anvilRevert(currentHandlerBaseline)
			currentHandlerBaseline = await mockWindow.anvilSnapshot()
		}
	})

	test('positive-value mint fuzzing always returns shares and preserves unsolicited ETH surplus', async () => {
		const priceOracle = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n)
		const forcedSurplus = 17n * 10n ** 18n + 3n
		await mockWindow.setBalance(context.securityPool, (await getETHBalance(client, context.securityPool)) + forcedSurplus)

		let state = 0x51a2e5n
		const nextMintAmount = () => {
			state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
			return (state % (3n * 10n ** 18n)) + 1n
		}
		const mintAmounts = [1n, 10n ** 9n, 10n ** 15n, 1n * 10n ** 18n, nextMintAmount(), nextMintAmount(), nextMintAmount()]
		const minter = createClient(2)

		for (const mintAmount of mintAmounts) {
			const nominalSupplyBefore = await getShareTokenSupply(client, context.securityPool)
			await createCompleteSet(minter, context.securityPool, mintAmount)
			const nominalSupplyAfter = await getShareTokenSupply(client, context.securityPool)
			assert.ok(nominalSupplyAfter > nominalSupplyBefore, `successful positive mint must issue nonzero shares for ${mintAmount.toString()} wei`)

			const accountedEth = (await getCompleteSetCollateralAmount(client, context.securityPool)) + (await getTotalAccruedFees(client, context.securityPool))
			strictEqualTypeSafe((await getETHBalance(client, context.securityPool)) - accountedEth, forcedSurplus, 'mint and fee accounting must leave unsolicited ETH in a separate invariant surplus bucket')
		}
	})

	test.each([
		{ path: 'external', seed: 0xe71e2a1n },
		{ path: 'own', seed: 0x0a11f04bn },
	] as const)('stateful $path-fork lifecycle fuzzing reaches a consistent reactivated child', async ({ path, seed }) => {
		const parentAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier)
		const allowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, parentAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, allowance)
		const shareHolder = createClient(2)
		const mintAmount = (seed % (5n * 10n ** 18n)) + 1n * 10n ** 18n
		await createCompleteSet(shareHolder, context.securityPool, mintAmount)
		strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.Operational, 'lifecycle should begin operational')

		if (path === 'own') {
			await mockWindow.setTime(context.questionEndDate + 1n)
			await manipulatePriceOracle(client, mockWindow, parentAddresses.priceOracleManagerAndOperatorQueuer)
			const forkThreshold = (await getZoltarForkThreshold(client, genesisUniverse)) / securityMultiplier
			await depositRep(client, context.securityPool, 2n * forkThreshold)
			await triggerOwnGameFork(client, context.securityPool)
		} else {
			await triggerExternalForkForSecurityPool(undefined, 'stateful lifecycle fork source')
		}
		strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.PoolForked, 'forking should freeze the parent pool')
		await createChildUniverse(client, context.securityPool, QuestionOutcome.Yes)

		const migrationActions = shuffle(['invalid-shares', 'yes-shares', 'no-shares', 'rep', 'vault'] as const, seed)
		for (const action of migrationActions) {
			if (action === 'rep') {
				await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
			} else if (action === 'vault') {
				await migrateVault(client, context.securityPool, QuestionOutcome.Yes)
			} else {
				let outcome = QuestionOutcome.No
				if (action === 'invalid-shares') outcome = QuestionOutcome.Invalid
				if (action === 'yes-shares') outcome = QuestionOutcome.Yes
				await migrateShares(shareHolder, parentAddresses.shareToken, genesisUniverse, outcome, [QuestionOutcome.Yes])
			}
		}

		const yesUniverse = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
		const yesAddresses = getSecurityPoolAddresses(context.securityPool, yesUniverse, context.questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, yesAddresses.securityPool), SystemState.ForkMigration, 'migrated child should remain isolated until the repair phase')
		await mockWindow.advanceTime(8n * 7n * DAY + 1n)
		await startTruthAuction(client, yesAddresses.securityPool)

		if ((await getSystemState(client, yesAddresses.securityPool)) === SystemState.ForkTruthAuction) {
			const ethRaiseCap = await getEthRaiseCap(client, yesAddresses.truthAuction)
			if (ethRaiseCap > 0n) {
				const parentForkData = await getSecurityPoolForkerForkData(client, context.securityPool)
				const repAtFork = path === 'own' ? (await getOwnForkRepBuckets(client, context.securityPool)).vaultRepAtFork : parentForkData.auctionableRepAtFork
				await participateAuction(createClient(3), yesAddresses.truthAuction, repAtFork / 4n, ethRaiseCap)
			}
			await mockWindow.advanceTime(AUCTION_TIME + 1n)
			await finalizeTruthAuction(client, yesAddresses.securityPool)
		}

		strictEqualTypeSafe(await getSystemState(client, yesAddresses.securityPool), SystemState.Operational, 'settled child should reactivate after randomized migration ordering')
		const supplyBeforeReactivatedMint = await getShareTokenSupply(client, yesAddresses.securityPool)
		if (path === 'external') {
			await createCompleteSet(createClient(4), yesAddresses.securityPool, 1n * 10n ** 18n)
			assert.ok((await getShareTokenSupply(client, yesAddresses.securityPool)) > supplyBeforeReactivatedMint, 'reactivated unresolved child should accept a positive complete-set mint')
		} else {
			await assert.rejects(createCompleteSet(createClient(4), yesAddresses.securityPool, 1n * 10n ** 18n), /Resolved/)
			strictEqualTypeSafe(await getShareTokenSupply(client, yesAddresses.securityPool), supplyBeforeReactivatedMint, 'resolved own-fork child should reactivate without reopening complete-set minting')
		}
		strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.PoolForked, 'reactivating a child must not reopen the parent')
	})

	test('fork and migration state transitions preserve REP supply and child mapping', async () => {
		const parentRepToken = getRepTokenAddress(genesisUniverse)
		const parentSupplyBeforeFork = await getTotalTheoreticalSupply(client, parentRepToken)
		const burnAddressBalanceBeforeFork = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))
		const forkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const expectedChildSupplySnapshot = parentSupplyBeforeFork
		const branchOrder = shuffle([QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No], 0xdecafbadn)
		const attackerClient = createClient(1)
		await approveAndDepositRep(attackerClient, repDeposit, context.questionId)
		await mockWindow.setTime(context.questionEndDate + 1n)
		await depositRep(client, context.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, context.securityPool)

		strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.PoolForked, 'parent should enter forked state')
		const parentSupplyAfterFork = await getUniverseTheoreticalSupply(client, genesisUniverse)
		const burnAddressBalanceAfterFork = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))
		const burnedParentRep = burnAddressBalanceAfterFork - burnAddressBalanceBeforeFork
		strictEqualTypeSafe(parentSupplyBeforeFork - parentSupplyAfterFork, burnedParentRep, 'parent theoretical supply decrease should equal burned parent REP')
		assert.ok(parentSupplyAfterFork < parentSupplyBeforeFork, 'fork should reduce parent theoretical supply')

		for (const outcome of branchOrder) {
			await createChildUniverse(client, context.securityPool, outcome)
			const childUniverseId = getChildUniverseIdForOutcome(outcome)
			const childUniverse = await getUniverseData(client, childUniverseId)
			const childRepToken = getRepTokenAddress(childUniverseId)
			assert.ok(await contractExists(client, childRepToken), 'child rep token should exist')
			strictEqualTypeSafe(childUniverse.parentUniverseId, genesisUniverse, 'child should point back to genesis')
			strictEqualTypeSafe(childUniverse.forkingOutcomeIndex, BigInt(outcome), 'child should retain its outcome index')
			const childUniverseSupply = await getUniverseTheoreticalSupply(client, childUniverseId)
			assert.ok(childUniverseSupply > 0n, 'child universe supply should stay positive')
			strictEqualTypeSafe(childUniverseSupply, expectedChildSupplySnapshot, 'child universe supply should preserve parent REP under 1:1 migration')
		}

		const childUniverseIds = branchOrder.map(outcome => getChildUniverseIdForOutcome(outcome))
		assert.strictEqual(new Set(childUniverseIds).size, childUniverseIds.length, 'supported child universes should map to distinct ids')

		const migrationProxyAddress = await getMigrationProxyAddress(client, context.securityPool)
		const migrationBalanceBefore = await getMigrationRepBalance(client, genesisUniverse, migrationProxyAddress)
		const { vaultRepAtFork } = await getOwnForkRepBuckets(client, context.securityPool)
		assert.ok(vaultRepAtFork > 0n, 'own-fork migration should expose a positive branch migration amount')
		assert.ok(vaultRepAtFork <= migrationBalanceBefore, 'branch migration amount must be backed by the proxy migration balance')
		for (const outcome of branchOrder) {
			const childUniverseId = getChildUniverseIdForOutcome(outcome)
			const childRepToken = getRepTokenAddress(childUniverseId)
			const childSecurityPool = getSecurityPoolAddresses(context.securityPool, childUniverseId, context.questionId, securityMultiplier).securityPool
			const childBalanceBefore = await getERC20Balance(client, childRepToken, childSecurityPool)
			await migrateRepToZoltar(client, context.securityPool, [outcome])
			const childBalanceAfter = await getERC20Balance(client, childRepToken, childSecurityPool)
			const childMinted = childBalanceAfter - childBalanceBefore
			assert.ok(childBalanceAfter >= childBalanceBefore, 'migration should never reduce child REP')
			assert.ok(childMinted > 0n, 'migration should mint REP into the selected child pool')
			strictEqualTypeSafe(childMinted, vaultRepAtFork, 'selected branch should receive exactly the fork migration amount')
			assert.ok(childMinted <= migrationBalanceBefore, 'child REP minted must not exceed the caller migration balance for the selected branch')
		}

		const repeatedYesChildRepToken = getRepTokenAddress(getChildUniverseIdForOutcome(QuestionOutcome.Yes))
		const repeatedYesSecurityPool = getSecurityPoolAddresses(context.securityPool, getChildUniverseIdForOutcome(QuestionOutcome.Yes), context.questionId, securityMultiplier).securityPool
		const repeatedYesBalanceBefore = await getERC20Balance(client, repeatedYesChildRepToken, repeatedYesSecurityPool)
		await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
		const repeatedYesBalanceAfter = await getERC20Balance(client, repeatedYesChildRepToken, repeatedYesSecurityPool)
		strictEqualTypeSafe(repeatedYesBalanceAfter, repeatedYesBalanceBefore, 'repeated branch migration should be a no-op once child REP is fully split')

		for (const outcome of branchOrder) {
			await migrateVault(client, context.securityPool, outcome)
		}
		await migrateVaultWithUnresolvedEscalation(client, context.securityPool, client.account.address, QuestionOutcome.Yes)

		const forkData = await getSecurityPoolForkerForkData(client, context.securityPool)
		assert.ok(forkData.auctionableRepAtFork > 0n, 'forked pool should retain migration REP for branch settlement')
		assert.ok(forkData.migratedRep <= forkData.auctionableRepAtFork, 'migrated REP should never exceed the branch migration balance')
		const yesUniverseId = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(context.securityPool, yesUniverseId, context.questionId, securityMultiplier).securityPool
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool), SystemState.ForkMigration, 'yes child should be in fork migration')
		const yesBalanceBeforeRepeat = await getERC20Balance(client, getRepTokenAddress(yesUniverseId), yesSecurityPool)
		await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(yesUniverseId), yesSecurityPool), yesBalanceBeforeRepeat, 'repeat migration after vault migration should not mint extra child REP')
	})

	test('own-fork locks excess parent REP into the migration balance', async () => {
		await mockWindow.setTime(context.questionEndDate + 10n)
		const repToken = getRepTokenAddress(genesisUniverse)
		const parentSupplyBeforeFork = await getUniverseTheoreticalSupply(client, genesisUniverse)
		const burnAddressBalanceBeforeFork = await getERC20Balance(client, repToken, addressString(BURN_ADDRESS))
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		await depositRep(client, context.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, context.securityPool)

		const migrationProxyAddress = await getMigrationProxyAddress(client, context.securityPool)
		const migrationProxyRepBalance = await getERC20Balance(client, repToken, migrationProxyAddress)
		const parentSupplyAfterFork = await getUniverseTheoreticalSupply(client, genesisUniverse)
		const burnAddressBalanceAfterFork = await getERC20Balance(client, repToken, addressString(BURN_ADDRESS))
		const forkData = await getSecurityPoolForkerForkData(client, context.securityPool)

		strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.PoolForked, 'parent should enter forked state')
		assert.equal(migrationProxyRepBalance, 0n, 'forking should burn the parent REP that leaves the parent pool')
		strictEqualTypeSafe(parentSupplyBeforeFork - parentSupplyAfterFork, burnAddressBalanceAfterFork - burnAddressBalanceBeforeFork, 'burned parent REP should equal the parent theoretical supply decrease')
		assert.ok(forkData.auctionableRepAtFork > 0n, 'own-fork migration balance should include non-burned parent REP')
	})

	test('claimAuctionProceeds keeps REP and ETH reconciliation stable across claim orderings', async () => {
		const { yesSecurityPool, losingBidder, losingEth, losingTick, winningBidder, winningTick } = await setupFinalizedTruthAuctionWithMixedBids()
		const orderSnapshot = await mockWindow.anvilSnapshot()
		const initialLosingBidderBalance = await getETHBalance(client, losingBidder.account.address)
		const parentAccountingBeforeClaims = await readPoolAccountingSnapshot(client, context.securityPool)

		const settleInOrder = async (order: 'refund-first' | 'claim-first') => {
			if (order === 'refund-first') {
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
			} else {
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			}

			const losingBidderBalance = await getETHBalance(client, losingBidder.account.address)
			const winningVault = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const winningRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVault.repDepositShare)

			strictEqualTypeSafe(losingBidderBalance - initialLosingBidderBalance, losingEth, 'losing refund should release the original ETH bid exactly once')
			assert.ok(winningRep > 0n, 'winning claim should still mint REP-backed ownership')

			return {
				losingBidderBalance,
				winningVault,
				winningRep,
				forkData: await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool),
				ethBalance: await getETHBalance(client, yesSecurityPool.securityPool),
				parentAccounting: await readPoolAccountingSnapshot(client, context.securityPool),
			}
		}

		const refundFirst = await settleInOrder('refund-first')
		await assert.rejects(async () => await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }]), /already been (claimed|withdrawn)/)
		await mockWindow.anvilRevert(orderSnapshot)
		const claimFirst = await settleInOrder('claim-first')
		await assert.rejects(async () => await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }]), /already been (claimed|withdrawn)/)

		strictEqualTypeSafe(refundFirst.losingBidderBalance, claimFirst.losingBidderBalance, 'losing bidder ETH balance should not depend on claim order')
		strictEqualTypeSafe(refundFirst.winningVault.repDepositShare, claimFirst.winningVault.repDepositShare, 'winning vault ownership should not depend on claim order')
		strictEqualTypeSafe(refundFirst.winningVault.securityBondAllowance, claimFirst.winningVault.securityBondAllowance, 'winning vault allowance should not depend on claim order')
		strictEqualTypeSafe(refundFirst.winningVault.feeIndex, claimFirst.winningVault.feeIndex, 'winning vault fee accounting should not depend on claim order')
		strictEqualTypeSafe(refundFirst.winningRep, claimFirst.winningRep, 'winning REP claim should not depend on claim order')
		strictEqualTypeSafe(refundFirst.forkData.auctionedSecurityBondAllowance, claimFirst.forkData.auctionedSecurityBondAllowance, 'auctioned allowance should not depend on claim order')
		strictEqualTypeSafe(refundFirst.forkData.migratedRep, claimFirst.forkData.migratedRep, 'migrated REP should not depend on claim order')
		strictEqualTypeSafe(refundFirst.ethBalance, claimFirst.ethBalance, 'child pool ETH balance should not depend on claim order')
		assert.deepStrictEqual(refundFirst.parentAccounting, parentAccountingBeforeClaims, 'refund-first child auction claims must not mutate parent-pool accounting')
		assert.deepStrictEqual(claimFirst.parentAccounting, parentAccountingBeforeClaims, 'claim-first child auction claims must not mutate parent-pool accounting')
	})

	test('auction settlement is order-independent and rejects double claims', async () => {
		const bidderA = createClient(2)
		const bidderB = createClient(3)
		await deployUniformPriceDualCapBatchAuction(client, client.account.address)
		const auctionAddress = getUniformPriceDualCapBatchAuctionAddress(client.account.address)
		await startAuction(client, auctionAddress, 2n * 10n ** 18n, 2n * 10n ** 18n)
		const tickA = await participateAuction(bidderA, auctionAddress, 2n * 10n ** 18n, 1n * 10n ** 18n)
		const tickB = await participateAuction(bidderB, auctionAddress, 1n * 10n ** 18n, 1n * 10n ** 18n)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalizeAuction(client, auctionAddress)
		const clearing = await computeClearing(client, auctionAddress)
		assert.ok(clearing.foundTick >= -524288n && clearing.foundTick <= 524288n, 'auction should compute a valid clearing tick')

		const runSettlementOrder = async (order: readonly { bidder: WriteClient; tick: bigint }[]) => {
			const auctionBalanceBefore = await getETHBalance(client, auctionAddress)
			const bidderABalanceBefore = await getETHBalance(client, bidderA.account.address)
			const bidderBBalanceBefore = await getETHBalance(client, bidderB.account.address)
			for (const entry of order) {
				const simulated = await simulateWithdrawBids(client, auctionAddress, entry.bidder.account.address, [{ tick: entry.tick, bidIndex: 0n }])
				assert.ok(simulated.totalEthRefund >= 0n, 'simulated refund should be non-negative')
				await withdrawBids(client, auctionAddress, entry.bidder.account.address, [{ tick: entry.tick, bidIndex: 0n }])
			}
			return {
				auctionBalanceBefore,
				auctionBalanceAfter: await getETHBalance(client, auctionAddress),
				bidderABalanceBefore,
				bidderABalanceAfter: await getETHBalance(client, bidderA.account.address),
				bidderBBalanceBefore,
				bidderBBalanceAfter: await getETHBalance(client, bidderB.account.address),
			}
		}

		const snapshot = await mockWindow.anvilSnapshot()
		const orderA = await runSettlementOrder([
			{ bidder: bidderA, tick: tickA },
			{ bidder: bidderB, tick: tickB },
		])
		await mockWindow.anvilRevert(snapshot)
		const orderB = await runSettlementOrder([
			{ bidder: bidderB, tick: tickB },
			{ bidder: bidderA, tick: tickA },
		])

		strictEqualTypeSafe(orderA.auctionBalanceBefore, orderB.auctionBalanceBefore, 'auction balance before settlement should not depend on claim order')
		strictEqualTypeSafe(orderA.auctionBalanceAfter, orderB.auctionBalanceAfter, 'auction balance after settlement should not depend on claim order')
		strictEqualTypeSafe(orderA.bidderABalanceAfter, orderB.bidderABalanceAfter, 'bidder A payout should be order-independent')
		strictEqualTypeSafe(orderA.bidderBBalanceAfter, orderB.bidderBBalanceAfter, 'bidder B payout should be order-independent')
		assert.ok(orderA.auctionBalanceAfter <= orderA.auctionBalanceBefore, 'auction settlement should never pay out more ETH than the auction held')
		const totalBidderPayout = orderA.bidderABalanceAfter - orderA.bidderABalanceBefore + (orderA.bidderBBalanceAfter - orderA.bidderBBalanceBefore)
		strictEqualTypeSafe(totalBidderPayout, orderA.auctionBalanceBefore - orderA.auctionBalanceAfter, 'total bidder ETH paid should reconcile to the auction balance decrease')
		await assert.rejects(withdrawBids(client, auctionAddress, bidderA.account.address, [{ tick: tickA, bidIndex: 0n }]), /already been claimed/i)
	})

	test('redeemRep becomes unavailable after the first child-pool redemption', async () => {
		const attackerClient = createClient(1)
		await approveAndDepositRep(attackerClient, repDeposit, context.questionId)
		await mockWindow.setTime(context.questionEndDate + 1n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, getRepTokenAddress(genesisUniverse))) / 20n
		await depositRep(client, context.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, context.securityPool)
		await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, context.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, context.securityPool, QuestionOutcome.Yes)

		const yesUniverseId = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(context.securityPool, yesUniverseId, context.questionId, securityMultiplier).securityPool
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool)

		const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool, attackerClient.account.address)
		const attackerClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool, attackerVaultBeforeRedeem.repDepositShare)
		const denominatorBeforeRedeem = await getPoolOwnershipDenominator(client, yesSecurityPool)
		const childRepToken = getRepTokenAddress(yesUniverseId)
		const walletRepBeforeRedeem = await getERC20Balance(client, childRepToken, client.account.address)
		const poolRepBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool)
		const clientVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool, client.account.address)
		const clientClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool, clientVaultBeforeRedeem.repDepositShare)
		const parentAccountingBeforeRedeem = await readPoolAccountingSnapshot(client, context.securityPool)

		await redeemRep(client, yesSecurityPool, client.account.address)

		const clientVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool, client.account.address)
		const denominatorAfterRedeem = await getPoolOwnershipDenominator(client, yesSecurityPool)
		const attackerClaimAfterRedeem = await poolOwnershipToRep(client, yesSecurityPool, attackerVaultBeforeRedeem.repDepositShare)
		const walletRepAfterRedeem = await getERC20Balance(client, childRepToken, client.account.address)
		const poolRepAfterRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool)

		strictEqualTypeSafe(clientVaultAfterRedeem.repDepositShare, 0n, 'redeeming a vault should zero out its child-pool ownership')
		assert.ok(denominatorAfterRedeem <= denominatorBeforeRedeem, 'redeeming a vault should not increase the child pool denominator')
		const claimDelta = attackerClaimAfterRedeem > attackerClaimBeforeRedeem ? attackerClaimAfterRedeem - attackerClaimBeforeRedeem : attackerClaimBeforeRedeem - attackerClaimAfterRedeem
		assert.ok(claimDelta <= 1n, 'redeeming another vault should preserve the remaining vault claim up to rounding')
		strictEqualTypeSafe(walletRepAfterRedeem - walletRepBeforeRedeem, clientClaimBeforeRedeem, 'redeemRep should pay the caller REP claim exactly')
		strictEqualTypeSafe(poolRepBeforeRedeem - poolRepAfterRedeem, clientClaimBeforeRedeem, 'redeemRep should debit the child pool REP by the caller claim exactly')
		assert.deepStrictEqual(await readPoolAccountingSnapshot(client, context.securityPool), parentAccountingBeforeRedeem, 'child REP redemption must not mutate parent-pool accounting')
		await assert.rejects(redeemRep(client, yesSecurityPool, client.account.address), /No redeemable REP/)
	})

	test('oracle-staged operations cannot be overwritten or executed twice', async () => {
		const priceOracle = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const allowances = [repDeposit / 4n, repDeposit / 5n, repDeposit / 6n, repDeposit / 7n, repDeposit / 8n]

		for (let index = 0; index < allowances.length; index += 1) {
			let value = 0n
			if (index === 0) {
				value = ethCost
			} else if (index < 4) {
				value = queuedOperationEthCost
			}
			await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, ensureDefined(allowances[index], `allowances[${index}] is undefined`), 5n * 60n, value)
		}

		strictEqualTypeSafe(await getStagedOperationCounter(client, priceOracle), 5n, 'queued operations should use append-only ids')
		strictEqualTypeSafe(await getPendingSettlementOperationCount(client, priceOracle), 4n, 'oracle settlement should auto-execute only the bounded pending list')
		assert.deepStrictEqual(Array.from(await getPendingSettlementOperationIds(client, priceOracle)), [1n, 2n, 3n, 4n], 'pending settlement operations should remain in queue order')
		strictEqualTypeSafe(await getActiveStagedOperationCount(client, priceOracle), 5n, 'active operation count should include pending and manual operations')
		const [activeOperationIds, activeOperations] = await getActiveStagedOperations(client, priceOracle, 0n, 5n)
		assert.deepStrictEqual(Array.from(activeOperationIds), [5n, 4n, 3n, 2n, 1n], 'active staged operations should page newest first')
		assert.strictEqual(activeOperations[0]?.amount, allowances[4], 'newest overflow operation should retain its amount')
		assert.strictEqual(activeOperations[4]?.amount, allowances[0], 'oldest pending operation should retain its amount')

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		for (const consumedOperationId of [1n, 2n, 3n, 4n]) {
			const stagedOperation = await getStagedOperation(client, priceOracle, consumedOperationId)
			strictEqualTypeSafe(stagedOperation[1], addressString(0x0n), `operation ${consumedOperationId.toString()} should be consumed exactly once`)
		}
		const overflowOperation = await getStagedOperation(client, priceOracle, 5n)
		strictEqualTypeSafe(overflowOperation[1], client.account.address, 'manual overflow operation should remain active after settlement')
		strictEqualTypeSafe(await getActiveStagedOperationCount(client, priceOracle), 1n, 'only the overflow operation should remain active after settlement')

		await executeStagedOperation(client, priceOracle, 5n)
		const finalVault = await getSecurityVault(client, context.securityPool, client.account.address)
		strictEqualTypeSafe(finalVault.securityBondAllowance, allowances[4], 'manual overflow execution should apply the final staged allowance')
		strictEqualTypeSafe(await getActiveStagedOperationCount(client, priceOracle), 0n, 'manual execution should consume the final active operation')
		strictEqualTypeSafe(await getStagedOperationCounter(client, priceOracle), 5n, 'executing staged operations must not rewrite the append-only counter')
		await assert.rejects(executeStagedOperation(client, priceOracle, 5n), /staged operation does not exist/i)
	})

	test('active vault pagination stays unique under deposit, allowance, and exit churn', async () => {
		const vaultA = createClient(1)
		const vaultB = createClient(2)
		const vaultC = createClient(3)
		await approveAndDepositRep(vaultA, repDeposit, context.questionId)
		await approveAndDepositRep(vaultB, repDeposit, context.questionId)
		await approveAndDepositRep(vaultC, repDeposit, context.questionId)

		const priceOracle = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
		await manipulatePriceOracleAndPerformOperation(vaultA, mockWindow, priceOracle, OperationType.SetSecurityBondsAllowance, vaultA.account.address, repDeposit / 20n)
		const vaultBBeforeExit = await getSecurityVault(client, context.securityPool, vaultB.account.address)
		const vaultBRepClaim = await poolOwnershipToRep(client, context.securityPool, vaultBBeforeExit.repDepositShare)
		for (let withdrawalIndex = 0n; withdrawalIndex < 5n; withdrawalIndex++) {
			const withdrawalAmount = withdrawalIndex === 4n ? vaultBRepClaim : vaultBRepClaim / 5n
			await manipulatePriceOracleAndPerformOperation(vaultB, mockWindow, priceOracle, OperationType.WithdrawRep, vaultB.account.address, withdrawalAmount)
			if (withdrawalIndex < 4n) await mockWindow.advanceTime(10n * 60n)
		}

		const activeVaultCount = await getActiveVaultCount(client, context.securityPool)
		const activeVaults = Array.from(await getActiveVaults(client, context.securityPool, 0n, activeVaultCount + 2n))
		const firstPage = Array.from(await getActiveVaults(client, context.securityPool, 0n, 2n))
		const secondPage = Array.from(await getActiveVaults(client, context.securityPool, 2n, 2n))
		const emptyPage = Array.from(await getActiveVaults(client, context.securityPool, activeVaultCount, 2n))

		strictEqualTypeSafe(activeVaultCount, 3n, 'one fully exited vault should leave three active vaults')
		assert.deepStrictEqual([...firstPage, ...secondPage], activeVaults, 'paged active vault results should concatenate to the full active set')
		assert.deepStrictEqual(emptyPage, [], 'pagination past the active set should be empty')
		assert.strictEqual(activeVaults[0], vaultA.account.address, 'most recently touched active vault should be first')
		assert.strictEqual(activeVaults[1], vaultC.account.address, 'untouched active vaults should retain newest-first order')
		assert.strictEqual(activeVaults[2], client.account.address, 'baseline vault should remain active after other vault churn')
		assert.strictEqual(new Set(activeVaults).size, activeVaults.length, 'active vault pagination should not duplicate entries')
		assert.strictEqual(activeVaults.includes(vaultB.account.address), false, 'fully exited vault should be removed from the active list')
	})

	test('underfunded low-price fills and rejected zero-price bids reconcile without double consumption', async () => {
		const underfundedBidder = createClient(1)
		const lowPriceBidder = createClient(2)
		await deployUniformPriceDualCapBatchAuction(client, client.account.address)
		const underfundedAuctionAddress = getUniformPriceDualCapBatchAuctionAddress(client.account.address)
		const rejectedZeroPriceTick = -450000n
		const lowPriceTick = 0n
		const lowPriceBid = 2n * 10n ** 18n
		const underfundedMaxRepBeingSold = 1000n * 10n ** 18n

		await startAuction(client, underfundedAuctionAddress, 1000n * 10n ** 18n, underfundedMaxRepBeingSold)
		strictEqualTypeSafe(tickToPrice(rejectedZeroPriceTick), 0n, 'rejected setup should use a zero-price tick')
		await assert.rejects(submitBid(underfundedBidder, underfundedAuctionAddress, rejectedZeroPriceTick, lowPriceBid), /tick price rounds down to zero/)
		await submitBid(underfundedBidder, underfundedAuctionAddress, lowPriceTick, lowPriceBid)

		const underfundedClearing = await computeClearing(client, underfundedAuctionAddress)
		strictEqualTypeSafe(underfundedClearing.hitCap, false, 'accepted low-price bid should leave this auction underfunded')
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalizeAuction(client, underfundedAuctionAddress)
		const underfundedExpectedRep = (underfundedMaxRepBeingSold * lowPriceBid) / (1000n * 10n ** 18n)
		strictEqualTypeSafe(await getTotalRepPurchased(client, underfundedAuctionAddress), underfundedExpectedRep, 'underfunded winning bids should receive REP in proportion to ETH raised')
		strictEqualTypeSafe(await getEthRaised(client, underfundedAuctionAddress), lowPriceBid, 'underfunded accounting should record the submitted ETH')

		const underfundedResult = await simulateWithdrawBids(client, underfundedAuctionAddress, underfundedBidder.account.address, [{ tick: lowPriceTick, bidIndex: 0n }])
		strictEqualTypeSafe(underfundedResult.totalFilledRep, underfundedExpectedRep, 'underfunded winner should fill only the REP backed by raised ETH')
		strictEqualTypeSafe(underfundedResult.totalEthRefund, 0n, 'low-price underfunded winner should not receive an ETH refund')

		const refundAuctionOwner = createClient(3)
		await deployUniformPriceDualCapBatchAuction(client, refundAuctionOwner.account.address)
		const refundAuctionAddress = getUniformPriceDualCapBatchAuctionAddress(refundAuctionOwner.account.address)
		const refundOnlyTick = -20000n
		const reservePrice = 2n * 10n ** 18n
		const closestReserveTick = priceToClosestTick(reservePrice)
		const winningTick = tickToPrice(closestReserveTick) >= reservePrice ? closestReserveTick : closestReserveTick + 1n
		const refundOnlyBid = 2n * 10n ** 18n
		const winningBid = 24n * 10n ** 18n
		assert.ok(tickToPrice(refundOnlyTick) > 0n, 'refund-only setup should use an accepted positive-price tick')

		await startAuction(refundAuctionOwner, refundAuctionAddress, 20n * 10n ** 18n, 10n * 10n ** 18n)
		await submitBid(underfundedBidder, refundAuctionAddress, refundOnlyTick, refundOnlyBid)
		await submitBid(lowPriceBidder, refundAuctionAddress, winningTick, winningBid)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalizeAuction(refundAuctionOwner, refundAuctionAddress)

		const auctionBalanceBeforeWithdrawals = await getETHBalance(client, refundAuctionAddress)
		const refundOnlyResult = await simulateWithdrawBids(refundAuctionOwner, refundAuctionAddress, underfundedBidder.account.address, [{ tick: refundOnlyTick, bidIndex: 0n }])
		const winningResult = await simulateWithdrawBids(refundAuctionOwner, refundAuctionAddress, lowPriceBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
		const expectedWinningRep = await getTotalRepPurchased(client, refundAuctionAddress)
		const acceptedWinningEth = await getEthRaised(client, refundAuctionAddress)
		strictEqualTypeSafe(refundOnlyResult.totalFilledRep, 0n, 'refund-only low-price bid should not fill REP')
		strictEqualTypeSafe(refundOnlyResult.totalEthRefund, refundOnlyBid, 'refund-only low-price bid should receive all ETH back')
		strictEqualTypeSafe(winningResult.totalFilledRep, expectedWinningRep, 'winning bid should fill the finalized REP allocation')
		assert.ok(expectedWinningRep > 0n && expectedWinningRep <= 10n * 10n ** 18n, 'winning REP must remain positive and capped')
		strictEqualTypeSafe(winningResult.totalEthRefund, winningBid - acceptedWinningEth, 'winning bid should refund ETH above the finalized allocation')

		await withdrawBids(refundAuctionOwner, refundAuctionAddress, underfundedBidder.account.address, [{ tick: refundOnlyTick, bidIndex: 0n }])
		await withdrawBids(refundAuctionOwner, refundAuctionAddress, lowPriceBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
		strictEqualTypeSafe(auctionBalanceBeforeWithdrawals - (await getETHBalance(client, refundAuctionAddress)), refundOnlyBid + winningResult.totalEthRefund, 'refund and partial-fill withdrawals should reconcile to the remaining auction ETH balance decrease')
		await assert.rejects(withdrawBids(refundAuctionOwner, refundAuctionAddress, underfundedBidder.account.address, [{ tick: refundOnlyTick, bidIndex: 0n }]), /already been claimed/i)
	})
})
