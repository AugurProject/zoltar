import type { Address } from '@zoltar/core-shared/evm/ethereum'

export type LiquidationApprovalDetails = {
	registryAddress: Address
	params: {
		securityPool: Address
		receiverVault: Address
		operator: Address
		targetVault: Address
		maxCumulativeDebtAttoEth: bigint
		maxDebtPerLiquidationAttoEth: bigint
		minPostLiquidationHealthFactorBps: bigint
		validAfter: bigint
		validUntil: bigint
		nonce: bigint
	}
	availableDebtAttoEth: bigint
	reservedDebtAttoEth: bigint
	consumedDebtAttoEth: bigint
	minimumValidNonce: bigint
	revoked: boolean
}
