import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { describe, test, expect } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_VaultOperations_VaultOperations as bundleArtifact,
	statoblast_interfaces_ISecurityPool_ISecurityPool as poolInterfaceArtifact,
} from '../../types/contractArtifact'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { depositRepToVault, getSecurityVault, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { handleOracleReporting, manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'

import { fundCoordinatorInitialReport, getRequestPriceCostAttoEth } from '../../testSupport/simulator/utils/contracts/statoblast'

const unit = 10n ** 18n

describe('Statoblast: pool vault operation bundles', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const input = (): VaultOperationsInput => ({ depositAttoRep: 0n, changeCommitment: false, commitmentAttoEth: 0n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 10_000n, validForSeconds: 300n })
	const submit = async (operations: VaultOperationsInput, value = 0n, price = 0n) => {
		const executor = await fixture.client.readContract({ abi: coordinatorArtifact.abi, address: fixture.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'vaultOperations' })
		return await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: executor, abi: bundleArtifact.abi, functionName: 'submitVaultOperations', args: [operations, price, 0n, value], value }))
	}
	const prepare = async () => {
		await approveToken(fixture.client, addressString(GENESIS_REPUTATION_TOKEN), fixture.securityPoolAddresses.securityPool)
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator)
	}

	test('deposit and commitment change credit the submitting wallet, not the coordinator', async () => {
		await prepare()
		const before = await fixture.getVaultRepClaim(fixture.client.account.address)
		await submit({ ...input(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 50n * unit })
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before + 1_000n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(50n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.securityPoolAddresses.openOraclePriceCoordinator)).repBackingUnits).toBe(0n)
	})

	test('commitment reduction and REP withdrawal execute together', async () => {
		await prepare()
		await setUnderwritingLimit(fixture.client, fixture.securityPoolAddresses.securityPool, 50n * unit)
		const before = await fixture.getVaultRepClaim(fixture.client.account.address)
		await submit({ ...input(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 500n * unit })
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before - 500n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
	})

	test('a failing later action rolls back the deposit and commitment change', async () => {
		await prepare()
		const before = await fixture.getVaultRepClaim(fixture.client.account.address)
		await expect(submit({ ...input(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 10n ** 30n })).rejects.toThrow('Vault backing insufficient')
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
	})

	test('two other vaults liquidate into the wallet in one transaction after its deposit and commitment change', async () => {
		await prepare()
		const targets = [TEST_ADDRESSES[1], TEST_ADDRESSES[2]]
		for (const address of targets) {
			const target = createWriteClient(fixture.mockWindow, address)
			await fixture.transferRepToAddress(fixture.client, addressString(address), 1_000n * unit)
			await approveToken(target, addressString(GENESIS_REPUTATION_TOKEN), fixture.securityPoolAddresses.securityPool)
			await depositRepToVault(target, fixture.securityPoolAddresses.securityPool, 1_000n * unit)
			await setUnderwritingLimit(target, fixture.securityPoolAddresses.securityPool, 400n * unit)
		}
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator, 3n * unit)
		const hash = await submit({ ...input(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 50n * unit, liquidations: targets.map(targetVault => ({ targetVault: addressString(targetVault), requestedDebtAttoEth: 400n * unit })) })
		const receipt = await fixture.client.getTransactionReceipt({ hash })
		const liquidations = receipt.logs
			.filter(log => log.address.toLowerCase() === fixture.securityPoolAddresses.securityPool.toLowerCase())
			.map(log => decodeEventLog({ abi: poolArtifact.abi, data: log.data, topics: log.topics }))
			.filter(event => event.eventName === 'VaultLiquidated')
		expect(liquidations).toHaveLength(2)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(850n * unit)
		for (const target of targets) expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, addressString(target))).underwritingLimitAttoEth).toBe(0n)
	})

	test('the oracle callback executes a maximum four-action bundle with two liquidation targets', async () => {
		await prepare()
		const targets = [TEST_ADDRESSES[1], TEST_ADDRESSES[2]]
		for (const address of targets) {
			const target = createWriteClient(fixture.mockWindow, address)
			await fixture.transferRepToAddress(fixture.client, addressString(address), 1_000n * unit)
			await approveToken(target, addressString(GENESIS_REPUTATION_TOKEN), fixture.securityPoolAddresses.securityPool)
			await depositRepToVault(target, fixture.securityPoolAddresses.securityPool, 1_000n * unit)
			await setUnderwritingLimit(target, fixture.securityPoolAddresses.securityPool, 400n * unit)
		}
		const manager = fixture.securityPoolAddresses.openOraclePriceCoordinator
		await fixture.mockWindow.advanceTime(301n)
		await fundCoordinatorInitialReport(fixture.client, manager, 3n * unit)
		await submit({ ...input(), changeCommitment: true, commitmentAttoEth: 50n * unit, liquidations: targets.map(target => ({ targetVault: addressString(target), requestedDebtAttoEth: 400n * unit })), withdrawAttoRep: 100n * unit }, await getRequestPriceCostAttoEth(fixture.client, manager), 3n * unit)
		expect(await fixture.client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'getPendingSettlementWork' })).toBe(4n)
		await handleOracleReporting(fixture.client, fixture.mockWindow, manager, 3n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(850n * unit)
		for (const target of targets) expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, addressString(target))).underwritingLimitAttoEth).toBe(0n)
		expect(await fixture.client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
	})

	test('the advertised callback budget handles four liquidations and bundle cleanup', async () => {
		await prepare()
		const targets = [TEST_ADDRESSES[1], TEST_ADDRESSES[2], TEST_ADDRESSES[3], TEST_ADDRESSES[4]]
		for (const address of targets) {
			const target = createWriteClient(fixture.mockWindow, address)
			await fixture.transferRepToAddress(fixture.client, addressString(address), 1_000n * unit)
			await approveToken(target, addressString(GENESIS_REPUTATION_TOKEN), fixture.securityPoolAddresses.securityPool)
			await depositRepToVault(target, fixture.securityPoolAddresses.securityPool, 1_000n * unit)
			await setUnderwritingLimit(target, fixture.securityPoolAddresses.securityPool, 400n * unit)
		}
		const manager = fixture.securityPoolAddresses.openOraclePriceCoordinator
		await fixture.mockWindow.advanceTime(301n)
		await fundCoordinatorInitialReport(fixture.client, manager, 3n * unit)
		await submit({ ...input(), liquidations: targets.map(target => ({ targetVault: addressString(target), requestedDebtAttoEth: 400n * unit })) }, await getRequestPriceCostAttoEth(fixture.client, manager), 3n * unit)
		await handleOracleReporting(fixture.client, fixture.mockWindow, manager, 3n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(1_600n * unit)
		for (const target of targets) expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, addressString(target))).underwritingLimitAttoEth).toBe(0n)
		expect(await fixture.client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'getPendingSettlementWork' })).toBe(0n)
	})

	test('self liquidation and unauthorized coordinator deposits are rejected', async () => {
		await prepare()
		await expect(submit({ ...input(), liquidations: [{ targetVault: fixture.client.account.address, requestedDebtAttoEth: unit }] })).rejects.toThrow('Choose another vault')
		await expect(fixture.client.simulateContract({ abi: poolInterfaceArtifact.abi, address: fixture.securityPoolAddresses.securityPool, functionName: 'depositRepToVaultFromCoordinator', args: [addressString(TEST_ADDRESSES[1]), unit], account: fixture.client.account })).rejects.toThrow('Only coordinator')
		const executor = await fixture.client.readContract({ abi: coordinatorArtifact.abi, address: fixture.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'vaultOperations' })
		await expect(fixture.client.simulateContract({ abi: bundleArtifact.abi, address: executor, functionName: 'execute', args: [1n], account: fixture.client.account })).rejects.toThrow('Only coordinator')
	})

	test('stale-price deposits complete now and the ordered bundle executes in the oracle callback', async () => {
		await prepare()
		const manager = fixture.securityPoolAddresses.openOraclePriceCoordinator
		await fixture.mockWindow.advanceTime(301n)
		await fundCoordinatorInitialReport(fixture.client, manager, unit)
		const before = await fixture.getVaultRepClaim(fixture.client.account.address)
		await submit({ ...input(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 50n * unit, withdrawAttoRep: 500n * unit }, await getRequestPriceCostAttoEth(fixture.client, manager), unit)
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before + 1_000n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect(await fixture.client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'pendingReportSponsor' })).toBe(fixture.client.account.address)
		await handleOracleReporting(fixture.client, fixture.mockWindow, manager, unit)
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before + 500n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(50n * unit)
		expect(await fixture.client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'getPendingSettlementWork' })).toBe(0n)
	})

	test('a queued failure leaves the deposit and rolls back all deferred mutations', async () => {
		await prepare()
		const manager = fixture.securityPoolAddresses.openOraclePriceCoordinator
		await fixture.mockWindow.advanceTime(301n)
		await fundCoordinatorInitialReport(fixture.client, manager, unit)
		const before = await fixture.getVaultRepClaim(fixture.client.account.address)
		await submit({ ...input(), depositAttoRep: 1_000n * unit, changeCommitment: true, commitmentAttoEth: 10n ** 30n, withdrawAttoRep: 500n * unit }, await getRequestPriceCostAttoEth(fixture.client, manager), unit)
		await handleOracleReporting(fixture.client, fixture.mockWindow, manager, unit)
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before + 1_000n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect(await fixture.client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
	})

	test('rescue deposits invalidate queued liquidation snapshots and roll back the dependent commitment change', async () => {
		await prepare()
		const targetAddress = TEST_ADDRESSES[1]
		const target = createWriteClient(fixture.mockWindow, targetAddress)
		await fixture.transferRepToAddress(fixture.client, addressString(targetAddress), 2_000n * unit)
		await approveToken(target, addressString(GENESIS_REPUTATION_TOKEN), fixture.securityPoolAddresses.securityPool)
		await depositRepToVault(target, fixture.securityPoolAddresses.securityPool, 1_000n * unit)
		await setUnderwritingLimit(target, fixture.securityPoolAddresses.securityPool, 400n * unit)
		const manager = fixture.securityPoolAddresses.openOraclePriceCoordinator
		await fixture.mockWindow.advanceTime(301n)
		await fundCoordinatorInitialReport(fixture.client, manager, 3n * unit)
		await submit({ ...input(), changeCommitment: true, commitmentAttoEth: 50n * unit, liquidations: [{ targetVault: target.account.address, requestedDebtAttoEth: 400n * unit }] }, await getRequestPriceCostAttoEth(fixture.client, manager), 3n * unit)
		await depositRepToVault(target, fixture.securityPoolAddresses.securityPool, 1_000n * unit)
		await handleOracleReporting(fixture.client, fixture.mockWindow, manager, 3n * unit)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, target.account.address)).underwritingLimitAttoEth).toBe(400n * unit)
	})

	test('duplicate targets and more than four price actions are rejected without depositing', async () => {
		await prepare()
		const targetAddress = addressString(TEST_ADDRESSES[1])
		const target = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await fixture.transferRepToAddress(fixture.client, targetAddress, 1_000n * unit)
		await approveToken(target, addressString(GENESIS_REPUTATION_TOKEN), fixture.securityPoolAddresses.securityPool)
		await depositRepToVault(target, fixture.securityPoolAddresses.securityPool, 1_000n * unit)
		await setUnderwritingLimit(target, fixture.securityPoolAddresses.securityPool, unit)
		const targets = [1, 2, 3, 4, 5].map(index => ({ targetVault: addressString(BigInt(index)), requestedDebtAttoEth: unit }))
		const before = await fixture.getVaultRepClaim(fixture.client.account.address)
		await expect(submit({ ...input(), depositAttoRep: unit, liquidations: targets })).rejects.toThrow('one to four')
		await expect(
			submit({
				...input(),
				depositAttoRep: unit,
				liquidations: [
					{ targetVault: targetAddress, requestedDebtAttoEth: unit },
					{ targetVault: targetAddress, requestedDebtAttoEth: unit },
				],
			}),
		).rejects.toThrow('Duplicate liquidation target')
		expect(await fixture.getVaultRepClaim(fixture.client.account.address)).toBe(before)
	})

	test('deposit-only bundles do not request an oracle and refund unnecessary ETH', async () => {
		await prepare()
		const before = await fixture.client.readContract({ abi: coordinatorArtifact.abi, address: fixture.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'stagedOperationCounter' })
		await submit({ ...input(), depositAttoRep: 1_000n * unit }, unit)
		expect(await fixture.client.readContract({ abi: coordinatorArtifact.abi, address: fixture.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'stagedOperationCounter' })).toBe(before)
		expect(await fixture.client.getBalance({ address: fixture.securityPoolAddresses.openOraclePriceCoordinator })).toBe(0n)
	})
})
