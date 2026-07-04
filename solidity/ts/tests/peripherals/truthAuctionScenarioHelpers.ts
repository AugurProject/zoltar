import type { Address } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../../testsuite/simulator/AnvilWindowEthereum'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testsuite/simulator/utils/utilities'
import { addressString } from '../../testsuite/simulator/utils/bigint'
import { approveAndDepositRep, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../testsuite/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId as buildQuestionId } from '../../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { createCompleteSet, depositRep, depositToEscalationGame, getCompleteSetCollateralAmount, getRepToken, getTotalSecurityBondAllowance } from '../../testsuite/simulator/utils/contracts/securityPool'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testsuite/simulator/utils/constants'
import { createWriteClient, WriteClient } from '../../testsuite/simulator/utils/clients'
import { getQuestionEndDate, OperationType, participateAuction } from '../../testsuite/simulator/utils/contracts/peripherals'
import { QuestionOutcome } from '../../testsuite/simulator/types/types'
import { strictEqualTypeSafe } from '../../testsuite/simulator/utils/testUtils'
import { finalizeTruthAuction, getMigratedRep, getOwnForkRepBuckets, getQuestionOutcome, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testsuite/simulator/utils/contracts/securityPoolForker'
import { getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress, forkUniverse } from '../../testsuite/simulator/utils/contracts/zoltar'

type SecurityPoolAddresses = {
	escalationGame: Address
	priceOracleManagerAndOperatorQueuer: Address
	securityPool: Address
	shareToken: Address
	truthAuction: Address
}

type QuestionData = {
	answerUnit: string
	description: string
	displayValueMax: bigint
	displayValueMin: bigint
	endTime: bigint
	numTicks: bigint
	startTime: bigint
	title: string
}

type PeripheralsTruthAuctionScenarioContext = {
	genesisUniverse: bigint
	getClient: () => WriteClient
	getMockWindow: () => AnvilWindowEthereum
	getOutcomes: () => string[]
	getQuestionData: () => QuestionData
	getQuestionId: () => bigint
	getSecurityPoolAddresses: () => SecurityPoolAddresses
	repDeposit: bigint
	reportBond: bigint
	securityMultiplier: bigint
	transferRepToAddress: (sender: WriteClient, recipient: Address, amount: bigint) => Promise<void>
}

export function createPeripheralsTruthAuctionScenarioHelpers({ genesisUniverse, getClient, getMockWindow, getOutcomes, getQuestionData, getQuestionId, getSecurityPoolAddresses: getFixtureSecurityPoolAddresses, repDeposit, reportBond, securityMultiplier, transferRepToAddress }: PeripheralsTruthAuctionScenarioContext) {
	const finalizeQuestionAsYesWithoutFork = async () => {
		const client = getClient()
		const mockWindow = getMockWindow()
		const questionId = getQuestionId()
		const securityPoolAddresses = getFixtureSecurityPoolAddresses()
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		if ((await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)) > 0n) {
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		}
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'question should finalize as yes')
	}

	const triggerExternalForkForSecurityPool = async (forkingClient: WriteClient | undefined = undefined, titlePrefix = 'external fork source') => {
		const client = getClient()
		const mockWindow = getMockWindow()
		const outcomes = getOutcomes()
		const questionData = getQuestionData()
		const securityPoolAddresses = getFixtureSecurityPoolAddresses()
		const effectiveForkingClient = forkingClient ?? createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const forkSourceQuestionData = {
			...questionData,
			title: `${titlePrefix} ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = buildQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(effectiveForkingClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(effectiveForkingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(effectiveForkingClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
	}

	const setupStartedTruthAuction = async (titlePrefix: string) => {
		const client = getClient()
		const mockWindow = getMockWindow()
		const questionId = getQuestionId()
		const securityPoolAddresses = getFixtureSecurityPoolAddresses()
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, titlePrefix)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork

		return {
			expectedEthToBuy,
			repAtFork,
			yesSecurityPool,
		}
	}

	const setupTruthAuctionWithMixedBids = async (finalizeAuction: boolean) => {
		const client = getClient()
		const mockWindow = getMockWindow()
		const { yesSecurityPool, repAtFork, expectedEthToBuy } = await setupStartedTruthAuction('mixed bids fork source')
		const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingEth = expectedEthToBuy / 10n
		strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		const winningTick = await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		if (finalizeAuction) {
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		return {
			expectedEthToBuy,
			losingBidder,
			losingEth,
			losingTick,
			repAtFork,
			winningBidder,
			winningTick,
			yesSecurityPool,
		}
	}

	const setupTruthAuctionWithTwoWinningBids = async (finalizeAuction: boolean) => {
		const client = getClient()
		const mockWindow = getMockWindow()
		const { yesSecurityPool, repAtFork, expectedEthToBuy } = await setupStartedTruthAuction('two winning bids fork source')
		const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningBidderA = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const winningBidderB = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		const losingEth = expectedEthToBuy / 10n
		const winningEthA = expectedEthToBuy / 2n
		const winningEthB = expectedEthToBuy - winningEthA
		strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
		strictEqualTypeSafe(winningEthA > 0n, true, 'first winning bid should invest a positive amount')
		strictEqualTypeSafe(winningEthB > 0n, true, 'second winning bid should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		const winningRepA = repAtFork / 8n
		const winningRepB = (winningEthB * winningRepA) / winningEthA
		const winningTickA = await participateAuction(winningBidderA, yesSecurityPool.truthAuction, winningRepA, winningEthA)
		const winningTickB = await participateAuction(winningBidderB, yesSecurityPool.truthAuction, winningRepB, winningEthB)
		const winningBidIndexB = winningTickA === winningTickB ? 1n : 0n

		if (finalizeAuction) {
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		return {
			expectedEthToBuy,
			losingBidder,
			losingEth,
			losingTick,
			repAtFork,
			winningBidderA,
			winningBidderB,
			winningBidIndexB,
			winningEthA,
			winningEthB,
			winningTickA,
			winningTickB,
			yesSecurityPool,
		}
	}

	const setupFinalizedTruthAuctionWithMixedBids = async () => await setupTruthAuctionWithMixedBids(true)

	const setupOwnForkWithEscrow = async (strayRepBeforeFork: bigint = 0n) => {
		const client = getClient()
		const mockWindow = getMockWindow()
		const questionId = getQuestionId()
		const securityPoolAddresses = getFixtureSecurityPoolAddresses()
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		if (strayRepBeforeFork > 0n) await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRepBeforeFork)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		return {
			forkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
			forkThreshold,
			ownForkRepBuckets: await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool),
			repBalance,
		}
	}

	return {
		finalizeQuestionAsYesWithoutFork,
		setupFinalizedTruthAuctionWithMixedBids,
		setupOwnForkWithEscrow,
		setupStartedTruthAuction,
		setupTruthAuctionWithMixedBids,
		setupTruthAuctionWithTwoWinningBids,
		triggerExternalForkForSecurityPool,
	}
}
