import { bigintToSafeNumber, type Abi, type Address } from '@zoltar/shared/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatTokenApprovalUnavailableMessage, type TokenApprovalRequirement, type TokenApprovalState } from '@zoltar/ui-core-shared/lib/tokenApproval.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-core-shared/types/contracts.js'

export type OpenOracleReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
	readContract: (parameters: { abi: Abi; address: Address; args: readonly unknown[]; functionName: string }) => Promise<unknown>
}

export type OpenOracleRawReadResult = { error?: unknown; result?: unknown; status: 'failure' | 'success' }

function parseTokenDecimals(value: unknown) {
	let decimals: number | undefined
	if (typeof value === 'bigint') decimals = bigintToSafeNumber(value, 'Token decimals')
	if (typeof value === 'number') decimals = value
	return decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : undefined
}

export type CreateTokenDecimalsReadResult = { decimals: number; status: 'success' } | { message: string; status: 'failure' }

export async function readCreateTokenDecimals(readClient: OpenOracleReadClient, address: Address, label: 'Base' | 'Quote'): Promise<CreateTokenDecimalsReadResult> {
	try {
		const value = await readClient.readContract({ abi: ABIS.mainnet.erc20, address, args: [], functionName: 'decimals' })
		const decimals = parseTokenDecimals(value)
		return decimals === undefined ? { message: `${label} token address is not a readable ERC-20 contract.`, status: 'failure' } : { decimals, status: 'success' }
	} catch (error) {
		if (!isRecoverableContractReadError(error)) throw error
		return { message: `${label} token address is not a readable ERC-20 contract.`, status: 'failure' }
	}
}

export type TokenAccessLoadResult = {
	amount: bigint | undefined
	error: string | undefined
}

export type OpenOracleTokenAccessLoadResult = {
	token1ApprovalResult: TokenApprovalState
	token2ApprovalResult: TokenApprovalState
	token1BalanceResult: TokenAccessLoadResult
	token2BalanceResult: TokenAccessLoadResult
}

export type LoadedOracleReportResult = {
	details: OpenOracleReportDetails
	reportId: bigint
}

export type RefreshOpenOracleTokenAccessOptions = {
	preserveExisting?: boolean
}

export function getRefreshedOpenOracleApprovalAmount({ approvalError, explicitAmount, requirement, tokenLabel }: { approvalError: string | undefined; explicitAmount: bigint | undefined; requirement: TokenApprovalRequirement; tokenLabel: 'base token' | 'quote token' }) {
	if (requirement.requiredAmount === undefined || requirement.requiredAmount <= 0n) throw new Error(`No ${tokenLabel} approval is required for the refreshed report`)
	if (requirement.approvedAmount === undefined) {
		throw new Error(
			formatTokenApprovalUnavailableMessage({
				actionLabel: 'submitting this approval',
				reason: approvalError,
				tokenLabel,
			}),
		)
	}
	if (requirement.hasSufficientApproval) throw new Error(`The ${tokenLabel} approval is already sufficient for the refreshed report`)
	const approvalAmount = explicitAmount ?? requirement.targetAmount
	if (approvalAmount === undefined) throw new Error(`No ${tokenLabel} approval amount is required for the refreshed report`)
	if (approvalAmount <= requirement.approvedAmount) throw new Error(`The ${tokenLabel} approval must increase the current allowance`)
	if (approvalAmount < requirement.requiredAmount) throw new Error(`The ${tokenLabel} approval must cover the refreshed dispute requirement`)
	return approvalAmount
}

export type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }

export function toReadError(error: unknown) {
	return error instanceof Error ? error : new Error('Unknown read error')
}

export function toBigIntReadResult(result: OpenOracleRawReadResult): OptionalReadResult<bigint> {
	if (result.status === 'success') {
		if (typeof result.result !== 'bigint') {
			return {
				error: new Error('Unexpected non-bigint OpenOracle token access value'),
				status: 'failure',
			}
		}
		return {
			result: result.result,
			status: 'success',
		}
	}
	return {
		error: toReadError(result.error),
		status: 'failure',
	}
}
