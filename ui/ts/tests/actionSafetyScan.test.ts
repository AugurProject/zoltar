import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { scanActionSafetySources } from '../lib/actionSafetyScan.js'

describe('action safety scan', () => {
	test('rejects missing safety ids and unsafe guard helpers', () => {
		const findings = scanActionSafetySources()
		expect(findings).toEqual([])
	})

	test('catches aliased safety components and purity violations outside actionSafety', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'action-safety-scan-'))
		try {
			await writeTempFile(
				root,
				'ui/tsconfig.json',
				JSON.stringify({
					compilerOptions: {
						allowImportingTsExtensions: true,
						jsx: 'preserve',
						module: 'ESNext',
						moduleResolution: 'bundler',
						noEmit: true,
						strict: true,
						target: 'ES2022',
					},
					include: ['ts/**/*'],
				}),
			)
			await writeTempFile(
				root,
				'ui/ts/jsx.d.ts',
				`declare namespace JSX {
	interface IntrinsicElements {
		[key: string]: any
	}
}
`,
			)
			await writeTempFile(
				root,
				'ui/ts/components/TransactionActionButton.tsx',
				`type TransactionActionButtonProps = {
	idleLabel: string
	onClick: () => void
	pendingLabel: string
	safetyId: string
}

export function TransactionActionButton({ idleLabel, onClick, pendingLabel, safetyId }: TransactionActionButtonProps) {
	return <button data-action-safety-id={safetyId} onClick={onClick} type='button'>{idleLabel}{pendingLabel}</button>
}
`,
			)
			await writeTempFile(
				root,
				'ui/ts/components/AliasedTransactionSurface.tsx',
				`import { TransactionActionButton as TxButton } from './TransactionActionButton.js'

export function AliasedTransactionSurface() {
	return <TxButton safetyId='bad.id' idleLabel='Do it' onClick={() => undefined} pendingLabel='Doing it...' />
}
`,
			)
			await writeTempFile(
				root,
				'ui/ts/lib/demoReadiness.ts',
				`export function getDemoReadinessActions() {
	return readContract()
}

function readContract() {
	return 'network'
}
`,
			)

			const findings = scanActionSafetySources({ configPath: path.join(root, 'ui/tsconfig.json'), repositoryRoot: root })
			expect(findings).toHaveLength(2)
			expect(findings.some(f => f.file === 'ui/ts/components/AliasedTransactionSurface.tsx' && f.message.includes('bad.id'))).toBe(true)
			expect(findings.some(f => f.file === 'ui/ts/lib/demoReadiness.ts' && f.message.includes('readContract'))).toBe(true)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})

async function writeTempFile(root: string, relativePath: string, contents: string) {
	const filePath = path.join(root, relativePath)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, contents)
}
