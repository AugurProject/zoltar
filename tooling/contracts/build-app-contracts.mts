import path from 'node:path'
import { getUiAppContractProject, parseUiAppIdFromProcess } from '../ui/appPaths.mts'
import { repositoryRoot } from '../repo/root.mts'
import { copyProjectArtifacts, defaultProjectArtifactPaths } from '../ui/projectArtifacts.mts'

const project = getUiAppContractProject(parseUiAppIdFromProcess('application contract build'))
const child = Bun.spawn([process.execPath, './ts/compile.ts', project], { cwd: path.join(repositoryRoot, 'solidity'), stdout: 'inherit', stderr: 'inherit' })
if ((await child.exited) !== 0) process.exit(1)
await copyProjectArtifacts({ project, includeTrading: project === 'trading' }, { ...defaultProjectArtifactPaths, contractArtifactsJsonPath: path.join(repositoryRoot, 'solidity/artifacts', project, 'Contracts.json') })
