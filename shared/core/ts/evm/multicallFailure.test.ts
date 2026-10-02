import { expect, test } from 'bun:test'
import { multicallFailureMessage } from './multicallFailure.js'

const wrapped = (inner: string) => `0x6190b2b0${'20'.padStart(64, '0')}${(inner.length / 2).toString(16).padStart(64, '0')}${inner.padEnd(Math.ceil(inner.length / 64) * 64, '0')}`

test('decodes Uniswap V4 pool initialization errors inside quoter revert bytes', () => {
	expect(multicallFailureMessage(wrapped('486aa307'))).toBe('Multicall contract call failed: UnexpectedRevertBytes(PoolNotInitialized())')
})

test('keeps malformed quoter revert bytes as raw diagnostics', () => {
	expect(multicallFailureMessage('0x6190b2b0')).toBe('Multicall contract call failed: 0x6190b2b0')
})
