import { describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, keccak256, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatStorageSlot } from '../../testSupport/storage'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { applyLibraries, deployOriginSecurityPool, getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getChildUniverseId, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createCompleteSet, getAwaitingForkContinuation, getSecurityPoolsEscalationGame, getSecurityVault, getSettlementCollateralAttoEth, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { finishChildInitialization, finalizeTruthAuction, getQuestionOutcome, getSecurityPoolForkerForkData, initiateSecurityPoolFork, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameOutcomeState, getNonDecisionThresholdAttoRep, getStartBond, getQuestionResolution } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { balanceOfShares, migrateShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
} from '../../types/contractArtifact'
import { unit, maximumQuestionHorizonSeconds, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio fork isolation', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const forkA = async () => {
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await initiateSecurityPoolFork(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)
		await initiateSecurityPoolFork(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool)
	}

	test('ordinary origin child preparation remains within the Osaka transaction gas limit', async () => {
		const { owner, base } = fixture
		const nativePool = getSecurityPoolAddresses(zeroAddress, base.genesisUniverse, base.questionId, base.statoblastSecurityMultiplierBps).securityPool
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner(), base.genesisUniverse, base.questionId)
		await initiateSecurityPoolFork(owner(), nativePool)
		const prepared = await fixture.prepareChildDependencies(nativePool, QuestionOutcome.Yes)
		expect((await owner().waitForTransactionReceipt({ hash: prepared })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		const hash = await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'createChildUniverse', args: [nativePool, BigInt(QuestionOutcome.Yes)] }))
		expect((await owner().waitForTransactionReceipt({ hash })).gasUsed).toBeLessThanOrEqual(16_777_216n)
	})

	test('A forks while B is future; each owner chooses a different branch for each question', async () => {
		const { owner, other, base, vault, portfolio, poolFor, secondQuestionId } = fixture
		const otherVault = await fixture.createVault(other())
		for (const question of [base.questionId, secondQuestionId]) {
			await fixture.allocate(question)
			await fixture.allocate(question, 1_000n * unit, 100n * unit, other(), otherVault)
			await createCompleteSet(owner(), poolFor(question).securityPool, 20n * unit)
		}
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await forkA()
		const yesUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.Yes)
		const noUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.No)
		const forker = getInfraContractAddresses().securityPoolForker
		for (const { questionId, firstOutcome, secondOutcome } of [
			{ questionId: base.questionId, firstOutcome: QuestionOutcome.Yes, secondOutcome: QuestionOutcome.No },
			{ questionId: secondQuestionId, firstOutcome: QuestionOutcome.No, secondOutcome: QuestionOutcome.Yes },
		]) {
			const parent = poolFor(questionId).securityPool
			const ethBefore = await getETHBalance(owner(), parent)
			if (questionId === base.questionId) await expect(fixture.execute(forker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'migrateVault', args: [parent, BigInt(firstOutcome)] }))).rejects.toThrow('Prepare shared child price feed')
			for (const outcome of [firstOutcome, secondOutcome]) {
				const prepared = await fixture.prepareChild(parent, outcome)
				expect((await owner().waitForTransactionReceipt({ hash: prepared })).gasUsed).toBeLessThanOrEqual(16_777_216n)
				const dependencies = await fixture.prepareChildDependencies(parent, outcome)
				expect((await owner().waitForTransactionReceipt({ hash: dependencies })).gasUsed).toBeLessThanOrEqual(16_777_216n)
				const childUniverse = getChildUniverseId(base.genesisUniverse, outcome)
				const addresses = poolFor(questionId, childUniverse, parent)
				expect(await owner().getCode({ address: addresses.securityPool })).toBeUndefined()
				expect(await owner().readContract({ abi: coordinatorArtifact.abi, address: addresses.openOraclePriceCoordinator, functionName: 'securityPool' })).toBe(zeroAddress)
				expect(await owner().readContract({ abi: coordinatorArtifact.abi, address: addresses.openOraclePriceCoordinator, functionName: 'priceFeed' })).toBe(addresses.openOraclePriceCoordinator)
				const expectedDependencies = await owner().readContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'getChildPoolDependencies', args: [parent, BigInt(outcome)] })
				await fixture.prepareChildDependencies(parent, outcome)
				expect(await owner().readContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'getChildPoolDependencies', args: [parent, BigInt(outcome)] })).toEqual(expectedDependencies)
				const created = await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'createChildUniverse', args: [parent, BigInt(outcome)] }))
				expect((await owner().waitForTransactionReceipt({ hash: created })).gasUsed).toBeLessThanOrEqual(16_777_216n)
				await finishChildInitialization(other(), parent, outcome)
			}
			await fixture.prepareChild(parent, firstOutcome)
			const firstMigration = await fixture.execute(forker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'migrateVault', args: [parent, BigInt(firstOutcome)] }))
			expect((await owner().waitForTransactionReceipt({ hash: firstMigration })).gasUsed).toBeLessThanOrEqual(16_777_216n)
			await fixture.execute(forker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'migrateVault', args: [parent, BigInt(secondOutcome)] }), 0n, other(), otherVault)
			const firstUniverse = getChildUniverseId(base.genesisUniverse, firstOutcome)
			const secondUniverse = getChildUniverseId(base.genesisUniverse, secondOutcome)
			const first = poolFor(questionId, firstUniverse, parent)
			const second = poolFor(questionId, secondUniverse, parent)
			expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [questionId, firstUniverse] })).toBe(first.securityPool)
			expect((await getSecurityVault(owner(), first.securityPool, vault)).repBackingUnits).toBeGreaterThan(0n)
			expect((await getSecurityVault(owner(), first.securityPool, otherVault)).repBackingUnits).toBe(0n)
			expect((await getSecurityVault(owner(), second.securityPool, otherVault)).repBackingUnits).toBeGreaterThan(0n)
			expect((await getSecurityVault(owner(), second.securityPool, vault)).repBackingUnits).toBe(0n)
			expect((await getETHBalance(owner(), parent)) + (await getETHBalance(owner(), first.securityPool)) + (await getETHBalance(owner(), second.securityPool))).toBe(ethBefore)
			for (const shareOutcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) await migrateShares(owner(), poolFor(questionId).shareToken, base.genesisUniverse, shareOutcome, [QuestionOutcome.Yes, QuestionOutcome.No])
			expect((await balanceOfShares(owner(), first.shareToken, firstUniverse, owner().account.address))[1]).toBeGreaterThan(0n)
			if (questionId === base.questionId) {
				await deployOriginSecurityPool(owner(), yesUniverse, secondQuestionId, base.statoblastSecurityMultiplierBps)
				await expect(owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [secondQuestionId, yesUniverse] })).rejects.toThrow('Question pool unavailable')
			}
		}
		const aYes = poolFor(base.questionId, yesUniverse, base.securityPoolAddresses.securityPool)
		const aNo = poolFor(base.questionId, noUniverse, base.securityPoolAddresses.securityPool)
		const bNo = poolFor(secondQuestionId, noUniverse, poolFor(secondQuestionId).securityPool)
		const bYes = poolFor(secondQuestionId, yesUniverse, poolFor(secondQuestionId).securityPool)
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [secondQuestionId, yesUniverse] })).toBe(bYes.securityPool)
		expect(bYes.securityPool).not.toBe(poolFor(secondQuestionId, yesUniverse, zeroAddress).securityPool)
		await expect(owner().call({ data: encodeDeployData({ abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object), args: [getInfraContractAddresses().securityPoolFactory, aYes.securityPool, maximumQuestionHorizonSeconds] }) })).rejects.toThrow('Choose an origin pool')
		const yesFeed = await owner().readContract({ abi: coordinatorArtifact.abi, address: aYes.openOraclePriceCoordinator, functionName: 'priceFeed' })
		const noFeed = await owner().readContract({ abi: coordinatorArtifact.abi, address: aNo.openOraclePriceCoordinator, functionName: 'priceFeed' })
		expect(yesFeed).not.toBe(noFeed)
		expect(await owner().readContract({ abi: coordinatorArtifact.abi, address: bYes.openOraclePriceCoordinator, functionName: 'priceFeed' })).toBe(yesFeed)
		expect(await owner().readContract({ abi: coordinatorArtifact.abi, address: bNo.openOraclePriceCoordinator, functionName: 'priceFeed' })).toBe(noFeed)
		for (const child of [aYes, aNo, bYes, bNo]) expect(await owner().readContract({ abi: coordinatorArtifact.abi, address: child.openOraclePriceCoordinator, functionName: 'isPriceValid' })).toBe(false)
		expect(await getQuestionOutcome(owner(), aYes.securityPool)).toBe(QuestionOutcome.Yes)
		expect(await getQuestionOutcome(owner(), aNo.securityPool)).toBe(QuestionOutcome.No)
		expect(await getQuestionOutcome(owner(), bNo.securityPool)).toBe(QuestionOutcome.None)
		await base.mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(owner(), bNo.securityPool)
		if ((await getSystemState(owner(), bNo.securityPool)) === SystemState.ForkTruthAuction) {
			await base.mockWindow.advanceTime(8n * DAY)
			await finalizeTruthAuction(owner(), bNo.securityPool)
		}
		expect(await getSystemState(owner(), bNo.securityPool)).toBe(SystemState.Operational)
		expect(await getQuestionOutcome(owner(), bNo.securityPool)).toBe(QuestionOutcome.None)
		expect(await base.mockWindow.getTime()).toBeLessThan(fixture.secondEndTime)
		await expect(fixture.execute(bNo.securityPool, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [QuestionOutcome.Yes, base.reportBond] }))).rejects.toThrow()
		expect(await getSettlementCollateralAttoEth(owner(), bNo.securityPool)).toBeGreaterThan(0n)
	})

	test('the densest carry snapshot below the economic deposit ceiling fits the Osaka transaction gas limit', async () => {
		const { owner, base, poolFor, secondQuestionId } = fixture
		await fixture.allocate(secondQuestionId)
		await base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await fixture.refreshPrice(secondQuestionId)
		const parent = poolFor(secondQuestionId).securityPool
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) await fixture.execute(parent, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [outcome, base.reportBond * BigInt(outcome + 1)] }))
		const game = await getSecurityPoolsEscalationGame(owner(), parent)
		const maximumDepositsPerOutcome = (await getNonDecisionThresholdAttoRep(owner(), game)) / (await getStartBond(owner(), game))
		let peakCount = 0
		while ((1n << BigInt(peakCount + 1)) - 1n <= maximumDepositsPerOutcome) peakCount++
		const leafCount = (1n << BigInt(peakCount)) - 1n
		expect(leafCount).toBeLessThanOrEqual(maximumDepositsPerOutcome)
		const stateDiff: Record<string, bigint> = {}
		// Exercise a dense MMR representation bounded by the native threshold/start-bond deposit ceiling.
		// State overrides isolate carry storage gas; they do not manufacture a valid deposit history.
		// Compiler storage layout: outcomeState starts at slot 8, each OutcomeState spans 142 slots,
		// currentLeafCount is offset 70 and currentPeaks starts at offset 71. Readback below checks it.
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const outcomeSlot = 8n + 142n * BigInt(outcome)
			stateDiff[formatStorageSlot(outcomeSlot + 70n)] = leafCount
			for (let peak = 0; peak < peakCount; peak++) stateDiff[formatStorageSlot(outcomeSlot + 71n + BigInt(peak))] = BigInt(keccak256(formatStorageSlot(BigInt(1 + outcome * 64 + peak))))
		}
		await base.mockWindow.addStateOverrides({ [game]: { stateDiff } })
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const state = await getEscalationGameOutcomeState(owner(), game, outcome)
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.currentPeaks.filter(peak => BigInt(peak) !== 0n)).toHaveLength(peakCount)
		}
		await forkA()
		await fixture.prepareChild(parent, QuestionOutcome.No)
		await fixture.prepareChildDependencies(parent, QuestionOutcome.No)
		const created = await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'createChildUniverse', args: [parent, BigInt(QuestionOutcome.No)] }))
		expect((await owner().waitForTransactionReceipt({ hash: created })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		await finishChildInitialization(fixture.other(), parent, QuestionOutcome.No)
		const child = poolFor(secondQuestionId, getChildUniverseId(base.genesisUniverse, QuestionOutcome.No), parent).securityPool
		const childGame = await getSecurityPoolsEscalationGame(owner(), child)
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const state = await getEscalationGameOutcomeState(owner(), childGame, outcome)
			expect(state.snapshotLeafCount).toBe(leafCount)
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.currentPeaks).toEqual(state.snapshotPeaks)
		}
	})

	test('an unresolved B dispute keeps its escrow and outcome when A forks', async () => {
		const { owner, base, vault, poolFor, secondQuestionId } = fixture
		await fixture.allocate(secondQuestionId)
		await base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await fixture.refreshPrice(secondQuestionId)
		const b = poolFor(secondQuestionId)
		await fixture.execute(b.securityPool, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [QuestionOutcome.Yes, base.reportBond] }))
		const parentGame = await getSecurityPoolsEscalationGame(owner(), b.securityPool)
		const before = await getEscalationGameOutcomeState(owner(), parentGame, QuestionOutcome.Yes)
		expect(before.balanceAttoRep).toBeGreaterThan(0n)
		await forkA()
		expect((await getSecurityPoolForkerForkData(owner(), b.securityPool)).unresolvedEscalationAtFork).toBe(true)
		await fixture.prepareChild(b.securityPool, QuestionOutcome.No)
		const dependencies = await fixture.prepareChildDependencies(b.securityPool, QuestionOutcome.No)
		expect((await owner().waitForTransactionReceipt({ hash: dependencies })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		const prepared = await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'createChildUniverse', args: [b.securityPool, BigInt(QuestionOutcome.No)] }))
		expect((await owner().waitForTransactionReceipt({ hash: prepared })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		await finishChildInitialization(fixture.other(), b.securityPool, QuestionOutcome.No)
		await fixture.execute(getInfraContractAddresses().securityPoolForker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'migrateVaultWithUnresolvedEscalation', args: [b.securityPool, vault, BigInt(QuestionOutcome.No)] }))
		const childUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.No)
		const child = poolFor(secondQuestionId, childUniverse, b.securityPool)
		const childGame = await getSecurityPoolsEscalationGame(owner(), child.securityPool)
		expect((await getEscalationGameOutcomeState(owner(), childGame, QuestionOutcome.Yes)).balanceAttoRep).toBe(before.balanceAttoRep)
		const entitlement = await owner().readContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'getEscalationMigrationEntitlementStatus', args: [b.securityPool, vault] })
		expect(entitlement[0]).toBe(true)
		expect(entitlement[1]).toBe(before.balanceAttoRep)
		expect(entitlement[2]).toEqual([false, false, true])
		expect(await getQuestionResolution(owner(), childGame)).toBe(QuestionOutcome.None)
		await base.mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(owner(), child.securityPool)
		if ((await getSystemState(owner(), child.securityPool)) === SystemState.ForkTruthAuction) {
			await base.mockWindow.advanceTime(8n * DAY)
			await finalizeTruthAuction(owner(), child.securityPool)
		}
		for (let index = 0; index < 16 && (await getAwaitingForkContinuation(owner(), child.securityPool)); index++) await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: child.securityPool, functionName: 'resumeForkedEscalationGame' }))
		expect(await getAwaitingForkContinuation(owner(), child.securityPool)).toBe(false)
		expect(await getQuestionResolution(owner(), childGame)).toBe(QuestionOutcome.None)
		expect((await getEscalationGameOutcomeState(owner(), childGame, QuestionOutcome.Yes)).balanceAttoRep).toBe(before.balanceAttoRep)
	})
})
