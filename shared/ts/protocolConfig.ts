export type ProtocolConfig = {
	forkBurnDivisor: bigint
	forkThresholdDivisor: bigint
	initialEscalationGameDepositAttoRep: bigint
}

export type ProtocolConfigInput = Partial<{
	[key in keyof ProtocolConfig]: bigint | number | string | undefined
}>

export const DEFAULT_FORK_BURN_DIVISOR = 5n
export const DEFAULT_FORK_THRESHOLD_DIVISOR = 20n
export const DEFAULT_INITIAL_ESCALATION_GAME_DEPOSIT = 10n ** 18n

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
	forkBurnDivisor: DEFAULT_FORK_BURN_DIVISOR,
	forkThresholdDivisor: DEFAULT_FORK_THRESHOLD_DIVISOR,
	initialEscalationGameDepositAttoRep: DEFAULT_INITIAL_ESCALATION_GAME_DEPOSIT,
}

export const MAINNET_PROTOCOL_CONFIG: ProtocolConfig = {
	forkBurnDivisor: 5n,
	forkThresholdDivisor: 20n,
	initialEscalationGameDepositAttoRep: 10n ** 18n,
}

const PROTOCOL_CONFIG_GLOBAL_KEY = '__ZOLTAR_PROTOCOL_CONFIG__'
const PROTOCOL_CONFIG_ENV_KEYS = {
	forkBurnDivisor: 'ZOLTAR_FORK_BURN_DIVISOR',
	forkThresholdDivisor: 'ZOLTAR_FORK_THRESHOLD_DIVISOR',
	initialEscalationGameDepositAttoRep: 'ZOLTAR_INITIAL_ESCALATION_GAME_DEPOSIT',
} as const

function parseConfigBigInt(value: bigint | number | string | undefined, field: keyof ProtocolConfig): bigint | undefined {
	if (value === undefined) return undefined
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') {
		if (!Number.isInteger(value)) throw new Error(`Protocol config ${field} must be an integer`)
		return BigInt(value)
	}
	const trimmedValue = value.trim()
	if (trimmedValue === '') return undefined
	return BigInt(trimmedValue)
}

function readProcessEnv(name: string): string | undefined {
	const processValue = Reflect.get(globalThis, 'process')
	if (typeof processValue !== 'object' || processValue === null) return undefined
	const envValue = Reflect.get(processValue, 'env')
	if (typeof envValue !== 'object' || envValue === null) return undefined
	const rawValue = Reflect.get(envValue, name)
	if (typeof rawValue !== 'string') return undefined
	const trimmedValue = rawValue.trim()
	return trimmedValue === '' ? undefined : trimmedValue
}

function getEnvironmentProtocolConfigOverrides(): ProtocolConfigInput {
	const forkBurnDivisor = readProcessEnv(PROTOCOL_CONFIG_ENV_KEYS.forkBurnDivisor)
	const forkThresholdDivisor = readProcessEnv(PROTOCOL_CONFIG_ENV_KEYS.forkThresholdDivisor)
	const initialEscalationGameDepositAttoRep = readProcessEnv(PROTOCOL_CONFIG_ENV_KEYS.initialEscalationGameDepositAttoRep)
	return {
		...(forkBurnDivisor === undefined ? {} : { forkBurnDivisor }),
		...(forkThresholdDivisor === undefined ? {} : { forkThresholdDivisor }),
		...(initialEscalationGameDepositAttoRep === undefined ? {} : { initialEscalationGameDepositAttoRep }),
	}
}

function readProtocolConfigOverrideValue(source: object, field: keyof ProtocolConfig) {
	const rawValue = Reflect.get(source, field)
	if (typeof rawValue === 'bigint' || typeof rawValue === 'number' || typeof rawValue === 'string') return rawValue
	return undefined
}

