import { getProtocolConfig as getSharedProtocolConfig, type ProtocolConfigInput } from '@zoltar/shared/deployment/protocolConfig'

export function getProtocolConfig(overrides: ProtocolConfigInput = {}) {
	return getSharedProtocolConfig(overrides)
}
