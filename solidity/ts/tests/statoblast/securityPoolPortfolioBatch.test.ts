import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { handleOracleReporting } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { emptyOperations, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio question batches and contract owners', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const operation = (questionId: bigint, input: VaultOperationsInput = { ...emptyOperations(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 100n * unit }, value = 0n) => ({
		questionId,
		universeId: fixture.base.genesisUniverse,
		input,
		proposedRepPerEthPrice: value > 0n ? unit : 0n,
		requestedInitialAttoWeth: 0n,
		bountyAttoEth: value,
		value,
		minimumIdleAttoRep: 0n,
	})
	const submit = async (operations: ReturnType<typeof operation>[], requireImmediate = true, value = 0n, sender = fixture.owner()) =>
		await writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'submitQuestionOperationsBatch', args: [operations, requireImmediate], value }))

	test('fresh multi-question bundles succeed together without sharing REP backing', async () => {
		await fixture.transferRep(fixture.vault, 2_000n * unit)
		await fixture.refreshPrices([fixture.base.questionId, fixture.secondQuestionId])
		await submit([operation(fixture.base.questionId), operation(fixture.secondQuestionId)])
		for (const questionId of [fixture.base.questionId, fixture.secondQuestionId]) {
			const pool = fixture.poolFor(questionId)
			expect(await fixture.repClaim(pool.securityPool)).toBe(1_000n * unit)
			expect((await getSecurityVault(fixture.owner(), pool.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
			expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: pool.openOraclePriceCoordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
		}
		expect(await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)).toBe(0n)
	})

	test('a later unhealthy allocation rolls back the earlier question despite their shared fresh price', async () => {
		await fixture.transferRep(fixture.vault, 2_000n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await expect(submit([operation(fixture.base.questionId), operation(fixture.secondQuestionId, { ...emptyOperations(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 100_000n * unit })])).rejects.toThrow()
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
		expect(await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)).toBe(2_000n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.poolFor(fixture.secondQuestionId).openOraclePriceCoordinator, functionName: 'pendingReportId' })).toBe(0n)
	})

	test('an immediate batch enforces the requested final health buffer for non-liquidation allocations', async () => {
		const nativeBacking = (100n * unit * fixture.base.statoblastSecurityMultiplierBps) / 10_000n
		await fixture.transferRep(fixture.vault, nativeBacking)
		await fixture.refreshPrice(fixture.base.questionId)
		await expect(submit([operation(fixture.base.questionId, { ...emptyOperations(), depositAttoRep: nativeBacking, changeCommitment: true, commitmentAttoEth: 100n * unit, minimumReceiverHealthFactorBps: 12_000n })])).rejects.toThrow('Batch health buffer violated')
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
		expect(await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)).toBe(nativeBacking)
	})

	test('a later question cannot spend the idle REP reserve requested by an earlier operation', async () => {
		await fixture.transferRep(fixture.vault, 1_050n * unit)
		const first = { ...operation(fixture.base.questionId, { ...emptyOperations(), depositAttoRep: 500n * unit }), minimumIdleAttoRep: 100n * unit }
		const second = operation(fixture.secondQuestionId, { ...emptyOperations(), depositAttoRep: 500n * unit })
		await expect(submit([first, second])).rejects.toThrow('Batch idle reserve violated')
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(0n)
		expect(await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)).toBe(1_050n * unit)
	})

	test('later operations on the same question cannot bypass its earlier final health buffer', async () => {
		await fixture.transferRep(fixture.vault, 500n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		const first = operation(fixture.base.questionId, { ...emptyOperations(), depositAttoRep: 500n * unit, changeCommitment: true, commitmentAttoEth: 100n * unit, minimumReceiverHealthFactorBps: 20_000n })
		const second = operation(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 200n * unit })
		await expect(submit([first, second])).rejects.toThrow('Batch health buffer violated')
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(0n)
	})

	test('deposit-only batches need no fresh prices and reject mismatched funding, outsiders and unbounded work', async () => {
		await fixture.transferRep(fixture.vault, 1_000n * unit)
		const deposits = [fixture.base.questionId, fixture.secondQuestionId].map(questionId => operation(questionId, { ...emptyOperations(), depositAttoRep: 500n * unit }))
		await expect(submit(deposits, true, 1n)).rejects.toThrow()
		await expect(submit(deposits, true, 0n, fixture.other())).rejects.toThrow('Only vault owner')
		await expect(submit([])).rejects.toThrow()
		await expect(submit(Array.from({ length: 17 }, () => operation(fixture.base.questionId)))).rejects.toThrow()
		await submit(deposits)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(500n * unit)
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(500n * unit)
	})

	test('queued failure is visible in terminal events and does not roll back the other question or its upfront deposit', async () => {
		await fixture.allocate(fixture.base.questionId)
		await fixture.transferRep(fixture.vault, 501n * unit)
		await fixture.base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(fixture.secondQuestionId)
		const coordinator = fixture.poolFor(fixture.secondQuestionId).openOraclePriceCoordinator
		await submit([operation(fixture.base.questionId, { ...emptyOperations(), depositAttoRep: unit }), operation(fixture.secondQuestionId, { ...emptyOperations(), depositAttoRep: 500n * unit, changeCommitment: true, commitmentAttoEth: 100_000n * unit }, funding.cost)], false, funding.cost)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_001n * unit)
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(500n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'getActiveStagedOperationCount' })).toBe(1n)
		const fromBlock = await fixture.owner().getBlockNumber()
		await handleOracleReporting(fixture.owner(), fixture.base.mockWindow, coordinator, unit)
		const logs = await fixture.owner().getLogs({ address: coordinator, fromBlock: fromBlock + 1n, toBlock: await fixture.owner().getBlockNumber() })
		const events = logs.map(log => decodeEventLog({ abi: coordinatorArtifact.abi, data: log.data, topics: log.topics }))
		expect(events.find(event => event.eventName === 'ExecutedStagedOperation')?.args).toMatchObject({ success: false })
		expect((await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(500n * unit)
	})

	test('a smart contract owner creates and operates its own account without giving its signer direct vault authority', async () => {
		await fixture.execute(fixture.portfolio, encodeFunctionData({ abi: portfolioArtifact.abi, functionName: 'createVault' }))
		const smartOwnedVault = await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'vaultOf', args: [fixture.vault] })
		expect(await fixture.owner().readContract({ abi: vaultArtifact.abi, address: smartOwnedVault, functionName: 'owner' })).toBe(fixture.vault)
		await fixture.transferRep(smartOwnedVault, 1_000n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		const operations = [operation(fixture.base.questionId)]
		await expect(fixture.owner().simulateContract({ abi: vaultArtifact.abi, address: smartOwnedVault, functionName: 'submitQuestionOperationsBatch', args: [operations, true] })).rejects.toThrow('Only vault owner')
		await fixture.execute(smartOwnedVault, encodeFunctionData({ abi: vaultArtifact.abi, functionName: 'submitQuestionOperationsBatch', args: [operations, true] }))
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool, smartOwnedVault)).toBe(1_000n * unit)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
	})
})
