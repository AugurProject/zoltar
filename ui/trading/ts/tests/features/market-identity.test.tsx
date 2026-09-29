import { expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
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
