import { fetchDependencyAbis } from './dependency-abis.ts'

const abis = await fetchDependencyAbis()
await Bun.write(new URL('../config/dependency-abis.json', import.meta.url), `${JSON.stringify(abis, undefined, '\t')}\n`)
console.log(`Wrote ${Object.keys(abis).length} dependency ABIs from verified pinned artifacts`)
