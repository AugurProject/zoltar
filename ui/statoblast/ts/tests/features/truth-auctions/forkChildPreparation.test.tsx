import { expect, mock, test } from 'bun:test'
import { zeroAddress, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { ForkChildPreparation } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/ForkChildPreparation.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'

type ForkOutcomeMigrationSeedStatus = NonNullable<Parameters<typeof ForkChildPreparation>[0]['status']>

const lifecycle = installDomTestLifecycle()
const deployed = getAddress('0x0000000000000000000000000000000000000001')
const status: ForkOutcomeMigrationSeedStatus = {
	sharedFeed: zeroAddress,
	childPool: zeroAddress,
	dependenciesPrepared: false,
	historyOutcomesInitialized: 0,
	historyReady: false,
	childPoolRepBalanceAttoRep: 0n,
	childRepToken: undefined,
	childUniverseId: 1n,
	migrationProxyAddress: deployed,
	pendingProxyRepBalanceAttoRep: 0n,
	seeded: false,
}
async function renderPreparation(current: ForkOutcomeMigrationSeedStatus | undefined, readGuard?: string, closedGuard?: string) {
	const feed = mock(() => undefined)
	const contracts = mock(() => undefined)
	const create = mock(() => undefined)
	const initialize = mock(() => undefined)
	lifecycle.trackRendered(
		await renderIntoDocument(
			<ForkChildPreparation
				status={current}
				readGuard={readGuard}
				closedGuard={closedGuard}
				onPrepareFeed={feed}
				onPrepareContracts={contracts}
				onCreate={create}
				onInitialize={initialize}
				renderAction={action => (
					<button disabled={action.availability?.disabled} onClick={action.onClick}>
						{action.idleLabel}
					</button>
				)}
			/>,
		),
	)
	return { feed, contracts, create, initialize, buttons: within(document.body).getAllByRole('button') }
}

test('shows all applicable preparation controls before starting, with only the first transaction enabled', async () => {
	const { buttons, feed, contracts, create } = await renderPreparation(status)
	expect(buttons.map(button => [button.textContent, button.hasAttribute('disabled')])).toEqual([
		['Prepare child price feed', false],
		['Prepare child pool contracts', true],
		['Create child pool', true],
		['Initialize dispute history', true],
	])
	const first = buttons[0]
	if (first === undefined) throw new Error('Missing first preparation')
	fireEvent.click(first)
	expect(feed).toHaveBeenCalledTimes(1)
	expect(contracts).not.toHaveBeenCalled()
	expect(create).not.toHaveBeenCalled()
})

test('keeps completed shared-feed controls in place and enables the next separately selected transaction', async () => {
	const { buttons } = await renderPreparation({ ...status, sharedFeed: deployed })
	expect(buttons.map(button => button.hasAttribute('disabled'))).toEqual([true, false, true, true])
})

test('keeps all controls disabled while requirements load or a read fails', async () => {
	const { buttons } = await renderPreparation(undefined, 'Checking child pool preparation…')
	expect(buttons).toHaveLength(4)
	expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true)
})

test('ordinary pools omit the inapplicable shared-feed transaction and preserve completed steps', async () => {
	const { buttons } = await renderPreparation({ ...status, sharedFeed: undefined, dependenciesPrepared: true, childPool: deployed, historyOutcomesInitialized: 3, historyReady: true })
	expect(buttons.map(button => [button.textContent, button.hasAttribute('disabled')])).toEqual([
		['Prepare child pool contracts', true],
		['Create child pool', true],
		['Initialize dispute history', true],
	])
})

for (const closedGuard of [undefined, 'Migration deadline passed'])
	test(`initializes only one outcome per click after child registration (${closedGuard})`, async () => {
		const { buttons, initialize, create } = await renderPreparation({ ...status, sharedFeed: deployed, dependenciesPrepared: true, childPool: deployed, historyOutcomesInitialized: 1, historyReady: false }, undefined, closedGuard)
		expect(buttons.map(button => button.hasAttribute('disabled'))).toEqual([true, true, true, false])
		expect(document.body.textContent).toContain('1 of 3 outcomes initialized')
		const action = buttons[3]
		if (action === undefined) throw new Error('Missing initialization action')
		fireEvent.click(action)
		expect(initialize).toHaveBeenCalledTimes(1)
		expect(create).not.toHaveBeenCalled()
	})
