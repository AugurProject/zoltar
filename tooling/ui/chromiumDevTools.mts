import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createDevToolsCommandSender, type DevToolsCommand, type DevToolsSocket } from './devToolsCommands.mts'

const DEVTOOLS_COMMAND_TIMEOUT_MILLISECONDS = 15_000
const DEVTOOLS_INITIALIZATION_TIMEOUT_MILLISECONDS = 60_000
const BROWSER_TERMINATION_TIMEOUT_MILLISECONDS = 2_000

export type ChromiumViewport = { readonly height: number; readonly width: number }
type DevToolsTarget = { readonly type: string; readonly webSocketDebuggerUrl: string }

function chromiumDevToolsPortFromStderr(stderr: string): number | undefined {
	const match = /DevTools listening on ws:\/\/(?:\[[^\]]+\]|[^:/\s]+):(\d+)\//.exec(stderr)
	if (match?.[1] === undefined) return undefined
	const port = Number.parseInt(match[1], 10)
	return Number.isInteger(port) && port > 0 ? port : undefined
}

export async function waitForChromiumDevToolsPort({
	assertBrowserAvailable,
	maxAttempts,
	pollMilliseconds,
	readPort,
	readStderr = () => '',
	wait = Bun.sleep,
}: {
	readonly assertBrowserAvailable: () => void
	readonly maxAttempts?: number
	readonly pollMilliseconds: number
	readonly readPort: () => Promise<number | undefined>
	readonly readStderr?: () => string
	readonly wait?: (milliseconds: number) => Promise<unknown>
}): Promise<number | undefined> {
	for (let attempt = 0; maxAttempts === undefined || attempt < maxAttempts; attempt++) {
		assertBrowserAvailable()
		const stderrPort = chromiumDevToolsPortFromStderr(readStderr())
		if (stderrPort !== undefined) return stderrPort
		const filePort = await readPort()
		if (filePort !== undefined) return filePort
		await wait(pollMilliseconds)
	}
	return undefined
}

export async function waitForBrowserExit(browser: ChildProcess): Promise<void> {
	if (browser.exitCode !== null || browser.signalCode !== null) return
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.once('exit', () => resolve())
	})
}

type BrowserExitOutcome = { readonly exited: boolean; readonly processError?: Error }

const waitForBrowserExitWithin = async (browser: ChildProcess, timeoutMilliseconds: number): Promise<BrowserExitOutcome> => {
	if (browser.exitCode !== null || browser.signalCode !== null || browser.pid === undefined) return { exited: true }
	return await new Promise(resolve => {
		let processError: Error | undefined
		const finish = (exited: boolean) => {
			clearTimeout(timeoutId)
			browser.off('error', handleProcessError)
			browser.off('exit', handleTermination)
			resolve({ exited, ...(processError === undefined ? {} : { processError }) })
		}
		const handleTermination = () => finish(true)
		const handleProcessError = (error: Error) => {
			processError = error
		}
		const timeoutId = setTimeout(() => finish(false), timeoutMilliseconds)
		browser.on('error', handleProcessError)
		browser.once('exit', handleTermination)
	})
}

const signalBrowserAndWait = async (browser: ChildProcess, signal: NodeJS.Signals, timeoutMilliseconds: number): Promise<BrowserExitOutcome> => {
	const exitOutcome = waitForBrowserExitWithin(browser, timeoutMilliseconds)
	browser.kill(signal)
	return await exitOutcome
}

export async function terminateBrowserProcess(
	browser: ChildProcess,
	profilePath: string,
	{ forceTimeoutMilliseconds = BROWSER_TERMINATION_TIMEOUT_MILLISECONDS, gracefulTimeoutMilliseconds = BROWSER_TERMINATION_TIMEOUT_MILLISECONDS }: { readonly forceTimeoutMilliseconds?: number; readonly gracefulTimeoutMilliseconds?: number } = {},
): Promise<void> {
	try {
		if (browser.exitCode !== null || browser.signalCode !== null || browser.pid === undefined) return
		const gracefulOutcome = await signalBrowserAndWait(browser, 'SIGTERM', gracefulTimeoutMilliseconds)
		if (gracefulOutcome.exited) return
		const forceOutcome = await signalBrowserAndWait(browser, 'SIGKILL', forceTimeoutMilliseconds)
		if (!forceOutcome.exited) {
			const processError = forceOutcome.processError ?? gracefulOutcome.processError
			throw new Error(`Chromium did not exit after SIGKILL within ${forceTimeoutMilliseconds.toString()}ms${processError === undefined ? '' : `: ${processError.message}`}`)
		}
	} finally {
		await fs.rm(profilePath, { force: true, recursive: true })
	}
}

