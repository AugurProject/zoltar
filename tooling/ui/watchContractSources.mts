import * as path from 'node:path'
import { isContractProjectSource, type ContractProject } from '../../solidity/ts/contractProjects.ts'

export function isWatchedContractSource(filePath: string, repositoryRootPath: string, project: ContractProject) {
	const sourcePath = path.relative(path.join(repositoryRootPath, 'solidity'), filePath).replaceAll('\\', '/')
	// A rename can report a directory; Statoblast's root also contains neutral infrastructure.
	if (sourcePath === 'contracts/statoblast') return true
	return isContractProjectSource(sourcePath.endsWith('.sol') ? sourcePath : `${sourcePath}/`, project)
}
