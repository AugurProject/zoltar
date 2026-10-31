import path from 'node:path'
import { getUiAppContractProject, parseUiAppIdFromProcess } from '../ui/appPaths.mts'
import { repositoryRoot } from '../repo/root.mts'
import { copyProjectArtifacts } from '../ui/projectArtifacts.mts'

const project = getUiAppContractProject(parseUiAppIdFromProcess('application contract build'))
// Deployment bytecode depends on the full compiler source set. Share the canonical
// compilation cache across apps, then filter only the exported runtime artifacts.
const child = Bun.spawn([process.execPath, './ts/compile.ts'], { cwd: path.join(repositoryRoot, 'solidity'), stdout: 'inherit', stderr: 'inherit' })
if ((await child.exited) !== 0) process.exit(1)
await copyProjectArtifacts({ project, includeTrading: project === 'trading' })
