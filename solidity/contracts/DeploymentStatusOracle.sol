// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

contract DeploymentStatusOracle {
	uint256 private constant DEPLOYMENT_STEP_COUNT = 12;
	address[] private deploymentAddresses;

	constructor(address[] memory _deploymentAddresses) {
		require(_deploymentAddresses.length == DEPLOYMENT_STEP_COUNT, 'unexpected deployment count');
		deploymentAddresses = _deploymentAddresses;
	}

	function getDeploymentMask() external view returns (uint16 deployedMask) {
		for (uint256 index = 0; index < deploymentAddresses.length; ++index) {
			if (deploymentAddresses[index].code.length > 0) {
				deployedMask |= uint16(1 << index);
			}
		}
	}
}
