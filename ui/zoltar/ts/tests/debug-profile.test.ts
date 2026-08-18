import { describe, test } from 'bun:test'
import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

describe('debug profile', () => {
	test('dump profile', () => {
		console.log('runtime profile id:', getRuntimeNetworkProfile().id)
		console.log('active profile id:', getActiveNetworkProfile().id)
	})
})
