import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	ReputationToken_ReputationToken as repArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { forkUniverse, getMigrationRepBalanceAttoRep, getRepTokenAddress, getUniverseData, getZoltarAddress, getZoltarForkBurnDivisor, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { balanceOfShares, getLastPrice, getPendingReportId, getRequestPriceCostAttoEth, openOracleSettle, requestPriceWithValue, OperationType } from '../../testSupport/simulator/utils/contracts/statoblast'
import { manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { createCompleteSet, getSecurityVault, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getQuestionOutcome, initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { emptyOperations, unit, maximumQuestionHorizonSeconds, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio capital under shared and question-specific stress', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const repBalance = async (account: Address) => await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), account)
	const accounting = async (pool: Address) => await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'getPoolAccountingSnapshot' })
	const position = async (pool: Address, vault = fixture.vault) => await getSecurityVault(fixture.owner(), pool, vault)
	const factors = async (pool: Address, vault = fixture.vault) => await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'getVaultCapacityBackingFactorsBps', args: [vault] })
	const poolState = async (pool: Address) => ({ accounting: await accounting(pool), owner: await position(pool), rep: await repBalance(pool), eth: await getETHBalance(fixture.owner(), pool) })
	const trader = () => createWriteClient(fixture.base.mockWindow, TEST_ADDRESSES[2])
	const freshPrice = async (price: bigint) => await manipulatePriceOracle(fixture.owner(), fixture.base.mockWindow, fixture.base.securityPoolAddresses.openOraclePriceCoordinator, price)
	const removeUncommittedFixtureBacking = async () => {
		const { owner, base } = fixture
		await manipulatePriceOracleAndPerformOperation(owner(), base.mockWindow, base.securityPoolAddresses.openOraclePriceCoordinator, OperationType.WithdrawRep, owner().account.address, base.repDeposit, unit)
		expect(await repBalance(base.securityPoolAddresses.securityPool)).toBe(0n)
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool, owner().account.address)).toBe(0n)
	}
	const expectEthConserved = async (pool: Address) => {
		const state = await accounting(pool)
		expect(await getETHBalance(fixture.owner(), pool)).toBe(state.settlementCollateralAttoEth + state.totalClaimableVaultFeesAttoEth + state.unallocatedAccruedFeesAttoEth)
	}
	const redeemTrader = async (pool: Address, shareToken: Address, amount: bigint) => {
		const before = await getETHBalance(trader(), trader().account.address)
		const poolBefore = await getETHBalance(trader(), pool)
		const hash = await redeemCompleteSet(trader(), pool, amount)
		const receipt = await trader().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Trader redemption gas price missing')
		const paid = poolBefore - (await getETHBalance(trader(), pool))
		expect(paid).toBeGreaterThan(0n)
		expect((await getETHBalance(trader(), trader().account.address)) + receipt.gasUsed * receipt.effectiveGasPrice - before).toBe(paid)
		expect(await balanceOfShares(trader(), shareToken, fixture.base.genesisUniverse, trader().account.address)).toEqual([0n, 0n, 0n])
		expect((await accounting(pool)).settlementCollateralAttoEth).toBe(0n)
		await expectEthConserved(pool)
	}

	test('an underbacked A owner blocks a healthy A withdrawal without trapping the same owners excess B capital', async () => {
		const { owner, other, base, vault, secondQuestionId } = fixture
		await removeUncommittedFixtureBacking()
		const weakVault = await fixture.createVault(other())
		const poolA = base.securityPoolAddresses.securityPool
		const addressesB = fixture.poolFor(secondQuestionId)
		const poolB = addressesB.securityPool
		await fixture.allocate(base.questionId, 300n * unit, 50n * unit)
		await fixture.allocate(base.questionId, 200n * unit, 100n * unit, other(), weakVault)
		await fixture.allocate(secondQuestionId, 600n * unit, 100n * unit)
		await fixture.transferRep(vault, 37n * unit)
		await createCompleteSet(trader(), poolA, 25n * unit)
		await createCompleteSet(trader(), poolB, 20n * unit)
		await freshPrice(2n * unit)
		expect([...(await factors(poolA))]).toEqual([30_000n, 30_000n])
		expect([...(await factors(poolA, weakVault))]).toEqual([10_000n, 10_000n])
		// Withdrawing 50 REP would leave this vault above its 200 REP requirement,
		// but the pool would have only 450 REP against a 600 REP aggregate requirement.
		const protectedA = { pool: await poolState(poolA), weak: await position(poolA, weakVault) }
		const protectedB = await poolState(poolB)
		await expect(fixture.submit(base.questionId, { ...emptyOperations(), withdrawAttoRep: 50n * unit })).rejects.toThrow('Pool backing insufficient')
		expect({ pool: await poolState(poolA), weak: await position(poolA, weakVault) }).toEqual(protectedA)
		expect(await poolState(poolB)).toEqual(protectedB)
		expect(await repBalance(vault)).toBe(37n * unit)
		expect(await repBalance(weakVault)).toBe(0n)
		await fixture.submit(secondQuestionId, { ...emptyOperations(), withdrawAttoRep: 100n * unit })
		expect(await fixture.repClaim(poolB)).toBe(500n * unit)
		expect(await repBalance(vault)).toBe(137n * unit)
		expect({ pool: await poolState(poolA), weak: await position(poolA, weakVault) }).toEqual(protectedA)
		const bAfterWithdrawal = await poolState(poolB)
		const otherWalletBefore = await repBalance(other().account.address)
		await fixture.transferRep(weakVault, 200n * unit, other())
		await fixture.submit(base.questionId, { ...emptyOperations(), depositAttoRep: 200n * unit }, { sender: other(), vault: weakVault })
		await fixture.submit(base.questionId, { ...emptyOperations(), withdrawAttoRep: 50n * unit })
		expect(await repBalance(other().account.address)).toBe(otherWalletBefore - 200n * unit)
		expect(await repBalance(weakVault)).toBe(0n)
		expect(await fixture.repClaim(poolA, weakVault)).toBe(400n * unit)
		expect(await fixture.repClaim(poolA)).toBe(250n * unit)
		expect(await repBalance(poolA)).toBe(650n * unit)
		expect(await repBalance(vault)).toBe(187n * unit)
		expect(await poolState(poolB)).toEqual(bAfterWithdrawal)
		expect(await balanceOfShares(owner(), base.securityPoolAddresses.shareToken, base.genesisUniverse, trader().account.address)).toEqual([25n * unit, 25n * unit, 25n * unit])
		await expectEthConserved(poolA)
		await expectEthConserved(poolB)
		await redeemTrader(poolA, base.securityPoolAddresses.shareToken, 25n * unit)
		await redeemTrader(poolB, addressesB.shareToken, 20n * unit)
	})

	for (const multiplier of [2n, 4n]) {
		test(`a common ${multiplier}x REP-per-ETH shock needs an explicit A repair despite surplus B backing and idle reserve`, async () => {
			const { base, vault, secondQuestionId } = fixture
			await removeUncommittedFixtureBacking()
			const poolA = base.securityPoolAddresses.securityPool
			const addressesB = fixture.poolFor(secondQuestionId)
			const poolB = addressesB.securityPool
			const shortfall = (multiplier - 1n) * 200n * unit
			await fixture.allocate(base.questionId, 200n * unit, 100n * unit)
			await fixture.allocate(secondQuestionId, 2_000n * unit, 100n * unit)
			await fixture.transferRep(vault, shortfall + 50n * unit)
			await createCompleteSet(trader(), poolA, 40n * unit)
			await createCompleteSet(trader(), poolB, 60n * unit)
			await freshPrice(multiplier * unit)
			// Every question sees the same REP shock; collateral and repair duties remain separate.
			expect(await getLastPrice(fixture.owner(), base.securityPoolAddresses.openOraclePriceCoordinator)).toBe(multiplier * unit)
			expect(await getLastPrice(fixture.owner(), addressesB.openOraclePriceCoordinator)).toBe(multiplier * unit)
			expect((await factors(poolA))[0]).toBeLessThan(base.statoblastSecurityMultiplierBps)
			expect((await factors(poolB))[0]).toBe(200_000n / multiplier)
			const protectedA = await poolState(poolA)
			const protectedB = await poolState(poolB)
			await expect(fixture.submit(base.questionId, { ...emptyOperations(), withdrawAttoRep: 10n * unit })).rejects.toThrow('Vault backing insufficient')
			expect(await poolState(poolA)).toEqual(protectedA)
			expect(await poolState(poolB)).toEqual(protectedB)
			expect(await repBalance(vault)).toBe(shortfall + 50n * unit)
			expect(await fixture.repClaim(poolA)).toBe(200n * unit)
			expect(await fixture.repClaim(poolB)).toBe(2_000n * unit)
			await fixture.submit(base.questionId, { ...emptyOperations(), depositAttoRep: shortfall + 10n * unit })
			expect(await repBalance(vault)).toBe(40n * unit)
			await fixture.submit(base.questionId, { ...emptyOperations(), withdrawAttoRep: 10n * unit })
			expect([...(await factors(poolA))]).toEqual([20_000n, 20_000n])
			expect(await fixture.repClaim(poolA)).toBe(multiplier * 200n * unit)
			expect(await repBalance(vault)).toBe(50n * unit)
			expect(await poolState(poolB)).toEqual(protectedB)
			expect((await repBalance(poolA)) + (await repBalance(poolB)) + (await repBalance(vault))).toBe(2_250n * unit + shortfall)
			await expectEthConserved(poolA)
			await expectEthConserved(poolB)
			await redeemTrader(poolA, base.securityPoolAddresses.shareToken, 40n * unit)
			await redeemTrader(poolB, addressesB.shareToken, 60n * unit)
		})
	}

	test('different pools isolate capacity, fees, collateral and owner withdrawals for the same questions', async () => {
		const { owner, other, base, vault, portfolio, secondQuestionId } = fixture
		await removeUncommittedFixtureBacking()
		const poolA = base.securityPoolAddresses.securityPool
		const poolB = fixture.poolFor(secondQuestionId).securityPool
		const deploymentHash = await other().sendTransaction(
			buildPortfolioDeploymentRequest({ owner: other().account.address, factory: getInfraContractAddresses().securityPoolFactory, initialOriginPool: poolA, maximumQuestionHorizonSeconds, artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) } }),
		)
		const secondPortfolio = (await other().waitForTransactionReceipt({ hash: deploymentHash })).contractAddress
		if (!secondPortfolio) throw new Error('Second portfolio deployment address missing')
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'addQuestion', args: [base.questionId] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'createVault' }))
		const secondVault = await other().readContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'vaultOf', args: [other().account.address] })
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'addQuestion', args: [secondQuestionId] }))
		const otherA = fixture.poolFor(base.questionId, base.genesisUniverse, zeroAddress, secondPortfolio)
		const otherB = fixture.poolFor(secondQuestionId, base.genesisUniverse, zeroAddress, secondPortfolio)
		expect(otherA.securityPool).not.toBe(poolA)
		expect(otherA.shareToken).not.toBe(base.securityPoolAddresses.shareToken)
		expect(otherB.securityPool).not.toBe(poolB)
		await fixture.allocate(base.questionId, 600n * unit, 100n * unit)
		await fixture.allocate(base.questionId, 300n * unit, 50n * unit, other(), secondVault)
		await fixture.allocate(secondQuestionId, 500n * unit, 50n * unit)
		await fixture.allocate(secondQuestionId, 400n * unit, 40n * unit, other(), secondVault)
		await fixture.transferRep(vault, 111n * unit)
		await fixture.transferRep(secondVault, 222n * unit, other())
		// Neither pool can borrow the other pool's otherwise identical question capacity.
		await expect(createCompleteSet(trader(), poolA, 120n * unit)).rejects.toThrow()
		await createCompleteSet(trader(), poolA, 80n * unit)
		await createCompleteSet(trader(), otherA.securityPool, 40n * unit)
		await createCompleteSet(trader(), poolB, 20n * unit)
		await createCompleteSet(trader(), otherB.securityPool, 20n * unit)
		expect((await accounting(poolA)).feeEligibleUnderwritingLimitAttoEth).toBe(100n * unit)
		expect((await accounting(otherA.securityPool)).feeEligibleUnderwritingLimitAttoEth).toBe(50n * unit)
		const unwind = (amount: bigint) => ({ ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: amount })
		await fixture.refreshPrice(base.questionId)
		await expect(fixture.submit(base.questionId, unwind(600n * unit))).rejects.toThrow('Commitments below collateral')
		await base.mockWindow.advanceTime(30n * DAY)
		for (const [pool, account] of [
			[poolA, vault],
			[otherA.securityPool, secondVault],
		] as const)
			await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemFees', args: [account] }))
		const firstFees = await getETHBalance(owner(), vault)
		const secondFees = await getETHBalance(owner(), secondVault)
		expect(firstFees).toBeGreaterThan(0n)
		expect(secondFees).toBeGreaterThan(0n)
		expect(await getETHBalance(owner(), poolA)).toBe(80n * unit - firstFees)
		expect(await getETHBalance(owner(), otherA.securityPool)).toBe(40n * unit - secondFees)
		expect(await fixture.repClaim(poolA, secondVault)).toBe(0n)
		expect(await fixture.repClaim(otherA.securityPool)).toBe(0n)
		const protectedOther = await Promise.all([poolB, otherA.securityPool, otherB.securityPool].map(poolState))
		await expect(fixture.execute(getRepTokenAddress(base.genesisUniverse), encodeFunctionData({ abi: repArtifact.abi, functionName: 'transfer', args: [other().account.address, unit] }), 0n, other(), vault)).rejects.toThrow('Only vault owner')
		await redeemTrader(poolA, base.securityPoolAddresses.shareToken, 80n * unit)
		await fixture.refreshPrice(base.questionId)
		await fixture.submit(base.questionId, unwind(600n * unit))
		expect(await repBalance(vault)).toBe(711n * unit)
		expect(await fixture.repClaim(poolA)).toBe(0n)
		expect(await fixture.repClaim(otherA.securityPool, secondVault)).toBe(300n * unit)
		expect((await position(otherA.securityPool, secondVault)).underwritingLimitAttoEth).toBe(50n * unit)
		expect(await repBalance(secondVault)).toBe(222n * unit)
		expect(await Promise.all([poolB, otherA.securityPool, otherB.securityPool].map(poolState))).toEqual(protectedOther)
		for (const registry of [portfolio, secondPortfolio]) {
			expect(await repBalance(registry)).toBe(0n)
			expect(await getETHBalance(owner(), registry)).toBe(0n)
		}
		for (const pool of [poolA, poolB, otherA.securityPool, otherB.securityPool]) await expectEthConserved(pool)
	})

	test('an outside question fork freezes every separate pool in the universe while owners retain branch choice', async () => {
		const { owner, other, base, vault, portfolio, secondQuestionId } = fixture
		await removeUncommittedFixtureBacking()
		const deploymentHash = await other().sendTransaction(
			buildPortfolioDeploymentRequest({
				owner: other().account.address,
				factory: getInfraContractAddresses().securityPoolFactory,
				initialOriginPool: base.securityPoolAddresses.securityPool,
				maximumQuestionHorizonSeconds,
				artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) },
			}),
		)
		const secondPortfolio = (await other().waitForTransactionReceipt({ hash: deploymentHash })).contractAddress
		if (!secondPortfolio) throw new Error('Second portfolio deployment address missing')
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'addQuestion', args: [base.questionId] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'createVault' }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'addQuestion', args: [secondQuestionId] }))
		const secondVault = await other().readContract({ abi: portfolioArtifact.abi, address: secondPortfolio, functionName: 'vaultOf', args: [other().account.address] })
		const owners = [
			{ sender: owner(), account: vault, registry: portfolio, deposit: 500n * unit, commitment: 50n * unit },
			{ sender: other(), account: secondVault, registry: secondPortfolio, deposit: 300n * unit, commitment: 30n * unit },
		]
		const questionIds = [base.questionId, secondQuestionId]
		const positions = owners.flatMap(account => questionIds.map(questionId => ({ ...account, questionId, addresses: fixture.poolFor(questionId, base.genesisUniverse, zeroAddress, account.registry) })))
		for (const account of owners) {
			for (const questionId of questionIds) await fixture.allocate(questionId, account.deposit, account.commitment, account.sender, account.account)
			await fixture.transferRep(account.account, 200n * unit, account.sender)
			const config = { universeId: base.genesisUniverse, executor: trader().account.address, expiresAt: base.questionData.endTime, depositBudgetAttoRep: 100n * unit, commitmentIncreaseBudgetAttoEth: 20n * unit, minimumIdleAttoRep: 100n * unit, minimumHealthFactorBps: 10_000n }
			await writeContractAndWait(account.sender, () =>
				account.sender.writeContract({ abi: vaultArtifact.abi, address: account.account, functionName: 'setAllocationPolicy', args: [0n, 0n, config, questionIds.map(questionId => ({ questionId, depositBudgetAttoRep: 50n * unit, maximumCommitmentAttoEth: account.commitment + 10n * unit }))] }),
			)
		}
		for (const { addresses } of positions) await createCompleteSet(trader(), addresses.securityPool, 20n * unit)
		const forkInitiator = createWriteClient(base.mockWindow, TEST_ADDRESSES[3])
		const questionC = makeQuestion('External fork source outside every portfolio', (await base.mockWindow.getTime()) + DAY)
		const questionCId = getQuestionId(questionC, base.outcomes)
		await createQuestion(forkInitiator, questionC, base.outcomes)
		await base.mockWindow.setTime(questionC.endTime + 1n)
		const pendingReports: bigint[] = []
		let settlementTime = 0n
		for (const account of owners) {
			const coordinator = fixture.poolFor(base.questionId, base.genesisUniverse, zeroAddress, account.registry).openOraclePriceCoordinator
			await requestPriceWithValue(owner(), coordinator, await getRequestPriceCostAttoEth(owner(), coordinator), unit)
			pendingReports.push(await getPendingReportId(owner(), coordinator))
			const duration = await owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'settlementTime' })
			if (duration > settlementTime) settlementTime = duration
		}
		await base.mockWindow.advanceTime(settlementTime + 1n)
		for (const report of pendingReports) await openOracleSettle(owner(), report)
		expect(await base.mockWindow.getTime()).toBeLessThan(base.questionData.endTime)
		for (const registry of [portfolio, secondPortfolio]) {
			expect(await owner().readContract({ abi: portfolioArtifact.abi, address: registry, functionName: 'getQuestions', args: [0n, 64n] })).toEqual(questionIds)
			await expect(owner().readContract({ abi: portfolioArtifact.abi, address: registry, functionName: 'getPool', args: [questionCId, base.genesisUniverse] })).rejects.toThrow('Question not registered')
		}
		expect(await contractExists(owner(), fixture.poolFor(questionCId).securityPool)).toBe(false)
		const protectedPools = await Promise.all(positions.map(async ({ addresses }) => await poolState(addresses.securityPool)))
		const policies = await Promise.all(owners.map(async ({ account }) => await owner().readContract({ abi: vaultArtifact.abi, address: account, functionName: 'allocationPolicy' })))
		const initiatorRepBefore = await repBalance(forkInitiator.account.address)
		const forkThreshold = await getZoltarForkThreshold(owner(), base.genesisUniverse)
		const burnDivisor = await getZoltarForkBurnDivisor(owner())
		await approveToken(forkInitiator, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(forkInitiator, base.genesisUniverse, questionCId)
		expect((await getUniverseData(owner(), base.genesisUniverse)).forkQuestionId).toBe(questionCId)
		expect(await repBalance(forkInitiator.account.address)).toBe(initiatorRepBefore - forkThreshold)
		expect(await getMigrationRepBalanceAttoRep(owner(), base.genesisUniverse, forkInitiator.account.address)).toBe(forkThreshold - forkThreshold / burnDivisor)
		for (const { sender, account, commitment, questionId, addresses } of positions) {
			await expect(createCompleteSet(trader(), addresses.securityPool, unit)).rejects.toThrow('Forked')
			await expect(redeemCompleteSet(trader(), addresses.securityPool, unit)).rejects.toThrow('Forked')
			await expect(fixture.submit(questionId, { ...emptyOperations(), depositAttoRep: unit }, { sender, vault: account })).rejects.toThrow('Forked')
			await expect(fixture.submit(questionId, { ...emptyOperations(), withdrawAttoRep: unit }, { sender, vault: account })).rejects.toThrow('Forked')
			await expect(writeContractAndWait(trader(), () => trader().writeContract({ abi: vaultArtifact.abi, address: account, functionName: 'executeAllocation', args: [1n, 0n, questionId, unit, commitment] }))).rejects.toThrow('Allocation universe forked')
		}
		expect(await Promise.all(positions.map(async ({ addresses }) => await poolState(addresses.securityPool)))).toEqual(protectedPools)
		expect(await Promise.all(owners.map(async ({ account }) => await owner().readContract({ abi: vaultArtifact.abi, address: account, functionName: 'allocationPolicy' })))).toEqual(policies)
		const childUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.Yes)
		for (const { sender, account, registry, deposit, commitment, questionId, addresses } of positions) {
			const pool = addresses.securityPool
			const ethBefore = await getETHBalance(owner(), pool)
			await initiateSecurityPoolFork(owner(), pool)
			const settlementAtFork = (await accounting(pool)).settlementCollateralAttoEth
			await fixture.prepareChild(pool, QuestionOutcome.Yes)
			await fixture.prepareChildDependencies(pool, QuestionOutcome.Yes)
			await fixture.execute(getInfraContractAddresses().securityPoolForker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'migrateVault', args: [pool, BigInt(QuestionOutcome.Yes)] }), 0n, sender, account)
			expect(await fixture.repClaim(pool, account)).toBe(0n)
			const child = fixture.poolFor(questionId, childUniverse, pool, registry).securityPool
			expect(await fixture.repClaim(child, account)).toBe(deposit)
			expect((await position(child, account)).underwritingLimitAttoEth).toBe(commitment)
			expect(await getQuestionOutcome(owner(), child)).toBe(QuestionOutcome.None)
			expect(await repBalance(pool)).toBe(0n)
			expect(await getERC20Balance(owner(), getRepTokenAddress(childUniverse), child)).toBe(deposit)
			expect((await getETHBalance(owner(), pool)) + (await getETHBalance(owner(), child))).toBe(ethBefore)
			expect(await owner().readContract({ abi: portfolioArtifact.abi, address: registry, functionName: 'getPool', args: [questionId, childUniverse] })).toBe(child)
			await expectEthConserved(pool)
			expect(await getETHBalance(owner(), child)).toBe(settlementAtFork)
			expect(await balanceOfShares(trader(), addresses.shareToken, base.genesisUniverse, trader().account.address)).toEqual([20n * unit, 20n * unit, 20n * unit])
		}
		for (const { account } of owners) {
			expect(await repBalance(account)).toBe(200n * unit)
			expect(await owner().readContract({ abi: vaultArtifact.abi, address: account, functionName: 'allocationPolicyNonce' })).toBe(0n)
		}
	})
})
