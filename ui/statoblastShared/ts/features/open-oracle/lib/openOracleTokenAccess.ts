import { bigintToSafeNumber, type Abi, type AbiValue, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatTokenApprovalUnavailableMessage, type TokenApprovalRequirement, type TokenApprovalState } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { toBigIntReadResult } from '@zoltar/ui-core-shared/lib/optionalReadResult.js'
import * as openOracleCopy from '../../../copy/openOracle.js'

export type OpenOracleReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
	readContract: (parameters: { abi: Abi; address: Address; args: readonly AbiValue[]; functionName: string }) => Promise<AbiValue | undefined>
}

export type OpenOracleRawReadResult = { error?: unknown; result?: AbiValue; status: 'failure' | 'success' }

function parseTokenDecimals(value: unknown) {
	let decimals: number | undefined
	if (typeof value === 'bigint') decimals = bigintToSafeNumber(value, 'Token decimals')
	if (typeof value === 'number') decimals = value
	return decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : undefined
}

type CreateTokenDecimalsReadResult = { decimals: number; status: 'success' } | { message: string; status: 'failure' }

export async function readCreateTokenDecimals(readClient: Pick<OpenOracleReadClient, 'readContract'>, address: Address, label: 'Base' | 'Quote'): Promise<CreateTokenDecimalsReadResult> {
	try {
		const value = await readClient.readContract({ abi: ABIS.mainnet.erc20, address, args: [], functionName: 'decimals' })
		const decimals = parseTokenDecimals(value)
		return decimals === undefined ? { message: openOracleCopy.formatTokenMetadataUnreadable(label), status: 'failure' } : { decimals, status: 'success' }
	} catch (error) {
		if (!isRecoverableContractReadError(error)) throw error
		return { message: openOracleCopy.formatTokenMetadataUnreadable(label), status: 'failure' }
	}
}

export type CreateTokenMetadataReadResult = { decimals: number; status: 'success'; symbol: string | undefined } | { message: string; status: 'failure' }

/** Reads the decimals the create form needs to validate amounts and the symbol it shows as the amount unit; a missing symbol is not an error. */
export async function readCreateTokenMetadata(readClient: Pick<OpenOracleReadClient, 'readContract'>, address: Address, label: 'Base' | 'Quote'): Promise<CreateTokenMetadataReadResult> {
	const decimalsResult = await readCreateTokenDecimals(readClient, address, label)
	if (decimalsResult.status === 'failure') return decimalsResult
	const symbol = await readClient.readContract({ abi: ABIS.mainnet.erc20, address, args: [], functionName: 'symbol' }).then(
		value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined),
		(error: unknown) => {
			if (!isRecoverableContractReadError(error)) throw error
			return undefined
		},
	)
	return { decimals: decimalsResult.decimals, status: 'success', symbol }
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

export type RefreshOpenOracleTokenAccessOptions = {
	preserveExisting?: boolean
}

export function getRefreshedOpenOracleApprovalAmount({ approvalError, explicitAmount, requirement, tokenLabel }: { approvalError: string | undefined; explicitAmount: bigint | undefined; requirement: TokenApprovalRequirement; tokenLabel: string }) {
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

export function toTokenAccessReadResult(result: OpenOracleRawReadResult) {
	return toBigIntReadResult(result, 'OpenOracle token access')
}
