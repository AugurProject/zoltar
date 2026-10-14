import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { createCompleteSet, getSecurityVault, redeemCompleteSet, redeemFees, updateVaultFees } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { emptyOperations, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio economic isolation between owners and questions', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const repBalance = async (account: Address) => await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), account)
	const accounting = async (pool: Address) => await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'getPoolAccountingSnapshot' })
	const position = async (pool: Address, vault = fixture.vault) => await getSecurityVault(fixture.owner(), pool, vault)
	const unwind = (amount: bigint) => ({ ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: amount })
	const checkpointTogether = async (pool: Address, vaults: Address[]) =>
		await writeContractAndWait(fixture.owner(), () =>
			fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'executeBatch', args: [vaults.map(vault => ({ target: pool, value: 0n, data: encodeFunctionData({ abi: poolArtifact.abi, functionName: 'updateVaultFees', args: [vault] }) }))] }),
		)

	test('an attacker can unwind its own A capital and fees without spending either owners B backing or the victims idle reserve', async () => {
		const { owner, other, base, vault, secondQuestionId } = fixture
		const attacker = await fixture.createVault(other())
		const poolA = base.securityPoolAddresses.securityPool
		const poolB = fixture.poolFor(secondQuestionId).securityPool
		await fixture.allocate(base.questionId, 1_000n * unit, 100n * unit)
		await fixture.allocate(secondQuestionId, 700n * unit, 70n * unit)
		await fixture.allocate(base.questionId, 600n * unit, 60n * unit, other(), attacker)
		await fixture.allocate(secondQuestionId, 400n * unit, 40n * unit, other(), attacker)
		await fixture.transferRep(vault, 111n * unit)
		await fixture.transferRep(attacker, 222n * unit, other())
		await createCompleteSet(owner(), poolA, 50n * unit)
		await createCompleteSet(owner(), poolB, 30n * unit)
		const protectedB = { accounting: await accounting(poolB), victim: await position(poolB), attacker: await position(poolB, attacker), rep: await repBalance(poolB), eth: await getETHBalance(owner(), poolB) }
		await base.mockWindow.advanceTime(30n * DAY)
		await fixture.refreshPrice(base.questionId)
		await updateVaultFees(owner(), poolA, vault)
		const victimOpenInterest = await owner().readContract({ abi: poolArtifact.abi, address: poolA, functionName: 'getVaultOpenInterestAttoEth', args: [vault] })
		await fixture.submit(base.questionId, unwind(600n * unit), { sender: other(), vault: attacker })
		await redeemFees(other(), poolA, attacker)
		expect(await getETHBalance(owner(), attacker)).toBeGreaterThan(0n)
		expect(await repBalance(attacker)).toBe(822n * unit)
		expect(await fixture.repClaim(poolA, attacker)).toBe(0n)
		expect(await fixture.repClaim(poolA)).toBe(1_000n * unit)
		expect((await position(poolA)).underwritingLimitAttoEth).toBe(100n * unit)
		// Native proportional exposure moves to the remaining underwriter, within its existing limit.
		expect(await owner().readContract({ abi: poolArtifact.abi, address: poolA, functionName: 'getVaultOpenInterestAttoEth', args: [vault] })).toBeGreaterThan(victimOpenInterest)
		expect(await repBalance(vault)).toBe(111n * unit)
		expect({ accounting: await accounting(poolB), victim: await position(poolB), attacker: await position(poolB, attacker), rep: await repBalance(poolB), eth: await getETHBalance(owner(), poolB) }).toEqual(protectedB)
		await expect(fixture.submit(secondQuestionId, unwind(700n * unit), { sender: other(), vault })).rejects.toThrow('Only vault owner')
		expect(await fixture.repClaim(poolB)).toBe(700n * unit)
		expect(await fixture.repClaim(poolB, attacker)).toBe(400n * unit)
		const aAfterExit = await accounting(poolA)
		expect(await getETHBalance(owner(), poolA)).toBe(aAfterExit.settlementCollateralAttoEth + aAfterExit.totalClaimableVaultFeesAttoEth + aAfterExit.unallocatedAccruedFeesAttoEth)
	})

	test('permissionless late registration cannot pledge existing capital, dilute claims, change owner policy or extend the old fee epoch', async () => {
		const { owner, other, base, vault, portfolio } = fixture
		const poolA = base.securityPoolAddresses.securityPool
		await fixture.allocate(base.questionId)
		await fixture.transferRep(vault, 250n * unit)
		await createCompleteSet(owner(), poolA, 50n * unit)
		const question = makeQuestion('Late outsider registration with ten more years', base.questionData.endTime + 3_650n * DAY)
		const questionId = getQuestionId(question, base.outcomes)
		await createQuestion(other(), question, base.outcomes)
		await base.mockWindow.setTime(base.questionData.endTime - DAY)
		await fixture.refreshPrice(base.questionId)
		const config = { universeId: base.genesisUniverse, executor: other().account.address, expiresAt: question.endTime, depositBudgetAttoRep: 200n * unit, commitmentIncreaseBudgetAttoEth: 20n * unit, minimumIdleAttoRep: 50n * unit, minimumHealthFactorBps: 12_000n }
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'setAllocationPolicy', args: [0n, 0n, config, [{ questionId: base.questionId, depositBudgetAttoRep: 200n * unit, maximumCommitmentAttoEth: 120n * unit }]] }))
		const policy = async () => await owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicy' })
		const protectedState = { vault: await position(poolA), accounting: await accounting(poolA), poolRep: await repBalance(poolA), poolEth: await getETHBalance(owner(), poolA), claim: await fixture.repClaim(poolA), policy: await policy() }
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))
		expect({ vault: await position(poolA), accounting: await accounting(poolA), poolRep: await repBalance(poolA), poolEth: await getETHBalance(owner(), poolA), claim: await fixture.repClaim(poolA), policy: await policy() }).toEqual(protectedState)
		expect(await repBalance(vault)).toBe(250n * unit)
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyVersion' })).toBe(1n)
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyNonce' })).toBe(0n)
		const newPool = fixture.poolFor(questionId).securityPool
		expect(await repBalance(newPool)).toBe(0n)
		expect(await fixture.repClaim(newPool)).toBe(0n)
		await expect(createCompleteSet(other(), newPool, unit)).rejects.toThrow()
		await expect(writeContractAndWait(other(), () => other().writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'executeAllocation', args: [1n, 0n, questionId, 200n * unit, 20n * unit] }))).rejects.toThrow('Question not approved by policy')
		expect(await policy()).toEqual(protectedState.policy)
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyNonce' })).toBe(0n)
		expect(await repBalance(vault)).toBe(250n * unit)
		expect(await repBalance(newPool)).toBe(0n)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await updateVaultFees(owner(), poolA, vault)
		const ended = await position(poolA)
		expect(ended.claimableFeesAttoEth).toBeGreaterThan(0n)
		await base.mockWindow.advanceTime(100n * DAY)
		await updateVaultFees(other(), poolA, vault)
		expect(await position(poolA)).toEqual(ended)
		expect((await accounting(poolA)).lastUpdatedFeeAccumulator).toBe(base.questionData.endTime)
		await redeemFees(other(), poolA, vault)
		expect(await getETHBalance(owner(), vault)).toBe(ended.claimableFeesAttoEth)
		await redeemCompleteSet(owner(), poolA, 50n * unit)
		await fixture.refreshPrice(base.questionId)
		await fixture.submit(base.questionId, unwind(1_000n * unit))
		expect(await repBalance(vault)).toBe(1_250n * unit)
		expect(await fixture.repClaim(poolA)).toBe(0n)
		expect(await repBalance(newPool)).toBe(0n)
	})

	test('new same-question underwriting shares only future fees while historical fees and the other question remain owned', async () => {
		const { owner, other, base, vault, secondQuestionId } = fixture
		const attacker = await fixture.createVault(other())
		const poolA = base.securityPoolAddresses.securityPool
		const poolB = fixture.poolFor(secondQuestionId).securityPool
		await fixture.allocate(base.questionId, 1_000n * unit, 100n * unit)
		await fixture.allocate(secondQuestionId, 500n * unit, 50n * unit)
		await createCompleteSet(owner(), poolA, 50n * unit)
		await createCompleteSet(owner(), poolB, 20n * unit)
		await base.mockWindow.advanceTime(30n * DAY)
		await redeemFees(other(), poolA, vault)
		const paidHistory = await getETHBalance(owner(), vault)
		expect(paidHistory).toBeGreaterThan(0n)
		const protectedB = { accounting: await accounting(poolB), vault: await position(poolB), rep: await repBalance(poolB), eth: await getETHBalance(owner(), poolB) }
		await fixture.allocate(base.questionId, 1_000n * unit, 100n * unit, other(), attacker)
		expect((await position(poolA, attacker)).claimableFeesAttoEth).toBe(0n)
		expect(await getETHBalance(owner(), attacker)).toBe(0n)
		expect(await getETHBalance(owner(), vault)).toBe(paidHistory)
		expect((await accounting(poolA)).feeEligibleUnderwritingLimitAttoEth).toBe(200n * unit)
		await checkpointTogether(poolA, [vault, attacker])
		const victimBefore = (await position(poolA)).claimableFeesAttoEth
		const attackerBefore = (await position(poolA, attacker)).claimableFeesAttoEth
		await base.mockWindow.advanceTime(30n * DAY)
		await checkpointTogether(poolA, [vault, attacker])
		const victimEarned = (await position(poolA)).claimableFeesAttoEth - victimBefore
		const attackerEarned = (await position(poolA, attacker)).claimableFeesAttoEth - attackerBefore
		expect(victimEarned).toBeGreaterThan(0n)
		expect(victimEarned > attackerEarned ? victimEarned - attackerEarned : attackerEarned - victimEarned).toBeLessThanOrEqual(1n)
		expect(await fixture.repClaim(poolA)).toBe(1_000n * unit)
		expect(await fixture.repClaim(poolA, attacker)).toBe(1_000n * unit)
		expect({ accounting: await accounting(poolB), vault: await position(poolB), rep: await repBalance(poolB), eth: await getETHBalance(owner(), poolB) }).toEqual(protectedB)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await checkpointTogether(poolA, [vault, attacker])
		const victimFees = (await position(poolA)).claimableFeesAttoEth
		const attackerFees = (await position(poolA, attacker)).claimableFeesAttoEth
		await redeemFees(other(), poolA, vault)
		await redeemFees(owner(), poolA, attacker)
		expect(await getETHBalance(owner(), vault)).toBe(paidHistory + victimFees)
		expect(await getETHBalance(owner(), attacker)).toBe(attackerFees)
		const after = await accounting(poolA)
		expect(await getETHBalance(owner(), poolA)).toBe(after.settlementCollateralAttoEth + after.totalClaimableVaultFeesAttoEth + after.unallocatedAccruedFeesAttoEth)
	})

	for (const donation of [1n, unit + 1n, 137n * unit + 7n]) {
		for (const reverseExit of [false, true]) {
			test(`a ${donation} attoREP donation stays in its native question and late depositors cannot extract rounding profit (${reverseExit ? 'reverse' : 'forward'} exits)`, async () => {
				const { owner, other, base, vault, secondQuestionId } = fixture
				const attacker = await fixture.createVault(other())
				const lateOwner = createWriteClient(base.mockWindow, TEST_ADDRESSES[2])
				const lateVault = await fixture.createVault(lateOwner)
				const poolA = base.securityPoolAddresses.securityPool
				const poolB = fixture.poolFor(secondQuestionId).securityPool
				await fixture.allocate(base.questionId, 500n * unit, 50n * unit)
				await fixture.allocate(secondQuestionId, 700n * unit + 3n, 0n)
				await fixture.allocate(secondQuestionId, 300n * unit + 7n, 0n, other(), attacker)
				const protectedA = { position: await position(poolA), accounting: await accounting(poolA), rep: await repBalance(poolA) }
				const initialBacking = await repBalance(poolB)
				await fixture.transferRep(poolB, donation, other())
				const victimClaim = await fixture.repClaim(poolB)
				const attackerClaim = await fixture.repClaim(poolB, attacker)
				expect(victimClaim).toBeGreaterThanOrEqual(700n * unit + 3n)
				expect(attackerClaim).toBeGreaterThanOrEqual(300n * unit + 7n)
				expect(initialBacking + donation - victimClaim - attackerClaim).toBeLessThanOrEqual(1n)
				const minimum = await owner().readContract({ abi: poolArtifact.abi, address: poolB, functionName: 'minimumVaultRepDepositAttoRep' })
				const lateDeposit = minimum + 17n
				await fixture.transferRep(lateVault, lateDeposit, lateOwner)
				await fixture.submit(secondQuestionId, { ...emptyOperations(), depositAttoRep: lateDeposit }, { sender: lateOwner, vault: lateVault })
				expect(await fixture.repClaim(poolB, lateVault)).toBeLessThanOrEqual(lateDeposit)
				expect(await fixture.repClaim(poolB)).toBeGreaterThanOrEqual(victimClaim)
				expect(await fixture.repClaim(poolB, attacker)).toBeGreaterThanOrEqual(attackerClaim)
				await fixture.refreshPrice(secondQuestionId)
				await fixture.submit(secondQuestionId, unwind(lateDeposit), { sender: lateOwner, vault: lateVault })
				const latePayout = await repBalance(lateVault)
				expect(latePayout).toBeLessThanOrEqual(lateDeposit)
				expect(lateDeposit - latePayout).toBeLessThanOrEqual(1n)
				expect(await fixture.repClaim(poolB, lateVault)).toBe(0n)
				const exits = [
					{ sender: owner(), vault, minimum: victimClaim },
					{ sender: other(), vault: attacker, minimum: attackerClaim },
				]
				if (reverseExit) exits.reverse()
				for (const exit of exits) {
					const claim = await fixture.repClaim(poolB, exit.vault)
					await fixture.submit(secondQuestionId, unwind(claim), { sender: exit.sender, vault: exit.vault })
					expect(await repBalance(exit.vault)).toBeGreaterThanOrEqual(exit.minimum)
					expect(await fixture.repClaim(poolB, exit.vault)).toBe(0n)
				}
				expect((await repBalance(vault)) + (await repBalance(attacker)) + latePayout).toBe(initialBacking + donation + lateDeposit)
				expect(await repBalance(poolB)).toBe(0n)
				expect({ position: await position(poolA), accounting: await accounting(poolA), rep: await repBalance(poolA) }).toEqual(protectedA)
			})
		}
	}

	test('a portfolio owners losing escalation stake does not consume its other question or another owners REP', async () => {
		const { owner, other, base, vault, secondQuestionId } = fixture
		const attacker = await fixture.createVault(other())
		const poolA = base.securityPoolAddresses.securityPool
		const poolB = fixture.poolFor(secondQuestionId).securityPool
		await fixture.allocate(base.questionId, 1_000n * unit, 0n)
		await fixture.allocate(base.questionId, 500n * unit, 0n, other(), attacker)
		await fixture.allocate(secondQuestionId, 700n * unit, 70n * unit)
		await fixture.allocate(secondQuestionId, 300n * unit, 30n * unit, other(), attacker)
		await fixture.transferRep(vault, 111n * unit)
		await fixture.transferRep(attacker, 222n * unit, other())
		const protectedB = { victim: await position(poolB), attacker: await position(poolB, attacker), accounting: await accounting(poolB), rep: await repBalance(poolB) }
		const nativeOwnerClaim = await fixture.repClaim(poolA, owner().account.address)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await fixture.refreshPrice(base.questionId)
		await fixture.execute(poolA, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [QuestionOutcome.Yes, 2n * base.reportBond] }))
		await fixture.execute(poolA, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [QuestionOutcome.No, base.reportBond] }), 0n, other(), attacker)
		const losingStake = (await position(poolA, attacker)).disputeStakedAttoRep
		const winningStake = (await position(poolA)).disputeStakedAttoRep
		expect(losingStake).toBe(base.reportBond)
		expect(winningStake).toBe(2n * base.reportBond)
		expect(await fixture.repClaim(poolA, attacker)).toBe(500n * unit - losingStake)
		await base.mockWindow.advanceTime(10n * DAY)
		await fixture.execute(poolA, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.No, [0n]] }), 0n, other(), attacker)
		await fixture.execute(poolA, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.Yes, [0n]] }))
		expect((await position(poolA, attacker)).disputeStakedAttoRep).toBe(0n)
		expect(await repBalance(attacker)).toBe(222n * unit)
		expect(await fixture.repClaim(poolA, attacker)).toBe(500n * unit - losingStake)
		expect(await repBalance(vault)).toBeGreaterThanOrEqual(111n * unit + winningStake)
		expect(await fixture.repClaim(poolA)).toBe(1_000n * unit - winningStake)
		expect(await fixture.repClaim(poolA, owner().account.address)).toBe(nativeOwnerClaim)
		expect({ victim: await position(poolB), attacker: await position(poolB, attacker), accounting: await accounting(poolB), rep: await repBalance(poolB) }).toEqual(protectedB)
		await fixture.refreshPrice(secondQuestionId)
		await fixture.submit(secondQuestionId, unwind(300n * unit), { sender: other(), vault: attacker })
		expect(await repBalance(attacker)).toBe(522n * unit)
		expect(await fixture.repClaim(poolB, attacker)).toBe(0n)
		expect(await fixture.repClaim(poolB)).toBe(700n * unit)
	})
})
