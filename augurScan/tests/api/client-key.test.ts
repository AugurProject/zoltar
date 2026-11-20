import { describe, expect, test } from 'bun:test'
import { clientKey, createFixedWindowRateLimiter, parseTrustedProxies, requestRateLimitGuard } from '../../src/http.ts'

const noProxies = { trustedProxies: parseTrustedProxies('') }
const forwarded = (value: string): Headers => new Headers({ 'x-forwarded-for': value })

describe('rate-limit client key', () => {
	test('keys IPv4 sockets by their exact address', () => {
		expect(clientKey('192.0.2.1', new Headers(), noProxies)).toBe('192.0.2.1')
		expect(clientKey('192.0.2.2', new Headers(), noProxies)).not.toBe(clientKey('192.0.2.1', new Headers(), noProxies))
	})

	test('treats an IPv4-mapped IPv6 socket as the IPv4 client', () => {
		expect(clientKey('::ffff:192.0.2.1', new Headers(), noProxies)).toBe('192.0.2.1')
		expect(clientKey('::FFFF:c000:0201', new Headers(), noProxies)).toBe('192.0.2.1')
	})

	test('groups IPv6 clients in the same /64 into one bucket', () => {
		const first = clientKey('2001:db8:1:2::1', new Headers(), noProxies)
		const second = clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff', new Headers(), noProxies)
		expect(first).toBe(second)
		expect(first).toBe('2001:db8:1:2::/64')
	})

	test('keeps different IPv6 /64 networks in separate buckets', () => {
		expect(clientKey('2001:db8:1:2::1', new Headers(), noProxies)).not.toBe(clientKey('2001:db8:1:3::1', new Headers(), noProxies))
	})

	test('IPv6 address rotation inside one /64 shares one limiter bucket', () => {
		const admit = createFixedWindowRateLimiter(2, 60_000)
		for (const suffix of ['1', '2']) expect(requestRateLimitGuard('/api/v1/logs', clientKey(`2001:db8::${suffix}`, new Headers(), noProxies), admit)).toBeUndefined()
		expect(requestRateLimitGuard('/api/v1/logs', clientKey('2001:db8::3', new Headers(), noProxies), admit)?.status).toBe(429)
		expect(requestRateLimitGuard('/api/v1/logs', clientKey('2001:db8:0:1::3', new Headers(), noProxies), admit)).toBeUndefined()
	})

	test('ignores X-Forwarded-For from a socket that is not a trusted proxy', () => {
		const config = { trustedProxies: parseTrustedProxies('10.0.0.1') }
		expect(clientKey('198.51.100.7', forwarded('203.0.113.9'), config)).toBe('198.51.100.7')
		expect(clientKey('198.51.100.7', forwarded('203.0.113.9'), noProxies)).toBe('198.51.100.7')
	})

	test('uses the forwarded client address from a trusted proxy', () => {
		const config = { trustedProxies: parseTrustedProxies('10.0.0.1') }
		expect(clientKey('10.0.0.1', forwarded('203.0.113.9'), config)).toBe('203.0.113.9')
		expect(clientKey('::ffff:10.0.0.1', forwarded('2001:db8:5:6::9'), config)).toBe('2001:db8:5:6::/64')
	})

	test('ignores spoofed left-hand forwarded entries and skips trusted proxy hops', () => {
		const config = { trustedProxies: parseTrustedProxies('10.0.0.0/8, 192.0.2.10') }
		expect(clientKey('10.0.0.1', forwarded('1.1.1.1, 2.2.2.2, 203.0.113.9'), config)).toBe('203.0.113.9')
		expect(clientKey('10.0.0.1', forwarded('1.1.1.1, 203.0.113.9, 192.0.2.10, 10.2.3.4'), config)).toBe('203.0.113.9')
		const headers = new Headers()
		headers.append('x-forwarded-for', '1.1.1.1')
		headers.append('x-forwarded-for', '203.0.113.9')
		expect(clientKey('10.0.0.1', headers, config)).toBe('203.0.113.9')
	})

	test('falls back to the trusted proxy address when the forwarded chain is missing or malformed', () => {
		const config = { trustedProxies: parseTrustedProxies('10.0.0.1') }
		expect(clientKey('10.0.0.1', new Headers(), config)).toBe('10.0.0.1')
		expect(clientKey('10.0.0.1', forwarded('203.0.113.9, not-an-address'), config)).toBe('10.0.0.1')
	})

	test('accepts forwarded entries that carry ports or IPv6 brackets', () => {
		const config = { trustedProxies: parseTrustedProxies('10.0.0.1') }
		expect(clientKey('10.0.0.1', forwarded('203.0.113.9:4711'), config)).toBe('203.0.113.9')
		expect(clientKey('10.0.0.1', forwarded('[2001:db8::1]:4711'), config)).toBe('2001:db8::/64')
	})

	test('keys a request without a socket address as unknown', () => {
		expect(clientKey(undefined, new Headers(), noProxies)).toBe('unknown')
	})
})

describe('trusted proxy configuration', () => {
	test('is disabled when empty', () => {
		expect(parseTrustedProxies('')).toEqual([])
		expect(parseTrustedProxies(' , ')).toEqual([])
	})

	test('matches exact addresses and IPv4 and IPv6 CIDR ranges', () => {
		const config = { trustedProxies: parseTrustedProxies('172.16.0.0/12,2001:db8:aa::/48,192.0.2.5') }
		expect(clientKey('172.31.255.254', forwarded('203.0.113.1'), config)).toBe('203.0.113.1')
		expect(clientKey('172.32.0.1', forwarded('203.0.113.1'), config)).toBe('172.32.0.1')
		expect(clientKey('2001:db8:aa:ffff::1', forwarded('203.0.113.1'), config)).toBe('203.0.113.1')
		expect(clientKey('2001:db8:ab::1', forwarded('203.0.113.1'), config)).toBe('2001:db8:ab::/64')
		expect(clientKey('192.0.2.5', forwarded('203.0.113.1'), config)).toBe('203.0.113.1')
		expect(clientKey('192.0.2.6', forwarded('203.0.113.1'), config)).toBe('192.0.2.6')
	})

	test('matches IPv4-mapped proxy addresses against IPv4 ranges', () => {
		const config = { trustedProxies: parseTrustedProxies('::ffff:10.0.0.0/104') }
		expect(clientKey('10.9.8.7', forwarded('203.0.113.1'), config)).toBe('203.0.113.1')
	})

	test('rejects malformed entries', () => {
		for (const value of ['10.0.0.0/33', '2001:db8::/129', 'proxy.internal', '10.0.0.0/', '10.0.0.0/8/8', '10.0.0.256', '1:2:3:4:5:6:7:8:9', '::1::2', '10.0.0.0/-1', '10.0.0.0/08x']) {
			expect(() => parseTrustedProxies(value)).toThrow('TRUSTED_PROXY_ADDRESSES')
		}
	})
})
