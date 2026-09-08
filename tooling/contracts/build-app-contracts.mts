import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseContractProject } from '../../solidity/ts/contractProjects.ts'
import { copyProjectArtifacts, defaultProjectArtifactPaths } from '../ui/projectArtifacts.mts'

const project = parseContractProject(process.argv[2] ?? '')
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const child = Bun.spawn([process.execPath, './ts/compile.ts', project], { cwd: path.join(repositoryRoot, 'solidity'), stdout: 'inherit', stderr: 'inherit' })
if ((await child.exited) !== 0) process.exit(1)
await copyProjectArtifacts({ project, includeTrading: project === 'trading' }, { ...defaultProjectArtifactPaths, contractArtifactsJsonPath: path.join(repositoryRoot, 'solidity/artifacts', project, 'Contracts.json') })
