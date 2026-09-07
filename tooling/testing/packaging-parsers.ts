export type DockerInstruction = {
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
