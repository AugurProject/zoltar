import { describe, expect, test } from 'bun:test'
import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityVault, redeemCompleteSet, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: automatic capital reservation compensation', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const eth = (address: Address) => getETHBalance(fixture.owner(), address)
	const idle = () => getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)
	const quote = (increase = 100n * unit, questionId = fixture.base.questionId, vault = fixture.vault) => fixture.owner().readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'quoteAllocationForMint', args: [questionId, increase] })
	const enable = async (feeBps = 100n, minimumFee = 0n, sender = fixture.owner(), vault = fixture.vault) => {
		const version = await sender.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyVersion' })
		const nonce = await sender.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'allocationPolicyNonce' })
		return writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'setAutomaticUnderwriting', args: [version, nonce, 100n * unit, 12_000n, feeBps, minimumFee] }))
	}
	const prepare = async (feeBps = 100n, minimumFee = 0n) => {
		await fixture.transferRep(fixture.vault, 5_000n * unit)
		await fixture.refreshPrices([fixture.base.questionId, fixture.secondQuestionId])
		await enable(feeBps, minimumFee)
	}
	const mint = (amount = 100n * unit, budget = 10n * unit, questionId = fixture.base.questionId, contributions = [{ vault: fixture.vault, maximumCommitmentIncreaseAttoEth: amount }], minimumShares = 0n, recipient = fixture.other().account.address) =>
		writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [questionId, contributions, recipient, minimumShares, amount], value: amount + budget }))

	test('a dust buyer cannot reserve the native minimum without paying the owner reservation fee', async () => {
		await prepare()
		await expect(mint(1_000_000_000n, 0n)).rejects.toThrow('Reservation fee exceeds budget')
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await eth(fixture.vault)).toBe(0n)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })).toBe(0n)
	})

	test('fragmenting dust over two questions compensates each full minimum without spending the idle reserve', async () => {
		await prepare()
		let totalDeposits = 0n
		let totalFees = 0n
		for (const questionId of [fixture.base.questionId, fixture.secondQuestionId]) {
			const nativePool = fixture.poolFor(questionId).securityPool
			const minimum = await fixture.owner().readContract({ abi: poolArtifact.abi, address: nativePool, functionName: 'minimumVaultRepDepositAttoRep' })
			const [deposit, fee] = await quote(1_000_000_000n, questionId)
			expect(deposit).toBe(minimum)
			expect(fee).toBe((minimum + 99n) / 100n)
			await mint(1_000_000_000n, fee, questionId)
			expect(await fixture.repClaim(nativePool)).toBe(minimum)
			totalDeposits += deposit
			totalFees += fee
		}
		expect(await eth(fixture.vault)).toBe(totalFees)
		expect(await idle()).toBe(5_000n * unit - totalDeposits)
		expect(await idle()).toBeGreaterThanOrEqual(100n * unit)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'requestWithdrawal' }))
		for (const questionId of [fixture.base.questionId, fixture.secondQuestionId]) {
			await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'processWithdrawal', args: [questionId, fixture.base.genesisUniverse] }))
			expect(await fixture.repClaim(fixture.poolFor(questionId).securityPool)).toBeGreaterThan(0n)
		}
		expect(await eth(fixture.vault)).toBe(totalFees)
	})

	test('fee budgets and forced ETH do not become share collateral or contribute to refunds', async () => {
		await prepare()
		await fixture.base.mockWindow.setBalance(fixture.portfolio, 3n * unit)
		const [, fee] = await quote()
		const payerBefore = await eth(fixture.other().account.address)
		const hash = await mint()
		const receipt = await fixture.other().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price in mint receipt')
		expect(payerBefore - (await eth(fixture.other().account.address))).toBe(100n * unit + fee + receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await eth(fixture.portfolio)).toBe(3n * unit)
		expect(await eth(fixture.vault)).toBe(fee)
		expect(await eth(pool())).toBe(100n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([100n * unit, 100n * unit, 100n * unit])
	})

	test('redeeming complete sets cannot recover the fee paid to another owner', async () => {
		await prepare()
		const [, fee] = await quote()
		await mint()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		expect(await eth(fixture.vault)).toBe(fee)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBe(0n)
		expect(await eth(fixture.portfolio)).toBe(0n)
	})

	test('predeposited backing with no commitment still incurs its reservation fee', async () => {
		await fixture.allocate(fixture.base.questionId, 1_000n * unit, 0n)
		await prepare()
		const [deposit, fee] = await quote()
		expect(deposit).toBe(0n)
		expect(fee).toBe((24n * unit) / 10n)
		await mint()
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		expect(await eth(fixture.vault)).toBe(fee)
	})

	test('commitment expansion funded entirely from excess backing is charged only for newly reserved capital', async () => {
		await fixture.allocate(fixture.base.questionId, 1_000n * unit, 100n * unit)
		await prepare()
		const [deposit, fee] = await quote()
		expect(deposit).toBe(0n)
		expect(fee).toBe((24n * unit) / 10n)
		await mint(200n * unit)
		expect(await fixture.repClaim(pool())).toBe(1_000n * unit)
		expect(await eth(fixture.vault)).toBe(fee)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).underwritingLimitAttoEth).toBe(200n * unit)
	})

	test('a price-induced top-up is included in the reservation fee', async () => {
		await prepare()
		await mint()
		const feesBefore = await eth(fixture.vault)
		await manipulatePriceOracle(fixture.owner(), fixture.base.mockWindow, fixture.base.securityPoolAddresses.openOraclePriceCoordinator, 2n * unit)
		const [deposit, fee] = await quote()
		expect(deposit).toBe(720n * unit)
		expect(fee).toBe((36n * unit) / 10n)
		// The remaining native capacity can only reduce the actual deficit and fee.
		await mint(100n * unit)
		const feesAfter = await eth(fixture.vault)
		expect(feesAfter - feesBefore).toBeLessThanOrEqual(fee)
		expect(feesAfter - feesBefore).toBeGreaterThan((35n * unit) / 10n)
	})

	test('existing capacity consumes no allocation fee or authority, even if the caller budgets extra ETH', async () => {
		await fixture.refreshPrice(fixture.base.questionId)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		await mint(50n * unit)
		expect(await eth(fixture.vault)).toBe(0n)
		expect(await eth(fixture.portfolio)).toBe(0n)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })).toBe(0n)
	})

	test('the owner minimum allocation fee applies when no additional native-minimum backing is needed', async () => {
		await prepare(100n, unit)
		await mint(1_000_000_000n)
		const [, fee] = await quote(1_000_000_000n)
		expect(fee).toBe(unit)
		const feesBefore = await eth(fixture.vault)
		await mint(1_000_000_000n)
		expect(await eth(fixture.vault)).toBe(feesBefore + unit)
	})

	test('each contributing owner receives its own fee and insufficient aggregate budget rolls everything back', async () => {
		await prepare()
		const secondVault = await fixture.createVault(fixture.other())
		await fixture.transferRep(secondVault, 5_000n * unit, fixture.other())
		await enable(200n, 0n, fixture.other(), secondVault)
		const contributions = [
			{ vault: fixture.vault, maximumCommitmentIncreaseAttoEth: 50n * unit },
			{ vault: secondVault, maximumCommitmentIncreaseAttoEth: 50n * unit },
		]
		const [, firstFee] = await quote(50n * unit)
		const [, secondFee] = await quote(50n * unit, fixture.base.questionId, secondVault)
		await expect(mint(100n * unit, firstFee + secondFee - 1n, fixture.base.questionId, contributions)).rejects.toThrow('Reservation fee exceeds budget')
		expect(await eth(fixture.vault)).toBe(0n)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await idle()).toBe(5_000n * unit)
		await mint(100n * unit, firstFee + secondFee, fixture.base.questionId, contributions)
		expect(await eth(fixture.vault)).toBe(firstFee)
		expect(await eth(secondVault)).toBe(secondFee)
	})

	test('a final share slippage failure rolls back paid reservation fees, deposits and nonce', async () => {
		await prepare()
		await expect(mint(100n * unit, 10n * unit, fixture.base.questionId, undefined, 101n * unit)).rejects.toThrow('Minimum shares not met')
		expect(await eth(fixture.vault)).toBe(0n)
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool())).toBe(0n)
		expect(await eth(pool())).toBe(0n)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })).toBe(0n)
	})

	test('owner fee increases cannot exceed the buyer budget approved before the change', async () => {
		await prepare()
		const [, oldFee] = await quote()
		await enable(1_000n)
		await expect(mint(100n * unit, oldFee)).rejects.toThrow('Reservation fee exceeds budget')
		expect(await idle()).toBe(5_000n * unit)
		expect(await eth(fixture.vault)).toBe(0n)
	})

	test('only the owner can collect vault ETH, without revoking automatic underwriting or spending REP', async () => {
		await prepare()
		await mint()
		const fee = await eth(fixture.vault)
		const reserveBefore = await idle()
		const authorityBefore = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'automaticUnderwriting' })
		const nonceBefore = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'getEthBalance' })).toBe(fee)
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawEth' }))).rejects.toThrow('Only vault owner')
		const before = await eth(fixture.owner().account.address)
		const hash = await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawEth' }))
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price in withdrawal receipt')
		expect(await eth(fixture.owner().account.address)).toBe(before + fee - receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await eth(fixture.vault)).toBe(0n)
		expect(await idle()).toBe(reserveBefore)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'automaticUnderwriting' })).toEqual(authorityBefore)
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })).toBe(nonceBefore)
		await expect(writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'withdrawEth' }))).rejects.toThrow('No ETH available')
	})

	test('rejects a zero or excessive fee rate and underfunded mint collateral', async () => {
		await expect(enable(0n)).rejects.toThrow('Invalid reservation fee rate')
		await expect(enable(10_001n)).rejects.toThrow('Invalid reservation fee rate')
		await expect(mint(100n * unit, -1n)).rejects.toThrow('Mint collateral not funded')
	})
})
