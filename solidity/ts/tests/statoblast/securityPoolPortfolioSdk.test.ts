import { describe, expect, test } from 'bun:test'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioDepositRequest, buildPortfolioMintRequest, buildPortfolioPositionRebalanceRequest, loadPortfolioAggregateSnapshot, loadPortfolioMintQuote, loadPortfolioSnapshot, planPortfolioAllocations } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { portfolioEconomics, emptyOperations, maximumQuestionHorizonSeconds, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio SDK against native contracts', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const snapshot = async () => await loadPortfolioSnapshot({ client: fixture.owner(), portfolio: fixture.portfolio, vault: fixture.vault, universeIds: [fixture.base.genesisUniverse] })

	test('aggregate reads use public configuration links before the first question or owner vault exists', async () => {
		const client = fixture.owner()
		const hash = await client.sendTransaction(
			buildPortfolioDeploymentRequest({
				owner: client.account.address,
				factory: getInfraContractAddresses().securityPoolFactory,
				vaultDeployer: getInfraContractAddresses().securityPoolPortfolioVaultDeployer,
				initialOriginPool: fixture.base.securityPoolAddresses.securityPool,
				maximumQuestionHorizonSeconds,
				questionAdmissionPolicy: fixture.questionAdmissionPolicy,
				economics: portfolioEconomics,
				artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) },
			}),
		)
		const { contractAddress: portfolio } = await client.waitForTransactionReceipt({ hash })
		if (portfolio === null || portfolio === undefined) throw new Error('Portfolio deployment address missing')
		expect(await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'questionCount' })).toBe(0n)
		const empty = await loadPortfolioAggregateSnapshot({ client, portfolio, owner: client.account.address })
		expect(empty).toMatchObject({ originUniverseId: fixture.base.genesisUniverse, forkTime: 0n, repToken: getRepTokenAddress(fixture.base.genesisUniverse), shares: 0n, totalShares: 0n, assetsAttoRep: 0n, allowanceAttoRep: 0n, positionCount: 0n, positionStart: 0n, positions: [], questionCount: 0n, questions: [] })
		expect(empty.walletAttoRep).toBeGreaterThan(100n * unit)
		await approveToken(client, empty.repToken, portfolio)
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioDepositRequest({ owner: client.account.address, portfolio, amountAttoRep: 100n * unit, minimumShares: 100n * unit, maximumOwnershipFeeAttoEth: 0n })))
		const funded = await loadPortfolioAggregateSnapshot({ client, portfolio, owner: client.account.address })
		expect(funded).toMatchObject({ shares: 100n * unit, totalShares: 100n * unit, assetsAttoRep: 100n * unit, ownerAssetsAttoRep: 100n * unit, reserveAttoRep: 100n * unit, positionCount: 0n, positions: [], questionCount: 0n, questions: [] })
		expect((await client.getBlock({ blockNumber: funded.blockNumber })).hash).toBe(funded.blockHash)
	})

	test('aggregate SDK decodes reserve quotes, allocation claims and selected maintenance from the contract ABI', async () => {
		const client = fixture.owner()
		const owner = client.account.address
		const portfolio = fixture.portfolio
		await approveToken(client, getRepTokenAddress(fixture.base.genesisUniverse), portfolio)
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioDepositRequest({ owner, portfolio, amountAttoRep: 5_000n * unit, minimumShares: 5_000n * unit, maximumOwnershipFeeAttoEth: 0n })))
		await fixture.refreshPrice(fixture.base.questionId)
		const funded = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
		const quote = await loadPortfolioMintQuote({ client, snapshot: funded, questionId: fixture.base.questionId, mintAttoEth: 100n * unit })
		expect(quote.depositAttoRep).toBeGreaterThan(0n)
		expect(quote.availableAttoRep).toBe(5_000n * unit)
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioMintRequest({ trader: owner, portfolio, recipient: owner, questionId: fixture.base.questionId, mintAttoEth: 100n * unit, maximumPurchaseFeeAttoEth: quote.purchaseFeeAttoEth, minimumShares: 0n })))
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioPositionRebalanceRequest({ processor: owner, portfolio, positionId: 1n })))
		const allocated = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
		expect(allocated.positionCount).toBe(1n)
		expect(allocated.positions).toHaveLength(1)
		expect(allocated.positions[0]).toMatchObject({ positionId: 1n, questionId: fixture.base.questionId, ownerShares: 5_000n * unit, reusable: true })
		expect(allocated.assetsAttoRep).toBe(allocated.reserveAttoRep)
		expect(allocated.assetsAttoRep).toBeLessThan(5_000n * unit)
		expect(allocated.questions).toEqual([fixture.base.questionId, fixture.secondQuestionId])
	})

	test('a pinned snapshot decodes real pool accounting and its buffered plan executes with matching balances', async () => {
		await fixture.transferRep(fixture.vault, 2_100n * unit)
		await fixture.refreshPrices([fixture.base.questionId, fixture.secondQuestionId])
		const before = await snapshot()
		expect(before.owner).toBe(fixture.owner().account.address)
		expect(before.questions).toEqual([fixture.base.questionId, fixture.secondQuestionId])
		expect(before.coverage).toMatchObject({ complete: true, registryComplete: true, issues: [] })
		const branch = before.branches[0]
		if (!branch) throw new Error('Missing genesis branch')
		expect(branch.idleAttoRep).toBe(2_100n * unit)
		expect(branch.positions.map(position => position.backingAttoRep)).toEqual([0n, 0n])
		expect(branch.positions.every(position => position.price === unit && position.priceValid)).toBe(true)
		const plan = planPortfolioAllocations({
			snapshot: before,
			universeId: fixture.base.genesisUniverse,
			minimumIdleAttoRep: 100n * unit,
			minimumHealthFactorBps: 12_000n,
			allocations: [
				{ questionId: fixture.base.questionId, depositAttoRep: 1_000n * unit, commitmentAttoEth: 100n * unit },
				{ questionId: fixture.secondQuestionId, depositAttoRep: 500n * unit, commitmentAttoEth: 50n * unit },
			],
		})
		expect(plan.idleAfterAttoRep).toBe(600n * unit)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'submitQuestionOperationsBatch', args: [plan.operations, plan.requireImmediate] }))
		const after = await snapshot()
		const nextBranch = after.branches[0]
		if (!nextBranch) throw new Error('Missing updated genesis branch')
		expect(nextBranch.idleAttoRep).toBe(plan.idleAfterAttoRep)
		expect(nextBranch.positions.map(position => ({ questionId: position.questionId, backingAfterAttoRep: position.backingAttoRep, commitmentAttoEth: position.commitmentAttoEth }))).toEqual(plan.previews)
		expect(nextBranch.positions.every(position => position.queuedOperations.length === 0)).toBe(true)
		expect((await fixture.owner().getBlock({ blockNumber: after.blockNumber })).hash).toBe(after.blockHash)
	})

	test('real queued tuples remain pending exposure and the snapshot never credits withdrawal proceeds as idle REP', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { price: unit, value: funding.cost })
		const current = await snapshot()
		const branch = current.branches[0]
		if (!branch) throw new Error('Missing genesis branch')
		const position = branch.positions.find(candidate => candidate.questionId === fixture.base.questionId)
		if (!position) throw new Error('Missing queued question')
		expect(current.coverage.complete).toBe(true)
		expect(position.backingAttoRep).toBe(1_000n * unit)
		expect(position.commitmentAttoEth).toBe(100n * unit)
		expect(position.pendingReportId).toBeGreaterThan(0n)
		expect(position.queuedOperations).toHaveLength(1)
		expect(position.queuedOperations[0]?.operator).toBe(fixture.vault)
		expect(branch.idleAttoRep).toBeLessThan(1_000n * unit)
		expect(() => planPortfolioAllocations({ snapshot: current, universeId: fixture.base.genesisUniverse, minimumIdleAttoRep: 0n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: fixture.base.questionId, depositAttoRep: unit, commitmentAttoEth: 100n * unit }] })).toThrow(
			'needs a settled, fresh oracle price',
		)
	})

	test('filtered native queue logs recover older vault operations beyond the bounded global page', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { price: unit, value: funding.cost })
		const coordinator = fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator
		await expect(fixture.execute(coordinator, encodeFunctionData({ abi: coordinatorArtifact.abi, functionName: 'requestPriceIfNeededAndStageOperation', args: [1, fixture.vault, unit, 301n, 0n, 0n, 0n] }))).rejects.toThrow('Staged operation timeout exceeds the maximum allowed')
		await fixture.execute(coordinator, encodeFunctionData({ abi: coordinatorArtifact.abi, functionName: 'requestPriceIfNeededAndStageOperation', args: [1, fixture.vault, unit, 300n, 0n, 0n, 0n] }))
		const current = await loadPortfolioSnapshot({ client: fixture.owner(), portfolio: fixture.portfolio, vault: fixture.vault, universeIds: [fixture.base.genesisUniverse], maximumOperations: 1 })
		const position = current.branches[0]?.positions.find(candidate => candidate.questionId === fixture.base.questionId)
		if (!position) throw new Error('Missing queued question')
		expect(position.queuedOperations).toHaveLength(2)
		expect(position.queuedOperations.every(operation => operation.operator === fixture.vault)).toBe(true)
		expect(position.allocationOperationsComplete).toBe(true)
		const withdrawal = position.queuedOperations.find(operation => operation.operationType === 1n)
		if (!withdrawal) throw new Error('Missing native withdrawal operation')
		const expiry = withdrawal.queuedAt + position.settlementTime + withdrawal.validForSeconds
		await fixture.base.mockWindow.setTime(expiry)
		expect((await fixture.owner().getBlock()).timestamp).toBe(expiry)
		await expect(fixture.owner().simulateContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'expireStagedOperation', args: [withdrawal.operationId] })).rejects.toThrow('Staged operation active')
		await fixture.base.mockWindow.setTime(expiry + 1n)
		await fixture.owner().simulateContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'expireStagedOperation', args: [withdrawal.operationId] })
	})
})
