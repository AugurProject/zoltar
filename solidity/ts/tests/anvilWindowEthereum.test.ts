import { expect, test } from 'bun:test'
import { getDefaultAnvilRpcUrl } from '../testsuite/simulator/AnvilWindowEthereum'

test('getDefaultAnvilRpcUrl uses localhost on Windows and docker host elsewhere', () => {
	const expected = process.platform === 'win32' ? 'http://127.0.0.1:8545' : 'http://host.docker.internal:8545'

	expect(getDefaultAnvilRpcUrl()).toBe(expected)
})
