import type { ForkAuctionFormState, MarketFormState, OpenOracleFormState, ReportingFormState, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from '../types/app.js'

function toDatetimeLocalValue(timestampMs: number) {
	const date = new Date(timestampMs)
	const offset = date.getTimezoneOffset()
	const localDate = new Date(date.getTime() - offset * 60 * 1000)
	return localDate.toISOString().slice(0, 16)
}

export function getDefaultMarketFormState(): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: 'Yes\nNo',
		currentRetentionRate: '999999996848000000',
		description: '',
		displayValueMax: '100',
		displayValueMin: '0',
		endTime: toDatetimeLocalValue(Date.now() + 24 * 60 * 60 * 1000),
		marketType: 'binary',
		numTicks: '100',
		scalarStartValue: '10',
		title: '',
		startTime: '',
		securityMultiplier: '2',
		startingRepEthPrice: '10',
	}
}

export function getDefaultSecurityPoolFormState(): SecurityPoolFormState {
	return {
		currentRetentionRate: '999999996848000000',
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

export function getDefaultOpenOracleFormState(): OpenOracleFormState {
	return {
		amount1: '0',
		amount2: '0',
		managerAddress: '',
		reportId: '',
		stateHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
	}
}

export function getDefaultTradingFormState(): TradingFormState {
	return {
		completeSetAmount: '0',
		redeemAmount: '0',
		securityPoolAddress: '',
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
		refundBidIndex: '0',
		refundTick: '0',
		repMigrationOutcomes: 'yes',
		securityPoolAddress: '',
		selectedOutcome: 'yes',
	}
}

export function parseBigIntInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${ label } is required`)
	try {
		return BigInt(trimmed)
	} catch {
		throw new Error(`${ label } must be a whole number`)
	}
}

export function parseTimestampInput(value: string, label: string) {
	const timestampMs = new Date(value).getTime()
	if (Number.isNaN(timestampMs)) throw new Error(`${ label } is invalid`)
	return BigInt(Math.floor(timestampMs / 1000))
}
