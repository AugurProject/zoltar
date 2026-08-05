import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'

type ProtocolConfig = {
	forkBurnDivisor: bigint
	forkThresholdDivisor: bigint
	initialEscalationGameDepositAttoRep: bigint
}

type ProtocolConfigInput = Partial<{
	[key in keyof ProtocolConfig]: bigint | number | string | undefined
}>

const PROTOCOL_CONFIG_GLOBAL_KEY = '__ZOLTAR_PROTOCOL_CONFIG__'

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
	const forkBurnDivisor = readProcessEnv('ZOLTAR_FORK_BURN_DIVISOR')
	const forkThresholdDivisor = readProcessEnv('ZOLTAR_FORK_THRESHOLD_DIVISOR')
	const initialEscalationGameDepositAttoRep = readProcessEnv('ZOLTAR_INITIAL_ESCALATION_GAME_DEPOSIT')
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

function validateProtocolConfig(config: ProtocolConfigInput): ProtocolConfig {
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
