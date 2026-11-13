import { describe, expect, test } from 'bun:test'
import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getActiveNetworkProfile, installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { CollateralFundingControls } from '../../features/CollateralFundingControls.js'
import type { useCollateralFunding } from '../../features/live/useCollateralFunding.js'

function fundingFor(token: Address, symbol: string): ReturnType<typeof useCollateralFunding> {
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
		retry: () => undefined,
		pending: false,
		resetting: false,
		approve: async () => undefined,
	}
}

describe('collateral funding controls', () => {
	// The fake backend runs on the mainnet profile, which configures a USDT address.
	const lifecycle = installDomTestLifecycle({ beforeTest: () => void installActiveEnvironmentForTesting(createFakeBackend()), afterTest: resetActiveEnvironmentForTesting })

	async function renderedButtonLabels(token: Address, symbol: string) {
		const rendered = await renderIntoDocument(<CollateralFundingControls actionLabel='buying' funding={fundingFor(token, symbol)} required={5_000_000n} disabled={false} reason={undefined} />)
		lifecycle.trackRendered(rendered)
		return Array.from(rendered.container.querySelectorAll('button')).map(button => button.textContent?.trim())
	}

	// The approval operation rejects a nonzero-to-nonzero change for this address, so the reset has to be offered for it.
	test('offers the allowance reset for the network USDT token whatever symbol the token reports', async () => {
		const usdt = getActiveNetworkProfile().usdtAddress
		if (usdt === undefined) throw new Error('Expected a configured USDT address')
		expect(await renderedButtonLabels(usdt, 'USD₮')).toContain('Reset USD₮ approval')
	})

	test('does not offer an allowance reset for another token that reports the USDT symbol', async () => {
		expect(await renderedButtonLabels(getAddress('0x4000000000000000000000000000000000000000'), 'USDT')).not.toContain('Reset USDT approval')
	})
})
