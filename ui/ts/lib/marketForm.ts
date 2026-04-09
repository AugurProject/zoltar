import { parseUnits, zeroAddress } from 'viem'
import type { ForkAuctionFormState, MarketFormState, OpenOracleCreateFormState, OpenOracleReportFormState, ReportingFormState, SecurityPoolFormState, SecurityVaultFormState, TradingFormState, ZoltarMigrationFormState } from '../types/app.js'

const DEFAULT_CURRENT_RETENTION_RATE = '10'

export function getDefaultMarketFormState(): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: 'Yes\nNo',
		description: '',
		displayValueMax: '100',
		displayValueMin: '0',
		endTime: '',
		marketType: 'binary',
		numTicks: '100',
		title: '',
		startTime: '',
	}
}

export function getDefaultSecurityPoolFormState(): SecurityPoolFormState {
	return {
		currentRetentionRate: DEFAULT_CURRENT_RETENTION_RATE,
		marketId: '',
		securityMultiplier: '2',
		startingRepEthPrice: '10',
	}
}

export function getDefaultSecurityVaultFormState(): SecurityVaultFormState {
	return {
		depositAmount: '0',
		repApprovalAmount: '0',
		securityPoolAddress: '',
	}
}

export function getDefaultOpenOracleCreateFormState(): OpenOracleCreateFormState {
	return {
		callbackContract: zeroAddress,
		callbackGasLimit: '0',
		callbackSelector: '0x00000000',
		disputeDelay: '0',
		escalationHalt: '0',
		exactToken1Report: '1',
		feePercentage: '3000',
		feeToken: 'true',
		keepFee: 'true',
		multiplier: '110',
		protocolFee: '0',
		protocolFeeRecipient: zeroAddress,
		settlementTime: '60',
		settlerReward: '100000000000000',
		timeType: 'true',
		token1Address: '',
		token2Address: '',
		transactionValue: '1000000000000000',
		trackDisputes: 'false',
	}
}

export function getDefaultOpenOracleReportFormState(): OpenOracleReportFormState {
	return {
		amount1: '0',
		amount2: '0',
		reportId: '',
		stateHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
	}
}

export function getDefaultTradingFormState(): TradingFormState {
	return {
		completeSetAmount: '0',
		fromUniverseId: '0',
		redeemAmount: '0',
		securityPoolAddress: '',
		selectedOutcome: 'yes',
	}
}

export function getDefaultReportingFormState(): ReportingFormState {
	return {
		reportAmount: '0',
		securityPoolAddress: '',
		selectedOutcome: 'yes',
		withdrawDepositIndexes: '',
	}
}

export function getDefaultForkAuctionFormState(): ForkAuctionFormState {
	return {
		bidAmount: '0',
		bidIndex: '0',
		bidTick: '0',
		claimVaultAddress: '',
		depositIndexes: '',
		directForkQuestionId: '',
		directForkUniverseId: '0',
		refundBidIndex: '0',
		refundTick: '0',
		repMigrationOutcomes: 'yes',
		securityPoolAddress: '',
		selectedOutcome: 'yes',
		withdrawBidIndex: '0',
		withdrawForAddress: '',
		withdrawTick: '0',
	}
}

export function getDefaultZoltarMigrationFormState(): ZoltarMigrationFormState {
	return {
		amount: '0.0',
		outcomeIndexes: '0',
	}
}

export function parseRepAmountInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)

	const normalized = trimmed.startsWith('.') ? `0${trimmed}` : trimmed.endsWith('.') ? `${trimmed}0` : trimmed

	try {
		return parseUnits(normalized, 18)
	} catch {
		throw new Error(`${label} must be a decimal number`)
	}
}

export function parseBigIntInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	try {
		return BigInt(trimmed)
	} catch {
		throw new Error(`${label} must be a whole number`)
	}
}

export function parseTimestampInput(value: string, label: string) {
	const timestampMs = new Date(value).getTime()
	if (Number.isNaN(timestampMs)) throw new Error(`${label} is invalid`)
	return BigInt(Math.floor(timestampMs / 1000))
}
