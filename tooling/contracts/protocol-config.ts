import { DEFAULT_PROTOCOL_CONFIG, type ProtocolConfig } from '../../shared/core/ts/deployment/protocolConfig'

// Frozen mainnet protocol configuration, guarded against environment or global override drift.
type ProtocolConfigInput = Partial<{
	[key in keyof ProtocolConfig]: bigint | number | string | undefined
}>

export const MAINNET_PROTOCOL_CONFIG: ProtocolConfig = {
	forkBurnDivisor: 5n,
	forkThresholdDivisor: 20n,
	minimumSecurityBondDebtAttoEth: DEFAULT_PROTOCOL_CONFIG.minimumSecurityBondDebtAttoEth,
	minimumVaultRepDepositAttoRep: DEFAULT_PROTOCOL_CONFIG.minimumVaultRepDepositAttoRep,
}

const PROTOCOL_CONFIG_GLOBAL_KEY = '__ZOLTAR_PROTOCOL_CONFIG__'
const PROTOCOL_CONFIG_ENV_KEYS = {
	forkBurnDivisor: 'ZOLTAR_FORK_BURN_DIVISOR',
	forkThresholdDivisor: 'ZOLTAR_FORK_THRESHOLD_DIVISOR',
	minimumSecurityBondDebtAttoEth: 'ZOLTAR_MINIMUM_SECURITY_BOND_DEBT',
	minimumVaultRepDepositAttoRep: 'ZOLTAR_MINIMUM_VAULT_REP_DEPOSIT',
} as const
const PROTOCOL_CONFIG_FIELDS = ['forkBurnDivisor', 'forkThresholdDivisor', 'minimumSecurityBondDebtAttoEth', 'minimumVaultRepDepositAttoRep'] as const satisfies readonly (keyof ProtocolConfig)[]

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

function readDefinedOverrides(read: (field: keyof ProtocolConfig) => bigint | number | string | undefined): ProtocolConfigInput {
	const overrides: ProtocolConfigInput = {}
	for (const field of PROTOCOL_CONFIG_FIELDS) {
		const value = read(field)
		if (value !== undefined) overrides[field] = value
	}
	return overrides
}

function getEnvironmentProtocolConfigOverrides(): ProtocolConfigInput {
	return readDefinedOverrides(field => readProcessEnv(PROTOCOL_CONFIG_ENV_KEYS[field]))
}

function readProtocolConfigOverrideValue(source: object, field: keyof ProtocolConfig) {
	const rawValue = Reflect.get(source, field)
	if (typeof rawValue === 'bigint' || typeof rawValue === 'number' || typeof rawValue === 'string') return rawValue
	return undefined
}

function getGlobalProtocolConfigOverrides(): ProtocolConfigInput {
	const rawConfig = Reflect.get(globalThis, PROTOCOL_CONFIG_GLOBAL_KEY)
	if (typeof rawConfig !== 'object' || rawConfig === null) return {}
	return readDefinedOverrides(field => readProtocolConfigOverrideValue(rawConfig, field))
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

function assertMainnetProtocolConfigFrozen(overrides: ProtocolConfigInput = {}): ProtocolConfig {
	for (const { config, source } of collectProtocolConfigOverrideSources(overrides)) {
		for (const field of PROTOCOL_CONFIG_FIELDS) {
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
