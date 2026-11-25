import { afterEach, expect, test } from 'bun:test'
import { Browser } from 'happy-dom'

const bundle = await Bun.build({
	entrypoints: ['dialog-test-entry'],
	target: 'browser',
	format: 'iife',
	plugins: [
		{
			name: 'dialog-test-entry',
			setup(build) {
				build.onResolve({ filter: /^dialog-test-entry$/ }, () => ({ path: 'entry', namespace: 'dialog-test' }))
				build.onLoad({ filter: /.*/, namespace: 'dialog-test' }, () => ({
					contents: `import { createOperationDialog } from ${JSON.stringify(new URL('../../src/dashboard/operation-dialog.ts', import.meta.url).pathname)}; globalThis.dialogController = createOperationDialog({ request: globalThis.requestOperation })`,
					loader: 'js',
				}))
			},
		},
	],
})
if (!bundle.success || bundle.outputs[0] === undefined) throw new Error('Operation dialog bundle failed')
const script = await bundle.outputs[0].text()
const browsers: Browser[] = []
afterEach(async () => {
	for (const browser of browsers.splice(0)) await browser.close()
})

function barrier<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error('Barrier not initialized')
	}
	const promise = new Promise<T>(release => {
		resolve = release
	})
	return { promise, resolve }
}

async function fixture() {
	const browser = new Browser()
	browsers.push(browser)
	const page = browser.newPage()
	const window = page.mainFrame.window
	Reflect.set(window, 'Option', function (text: string, value: string) {
		const option = window.document.createElement('option')
		option.textContent = text
		option.value = value
		return option
	})
	let now = 10000
	window.Date.now = () => now
	const nativeTimeout = window.setTimeout.bind(window)
	const nativeClear = window.clearTimeout.bind(window)
	const timers = new Map<ReturnType<typeof nativeTimeout>, { at: number; run: () => void }>()
	window.setTimeout = (handler, delay = 0, ...args) => {
		if (typeof handler !== 'function') throw new Error('Expected timer callback')
		const handle = nativeTimeout(() => undefined, 0)
		nativeClear(handle)
		timers.set(handle, { at: now + delay, run: () => handler(...args) })
		return handle
	}
	window.clearTimeout = handle => {
		if (handle !== undefined) timers.delete(handle)
		nativeClear(handle)
	}
	// Drain browser-realm promises through an event-loop barrier, without elapsed-time waits.
	const flush = () => new Promise<void>(resolve => setImmediate(resolve))
	async function advance(milliseconds: number) {
		const end = now + milliseconds
		while (true) {
			const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
			if (next === undefined) break
			now = next[1].at
			timers.delete(next[0])
			next[1].run()
			await flush()
		}
		now = end
		await flush()
	}
	const requests: string[] = []
	let response: (action: string) => Promise<unknown> = async () => ({ fields: [{ key: 'amount', label: 'Amount', value: '1', kind: 'integer' }], mode: 'live', steps: [] })
	Reflect.set(window, 'requestOperation', (_value: unknown, action: string) => {
		requests.push(action)
		return response(action)
	})
	page.evaluate(script)
	const evaluate = (code: string) => page.evaluate(code)
	const open = async (id = 'wrap') => {
		evaluate(`dialogController.open({ id: ${JSON.stringify(id)}, label: 'Wrap', blockers: [] })`)
		await flush()
	}
	const preview = async (id = 'preview-1', lifetime = 1000) => {
		response = async () => ({ fields: [{ key: 'amount', label: 'Amount', value: '1', kind: 'integer' }], mode: 'live', previewId: id, expiresAt: now + lifetime, steps: [] })
		evaluate("document.querySelector('form').requestSubmit()")
		await flush()
	}
	const execute = () => evaluate("document.querySelector('.operation-actions button:nth-child(2)').click()")
	const confirm = async () => {
		evaluate("document.querySelector('#operator-confirm-submit').click()")
		await flush()
	}
	const status = () => window.document.querySelector('#operation-dialog [role=status]')?.textContent
	const disabled = () => evaluate("document.querySelector('.operation-actions button:nth-child(2)').disabled")
	return {
		advance,
		confirm,
		disabled,
		evaluate,
		execute,
		flush,
		open,
		preview,
		requests,
		status,
		respond: (next: typeof response) => {
			response = next
		},
	}
}

