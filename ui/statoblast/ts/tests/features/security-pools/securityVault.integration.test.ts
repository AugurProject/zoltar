import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { submitVaultOperations } from '@zoltar/ui-statoblast-shared/protocol/vaultOperations.js'
import { statoblast_SecurityPool_SecurityPool, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
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

	test('submits a pool bundle through the UI funding plan and confirms the owned vault outcome', async () => {
		const manager = await uiReadClient.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'openOraclePriceCoordinator' })
		await manipulatePriceOracle(client, mockWindow, manager)
		const result = await submitVaultOperations(uiWriteClient, securityPoolAddress, { depositAttoRep: depositAmount, changeCommitment: true, commitmentAttoEth: 50n * 10n ** 18n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 10_000n, validForSeconds: 300n }, 10n ** 18n)
		expect(result.stagedExecution?.success).toBe(true)
		expect(result.queuedOperation).toBeUndefined()
		const details = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		expect(details?.vaultAttoRepBacking).toBe(depositAmount)
		expect(details?.underwritingLimitAttoEth).toBe(50n * 10n ** 18n)
	})

	test('funds the pool deposit and coordinator oracle report through distinct spenders in one bundle plan', async () => {
		const manager = await uiReadClient.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'openOraclePriceCoordinator' })
		const result = await submitVaultOperations(uiWriteClient, securityPoolAddress, { depositAttoRep: depositAmount, changeCommitment: true, commitmentAttoEth: 50n * 10n ** 18n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 10_000n, validForSeconds: 300n }, 10n ** 18n)
		expect(result.queuedOperation?.operation).toBe('vaultOperations')
		expect((await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress))?.vaultAttoRepBacking).toBe(depositAmount)
		expect((await loadQueuedVaultOperationState(uiReadClient, manager, result)).status).toBe('queued')
		await handleOracleReporting(client, mockWindow, manager, 10n ** 18n)
		expect((await loadQueuedVaultOperationState(uiReadClient, manager, result)).status).toBe('executed')
		expect((await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress))?.underwritingLimitAttoEth).toBe(50n * 10n ** 18n)
	})

	for (const fresh of [true, false]) {
		for (const sufficient of [true, false]) {
			test(`edits the pool deposit approval and guards the batch (fresh=${fresh}, sufficient=${sufficient})`, async () => {
				const manager = await uiReadClient.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'openOraclePriceCoordinator' })
				if (fresh) await manipulatePriceOracle(client, mockWindow, manager)
				const scope = new AbortController()
				const reviewed = createReviewedClient(uiWriteClient, undefined, scope.signal)
				const action = submitVaultOperations(reviewed, securityPoolAddress, { depositAttoRep: depositAmount, changeCommitment: true, commitmentAttoEth: 50n * 10n ** 18n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 10_000n, validForSeconds: 300n }, 10n ** 18n).catch((error: unknown) => error)
				try {
					for (let attempt = 0; attempt < 200 && transactionSteps.value?.steps[0]?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10))
					const approval = transactionSteps.value?.steps[0]
					expect(approval?.spender).toBe(securityPoolAddress)
					expect(approval?.approval?.requiredAmount).toBe(depositAmount)
					expect(approval?.approval?.tokenSymbol).toBe('REP')
					expect(approval?.approval?.purpose).toBe('Vault deposit')
					if (!fresh) expect(transactionSteps.value?.steps.filter(step => step.spender === manager && step.approval !== undefined).every(step => step.approval?.purpose === 'Oracle report')).toBe(true)
					transactionSteps.value?.confirmStep(0, sufficient ? 2n * depositAmount : depositAmount / 2n)
					if (!sufficient) {
						const rejection = await action
						expect(rejection).toBeInstanceOf(Error)
						if (!(rejection instanceof Error)) throw new Error('Expected insufficient approval failure')
						expect(rejection.message).toContain('below the required amount')
						const vault = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
						if (vault === undefined) throw new Error('Expected empty vault')
						expect(await loadErc20Allowance(uiReadClient, vault.repToken, walletAddress, securityPoolAddress)).toBe(depositAmount / 2n)
						expect((await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress))?.vaultAttoRepBacking).toBe(0n)
						expect((await loadOracleManagerDetails(uiReadClient, manager)).pendingReportId).toBe(0n)
						return
					}
					let completed = false
					void action.then(() => {
						completed = true
					})
					for (let attempt = 0; attempt < 1000 && !completed; attempt += 1) {
						const workflow = transactionSteps.value
						const index = workflow?.steps.findIndex(step => step.phase === 'review')
						if (index !== undefined && index >= 0) workflow?.confirmStep(index)
						await new Promise(resolve => setTimeout(resolve, 10))
					}
					const result = await action
					expect(result).not.toBeInstanceOf(Error)
					const details = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
					expect(details?.vaultAttoRepBacking).toBe(depositAmount)
					if (details === undefined) throw new Error('Expected deposited vault')
					expect(await loadErc20Allowance(uiReadClient, details.repToken, walletAddress, securityPoolAddress)).toBe(depositAmount)
				} finally {
					scope.abort()
					transactionSteps.value?.cancel()
					await action
				}
			})
		}
	}

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
		// The deposit check converts through these pool totals, so they come from the vault read itself.
		expect(updatedVaultDetails.totalPoolHeldRepBalanceAttoRep).toBe(endPoolRepBalance)
		expect(updatedVaultDetails.totalRepBackingUnits).toBe(vault.repBackingUnits)
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
