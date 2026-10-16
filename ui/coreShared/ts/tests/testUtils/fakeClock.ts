import { jest } from 'bun:test'
import { act } from 'preact/test-utils'

type FakeClock = {
	/** Moves timers, `Date.now()`, and `performance.now()` forward and flushes the resulting renders. */
	advance: (milliseconds: number) => Promise<void>
}

/**
 * Runs `body` on Bun's fake clock, so a countdown moves exactly as far as the test advances it, however loaded the machine is.
 * Render inside `body`, so components start their intervals on the fake clock. Real-time polling such as `waitFor` stalls there.
 */
export async function withFakeClock(body: (clock: FakeClock) => Promise<void>) {
	jest.useFakeTimers()
	try {
		await body({
			advance: async milliseconds => {
				await act(() => {
					jest.advanceTimersByTime(milliseconds)
				})
			},
		})
	} finally {
		jest.useRealTimers()
	}
}
