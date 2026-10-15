import { describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getSecurityVault, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares, getRequestPriceCostAttoEth, requestPriceWithValue } from '../../testSupport/simulator/utils/contracts/statoblast'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: automatic portfolio underwriting', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const idle = (vault = fixture.vault) => getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), vault)
	const nonce = (vault = fixture.vault) => fixture.owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyNonce' })
	const enable = async (reserve = 100n * unit, health = 12_000n, sender = fixture.owner(), vault = fixture.vault) => {
		const version = await sender.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyVersion' })
		return writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'setAutomaticUnderwriting', args: [version, 0n, reserve, health, 100n, 0n] }))
	}
	const mint = async (questionId = fixture.base.questionId, value = 100n * unit, contributions = [{ vault: fixture.vault, maximumCommitmentIncreaseAttoEth: value }], recipient = fixture.other().account.address, minimumShares = 0n) =>
		writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [questionId, contributions, recipient, minimumShares, value], value: value + 10n * unit }))
	const prepare = async () => {
		await fixture.transferRep(fixture.vault, 5_000n * unit)
		await fixture.refreshPrices([fixture.base.questionId, fixture.secondQuestionId])
		await enable()
	}

	test('funding a new vault backs paid minting without an enable transaction', async () => {
		await fixture.transferRep(fixture.vault, 5_000n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		expect([...(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'automaticUnderwriting' }))]).toEqual([true, 0n, 12_000n, 100n, 10n ** 15n])
		await mint()
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
		expect(await nonce()).toBe(1n)
	})

	test('requires owner authorization to change settings and restricts allocation to the atomic paid-mint route', async () => {
		await fixture.transferRep(fixture.vault, 5_000n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await expect(enable(0n, 10_000n, fixture.other())).rejects.toThrow('Only vault owner')
		await expect(enable(0n, 9_999n)).rejects.toThrow('Policy health factor below one')
		await enable()
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocateForMint', args: [fixture.base.questionId, unit] }))).rejects.toThrow('Only portfolio')
		expect(await idle()).toBe(5_000n * unit)
		expect(await nonce()).toBe(0n)
	})

	test('paid mint assigns only needed backing and transfers every outcome to the chosen buyer', async () => {
		await prepare()
		await mint()
		const minimum = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'minimumVaultRepDepositAttoRep' })
		const expectedBacking = minimum > 240n * unit ? minimum : 240n * unit
		expect(await fixture.repClaim(pool())).toBe(expectedBacking)
		expect(await idle()).toBe(5_000n * unit - expectedBacking)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([100n * unit, 100n * unit, 100n * unit])
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.portfolio)).toEqual([0n, 0n, 0n])
		expect(await nonce()).toBe(1n)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'getAllocatedQuestions', args: [0n, 64n] })).toEqual([fixture.base.questionId])
		await expect(enable()).rejects.toThrow('Allocation authorization changed')
	})

	test('two consenting owners fund one mint without sharing their REP claims', async () => {
		await prepare()
		const otherVault = await fixture.createVault(fixture.other())
		await fixture.transferRep(otherVault, 5_000n * unit, fixture.other())
		await enable(100n * unit, 12_000n, fixture.other(), otherVault)
		await mint(fixture.base.questionId, 100n * unit, [
			{ vault: fixture.vault, maximumCommitmentIncreaseAttoEth: 50n * unit },
			{ vault: otherVault, maximumCommitmentIncreaseAttoEth: 50n * unit },
		])
		const ownRep = await fixture.repClaim(pool())
		const otherRep = await fixture.repClaim(pool(), otherVault)
		expect(ownRep).toBe(otherRep)
		expect(ownRep).toBeGreaterThanOrEqual(120n * unit)
		expect(await idle()).toBe(5_000n * unit - ownRep)
		expect(await idle(otherVault)).toBe(5_000n * unit - otherRep)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(50n * unit)
		expect((await getSecurityVault(fixture.owner(), pool(), otherVault)).underwritingLimitAttoEth).toBe(50n * unit)
	})

	test('automatic backing rounds safely when donated REP changes the backing-unit exchange rate', async () => {
		await prepare()
		await fixture.transferRep(pool(), 13n * unit + 1n)
		const originalOwnerClaim = await fixture.base.getVaultRepClaim(fixture.owner().account.address)
		await mint()
		expect(await fixture.repClaim(pool())).toBeGreaterThanOrEqual(240n * unit)
		expect(await fixture.base.getVaultRepClaim(fixture.owner().account.address)).toBeGreaterThanOrEqual(originalOwnerClaim)
		expect(await idle()).toBeGreaterThanOrEqual(4_760n * unit - 2n)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
	})

	test('failed minting on a newly deployed question rolls back its portfolio registration', async () => {
		await prepare()
		const question = makeQuestion('Failed automatic registration', (await fixture.base.mockWindow.getTime()) + DAY)
		await createQuestion(fixture.owner(), question, fixture.base.outcomes)
		const questionId = getQuestionId(question, fixture.base.outcomes)
		await expect(mint(questionId, 100n * unit, undefined, undefined, 101n * unit)).rejects.toThrow('Minimum shares not met')
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'questionCount' })).toBe(2n)
		await expect(fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'getPool', args: [questionId, fixture.base.genesisUniverse] })).rejects.toThrow('Question not registered')
		expect(await idle()).toBe(5_000n * unit)
		expect(await nonce()).toBe(0n)
		const retry = await mint(questionId)
		expect((await fixture.other().waitForTransactionReceipt({ hash: retry })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		expect(await nonce()).toBe(1n)
	})

	test('unused existing capacity leaves idle REP and delegated authority untouched even with a stale price', async () => {
		await fixture.refreshPrice(fixture.base.questionId)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		await fixture.transferRep(fixture.vault, 5_000n * unit)
		await fixture.base.mockWindow.advanceTime(301n)
		await mint(fixture.base.questionId, 10n * unit)
		expect(await idle()).toBe(5_000n * unit)
		expect(await nonce()).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(0n)
	})

	test('allocates only the deficit and keeps different question backing independently reserved', async () => {
		await prepare()
		await setUnderwritingLimit(fixture.owner(), pool(), 40n * unit)
		await mint()
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(60n * unit)
		const firstBacking = await fixture.repClaim(pool())
		await mint(fixture.secondQuestionId, 50n * unit)
		expect(await fixture.repClaim(pool())).toBe(firstBacking)
		expect((await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(50n * unit)
		expect(await nonce()).toBe(2n)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'getAllocatedQuestions', args: [0n, 64n] })).toEqual([fixture.base.questionId, fixture.secondQuestionId])
	})

	test('rejects stale and pending oracle state without staging an allocation', async () => {
		await prepare()
		await fixture.base.mockWindow.advanceTime(301n)
		await expect(mint()).rejects.toThrow('Allocation needs settled fresh price')
		const coordinator = fixture.base.securityPoolAddresses.openOraclePriceCoordinator
		await requestPriceWithValue(fixture.owner(), coordinator, await getRequestPriceCostAttoEth(fixture.owner(), coordinator), unit)
		await expect(mint()).rejects.toThrow('Allocation needs settled fresh price')
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
		expect(await idle()).toBe(5_000n * unit)
		expect(await nonce()).toBe(0n)
	})

	test('an idle reserve failure rolls back all allocation accounting', async () => {
		await prepare()
		await enable(4_900n * unit)
		await expect(mint()).rejects.toThrow('Policy idle reserve violated')
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await nonce()).toBe(0n)
	})

	test('a later withdrawing contribution rolls back the first owner deposit and nonce', async () => {
		await prepare()
		const otherVault = await fixture.createVault(fixture.other())
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: otherVault, functionName: 'requestWithdrawal' }))
		await expect(
			mint(fixture.base.questionId, 100n * unit, [
				{ vault: fixture.vault, maximumCommitmentIncreaseAttoEth: 50n * unit },
				{ vault: otherVault, maximumCommitmentIncreaseAttoEth: 50n * unit },
			]),
		).rejects.toThrow('Withdrawal active')
		expect(await idle()).toBe(5_000n * unit)
		expect(await nonce()).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
	})

	test.each(['share minimum', 'nonreceiver recipient'])('a final mint failure (%s) rolls back collateral, backing, and policy spending', async failure => {
		await prepare()
		const recipient = failure === 'share minimum' ? fixture.other().account.address : getRepTokenAddress(fixture.base.genesisUniverse)
		await expect(mint(fixture.base.questionId, 100n * unit, undefined, recipient, failure === 'share minimum' ? 101n * unit : 0n)).rejects.toThrow()
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await nonce()).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
	})

	test('owner execution preserves automatic backing and its configured settings', async () => {
		await prepare()
		await fixture.execute(pool(), encodeFunctionData({ abi: poolArtifact.abi, functionName: 'setUnderwritingLimit', args: [0n] }))
		await mint()
		expect(await idle()).toBeLessThan(5_000n * unit)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
	})

	test('revoking delegated authority never disables automatic backing', async () => {
		await prepare()
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'revokeAllocationPolicy' }))
		await mint()
		expect(await nonce()).toBe(1n)
	})

	test('ended questions and a forked universe cannot consume automatic authority', async () => {
		await prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await expect(mint()).rejects.toThrow('Question has already ended')
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await expect(mint(fixture.secondQuestionId)).rejects.toThrow('Universe already forked')
		expect(await idle()).toBe(5_000n * unit)
		expect(await nonce()).toBe(0n)
	})

	test('a thirty-day portfolio admits the exact horizon and rejects one second beyond it', async () => {
		const { base, owner } = fixture
		await base.mockWindow.setTime(base.questionData.endTime - 29n * DAY)
		const deployment = await owner().sendTransaction({ data: encodeDeployData({ abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object), args: [getInfraContractAddresses().securityPoolFactory, pool(), 30n * DAY] }) })
		const receipt = await owner().waitForTransactionReceipt({ hash: deployment })
		const portfolio: Address | undefined = receipt.contractAddress
		if (!portfolio) throw new Error('Missing horizon portfolio')
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [base.questionId] }))
		const endTime = (await base.mockWindow.getTime()) + 31n * DAY
		const question = makeQuestion('Exact automatic horizon', endTime)
		await createQuestion(owner(), question, base.outcomes)
		const questionId = getQuestionId(question, base.outcomes)
		const register = () => writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))
		await base.mockWindow.setTime(endTime - 30n * DAY - 2n)
		await expect(register()).rejects.toThrow('Question exceeds pool horizon')
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'questionCount' })).toBe(1n)
		await base.mockWindow.setTime(endTime - 30n * DAY - 1n)
		await register()
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'questionCount' })).toBe(2n)
		await base.mockWindow.setTime(endTime)
		await expect(writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createCompleteSet', args: [questionId, [], owner().account.address, 0n, unit], value: unit }))).rejects.toThrow('Question has already ended')
	})
})
