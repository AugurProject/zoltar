import { applyExactMutation, classifyMutantResult, MUTATION_SMOKE_CASES } from './mutation-support.mts'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let survived = 0
async function runTest(command: string[], junitPath: string) {
	const child = Bun.spawn({ cmd: [...command.slice(0, 2), '--reporter=junit', `--reporter-outfile=${junitPath}`, ...command.slice(2)], env: process.env, stderr: 'pipe', stdout: 'pipe' })
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
	return { exitCode, stderr, stdout }
}

for (const mutation of MUTATION_SMOKE_CASES) {
	const mutationDirectory = await mkdtemp(join(tmpdir(), 'zoltar-mutation-smoke-'))
	let result: ReturnType<typeof classifyMutantResult>
	try {
		await cp('shared/ts', join(mutationDirectory, 'shared/ts'), { recursive: true })
		const command = mutation.testCommand.map(argument => (argument.startsWith('shared/ts/') ? join(mutationDirectory, argument) : argument))
		const controlJunitPath = join(mutationDirectory, 'control.xml')
		const control = await runTest(command, controlJunitPath)
		const controlJunit = await readFile(controlJunitPath, 'utf8')
		if (control.exitCode !== 0 || !controlJunit.includes('<testcase')) throw new Error(`Mutation control failed before applying ${mutation.name}\n${control.stdout}${control.stderr}`)
		const mutatedFilePath = join(mutationDirectory, mutation.filePath)
		const source = await readFile(mutatedFilePath, 'utf8')
		await writeFile(mutatedFilePath, applyExactMutation(source, mutation))
		const mutantJunitPath = join(mutationDirectory, 'mutant.xml')
		const mutant = await runTest(command, mutantJunitPath)
		const mutantJunit = await readFile(mutantJunitPath, 'utf8')
		process.stdout.write(mutant.stdout)
		process.stderr.write(mutant.stderr)
		result = classifyMutantResult(mutant.exitCode, mutantJunit)
	} finally {
		await rm(mutationDirectory, { recursive: true })
	}
	if (result === 'survived') {
		console.error(`SURVIVED: ${mutation.name}`)
		survived += 1
	} else {
		console.log(`KILLED: ${mutation.name}`)
	}
}

if (survived > 0) {
	console.error(`${survived.toString()} mutation smoke case${survived === 1 ? '' : 's'} survived`)
	process.exit(1)
}
console.log(`Mutation smoke passed: ${MUTATION_SMOKE_CASES.length.toString()} critical mutants killed`)
