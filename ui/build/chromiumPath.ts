import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

const CHROMIUM_COMMAND_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'msedge'] as const

const getWindowsChromiumPaths = (environment: Readonly<Record<string, string | undefined>>): string[] => {
	const localAppData = environment['LOCALAPPDATA']
	const programFiles = environment['PROGRAMFILES']
	const programFilesX86 = environment['PROGRAMFILES(X86)']
	return [
		...(localAppData === undefined ? [] : [win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), win32.join(localAppData, 'Chromium', 'Application', 'chrome.exe'), win32.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
		...(programFiles === undefined ? [] : [win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), win32.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
		...(programFilesX86 === undefined ? [] : [win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), win32.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
	]
}

export const getChromiumPath = ({
	environment = process.env,
	fileExists = existsSync,
	platform = process.platform,
	which = Bun.which,
}: {
	readonly environment?: Readonly<Record<string, string | undefined>>
	readonly fileExists?: (path: string) => boolean
	readonly platform?: NodeJS.Platform
	readonly which?: (commandName: string) => string | null
} = {}): string | undefined => {
	for (const commandName of CHROMIUM_COMMAND_NAMES) {
		const commandPath = which(commandName)
		if (commandPath !== null) return commandPath
	}

	if (platform === 'win32') {
		for (const commandPath of getWindowsChromiumPaths(environment)) {
			if (fileExists(commandPath)) return commandPath
		}
	}
	return undefined
}
