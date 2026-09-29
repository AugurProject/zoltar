import { expect } from 'bun:test'
import { join } from 'node:path'

type DockerInstruction = {
	readonly keyword: string
	readonly value: string
}

export type DockerStage = {
	readonly base: string
	readonly instructions: readonly DockerInstruction[]
	readonly name?: string
}

const normalizedLines = (source: string): string[] => {
	const logicalLines: string[] = []
	let current = ''
	for (const sourceLine of source.replaceAll('\r\n', '\n').split('\n')) {
		const line = sourceLine.trim()
		if (line === '' || line.startsWith('#')) continue
		current = `${current} ${line}`.trim()
		if (current.endsWith('\\')) {
			current = current.slice(0, -1).trimEnd()
			continue
		}
		logicalLines.push(current.replaceAll(/\s+/gu, ' '))
		current = ''
	}
	if (current !== '') logicalLines.push(current.replaceAll(/\s+/gu, ' '))
	return logicalLines
}

export function dockerGlobalArguments(source: string): readonly string[] {
	const arguments_: string[] = []
	for (const line of normalizedLines(source)) {
		const instructionMatch = /^(\S+)\s+(.+)$/u.exec(line)
		if (instructionMatch === null) continue
		const [, rawKeyword, value] = instructionMatch
		if (rawKeyword === undefined || value === undefined) continue
		const keyword = rawKeyword.toUpperCase()
		if (keyword === 'FROM') break
		if (keyword === 'ARG') arguments_.push(value)
	}
	return arguments_
}

export function parseDockerfile(source: string): readonly DockerStage[] {
	const stages: { base: string; instructions: DockerInstruction[]; name?: string }[] = []
	for (const line of normalizedLines(source)) {
		const instructionMatch = /^(\S+)\s+(.+)$/u.exec(line)
		if (instructionMatch === null) continue
		const [, rawKeyword, value] = instructionMatch
		if (rawKeyword === undefined || value === undefined) continue
		const keyword = rawKeyword.toUpperCase()
		if (keyword === 'FROM') {
			const fromMatch = /^(\S+)(?:\s+AS\s+(\S+))?$/iu.exec(value)
			if (fromMatch?.[1] === undefined) throw new Error(`Invalid Docker FROM instruction: ${line}`)
			stages.push({ base: fromMatch[1], instructions: [], ...(fromMatch[2] === undefined ? {} : { name: fromMatch[2] }) })
			continue
		}
		const stage = stages.at(-1)
		if (stage === undefined && keyword === 'ARG') continue
		if (stage === undefined) throw new Error(`Docker instruction appears before the first FROM: ${line}`)
		stage.instructions.push({ keyword, value })
	}
	return stages
}

export function requireDockerStage(stages: readonly DockerStage[], name: string): DockerStage {
	const stage = stages.find(candidate => candidate.name === name)
	if (stage === undefined) throw new Error(`Missing Docker stage: ${name}`)
	return stage
}

export function dockerInstructions(stage: DockerStage, keyword: string): readonly string[] {
	return stage.instructions.filter(instruction => instruction.keyword === keyword.toUpperCase()).map(instruction => instruction.value)
}

export const shellCommandSegments = (command: string): readonly string[] => command.split(/\s*&&\s*/u).map(segment => segment.trim().replaceAll(/\s+/gu, ' '))

export const batchCommands = (source: string): readonly string[] =>
	source
		.replaceAll('\r\n', '\n')
		.split('\n')
		.map(line => line.trim().replaceAll(/\s+/gu, ' '))
		.filter(line => line !== '' && !line.startsWith('::') && !/^rem(?:\s|$)/iu.test(line) && line.toLowerCase() !== '@echo off')

