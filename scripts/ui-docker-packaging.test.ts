import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const dockerfile = join(import.meta.dir, '..', 'ui', 'Dockerfile')

describe('UI Docker packaging', () => {
	test('copies every deployment manifest required by the production build', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json')
		expect(source).toContain('COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json')
	})
})
