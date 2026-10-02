/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import type { ComponentChildren } from 'preact'
import { resolveRepPrice, type UiPriceOracle } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { getHeaderRepPerEthPrice } from '../../app/lib/headerRepPrice.js'

const settlementTimestamp = 1_000n
const freshNow = settlementTimestamp + 60n
const expiredNow = settlementTimestamp + 10n * 24n * 60n * 60n

function resolve(setting: UiPriceOracle, { now = freshNow, pool = true }: { now?: bigint; pool?: boolean } = {}) {
	return resolveRepPrice({ now, poolOracle: pool ? { price: 20n * 10n ** 18n, settlementTimestamp } : undefined, setting, uniswapPrice: 30n * 10n ** 18n })
}

async function renderText(children: ComponentChildren) {
	const dom = installDomEnvironment()
	const rendered = await renderIntoDocument(<span>{children}</span>)
	const text = rendered.container.textContent ?? ''
	await rendered.cleanup()
	dom.cleanup()
	return text
}

describe('header REP / ETH price', () => {
	test('explains why the OpenOracle setting has no price outside a pool instead of showing a blank', async () => {
		const header = getHeaderRepPerEthPrice({ currentTimestamp: freshNow, hasSelectedPool: false, repPerEthFailure: 'rpc-error', repPerEthSource: 'v4', repPerEthSourceUrl: 'https://example.com', repPrice: resolve('open-oracle', { pool: false }) })
		expect(header.repPerEthPrice).toBeUndefined()
		expect(header.repPerEthFailure).toBeUndefined()
		expect(await renderText(header.repPerEthUnavailableLabel)).toBe('Open a pool to see its oracle price')
		expect(await renderText(header.repPerEthSourceLabel)).toContain('OpenOracle')
	})

	test('marks an expired OpenOracle price as stale and keeps its source label', async () => {
		const header = getHeaderRepPerEthPrice({ currentTimestamp: expiredNow, hasSelectedPool: true, repPerEthFailure: undefined, repPerEthSource: 'v4', repPerEthSourceUrl: undefined, repPrice: resolve('open-oracle', { now: expiredNow }) })
		expect(header.repPerEthPrice).toBe(20n * 10n ** 18n)
		expect(header.repPerEthUnavailableLabel).toBeUndefined()
		const label = await renderText(header.repPerEthSourceLabel)
		expect(label).toContain('OpenOracle')
		expect(label).toContain('Stale')
	})

	test('keeps a fresh OpenOracle price unmarked and a Uniswap fallback labeled with its Uniswap badge', async () => {
		const fresh = getHeaderRepPerEthPrice({ currentTimestamp: freshNow, hasSelectedPool: true, repPerEthFailure: undefined, repPerEthSource: 'v4', repPerEthSourceUrl: undefined, repPrice: resolve('open-oracle') })
		expect(await renderText(fresh.repPerEthSourceLabel)).not.toContain('Stale')
		const fallback = getHeaderRepPerEthPrice({ currentTimestamp: freshNow, hasSelectedPool: false, repPerEthFailure: undefined, repPerEthSource: 'v4', repPerEthSourceUrl: undefined, repPrice: resolve('open-oracle-fallback', { pool: false }) })
		expect(fallback.repPerEthPrice).toBe(30n * 10n ** 18n)
		expect(fallback.repPerEthSource).toBe('v4')
		expect(fallback.repPerEthUnavailableLabel).toBeUndefined()
		expect(await renderText(fallback.repPerEthSourceLabel)).toBe('(u4)')
	})

	test('names the missing pool OpenOracle report when a pool is open', async () => {
		const header = getHeaderRepPerEthPrice({ currentTimestamp: freshNow, hasSelectedPool: true, repPerEthFailure: undefined, repPerEthSource: 'v4', repPerEthSourceUrl: undefined, repPrice: resolve('open-oracle', { pool: false }) })
		expect(await renderText(header.repPerEthUnavailableLabel)).toBe('No OpenOracle price')
	})
})
