import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, hexToBytes, toHex, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker as workerArtifact,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory as coordinatorFactoryArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
} from '../../types/contractArtifact'
import { applyLibraries, getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getPendingReportId, openOracleSettle } from '../../testSupport/simulator/utils/contracts/statoblast'
import { handleOracleReporting } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { emptyOperations, unit, maximumQuestionHorizonSeconds, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: one price feed per question pool', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const feed = async () => await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
	const stageWithdrawal = async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { price: unit, value: funding.cost })
		const coordinator = fixture.base.securityPoolAddresses.openOraclePriceCoordinator
		return {
			coordinator,
			sharedFeed: await feed(),
			reportId: await getPendingReportId(fixture.owner(), coordinator),
			operationId: await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'stagedOperationCounter' }),
			settlementTime: BigInt(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'settlementTime' })),
		}
	}
	const withBrokenRuntime = async (address: Address, action: () => Promise<unknown>) => {
		const originalCode = await fixture.owner().getCode({ address })
		if (!originalCode || originalCode === '0x') throw new Error('Expected deployed runtime before callback fault')
		await fixture.base.mockWindow.addStateOverrides({ [address]: { code: hexToBytes('0x60006000fd') } })
		try {
			await action()
		} finally {
			await fixture.base.mockWindow.addStateOverrides({ [address]: { code: hexToBytes(originalCode) } })
		}
	}

	test('settling one question makes every question in the same pool fresh', async () => {
		await fixture.refreshPrice(fixture.base.questionId)
		const sharedFeed = await feed()
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'portfolio' })).toBe(fixture.portfolio)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'universeId' })).toBe(fixture.base.genesisUniverse)
		for (const questionId of [fixture.base.questionId, fixture.secondQuestionId]) expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.poolFor(questionId).openOraclePriceCoordinator, functionName: 'priceFeed' })).toBe(sharedFeed)
		const secondCoordinator = fixture.poolFor(fixture.secondQuestionId).openOraclePriceCoordinator
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: secondCoordinator, functionName: 'isPriceValid' })).toBe(true)
		const standalone = getSecurityPoolAddresses(zeroAddress, fixture.base.genesisUniverse, fixture.base.questionId, fixture.base.statoblastSecurityMultiplierBps)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'registeredCoordinators', args: [standalone.openOraclePriceCoordinator] })).toBe(false)
		expect(standalone.securityPool).not.toBe(fixture.base.securityPoolAddresses.securityPool)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: standalone.openOraclePriceCoordinator, functionName: 'priceFeed' })).toBe(standalone.openOraclePriceCoordinator)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: standalone.openOraclePriceCoordinator, functionName: 'isPriceValid' })).toBe(false)
	})

	test('two pools with identical rules have isolated question ledgers and share tokens', async () => {
		const client = fixture.owner()
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: portfolioArtifact.abi,
				bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object),
				args: [getInfraContractAddresses().securityPoolFactory, fixture.base.securityPoolAddresses.securityPool, maximumQuestionHorizonSeconds, getInfraContractAddresses().securityPoolPortfolioVaultDeployer],
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		const secondPortfolio = receipt.contractAddress
		if (!secondPortfolio) throw new Error('Second pool deployment address missing')
		expect(receipt.gasUsed).toBeLessThanOrEqual(16_777_216n)
		expect(await client.readContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'questionCount' })).toBe(0n)
		const admission = await writeContractAndWait(client, () => client.writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'addQuestion', args: [fixture.base.questionId] }))
		expect((await client.waitForTransactionReceipt({ hash: admission })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		const secondLedger = await client.readContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'getPool', args: [fixture.base.questionId, fixture.base.genesisUniverse] })
		expect(secondLedger).not.toBe(fixture.poolFor(fixture.base.questionId).securityPool)
		expect(await client.readContract({ abi: poolArtifact.abi, address: secondLedger, functionName: 'shareToken' })).not.toBe(fixture.poolFor(fixture.base.questionId).shareToken)
		expect(await client.readContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })).not.toBe(await feed())
	})

	test('late admission preserves the settled pool price and its original freshness deadline', async () => {
		await fixture.refreshPrice(fixture.base.questionId)
		const sharedFeed = await feed()
		const timestamp = await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'lastSettlementTimestamp' })
		const question = makeQuestion('Shared-feed late admission', fixture.base.questionData.endTime)
		const questionId = getQuestionId(question, fixture.base.outcomes)
		await createQuestion(fixture.owner(), question, fixture.base.outcomes)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'addQuestion', args: [questionId] }))
		const coordinator = fixture.poolFor(questionId).openOraclePriceCoordinator
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'priceFeed' })).toBe(sharedFeed)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'lastPrice' })).toBe(unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'lastSettlementTimestamp' })).toBe(timestamp)
		await fixture.base.mockWindow.setTime(timestamp + 300n)
		for (const id of [fixture.base.questionId, fixture.secondQuestionId, questionId]) expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.poolFor(id).openOraclePriceCoordinator, functionName: 'isPriceValid' })).toBe(false)
	})

	test('an external deployment cannot enter another pool namespace or register its coordinator', async () => {
		const factory = getInfraContractAddresses().securityPoolFactory
		const coordinator = fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator
		const priorityFee = await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'initialReportPriorityFeeAttoEthPerGas' })
		await expect(fixture.other().simulateContract({ abi: factoryArtifact.abi, address: factory, functionName: 'preparePortfolioChildPriceFeed', args: [fixture.base.securityPoolAddresses.securityPool, 1n] })).rejects.toThrow('Parent not forked')
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'initializePortfolioPriceFeed', args: [fixture.base.securityPoolAddresses.securityPool] }))
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'deployPortfolioSecurityPool', args: [fixture.base.genesisUniverse, fixture.base.questionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee] }))
		const otherOrigin = await fixture.owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPortfolioOriginId', args: [fixture.other().account.address, fixture.base.genesisUniverse, fixture.base.questionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee] })
		const otherLedger = await fixture.owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getSecurityPool', args: [otherOrigin, fixture.base.genesisUniverse] })
		expect(otherLedger).not.toBe(fixture.base.securityPoolAddresses.securityPool)
		expect(await fixture.owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getSecurityPoolPortfolio', args: [otherLedger] })).toBe(fixture.other().account.address)
		const foreignCoordinator = await fixture.owner().readContract({ abi: poolArtifact.abi, address: otherLedger, functionName: 'openOraclePriceCoordinator' })
		const sharedFeed = await feed()
		await expect(fixture.other().simulateContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'registerCoordinator', args: [foreignCoordinator] })).rejects.toThrow('Only security pool factory')
		await expect(fixture.other().simulateContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'syncExposure', args: [foreignCoordinator] })).rejects.toThrow('Unregistered coordinator')
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'registeredCoordinators', args: [foreignCoordinator] })).toBe(false)
		await expect(fixture.other().simulateContract({ abi: workerArtifact.abi, address: getInfraContractAddresses().priceCoordinatorDeploymentWorker, functionName: 'configureSharedPriceFeed', args: [coordinator, sharedFeed] })).rejects.toThrow('Only coordinator factory')
		await expect(fixture.other().simulateContract({ abi: coordinatorFactoryArtifact.abi, address: getInfraContractAddresses().openOraclePriceCoordinatorFactory, functionName: 'configureSharedPriceFeed', args: [coordinator, sharedFeed] })).rejects.toThrow('Only coordinator deployer')
	})

	test('an exposed coordinator can only be bound through its authenticated factory chain', async () => {
		const infrastructure = getInfraContractAddresses()
		const priorityFee = await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'initialReportPriorityFeeAttoEthPerGas' })
		const reputationToken = await fixture.owner().readContract({ abi: poolArtifact.abi, address: fixture.base.securityPoolAddresses.securityPool, functionName: 'repToken' })
		const request = { abi: coordinatorFactoryArtifact.abi, address: infrastructure.openOraclePriceCoordinatorFactory, functionName: 'deployOpenOraclePriceCoordinator', args: [infrastructure.openOracle, reputationToken, priorityFee, toHex(731n, { size: 32 })] } as const
		const { result: coordinator } = await fixture.owner().simulateContract(request)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract(request))
		await expect(fixture.other().simulateContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'setSecurityPool', args: [fixture.base.securityPoolAddresses.securityPool] })).rejects.toThrow('Only coordinator factory')
		await expect(fixture.other().simulateContract({ abi: coordinatorFactoryArtifact.abi, address: infrastructure.openOraclePriceCoordinatorFactory, functionName: 'configureSecurityPool', args: [coordinator, fixture.base.securityPoolAddresses.securityPool] })).rejects.toThrow('Only coordinator deployer')
		await expect(fixture.other().simulateContract({ abi: workerArtifact.abi, address: infrastructure.priceCoordinatorDeploymentWorker, functionName: 'configureSecurityPool', args: [coordinator, fixture.base.securityPoolAddresses.securityPool] })).rejects.toThrow('Only coordinator factory')
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: coordinatorFactoryArtifact.abi, address: infrastructure.openOraclePriceCoordinatorFactory, functionName: 'configureSecurityPool', args: [coordinator, fixture.base.securityPoolAddresses.securityPool] }))
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'securityPool' })).toBe(fixture.base.securityPoolAddresses.securityPool)
	})

	test('report security covers both standing commitments and synchronization never double counts', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.allocate(fixture.secondQuestionId, 600n * unit, 60n * unit)
		const sharedFeed = await feed()
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'aggregateExposureAttoEth' })).toBe(160n * unit)
		for (let repeat = 0; repeat < 2; repeat++)
			for (const id of [fixture.base.questionId, fixture.secondQuestionId]) await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'syncExposure', args: [fixture.poolFor(id).openOraclePriceCoordinator] }))
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'aggregateExposureAttoEth' })).toBe(160n * unit)
		const minimum = await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'minimumToken1ReportAttoEth' })
		expect(minimum).toBeGreaterThan((160n * unit) / 100n)
		for (const id of [fixture.base.questionId, fixture.secondQuestionId]) expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.poolFor(id).openOraclePriceCoordinator, functionName: 'minimumToken1ReportAttoEth' })).toBe(minimum)
		await fixture.submit(fixture.secondQuestionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 20n * unit })
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'aggregateExposureAttoEth' })).toBe(120n * unit)
		await fixture.base.finalizeQuestionAsYesWithoutFork()
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'syncExposure', args: [fixture.base.securityPoolAddresses.openOraclePriceCoordinator] }))
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'aggregateExposureAttoEth' })).toBe(20n * unit)
	})

	test('one initiating question and sponsor own the globally bounded report callback', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { price: unit, value: funding.cost })
		const coordinator = fixture.base.securityPoolAddresses.openOraclePriceCoordinator
		const reportId = await getPendingReportId(fixture.owner(), coordinator)
		const sharedFeed = await feed()
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'pendingCoordinator' })).toBe(coordinator)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'pendingReportSponsor' })).toBe(fixture.vault)
		const enqueue = async () => await fixture.execute(coordinator, encodeFunctionData({ abi: coordinatorArtifact.abi, functionName: 'requestPriceIfNeededAndStageOperation', args: [1, fixture.vault, unit, 300n, 0n, 0n, 0n] }))
		await enqueue()
		await enqueue()
		await expect(enqueue()).rejects.toThrow()
		await expect(fixture.submit(fixture.secondQuestionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: unit })).rejects.toThrow('Another question owns pending callback')
		await expect(fixture.other().simulateContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'requestPriceIfNeededAndStageOperation', args: [1, fixture.other().account.address, unit, 300n, 0n, 0n, 0n] })).rejects.toThrow()
		await handleOracleReporting(fixture.owner(), fixture.base.mockWindow, coordinator, unit)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'reportOutcome', args: [reportId] })).toBe(1n)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: sharedFeed, functionName: 'pendingReportSponsor' })).toBe(zeroAddress)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.poolFor(fixture.secondQuestionId).openOraclePriceCoordinator, functionName: 'isPriceValid' })).toBe(true)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
	})

	test('rejected report operations never inherit the next question report', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { price: unit, value: funding.cost })
		const coordinator = fixture.base.securityPoolAddresses.openOraclePriceCoordinator
		const reportId = await getPendingReportId(fixture.owner(), coordinator)
		const operationId = await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'stagedOperationCounter' })
		const settlementTime = await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'settlementTime' })
		await fixture.base.mockWindow.advanceTime(settlementTime + 301n)
		await openOracleSettle(fixture.owner(), reportId)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: await feed(), functionName: 'reportOutcome', args: [reportId] })).toBe(2n)
		await fixture.refreshPrice(fixture.secondQuestionId)
		await expect(fixture.owner().simulateContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'executeStagedOperation', args: [operationId] })).rejects.toThrow()
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
	})
	test('shared namespaces reject a later question with a different oracle priority fee', async () => {
		const factory = getInfraContractAddresses().securityPoolFactory
		const priorityFee = await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'initialReportPriorityFeeAttoEthPerGas' })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'initializePortfolioPriceFeed', args: [fixture.base.securityPoolAddresses.securityPool] }))
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'deployPortfolioSecurityPool', args: [fixture.base.genesisUniverse, fixture.base.questionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee] }))
		await expect(
			writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'deployPortfolioSecurityPool', args: [fixture.base.genesisUniverse, fixture.secondQuestionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee * 2n] })),
		).rejects.toThrow('Shared feed priority fee mismatch')
		const rejectedOrigin = await fixture.owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPortfolioOriginId', args: [fixture.other().account.address, fixture.base.genesisUniverse, fixture.secondQuestionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee * 2n] })
		expect(await fixture.owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getSecurityPool', args: [rejectedOrigin, fixture.base.genesisUniverse] })).toBe(zeroAddress)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'deployPortfolioSecurityPool', args: [fixture.base.genesisUniverse, fixture.secondQuestionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee] }))
	})

	test('an outer callback failure is recoverable without accepting the missed price or executing its withdrawal', async () => {
		const pending = await stageWithdrawal()
		await fixture.base.mockWindow.advanceTime(pending.settlementTime + 1n)
		await withBrokenRuntime(pending.sharedFeed, async () => await openOracleSettle(fixture.owner(), pending.reportId))
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'pendingReportId' })).toBe(pending.reportId)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'recoverSettledPendingReport' }))
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'reportOutcome', args: [pending.reportId] })).toBe(2n)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'pendingReportId' })).toBe(0n)
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'isPriceValid' })).toBe(false)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		await fixture.refreshPrice(fixture.secondQuestionId)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'isPriceValid' })).toBe(true)
		await expect(fixture.owner().simulateContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'executeStagedOperation', args: [pending.operationId] })).rejects.toThrow('Staged operation unavailable')
	})

	test('a failed coordinator notification cannot roll back the accepted pool price and anyone can execute its action', async () => {
		const pending = await stageWithdrawal()
		await fixture.base.mockWindow.advanceTime(pending.settlementTime + 1n)
		await withBrokenRuntime(pending.coordinator, async () => await openOracleSettle(fixture.owner(), pending.reportId))
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'reportOutcome', args: [pending.reportId] })).toBe(1n)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.poolFor(fixture.secondQuestionId).openOraclePriceCoordinator, functionName: 'isPriceValid' })).toBe(true)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(1n)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'executeStagedOperation', args: [pending.operationId] }))
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
	})

	test('a rejected report remains terminal when notification fails and another question later settles a fresh report', async () => {
		const pending = await stageWithdrawal()
		await fixture.base.mockWindow.advanceTime(pending.settlementTime + 301n)
		await withBrokenRuntime(pending.coordinator, async () => await openOracleSettle(fixture.owner(), pending.reportId))
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: pending.sharedFeed, functionName: 'reportOutcome', args: [pending.reportId] })).toBe(2n)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(1n)
		await fixture.refreshPrice(fixture.secondQuestionId)
		const hash = await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'executeStagedOperation', args: [pending.operationId] }))
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash })
		const events = receipt.logs.filter(log => log.address.toLowerCase() === pending.coordinator.toLowerCase()).map(log => decodeEventLog({ abi: coordinatorArtifact.abi, data: log.data, topics: log.topics }))
		expect(events.find(event => event.eventName === 'ExecutedStagedOperation')?.args).toMatchObject({ success: false, errorMessage: 'Shared report rejected' })
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pending.coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
	})
})
