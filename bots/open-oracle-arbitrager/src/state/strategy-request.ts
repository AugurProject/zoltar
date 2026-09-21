import { record as validateRecord, integer } from '@zoltar/bot-shared/infrastructure/json-validation'
import { parseDecimalWeth, strategySettings, type MutableStrategy, type StrategySettings } from '#state/operator-state'

const SETTING_LABELS = {
	maxSpotTwapTicks: 'Maximum spot/TWAP ticks',
	minimumProfitBps: 'Minimum return',
	minimumProfitWeth: 'Minimum profit',
	minimumRemainingBlocks: 'Minimum remaining blocks',
	minimumRemainingSeconds: 'Minimum remaining seconds',
	pollMilliseconds: 'Poll interval',
	twapSeconds: 'TWAP window',
} satisfies Record<keyof StrategySettings, string>

function requiredRecord(value: unknown) {
	return validateRecord(value, 'Settings', 'Settings must be a JSON object')
}

function requiredDecimal(record: Record<string, unknown>, key: keyof StrategySettings) {
	const value = record[key]
	if (typeof value !== 'string') throw new Error(`${SETTING_LABELS[key]} must be a decimal value`)
	return value
}

function requiredInteger(record: Record<string, unknown>, key: keyof StrategySettings, minimum: number, maximum: number) {
	const label = SETTING_LABELS[key]
	return integer(record[key], label, minimum, maximum, `${label} must be an integer from ${minimum.toString()} to ${maximum.toString()}`)
}

function requiredBigInt(record: Record<string, unknown>, key: keyof StrategySettings, minimum: bigint, maximum: bigint) {
	const value = requiredDecimal(record, key)
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${SETTING_LABELS[key]} must be a non-negative integer`)
	const parsed = BigInt(value)
	if (parsed < minimum || parsed > maximum) throw new Error(`${SETTING_LABELS[key]} must be from ${minimum.toString()} to ${maximum.toString()}`)
	return parsed
}

export function updateStrategyFromRequest(strategy: MutableStrategy, value: unknown) {
	const record = requiredRecord(value)
	const allowed = new Set<keyof StrategySettings>(['maxSpotTwapTicks', 'minimumProfitBps', 'minimumProfitWeth', 'minimumRemainingBlocks', 'minimumRemainingSeconds', 'pollMilliseconds', 'twapSeconds'])
	for (const key of Object.keys(record)) {
		if (!allowed.has(key as keyof StrategySettings)) throw new Error(`Unknown strategy setting: ${key}`)
	}
	const expected = allowed.size
	if (Object.keys(record).length !== expected) throw new Error('Every strategy setting is required')
	const minimumProfitAttoWeth = parseDecimalWeth(requiredDecimal(record, 'minimumProfitWeth'))
	if (minimumProfitAttoWeth > 1_000n * 10n ** 18n) throw new Error('Minimum profit must not exceed 1000 WETH')
	const maxSpotTwapTicks = requiredBigInt(record, 'maxSpotTwapTicks', 0n, 100_000n)
	const minimumProfitBps = requiredBigInt(record, 'minimumProfitBps', 0n, 100_000n)
	const minimumRemainingBlocks = requiredBigInt(record, 'minimumRemainingBlocks', 1n, 1_000n)
	const minimumRemainingSeconds = requiredBigInt(record, 'minimumRemainingSeconds', 1n, 86_400n)
	const pollMilliseconds = requiredInteger(record, 'pollMilliseconds', 1_000, 3_600_000)
	const twapSeconds = requiredInteger(record, 'twapSeconds', 60, 86_400)
	strategy.maxSpotTwapTicks = maxSpotTwapTicks
	strategy.minimumProfitBps = minimumProfitBps
	strategy.minimumProfitAttoWeth = minimumProfitAttoWeth
	strategy.minimumRemainingBlocks = minimumRemainingBlocks
	strategy.minimumRemainingSeconds = minimumRemainingSeconds
	strategy.pollMilliseconds = pollMilliseconds
	strategy.twapSeconds = twapSeconds
	return strategySettings(strategy)
}
