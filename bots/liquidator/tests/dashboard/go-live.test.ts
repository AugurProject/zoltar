import { describe, expect, test } from 'bun:test'
import { executionSignerRow } from '../../src/dashboard/go-live.ts'

const active = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const saved = '0x1111111111111111111111111111111111111111'

describe('execution signer readiness', () => {
	test('is not ready while the saved key differs from the active signer, which the controller refuses', () => {
		expect(executionSignerRow(active, saved)).toEqual({ detail: 'Saved key 0x111111…111111 differs from the active signer; save or remove it', label: 'Execution signer', ready: false })
	})

	test('is ready when the saved key is the active signer, whatever its letter case', () => {
		expect(executionSignerRow(active, active.toUpperCase().replace('0X', '0x'))).toMatchObject({ label: 'Execution signer', ready: true })
	})

	test('is ready for a session signer with no saved key and not ready without any signer', () => {
		expect(executionSignerRow(active, undefined)).toMatchObject({ ready: true })
		expect(executionSignerRow(undefined, saved)).toEqual({ detail: 'Set one under Execution signer', label: 'Execution signer', ready: false })
	})
})
