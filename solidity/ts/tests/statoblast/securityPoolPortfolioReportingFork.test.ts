import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as claimArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { createCarryProof, SparseNullifierTree } from '../carryProofHelpers'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: native fork reporter registration', () => {
	const fixture = useSecurityPoolPortfolioFixture({})
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const prepareReport = async (mintAmount = 10n * unit) => {
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, fixture.other())
		await fixture.authorize(200n * unit, fixture.other())
		await fixture.mint(mintAmount)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		await approveToken(fixture.other(), getRepTokenAddress(fixture.base.genesisUniverse), sourcePool())
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await fixture.owner().readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'escalationGame' })
		return game
	}
	const activateUnrelatedFork = async (chosen: boolean, carryOutcomes = 3, otherChoosesYes = false) => {
		const { base } = fixture
		const owner = fixture.owner()
		const other = fixture.other()
		const question = { ...base.questionData, title: 'Unrelated fork during reporting' }
		await createQuestion(owner, question, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(question, base.outcomes))
		if (otherChoosesYes) {
			await addRepToMigrationBalance(owner, base.genesisUniverse, 3_000n * unit)
			await splitMigrationRep(owner, base.genesisUniverse, 3_000n * unit, [1n])
		}
		const coordinator = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, chosen ? 1n : 2n] }))
		await writeContractAndWait(other, () => other.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, otherChoosesYes ? 1n : 2n] }))
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [sourcePool(), child] }))
		const childPool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [base.questionId, child] })
		for (let outcome = 0; outcome < carryOutcomes; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [sourcePool(), child] }))
		return { child, childPool }
	}
	test('liquidating an underwriter cannot transfer or consume its separate wallet reporting claim', async () => {
		const game = await prepareReport(400n * unit)
		const owner = fixture.owner()
		const reporter = fixture.other()
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const ledger = await owner.readContract({ ...portfolio(), functionName: 'reporterLedger', args: [fixture.base.genesisUniverse] })
		const escrow = () => owner.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'balanceOfGame', args: [game] })
		const deposits = () => owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [1, 0n, 1n] })
		const originalDeposits = await deposits()
		const originalEscrow = await escrow()
		expect(originalEscrow).toBeGreaterThan(0n)
		const target = await owner.readContract({ ...capital, functionName: 'ownerAccount', args: [reporter.account.address] })
		await fixture.deposit(3_000n * unit)
		await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		await fixture.base.mockWindow.advanceTime(3_601n)
		await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		const before = await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [reporter.account.address] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'takeOver', args: [target.positionId, 100n * unit, 1n, 0n] }))
		const after = await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [reporter.account.address] })
		expect(after[0]).toBeLessThan(before[0])
		expect(after[1]).toBeLessThan(before[1])
		expect(await escrow()).toBe(originalEscrow)
		expect(await deposits()).toEqual(originalDeposits)
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		const reporterBefore = await getERC20Balance(owner, token, reporter.account.address)
		const keeperBefore = await getERC20Balance(owner, token, owner.account.address)
		await writeContractAndWait(reporter, () => reporter.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await getERC20Balance(owner, token, reporter.account.address)).toBe(reporterBefore + originalEscrow)
		expect(await getERC20Balance(owner, token, owner.account.address)).toBe(keeperBefore)
		expect(await escrow()).toBe(0n)
	})

	test('child liquidation leaves both inherited and local reporter claims with their depositor', async () => {
		const sourceGame = await prepareReport(400n * unit)
		const owner = fixture.owner()
		const reporter = fixture.other()
		await fixture.deposit(3_000n * unit)
		const proof = await createCarryProof(owner, sourceGame, { expectedOutcome: 1, parentDepositIndex: 0n, sourceNodeId: 1n, leafIndex: 0n, merkleMountainRangePeakIndex: 0n, merkleMountainRangeSiblings: [], nullifierSiblings: new SparseNullifierTree().getProof(0n) })
		const { child, childPool } = await activateUnrelatedFork(true, 3, true)
		const capital = { abi: capitalArtifact.abi, address: await owner.readContract({ ...portfolio(), functionName: 'capitalLedger', args: [child] }) }
		const pool = { abi: poolArtifact.abi, address: childPool }
		const game = await owner.readContract({ ...pool, functionName: 'escalationGame' })
		const oracle = await owner.readContract({ ...pool, functionName: 'openOraclePriceCoordinator' })
		const token = getRepTokenAddress(child)
		await manipulatePriceOracle(owner, fixture.base.mockWindow, oracle, unit, 100n * unit)
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...capital, functionName: 'withdrawPrincipal', args: [100n * unit, reporter.account.address] }))
		await approveToken(reporter, token, childPool)
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const ledger = await owner.readContract({ ...portfolio(), functionName: 'reporterLedger', args: [child] })
		const escrow = () => owner.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'balanceOfGame', args: [game] })
		const deposits = () => owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [1, 0n, 1n] })
		const local = await deposits()
		expect(local[0]?.amountAttoRep).toBeGreaterThan(0n)
		const totalEscrow = await escrow()
		expect(totalEscrow).toBeGreaterThan(100n * unit)
		const target = await owner.readContract({ ...capital, functionName: 'ownerAccount', args: [reporter.account.address] })
		await manipulatePriceOracle(owner, fixture.base.mockWindow, oracle, 4n * unit, 100n * unit)
		await fixture.base.mockWindow.advanceTime(3_601n)
		await manipulatePriceOracle(owner, fixture.base.mockWindow, oracle, 4n * unit, 100n * unit)
		const before = await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [reporter.account.address] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'takeOver', args: [target.positionId, 100n * unit, 1n, 0n] }))
		expect((await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [reporter.account.address] }))[0]).toBeLessThan(before[0])
		expect(await deposits()).toEqual(local)
		expect(await escrow()).toBe(totalEscrow)
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const reporterBefore = await getERC20Balance(owner, token, reporter.account.address)
		const keeperBefore = await getERC20Balance(owner, token, owner.account.address)
		await writeContractAndWait(owner, () => owner.writeContract({ ...pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [proof]] }))
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...pool, functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await getERC20Balance(owner, token, reporter.account.address)).toBe(reporterBefore + totalEscrow)
		expect(await getERC20Balance(owner, token, owner.account.address)).toBe(keeperBefore)
		expect(await escrow()).toBe(0n)
		await expect(owner.writeContract({ ...pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [proof]] })).rejects.toThrow()
	})

	test('portfolio reporter history freezes without the removed standalone fork registry', async () => {
		const game = await prepareReport()
		expect(await fixture.owner().readContract({ abi: claimArtifact.abi, address: game, functionName: 'isClaimHistoryFrozen' })).toBe(false)
		await activateUnrelatedFork(true)
		expect(await fixture.owner().readContract({ abi: claimArtifact.abi, address: game, functionName: 'isClaimHistoryFrozen' })).toBe(true)
	})

	test('a reporter claim finalized before a fork stays live and withdrawable in its parent', async () => {
		const game = await prepareReport()
		const owner = fixture.owner()
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const question = { ...fixture.base.questionData, title: 'Fork after reporter finality' }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, getQuestionId(question, fixture.base.outcomes))
		expect(await owner.readContract({ abi: claimArtifact.abi, address: game, functionName: 'isClaimHistoryFrozen' })).toBe(false)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await owner.readContract({ abi: claimArtifact.abi, address: game, functionName: 'isClaimHistoryFrozen' })).toBe(false)
	})

	test('an outsider cannot register an unfinished child game and overwrite its live reporter source', async () => {
		const sourceGame = await prepareReport()
		const { child, childPool } = await activateUnrelatedFork(true, 1)
		const owner = fixture.owner()
		const other = fixture.other()
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(1n)
		await expect(other.writeContract({ ...portfolio(), functionName: 'registerReporterGame', args: [childGame] })).rejects.toThrow('Reporter fork snapshot incomplete')
		expect(await owner.readContract({ ...portfolio(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(sourceGame)
		for (let outcome = 1; outcome < 3; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'materializePortfolioQuestion', args: [sourcePool(), child] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		expect(await owner.readContract({ ...portfolio(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(childGame)
	})
})
