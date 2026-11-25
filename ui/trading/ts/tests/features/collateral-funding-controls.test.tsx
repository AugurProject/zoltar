import { describe, expect, test } from 'bun:test'
import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { CollateralFundingControls } from '../../features/CollateralFundingControls.js'
import type { useCollateralFunding } from '../../features/live/useCollateralFunding.js'

function fundingFor(token: Address, symbol: string, overrides: Partial<ReturnType<typeof useCollateralFunding>> = {}): ReturnType<typeof useCollateralFunding> {
	return {
		balanceState: 'ready',
		asset: { token, symbol, decimals: 6, native: false },
		applicable: true,
		balance: 10_000_000n,
		allowance: 1_000_000n,
		loading: false,
		reason: undefined,
		error: undefined,
		readError: undefined,
		receiptWarning: undefined,
		transactionHash: undefined,
		retry: () => undefined,
		pending: false,
		approve: async () => undefined,
		...overrides,
	}
}

describe('collateral funding controls', () => {
	const lifecycle = installDomTestLifecycle({ beforeTest: () => void installActiveEnvironmentForTesting(createFakeBackend()), afterTest: resetActiveEnvironmentForTesting })
	const token = getAddress('0x4000000000000000000000000000000000000000')

	test('offers one approval button and no reset for a token that already has an allowance', async () => {
		const rendered = await renderIntoDocument(<CollateralFundingControls actionLabel='buying' funding={fundingFor(token, 'USDC')} required={5_000_000n} disabled={false} reason={undefined} />)
		lifecycle.trackRendered(rendered)
		expect(Array.from(rendered.container.querySelectorAll('button')).map(button => button.textContent?.replaceAll('\u00a0', ' ').trim())).toEqual(['Approve 5 USDC'])
	})

	test('shows the approval button as pending while the approval is in flight', async () => {
		const rendered = await renderIntoDocument(<CollateralFundingControls actionLabel='buying' funding={fundingFor(token, 'USDC', { pending: true })} required={5_000_000n} disabled={false} reason={undefined} />)
		lifecycle.trackRendered(rendered)
		const busy = Array.from(rendered.container.querySelectorAll('button[aria-busy="true"]')).map(button => button.textContent?.trim())
		expect(busy).toEqual(['Approving USDC…'])
	})
})
