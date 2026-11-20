import { expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'

const getAvailablePort = async (): Promise<number> => {
	const server = createServer()
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('Expected an ephemeral TCP port')
	await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
	return address.port
}

test('Chromium discovery is shell-independent and accepts Windows executable paths', () => {
	const attemptedCommands: string[] = []
	const chromiumPath = getChromiumPath({
		environment: {},
		which: commandName => {
			attemptedCommands.push(commandName)
			return commandName === 'google-chrome' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null
		},
	})

	expect(chromiumPath).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
	expect(attemptedCommands).toEqual(['google-chrome'])
})

test('Chromium discovery returns undefined when no candidate is on PATH', () => {
	expect(getChromiumPath({ environment: {}, platform: 'linux', which: () => null })).toBeUndefined()
})

test('an explicitly configured CHROMIUM_PATH is used even when discovery finds nothing or another browser', () => {
	expect(getChromiumPath({ environment: { CHROMIUM_PATH: '/opt/custom/chromium' }, platform: 'linux', which: () => null })).toBe('/opt/custom/chromium')
	expect(getChromiumPath({ environment: { CHROMIUM_PATH: '/opt/custom/chromium' }, which: name => (name === 'google-chrome' ? '/usr/bin/google-chrome' : null) })).toBe('/opt/custom/chromium')
})

test('a blank CHROMIUM_PATH counts as unset', () => {
	expect(getChromiumPath({ environment: { CHROMIUM_PATH: '' }, which: name => (name === 'chromium' ? '/usr/bin/chromium' : null) })).toBe('/usr/bin/chromium')
	expect(getChromiumPath({ environment: { CHROMIUM_PATH: '  ' }, platform: 'linux', which: () => null })).toBeUndefined()
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

test('Chromium test lock serializes competing owners and releases after failure', async () => {
	const port = await getAvailablePort()
	let releaseFirstOwner: (() => void) | undefined
	const firstOwnerMayFinish = new Promise<void>(resolve => {
		releaseFirstOwner = resolve
	})
	let firstOwnerAcquired = false
	const firstOwner = withChromiumTestLock(
		async () => {
			firstOwnerAcquired = true
			await firstOwnerMayFinish
			throw new Error('expected owner failure')
		},
		{ port },
	)
	while (!firstOwnerAcquired) await Bun.sleep(1)

	let secondOwnerAcquired = false
	const secondOwner = withChromiumTestLock(
		async () => {
			secondOwnerAcquired = true
		},
		{ port },
	)
	await Bun.sleep(2_100)
	expect(secondOwnerAcquired).toBe(false)
	if (releaseFirstOwner === undefined) throw new Error('Expected first Chromium lock owner release callback')
	releaseFirstOwner()
	await expect(firstOwner).rejects.toThrow('expected owner failure')
	await secondOwner
	expect(secondOwnerAcquired).toBe(true)
})

test('Chromium test lock is released when an owning process exits', async () => {
	const port = await getAvailablePort()
	const moduleUrl = new URL('./chromiumPath.ts', import.meta.url).href
	const child = Bun.spawn([process.execPath, '--eval', `import { withChromiumTestLock } from ${JSON.stringify(moduleUrl)}; await withChromiumTestLock(async () => { console.log('lock-acquired'); await new Promise(() => {}) }, { port: ${port.toString()} })`], { stderr: 'pipe', stdout: 'pipe' })
	const reader = child.stdout.getReader()
	const acquiredOutput = await reader.read()
	if (acquiredOutput.done) throw new Error(`Chromium lock owner exited before acquiring the lock: ${await new Response(child.stderr).text()}`)
	expect(new TextDecoder().decode(acquiredOutput.value)).toContain('lock-acquired')

	child.kill()
	await child.exited
	reader.releaseLock()
	let replacementAcquired = false
	await withChromiumTestLock(
		async () => {
			replacementAcquired = true
		},
		{ port },
	)
	expect(replacementAcquired).toBe(true)
})

test('Chromium discovery prefers the native Chrome binary when both Chrome and Chromium are installed', () => {
	expect(getChromiumPath({ environment: {}, which: name => (['chromium', 'google-chrome'].includes(name) ? `/usr/bin/${name}` : null) })).toBe('/usr/bin/google-chrome')
	expect(getChromiumPath({ environment: {}, which: name => (name === 'chromium' ? '/usr/bin/chromium' : null) })).toBe('/usr/bin/chromium')
})
