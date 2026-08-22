/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { installLiveReload } from '../../app/liveReload.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'

test('live reload connects through non-local development hostnames', () => {
	const environment = installDomEnvironment('http://devbox.example/')
	let reloadListener: (() => void) | undefined
	let reloadCount = 0
	try {
		installLiveReload({
			createEventSource: url => {
				expect(url).toBe('/__live-reload')
				return {
					addEventListener: (_eventName, listener) => {
						reloadListener = listener
					},
				}
			},
			reload: () => {
				reloadCount++
			},
		})
		expect(window.location.hostname).toBe('devbox.example')
		if (reloadListener === undefined) throw new Error('Live reload listener was not installed')
		reloadListener()
		expect(reloadCount).toBe(1)
	} finally {
		environment.cleanup()
	}
})
