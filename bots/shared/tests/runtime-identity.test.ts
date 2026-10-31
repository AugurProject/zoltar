import { expect, test } from 'bun:test'
import { keccak256 } from '../src/ethereum.ts'
import { verifyRuntimeIdentity } from '../src/monitoring/runtime-identity.ts'

test('runtime identity permits only consistent immutable substitutions', () => {
	const identity = {
		runtimeCodeHash: keccak256('0x60006000'),
		runtimeCodeLength: 4,
		immutableReferences: {
			immutable: [
				{ start: 1, length: 1 },
				{ start: 3, length: 1 },
			],
		},
	}
	expect(() => verifyRuntimeIdentity('0x60aa60aa', identity, 'test')).not.toThrow()
	expect(() => verifyRuntimeIdentity('0x60aa60bb', identity, 'test')).toThrow('Inconsistent')
	expect(() => verifyRuntimeIdentity('0x61aa60aa', identity, 'test')).toThrow('Unrecognized')
	expect(() => verifyRuntimeIdentity('0x6000', identity, 'test')).toThrow('Unrecognized')
	expect(() => verifyRuntimeIdentity(undefined, identity, 'test')).toThrow('Unrecognized')
})
