import { expect, test } from 'bun:test'
import { validateAgentConfigSource, validateProjectAgentSources } from './check-agent-configs.mts'

const validAgent = (name: string) => `
name = "${name}"
description = "Reviews changes."
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
nickname_candidates = ["Review"]
developer_instructions = """
Read .codex/review-contract.md. Do not modify files. Include Review limitations.
"""
`

const validContract = ['## Handoff', '## Scope', '## Severity', '## Output', '## Scoring', '## Closure'].join('\n')
const validProjectConfig = '[agents]\nmax_threads = 3\nmax_depth = 1\n'

test('agent config validation accepts a complete read-only reviewer', () => {
	expect(validateAgentConfigSource('.codex/agents/reviewer.toml', validAgent('reviewer')).errors).toEqual([])
})

test('agent config validation rejects unsafe and unsupported review settings', () => {
	const source = validAgent('reviewer').replace('gpt-5.6-sol', 'unknown-model').replace('read-only', 'workspace-write').replace('Include Review limitations.', '')
	const errors = validateAgentConfigSource('.codex/agents/reviewer.toml', source).errors

	expect(errors).toContain(".codex/agents/reviewer.toml: review agents must use sandbox_mode = 'read-only'")
	expect(errors.some(error => error.includes('model must be one of'))).toBe(true)
	expect(errors).toContain('.codex/agents/reviewer.toml: developer_instructions must include "Review limitations"')
})

test('agent config validation rejects unsupported model-effort combinations and blank nicknames', () => {
	const lunaUltra = validAgent('reviewer').replace('gpt-5.6-sol', 'gpt-5.6-luna').replace('"high"', '"ultra"')
	const minimal = validAgent('reviewer').replace('"high"', '"minimal"')
	const blankNickname = validAgent('reviewer').replace('["Review"]', '[" "]')

	expect(validateAgentConfigSource('.codex/agents/reviewer.toml', lunaUltra).errors).toContain('.codex/agents/reviewer.toml: model_reasoning_effort is unsupported for the selected model')
	expect(validateAgentConfigSource('.codex/agents/reviewer.toml', minimal).errors).toContain('.codex/agents/reviewer.toml: model_reasoning_effort is unsupported for the selected model')
	expect(validateAgentConfigSource('.codex/agents/reviewer.toml', blankNickname).errors).toContain('.codex/agents/reviewer.toml: nickname_candidates must contain unique, non-empty display names')
})

test('project validation detects duplicate names and stale AGENTS references', () => {
	const errors = validateProjectAgentSources(
		[
			{ filePath: '.codex/agents/reviewer.toml', source: validAgent('reviewer') },
			{ filePath: '.codex/agents/textReview.toml', source: validAgent('reviewer') },
		],
		'Use `.codex/agents/reviewer.toml` and `.codex/agents/missing.toml`.',
		validContract,
		validProjectConfig,
	)

	expect(errors.some(error => error.includes('duplicates'))).toBe(true)
	expect(errors).toContain('AGENTS.md: referenced agent file does not exist: .codex/agents/missing.toml')
	expect(errors).toContain('AGENTS.md: project agent is not referenced: .codex/agents/textReview.toml')
})

test('project validation requires exact level-two contract headings', () => {
	const malformedContract = validContract.replace('## Scope', '').replace('## Output', '### Output')
	const errors = validateProjectAgentSources([{ filePath: '.codex/agents/reviewer.toml', source: validAgent('reviewer') }], 'Use `.codex/agents/reviewer.toml`.', malformedContract, validProjectConfig)

	expect(errors).toContain('.codex/review-contract.md: missing ## Scope')
	expect(errors).toContain('.codex/review-contract.md: missing ## Output')
})
