/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { DEFAULT_RPC_URL, readNetworkRpcUrls, resolveConfiguredRpcConfig, resolveConfiguredRpcUrl, saveNetworkRpcUrl } from '../lib/rpcConfig.js'

describe('rpc config', () => {
	test('prefers explicit overrides over every other source', () => {
		expect(
			resolveConfiguredRpcUrl({
				fallbackRpcUrl: 'https://fallback.example',
				location: {
					search: '?rpcUrl=https://query.example',
				},
				overrideRpcUrl: 'https://override.example',
				storage: {
					getItem: () => 'https://storage.example',
				},
			}),
		).toBe('https://override.example')
	})

	test('reads rpcUrl from the location search params and hash query', () => {
		expect(
			resolveConfiguredRpcUrl({
				location: {
					search: '?rpcUrl=https://query.example',
				},
			}),
		).toBe('https://query.example')

		expect(
			resolveConfiguredRpcUrl({
				location: {
					hash: '#/browse?rpcUrl=https://hash.example',
				},
			}),
		).toBe('https://hash.example')
	})

	test('accepts https and local loopback http RPC overrides', () => {
		expect(
			resolveConfiguredRpcConfig({
				location: {
					search: '?rpcUrl=https://query.example/path',
				},
			}),
		).toEqual({ source: 'url', url: 'https://query.example/path' })

		expect(
			resolveConfiguredRpcConfig({
				location: {
					search: '?rpcUrl=http://localhost:8545',
				},
			}),
		).toEqual({ source: 'url', url: 'http://localhost:8545' })

		expect(
			resolveConfiguredRpcConfig({
				location: {
					search: '?rpcUrl=http://127.0.0.1:8545',
				},
			}),
		).toEqual({ source: 'url', url: 'http://127.0.0.1:8545' })

		expect(
			resolveConfiguredRpcConfig({
				location: {
					search: '?rpcUrl=http://127.0.0.2:8545',
				},
			}),
		).toEqual({ source: 'url', url: 'http://127.0.0.2:8545' })

		expect(
			resolveConfiguredRpcConfig({
				location: {
					search: '?rpcUrl=http://[::1]:8545',
				},
			}),
		).toEqual({ source: 'url', url: 'http://[::1]:8545' })
	})

	test('rejects remote http URL overrides and keeps the fallback RPC', () => {
		expect(
			resolveConfiguredRpcConfig({
				fallbackRpcUrl: 'https://fallback.example',
				location: {
					search: '?rpcUrl=http://query.example',
				},
				storage: {
					getItem: () => 'https://storage.example',
				},
			}),
		).toEqual({
			rejectedOverride: {
				reason: 'RPC URL must use https:// unless it points to local loopback.',
				source: 'url',
				url: 'http://query.example',
			},
			source: 'default',
			url: 'https://fallback.example',
		})
	})

	test('rejects invalid localStorage overrides and keeps the fallback RPC', () => {
		expect(
			resolveConfiguredRpcConfig({
				fallbackRpcUrl: 'https://fallback.example',
				location: {
					search: '',
				},
				storage: {
					getItem: () => 'not-a-url',
				},
			}),
		).toEqual({
			rejectedOverride: {
				reason: 'RPC URL must be an absolute https:// URL, or http:// for local loopback.',
				source: 'localStorage',
				url: 'not-a-url',
			},
			source: 'default',
			url: 'https://fallback.example',
		})
	})

	test('returns the source for configured RPC URLs', () => {
		expect(
			resolveConfiguredRpcConfig({
				location: {
					hash: '#/browse?rpcUrl=https://hash.example',
				},
			}),
		).toEqual({ source: 'url', url: 'https://hash.example' })

		expect(
			resolveConfiguredRpcConfig({
				location: {
					search: '',
				},
				storage: {
					getItem: () => 'https://storage.example',
				},
			}),
		).toEqual({ source: 'localStorage', url: 'https://storage.example' })
	})

	test('uses storage when no override or query parameter is present', () => {
		expect(
			resolveConfiguredRpcUrl({
				location: {
					search: '',
				},
				storage: {
					getItem: () => 'https://storage.example',
				},
			}),
		).toBe('https://storage.example')
	})

	test('stores and resolves separate RPC URLs for each network', () => {
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		}
		saveNetworkRpcUrl('mainnet', 'https://mainnet.example', storage)
		saveNetworkRpcUrl('sepolia', 'https://sepolia.example', storage)

		expect(readNetworkRpcUrls(storage)).toEqual({ mainnet: 'https://mainnet.example', sepolia: 'https://sepolia.example' })
		expect(resolveConfiguredRpcUrl({ fallbackRpcUrl: 'https://fallback.example', location: { search: '' }, networkId: 'mainnet', storage })).toBe('https://mainnet.example')
		expect(resolveConfiguredRpcUrl({ fallbackRpcUrl: 'https://fallback.example', location: { search: '' }, networkId: 'sepolia', storage })).toBe('https://sepolia.example')
	})

	test('does not apply a legacy global RPC URL to a network-specific lookup', () => {
		const storage = { getItem: (key: string) => (key === 'zoltar.rpcUrl' ? 'https://legacy.example' : null) }
		expect(resolveConfiguredRpcUrl({ fallbackRpcUrl: 'https://mainnet-default.example', location: { search: '' }, networkId: 'mainnet', storage })).toBe('https://mainnet-default.example')
	})

	test('ignores storage access failures and falls back to the next source', () => {
		expect(
			resolveConfiguredRpcUrl({
				fallbackRpcUrl: 'https://fallback.example',
				location: {
					search: '',
				},
				storage: {
					getItem: () => {
						throw new Error('SecurityError')
					},
				},
			}),
		).toBe('https://fallback.example')
	})

	test('ignores failures while acquiring global localStorage', () => {
		const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
		try {
			Object.defineProperty(globalThis, 'localStorage', {
				configurable: true,
				get: () => {
					throw new DOMException('Storage unavailable', 'SecurityError')
				},
			})
			expect(
				resolveConfiguredRpcUrl({
					fallbackRpcUrl: 'https://fallback.example',
					location: { search: '' },
				}),
			).toBe('https://fallback.example')
		} finally {
			if (originalDescriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
			else Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
		}
	})

	test('falls back to the default shared RPC when no config source is set', () => {
		expect(
			resolveConfiguredRpcUrl({
				fallbackRpcUrl: DEFAULT_RPC_URL,
				location: {
					search: '',
				},
				storage: {
					getItem: () => null,
				},
			}),
		).toBe(DEFAULT_RPC_URL)
	})
})
