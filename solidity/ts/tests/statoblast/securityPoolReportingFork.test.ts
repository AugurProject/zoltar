import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
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
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: native fork reporter registration', () => {
	const fixture = useSecurityPoolFixture({})
	const securityPool = () => ({ abi: securityPoolArtifact.abi, address: fixture.securityPool })
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).questionLedger
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
		const coordinator = await owner.readContract({ ...securityPool(), functionName: 'forkController' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, chosen ? 1n : 2n] }))
		await writeContractAndWait(other, () => other.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, otherChoosesYes ? 1n : 2n] }))
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'prepareSecurityPoolQuestion', args: [sourcePool(), child] }))
		const childPool = await owner.readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [base.questionId, child] })
		for (let outcome = 0; outcome < carryOutcomes; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [sourcePool(), child] }))
		return { child, childPool }
	}
	test('liquidating an underwriter cannot transfer or consume its separate wallet reporting claim', async () => {
		const game = await prepareReport(400n * unit)
		const owner = fixture.owner()
		const reporter = fixture.other()
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const ledger = await owner.readContract({ ...securityPool(), functionName: 'reporterLedger', args: [fixture.base.genesisUniverse] })
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
		const keeperPrincipal = (await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [owner.account.address] }))[0]
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		const keeperWallet = await getERC20Balance(owner, token, owner.account.address)
		expect(before[1]).toBe(200n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'takeOver', args: [target.positionId, 100n * unit, 0n, 0n] }))
		const after = await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [reporter.account.address] })
		// A fully elapsed auction transfers half the pledged principal for this half-commitment fill.
		expect(after[0]).toBe(before[0] / 2n)
		expect(after[1]).toBe(100n * unit)
		expect((await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [owner.account.address] }))[0]).toBe(keeperPrincipal + before[0] / 2n)
		expect(await getERC20Balance(owner, token, owner.account.address)).toBe(keeperWallet)
		expect(await escrow()).toBe(originalEscrow)
		expect(await deposits()).toEqual(originalDeposits)
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const reporterBefore = await getERC20Balance(owner, token, reporter.account.address)
		const keeperBefore = await getERC20Balance(owner, token, owner.account.address)
		await writeContractAndWait(reporter, () => reporter.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await getERC20Balance(owner, token, reporter.account.address)).toBe(reporterBefore + originalEscrow)
		expect(await getERC20Balance(owner, token, owner.account.address)).toBe(keeperBefore)
		expect(await escrow()).toBe(0n)
	})

	test('#1539 child liquidation preserves reporter claims and canonical carry needs no nullifier witness', async () => {
		const sourceGame = await prepareReport(400n * unit)
		const owner = fixture.owner()
		const reporter = fixture.other()
		await fixture.deposit(3_000n * unit)
		const proof = await createCarryProof(owner, sourceGame, { expectedOutcome: 1, parentDepositIndex: 0n, sourceNodeId: 1n, leafIndex: 0n, merkleMountainRangePeakIndex: 0n, merkleMountainRangeSiblings: [], nullifierSiblings: new SparseNullifierTree().getProof(0n) })
		const { child, childPool } = await activateUnrelatedFork(true, 3, true)
		const capital = { abi: capitalArtifact.abi, address: await owner.readContract({ ...securityPool(), functionName: 'capitalLedger', args: [child] }) }
		const pool = { abi: poolArtifact.abi, address: childPool }
		const game = await owner.readContract({ ...pool, functionName: 'escalationGame' })
		const oracle = await owner.readContract({ ...pool, functionName: 'priceFeed' })
		const token = getRepTokenAddress(child)
		await manipulatePriceOracle(owner, fixture.base.mockWindow, oracle, unit, 100n * unit)
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...capital, functionName: 'withdrawPrincipal', args: [100n * unit, reporter.account.address] }))
		await approveToken(reporter, token, childPool)
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const ledger = await owner.readContract({ ...securityPool(), functionName: 'reporterLedger', args: [child] })
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
		const keeperPrincipal = (await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [owner.account.address] }))[0]
		const keeperWallet = await getERC20Balance(owner, token, owner.account.address)
		expect(before[1]).toBe(200n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'takeOver', args: [target.positionId, 100n * unit, 0n, 0n] }))
		const after = await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [reporter.account.address] })
		expect(after[0]).toBe(before[0] / 2n)
		expect(after[1]).toBe(100n * unit)
		expect((await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [owner.account.address] }))[0]).toBe(keeperPrincipal + before[0] / 2n)
		expect(await getERC20Balance(owner, token, owner.account.address)).toBe(keeperWallet)
		expect(await deposits()).toEqual(local)
		expect(await escrow()).toBe(totalEscrow)
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const reporterBefore = await getERC20Balance(owner, token, reporter.account.address)
		const keeperBefore = await getERC20Balance(owner, token, owner.account.address)
		await writeContractAndWait(owner, () => owner.writeContract({ ...pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [{ ...proof, nullifierSiblings: [] }]] }))
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...pool, functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await getERC20Balance(owner, token, reporter.account.address)).toBe(reporterBefore + totalEscrow)
		expect(await getERC20Balance(owner, token, owner.account.address)).toBe(keeperBefore)
		expect(await escrow()).toBe(0n)
		await expect(owner.writeContract({ ...pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [{ ...proof, nullifierSiblings: [] }]] })).rejects.toThrow()
	})

	test.each([false, true])('#1689 public share quote matches same-block redemption after fees (stale: %s)', async stale => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner()
		const trader = fixture.other()
		const pool = { abi: poolArtifact.abi, address: sourcePool() }
		const validUntil = await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'priceValidUntil' })
		const now = (await owner.getBlock()).timestamp
		await fixture.base.mockWindow.setTime(stale ? validUntil + DAY : now + (validUntil - now) / 2n)
		const saved = await fixture.base.mockWindow.anvilSnapshot()
		await fixture.base.mockWindow.advanceTime(1n)
		const quote = await trader.readContract({ ...pool, functionName: 'attoSharesToAttoEth', args: [10n * unit] })
		expect(quote).toBeLessThan(10n * unit)
		const collateral = await trader.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const balance = await getERC20Balance(trader, collateral, trader.account.address)
		// Include the redemption at the exact quoted timestamp, preserving the
		// quote-versus-execution assertion without imposing a collateral floor.
		await fixture.base.mockWindow.anvilRevert(saved)
		await writeContractAndWait(trader, () => trader.writeContract({ ...pool, functionName: 'redeemCompleteSet', args: [10n * unit] }))
		expect((await getERC20Balance(trader, collateral, trader.account.address)) - balance).toBe(quote)
	})

	test('#1739 sealed active source shares quote no executable proceeds while the child remains funded', async () => {
		await prepareReport()
		const { childPool } = await activateUnrelatedFork(true)
		const owner = fixture.owner()
		expect(await owner.readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'attoSharesToAttoEth', args: [10n * unit] })).toBe(0n)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'attoSharesToAttoRep', args: [10n * unit] })).toBe(0n)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'attoSharesToAttoEth', args: [10n * unit] })).toBeGreaterThan(0n)
	})

	test('security pool reporter history freezes without the removed standalone fork registry', async () => {
		const game = await prepareReport()
		await activateUnrelatedFork(true)
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getFinalQuestionResolution' })).toBe(3n)
		await expect(fixture.other().writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] })).rejects.toThrow()
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
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
	})

	test('an outsider cannot register an unfinished child game and overwrite its live reporter source', async () => {
		const sourceGame = await prepareReport()
		const { child, childPool } = await activateUnrelatedFork(true, 1)
		const owner = fixture.owner()
		const other = fixture.other()
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(1n)
		await expect(other.writeContract({ ...securityPool(), functionName: 'registerReporterGame', args: [childGame] })).rejects.toThrow('Reporter fork snapshot incomplete')
		expect(await owner.readContract({ ...securityPool(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(sourceGame)
		for (let outcome = 1; outcome < 3; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker, functionName: 'materializeSecurityPoolQuestion', args: [sourcePool(), child] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		expect(await owner.readContract({ ...securityPool(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(childGame)
	})
})