test.each([999, 1000, 1001])('confirmation cannot send an expired preview at %i ms', async elapsed => {
	const f = await fixture()
	await f.open()
	await f.preview()
	f.execute()
	await f.flush()
	await f.advance(elapsed)
	await f.confirm()
	expect(f.requests.filter(action => action === 'execute')).toHaveLength(elapsed < 1000 ? 1 : 0)
	if (elapsed >= 1000) {
		expect(f.disabled()).toBe(true)
		expect(f.status()).toContain('Preview expired')
	}
})

test('old expiry and late inspect responses cannot replace a newer operation', async () => {
	const f = await fixture()
	await f.open()
	await f.preview('old', 1000)
	await f.open('new')
	await f.preview('new', 2000)
	await f.advance(1000)
	expect(f.disabled()).toBe(false)
	const stale = barrier<unknown>()
	f.respond(() => stale.promise)
	await f.open('stale')
	f.respond(async () => ({ fields: [], blockers: ['Current operation'], mode: 'live' }))
	await f.open('current')
	stale.resolve({ previewId: 'late', fields: [], blockers: ['Stale operation'], mode: 'live' })
	await f.flush()
	expect(f.status()).toBe('Current operation')
	expect(f.disabled()).toBe(true)
})

test('pending polling and failure recovery ignore late closed-dialog responses', async () => {
	const f = await fixture()
	await f.open()
	await f.preview()
	let polls = 0
	const late = barrier<unknown>()
	f.respond(async action => {
		if (action !== 'status') return {}
		polls++
		if (polls === 2) throw new Error('Temporary status failure')
		if (polls === 3) return late.promise
		return { execution: { status: 'pending', message: 'Submitted', transactions: [] } }
	})
	f.execute()
	await f.confirm()
	expect(polls).toBe(1)
	await f.advance(1499)
	expect(polls).toBe(1)
	await f.advance(1)
	expect(polls).toBe(2)
	expect(f.status()).toContain('Retrying')
	await f.advance(2999)
	expect(polls).toBe(2)
	await f.advance(1)
	expect(polls).toBe(3)
	f.evaluate("document.querySelector('#operation-dialog').close()")
	await f.flush()
	f.respond(async () => ({ fields: [], blockers: ['New selection'], mode: 'live' }))
	await f.open('other')
	late.resolve({ execution: { status: 'completed', message: 'Late completion' } })
	await f.flush()
	await f.advance(3000)
	expect(polls).toBe(3)
	expect(f.status()).toBe('New selection')
})

test('a pending execution prevents another send and completion enables a fresh preview', async () => {
	const f = await fixture()
	await f.open()
	await f.preview()
	let completed = false
	let polls = 0
	f.respond(async action => {
		if (action !== 'status') return {}
		polls++
		return { execution: { status: completed ? 'completed' : 'pending', message: completed ? 'Confirmed' : 'Submitted', outcome: completed ? 'success' : 'submitted', transactions: [] } }
	})
	f.execute()
	await f.confirm()
	f.execute()
	await f.flush()
	expect(f.requests.filter(action => action === 'execute')).toHaveLength(1)
	expect(f.disabled()).toBe(true)
	completed = true
	await f.advance(1500)
	expect(f.status()).toBe('Confirmed')
	await f.advance(3000)
	expect(polls).toBe(2)
	await f.preview('next')
	expect(f.disabled()).toBe(false)
	f.execute()
	await f.confirm()
	expect(f.requests.filter(action => action === 'execute')).toHaveLength(2)
})