type BotComposeService = {
	readonly environment?: Record<string, unknown>
	readonly healthcheck?: { readonly test?: readonly unknown[] }
	readonly ports?: readonly unknown[]
	readonly volumes?: readonly unknown[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function botComposeService(source: string, service: string): BotComposeService {
	const compose: unknown = Bun.YAML.parse(source)
	const services = isRecord(compose) ? compose['services'] : undefined
	const parsed = isRecord(services) ? services[service] : undefined
	if (!isRecord(parsed)) throw new Error(`Missing Compose service: ${service}`)
	const { environment, healthcheck, ports, volumes } = parsed
	if (environment !== undefined && !isRecord(environment)) throw new Error(`Compose service ${service} environment must be a mapping`)
	if (healthcheck !== undefined && !isRecord(healthcheck)) throw new Error(`Compose service ${service} healthcheck must be a mapping`)
	const healthTest = healthcheck?.['test']
	if (healthTest !== undefined && !Array.isArray(healthTest)) throw new Error(`Compose service ${service} healthcheck test must be a list`)
	if (ports !== undefined && !Array.isArray(ports)) throw new Error(`Compose service ${service} ports must be a list`)
	if (volumes !== undefined && !Array.isArray(volumes)) throw new Error(`Compose service ${service} volumes must be a list`)
	return {
		...(environment === undefined ? {} : { environment }),
		...(healthTest === undefined ? {} : { healthcheck: { test: healthTest } }),
		...(ports === undefined ? {} : { ports }),
		...(volumes === undefined ? {} : { volumes }),
	}
}

/**
 * Asserts the packaging contract shared by every bot image: a shared-package builder stage, a production install filtered to
 * the bot package, the shared UI assets and deployment manifests, a loopback-only passwordless dashboard, and the bot's own
 * scripts and entrypoint. Returns the parsed sources so a bot test can assert what is specific to that bot.
 */
export async function assertBotDockerPackaging(parameters: { readonly botDirectory: string; readonly composeService: string; readonly copiedScripts: readonly string[]; readonly entrypointSource: string; readonly packageName: string; readonly port: number; readonly runtimeChecks: readonly string[] }) {
	const bot = parameters.botDirectory.split(/[\\/]/u).findLast(segment => segment !== '')
	if (bot === undefined) throw new Error('Bot directory must name the bot')
	const stages = parseDockerfile(await Bun.file(join(parameters.botDirectory, 'Dockerfile')).text())
	const ignoreSource = await Bun.file(join(parameters.botDirectory, 'Dockerfile.dockerignore')).text()
	const builder = requireDockerStage(stages, 'shared-builder')
	const runtime = stages.at(-1)
	if (runtime === undefined) throw new Error('Missing runtime Docker stage')
	const copies = stages.flatMap(stage => dockerInstructions(stage, 'COPY'))
	const runtimeCopies = dockerInstructions(runtime, 'COPY')
	const runtimeRuns = dockerInstructions(runtime, 'RUN').flatMap(shellCommandSegments)
	const port = parameters.port.toString()

	expect(builder.base).toContain('-alpine')
	expect(dockerInstructions(builder, 'RUN').flatMap(shellCommandSegments)).toContain('bun ./tooling/repo/build-shared.mts')
	expect(runtimeCopies).toContain('--from=shared-builder /source/shared/ ./shared/')
	expect(runtimeRuns).toContain(`bun install --frozen-lockfile --production --filter ${parameters.packageName}`)
	expect(dockerInstructions(runtime, 'WORKDIR')).toContain(`/app/bots/${bot}`)
	expect(dockerInstructions(runtime, 'USER')).toEqual(['bun'])
	expect(dockerInstructions(runtime, 'EXPOSE')).toContain(port)
	expect(dockerInstructions(runtime, 'VOLUME')).toContain(`["/app/bots/${bot}/.state"]`)
	expect(dockerInstructions(runtime, 'ENTRYPOINT')).toEqual(['["./scripts/docker-entrypoint.sh"]'])
	expect(runtimeCopies).toContain(`bots/${bot}/src/ ./bots/${bot}/src/`)
	expect(runtimeCopies).toContain(`${parameters.entrypointSource} ./bots/${bot}/scripts/docker-entrypoint.sh`)
	expect(ignoreSource).toContain(`!${parameters.entrypointSource}`)
	for (const asset of ['ui/coreShared/ts/ ./ui/coreShared/ts/', 'ui/coreShared/css/tokens.css ./ui/coreShared/css/tokens.css']) expect(runtimeCopies).toContain(asset)
	expect(ignoreSource).toContain('!ui/coreShared/css/tokens.css')
	expect(copies.some(copy => copy.includes('ui/coreShared/favicon'))).toBe(false)
	expect(ignoreSource).not.toContain('ui/coreShared/favicon')
	expect(runtimeCopies).toContain('docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/')
	for (const network of ['mainnet', 'sepolia']) expect(ignoreSource).toContain(`!docs/${network}-deployment-addresses.json`)
	for (const script of parameters.copiedScripts) {
		expect(runtimeCopies).toContain(`bots/${bot}/scripts/${script} ./bots/${bot}/scripts/${script}`)
		expect(ignoreSource).toContain(`!bots/${bot}/scripts/${script}`)
	}
	for (const script of parameters.runtimeChecks) expect(runtimeRuns).toContain(`bun ./scripts/${script}`)

	const service = botComposeService(await Bun.file(join(parameters.botDirectory, 'compose.yaml')).text(), parameters.composeService)
	expect(service.environment?.['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED']).toBe('true')
	expect(service.environment).not.toHaveProperty('ZOLTAR_BOT_DASHBOARD_PASSWORD')
	expect(service.ports).toEqual([`127.0.0.1:${port}:${port}`])
	expect(service.healthcheck?.test?.map(String).join(' ') ?? '').toContain(`fetch('http://127.0.0.1:${port}/healthz')`)
	return { copies, ignoreSource, runtimeRuns, service, stages }
}
