import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const windowsLauncher = join(import.meta.dir, '..', 'start.bat')

describe('Docker packaging', () => {
	test('provides a location-independent Windows launcher', async () => {
		const source = await readFile(windowsLauncher, 'utf8')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate')
		expect(source).toContain('exit /b %exit_code%')
	})
})
