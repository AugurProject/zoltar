import { describe, expect, test } from 'bun:test'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createCompleteSet, getSecurityVault, getSystemState, redeemCompleteSet, redeemShares, withdrawFromEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { finalizeTruthAuction, getQuestionOutcome, initiateSecurityPoolFork, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { advancePastOrdinaryEscalationDeadline, depositOrdinaryEscalationPrincipals, ordinaryEscalationPrincipals, withdrawFirstDepositOfEachOutcome } from '../residualCaptureHelpers'

describe('Statoblast: owner-requested portfolio runoff', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const repToken = () => getRepTokenAddress(fixture.base.genesisUniverse)
	const balance = (account = fixture.owner().account.address) => getERC20Balance(fixture.owner(), repToken(), account)
	const request = (sender = fixture.owner(), vault = fixture.vault) => writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'requestWithdrawal' }))
	const cancel = (sender = fixture.owner(), vault = fixture.vault) => writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'cancelWithdrawal' }))
	const allowForfeiture = (allowed = true, sender = fixture.owner()) => writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'setWithdrawalResidualForfeiture', args: [allowed] }))
	const process = (questionId = fixture.base.questionId, sender = fixture.other(), vault = fixture.vault) => writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'processWithdrawal', args: [questionId, fixture.base.genesisUniverse] }))
	const enable = async () => {
		const version = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyVersion' })
		const nonce = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })
		return writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'setAutomaticUnderwriting', args: [version, nonce, 0n, 10_000n, 100n, 0n] }))
	}
	const accounting = () => fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
	const checkpoint = (vault = fixture.vault) => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'updateVaultFees', args: [vault] }))
	const ordinaryResolution = async () => {
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice(fixture.base.questionId)
		await depositOrdinaryEscalationPrincipals(fixture.owner(), pool())
		return await advancePastOrdinaryEscalationDeadline(fixture.owner(), fixture.base.mockWindow, pool())
	}

	test('final runoff collects sweepable ordinary residual before burning the withdrawing owners backing units', async () => {
		const otherVault = await fixture.createVault(fixture.other())
		await fixture.allocate(fixture.base.questionId)
		await fixture.allocate(fixture.base.questionId, 1_000n * unit, 100n * unit, fixture.other(), otherVault)
		const game = await ordinaryResolution()
		await withdrawFirstDepositOfEachOutcome(fixture.other(), pool())
		const residual = await balance(game)
		expect(residual).toBe(ordinaryEscalationPrincipals.lowLosingPrincipal)
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'totalDisputeStakedAttoRep' })).toBe(0n)
		const totalUnits = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'totalRepBackingUnits' })
		const poolRep = await balance(pool())
		const ownUnits = (await getSecurityVault(fixture.owner(), pool(), fixture.vault)).repBackingUnits
		const otherUnits = (await getSecurityVault(fixture.owner(), pool(), otherVault)).repBackingUnits
		const expectedPayout = (ownUnits * (poolRep + residual)) / totalUnits
		const expectedOtherClaim = (otherUnits * (poolRep + residual - expectedPayout)) / (totalUnits - ownUnits)
		const ownerBefore = await balance()
		const callerBefore = await balance(fixture.other().account.address)
		await request()
		await process()
		expect(await balance()).toBe(ownerBefore + expectedPayout)
		expect(await balance(game)).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await fixture.repClaim(pool(), otherVault)).toBe(expectedOtherClaim)
		expect(await balance(fixture.other().account.address)).toBe(callerBefore)
		await process()
		expect(await balance()).toBe(ownerBefore + expectedPayout)
	})

	test('default final runoff preserves ordinary residual rights while another depositor remains unsettled', async () => {
		await fixture.allocate(fixture.base.questionId)
		const game = await ordinaryResolution()
		await request()
		const before = await getSecurityVault(fixture.owner(), pool(), fixture.vault)
		const ownerBefore = await balance()
		await expect(process()).rejects.toThrow('Ordinary residual unsettled')
		expect(await getSecurityVault(fixture.owner(), pool(), fixture.vault)).toEqual(before)
		expect(await balance()).toBe(ownerBefore)
		await withdrawFirstDepositOfEachOutcome(fixture.other(), pool())
		await process()
		expect(await balance()).toBeGreaterThan(ownerBefore + 1_000n * unit)
		expect(await balance(game)).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(0n)
	})

	test('unresolved ordinary claims require forfeiture consent before REP exit while harmless commitment reductions remain available', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice(fixture.base.questionId)
		await depositOrdinaryEscalationPrincipals(fixture.owner(), pool())
		expect(await getQuestionOutcome(fixture.owner(), pool())).toBe(QuestionOutcome.None)
		await request()
		const before = await balance()
		await expect(process()).rejects.toThrow('Ordinary residual unsettled')
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		expect(await balance()).toBe(before)
		await fixture.base.mockWindow.advanceTime(301n)
		await process()
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await expect(process()).rejects.toThrow('Ordinary residual unsettled')
		await allowForfeiture()
		await process()
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await balance()).toBe(before + 1_000n * unit)
		expect(await getQuestionOutcome(fixture.owner(), pool())).toBe(QuestionOutcome.None)
	})

	test('only explicit owner consent permits early exit while ordinary residual remains unsettled', async () => {
		await fixture.allocate(fixture.base.questionId)
		const game = await ordinaryResolution()
		await request()
		await expect(allowForfeiture(true, fixture.other())).rejects.toThrow('Only vault owner')
		await allowForfeiture()
		await allowForfeiture(false)
		await expect(process()).rejects.toThrow('Ordinary residual unsettled')
		await allowForfeiture()
		const before = await balance()
		const escrowBefore = await balance(game)
		await process()
		expect(await balance()).toBe(before + 1_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await balance(game)).toBe(escrowBefore)
		await withdrawFirstDepositOfEachOutcome(fixture.other(), pool())
		const afterSettlement = await balance()
		await process()
		expect(await balance()).toBe(afterSettlement)
		expect(await balance(game)).toBe(ordinaryEscalationPrincipals.lowLosingPrincipal)
	})

	test('early-exit consent still collects already sweepable ordinary residual', async () => {
		await fixture.allocate(fixture.base.questionId)
		const game = await ordinaryResolution()
		await withdrawFirstDepositOfEachOutcome(fixture.other(), pool())
		await request()
		await allowForfeiture()
		const before = await balance()
		await process()
		expect(await balance()).toBeGreaterThan(before + 1_000n * unit)
		expect(await balance(game)).toBe(0n)
	})

	test('only the owner can start or cancel runoff, which immediately pays idle REP to that owner', async () => {
		await fixture.transferRep(fixture.vault, 300n * unit)
		await enable()
		await expect(request(fixture.other())).rejects.toThrow('Only vault owner')
		await expect(process()).rejects.toThrow('No withdrawal requested')
		await expect(allowForfeiture()).rejects.toThrow('No withdrawal requested')
		const ownerBefore = await balance()
		const callerBefore = await balance(fixture.other().account.address)
		const settings = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'automaticUnderwriting' })
		await request()
		expect(await balance()).toBe(ownerBefore + 300n * unit)
		expect(await balance(fixture.vault)).toBe(0n)
		expect(await balance(fixture.other().account.address)).toBe(callerBefore)
		expect((await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'automaticUnderwriting' }))[0]).toBe(false)
		await expect(fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'quoteAllocationForMint', args: [fixture.base.questionId, unit] })).rejects.toThrow('Withdrawal active')
		await expect(enable()).rejects.toThrow('Withdrawal active')
		await expect(request()).rejects.toThrow('Withdrawal already active')
		await expect(cancel(fixture.other())).rejects.toThrow('Only vault owner')
		await allowForfeiture()
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawalResidualForfeitureAllowed' })).toBe(true)
		await cancel()
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawalResidualForfeitureAllowed' })).toBe(false)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'automaticUnderwriting' })).toEqual(settings)
		await expect(process()).rejects.toThrow('No withdrawal requested')
		await fixture.transferRep(fixture.vault, 300n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		const [, reservationFee] = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'quoteAllocationForMint', args: [fixture.base.questionId, unit] })
		await writeContractAndWait(fixture.other(), () =>
			fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [fixture.base.questionId, [{ vault: fixture.vault, maximumCommitmentIncreaseAttoEth: unit }], fixture.other().account.address, 0n, unit], value: unit + reservationFee }),
		)
		await request()
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawalResidualForfeitureAllowed' })).toBe(false)
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'getWithdrawalRequests', args: [0n, 64n] })).toEqual([
			{ vault: fixture.vault, requestId: 1n },
			{ vault: fixture.vault, requestId: 2n },
		])
	})

	test('outstanding unresolved collateral keeps REP allocated while surplus commitment runs off', async () => {
		await fixture.allocate(fixture.base.questionId)
		await createCompleteSet(fixture.owner(), pool(), 80n * unit)
		await enable()
		await request()
		const ownerBefore = await balance()
		await process()
		const vault = await getSecurityVault(fixture.owner(), pool(), fixture.vault)
		expect(vault.underwritingLimitAttoEth).toBe((await accounting()).settlementCollateralAttoEth)
		expect(vault.underwritingLimitAttoEth).toBeGreaterThan(0n)
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		expect(await balance()).toBe(ownerBefore)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await process()
		expect(await getQuestionOutcome(fixture.owner(), pool())).toBe(QuestionOutcome.None)
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		expect(await balance()).toBe(ownerBefore)
	})

	test('stale runoff reduces an unused commitment without staging a future withdrawal', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.advanceTime(301n)
		await request()
		const ownerBefore = await balance()
		await process()
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
		await cancel()
		await fixture.refreshPrice(fixture.base.questionId)
		await expect(process()).rejects.toThrow('No withdrawal requested')
		expect(await balance()).toBe(ownerBefore)
		await request()
		const callerBefore = await balance(fixture.other().account.address)
		await process()
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await balance()).toBe(ownerBefore + 1_000n * unit)
		expect(await balance(fixture.other().account.address)).toBe(callerBefore)
	})

	test('complete-set redemption frees backing before question end and repeated processing cannot double-pay', async () => {
		await fixture.allocate(fixture.base.questionId)
		await createCompleteSet(fixture.owner(), pool(), 80n * unit)
		await request()
		await process()
		await redeemCompleteSet(fixture.owner(), pool(), 80n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		const before = await balance()
		await process()
		expect(await balance()).toBe(before + 1_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		await process()
		expect(await balance()).toBe(before + 1_000n * unit)
	})

	test('final runoff pays only its owner and leaves winning-share ETH, earned fees, and another owner backing intact', async () => {
		const { owner, other, base } = fixture
		const otherVault = await fixture.createVault(other())
		await fixture.allocate(base.questionId)
		await fixture.allocate(base.questionId, 1_000n * unit, 100n * unit, other(), otherVault)
		await base.mockWindow.setTime(base.questionData.endTime - DAY)
		await createCompleteSet(other(), pool(), 180n * unit)
		await base.finalizeQuestionAsYesWithoutFork()
		await withdrawFromEscalationGame(other(), pool(), QuestionOutcome.Yes, [0n])
		await checkpoint()
		await checkpoint(otherVault)
		const before = await accounting()
		const ethBefore = await owner().getBalance({ address: pool() })
		const otherBacking = await fixture.repClaim(pool(), otherVault)
		const otherPosition = await getSecurityVault(owner(), pool(), otherVault)
		const ownerBefore = await balance()
		await request()
		await process()
		expect(await balance()).toBe(ownerBefore + 1_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await fixture.repClaim(pool(), otherVault)).toBe(otherBacking)
		expect(await getSecurityVault(owner(), pool(), otherVault)).toEqual(otherPosition)
		expect((await accounting()).settlementCollateralAttoEth).toBe(before.settlementCollateralAttoEth)
		expect((await accounting()).totalClaimableVaultFeesAttoEth).toBe(before.totalClaimableVaultFeesAttoEth)
		expect(await owner().getBalance({ address: pool() })).toBe(ethBefore)
		await request(other(), otherVault)
		await process(base.questionId, owner(), otherVault)
		expect((await accounting()).totalUnderwritingLimitAttoEth).toBe(0n)
		await redeemShares(other(), pool())
		expect(await owner().getBalance({ address: pool() })).toBe(ethBefore - before.settlementCollateralAttoEth)
		await fixture.execute(pool(), encodeFunctionData({ abi: poolArtifact.abi, functionName: 'redeemFees', args: [fixture.vault] }))
		await fixture.execute(pool(), encodeFunctionData({ abi: poolArtifact.abi, functionName: 'redeemFees', args: [otherVault] }), 0n, other(), otherVault)
		expect((await accounting()).totalClaimableVaultFeesAttoEth).toBe(0n)
	})

	test('final escrow failure rolls back commitment release until the owner settles its dispute stake', async () => {
		const { base } = fixture
		await fixture.allocate(base.questionId)
		await base.mockWindow.setTime(base.questionData.endTime - DAY)
		await createCompleteSet(fixture.owner(), pool(), 80n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await fixture.refreshPrice(base.questionId)
		await fixture.execute(pool(), encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [QuestionOutcome.Yes, base.reportBond] }))
		await base.mockWindow.advanceTime(10n * DAY)
		await request()
		await expect(process()).rejects.toThrow('Ordinary residual unsettled')
		await allowForfeiture()
		await expect(process()).rejects.toThrow('Escrow locked')
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
		await fixture.execute(pool(), encodeFunctionData({ abi: poolArtifact.abi, functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.Yes, [0n]] }))
		const ownerBefore = await balance()
		await process()
		expect(await balance()).toBe(ownerBefore + 1_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect((await accounting()).settlementCollateralAttoEth).toBeGreaterThan(0n)
	})

	test('a pending request never chooses a fork branch or transfers another owner REP', async () => {
		await fixture.allocate(fixture.base.questionId)
		await createCompleteSet(fixture.owner(), pool(), 80n * unit)
		await request()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(fixture.owner(), repToken(), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await initiateSecurityPoolFork(fixture.owner(), pool())
		const before = await getSecurityVault(fixture.owner(), pool(), fixture.vault)
		const ownerBefore = await balance()
		await expect(process()).rejects.toThrow('Pool inactive')
		expect(await getSecurityVault(fixture.owner(), pool(), fixture.vault)).toEqual(before)
		expect(await balance()).toBe(ownerBefore)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawalRequested' })).toBe(true)
	})

	test('residual preservation does not block an owner-selected child with an inherited final outcome', async () => {
		const { base, owner, other, vault } = fixture
		await fixture.allocate(base.questionId, 1_000n * unit, 0n)
		await request()
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner(), repToken(), getZoltarAddress())
		await forkUniverse(owner(), base.genesisUniverse, base.questionId)
		await initiateSecurityPoolFork(owner(), pool())
		await fixture.prepareChild(pool(), QuestionOutcome.Yes)
		await fixture.prepareChildDependencies(pool(), QuestionOutcome.Yes)
		await fixture.execute(getInfraContractAddresses().securityPoolForker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'migrateVault', args: [pool(), BigInt(QuestionOutcome.Yes)] }))
		const childUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.Yes)
		const child = fixture.poolFor(base.questionId, childUniverse, pool()).securityPool
		await base.mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(owner(), child)
		if ((await getSystemState(owner(), child)) === SystemState.ForkTruthAuction) {
			await base.mockWindow.advanceTime(8n * DAY)
			await finalizeTruthAuction(owner(), child)
		}
		expect(await getQuestionOutcome(owner(), child)).toBe(QuestionOutcome.Yes)
		const expectedPayout = await fixture.repClaim(child)
		expect(expectedPayout).toBeGreaterThan(0n)
		const childRep = getRepTokenAddress(childUniverse)
		const before = await getERC20Balance(owner(), childRep, owner().account.address)
		await writeContractAndWait(other(), () => other().writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'processWithdrawal', args: [base.questionId, childUniverse] }))
		expect(await getERC20Balance(owner(), childRep, owner().account.address)).toBe(before + expectedPayout)
		expect(await fixture.repClaim(child)).toBe(0n)
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'withdrawalResidualForfeitureAllowed' })).toBe(false)
	})
})
