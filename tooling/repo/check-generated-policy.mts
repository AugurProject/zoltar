import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type GeneratedArtifact, generatedArtifactPathspec, generatedArtifacts } from './generated-artifacts.ts'
import { listRepositoryFiles } from './git.mts'
import { repositoryRoot } from './root.mts'

type GitattributesRule = {
	readonly line: number
	readonly pattern: string
	readonly attributes: ReadonlyMap<string, string>
}

export type GeneratedPolicyQueries = {
	/** Tracked files matching a Git pathspec. */
	readonly trackedFiles: (pathspec: string) => readonly string[]
	/** The subset of repository-relative paths that `.gitignore` rules ignore. */
	readonly ignoredPaths: (paths: readonly string[]) => ReadonlySet<string>
}

export function parseGitattributes(text: string): GitattributesRule[] {
	return text.split('\n').flatMap((rawLine, index) => {
		const line = rawLine.trim()
		if (line === '' || line.startsWith('#')) return []
		const [pattern, ...tokens] = line.split(/\s+/u)
		if (pattern === undefined) return []
		const attributes = new Map(
			tokens.map(token => {
				const separator = token.indexOf('=')
				if (separator >= 0) return [token.slice(0, separator), token.slice(separator + 1)] as const
				if (token.startsWith('-') || token.startsWith('!')) return [token.slice(1), 'false'] as const
				return [token, 'true'] as const
			}),
		)
		return [{ line: index + 1, pattern, attributes }]
	})
}

const linguistAttribute = (kind: NonNullable<GeneratedArtifact['linguist']>) => `linguist-${kind}`
const attributePattern = (artifact: GeneratedArtifact) => `/${artifact.pattern}`
/** Git pathspec for a `.gitattributes` pattern: a leading or inner slash anchors it at the root; otherwise it matches at any depth. */
function attributePathspec(pattern: string) {
	if (pattern.startsWith('/')) return `:(glob)${pattern.slice(1)}`
	if (pattern.includes('/')) return `:(glob)${pattern}`
	return `:(glob)**/${pattern}`
}
/** A concrete path that the registry glob matches, used to probe `.gitignore` rules. */
const samplePath = (pattern: string) => pattern.replaceAll('**', 'sample').replaceAll('*', 'sample')

/** Returns every inconsistency between the generated-output registry, `.gitattributes`, `.gitignore`, and the Git index. */
export function findGeneratedPolicyViolations(gitattributes: string, queries: GeneratedPolicyQueries, registry: readonly GeneratedArtifact[] = generatedArtifacts): string[] {
	const violations: string[] = []
	const rules = parseGitattributes(gitattributes)
	const registryByAttributePattern = new Map(registry.map(artifact => [attributePattern(artifact), artifact]))
	if (registryByAttributePattern.size !== registry.length) violations.push('Generated-artifact registry contains duplicate patterns')

	const seenPatterns = new Map<string, number>()
	for (const rule of rules) {
		const firstLine = seenPatterns.get(rule.pattern)
		if (firstLine !== undefined) violations.push(`.gitattributes:${rule.line} repeats the pattern ${rule.pattern} from line ${firstLine}; combine its attributes on one line`)
		else seenPatterns.set(rule.pattern, rule.line)

		const artifact = registryByAttributePattern.get(rule.pattern)
		if (rule.attributes.get('linguist-generated') === 'true' && artifact?.linguist !== 'generated') {
			violations.push(`.gitattributes:${rule.line} marks ${rule.pattern} linguist-generated, but tooling/repo/generated-artifacts.ts does not register it as a generated output`)
			continue
		}
		if (artifact === undefined && queries.trackedFiles(attributePathspec(rule.pattern)).length === 0) violations.push(`.gitattributes:${rule.line} references ${rule.pattern}, which matches no tracked file and no registered generated output`)
	}

	const rulesByPattern = new Map(rules.map(rule => [rule.pattern, rule]))
	for (const artifact of registry) {
		if (artifact.linguist !== undefined) {
			const attribute = linguistAttribute(artifact.linguist)
			if (rulesByPattern.get(attributePattern(artifact))?.attributes.get(attribute) !== 'true') violations.push(`.gitattributes must mark ${attributePattern(artifact)} ${attribute}=true`)
		}
		const trackedFiles = queries.trackedFiles(generatedArtifactPathspec(artifact))
		if (artifact.tracked && trackedFiles.length === 0) violations.push(`Tracked generated output ${artifact.pattern} matches no tracked file; remove it from the registry or restore the output`)
		if (!artifact.tracked && trackedFiles.length > 0) violations.push(`Untracked generated output ${artifact.pattern} has tracked files: ${trackedFiles.join(', ')}`)
	}

	const untrackedSamples = registry.filter(artifact => !artifact.tracked).map(artifact => [artifact, samplePath(artifact.pattern)] as const)
	const ignored = queries.ignoredPaths(untrackedSamples.map(([, sample]) => sample))
	for (const [artifact, sample] of untrackedSamples) if (!ignored.has(sample)) violations.push(`.gitignore does not ignore the generated output ${artifact.pattern}`)
	return violations
}

export function gitGeneratedPolicyQueries(cwd = repositoryRoot): GeneratedPolicyQueries {
	return {
		trackedFiles: pathspec => listRepositoryFiles({ cwd, pathspec: [pathspec] }),
		ignoredPaths: paths => {
			if (paths.length === 0) return new Set()
			// --verbose --non-matching reports every path with its last matching rule, or `::` when no rule matches.
			const result = spawnSync('git', ['check-ignore', '--no-index', '--verbose', '--non-matching', '--', ...paths], { cwd, encoding: 'utf8' })
			if (result.error !== undefined) throw result.error
			// Exit status 1 only means that no path is ignored.
			if (result.status !== 0 && result.status !== 1) throw new Error(`git check-ignore failed: ${result.stderr.trim()}`)
			return new Set(
				result.stdout.split('\n').flatMap(line => {
					const [source, ignoredPath] = line.split('\t')
					if (source === undefined || ignoredPath === undefined || source === '::') return []
					const rule = source.split(':').slice(2).join(':')
					return rule.startsWith('!') ? [] : [ignoredPath]
				}),
			)
		},
	}
}

if (import.meta.main) {
	const violations = findGeneratedPolicyViolations(readFileSync(path.join(repositoryRoot, '.gitattributes'), 'utf8'), gitGeneratedPolicyQueries())
	if (violations.length > 0) {
		console.error(`Generated-output policy violations:\n${violations.map(violation => `- ${violation}`).join('\n')}`)
		process.exit(1)
	}
	console.log(`Generated-output policy verified for ${generatedArtifacts.length.toString()} registered outputs.`)
}
