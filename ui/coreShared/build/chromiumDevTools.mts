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
