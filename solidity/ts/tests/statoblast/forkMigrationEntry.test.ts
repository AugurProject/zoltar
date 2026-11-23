import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	ReputationToken_ReputationToken as tokenArtifact,
	Zoltar_Zoltar as zoltarArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	test_statoblast_CounterfeitPortfolioQuestionSource_CounterfeitPortfolioQuestionSource as counterfeitArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: shared portfolio fork entry', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test.each([
		{ own: false, surplus: 1n },
		{ own: false, surplus: 1_000n * unit },
		{ own: true, surplus: 1n },
		{ own: true, surplus: 1_000n * unit },
	])('fork entry excludes donated REP (own: $own, surplus: $surplus)', async ({ own, surplus }) => {
		await fixture.prepare()
		await fixture.mint()
		const owner = fixture.owner()
		const universe = fixture.base.genesisUniverse
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const controller = await owner.readContract({ ...portfolio, functionName: 'forkController' })
		const reporters = await owner.readContract({ ...portfolio, functionName: 'reporterLedger', args: [universe] })
		const forker = getInfraContractAddresses().securityPoolForker
		const token = getRepTokenAddress(universe)
		for (const recipient of [fixture.capitalLedger, reporters, forker, controller]) {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'transfer', args: [recipient, surplus] }))
		}
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const threshold = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getNonDecisionThresholdAttoRep', args: [universe] })
		const admission = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getForkThresholdAttoRep', args: [universe] })
		const report = own ? threshold : 100n * unit
		await approveToken(owner, token, pool)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, report] }))
		const forkModeHashes: Hash[] = []
		if (own) {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [2, report] }))
			forkModeHashes.push(await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'forkZoltarWithOwnEscalationGame', args: [pool] })))
		} else {
			const question = { ...fixture.base.questionData, title: 'Unrelated fork with unsolicited REP' }
			await createQuestion(owner, question, fixture.base.outcomes)
			await approveToken(owner, token, getZoltarAddress())
			await forkUniverse(owner, universe, getQuestionId(question, fixture.base.outcomes))
		}
		for (let retry = 0; retry < 2; retry++) forkModeHashes.push(await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'initiateSecurityPoolFork', args: [pool] })))
		expect(await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'systemState' })).toBe(1n)
		// Entering fork mode is a pool state change like any other: indexers follow the pool's own event.
		// An own-question fork enters fork mode inside the fork transaction. Repeated calls change nothing.
		const stateEvents: bigint[] = []
		for (const hash of forkModeHashes) {
			for (const log of (await owner.getTransactionReceipt({ hash })).logs) {
				if (log.address.toLowerCase() !== pool.toLowerCase()) continue
				const decoded = decodeEventLog({ abi: poolArtifact.abi, data: log.data, topics: log.topics })
				if (decoded.eventName === 'SystemStateSet') stateEvents.push(BigInt(decoded.args.systemState))
			}
		}
		expect(stateEvents).toEqual([1n])
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'choose', args: [universe, 1n] }))
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'frozenBackingAttoRep' })).toBe(1_000n * unit)
		const reporterBacking = await owner.readContract({ abi: reporterArtifact.abi, address: reporters, functionName: 'balanceOfGame', args: [game] })
		if (own) {
			const divisor = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'forkBurnDivisor' })
			expect(reporterBacking).toBe(2n * report - admission / divisor)
		} else expect(reporterBacking).toBe(report)
		const time = (await getUniverseData(owner, universe)).forkTime
		await fixture.base.mockWindow.setTime(time + 63n * DAY)
		const child = getChildUniverseId(universe, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'startBranch', args: [universe, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		for (let outcome = 0; outcome < 3; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'materializePortfolioQuestion', args: [pool, child] }))
		const childPool = await owner.readContract({ ...portfolio, functionName: 'getPool', args: [fixture.base.questionId, child] })
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: reporterArtifact.abi, address: reporters, functionName: 'balanceOfGame', args: [childGame] })).toBe(reporterBacking)
		const childCapital = await owner.readContract({ ...portfolio, functionName: 'capitalLedger', args: [child] })
		expect((await owner.readContract({ abi: capitalArtifact.abi, address: childCapital, functionName: 'ownerCollateral', args: [owner.account.address] }))[0]).toBe(1_000n * unit)
		for (const address of [fixture.capitalLedger, reporters, forker, controller]) expect(await getERC20Balance(owner, token, address)).toBe(surplus)
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		expect(await owner.readContract({ ...factory, functionName: 'getSecurityPoolPortfolio', args: [childPool] })).toBe(fixture.portfolio)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'parent' })).toBe(pool)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareToken' })).toBe(fixture.poolFor(fixture.base.questionId).shareToken)
	})
	test('foreign reporter games and unauthenticated callers cannot overwrite or withdraw canonical claims', async () => {
		const owner = fixture.owner()
		const outsider = fixture.other()
		const universe = fixture.base.genesisUniverse
		const secondPortfolio = await fixture.deployPortfolio()
		await fixture.register(fixture.base.questionId, secondPortfolio)
		const first = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const second = { abi: portfolioArtifact.abi, address: secondPortfolio }
		const firstPool = fixture.poolFor(fixture.base.questionId).securityPool
		const secondPool = await owner.readContract({ ...second, functionName: 'getPool', args: [fixture.base.questionId, universe] })
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const token = getRepTokenAddress(universe)
		for (const pool of [firstPool, secondPool]) {
			await approveToken(owner, token, pool)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		}
		const firstGame = await owner.readContract({ abi: poolArtifact.abi, address: firstPool, functionName: 'escalationGame' })
		const secondGame = await owner.readContract({ abi: poolArtifact.abi, address: secondPool, functionName: 'escalationGame' })
		const reporters = await owner.readContract({ ...first, functionName: 'reporterLedger', args: [universe] })
		const target = { abi: reporterArtifact.abi, address: reporters }
		const snapshot = async () => ({
			balance: await getERC20Balance(owner, token, reporters),
			claim: await owner.readContract({ ...target, functionName: 'balanceOfGame', args: [firstGame] }),
			source: await owner.readContract({ ...first, functionName: 'sourceGame', args: [universe, fixture.base.questionId] }),
		})
		const before = await snapshot()
		expect(before.claim).toBe(100n * unit)
		expect(await owner.readContract({ ...target, functionName: 'balanceOfGame', args: [secondGame] })).toBe(0n)
		await expect(outsider.writeContract({ ...first, functionName: 'registerReporterGame', args: [secondGame] })).rejects.toThrow('Unknown question callback')
		await expect(outsider.writeContract({ ...first, functionName: 'forkWithReporterQuestion', args: [secondPool, outsider.account.address] })).rejects.toThrow('Unknown question callback')
		await expect(outsider.writeContract({ ...first, functionName: 'forkWithReporterQuestion', args: [firstPool, outsider.account.address] })).rejects.toThrow('Only canonical native forker')
		await expect(outsider.writeContract({ ...target, functionName: 'registerGame', args: [fixture.base.questionId, secondGame] })).rejects.toThrow('Only portfolio')
		await expect(outsider.writeContract({ ...target, functionName: 'transferFromGame', args: [firstGame, outsider.account.address, unit] })).rejects.toThrow('Only canonical reporter game')
		expect(await snapshot()).toEqual(before)
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		const firstOrigin = await owner.readContract({ ...factory, functionName: 'getSecurityPoolOriginId', args: [firstPool] })
		const secondOrigin = await owner.readContract({ ...factory, functionName: 'getSecurityPoolOriginId', args: [secondPool] })
		expect(firstOrigin).not.toBe(secondOrigin)
		expect(firstGame).not.toBe(secondGame)
	})
	test.each(['preparePortfolioQuestion', 'materializePortfolioQuestion', 'createChildUniverse'] as const)('%s rejects a counterfeit source that returns a real pool as its new child', async functionName => {
		await fixture.prepare()
		const owner = fixture.owner()
		const attacker = fixture.other()
		const universe = fixture.base.genesisUniverse
		const victim = { abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool }
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const question = { ...fixture.base.questionData, title: 'Unrelated fork for counterfeit source' }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(owner, universe, getQuestionId(question, fixture.base.outcomes))
		const counterfeit = await deployContract(attacker, encodeDeployData({ abi: counterfeitArtifact.abi, bytecode: applyLibraries(counterfeitArtifact.evm.bytecode.object), args: [universe, victim.address] }))
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		expect(await owner.readContract({ ...victim, functionName: 'systemState' })).toBe(0n)
		const attack = () => (functionName === 'createChildUniverse' ? attacker.writeContract({ ...forker, functionName, args: [counterfeit, 1n] }) : attacker.writeContract({ ...forker, functionName, args: [counterfeit, universe] }))
		// The counterfeit names its own universe as the target, which no longer descends from it, for the two
		// question entrypoints; createChildUniverse targets a real child and reaches the provenance check.
		await expect(writeContractAndWait(attacker, attack)).rejects.toThrow(functionName === 'createChildUniverse' ? 'Child pool is not from the source factory' : 'Target universe does not descend from source')
		expect(await owner.readContract({ ...victim, functionName: 'systemState' })).toBe(0n)
	})
})
