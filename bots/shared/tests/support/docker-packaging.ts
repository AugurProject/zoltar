import { expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { batchCommands } from '../../../../tooling/testing/packaging-parsers.ts'

/** Asserts a bot's Windows launcher creates the shared external signer-lock volume before any Compose command runs. */
export async function expectSignerLockVolumeCreatedBeforeCompose(windowsLauncher: string) {
	const commands = batchCommands(await readFile(windowsLauncher, 'utf8'))
	const create = 'docker volume create zoltar-bot-signer-locks >nul || goto finish'
	expect(commands).toContain(create)
	expect(commands.indexOf(create)).toBeLessThan(commands.findIndex(command => command.startsWith('docker compose ')))
}