const transientDevToolsConnectionErrorCodes = new Set(['ConnectionRefused', 'ConnectionReset', 'ECONNREFUSED', 'ECONNRESET'])

const isTransientDevToolsConnectionError = (error: unknown): boolean => {
	const visited = new Set<unknown>()
	let current = error
	while (typeof current === 'object' && current !== null && !visited.has(current)) {
		visited.add(current)
		if ('code' in current && typeof current.code === 'string' && transientDevToolsConnectionErrorCodes.has(current.code)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

const awaitInitializationStep = async <TValue,>(browser: ChildProcess, deadline: number, description: string, action: () => Promise<TValue>, cancel: () => void): Promise<TValue> => {
	const remainingMilliseconds = deadline - Date.now()
	if (remainingMilliseconds <= 0) {
		cancel()
		throw new Error(`Chromium initialization timed out while ${description}`)
	}
	let completed = false
	let succeeded = false
	try {
		const value = await new Promise<TValue>((resolve, reject) => {
			const finish = (result: { readonly error: Error } | { readonly value: TValue }) => {
				if (completed) return
				completed = true
				clearTimeout(timeoutId)
				browser.off('error', handleError)
				browser.off('exit', handleExit)
				if ('error' in result) reject(result.error)
				else resolve(result.value)
			}
			const handleError = (error: Error) => finish({ error: new Error(`Chromium failed while ${description}: ${error.message}`) })
			const handleExit = (exitCode: number | null, signalCode: NodeJS.Signals | null) => finish({ error: new Error(`Chromium exited with ${signalCode === null ? `code ${String(exitCode)}` : `signal ${signalCode}`} while ${description}`) })
			const timeoutId = setTimeout(() => finish({ error: new Error(`Chromium initialization timed out while ${description}`) }), remainingMilliseconds)
			browser.once('error', handleError)
			browser.once('exit', handleExit)
			action().then(
				value => finish({ value }),
				error => finish({ error: error instanceof Error ? error : new Error(String(error)) }),
			)
		})
		succeeded = true
		return value
	} finally {
		if (!succeeded) cancel()
	}
}

export function createChromiumCommandSender(socket: DevToolsSocket, browser: ChildProcess, timeoutMilliseconds = DEVTOOLS_COMMAND_TIMEOUT_MILLISECONDS): DevToolsCommand {
	return createDevToolsCommandSender(
		socket,
		{
			isExited: () => browser.exitCode !== null || browser.signalCode !== null,
			onExit: listener => {
				browser.once('exit', (code, signal) => listener(signal === null ? `code ${String(code)}` : `signal ${signal}`))
			},
		},
		timeoutMilliseconds,
	)
}

type EvaluateOptions = {
	/** Resolve a returned promise before reading the value. Defaults to true. */
	readonly awaitPromise?: boolean
	/** `throw` rejects page exceptions; `ignore` returns whatever value Chromium reported. Defaults to `throw`. */
	readonly exceptions?: 'ignore' | 'throw'
}

export type WaitForOptions = EvaluateOptions & {
	readonly attempts?: number
	readonly intervalMilliseconds?: number
	/** Timeout message; defaults to `Timed out: <expression>`. */
	readonly message?: string
	/** Keep polling after a failed evaluation and append the last failure to the timeout message. */
	readonly retryFailures?: boolean
}

const describeEvaluationException = (details: unknown) => {
	if (typeof details === 'object' && details !== null) {
		const exception = 'exception' in details ? details.exception : undefined
		if (typeof exception === 'object' && exception !== null && 'description' in exception && typeof exception.description === 'string') return exception.description
		if ('text' in details && typeof details.text === 'string' && details.text !== 'Uncaught') return details.text
	}
	return JSON.stringify(details)
}

/** Creates `evaluate` and `waitFor` helpers; per-call options override `defaults`. */
function createPageEvaluator(send: DevToolsCommand, defaults: WaitForOptions = {}) {
	const evaluate = async (expression: string, options: EvaluateOptions = {}): Promise<unknown> => {
		const { awaitPromise = true, exceptions = 'throw' } = { ...defaults, ...options }
		const response = await send('Runtime.evaluate', { awaitPromise, expression, returnByValue: true })
		if (typeof response !== 'object' || response === null) throw new Error('Chromium returned no evaluation response')
		if (exceptions === 'throw' && 'exceptionDetails' in response && response.exceptionDetails !== undefined) throw new Error(describeEvaluationException(response.exceptionDetails))
		if (!('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
		return response.result.value
	}
	const waitFor = async (expression: string, options: WaitForOptions = {}): Promise<void> => {
		const { attempts = 100, awaitPromise, exceptions, intervalMilliseconds = 100, message, retryFailures = false } = { ...defaults, ...options }
		let lastFailure: unknown
		for (let attempt = 0; attempt < attempts; attempt++) {
			try {
				if (await evaluate(expression, { ...(awaitPromise === undefined ? {} : { awaitPromise }), ...(exceptions === undefined ? {} : { exceptions }) })) return
				lastFailure = undefined
			} catch (error) {
				if (!retryFailures) throw error
				lastFailure = error
			}
			await Bun.sleep(intervalMilliseconds)
		}
		const failureDetail = lastFailure === undefined ? '' : ` (last error: ${lastFailure instanceof Error ? lastFailure.message : String(lastFailure)})`
		throw new Error(`${message ?? `Timed out: ${expression}`}${failureDetail}`)
	}
	return { evaluate, waitFor }
}

const parseDevToolsTargets = (body: unknown): DevToolsTarget[] => {
	const entries = Array.isArray(body) ? body : [body]
	return entries.flatMap(entry => {
		if (typeof entry !== 'object' || entry === null || !('webSocketDebuggerUrl' in entry) || typeof entry.webSocketDebuggerUrl !== 'string') return []
		// `/json/version` describes the browser endpoint without a target type.
		const type = 'type' in entry && typeof entry.type === 'string' ? entry.type : 'browser'
		return [{ type, webSocketDebuggerUrl: entry.webSocketDebuggerUrl }]
	})
}

const readDevToolsPortFile = async (profilePath: string) => {
	try {
		return Number((await fs.readFile(path.join(profilePath, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
		return undefined
	}
}

export type ChromiumLaunchOptions = {
	readonly path: string
	readonly viewport: ChromiumViewport
	/** Flags appended after the shared headless, sandbox, profile, and window-size flags. */
	readonly extraArgs?: readonly string[]
	/** Connect to the initial page target (default) or to the browser endpoint. */
	readonly target?: 'browser' | 'page'
	readonly commandTimeoutMilliseconds?: number
	readonly devToolsPortAttempts?: number
	/** Default options for the returned `evaluate` and `waitFor` helpers. */
	readonly evaluationDefaults?: WaitForOptions
	readonly initializationTimeoutMilliseconds?: number
	readonly pollMilliseconds?: number
	readonly profileParentPath?: string
	readonly profilePrefix?: string
	readonly targetAttempts?: number
	readonly targetListRequest?: (url: string, signal: AbortSignal) => Promise<readonly DevToolsTarget[]>
}

type ChromiumPage = ReturnType<typeof createPageEvaluator> & {
	readonly browser: ChildProcess
	readonly close: () => Promise<void>
	readonly send: DevToolsCommand
	readonly socket: WebSocket
}

/** Launches headless Chromium with a temporary profile and connects a DevTools WebSocket to its first page (or the browser endpoint). */
export async function launchChromium({
	path: chromiumPath,
	viewport,
	extraArgs = [],
	target = 'page',
	commandTimeoutMilliseconds = DEVTOOLS_COMMAND_TIMEOUT_MILLISECONDS,
	devToolsPortAttempts,
	evaluationDefaults = {},
	initializationTimeoutMilliseconds = DEVTOOLS_INITIALIZATION_TIMEOUT_MILLISECONDS,
	pollMilliseconds = 50,
	profileParentPath = os.tmpdir(),
	profilePrefix = 'zoltar-chromium-',
	targetAttempts,
	targetListRequest = async (url, signal) => parseDevToolsTargets(await (await fetch(url, { signal })).json()),
}: ChromiumLaunchOptions): Promise<ChromiumPage> {
	const profilePath = await fs.mkdtemp(path.join(profileParentPath, profilePrefix))
	let browser: ChildProcess | undefined
	let socket: WebSocket | undefined
	let cleanedUp = false
	const close = async () => {
		if (cleanedUp) return
		cleanedUp = true
		socket?.close()
		if (browser === undefined) await fs.rm(profilePath, { force: true, recursive: true })
		else await terminateBrowserProcess(browser, profilePath)
	}
	let stderrData = ''
	try {
		browser = spawn(chromiumPath, ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profilePath}`, `--window-size=${viewport.width.toString()},${viewport.height.toString()}`, ...extraArgs, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
		const launchedBrowser = browser
		let launchError: Error | undefined
		launchedBrowser.once('error', error => {
			launchError = error
		})
		launchedBrowser.stderr?.on('data', chunk => {
			stderrData += String(chunk)
		})
		const initializationDeadline = Date.now() + initializationTimeoutMilliseconds
		const assertBrowserAvailable = (initializationPhase: string) => {
			if (launchError !== undefined) throw new Error(`Could not launch Chromium: ${launchError.message}`)
			if (launchedBrowser.exitCode !== null || launchedBrowser.signalCode !== null) throw new Error(`Chromium exited before DevTools initialized. stderr: ${stderrData.trim()}`)
			if (Date.now() >= initializationDeadline) throw new Error(`Chromium initialization timed out while ${initializationPhase}`)
		}
		const devToolsPort = await waitForChromiumDevToolsPort({
			assertBrowserAvailable: () => assertBrowserAvailable('waiting for the DevTools port'),
			...(devToolsPortAttempts === undefined ? {} : { maxAttempts: devToolsPortAttempts }),
			pollMilliseconds,
			readStderr: () => stderrData,
			readPort: async () => await readDevToolsPortFile(profilePath),
		})
		assertBrowserAvailable('waiting for the DevTools port')
		if (devToolsPort === undefined) throw new Error(`Chromium DevTools port did not open. stderr: ${stderrData.trim()}`)

		const targetListUrl = `http://127.0.0.1:${devToolsPort.toString()}/json/${target === 'browser' ? 'version' : 'list'}`
		const connectedSocket = await (async () => {
			for (let attempt = 0; targetAttempts === undefined || attempt < targetAttempts; attempt++) {
				assertBrowserAvailable(`waiting for the Chromium ${target} target`)
				const fetchController = new AbortController()
				let targets: readonly DevToolsTarget[]
				try {
					targets = await awaitInitializationStep(
						launchedBrowser,
						initializationDeadline,
						'requesting the DevTools target list',
						() => targetListRequest(targetListUrl, fetchController.signal),
						() => fetchController.abort(),
					)
				} catch (error) {
					if (!isTransientDevToolsConnectionError(error)) throw error
					// Chromium target list not ready yet.
					await Bun.sleep(pollMilliseconds)
					continue
				}
				const selectedTarget = targets.find(candidate => candidate.type === target)
				if (selectedTarget !== undefined) {
					const ws = new WebSocket(selectedTarget.webSocketDebuggerUrl)
					socket = ws
					await awaitInitializationStep(
						launchedBrowser,
						initializationDeadline,
						'opening the DevTools WebSocket',
						() =>
							new Promise<void>((resolve, reject) => {
								ws.addEventListener('open', () => resolve(), { once: true })
								ws.addEventListener('error', () => reject(new Error('Could not open the Chromium DevTools WebSocket')), { once: true })
							}),
						() => ws.close(),
					)
					return ws
				}
				await Bun.sleep(pollMilliseconds)
			}
			throw new Error(`Could not connect to the Chromium ${target} target`)
		})()

		const send = createChromiumCommandSender(connectedSocket, launchedBrowser, commandTimeoutMilliseconds)
		return { browser: launchedBrowser, close, send, socket: connectedSocket, ...createPageEvaluator(send, evaluationDefaults) }
	} catch (error) {
		await close()
		throw error
	}
}
