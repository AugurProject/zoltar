import type { OracleManagerDetails, OracleQueueOperation } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { formatCurrencyBalance } from './formatters.js'
import { addOpenOracleBountyBuffer } from './openOracle.js'

const ORACLE_PRICE_PRECISION = 10n ** 18n

function getBufferedOracleRequestEthValue(requestPriceEthCost: bigint | undefined) {
	if (requestPriceEthCost === undefined) return undefined
	return addOpenOracleBountyBuffer(requestPriceEthCost)
}

function getRepToEthNotional(repAmount: bigint, price: bigint) {
	if (repAmount <= 0n || price <= 0n) return 0n
	const numerator = repAmount * ORACLE_PRICE_PRECISION
	return (numerator - 1n) / price + 1n
}

function getLiquidationNotionalEth({ amount, currentTargetAllowance, currentTargetRepDeposit, managerDetails }: { amount: bigint; currentTargetAllowance: bigint | undefined; currentTargetRepDeposit: bigint | undefined; managerDetails: Pick<OracleManagerDetails, 'lastPrice'> }) {
	if (currentTargetAllowance === undefined || currentTargetRepDeposit === undefined) return undefined
	const debtToMove = amount > currentTargetAllowance ? currentTargetAllowance : amount
	if (debtToMove === 0n || currentTargetAllowance === 0n) return 0n
	const repToMove = (debtToMove * currentTargetRepDeposit) / currentTargetAllowance
	const repEthValue = getRepToEthNotional(repToMove, managerDetails.lastPrice)
	return debtToMove > repEthValue ? debtToMove : repEthValue
}

function getOracleOperationNotionalEth({
	amount,
	currentTargetAllowance,
	currentTargetRepDeposit,
	managerDetails,
	operation,
}: {
	amount: bigint
	currentTargetAllowance: bigint | undefined
	currentTargetRepDeposit: bigint | undefined
	managerDetails: Pick<OracleManagerDetails, 'lastPrice'>
	operation: OracleQueueOperation
}) {
	switch (operation) {
		case 'withdrawRep':
			return getRepToEthNotional(amount, managerDetails.lastPrice)
		case 'setSecurityBondsAllowance':
			if (currentTargetAllowance === undefined) return undefined
			return amount > currentTargetAllowance ? amount - currentTargetAllowance : 0n
		case 'liquidation':
			return getLiquidationNotionalEth({
				amount,
				currentTargetAllowance,
				currentTargetRepDeposit,
				managerDetails,
			})
		default:
			return assertNever(operation)
	}
}

export function resolveOracleOperationEthFunding({
	amount,
	currentTargetAllowance,
	currentTargetRepDeposit,
	managerDetails,
	operation,
}: {
	amount: bigint
	currentTargetAllowance: bigint | undefined
	currentTargetRepDeposit: bigint | undefined
	managerDetails: OracleManagerDetails | undefined
	operation: OracleQueueOperation
}) {
	if (managerDetails === undefined) return undefined
	const operationNotionalEth = getOracleOperationNotionalEth({
		amount,
		currentTargetAllowance,
		currentTargetRepDeposit,
		managerDetails,
		operation,
	})
	if (operationNotionalEth !== undefined && managerDetails.isPriceValid && operationNotionalEth <= (managerDetails.priceRoundRemainingNotional ?? 0n)) {
		return {
			ethCost: 0n,
			includeBuffer: false,
		}
	}
	const pendingSettlementQueueCapacity = managerDetails.pendingSettlementQueueCapacity
	if (managerDetails.pendingReportId !== 0n && pendingSettlementQueueCapacity > 0n && BigInt(managerDetails.pendingSettlementOperationIds.length) < pendingSettlementQueueCapacity) {
		return {
			ethCost: managerDetails.queuedOperationEthCost,
			includeBuffer: true,
		}
	}
	if (managerDetails.pendingReportId === 0n && managerDetails.pendingSettlementOperationIds.length === 0) {
		return {
			ethCost: managerDetails.requestPriceEthCost,
			includeBuffer: true,
		}
	}
	return {
		ethCost: 0n,
		includeBuffer: false,
	}
}

export function getOracleRequestEthGuardMessage({ actionLabel, includeBuffer = false, requiredEthCost, walletEthBalance }: { actionLabel: string; includeBuffer?: boolean; requiredEthCost: bigint | undefined; walletEthBalance: bigint | undefined }) {
	const requiredEthValue = includeBuffer ? getBufferedOracleRequestEthValue(requiredEthCost) : requiredEthCost
	if (requiredEthValue === undefined) return undefined
	if (requiredEthValue === 0n) return undefined
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (walletEthBalance >= requiredEthValue) return undefined
	return `Need ${formatCurrencyBalance(requiredEthValue - walletEthBalance)} more ETH in this wallet to ${actionLabel}.`
}
