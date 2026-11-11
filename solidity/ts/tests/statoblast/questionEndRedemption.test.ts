import { describe, expect, test } from 'bun:test'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { redeemShares } from '../../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: question end and portfolio principal redemption', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const supply = () => fixture.owner().readContract({ ...pool(), functionName: 'shareTokenSupplyAttoShares' })
	const demand = () => fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })
	const withdraw = (amount: bigint) => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [amount, fixture.owner().account.address] }))
	const finalize = async () => {
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(fixture.other(), getRepTokenAddress(fixture.base.genesisUniverse), pool().address)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.Yes, 100n * unit] }))
		const game = { abi: gameArtifact.abi, address: await fixture.owner().readContract({ ...pool(), functionName: 'escalationGame' }) }
		const end = await fixture.owner().readContract({ ...game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 60n)
		return game
	}

	test('allows the final pre-end mint at end minus one second', async () => {
		await fixture.prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - 600n)
		await fixture.refreshPrice()
		const collateral = await fixture.other().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'collateralToken' })
		const services = await fixture.other().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'services' })
		await approveToken(fixture.other(), collateral, services)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - 2n)
		await fixture.mint(unit)
		expect(await fixture.base.mockWindow.getTime()).toBe(fixture.base.questionData.endTime - 1n)
		expect(await supply()).toBe(unit)
	})

	test.each([0n, 1n])('rejects minting at question end plus %s seconds before any report', async offset => {
		await fixture.prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - 600n)
		await fixture.refreshPrice()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + offset)
		await expect(fixture.mint(unit)).rejects.toThrow('Question ended')
		expect(await supply()).toBe(0n)
		expect(await demand()).toBe(0n)
	})

	test('question end alone does not release the capital backing outstanding shares', async () => {
		await fixture.prepare(1_000n * unit, 10n * unit)
		await fixture.mint(8n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		await fixture.authorize(0n)
		expect(await demand()).toBeGreaterThan(0n)
		await expect(withdraw(1_000n * unit)).rejects.toThrow()
		expect(await supply()).toBeGreaterThan(0n)
	})

	test('finality releases owner principal while preserving outstanding winning shares and reporter claims', async () => {
		await fixture.prepare(1_000n * unit, 10n * unit)
		await fixture.mint(8n * unit)
		const game = await finalize()
		await fixture.refreshPrice()
		await fixture.authorize(0n)
		const beforeSupply = await supply()
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		const before = await getERC20Balance(fixture.owner(), token, fixture.owner().account.address)
		await withdraw(1_000n * unit)
		expect(await getERC20Balance(fixture.owner(), token, fixture.owner().account.address)).toBe(before + 1_000n * unit)
		expect(await demand()).toBe(0n)
		expect(await supply()).toBe(beforeSupply)
		// Reporting uses wallet REP; it neither escrows nor delays another owner's principal.
		expect(await fixture.owner().readContract({ ...game, functionName: 'totalDisputeStakedAttoRep' })).toBe(100n * unit)
		await expect(withdraw(1n)).rejects.toThrow()
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.Yes, [0n]] }))
		await redeemShares(fixture.other(), pool().address)
		const shares = await balanceOfShares(fixture.other(), fixture.poolFor(fixture.base.questionId).shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		expect(shares[QuestionOutcome.Yes]).toBe(0n)
		expect(await supply()).toBe(0n)
	})
})
