import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { StatoblastReadFailure } from '../../app/components/StatoblastReadFailure.js'

const lifecycle = installDomTestLifecycle()
const noAction = () => undefined

test('an unreachable network without saved data offers retry and RPC settings', async () => {
	let retries = 0
	let settingsOpens = 0
	const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReadFailure reason='RPC did not answer.' readAt={undefined} onRetry={() => retries++} onOpenSettings={() => settingsOpens++} />))
	const notice = view.container.querySelector('[role="status"]')
	expect(notice?.textContent).toContain("Can't reach the network")
	expect(notice?.getAttribute('data-message-tone')).toBe('error')
	const [retry, settings] = view.container.querySelectorAll('button')
	expect(retry?.textContent).toBe('Try again')
	expect(settings?.textContent).toBe('Change RPC in Settings')
	await act(() => {
		retry?.click()
		settings?.click()
	})
	expect(retries).toBe(1)
	expect(settingsOpens).toBe(1)
})

test('an unreachable network with saved data reports the data age as a warning', async () => {
	const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReadFailure reason='RPC did not answer.' readAt={Date.now() - 7000} onRetry={noAction} onOpenSettings={noAction} />))
	const notice = view.container.querySelector('[role="status"]')
	expect(notice?.getAttribute('data-message-tone')).toBe('warning')
	expect(notice?.textContent).toMatch(/Couldn’t refresh, showing data from \d+s ago\./)
	expect(notice?.textContent).not.toContain("Can't reach the network")
})
