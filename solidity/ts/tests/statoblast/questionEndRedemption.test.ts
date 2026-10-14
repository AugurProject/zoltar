import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { createCompleteSet, depositToEscalationGame, getRepToken, getSecurityVault, redeemFees, redeemRepFromVault, redeemShares, setUnderwritingLimit, withdrawFromEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getQuestionOutcome, initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { approveAndDepositRepToVault, manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture } from './fixture'

const unit = 10n ** 18n
const abi = statoblast_SecurityPool_SecurityPool.abi

describe('Statoblast: question end and final REP redemption', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const pool = () => fixture.securityPoolAddresses.securityPool
	const seedCommitment = async () => {
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator)
		await setUnderwritingLimit(fixture.client, pool(), 10n * unit)
	}
	const accounting = () => fixture.client.readContract({ abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
	const supply = () => fixture.client.readContract({ abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
	const checkpoint = async (vault = fixture.client.account.address) => writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'updateVaultFees', args: [vault] }))

	test('allows the final pre-end mint at end minus one second', async () => {
		await seedCommitment()
		await fixture.mockWindow.setTime(fixture.questionData.endTime - 2n)
		await createCompleteSet(fixture.client, pool(), unit)
		expect(await fixture.mockWindow.getTime()).toBe(fixture.questionData.endTime - 1n)
		expect(await supply()).toBe(unit)
	})

	test.each([{ offset: 0n }, { offset: 1n }])('rejects minting at question end plus $offset seconds before any escalation exists', async ({ offset }) => {
		await seedCommitment()
		await fixture.mockWindow.setTime(fixture.questionData.endTime + offset - 1n)
		await expect(createCompleteSet(fixture.client, pool(), unit)).rejects.toThrow('Question ended')
		expect(await fixture.mockWindow.getTime()).toBe(fixture.questionData.endTime + offset)
		expect(await supply()).toBe(0n)
		expect((await accounting()).settlementCollateralAttoEth).toBe(0n)
	})

	test('keeps outstanding collateral secured after question end until an outcome is final', async () => {
		await seedCommitment()
		await createCompleteSet(fixture.client, pool(), 8n * unit)
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		expect(await getQuestionOutcome(fixture.client, pool())).toBe(QuestionOutcome.None)
		await expect(setUnderwritingLimit(fixture.client, pool(), 0n)).rejects.toThrow('Commitments below collateral')
		await expect(redeemRepFromVault(fixture.client, pool(), fixture.client.account.address)).rejects.toThrow('Question not final')
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).underwritingLimitAttoEth).toBe(10n * unit)
	})

	test('releases finalized REP while preserving outstanding winning shares, fees, and another vault backing', async () => {
		const { client, mockWindow, repDeposit, questionId } = fixture
		const otherOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const shareOwner = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await approveAndDepositRepToVault(otherOwner, repDeposit, questionId)
		await seedCommitment()
		await setUnderwritingLimit(otherOwner, pool(), 10n * unit)
		await mockWindow.setTime(fixture.questionData.endTime - DAY)
		await createCompleteSet(shareOwner, pool(), 18n * unit)
		await fixture.finalizeQuestionAsYesWithoutFork()
		await withdrawFromEscalationGame(client, pool(), QuestionOutcome.Yes, [0n])
		await checkpoint()
		await checkpoint(otherOwner.account.address)
		const before = await accounting()
		const beforeSupply = await supply()
		const otherBefore = await getSecurityVault(client, pool(), otherOwner.account.address)
		const otherRepBefore = await fixture.getVaultRepClaim(otherOwner.account.address)
		const ownRep = await fixture.getVaultRepClaim(client.account.address)
		const repToken = await getRepToken(client, pool())
		const walletRepBefore = await getERC20Balance(client, repToken, client.account.address)
		const poolEthBefore = await client.getBalance({ address: pool() })
		expect(before.settlementCollateralAttoEth).toBeGreaterThan(10n * unit)
		expect(before.totalClaimableVaultFeesAttoEth).toBeGreaterThan(0n)
		await expect(redeemRepFromVault(client, pool(), client.account.address)).rejects.toThrow('Exit commitment before REP redemption')
		await expect(redeemRepFromVault(otherOwner, pool(), client.account.address)).rejects.toThrow('Unauthorized')

		await setUnderwritingLimit(client, pool(), 0n)
		await redeemRepFromVault(client, pool(), client.account.address)
		const after = await accounting()
		expect(after.totalUnderwritingLimitAttoEth).toBe(10n * unit)
		expect(after.settlementCollateralAttoEth).toBe(before.settlementCollateralAttoEth)
		expect(after.totalClaimableVaultFeesAttoEth).toBe(before.totalClaimableVaultFeesAttoEth)
		expect(after.unallocatedAccruedFeesAttoEth).toBe(before.unallocatedAccruedFeesAttoEth)
		expect(await supply()).toBe(beforeSupply)
		expect(await client.getBalance({ address: pool() })).toBe(poolEthBefore)
		expect(await getERC20Balance(client, repToken, client.account.address)).toBe(walletRepBefore + ownRep)
		expect((await getSecurityVault(client, pool(), client.account.address)).repBackingUnits).toBe(0n)
		await expect(redeemRepFromVault(client, pool(), client.account.address)).rejects.toThrow('No redeemable REP')
		expect(await getSecurityVault(client, pool(), otherOwner.account.address)).toEqual(otherBefore)
		expect(await fixture.getVaultRepClaim(otherOwner.account.address)).toBe(otherRepBefore)

		await setUnderwritingLimit(otherOwner, pool(), 0n)
		await redeemRepFromVault(otherOwner, pool(), otherOwner.account.address)
		expect((await accounting()).totalUnderwritingLimitAttoEth).toBe(0n)
		await redeemShares(shareOwner, pool())
		expect(await client.getBalance({ address: pool() })).toBe(poolEthBefore - before.settlementCollateralAttoEth)
		expect(await supply()).toBe(0n)
		await redeemFees(client, pool(), client.account.address)
		await redeemFees(otherOwner, pool(), otherOwner.account.address)
		const finalAccounting = await accounting()
		expect(finalAccounting.settlementCollateralAttoEth).toBe(0n)
		expect(finalAccounting.totalClaimableVaultFeesAttoEth).toBe(0n)
		expect(await client.getBalance({ address: pool() })).toBe(finalAccounting.unallocatedAccruedFeesAttoEth)
	})

	test('final commitment release does not bypass escrow settlement before REP redemption', async () => {
		await seedCommitment()
		await createCompleteSet(fixture.client, pool(), 8n * unit)
		await fixture.finalizeQuestionAsYesWithoutFork()
		await setUnderwritingLimit(fixture.client, pool(), 0n)
		await expect(redeemRepFromVault(fixture.client, pool(), fixture.client.account.address)).rejects.toThrow('Escrow locked')
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).disputeStakedAttoRep).toBe(fixture.reportBond)
		await withdrawFromEscalationGame(fixture.client, pool(), QuestionOutcome.Yes, [0n])
		await redeemRepFromVault(fixture.client, pool(), fixture.client.account.address)
		expect(await supply()).toBe(8n * unit)
	})

	test.each([{ offset: 0n }, { offset: 1n }])('uses fork-aware finality for commitment release when the fork starts at escalation end plus $offset', async ({ offset }) => {
		const { client, mockWindow, questionData, outcomes, genesisUniverse, reportBond, securityPoolAddresses } = fixture
		await seedCommitment()
		await createCompleteSet(client, pool(), 8n * unit)
		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
		await depositToEscalationGame(client, pool(), QuestionOutcome.Yes, reportBond)
		const gameEnd = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: securityPoolAddresses.escalationGame, functionName: 'getEscalationGameEndDate' })
		const forkQuestion = { ...questionData, title: 'final REP exit external fork', endTime: gameEnd - 1n }
		await createQuestion(client, forkQuestion, outcomes)
		await approveToken(client, await getRepToken(client, pool()), getZoltarAddress())
		await mockWindow.setTime(gameEnd + offset - 1n)
		await forkUniverse(client, genesisUniverse, getQuestionId(forkQuestion, outcomes))
		await mockWindow.advanceTime(1n)
		if (offset === 0n) {
			expect(await getQuestionOutcome(client, pool())).toBe(QuestionOutcome.None)
			await expect(setUnderwritingLimit(client, pool(), 0n)).rejects.toThrow('Forked')
			await expect(redeemRepFromVault(client, pool(), client.account.address)).rejects.toThrow('Question not final')
		} else {
			expect(await getQuestionOutcome(client, pool())).toBe(QuestionOutcome.Yes)
			await expect(initiateSecurityPoolFork(client, pool())).rejects.toThrow('Resolved')
			await setUnderwritingLimit(client, pool(), 0n)
			await withdrawFromEscalationGame(client, pool(), QuestionOutcome.Yes, [0n])
			await redeemRepFromVault(client, pool(), client.account.address)
			expect(await supply()).toBe(8n * unit)
		}
	})
})
