import { describe, expect, test } from 'bun:test'
import { createZoltarAddressHelpers } from './deploymentAddresses.js'
import { encodeDeployData, getCreate2Address, toHex, type Address, type Hex } from './ethereum.js'

const PROXY_DEPLOYER_ADDRESS = '0x7a0d94f55792c434d74a40883c6ed8545e406d12' satisfies Address
const ZERO_SALT = toHex(0, { size: 32 })

describe('deployment address helpers', () => {
	test('support deterministic init-code derivation across zero-arg and parameterized constructors', () => {
		const getZoltarQuestionDataInitCode = () =>
			encodeDeployData({
				abi: [],
				bytecode: '0x60006001',
			})
		const getZoltarInitCode = (zoltarQuestionDataAddress: Address): Hex =>
			encodeDeployData({
				abi: [
					{
						inputs: [{ name: 'zoltarQuestionData', type: 'address' }],
						type: 'constructor',
					},
				],
				args: [zoltarQuestionDataAddress],
				bytecode: '0x60006002',
			})
		const { getZoltarAddress, getZoltarQuestionDataAddress } = createZoltarAddressHelpers({
			getZoltarInitCode,
			proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
			zeroSalt: ZERO_SALT,
			zoltarQuestionDataBytecode: getZoltarQuestionDataInitCode,
		})

		const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()

		expect(zoltarQuestionDataAddress).toBe(
			getCreate2Address({
				bytecode: getZoltarQuestionDataInitCode(),
				from: PROXY_DEPLOYER_ADDRESS,
				salt: ZERO_SALT,
			}),
		)
		expect(getZoltarAddress()).toBe(
			getCreate2Address({
				bytecode: getZoltarInitCode(zoltarQuestionDataAddress),
				from: PROXY_DEPLOYER_ADDRESS,
				salt: ZERO_SALT,
			}),
		)
	})
})
