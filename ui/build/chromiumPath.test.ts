import { expect, test } from 'bun:test'
import { getChromiumPath } from './chromiumPath.js'

test('Chromium discovery is shell-independent and accepts Windows executable paths', () => {
	const attemptedCommands: string[] = []
	const chromiumPath = getChromiumPath({
		which: commandName => {
			attemptedCommands.push(commandName)
			return commandName === 'google-chrome' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null
		},
	})

	expect(chromiumPath).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
	expect(attemptedCommands).toEqual(['chromium', 'chromium-browser', 'google-chrome'])
})

test('Chromium discovery returns undefined when no candidate is on PATH', () => {
	expect(getChromiumPath({ which: () => null })).toBeUndefined()
})

test('Chromium discovery finds standard Windows browser installations outside PATH', () => {
	const expectedPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
	expect(
		getChromiumPath({
			environment: { PROGRAMFILES: 'C:\\Program Files' },
			fileExists: path => path === expectedPath,
			platform: 'win32',
			which: () => null,
		}),
	).toBe(expectedPath)
})
