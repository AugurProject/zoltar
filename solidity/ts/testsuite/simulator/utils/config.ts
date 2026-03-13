import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import * as path from 'path'
import * as funtypes from 'funtypes'

type Config = funtypes.Static<typeof Config>
const Config = funtypes.ReadonlyObject({
	testRPCEndpoint: funtypes.String.withConstraint(URL.canParse)
})

const UserConfig = funtypes.Partial(Config.fields)

// Resolve paths relative to this module's location (ts/testsuite/simulator/utils/)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Go up 4 levels: utils -> simulator -> testsuite -> ts -> (solidity)
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..')

const defaultConfigLocation = path.join(projectRoot, 'default-config.json')
const userConfigLocation = path.join(projectRoot, 'user-config.json')

export const defaultConfig = Config.parse(JSON.parse(await fs.readFile(defaultConfigLocation, 'utf8')))
export const userConfig = (await fileExists(userConfigLocation)) ? UserConfig.parse(JSON.parse(await fs.readFile(userConfigLocation, 'utf8'))) : {}

export function getConfig() {
	return { ...defaultConfig, ...userConfig }
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const stat = await fs.stat(path)
		return stat.isFile()
	} catch {
		return false
	}
}
