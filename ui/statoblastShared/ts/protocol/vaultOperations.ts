import { getStagedOracleExecutionResult, getStagedOracleQueuedResult } from './oracleStagedOperationResults.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { encodeFunctionData, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { writeContractAndWait, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { MAX_VAULT_PRICE_ACTIONS, countVaultPriceActions, validateVaultOperations, type VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_VaultOperations_VaultOperations as bundleArtifact } from '../contractArtifact.js'
import { fundCoordinatorInitialReport, loadOracleManagerQueueOperationEthValue, loadCoordinatorInitialReportFundingRequirement } from './oracleCoordinator.js'
import { runFundingTransactions, type FundingTransaction } from './fundingTransactions.js'
import type { StagedOracleExecutionResult, StagedOracleQueuedResult } from '../types/contracts.js'
import { getVaultOperationsRevertReason } from './vaultOperationsErrors.js'
import * as copy from '../copy/vaultOperations.js'

export type VaultOperationsResult = {
	hash: Hash
	queuedOperation?: StagedOracleQueuedResult
	stagedExecution?: StagedOracleExecutionResult
	depositAttoRep: bigint
}

export async function hasPendingVaultCommitment(client: ReadClient, manager: Address, owner: Address) {
	let executor: Address | undefined
	for (let offset = 0n; ; offset += 25n) {
		const [ids, operations] = await client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'getActiveStagedOperations', args: [offset, 25n] })
		for (const [index, operation] of operations.entries()) {
			if (operation.operator.toLowerCase() !== owner.toLowerCase()) continue
			if (operation.operation === 2n) return true
			if (operation.operation !== 3n) continue
			executor ??= await client.readContract({ address: manager, abi: coordinatorArtifact.abi, functionName: 'vaultOperations' })
			const id = ids[index]
			if (id === undefined) throw new Error(copy.unknownOutcome)
			const bundle = await client.readContract({ address: executor, abi: bundleArtifact.abi, functionName: 'getBundle', args: [id] })
			if (bundle.changeCommitment) return true
		}
		if (operations.length < 25) return false
	}
}

export async function quoteVaultOperations(client: ReadClient, pool: Address, owner: Address, input: VaultOperationsInput, proposedPrice: bigint) {
	validateVaultOperations(input, owner)
	const managerAddress = await client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'openOraclePriceCoordinator' })
	const [repToken, validPrice, sponsor, pendingReportId, pendingWork, vault, minimumDeposit] = await Promise.all([
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'repToken' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'isPriceValid' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'pendingReportSponsor' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'pendingReportId' }),
		client.readContract({ address: managerAddress, abi: coordinatorArtifact.abi, functionName: 'getPendingSettlementWork' }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'securityVaults', args: [owner] }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'minimumVaultRepDepositAttoRep' }),
	])
	if (countVaultPriceActions(input) > 0 && pendingReportId > 0n && sponsor.toLowerCase() !== owner.toLowerCase()) throw new Error(copy.otherReportSponsor)
	const count = countVaultPriceActions(input)
	if (!validPrice && pendingWork + BigInt(count) > BigInt(MAX_VAULT_PRICE_ACTIONS)) throw new Error(copy.settlementCapacity)
	if (input.changeCommitment && (await hasPendingVaultCommitment(client, managerAddress, owner))) throw new Error(copy.pendingCommitment)
	if (count > 0 && validPrice) await loadOracleManagerQueueOperationEthValue(client, managerAddress)
	const [balance, currentBacking] = await Promise.all([client.readContract({ address: repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] }), client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'backingUnitsToAttoRep', args: [vault[0]] })])
	if (input.depositAttoRep > 0n && currentBacking + input.depositAttoRep < minimumDeposit) throw new Error(copy.minimumDeposit)
	const needsReport = count > 0 && !validPrice && pendingReportId === 0n
	if (needsReport && proposedPrice <= 0n) throw new Error(copy.initialPriceNeeded)
	const funding = needsReport ? await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, owner, proposedPrice) : undefined
	const requiredRep = input.depositAttoRep + (funding?.requiredRepAttoRep ?? 0n)
	if (balance < requiredRep) throw new Error(copy.insufficientRep)
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
		if (current.needsReport && (!initial.needsReport || (await loadOracleManagerQueueOperationEthValue(client, initial.managerAddress)) > value)) throw new Error(copy.fundingChanged)
		if (input.depositAttoRep > 0n) {
			const allowance = await client.readContract({ address: initial.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, pool] })
			if (allowance < input.depositAttoRep) throw new Error(copy.insufficientApproval)
		}
		try {
			await client.simulateContract({ ...call, account: client.account })
		} catch (failure) {
			// A direct eth_call also exposes revert data when estimate/simulation wrappers suppress it.
			try {
				await client.call({ account: client.account, to: executorAddress, data: encodeFunctionData(call), value })
			} catch (callFailure) {
				const reason = getVaultOperationsRevertReason(callFailure)
				if (reason !== undefined) throw new Error(reason)
			}
			const reason = getVaultOperationsRevertReason(failure)
			if (reason !== undefined) throw new Error(reason)
			throw failure
		}
	}
	const actions: FundingTransaction[] =
		input.depositAttoRep === 0n
			? []
			: [
					{
						step: { functionName: 'approve', contractAddress: initial.repToken, args: [pool, input.depositAttoRep], requiredApprovalAmount: input.depositAttoRep, approvalPurpose: copy.depositApprovalPurpose },
						isRequired: async () => (await client.readContract({ address: initial.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, pool] })) < input.depositAttoRep,
						execute: async () => await writeContractAndWait(client, () => ({ address: initial.repToken, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [pool, input.depositAttoRep] })),
					},
				]
	const finalStep = { ...call, contractAddress: executorAddress, reviewTitle: copy.submit, validateBeforeSubmit }
	if (initial.needsReport) await fundCoordinatorInitialReport(client, initial.managerAddress, proposedPrice, 0n, finalStep, { actions, repAttoRep: input.depositAttoRep })
	else await runFundingTransactions(client, actions, finalStep)
	await validateBeforeSubmit()
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => call)
	const queuedEvent = getStagedOracleQueuedResult(receipt, initial.managerAddress, 'vaultOperations')
	const stagedExecution = getStagedOracleExecutionResult(receipt, initial.managerAddress, 'vaultOperations')
	const queuedOperation = stagedExecution === undefined ? queuedEvent : undefined
	if (countVaultPriceActions(input) > 0 && queuedOperation === undefined && stagedExecution === undefined) throw new Error(copy.confirmedUnknown)
	return { hash, depositAttoRep: input.depositAttoRep, ...(queuedOperation === undefined ? {} : { queuedOperation }), ...(stagedExecution === undefined ? {} : { stagedExecution }) } satisfies VaultOperationsResult
}
