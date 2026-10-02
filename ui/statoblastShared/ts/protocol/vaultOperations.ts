import { getStagedOracleExecutionResult, getStagedOracleQueuedResult } from './oracleStagedOperationResults.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { writeContractAndWait, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { MAX_VAULT_PRICE_ACTIONS, countVaultPriceActions, validateVaultOperations, type VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_VaultOperations_VaultOperations as bundleArtifact } from '../contractArtifact.js'
import { fundCoordinatorInitialReport, loadOracleManagerQueueOperationEthValue, loadCoordinatorInitialReportFundingRequirement } from './oracleCoordinator.js'
import { runFundingTransactions, type FundingTransaction } from './fundingTransactions.js'
import type { StagedOracleExecutionResult, StagedOracleQueuedResult } from '../types/contracts.js'

export type VaultOperationsResult = {
	hash: Hash
	queuedOperation?: StagedOracleQueuedResult
	stagedExecution?: StagedOracleExecutionResult
	depositAttoRep: bigint
}

export async function quoteVaultOperations(client: ReadClient, pool: Address, owner: Address, input: VaultOperationsInput, proposedPrice: bigint) {
	const managerAddress = await client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'openOraclePriceCoordinator' })
	const [repToken, validPrice, sponsor, pendingReportId, pendingWork, vault, minimumDeposit, activeIds] = await Promise.all([
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'repToken' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'isPriceValid' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'pendingReportSponsor' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'pendingReportId' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'getPendingSettlementWork' }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'securityVaults', args: [owner] }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'minimumVaultRepDepositAttoRep' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'getActiveStagedOperations', args: [0n, 25n] }),
	])
	if (countVaultPriceActions(input) > 0 && pendingReportId > 0n && sponsor.toLowerCase() !== owner.toLowerCase()) throw new Error('Another wallet sponsors the pending report. Wait for settlement.')
	const count = countVaultPriceActions(input)
	if (!validPrice && pendingWork + BigInt(count) > BigInt(MAX_VAULT_PRICE_ACTIONS)) throw new Error('Not enough automatic settlement capacity. Wait for pending operations to finish.')
	if (input.changeCommitment && activeIds[1].some(operation => operation.operator.toLowerCase() === owner.toLowerCase() && (operation.operation === 2n || operation.operation === 3n))) throw new Error('A commitment operation is already pending for your vault.')
	const [balance, currentBacking] = await Promise.all([client.readContract({ address: repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] }), client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'backingUnitsToAttoRep', args: [vault[0]] })])
	if (input.depositAttoRep > 0n && currentBacking + input.depositAttoRep < minimumDeposit) throw new Error('The resulting vault deposit is below the pool minimum.')
	const needsReport = count > 0 && !validPrice && pendingReportId === 0n
	if (needsReport && proposedPrice <= 0n) throw new Error('Enter a positive initial oracle price.')
	const funding = needsReport ? await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, owner, proposedPrice) : undefined
	const requiredRep = input.depositAttoRep + (funding?.requiredRepAttoRep ?? 0n)
	if (balance < requiredRep) throw new Error('Insufficient wallet REP for the deposit and oracle funding.')
	return { managerAddress, repToken, balance, currentBacking, validPrice, pendingReportId, needsReport, funding, requiredRep }
}

export async function submitVaultOperations(client: WriteClient, pool: Address, input: VaultOperationsInput, proposedPrice: bigint) {
	validateVaultOperations(input, client.account.address)
	const initial = await quoteVaultOperations(client, pool, client.account.address, input, proposedPrice)
	const value = initial.needsReport ? await loadOracleManagerQueueOperationEthValue(client, initial.managerAddress) : 0n
	const executorAddress = await client.readContract({ address: initial.managerAddress, abi: coordinatorArtifact.abi, functionName: 'vaultOperations' })
	const call = { address: executorAddress, abi: bundleArtifact.abi, functionName: 'submitVaultOperations', args: [input, proposedPrice, 0n, value], value } as const
	const validateBeforeSubmit = async () => {
		const current = await quoteVaultOperations(client, pool, client.account.address, input, proposedPrice)
		if (current.needsReport && (!initial.needsReport || (await loadOracleManagerQueueOperationEthValue(client, initial.managerAddress)) > value)) throw new Error('Oracle funding changed. Review the batch again.')
		if (input.depositAttoRep > 0n) {
			const allowance = await client.readContract({ address: initial.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, pool] })
			if (allowance < input.depositAttoRep) throw new Error('REP deposit approval is insufficient.')
		}
		await client.simulateContract({ ...call, account: client.account })
	}
	const actions: FundingTransaction[] =
		input.depositAttoRep === 0n
			? []
			: [
					{
						step: { functionName: 'approve', contractAddress: initial.repToken, args: [pool, input.depositAttoRep], requiredApprovalAmount: input.depositAttoRep, approvalPurpose: 'Vault deposit' },
						isRequired: async () => (await client.readContract({ address: initial.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, pool] })) < input.depositAttoRep,
						execute: async () => await writeContractAndWait(client, () => ({ address: initial.repToken, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [pool, input.depositAttoRep] })),
					},
				]
	const finalStep = { ...call, contractAddress: executorAddress, reviewTitle: 'Submit vault operations', validateBeforeSubmit }
	if (initial.needsReport) await fundCoordinatorInitialReport(client, initial.managerAddress, proposedPrice, 0n, finalStep, { actions, repAttoRep: input.depositAttoRep })
	else await runFundingTransactions(client, actions, finalStep)
	await validateBeforeSubmit()
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => call)
	const queuedEvent = getStagedOracleQueuedResult(receipt, initial.managerAddress, 'vaultOperations')
	const stagedExecution = getStagedOracleExecutionResult(receipt, initial.managerAddress, 'vaultOperations')
	const queuedOperation = stagedExecution === undefined ? queuedEvent : undefined
	if (countVaultPriceActions(input) > 0 && queuedOperation === undefined && stagedExecution === undefined) throw new Error('Transaction confirmed, but the bundle outcome is unavailable. Check staged operations before submitting again.')
	return { hash, depositAttoRep: input.depositAttoRep, ...(queuedOperation === undefined ? {} : { queuedOperation }), ...(stagedExecution === undefined ? {} : { stagedExecution }) } satisfies VaultOperationsResult
}
