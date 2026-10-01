import { expect, spyOn, test } from 'bun:test'
import { logEvent } from '../src/infrastructure/log-event.ts'

test('writes one key=value line per event to the stream for its level, quoting values that would break parsing', () => {
	const info = spyOn(console, 'log').mockImplementation(() => {})
	const warning = spyOn(console, 'warn').mockImplementation(() => {})
	const failure = spyOn(console, 'error').mockImplementation(() => {})
	try {
		logEvent('chaos', 'started')
		logEvent('arbitrager', 'venuePairSkipped', { reason: '', token: 'a=b' }, 'warning')
		logEvent('liquidator', 'cycleFailed', { block: 12n, error: 'RPC timed out', live: false, missing: undefined, pool: '0xabc' }, 'error')
		expect(info.mock.calls).toEqual([['bot=chaos event=started']])
		expect(warning.mock.calls).toEqual([['bot=arbitrager event=venuePairSkipped reason="" token="a=b"']])
		expect(failure.mock.calls).toEqual([['bot=liquidator event=cycleFailed block=12 error="RPC timed out" live=false pool=0xabc']])
	} finally {
		info.mockRestore()
		warning.mockRestore()
		failure.mockRestore()
	}
})
