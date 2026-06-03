import type { ForkAuctionFormState, MarketFormState, OpenOracleCreateFormState, OpenOracleFormState, ReportingFormState, ReportingWithdrawDepositIndexesByOutcome, SecurityPoolFormState, SecurityVaultFormState, TradingFormState, ZoltarMigrationFormState } from '../types/app.js'
import { parseDecimalInput, tryParseDecimalInput } from './decimal.js'

const WHOLE_NUMBER_PATTERN = /^-?\d+$/
const HEX_BIGINT_PATTERN = /^0x[0-9a-fA-F]+$/

const DEFAULT_CURRENT_RETENTION_RATE = '10'

export function getDefaultMarketFormState(): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: ['Yes', 'No'],
		description: '',
		endTime: '',
		marketType: 'binary',
		scalarIncrement: '1',
		scalarMax: '100',
		scalarMin: '0',
		title: '',
		startTime: '',
	}
}

export function getDefaultSecurityPoolFormState(): SecurityPoolFormState {
	return {
		currentRetentionRate: DEFAULT_CURRENT_RETENTION_RATE,
		marketId: '',
		securityMultiplier: '2',
	}
}

export function getDefaultSecurityVaultFormState(): SecurityVaultFormState {
	return {
		depositAmount: '0',
		securityBondAllowanceAmount: '0',
		repWithdrawAmount: '0',
		selectedVaultAddress: '',
		securityPoolAddress: '',
	}
}

export function getDefaultOpenOracleFormState(): OpenOracleFormState {
	return {
		amount1: '0',
		amount2: '0',
		disputeNewAmount1: '0',
		disputeNewAmount2: '0',
		disputeTokenToSwap: 'token1',
		reportId: '',
		price: '',
		stateHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
	}
}

export function getDefaultOpenOracleCreateFormState(): OpenOracleCreateFormState {
	return {
		disputeDelay: '0',
		escalationHalt: '0',
		exactToken1Report: '0',
		ethValue: '0',
		feePercentage: '0',
		multiplier: '100',
		protocolFee: '0',
		settlementTime: '0',
		settlerReward: '0',
		token1Address: '',
		token2Address: '',
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

export function getDefaultReportingWithdrawDepositIndexesByOutcome(): ReportingWithdrawDepositIndexesByOutcome {
	return {
		invalid: [],
		yes: [],
		no: [],
	}
}

export function getDefaultReportingFormState(): ReportingFormState {
	return {
		reportAmount: '0',
		securityPoolAddress: '',
		selectedOutcome: undefined,
		selectedWithdrawDepositIndexesByOutcome: getDefaultReportingWithdrawDepositIndexesByOutcome(),
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

export function getDefaultZoltarMigrationFormState(): ZoltarMigrationFormState {
	return {
		amount: '0.0',
		outcomeIndexes: '0',
	}
}

function validateAndTrim(value: string, label: string): string {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	return trimmed
}

export function parseRepAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseRepAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseOptionalRepAmountInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return undefined
	return tryParseRepAmountInput(trimmed)
}

export function tryParseBigIntInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '' || (!WHOLE_NUMBER_PATTERN.test(trimmed) && !HEX_BIGINT_PATTERN.test(trimmed))) return undefined
	return BigInt(trimmed)
}

export function parseBigIntInput(value: string, label: string) {
	const trimmed = validateAndTrim(value, label)
	const parsed = tryParseBigIntInput(trimmed)
	if (parsed === undefined) throw new Error(`${label} must be a whole number`)
	return parsed
}

export function parseTradingAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseTradingAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseTruthAuctionPriceInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseTruthAuctionPriceInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseTruthAuctionAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseTruthAuctionAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseTimestampInput(value: string, label: string) {
	const timestampMs = new Date(value).getTime()
	if (Number.isNaN(timestampMs)) throw new Error(`${label} is invalid`)
	return BigInt(Math.floor(timestampMs / 1000))
}
