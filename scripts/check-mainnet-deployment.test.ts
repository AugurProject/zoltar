import { expect, spyOn, test } from 'bun:test'
import { checkManifestFreshness } from './check-mainnet-deployment.mts'

test('manifest freshness accepts exact generated deployment data in strict mode', () => {
	expect(() => checkManifestFreshness('same manifest\n', 'same manifest\n', true)).not.toThrow()
})

test('manifest freshness warns for ordinary development checks', () => {
	const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
	try {
		checkManifestFreshness('published manifest\n', 'computed manifest\n', false)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Mainnet deployment manifest is stale'))
	} finally {
		warn.mockRestore()
	}
})

test('manifest freshness blocks release checks without modifying the manifest', () => {
	expect(() => checkManifestFreshness('published manifest\n', 'computed manifest\n', true)).toThrow('Mainnet deployment manifest is stale')
})
