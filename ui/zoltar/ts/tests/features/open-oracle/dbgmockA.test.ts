import { describe, test } from 'bun:test'

const real = await import('../../../protocol/uniswapQuoter.js')
const delegate: { current: Record<string, unknown> } = { current: real as unknown as Record<string, unknown> }
const { mock } = await import('bun:test')
mock.module('../../../protocol/uniswapQuoter.js', () => new Proxy({}, { get: (_, key) => (delegate.current as Record<string | symbol, unknown>)[key as string] }))

describe('file a', () => {
	test('mock module', () => {
		delegate.current = { isRepPricingEnabled: () => 'mocked' } as never
	})
})
