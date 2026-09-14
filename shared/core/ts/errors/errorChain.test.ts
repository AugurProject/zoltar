import { describe, expect, test } from 'bun:test'
import { errorChain } from './errorChain.js'

describe('errorChain', () => {
	test('visits wrappers and plain objects once, stopping at a cycle', () => {
		const leaf: { cause: unknown } = { cause: undefined }
		const wrapper = new Error('wrapper', { cause: leaf })
		leaf.cause = wrapper
		expect([...errorChain(wrapper)]).toEqual([wrapper, leaf])
	})
	test('stops at primitive causes and does not inspect beyond an early match', () => {
		expect([...errorChain('failure')]).toEqual([])
		expect([...errorChain({ cause: 'failure' })]).toEqual([{ cause: 'failure' }])
		const wrapper = {
			get cause(): unknown {
				throw new Error('must stay lazy')
			},
		}
		for (const current of errorChain(wrapper)) {
			expect(current).toBe(wrapper)
			break
		}
	})
})
