import type { ForkAuctionFormState, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from '../../../types/app.js'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/shared/oracleInitialReport'
import { parseDecimalInput, tryParseDecimalInput } from '@zoltar/ui-core-shared/lib/decimal.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'

const STATOBLAST_SECURITY_MULTIPLIER_DECIMALS = 4

export { getDefaultMarketFormState } from '@zoltar/ui-zoltar/features/questions/lib/questionForm.js'

export function getDefaultSecurityPoolFormState(): SecurityPoolFormState {
	return {
		initialReportPriorityFeeGwei: formatCurrencyInputBalance(DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, 9),
		marketId: '',
		statoblastSecurityMultiplierBps: '2',
	}
}

export function parseStatoblastSecurityMultiplierBpsInput(value: string) {
	return parseDecimalInput(value, 'Statoblast security multiplier', STATOBLAST_SECURITY_MULTIPLIER_DECIMALS)
}

export function tryParseStatoblastSecurityMultiplierBpsInput(value: string) {
	return tryParseDecimalInput(value, STATOBLAST_SECURITY_MULTIPLIER_DECIMALS)
}

export function getDefaultSecurityVaultFormState(): SecurityVaultFormState {
	return {
		depositAmount: '0',
		targetHealthFactor: '2',
		repWithdrawAmount: '0',
		selectedVaultOwner: '',
		securityPoolAddress: '',
		stagedOperationTimeoutMinutes: '5',
	}
}

export function getDefaultTradingFormState(): TradingFormState {
	return {
		completeSetAmount: '0',
		redeemAmount: '0',
		securityPoolAddress: '',
		selectedShareOutcome: 'yes',
		targetOutcomeIndexes: '',
	}
}

export function getDefaultForkAuctionFormState(): ForkAuctionFormState {
	return {
		claimBidIndex: '0',
		claimBidTick: '0',
		depositIndexes: '',
		directForkQuestionId: '',
		directForkUniverseId: '0',
		refundBidIndex: '0',
		refundTick: '0',
		repMigrationOutcomes: 'yes',
		securityPoolAddress: '',
		selectedOutcome: 'yes',
		settlementAddress: '',
		submitBidAmount: '0',
		submitBidPrice: '0',
		vaultAddress: '',
	}
}
