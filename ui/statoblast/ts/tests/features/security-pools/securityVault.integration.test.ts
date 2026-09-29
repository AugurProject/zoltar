import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { handleOracleReporting, manipulatePriceOracle } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/statoblastTestUtils'
import { loadOracleManagerDetails, loadQueuedVaultOperationState, queueOracleManagerOperation } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'
/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from 'bun:test'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { approveErc20 } from '@zoltar/ui-zoltar-shared/protocol/tokenActions.js'
import { depositRepToVaultToSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/securityVault.js'
import { loadSecurityVaultDetails } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { loadErc20Allowance, loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { DAY } from '../../../../../../solidity/ts/testSupport/simulator/utils/constants'
import type { AnvilWindowEthereum } from '../../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { deployOriginSecurityPool, getSecurityPoolAddresses } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { useSepoliaAnvilUiEnvironment } from './testSupport/sepoliaAnvilUi.js'
import { getSecurityVault, getVaultCount, getVaults, backingUnitsToAttoRep } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/securityPool'

const genesisUniverse = 0n
const statoblastSecurityMultiplierBps = 20_000n
const outcomes = ['Yes', 'No']
const depositAmount = 10_000n * 10n ** 18n
const belowMinimumDepositAmount = 9n * 10n ** 18n

describe('Security vault integration', () => {
	const anvil = useSepoliaAnvilUiEnvironment()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let uiWriteClient: ReturnType<typeof createWalletWriteClient>
	let securityPoolAddress: Address
	let walletAddress: Address

	beforeEach(async () => {
		mockWindow = anvil.getMockWindow()
		client = anvil.getClient()
		uiReadClient = createConnectedReadClient()
		walletAddress = anvil.walletAddress
		uiWriteClient = createWalletWriteClient(walletAddress)

		const currentTimestamp = await mockWindow.getTime()
		const questionData = {
			title: 'Vault deposit regression test',
			description: '',
			startTime: 0n,
			endTime: currentTimestamp + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
	})

	test('approves and deposits REP into the selected vault and reports REP units correctly', async () => {
		const initialVaultDetails = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (initialVaultDetails === undefined) throw new Error('Expected security vault details to load')
		expect(initialVaultDetails.vaultAttoRepBacking).toBe(0n)

		const startPoolRepBalance = await loadErc20Balance(uiReadClient, initialVaultDetails.repToken, securityPoolAddress)
		const approvalResult = await approveErc20(uiWriteClient, initialVaultDetails.repToken, securityPoolAddress, depositAmount, 'approveRep')
		expect(approvalResult.action).toBe('approveRep')

		const approvedRep = await loadErc20Allowance(uiReadClient, initialVaultDetails.repToken, walletAddress, securityPoolAddress)
		expect(approvedRep).toBe(depositAmount)

		const depositResult = await depositRepToVaultToSecurityPool(uiWriteClient, securityPoolAddress, depositAmount, 20_000n)
		expect(depositResult.action).toBe('depositRepToVault')

		const endPoolRepBalance = await loadErc20Balance(uiReadClient, initialVaultDetails.repToken, securityPoolAddress)
		expect(endPoolRepBalance - startPoolRepBalance).toEqual(depositAmount)

		const vaultCount = await getVaultCount(client, securityPoolAddress)
		expect(vaultCount).toBe(1n)
		const vaults = await getVaults(client, securityPoolAddress, 0n, vaultCount)
		expect(vaults).toEqual([walletAddress])

		const vault = await getSecurityVault(client, securityPoolAddress, walletAddress)
		const repFromBackingUnits = await backingUnitsToAttoRep(client, securityPoolAddress, vault.repBackingUnits)
		expect(repFromBackingUnits).toBe(depositAmount)

		const updatedVaultDetails = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (updatedVaultDetails === undefined) throw new Error('Expected updated security vault details to load')
		expect(updatedVaultDetails.vaultAddress).toBe(walletAddress)
		expect(updatedVaultDetails.securityPoolAddress).toBe(securityPoolAddress)
		expect(updatedVaultDetails.vaultAttoRepBacking).toBe(depositAmount)
		expect(updatedVaultDetails.settlementCollateralAttoEth).toBe(0n)
		await manipulatePriceOracle(client, mockWindow, updatedVaultDetails.managerAddress, 10n ** 18n)
		const adjustment = await queueOracleManagerOperation(uiWriteClient, updatedVaultDetails.managerAddress, 'setVaultUnderwritingLimit', walletAddress, depositAmount / 2n, 300n)
		expect(adjustment.stagedExecution?.success).toBe(true)
		const adjustedVault = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		expect(adjustedVault?.underwritingLimitAttoEth).toBe(depositAmount / 2n)
		expect(adjustedVault?.vaultAttoRepBacking).toBe(depositAmount)
		expect(adjustedVault?.poolHeldRepPerCapacityBps).toBe(20_000n)
		expect(updatedVaultDetails.underwritingLimitAttoEth).toBe(0n)
	})

	test('matches a replacement target result by operation ID instead of the superseded result', async () => {
		const details = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (details === undefined) throw new Error('Expected security vault details')
		await approveErc20(uiWriteClient, details.repToken, securityPoolAddress, depositAmount, 'approveRep')
		await depositRepToVaultToSecurityPool(uiWriteClient, securityPoolAddress, depositAmount, 20_000n)
		const first = await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'setVaultUnderwritingLimit', walletAddress, 40_000n, 300n, 10n ** 18n)
		const replacement = await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'setVaultUnderwritingLimit', walletAddress, 30_000n, 300n, 10n ** 18n)
		expect(replacement.queuedOperation?.operationId).not.toBe(first.queuedOperation?.operationId)
		expect(replacement.queuedOperation?.isPendingSlot).toBe(true)
		expect(replacement.stagedExecution).toBeUndefined()
		await handleOracleReporting(client, mockWindow, details.managerAddress, 10n ** 18n)
		expect((await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress))?.underwritingLimitAttoEth).toBe(30_000n)
	})

	test.each(['executed', 'failed', 'expired', 'superseded'] as const)('loads later %s from the original queued target receipt', async terminal => {
		const details = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (details === undefined) throw new Error('Expected security vault details')
		await approveErc20(uiWriteClient, details.repToken, securityPoolAddress, depositAmount, 'approveRep')
		await depositRepToVaultToSecurityPool(uiWriteClient, securityPoolAddress, depositAmount, 20_000n)
		const queued = await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'setVaultUnderwritingLimit', walletAddress, terminal === 'failed' ? 2n ** 256n - 1n : 40_000n, 300n, 10n ** 18n)
		const original = { ...queued, action: 'setVaultUnderwritingLimit' as const }
		expect((await loadQueuedVaultOperationState(uiReadClient, details.managerAddress, original)).status).toBe('queued')
		if (terminal === 'superseded') await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'setVaultUnderwritingLimit', walletAddress, 30_000n, 300n, 10n ** 18n)
		else if (terminal === 'expired') {
			if (queued.queuedOperation === undefined) throw new Error('Expected queued operation')
			await mockWindow.advanceTime(DAY)
			await uiWriteClient.waitForTransactionReceipt({ hash: await uiWriteClient.sendTransaction({ to: walletAddress, value: 0n }) })
			expect(await loadQueuedVaultOperationState(uiReadClient, details.managerAddress, original)).toEqual({ status: 'expired' })
			await uiWriteClient.waitForTransactionReceipt({ hash: await uiWriteClient.writeContract({ address: details.managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'expireStagedOperation', args: [queued.queuedOperation.operationId] }) })
		} else await handleOracleReporting(client, mockWindow, details.managerAddress, 10n ** 18n)
		const state = await loadQueuedVaultOperationState(uiReadClient, details.managerAddress, original)
		expect(state.status).toBe(terminal)
		expect(state.execution?.operationId).toBe(queued.queuedOperation?.operationId)
		expect(state.execution?.success).toBe(terminal === 'executed')
		expect(original.stagedExecution).toBeUndefined()
		expect(original.hash).toBe(queued.hash)
	})

	test('tracks a manual target outside the active preview through later execution', async () => {
		const details = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (details === undefined) throw new Error('Expected security vault details')
		await approveErc20(uiWriteClient, details.repToken, securityPoolAddress, depositAmount, 'approveRep')
		await depositRepToVaultToSecurityPool(uiWriteClient, securityPoolAddress, depositAmount, 20_000n)
		for (let index = 0; index < 4; index++) await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'withdrawRep', walletAddress, 1n, 300n, 10n ** 18n)
		const queued = await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'setVaultUnderwritingLimit', walletAddress, 40_000n, 300n, 10n ** 18n)
		if (queued.queuedOperation === undefined) throw new Error('Expected queued target')
		const original = { ...queued, action: 'setVaultUnderwritingLimit' as const }
		for (let index = 0; index < 30; index++) await queueOracleManagerOperation(uiWriteClient, details.managerAddress, 'withdrawRep', walletAddress, 1n, 300n, 10n ** 18n)
		expect((await loadOracleManagerDetails(uiReadClient, details.managerAddress)).stagedOperations?.some(operation => operation.operationId === queued.queuedOperation?.operationId)).toBe(false)
		expect((await loadQueuedVaultOperationState(uiReadClient, details.managerAddress, original)).status).toBe('manual-queued')
		await handleOracleReporting(client, mockWindow, details.managerAddress, 10n ** 18n)
		expect((await loadQueuedVaultOperationState(uiReadClient, details.managerAddress, original)).status).toBe('manual-queued')
		await uiWriteClient.waitForTransactionReceipt({ hash: await uiWriteClient.writeContract({ address: details.managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'executeStagedOperation', args: [queued.queuedOperation.operationId] }) })
		expect((await loadQueuedVaultOperationState(uiReadClient, details.managerAddress, original)).status).toBe('executed')
	})

	test('surfaces the real revert reason when the first deposit is below the minimum', async () => {
		const vaultDetails = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (vaultDetails === undefined) throw new Error('Expected security vault details to load')

		await approveErc20(uiWriteClient, vaultDetails.repToken, securityPoolAddress, belowMinimumDepositAmount, 'approveRep')

		await expect(depositRepToVaultToSecurityPool(uiWriteClient, securityPoolAddress, belowMinimumDepositAmount, 20_000n)).rejects.toThrow('Vault REP below minimum')
	})
})
