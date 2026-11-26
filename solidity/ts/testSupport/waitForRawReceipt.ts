const receiptWaitBudgetMs = 10_000
const receiptClock = { now: () => performance.now(), wait: (ms: number) => Bun.sleep(ms) }

export async function waitForRawReceipt(hash: unknown, read: () => Promise<unknown>, clock = receiptClock) {
	const deadline = clock.now() + receiptWaitBudgetMs
	let delay = 5
	while (true) {
		const receipt = await read()
		if (typeof receipt === 'object' && receipt !== null && 'status' in receipt) return receipt
		if (receipt !== null) throw new Error(`Invalid receipt response for ${String(hash)}`)
		const remaining = deadline - clock.now()
		if (remaining <= 0) throw new Error(`No receipt for ${String(hash)} after ${receiptWaitBudgetMs} ms (last RPC result: null)`)
		await clock.wait(Math.min(delay, remaining))
		delay = Math.min(50, delay * 2)
	}
}
