/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import { DEFAULT_PROTOCOL_CONFIG, getProtocolConfig, validateProtocolConfig } from '@zoltar/shared/protocolConfig'

const PROTOCOL_CONFIG_GLOBAL_KEY = '__ZOLTAR_PROTOCOL_CONFIG__'
const FORK_BURN_ENV = 'ZOLTAR_FORK_BURN_DIVISOR'
const FORK_THRESHOLD_ENV = 'ZOLTAR_FORK_THRESHOLD_DIVISOR'
const INITIAL_ESCALATION_DEPOSIT_ENV = 'ZOLTAR_INITIAL_ESCALATION_GAME_DEPOSIT'

function getProcessEnv(name: string) {
	const processValue = Reflect.get(globalThis, 'process')
	if (typeof processValue !== 'object' || processValue === null) throw new Error('process is unavailable')
	const envValue = Reflect.get(processValue, 'env')
	if (typeof envValue !== 'object' || envValue === null) throw new Error('process.env is unavailable')
	const rawValue = Reflect.get(envValue, name)
	return typeof rawValue === 'string' ? rawValue : undefined
}

function setProcessEnv(name: string, value: string | undefined) {
	const processValue = Reflect.get(globalThis, 'process')
	if (typeof processValue !== 'object' || processValue === null) throw new Error('process is unavailable')
	const envValue = Reflect.get(processValue, 'env')
	if (typeof envValue !== 'object' || envValue === null) throw new Error('process.env is unavailable')
	if (value === undefined) {
		Reflect.deleteProperty(envValue, name)
		return
	}
	Reflect.set(envValue, name, value)
}

const originalForkBurnDivisor = getProcessEnv(FORK_BURN_ENV)
const originalForkThresholdDivisor = getProcessEnv(FORK_THRESHOLD_ENV)
const originalInitialEscalationDeposit = getProcessEnv(INITIAL_ESCALATION_DEPOSIT_ENV)
const originalGlobalProtocolConfig = Reflect.get(globalThis, PROTOCOL_CONFIG_GLOBAL_KEY)

describe('protocolConfig', () => {
	afterEach(() => {
		setProcessEnv(FORK_BURN_ENV, originalForkBurnDivisor)
		setProcessEnv(FORK_THRESHOLD_ENV, originalForkThresholdDivisor)
		setProcessEnv(INITIAL_ESCALATION_DEPOSIT_ENV, originalInitialEscalationDeposit)
		if (originalGlobalProtocolConfig === undefined) {
			Reflect.deleteProperty(globalThis, PROTOCOL_CONFIG_GLOBAL_KEY)
			return
		}
		Reflect.set(globalThis, PROTOCOL_CONFIG_GLOBAL_KEY, originalGlobalProtocolConfig)
	})

	test('getProtocolConfig resolves defaults, environment values, global overrides, and explicit overrides in precedence order', () => {
		setProcessEnv(FORK_BURN_ENV, '7')
		setProcessEnv(FORK_THRESHOLD_ENV, '23')
		setProcessEnv(INITIAL_ESCALATION_DEPOSIT_ENV, '4')
		Reflect.set(globalThis, PROTOCOL_CONFIG_GLOBAL_KEY, {
			forkBurnDivisor: '9',
			initialEscalationGameDeposit: '5',
		})

		expect(
			getProtocolConfig({
				forkThresholdDivisor: '11',
			}),
		).toEqual({
			forkBurnDivisor: 9n,
			forkThresholdDivisor: 11n,
			initialEscalationGameDeposit: 5n,
		})
	})

	test('validateProtocolConfig rejects invalid economic bounds', () => {
		expect(() => validateProtocolConfig({ ...DEFAULT_PROTOCOL_CONFIG, forkThresholdDivisor: 1n })).toThrow('forkThresholdDivisor must be greater than 1')
		expect(() => validateProtocolConfig({ ...DEFAULT_PROTOCOL_CONFIG, forkBurnDivisor: 1n })).toThrow('forkBurnDivisor must be greater than 1')
		expect(() => validateProtocolConfig({ ...DEFAULT_PROTOCOL_CONFIG, initialEscalationGameDeposit: 0n })).toThrow('initialEscalationGameDeposit must be greater than 0')
	})
})
