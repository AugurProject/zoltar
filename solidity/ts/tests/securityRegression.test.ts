import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { DAY } from '../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { deployContract } from '../testSupport/deployContract'
import { applyLibraries, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { depositOnOutcome, deployEscalationGame, getEscalationGameOutcomeState } from '../testSupport/simulator/utils/contracts/escalationGame'
import { getScalarOutcomeIndex } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, contractExists, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import {
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory as tokenFactoryArtifact,
	test_statoblast_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver as receiverArtifact,
} from '../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

describe('portfolio security regression coverage', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })

	test('stale collateral prices close minting even within standing commitments', async () => {
		await fixture.prepare()
		const until = await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'priceValidUntil' })
		await fixture.base.mockWindow.setTime(until)
		expect(await fixture.owner().readContract({ ...portfolio(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })).toBe(0n)
		await expect(fixture.mint(unit)).rejects.toThrow('Purchase exceeds healthy capacity')
		expect(await fixture.owner().readContract({ ...pool(), functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
	})

	test.each([10n, 30n])('receiver reentrancy rolls back all mint accounting with %s ETH capacity', async capacity => {
		await fixture.prepare(1_000n * unit, capacity * unit)
		const receiver = await deployContract(fixture.owner(), encodeDeployData({ abi: receiverArtifact.abi, bytecode: applyLibraries(receiverArtifact.evm.bytecode.object), args: [fixture.portfolio, fixture.base.genesisUniverse, fixture.base.questionId] }))
		const before = await fixture.owner().getBlockNumber()
		await expect(writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'attack', args: [6n * unit, 6n * unit], value: 20n * unit, gas: 15_000_000n }))).rejects.toThrow()
		expect(await fixture.owner().readContract({ ...pool(), functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
		expect(await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'demandAttoEth' })).toBe(0n)
		expect(await fixture.owner().getLogs({ address: pool().address, fromBlock: before + 1n })).toEqual([])
	})

	test('escalation deposits can fill final threshold dust below the start bond', async () => {
		const game = await deployEscalationGame(fixture.owner(), 10n * unit, 25n * unit)
		await depositOnOutcome(fixture.owner(), game, fixture.owner().account.address, QuestionOutcome.Yes, 25n * unit)
		await depositOnOutcome(fixture.owner(), game, fixture.owner().account.address, QuestionOutcome.No, 25n * unit - 1n)
		await depositOnOutcome(fixture.owner(), game, fixture.owner().account.address, QuestionOutcome.No, 10n * unit)
		expect((await getEscalationGameOutcomeState(fixture.owner(), game, QuestionOutcome.No)).balanceAttoRep).toBe(25n * unit)
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'nonDecisionTimestamp' })).toBeGreaterThan(0n)
	})

	test('external scalar forks support portfolio choices and question continuation', async () => {
		await fixture.prepare()
		const scalar = { title: 'External scalar fork', description: '', startTime: 0n, endTime: 0n, numTicks: 100n, displayValueMin: 0n, displayValueMax: 100n * unit, answerUnit: 'points' }
		await createQuestion(fixture.owner(), scalar, [])
		const outcome = getScalarOutcomeIndex(scalar, 42n)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, getQuestionId(scalar, []))
		const forks = { abi: forkArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'forkController' }) }
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...forks, functionName: 'choose', args: [fixture.base.genesisUniverse, outcome] }))
		await fixture.base.mockWindow.advanceTime(63n * DAY)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...forks, functionName: 'startBranch', args: [fixture.base.genesisUniverse, outcome] }))
		const child = getChildUniverseId(fixture.base.genesisUniverse, outcome)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...forks, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'preparePortfolioQuestion', args: [pool().address, child] }))
		const childPool = await fixture.owner().readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })
		expect(childPool).not.toBe(zeroAddress)
		expect(await contractExists(fixture.owner(), childPool)).toBe(true)
	})

	test('an untrusted caller cannot reserve the canonical portfolio share token address', async () => {
		const question = makeQuestion('Share token salt squatting', fixture.base.questionData.endTime)
		const id = getQuestionId(question, fixture.base.outcomes)
		await createQuestion(fixture.owner(), question, fixture.base.outcomes)
		const infrastructure = getInfraContractAddresses()
		const priority = await fixture.owner().readContract({ ...portfolio(), functionName: 'initialReportPriorityFeeAttoEthPerGas' })
		const salt = await fixture.owner().readContract({ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'getPortfolioOriginId', args: [fixture.portfolio, fixture.base.genesisUniverse, id, fixture.base.statoblastSecurityMultiplierBps, priority] })
		const expected = fixture.poolFor(id)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: tokenFactoryArtifact.abi, address: infrastructure.shareTokenFactory, functionName: 'deployShareToken', args: [salt, id] }))
		expect(await contractExists(fixture.owner(), expected.shareToken)).toBe(false)
		await fixture.register(id)
		expect(await contractExists(fixture.owner(), expected.shareToken)).toBe(true)
		expect(await contractExists(fixture.owner(), expected.securityPool)).toBe(true)
	})
})
