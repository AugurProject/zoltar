import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import type { Address } from '@zoltar/shared/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { BURN_ADDRESS, DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { approveAndDepositRep, handleOracleReporting, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import {
	executeStagedOperation,
	getActiveStagedOperationCount,
	getActiveStagedOperations,
	getPendingSettlementOperationCount,
	getPendingSettlementOperationIds,
	getQueuedOperationEthCost,
	getQuestionEndDate,
	getRequestPriceEthCost,
	getStagedOperation,
	getStagedOperationCounter,
	OperationType,
	participateAuction,
	requestPriceIfNeededAndStageOperationWithValue,
} from '../testSupport/simulator/utils/contracts/peripherals'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed, forkUniverse, getMigrationRepBalance, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getUniverseTheoreticalSupply, getZoltarAddress, getZoltarForkThreshold } from '../testSupport/simulator/utils/contracts/zoltar'
import {
	claimAuctionProceeds,
	createChildUniverse,
	finalizeTruthAuction,
	getMigrationProxyAddress,
	getOwnForkRepBuckets,
	getSecurityPoolForkerForkData,
	initiateSecurityPoolFork,
	migrateRepToZoltar,
	migrateVault,
	migrateVaultWithUnresolvedEscalation,
	startTruthAuction,
} from '../testSupport/simulator/utils/contracts/securityPoolForker'
import {
	createCompleteSet,
	depositRep,
	getActiveVaultCount,
	getActiveVaults,
	getCompleteSetCollateralAmount,
	getPoolOwnershipDenominator,
	getSecurityVault,
	getSystemState,
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
import { computeClearing, deployUniformPriceDualCapBatchAuction, finalize as finalizeAuction, getBidCountAtTick, getEthRaiseCap, getEthRaised, getTotalRepPurchased, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../testSupport/simulator/utils/contracts/auction'
import { getUniformPriceDualCapBatchAuctionAddress } from '../testSupport/simulator/utils/contracts/deployments'
import { tickToPrice } from '../testSupport/simulator/utils/tickMath'

setDefaultTimeout(TEST_TIMEOUT_MS)

const genesisUniverse = 0n
const securityMultiplier = 2n
const repDeposit = 1000n * 10n ** 18n
const AUCTION_TIME = 604800n
const formatStorageSlot = (slot: bigint) => `0x${slot.toString(16).padStart(64, '0')}`

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

	test('forced ETH before the first mint remains separate from accounted collateral', async () => {
		const forcedSurplus = 10n ** 18n
		const mintAmount = 2n * 10n ** 18n
		const priceOracle = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
		await mockWindow.setBalance(context.securityPool, forcedSurplus)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n)

		await createCompleteSet(client, context.securityPool, mintAmount)

		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, context.securityPool), mintAmount, 'only the mint payment should become complete-set collateral')
		strictEqualTypeSafe(await getETHBalance(client, context.securityPool), forcedSurplus + mintAmount, 'raw balance should retain the unsolicited surplus beside accounted collateral')
	})

	test('a positive-value complete-set mint cannot succeed with zero shares', async () => {
		const collateral = 10n * 10n ** 18n
		await mockWindow.setBalance(context.securityPool, collateral)
		await mockWindow.addStateOverrides({
			[context.securityPool]: {
				stateDiff: {
					[formatStorageSlot(1n)]: 100n * 10n ** 18n,
					[formatStorageSlot(2n)]: collateral,
					[formatStorageSlot(5n)]: 1n * 10n ** 18n,
				},
			},
		})

		await assert.rejects(createCompleteSet(client, context.securityPool, 1n), /Exchange rate undefined/)
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, context.securityPool), collateral, 'the rejected mint must preserve collateral accounting')
	})

	test('fork and migration state transitions preserve REP supply and child mapping', async () => {
		const parentRepToken = getRepTokenAddress(genesisUniverse)
		const parentSupplyBeforeFork = await getTotalTheoreticalSupply(client, parentRepToken)
		const burnAddressBalanceBeforeFork = await getERC20Balance(client, parentRepToken, addressString(BURN_ADDRESS))
		const forkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const permanentHaircut = forkThreshold / DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor
		const expectedChildSupplySnapshot = parentSupplyBeforeFork - permanentHaircut
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
			strictEqualTypeSafe(childUniverseSupply, expectedChildSupplySnapshot, 'child universe supply should subtract only the permanent fork haircut')
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

	test('seeded cross-contract actions preserve accounting through fork, migration, auction, and child reactivation', async () => {
		for (const seed of [0x51n, 0x9dn, 0x1337n]) {
			const seedSnapshot = await mockWindow.anvilSnapshot()
			const passiveVault = createClient(1)
			const firstBidder = createClient(2)
			const secondBidder = createClient(3)
			await mockWindow.setTime(context.questionEndDate + 10000n)
			await approveAndDepositRep(passiveVault, repDeposit, context.questionId)
			const priceOracle = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n)
			await createCompleteSet(createClient(4), context.securityPool, 10n * 10n ** 18n)
			strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.Operational, `seed ${seed.toString()}: parent should begin operational`)

			await triggerExternalForkForSecurityPool(undefined, `stateful seed ${seed.toString()}`)
			strictEqualTypeSafe(await getSystemState(client, context.securityPool), SystemState.PoolForked, `seed ${seed.toString()}: parent should enter PoolForked`)

			await migrateRepToZoltar(client, context.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, context.securityPool, QuestionOutcome.Yes)
			for (const migrationOutcome of shuffle([QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No], seed)) {
				await migrateRepToZoltar(client, context.securityPool, [migrationOutcome])
			}

			const yesUniverse = getChildUniverseIdForOutcome(QuestionOutcome.Yes)
			const yesPool = getSecurityPoolAddresses(context.securityPool, yesUniverse, context.questionId, securityMultiplier)
			strictEqualTypeSafe(await getSystemState(client, yesPool.securityPool), SystemState.ForkMigration, `seed ${seed.toString()}: child should remain in ForkMigration before the deadline`)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesPool.securityPool), SystemState.ForkTruthAuction, `seed ${seed.toString()}: under-repaired child should enter ForkTruthAuction`)

			const repAtFork = (await getSecurityPoolForkerForkData(client, context.securityPool)).auctionableRepAtFork
			const ethToRepair = await getEthRaiseCap(client, yesPool.truthAuction)
			const firstEth = ethToRepair / 2n
			const secondEth = ethToRepair - firstEth
			const bidActions = shuffle(
				[
					{ bidder: firstBidder, rep: repAtFork / 8n, eth: firstEth },
					{ bidder: secondBidder, rep: repAtFork / 8n, eth: secondEth },
				],
				seed ^ 0xa5n,
			)
			const bids: Array<{ bidder: WriteClient; tick: bigint; bidIndex: bigint }> = []
			for (const action of bidActions) {
				const tick = await participateAuction(action.bidder, yesPool.truthAuction, action.rep, action.eth)
				bids.push({ bidder: action.bidder, tick, bidIndex: (await getBidCountAtTick(client, yesPool.truthAuction, tick)) - 1n })
			}

			await mockWindow.advanceTime(AUCTION_TIME + DAY)
			await finalizeTruthAuction(client, yesPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesPool.securityPool), SystemState.Operational, `seed ${seed.toString()}: fully repaired child should reactivate`)

			for (const bid of shuffle(bids, seed ^ 0x5an)) {
				await claimAuctionProceeds(client, yesPool.securityPool, bid.bidder.account.address, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
			}

			const childSnapshot = await readPoolAccountingSnapshot(client, yesPool.securityPool)
			assert.ok(childSnapshot.completeSetCollateral <= childSnapshot.ethBalance, `seed ${seed.toString()}: accounted child collateral must not exceed raw ETH`)
			assert.ok(childSnapshot.repBalance > 0n, `seed ${seed.toString()}: reactivated child must retain REP backing`)
			assert.ok(childSnapshot.poolOwnershipDenominator > 0n, `seed ${seed.toString()}: child ownership denominator must remain positive`)
			assert.ok((await getTotalRepPurchased(client, yesPool.truthAuction)) > 0n, `seed ${seed.toString()}: repair auction must issue REP only against raised ETH`)
			await mockWindow.anvilRevert(seedSnapshot)
		}
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
		await approveAndDepositRep(vaultB, repDeposit / 10n, context.questionId)
		await approveAndDepositRep(vaultC, repDeposit, context.questionId)

		const priceOracle = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, context.questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
		await manipulatePriceOracleAndPerformOperation(vaultA, mockWindow, priceOracle, OperationType.SetSecurityBondsAllowance, vaultA.account.address, repDeposit / 20n)
		const vaultBBeforeExit = await getSecurityVault(client, context.securityPool, vaultB.account.address)
		const vaultBRepClaim = await poolOwnershipToRep(client, context.securityPool, vaultBBeforeExit.repDepositShare)
		await manipulatePriceOracleAndPerformOperation(vaultB, mockWindow, priceOracle, OperationType.WithdrawRep, vaultB.account.address, vaultBRepClaim)

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
		const lowPriceTick = -20000n
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
		const underfundedExpectedRep = 0n
		strictEqualTypeSafe(await getTotalRepPurchased(client, underfundedAuctionAddress), underfundedExpectedRep, 'underfunded bids below the cap-implied reserve should not purchase REP')
		strictEqualTypeSafe(await getEthRaised(client, underfundedAuctionAddress), 0n, 'below-reserve ETH should not enter the clearing total')

		const underfundedResult = await simulateWithdrawBids(client, underfundedAuctionAddress, underfundedBidder.account.address, [{ tick: lowPriceTick, bidIndex: 0n }])
		strictEqualTypeSafe(underfundedResult.totalFilledRep, underfundedExpectedRep, 'low-price underfunded bidder should not receive REP below reserve')
		strictEqualTypeSafe(underfundedResult.totalEthRefund, lowPriceBid, 'low-price underfunded bidder should receive a full refund')

		const refundAuctionOwner = createClient(3)
		await deployUniformPriceDualCapBatchAuction(client, refundAuctionOwner.account.address)
		const refundAuctionAddress = getUniformPriceDualCapBatchAuctionAddress(refundAuctionOwner.account.address)
		const refundOnlyTick = -20000n
		const winningTick = 7000n
		const refundOnlyBid = 2n * 10n ** 18n
		const winningBid = 12n * 10n ** 18n
		assert.ok(tickToPrice(refundOnlyTick) > 0n, 'refund-only setup should use an accepted positive-price tick')

		await startAuction(refundAuctionOwner, refundAuctionAddress, 20n * 10n ** 18n, 10n * 10n ** 18n)
		await submitBid(underfundedBidder, refundAuctionAddress, refundOnlyTick, refundOnlyBid)
		await submitBid(lowPriceBidder, refundAuctionAddress, winningTick, winningBid)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalizeAuction(refundAuctionOwner, refundAuctionAddress)

		const auctionBalanceBeforeWithdrawals = await getETHBalance(client, refundAuctionAddress)
		const refundOnlyResult = await simulateWithdrawBids(refundAuctionOwner, refundAuctionAddress, underfundedBidder.account.address, [{ tick: refundOnlyTick, bidIndex: 0n }])
		const winningResult = await simulateWithdrawBids(refundAuctionOwner, refundAuctionAddress, lowPriceBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
		strictEqualTypeSafe(refundOnlyResult.totalFilledRep, 0n, 'refund-only low-price bid should not fill REP')
		strictEqualTypeSafe(refundOnlyResult.totalEthRefund, refundOnlyBid, 'refund-only low-price bid should receive all ETH back')
		const expectedWinningRep = await getTotalRepPurchased(client, refundAuctionAddress)
		assert.ok(expectedWinningRep > 0n && expectedWinningRep < 10n * 10n ** 18n, 'underfunded reserve-price demand should purchase a proportional REP amount')
		strictEqualTypeSafe(winningResult.totalFilledRep, expectedWinningRep, 'winning bid should receive the proportional finalized REP allocation')
		strictEqualTypeSafe(winningResult.totalEthRefund, 0n, 'qualifying underfunded demand should be retained at the reserve tick')

		await withdrawBids(refundAuctionOwner, refundAuctionAddress, underfundedBidder.account.address, [{ tick: refundOnlyTick, bidIndex: 0n }])
		await withdrawBids(refundAuctionOwner, refundAuctionAddress, lowPriceBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
		strictEqualTypeSafe(auctionBalanceBeforeWithdrawals - (await getETHBalance(client, refundAuctionAddress)), refundOnlyBid + winningResult.totalEthRefund, 'refund and partial-fill withdrawals should reconcile to the remaining auction ETH balance decrease')
		await assert.rejects(withdrawBids(refundAuctionOwner, refundAuctionAddress, underfundedBidder.account.address, [{ tick: refundOnlyTick, bidIndex: 0n }]), /already been claimed/i)
	})
})
