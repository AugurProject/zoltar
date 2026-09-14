/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { CopyErrorMessage } from '../components/CopyErrorMessage.js'
import { within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('CopyErrorMessage', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('keeps manual recovery behind a compact disclosure while announcing the failure', async () => {
		const message = 'Copy failed — select the value and copy it manually.'
		const renderedComponent = await renderIntoDocument(<CopyErrorMessage id='copy-error' manualValue='0x1234' message={message} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Copy unavailable')).not.toBeNull()
		expect(documentQueries.getByRole('alert').textContent).toBe(message)
		expect((documentQueries.getByLabelText('Exact value for manual copy') as HTMLInputElement).value).toBe('0x1234')
		expect(document.body.querySelector('.copy-error-recovery')?.tagName).toBe('DETAILS')
	})
})
