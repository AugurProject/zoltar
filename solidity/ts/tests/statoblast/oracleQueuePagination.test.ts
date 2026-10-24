import { describe, expect, test } from 'bun:test'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact } from '../../types/contractArtifact'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { executeStagedOperation, OperationType, requestPriceIfNeededAndStageOperation } from '../../testSupport/simulator/utils/contracts/statoblast'
import { handleOracleReporting } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'

describe('Oracle active operation cursors', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const page = async (cursor: bigint, count: bigint, blockNumber?: bigint) => fixture.client.readContract({ address: fixture.securityPoolAddresses.openOraclePriceCoordinator, abi: coordinatorArtifact.abi, functionName: 'getActiveStagedOperationsPage', args: [cursor, count], blockNumber })
	const pending = async () => fixture.client.readContract({ address: fixture.securityPoolAddresses.openOraclePriceCoordinator, abi: coordinatorArtifact.abi, functionName: 'getPendingCommitmentOperationId', args: [fixture.client.account.address] })
	const stage = async (operation = OperationType.WithdrawRep) => requestPriceIfNeededAndStageOperation(fixture.client, fixture.securityPoolAddresses.openOraclePriceCoordinator, operation, fixture.client.account.address, fixture.repDeposit / 100n)

	test('pages active IDs inclusively without walking earlier pages and rejects stale cursors', async () => {
		for (let index = 0; index < 8; index++) await stage()
		const blockNumber = await fixture.client.getBlockNumber()
		const first = await page(0n, 3n, blockNumber)
		expect(first[0]).toEqual([8n, 7n, 6n])
		expect(first[2]).toBe(5n)
		expect((await page(first[2], 3n, blockNumber))[0]).toEqual([5n, 4n, 3n])
		const last = await page(2n, 30n, blockNumber)
		expect(last[0]).toEqual([2n, 1n])
		expect(last[1]).toHaveLength(2)
		expect(last[2]).toBe(0n)
		const call = { address: fixture.securityPoolAddresses.openOraclePriceCoordinator, abi: coordinatorArtifact.abi, functionName: 'getActiveStagedOperationsPage', account: fixture.client.account } as const
		const headGas = await fixture.client.estimateContractGas({ ...call, args: [8n, 1n] })
		const tailGas = await fixture.client.estimateContractGas({ ...call, args: [2n, 1n] })
		expect(tailGas <= headGas + 100n).toBe(true)
		await expect(page(0n, 0n)).rejects.toThrow('Page count must be positive')
		await expect(page(99n, 1n)).rejects.toThrow('Inactive operation cursor')
		await handleOracleReporting(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator, 10n ** 18n)
		await expect(page(2n, 1n)).rejects.toThrow('Inactive operation cursor')
		expect((await page(2n, 2n, blockNumber))[0]).toEqual([2n, 1n])
		expect((await page(0n, 20n))[0]).toEqual([8n, 7n, 6n, 5n])
	})

	test('the owner index follows supersession and retains expired unconsumed commitments', async () => {
		expect(await pending()).toBe(0n)
		for (let index = 0; index < 4; index++) await stage()
		await stage(OperationType.SetVaultUnderwritingLimit)
		expect(await pending()).toBe(5n)
		await stage(OperationType.SetVaultUnderwritingLimit)
		expect(await pending()).toBe(6n)
		await expect(page(5n, 1n)).rejects.toThrow('Inactive operation cursor')
		await handleOracleReporting(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator, 10n ** 18n)
		await fixture.mockWindow.advanceTime(600n)
		expect(await pending()).toBe(6n)
		await executeStagedOperation(fixture.client, fixture.securityPoolAddresses.openOraclePriceCoordinator, 6n)
		expect(await pending()).toBe(0n)
		const empty = await page(0n, 10n)
		expect(empty[0]).toEqual([])
		expect(empty[1]).toEqual([])
		expect(empty[2]).toBe(0n)
	})
})
