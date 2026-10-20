import { expect, test } from 'bun:test'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { SecurityPoolIdentityFields } from '../../features/LiveMarketIdentity.js'

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
	},
})
test('renders large question identifiers as lossless hexadecimal strings', async () => {
	const questionId = (1n << 255n) + 26n
	cleanup = (await renderIntoDocument(<SecurityPoolIdentityFields market={{ pool: zeroAddress, shareToken: zeroAddress, universeId: 1n, originUniverseId: 1n, questionId }} />)).cleanup
	expect(document.body.textContent).toContain(`0x${questionId.toString(16)}`)
	expect(document.body.textContent).not.toContain(questionId.toString())
})

test('makes every displayed pool and share token address independently copyable and linked to Etherscan', async () => {
	const pool: Address = `0x${'12'.repeat(20)}`
	const shareToken: Address = `0x${'34'.repeat(20)}`
	const rendered = await renderIntoDocument(<SecurityPoolIdentityFields market={{ pool, shareToken, universeId: 1n, originUniverseId: 1n, questionId: 1n }} />)
	cleanup = rendered.cleanup
	for (const address of [pool, shareToken]) {
		expect(rendered.container.querySelector(`a[href="https://sepolia.etherscan.io/address/${address}"]`)).not.toBeNull()
		expect(rendered.container.querySelector(`[role="button"][aria-label="Copy address ${address}"]`)).not.toBeNull()
	}
	expect(rendered.container.querySelector('a button, a [role=button], button a, button button, button [role=button], a a, [role=button] a')).toBeNull()
})
