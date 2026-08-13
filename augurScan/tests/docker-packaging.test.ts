import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const windowsLauncher = join(import.meta.dir, '..', 'start.bat')
const rootDockerIgnore = join(import.meta.dir, '..', '..', '.dockerignore')

describe('Docker packaging', () => {
	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})

	test('excludes local environment secrets from the repository build context', async () => {
		const patterns = (await readFile(rootDockerIgnore, 'utf8')).split(/\r?\n/u)
		expect(patterns).toContain('**/.env')
		expect(patterns).toContain('**/.env.*')
		expect(patterns).toContain('!**/.env.example')
	})
})
