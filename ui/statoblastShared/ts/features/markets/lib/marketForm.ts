import type { ForkAuctionFormState, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from '../../../types/app.js'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { parseDecimalInput, tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { NANO_ETH_DECIMALS } from '../../security-pools/lib/priorityFee.js'

const STATOBLAST_SECURITY_MULTIPLIER_DECIMALS = 4

export { getDefaultMarketFormState } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionForm.js'

export function getDefaultSecurityPoolFormState(): SecurityPoolFormState {
	return {
		initialReportPriorityFeeNanoEth: formatCurrencyInputBalance(DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, NANO_ETH_DECIMALS),
		marketId: '',
		statoblastSecurityMultiplierBps: '2',
	}
}

export function parseStatoblastSecurityMultiplierBpsInput(value: string) {
	return parseDecimalInput(value, 'Security multiplier', STATOBLAST_SECURITY_MULTIPLIER_DECIMALS)
}

export function tryParseStatoblastSecurityMultiplierBpsInput(value: string) {
	return tryParseDecimalInput(value, STATOBLAST_SECURITY_MULTIPLIER_DECIMALS)
}

export function getDefaultSecurityVaultFormState(): SecurityVaultFormState {
	return {
		depositAmount: '',
		targetHealthFactor: '2',
		repWithdrawAmount: '',
		selectedVaultOwner: '',
		securityPoolAddress: '',
		stagedOperationTimeoutMinutes: '5',
	}
}

export function getDefaultTradingFormState(): TradingFormState {
	return {
		completeSetAmount: '',
		redeemAmount: '',
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
		submitBidAmount: '',
		submitBidPrice: '',
		vaultAddress: '',
	}
}
