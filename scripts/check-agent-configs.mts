import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as url from 'node:url'

const supportedModelReasoningEfforts = new Map([
	['gpt-5.6-luna', new Set(['low', 'medium', 'high', 'xhigh', 'max'])],
	['gpt-5.6-sol', new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])],
	['gpt-5.6-terra', new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])],
])
const requiredContractHeadings = ['## Handoff', '## Scope', '## Severity', '## Output', '## Scoring', '## Closure']
const requiredInstructionFragments = ['.codex/review-contract.md', 'Do not modify files.', 'Review limitations']

type AgentValidation = {
	errors: string[]
	name: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseToml(filePath: string, source: string, errors: string[]) {
	try {
		const value: unknown = Bun.TOML.parse(source)
		if (!isRecord(value)) {
			errors.push(`${filePath}: TOML root must be a table`)
			return undefined
		}
		return value
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		errors.push(`${filePath}: invalid TOML: ${message}`)
		return undefined
	}
}

function requiredString(config: Record<string, unknown>, key: string, filePath: string, errors: string[]) {
	const value = config[key]
	if (typeof value !== 'string' || value.trim() === '') {
		errors.push(`${filePath}: ${key} must be a non-empty string`)
		return undefined
	}
	return value
}

export function validateAgentConfigSource(filePath: string, source: string): AgentValidation {
	const errors: string[] = []
	const config = parseToml(filePath, source, errors)
	if (config === undefined) return { errors, name: undefined }

	const name = requiredString(config, 'name', filePath, errors)
	requiredString(config, 'description', filePath, errors)
	const instructions = requiredString(config, 'developer_instructions', filePath, errors)

	if (config['sandbox_mode'] !== 'read-only') errors.push(`${filePath}: review agents must use sandbox_mode = 'read-only'`)

	const model = config['model']
	const supportedReasoningEfforts = typeof model === 'string' ? supportedModelReasoningEfforts.get(model) : undefined
	if (supportedReasoningEfforts === undefined) errors.push(`${filePath}: model must be one of ${[...supportedModelReasoningEfforts.keys()].join(', ')}`)

	const reasoningEffort = config['model_reasoning_effort']
	if (typeof reasoningEffort !== 'string' || supportedReasoningEfforts === undefined || !supportedReasoningEfforts.has(reasoningEffort)) errors.push(`${filePath}: model_reasoning_effort is unsupported for the selected model`)

	const nicknames = config['nickname_candidates']
	if (!Array.isArray(nicknames) || nicknames.length === 0 || nicknames.some(nickname => typeof nickname !== 'string' || nickname.trim() === '' || !/^[A-Za-z0-9 _-]+$/.test(nickname)) || new Set(nicknames).size !== nicknames.length) {
		errors.push(`${filePath}: nickname_candidates must contain unique, non-empty display names`)
	}

	if (instructions !== undefined) {
		for (const fragment of requiredInstructionFragments) {
			if (!instructions.includes(fragment)) errors.push(`${filePath}: developer_instructions must include ${JSON.stringify(fragment)}`)
		}
	}

	return { errors, name }
}

export function validateProjectAgentSources(agentSources: ReadonlyArray<{ filePath: string; source: string }>, rootInstructions: string, reviewContract: string, projectConfigSource: string) {
	const errors: string[] = []
	const names = new Map<string, string>()
	const fileNames = new Set(agentSources.map(({ filePath }) => path.basename(filePath)))

	for (const { filePath, source } of agentSources) {
		const validation = validateAgentConfigSource(filePath, source)
		errors.push(...validation.errors)
		if (validation.name === undefined) continue
		const existingPath = names.get(validation.name)
		if (existingPath === undefined) names.set(validation.name, filePath)
		else errors.push(`${filePath}: agent name ${JSON.stringify(validation.name)} duplicates ${existingPath}`)
	}

	const contractHeadingLines = new Set(reviewContract.split(/\r?\n/).map(line => line.trim()))
	for (const heading of requiredContractHeadings) {
		if (!contractHeadingLines.has(heading)) errors.push(`.codex/review-contract.md: missing ${heading}`)
	}

	const referencedAgentFiles = [...rootInstructions.matchAll(/\.codex\/agents\/([A-Za-z0-9_-]+\.toml)/g)].map(match => match[1]).filter(fileName => fileName !== undefined)
	for (const fileName of referencedAgentFiles) {
		if (!fileNames.has(fileName)) errors.push(`AGENTS.md: referenced agent file does not exist: .codex/agents/${fileName}`)
	}
	for (const fileName of fileNames) {
		if (!referencedAgentFiles.includes(fileName)) errors.push(`AGENTS.md: project agent is not referenced: .codex/agents/${fileName}`)
	}

	const configErrors: string[] = []
	const projectConfig = parseToml('.codex/config.toml', projectConfigSource, configErrors)
	errors.push(...configErrors)
	const agentsConfig = projectConfig?.['agents']
	if (!isRecord(agentsConfig)) errors.push('.codex/config.toml: [agents] table is required')
	else {
		const maxThreads = agentsConfig['max_threads']
		if (typeof maxThreads !== 'number' || !Number.isInteger(maxThreads) || maxThreads < 1) errors.push('.codex/config.toml: agents.max_threads must be a positive integer')
		if (agentsConfig['max_depth'] !== 1) errors.push('.codex/config.toml: agents.max_depth must remain 1 to prevent recursive review delegation')
	}

	return errors
}

async function main() {
	const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url))
	const repositoryRoot = path.join(scriptDirectory, '..')
	const agentDirectory = path.join(repositoryRoot, '.codex', 'agents')
	const agentFileNames = (await readdir(agentDirectory)).filter(fileName => fileName.endsWith('.toml')).sort()
	const agentSources = await Promise.all(
		agentFileNames.map(async fileName => {
			const filePath = path.join(agentDirectory, fileName)
			return { filePath: path.relative(repositoryRoot, filePath), source: await readFile(filePath, 'utf8') }
		}),
	)
	const [rootInstructions, reviewContract, projectConfigSource] = await Promise.all([readFile(path.join(repositoryRoot, 'AGENTS.md'), 'utf8'), readFile(path.join(repositoryRoot, '.codex', 'review-contract.md'), 'utf8'), readFile(path.join(repositoryRoot, '.codex', 'config.toml'), 'utf8')])
	const errors = validateProjectAgentSources(agentSources, rootInstructions, reviewContract, projectConfigSource)
	if (errors.length > 0) {
		for (const error of errors) console.error(error)
		process.exitCode = 1
		return
	}
	console.log(`Validated ${agentSources.length} project agent configurations`)
}

if (import.meta.main) await main()
