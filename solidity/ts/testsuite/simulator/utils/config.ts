import { promises as fs } from 'fs'
import * as funtypes from 'funtypes'

type Config = funtypes.Static<typeof Config>
const Config = funtypes.ReadonlyObject({
        testRPCEndpoint: funtypes.String.withConstraint(URL.canParse)
})

const UserConfig = funtypes.Partial(Config.fields)

const defaultConfigLocation = './default-config.json'
const userConfigLocation = './user-config.json'

export const defaultConfig = Config.parse(JSON.parse(await fs.readFile(defaultConfigLocation, 'utf8')))
export const userConfig = (await fileExists(userConfigLocation)) ? UserConfig.parse(JSON.parse(await fs.readFile(userConfigLocation, 'utf8'))) : {}

export function getConfig() {
    return { ...defaultConfig, ...userConfig }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path, fs.constants.F_OK)
        return true
    } catch (error) {
        return false
    }
}