function getGlobalProtocolConfigOverrides(): ProtocolConfigInput {
	const rawConfig = Reflect.get(globalThis, PROTOCOL_CONFIG_GLOBAL_KEY)
	if (typeof rawConfig !== 'object' || rawConfig === null) return {}
	const forkBurnDivisor = readProtocolConfigOverrideValue(rawConfig, 'forkBurnDivisor')
	const forkThresholdDivisor = readProtocolConfigOverrideValue(rawConfig, 'forkThresholdDivisor')
	const initialEscalationGameDepositAttoRep = readProtocolConfigOverrideValue(rawConfig, 'initialEscalationGameDepositAttoRep')
	return {
		...(forkBurnDivisor === undefined ? {} : { forkBurnDivisor }),
		...(forkThresholdDivisor === undefined ? {} : { forkThresholdDivisor }),
		...(initialEscalationGameDepositAttoRep === undefined ? {} : { initialEscalationGameDepositAttoRep }),
	}
}

export function validateProtocolConfig(config: ProtocolConfigInput): ProtocolConfig {
	const forkBurnDivisor = parseConfigBigInt(config.forkBurnDivisor, 'forkBurnDivisor')
	const forkThresholdDivisor = parseConfigBigInt(config.forkThresholdDivisor, 'forkThresholdDivisor')
	const initialEscalationGameDepositAttoRep = parseConfigBigInt(config.initialEscalationGameDepositAttoRep, 'initialEscalationGameDepositAttoRep')
	if (forkThresholdDivisor === undefined) throw new Error('Protocol config forkThresholdDivisor is required')
	if (forkBurnDivisor === undefined) throw new Error('Protocol config forkBurnDivisor is required')
	if (initialEscalationGameDepositAttoRep === undefined) throw new Error('Protocol config initialEscalationGameDepositAttoRep is required')
	if (forkThresholdDivisor <= 1n) throw new Error('Protocol config forkThresholdDivisor must be greater than 1')
	if (forkBurnDivisor < 5n) throw new Error('Protocol config forkBurnDivisor must be at least 5')
	if (initialEscalationGameDepositAttoRep < 10n ** 18n) throw new Error('Protocol config initialEscalationGameDepositAttoRep must be at least 1 REP')
	return {
		forkBurnDivisor,
		forkThresholdDivisor,
		initialEscalationGameDepositAttoRep,
	}
}

export function getProtocolConfig(overrides: ProtocolConfigInput = {}): ProtocolConfig {
	return validateProtocolConfig({
		...DEFAULT_PROTOCOL_CONFIG,
		...getEnvironmentProtocolConfigOverrides(),
		...getGlobalProtocolConfigOverrides(),
		...overrides,
	})
}

function collectProtocolConfigOverrideSources(overrides: ProtocolConfigInput) {
	const environmentOverrides = getEnvironmentProtocolConfigOverrides()
	const globalOverrides = getGlobalProtocolConfigOverrides()
	return [
		{ config: environmentOverrides, source: 'environment' },
		{ config: globalOverrides, source: 'global' },
		{ config: overrides, source: 'explicit' },
	] as const
}

export function assertMainnetProtocolConfigFrozen(overrides: ProtocolConfigInput = {}): ProtocolConfig {
	for (const { config, source } of collectProtocolConfigOverrideSources(overrides)) {
		for (const field of Object.keys(MAINNET_PROTOCOL_CONFIG) as Array<keyof ProtocolConfig>) {
			const overrideValue = parseConfigBigInt(config[field], field)
			if (overrideValue === undefined) continue
			if (overrideValue === MAINNET_PROTOCOL_CONFIG[field]) continue
			const detail = source === 'environment' ? ` via ${PROTOCOL_CONFIG_ENV_KEYS[field]}` : ''
			throw new Error(`Mainnet protocol config ${field} is frozen at ${MAINNET_PROTOCOL_CONFIG[field].toString()} but ${source}${detail} provided ${overrideValue.toString()}`)
		}
	}
	return MAINNET_PROTOCOL_CONFIG
}

export function getMainnetProtocolConfig(overrides: ProtocolConfigInput = {}): ProtocolConfig {
	return assertMainnetProtocolConfigFrozen(overrides)
}
