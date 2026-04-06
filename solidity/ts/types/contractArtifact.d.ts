export declare const Constants_Constants: {
	readonly abi: readonly []
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea2646970667358221220f5acb46dd3b0a9ab2deedce274fb73d40b7b91dce67a79efa58a89e0c76af71064736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '5f80fdfea2646970667358221220f5acb46dd3b0a9ab2deedce274fb73d40b7b91dce67a79efa58a89e0c76af71064736f6c63430008210033'
		}
	}
}
export declare const Context_Context: {
	readonly abi: readonly []
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const DeploymentStatusOracle_DeploymentStatusOracle: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_deploymentAddresses'
					readonly type: 'address[]'
					readonly internalType: 'address[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getDeploymentMask'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: 'deployedMask'
					readonly type: 'uint16'
					readonly internalType: 'uint16'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080604052346101c1576102bc80380380610019816101c5565b9283398101906020818303126101c1578051906001600160401b0382116101c1570181601f820112156101c1578051906001600160401b038211610148578160051b9260206100698186016101c5565b809481520191602083958201019182116101c157602001915b8183106101a157505050600c81510361015c5751906001600160401b03821161014857680100000000000000008211610148575f54825f5580831061011e575b505f8080527f290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5639291905b8281106101015760405160d190816101eb8239f35b81516001600160a01b0316818501556020909101906001016100ec565b5f8052828060205f20019103905f5b82811061013b5750506100c2565b5f8282015560010161012d565b634e487b7160e01b5f52604160045260245ffd5b60405162461bcd60e51b815260206004820152601b60248201527f756e6578706563746564206465706c6f796d656e7420636f756e7400000000006044820152606490fd5b82516001600160a01b03811681036101c157815260209283019201610082565b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101485760405256fe608060405260043610156010575f80fd5b5f3560e01c63e7767e92146022575f80fd5b346097575f3660031901126097575f8054815b818110156088575f80527f290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5638101546001600160a01b03163b6078575b6001016035565b6001811b61ffff16909217916071565b60208361ffff60405191168152f35b5f80fdfea2646970667358221220fa7df6fd17a6d7f9fd2c9f510631cec4e86d9aa1e64cccb5328e53956b12b6d164736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '608060405260043610156010575f80fd5b5f3560e01c63e7767e92146022575f80fd5b346097575f3660031901126097575f8054815b818110156088575f80527f290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5638101546001600160a01b03163b6078575b6001016035565b6001811b61ffff16909217916071565b60208361ffff60405191168152f35b5f80fdfea2646970667358221220fa7df6fd17a6d7f9fd2c9f510631cec4e86d9aa1e64cccb5328e53956b12b6d164736f6c63430008210033'
		}
	}
}
export declare const ERC20_ERC20: {
	readonly abi: readonly [
		{
			readonly type: 'error'
			readonly name: 'ERC20InsufficientAllowance'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'allowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InsufficientBalance'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidApprover'
			readonly inputs: readonly [
				{
					readonly name: 'approver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidReceiver'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidSender'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidSpender'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'decimals'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'name'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'symbol'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const IERC20_IERC20: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const IERC20Metadata_IERC20Metadata: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'decimals'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'name'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'symbol'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const ReputationToken_ReputationToken: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_zoltar'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InsufficientAllowance'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'allowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InsufficientBalance'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidApprover'
			readonly inputs: readonly [
				{
					readonly name: 'approver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidReceiver'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidSender'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidSpender'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Burn'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Mint'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'burn'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'decimals'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getTotalTheoreticalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'mint'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'name'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'setMaxTheoreticalSupply'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_totalTheoreticalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'symbol'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'zoltar'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60a06040523461035e57610cb86020813803918261001c81610362565b93849283398101031261035e57516001600160a01b038116810361035e576100446040610362565b90600a8252692932b83aba30ba34b7b760b11b60208301526100666040610362565b600381526205245560ec1b602082015282519091906001600160401b03811161026457600354600181811c91168015610354575b602082101461024657601f81116102e6575b506020601f821160011461028357819293945f92610278575b50508160011b915f199060031b1c1916176003555b81516001600160401b03811161026457600454600181811c9116801561025a575b602082101461024657601f81116101d8575b50602092601f821160011461017757928192935f9261016c575b50508160011b915f199060031b1c1916176004555b60805260405161093090816103888239608051818181610121015281816101aa01528181610419015261046a0152f35b015190505f80610127565b601f1982169360045f52805f20915f5b8681106101c057508360019596106101a8575b505050811b0160045561013c565b01515f1960f88460031b161c191690555f808061019a565b91926020600181928685015181550194019201610187565b8181111561010d5760045f52601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b6020841061023e575b81601f9101920160051c03905f5b82811061023157505061010d565b5f82820155600101610223565b5f9150610215565b634e487b7160e01b5f52602260045260245ffd5b90607f16906100fb565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100c5565b601f1982169060035f52805f20915f5b8181106102ce575095836001959697106102b6575b505050811b016003556100da565b01515f1960f88460031b161c191690555f80806102a8565b9192602060018192868b015181550194019201610293565b818111156100ac5760035f52601f820160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b6020841061034c575b81601f9101920160051c03905f5b82811061033f5750506100ac565b5f82820155600101610331565b5f9150610323565b90607f169061009a565b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176102645760405256fe6080806040526004361015610012575f80fd5b5f3560e01c90816306fdde03146106dd57508063095ea7b31461065b57806318160ddd1461063e578063238d35901461062157806323b872dd14610542578063313ce5671461052757806340c10f19146104485780634fffd0371461040457806370a08231146103cd57806395d89b41146102b25780639dc29fac14610188578063a9059cbb14610157578063db9e56d61461010a5763dd62ed3e146100b6575f80fd5b34610106576040366003190112610106576100cf6107d6565b6100d76107ec565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b5f80fd5b346101065760203660031901126101065761014f337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b600435600555005b346101065760403660031901126101065761017d6101736107d6565b6024359033610856565b602060405160018152f35b34610106576040366003190112610106576101a16107d6565b6024356101d8337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b038216801561029f57805f525f60205260405f20548281106102865790825f928284528360205203604083205582600254036002555f5160206108db5f395f51905f526020604051858152a360055491818303928311610272577fcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca59260055561026d6040519283928361083b565b0390a1005b634e487b7160e01b5f52601160045260245ffd5b9063391434e360e21b5f5260045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b34610106575f366003190112610106576040515f6004548060011c906001811680156103c3575b6020831081146103af57828552908115610393575060011461033d575b50819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b0390f35b634e487b7160e01b5f52604160045260245ffd5b60045f9081529091507f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b5b82821061037d575060209150820101826102f6565b6001816020925483858801015201910190610368565b90506020925060ff191682840152151560051b820101826102f6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916102d9565b34610106576020366003190112610106576001600160a01b036103ee6107d6565b165f525f602052602060405f2054604051908152f35b34610106575f366003190112610106576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610106576040366003190112610106576104616107d6565b602435610498337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b0382169182156105145760025492828401809411610272577f0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d412139688593600255805f525f60205260405f208381540190555f5f5160206108db5f395f51905f526020604051868152a361026d6040519283928361083b565b63ec442f0560e01b5f525f60045260245ffd5b34610106575f36600319011261010657602060405160128152f35b346101065760603660031901126101065761055b6107d6565b6105636107ec565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106105a1575b5061017d9350610856565b8381106106065784156105f35733156105e05761017d945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610596565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b34610106575f366003190112610106576020600554604051908152f35b34610106575f366003190112610106576020600254604051908152f35b34610106576040366003190112610106576106746107d6565b6024359033156105f3576001600160a01b03169081156105e057335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b34610106575f366003190112610106575f6003548060011c906001811680156107a2575b6020831081146103af57828552908115610393575060011461074c5750819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b60035f9081529091507fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b5b82821061078c575060209150820101826102f6565b6001816020925483858801015201910190610777565b91607f1691610701565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b038216820361010657565b602435906001600160a01b038216820361010657565b1561080957565b60405162461bcd60e51b815260206004820152600a6024820152692737ba103d37b63a30b960b11b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b6001600160a01b031690811561029f576001600160a01b031691821561051457815f525f60205260405f20548181106108c157815f5160206108db5f395f51905f5292602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffdfeddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa2646970667358221220420aa8bace1227ca57fe868a3cfbcbbf23f5d118a89f33378f3a92ddb10feea464736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f3560e01c90816306fdde03146106dd57508063095ea7b31461065b57806318160ddd1461063e578063238d35901461062157806323b872dd14610542578063313ce5671461052757806340c10f19146104485780634fffd0371461040457806370a08231146103cd57806395d89b41146102b25780639dc29fac14610188578063a9059cbb14610157578063db9e56d61461010a5763dd62ed3e146100b6575f80fd5b34610106576040366003190112610106576100cf6107d6565b6100d76107ec565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b5f80fd5b346101065760203660031901126101065761014f337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b600435600555005b346101065760403660031901126101065761017d6101736107d6565b6024359033610856565b602060405160018152f35b34610106576040366003190112610106576101a16107d6565b6024356101d8337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b038216801561029f57805f525f60205260405f20548281106102865790825f928284528360205203604083205582600254036002555f5160206108db5f395f51905f526020604051858152a360055491818303928311610272577fcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca59260055561026d6040519283928361083b565b0390a1005b634e487b7160e01b5f52601160045260245ffd5b9063391434e360e21b5f5260045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b34610106575f366003190112610106576040515f6004548060011c906001811680156103c3575b6020831081146103af57828552908115610393575060011461033d575b50819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b0390f35b634e487b7160e01b5f52604160045260245ffd5b60045f9081529091507f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b5b82821061037d575060209150820101826102f6565b6001816020925483858801015201910190610368565b90506020925060ff191682840152151560051b820101826102f6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916102d9565b34610106576020366003190112610106576001600160a01b036103ee6107d6565b165f525f602052602060405f2054604051908152f35b34610106575f366003190112610106576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610106576040366003190112610106576104616107d6565b602435610498337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b0382169182156105145760025492828401809411610272577f0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d412139688593600255805f525f60205260405f208381540190555f5f5160206108db5f395f51905f526020604051868152a361026d6040519283928361083b565b63ec442f0560e01b5f525f60045260245ffd5b34610106575f36600319011261010657602060405160128152f35b346101065760603660031901126101065761055b6107d6565b6105636107ec565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106105a1575b5061017d9350610856565b8381106106065784156105f35733156105e05761017d945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610596565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b34610106575f366003190112610106576020600554604051908152f35b34610106575f366003190112610106576020600254604051908152f35b34610106576040366003190112610106576106746107d6565b6024359033156105f3576001600160a01b03169081156105e057335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b34610106575f366003190112610106575f6003548060011c906001811680156107a2575b6020831081146103af57828552908115610393575060011461074c5750819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b60035f9081529091507fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b5b82821061078c575060209150820101826102f6565b6001816020925483858801015201910190610777565b91607f1691610701565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b038216820361010657565b602435906001600160a01b038216820361010657565b1561080957565b60405162461bcd60e51b815260206004820152600a6024820152692737ba103d37b63a30b960b11b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b6001600160a01b031690811561029f576001600160a01b031691821561051457815f525f60205260405f20548181106108c157815f5160206108db5f395f51905f5292602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffdfeddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa2646970667358221220420aa8bace1227ca57fe868a3cfbcbbf23f5d118a89f33378f3a92ddb10feea464736f6c63430008210033'
		}
	}
}
export declare const ScalarOutcomes_ScalarOutcomes: {
	readonly abi: readonly []
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea2646970667358221220bb39dd956dcae73e5eb5b35222d7d903f9f7c3e21eb9d3250f90811c0329994164736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '5f80fdfea2646970667358221220bb39dd956dcae73e5eb5b35222d7d903f9f7c3e21eb9d3250f90811c0329994164736f6c63430008210033'
		}
	}
}
export declare const Zoltar_Zoltar: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_zoltarQuestionData'
					readonly type: 'address'
					readonly internalType: 'contract ZoltarQuestionData'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DeployChild'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'deployer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
					readonly indexed: false
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'childUniverseId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
					readonly indexed: false
				},
				{
					readonly name: 'childReputationToken'
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'UniverseForked'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'forker'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
					readonly indexed: false
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'addRepToMigrationBalance'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'deployChild'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'deployedChildOutcomeIndexes'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'forkUniverse'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'getChildUniverseId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getDeployedChildUniverses'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'count'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'outcomeIndexes'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: 'childUniverseIds'
					readonly type: 'uint248[]'
					readonly internalType: 'uint248[]'
				},
				{
					readonly name: 'childUniverses'
					readonly type: 'tuple[]'
					readonly internalType: 'struct Zoltar.Universe[]'
					readonly components: readonly [
						{
							readonly name: 'forkTime'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'forkQuestionId'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'forkingOutcomeIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'reputationToken'
							readonly type: 'address'
							readonly internalType: 'contract ReputationToken'
						},
						{
							readonly name: 'parentUniverseId'
							readonly type: 'uint248'
							readonly internalType: 'uint248'
						},
					]
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getForkThreshold'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getForkTime'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getMigrationRepBalance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'migrator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'migrationRepBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getRepToken'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'splitMigrationRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'outcomeIndexes'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'universes'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'forkTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'forkQuestionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'forkingOutcomeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'reputationToken'
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
				},
				{
					readonly name: 'parentUniverseId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'zoltarQuestionData'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ZoltarQuestionData'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080604052346101eb57604051601f61233438819003918201601f19168301916001600160401b038311848410176101d7578084926020946040528339810103126101eb57516001600160a01b038116908190036101eb57600380546001600160a01b03191691909117905560405160a081016001600160401b038111828210176101d75760409081525f808352602080840182815284840183815273221657776846890989a759ba2973e427dff5c9bb60608701908152608087018581528580529490935294517fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb555517fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb65592517fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb75591517fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb880546001600160a01b0319166001600160a01b039290921691909117905590517fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb980547fff00000000000000000000000000000000000000000000000000000000000000166001600160f81b03929092169190911790555161214490816101f08239f35b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe6080806040526004361015610012575f80fd5b5f3560e01c90816311f511d414610b5257508063513a4edd14610adf57806358955ef014610a7d57806373afd7b014610a585780638089a4c614610a2d57806387ca99af146109ae578063994e47ee14610975578063a553cf581461091d578063a8ad82501461089e578063b01fea3e1461056d578063c6b118c7146102aa578063d8b7e3fe146101dc5763ddfeb3e5146100ab575f80fd5b346101d85760603660031901126101d8576100d46100c7610b75565b60443590602435906110ba565b604092919251928392606084016060855281518091526020608086019201905f5b8181106101bf575050508381036020850152602080835192838152019201905f5b81811061019d575050508281036040840152602080835192838152019201905f5b818110610145575050500390f35b82518051855260208181015181870152604080830151908701526060808301516001600160a01b0316908701526080918201516001600160f81b03169186019190915286955060a09094019390920191600101610137565b82516001600160f81b0316845286955060209384019390920191600101610116565b82518452879650602093840193909201916001016100f5565b5f80fd5b346101d85760403660031901126101d8576101f5610b75565b6024359060018060f81b0381165f525f60205261027d8260405f2061026c60405161021f81610bb4565b8254808252600184015460208301526002840154604083015260038401546001600160a01b0316606083019081526004909401546001600160f81b03166080909201919091521515610c1d565b5133906001600160a01b0316611329565b335f52600260205260405f209060018060f81b03165f526020526102a660405f20918254611067565b9055005b346101d85760403660031901126101d8576102c3610b75565b6024359060018060f81b038116805f525f60205260405f206040516102e781610bb4565b8154808252600183015460208301526002830154604083015260038301546001600160a01b031660608301526004909201546001600160f81b031660809091015261052a57600354604051636836951360e01b8152600481018590526001600160a01b0390911690602081602481855afa9081156104ae575f916104f8575b50156104b957602060249160405192838092630258f95360e31b82528860048301525afa9081156104ae575f9161047c575b50421061043e575f8181526020819052604090204281556001018390557f592dac1bb1820996e1692d0b5f692bbf09cae6667a9a30d62967fd5798106f0092606092610413906103e790610f4d565b835f525f6020526104098160018060a01b03600360405f200154163390611329565b6005810490611046565b335f52600260205260405f20835f5260205260405f20556040519133835260208301526040820152a1005b60405162461bcd60e51b8152602060048201526016602482015275145d595cdd1a5bdb881a185cc81b9bdd08195b99195960521b6044820152606490fd5b90506020813d6020116104a6575b8161049760209383610be3565b810103126101d8575184610398565b3d915061048a565b6040513d5f823e3d90fd5b60405162461bcd60e51b8152602060048201526017602482015276145d595cdd1a5bdb88191bd95cc81b9bdd08195e1a5cdd604a1b6044820152606490fd5b90506020813d602011610522575b8161051360209383610be3565b810103126101d8575185610366565b3d9150610506565b60405162461bcd60e51b815260206004820152601b60248201527a556e6976657273652068617320666f726b656420616c726561647960281b6044820152606490fd5b346101d85760603660031901126101d857610586610b75565b60243590604435906001600160401b0382116101d857366023830112156101d8578160040135916105b683610c06565b926105c46040519485610be3565b8084526024602085019160051b830101913683116101d857602401905b82821061088e5750505060018060f81b038116805f525f60205261065660405f2060405161060e81610bb4565b8154808252600183015460208301526002830154604083015260038301546001600160a01b031660608301526004909201546001600160f81b03166080909101521515610c1d565b805f525f602052600160405f200154915f5b845181101561088c5761067b81866110a6565b516003546040516314eb1bf360e11b8152600481018790526024810183905290602090829060449082906001600160a01b03165afa9081156104ae575f9161085e575b5061082d576001600160f81b036106d5828561100f565b1690815f525f60205260018060a01b03600360405f200154161561081d575b50335f52600260205260405f20845f52602052600160405f20825f520160205260405f20610723888254611067565b9055335f908152600260209081526040808320878452808352818420858552600181018452918420549388905290915254106107c6575f908152602081905260409020600301546001600160a01b031690813b156101d8575f60405180936340c10f1960e01b825281838161079c8d336004840161130e565b03925af19182156104ae576001926107b6575b5001610668565b5f6107c091610be3565b876107af565b60405162461bcd60e51b815260206004820152602960248201527f63616e6e6f74206d696772617465206d6f7265207468616e20696e7465726e616044820152686c2062616c616e636560b81b6064820152608490fd5b6108279084610c63565b876106f4565b60405162461bcd60e51b815260206004820152600960248201526813585b199bdc9b595960ba1b6044820152606490fd5b61087f915060203d8111610885575b6108778183610be3565b8101906112f6565b886106be565b503d61086d565b005b81358152602091820191016105e1565b346101d85760203660031901126101d8576001600160f81b036108bf610b75565b165f525f602052602060405f206040516108d881610bb4565b8154815260018201548382015260028201546040820152608060018060a01b0360038401541692836060840152600460018060f81b0391015416910152604051908152f35b346101d85760403660031901126101d857610936610b75565b6001600160f81b03165f908152600160205260409020805460243591908210156101d85760209161096691610b8b565b90549060031b1c604051908152f35b346101d85760403660031901126101d857602061099c610993610b75565b6024359061100f565b6040516001600160f81b039091168152f35b346101d85760203660031901126101d8576001600160f81b036109cf610b75565b165f525f602052602060405f206040516109e881610bb4565b60808254928383526001810154858401526002810154604084015260018060a01b036003820154166060840152600460018060f81b0391015416910152604051908152f35b346101d85760203660031901126101d8576020610a50610a4b610b75565b610f4d565b604051908152f35b346101d85760403660031901126101d85761088c610a74610b75565b60243590610c63565b346101d85760403660031901126101d8576004356001600160a01b038116908190036101d857602435906001600160f81b03821682036101d8575f52600260205260405f209060018060f81b03165f52602052602060405f2054604051908152f35b346101d85760203660031901126101d8576001600160f81b03610b00610b75565b165f525f60205260a060405f208054906001810154906002810154600180861b0360038301541691600460018060f81b0391015416926040519485526020850152604084015260608301526080820152f35b346101d8575f3660031901126101d8576003546001600160a01b03168152602090f35b600435906001600160f81b03821682036101d857565b8054821015610ba0575f5260205f2001905f90565b634e487b7160e01b5f52603260045260245ffd5b60a081019081106001600160401b03821117610bcf57604052565b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b03821190821017610bcf57604052565b6001600160401b038111610bcf5760051b60200190565b15610c2457565b60405162461bcd60e51b8152602060048201526017602482015276155b9a5d995c9cd9481a185cc81b9bdd08199bdc9ad959604a1b6044820152606490fd5b5f9060018060f81b03811692835f525f60205260405f209260405192610c8884610bb4565b84548085526001860154602086019081526002870154604087015260038701546001600160a01b0316606087019081526004909701546001600160f81b0316608090960195909552610cdb901515610c1d565b6001600160f81b0390610cef90849061100f565b1692835f525f60205260018060a01b03600360405f20015416610f0857604051610cb8908181016001600160401b03811182821017610bcf5781602091889461145783393081520301905ff580156104ae579451604051630238d35960e41b81526001600160a01b0396871696909160209183916004918391165afa9081156104ae575f91610ed6575b50853b156101d85760405190636dcf2b6b60e11b825260048201525f81602481838a5af180156104ae57610ec1575b50516004604051610db881610bb4565b8381526020810192835260408101858152606082019088825260808301948a8652888752866020526040872093518455516001840155516002830155600382019060018060a01b0390511660018060a01b0319825416179055019060018060f81b0390511660ff60f81b825416179055848152600160205260408120805491600160401b831015610ead575091610e7b8260a0969460017f01f81928675a1438b22fa2c26e2f32761fabde400ea464465ba6e3cb253f8dfd999795018155610b8b565b81549060031b9083821b915f19901b1916179055604051933385526020850152604084015260608301526080820152a1565b634e487b7160e01b81526041600452602490fd5b610ece9192505f90610be3565b5f905f610da8565b90506020813d602011610f00575b81610ef160209383610be3565b810103126101d857515f610d79565b3d9150610ee4565b60405162461bcd60e51b815260206004820152601f60248201527f4368696c6420756e69766572736520616c7265616479206465706c6f796564006044820152606490fd5b60018060f81b03165f525f6020526004602060405f20604051610f6f81610bb4565b81548152600182015483820152600282015460408083019190915260038301546001600160a01b031660608301819052928501546001600160f81b031660809092019190915251630238d35960e41b815292839182905afa80156104ae575f90610fdc575b601491500490565b506020813d602011611007575b81610ff660209383610be3565b810103126101d85760149051610fd4565b3d9150610fe9565b60405191602083019160018060f81b03168252604083015260408252611036606083610be3565b905190206001600160f81b031690565b9190820391821161105357565b634e487b7160e01b5f52601160045260245ffd5b9190820180921161105357565b9061107e82610c06565b61108b6040519182610be3565b828152809261109c601f1991610c06565b0190602036910137565b8051821015610ba05760209160051b010190565b6001600160f81b0381165f9081526001602052604090209390926110de8184611067565b9085548092115f146112e657505b8281111561125a576110fe8382611046565b61110781611074565b9561111182611074565b9561111b83610c06565b926111296040519485610be3565b808452611138601f1991610c06565b015f5b818110611225575050829587815b8a87821061115b575050505050505050565b81866111b061119760019661121c956111aa8b61119d61117b8d8a611046565b988996879361118a838c610b8b565b90549060031b1c9061100f565b98610b8b565b90549060031b1c926110a6565b526110a6565b90858060f81b03168091525f525f60205260405f20604051906111d282610bb4565b8054825285810154602083015260028101546040830152858060a01b0360038201541660608301526004868060f81b03910154166080820152611215828a6110a6565b52876110a6565b50018890611149565b60209060405161123481610bb4565b5f81525f838201525f60408201525f60608201525f60808201528282880101520161113b565b509250505060206040519161126f8284610be3565b5f83525f368137604051926112848385610be3565b5f84525f368137604051926112998185610be3565b5f8452601f1981015f5b8181106112b257505050929190565b82906040516112c081610bb4565b5f81525f838201525f60408201525f60608201525f6080820152828289010152016112a3565b6112f1915083611067565b6110ec565b908160209103126101d8575180151581036101d85790565b6001600160a01b039091168152602081019190915260400190565b6001600160a01b0316919073221657776846890989a759ba2973e427dff5c9bb830361140e576001600160a01b03163081036113c257505f916044602092604051948593849263a9059cbb60e01b845273deadbeefdeadbeefdeadbeefdeadbeefdeadbeef600485015260248401525af180156104ae576113a75750565b6113bf9060203d602011610885576108778183610be3565b50565b9060646020925f60405195869485936323b872dd60e01b8552600485015273deadbeefdeadbeefdeadbeefdeadbeefdeadbeef602485015260448401525af180156104ae576113a75750565b90823b156101d857611439925f9283604051809681958294632770a7eb60e21b84526004840161130e565b03925af180156104ae5761144a5750565b5f61145491610be3565b56fe60a06040523461035e57610cb86020813803918261001c81610362565b93849283398101031261035e57516001600160a01b038116810361035e576100446040610362565b90600a8252692932b83aba30ba34b7b760b11b60208301526100666040610362565b600381526205245560ec1b602082015282519091906001600160401b03811161026457600354600181811c91168015610354575b602082101461024657601f81116102e6575b506020601f821160011461028357819293945f92610278575b50508160011b915f199060031b1c1916176003555b81516001600160401b03811161026457600454600181811c9116801561025a575b602082101461024657601f81116101d8575b50602092601f821160011461017757928192935f9261016c575b50508160011b915f199060031b1c1916176004555b60805260405161093090816103888239608051818181610121015281816101aa01528181610419015261046a0152f35b015190505f80610127565b601f1982169360045f52805f20915f5b8681106101c057508360019596106101a8575b505050811b0160045561013c565b01515f1960f88460031b161c191690555f808061019a565b91926020600181928685015181550194019201610187565b8181111561010d5760045f52601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b6020841061023e575b81601f9101920160051c03905f5b82811061023157505061010d565b5f82820155600101610223565b5f9150610215565b634e487b7160e01b5f52602260045260245ffd5b90607f16906100fb565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100c5565b601f1982169060035f52805f20915f5b8181106102ce575095836001959697106102b6575b505050811b016003556100da565b01515f1960f88460031b161c191690555f80806102a8565b9192602060018192868b015181550194019201610293565b818111156100ac5760035f52601f820160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b6020841061034c575b81601f9101920160051c03905f5b82811061033f5750506100ac565b5f82820155600101610331565b5f9150610323565b90607f169061009a565b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176102645760405256fe6080806040526004361015610012575f80fd5b5f3560e01c90816306fdde03146106dd57508063095ea7b31461065b57806318160ddd1461063e578063238d35901461062157806323b872dd14610542578063313ce5671461052757806340c10f19146104485780634fffd0371461040457806370a08231146103cd57806395d89b41146102b25780639dc29fac14610188578063a9059cbb14610157578063db9e56d61461010a5763dd62ed3e146100b6575f80fd5b34610106576040366003190112610106576100cf6107d6565b6100d76107ec565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b5f80fd5b346101065760203660031901126101065761014f337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b600435600555005b346101065760403660031901126101065761017d6101736107d6565b6024359033610856565b602060405160018152f35b34610106576040366003190112610106576101a16107d6565b6024356101d8337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b038216801561029f57805f525f60205260405f20548281106102865790825f928284528360205203604083205582600254036002555f5160206108db5f395f51905f526020604051858152a360055491818303928311610272577fcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca59260055561026d6040519283928361083b565b0390a1005b634e487b7160e01b5f52601160045260245ffd5b9063391434e360e21b5f5260045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b34610106575f366003190112610106576040515f6004548060011c906001811680156103c3575b6020831081146103af57828552908115610393575060011461033d575b50819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b0390f35b634e487b7160e01b5f52604160045260245ffd5b60045f9081529091507f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b5b82821061037d575060209150820101826102f6565b6001816020925483858801015201910190610368565b90506020925060ff191682840152151560051b820101826102f6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916102d9565b34610106576020366003190112610106576001600160a01b036103ee6107d6565b165f525f602052602060405f2054604051908152f35b34610106575f366003190112610106576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610106576040366003190112610106576104616107d6565b602435610498337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b0382169182156105145760025492828401809411610272577f0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d412139688593600255805f525f60205260405f208381540190555f5f5160206108db5f395f51905f526020604051868152a361026d6040519283928361083b565b63ec442f0560e01b5f525f60045260245ffd5b34610106575f36600319011261010657602060405160128152f35b346101065760603660031901126101065761055b6107d6565b6105636107ec565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106105a1575b5061017d9350610856565b8381106106065784156105f35733156105e05761017d945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610596565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b34610106575f366003190112610106576020600554604051908152f35b34610106575f366003190112610106576020600254604051908152f35b34610106576040366003190112610106576106746107d6565b6024359033156105f3576001600160a01b03169081156105e057335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b34610106575f366003190112610106575f6003548060011c906001811680156107a2575b6020831081146103af57828552908115610393575060011461074c5750819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b60035f9081529091507fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b5b82821061078c575060209150820101826102f6565b6001816020925483858801015201910190610777565b91607f1691610701565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b038216820361010657565b602435906001600160a01b038216820361010657565b1561080957565b60405162461bcd60e51b815260206004820152600a6024820152692737ba103d37b63a30b960b11b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b6001600160a01b031690811561029f576001600160a01b031691821561051457815f525f60205260405f20548181106108c157815f5160206108db5f395f51905f5292602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffdfeddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa2646970667358221220420aa8bace1227ca57fe868a3cfbcbbf23f5d118a89f33378f3a92ddb10feea464736f6c63430008210033a26469706673582212208e41115b77344d17717becbc3c3354997ff807f0f8c23bef2910d1c56faf45ca64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f3560e01c90816311f511d414610b5257508063513a4edd14610adf57806358955ef014610a7d57806373afd7b014610a585780638089a4c614610a2d57806387ca99af146109ae578063994e47ee14610975578063a553cf581461091d578063a8ad82501461089e578063b01fea3e1461056d578063c6b118c7146102aa578063d8b7e3fe146101dc5763ddfeb3e5146100ab575f80fd5b346101d85760603660031901126101d8576100d46100c7610b75565b60443590602435906110ba565b604092919251928392606084016060855281518091526020608086019201905f5b8181106101bf575050508381036020850152602080835192838152019201905f5b81811061019d575050508281036040840152602080835192838152019201905f5b818110610145575050500390f35b82518051855260208181015181870152604080830151908701526060808301516001600160a01b0316908701526080918201516001600160f81b03169186019190915286955060a09094019390920191600101610137565b82516001600160f81b0316845286955060209384019390920191600101610116565b82518452879650602093840193909201916001016100f5565b5f80fd5b346101d85760403660031901126101d8576101f5610b75565b6024359060018060f81b0381165f525f60205261027d8260405f2061026c60405161021f81610bb4565b8254808252600184015460208301526002840154604083015260038401546001600160a01b0316606083019081526004909401546001600160f81b03166080909201919091521515610c1d565b5133906001600160a01b0316611329565b335f52600260205260405f209060018060f81b03165f526020526102a660405f20918254611067565b9055005b346101d85760403660031901126101d8576102c3610b75565b6024359060018060f81b038116805f525f60205260405f206040516102e781610bb4565b8154808252600183015460208301526002830154604083015260038301546001600160a01b031660608301526004909201546001600160f81b031660809091015261052a57600354604051636836951360e01b8152600481018590526001600160a01b0390911690602081602481855afa9081156104ae575f916104f8575b50156104b957602060249160405192838092630258f95360e31b82528860048301525afa9081156104ae575f9161047c575b50421061043e575f8181526020819052604090204281556001018390557f592dac1bb1820996e1692d0b5f692bbf09cae6667a9a30d62967fd5798106f0092606092610413906103e790610f4d565b835f525f6020526104098160018060a01b03600360405f200154163390611329565b6005810490611046565b335f52600260205260405f20835f5260205260405f20556040519133835260208301526040820152a1005b60405162461bcd60e51b8152602060048201526016602482015275145d595cdd1a5bdb881a185cc81b9bdd08195b99195960521b6044820152606490fd5b90506020813d6020116104a6575b8161049760209383610be3565b810103126101d8575184610398565b3d915061048a565b6040513d5f823e3d90fd5b60405162461bcd60e51b8152602060048201526017602482015276145d595cdd1a5bdb88191bd95cc81b9bdd08195e1a5cdd604a1b6044820152606490fd5b90506020813d602011610522575b8161051360209383610be3565b810103126101d8575185610366565b3d9150610506565b60405162461bcd60e51b815260206004820152601b60248201527a556e6976657273652068617320666f726b656420616c726561647960281b6044820152606490fd5b346101d85760603660031901126101d857610586610b75565b60243590604435906001600160401b0382116101d857366023830112156101d8578160040135916105b683610c06565b926105c46040519485610be3565b8084526024602085019160051b830101913683116101d857602401905b82821061088e5750505060018060f81b038116805f525f60205261065660405f2060405161060e81610bb4565b8154808252600183015460208301526002830154604083015260038301546001600160a01b031660608301526004909201546001600160f81b03166080909101521515610c1d565b805f525f602052600160405f200154915f5b845181101561088c5761067b81866110a6565b516003546040516314eb1bf360e11b8152600481018790526024810183905290602090829060449082906001600160a01b03165afa9081156104ae575f9161085e575b5061082d576001600160f81b036106d5828561100f565b1690815f525f60205260018060a01b03600360405f200154161561081d575b50335f52600260205260405f20845f52602052600160405f20825f520160205260405f20610723888254611067565b9055335f908152600260209081526040808320878452808352818420858552600181018452918420549388905290915254106107c6575f908152602081905260409020600301546001600160a01b031690813b156101d8575f60405180936340c10f1960e01b825281838161079c8d336004840161130e565b03925af19182156104ae576001926107b6575b5001610668565b5f6107c091610be3565b876107af565b60405162461bcd60e51b815260206004820152602960248201527f63616e6e6f74206d696772617465206d6f7265207468616e20696e7465726e616044820152686c2062616c616e636560b81b6064820152608490fd5b6108279084610c63565b876106f4565b60405162461bcd60e51b815260206004820152600960248201526813585b199bdc9b595960ba1b6044820152606490fd5b61087f915060203d8111610885575b6108778183610be3565b8101906112f6565b886106be565b503d61086d565b005b81358152602091820191016105e1565b346101d85760203660031901126101d8576001600160f81b036108bf610b75565b165f525f602052602060405f206040516108d881610bb4565b8154815260018201548382015260028201546040820152608060018060a01b0360038401541692836060840152600460018060f81b0391015416910152604051908152f35b346101d85760403660031901126101d857610936610b75565b6001600160f81b03165f908152600160205260409020805460243591908210156101d85760209161096691610b8b565b90549060031b1c604051908152f35b346101d85760403660031901126101d857602061099c610993610b75565b6024359061100f565b6040516001600160f81b039091168152f35b346101d85760203660031901126101d8576001600160f81b036109cf610b75565b165f525f602052602060405f206040516109e881610bb4565b60808254928383526001810154858401526002810154604084015260018060a01b036003820154166060840152600460018060f81b0391015416910152604051908152f35b346101d85760203660031901126101d8576020610a50610a4b610b75565b610f4d565b604051908152f35b346101d85760403660031901126101d85761088c610a74610b75565b60243590610c63565b346101d85760403660031901126101d8576004356001600160a01b038116908190036101d857602435906001600160f81b03821682036101d8575f52600260205260405f209060018060f81b03165f52602052602060405f2054604051908152f35b346101d85760203660031901126101d8576001600160f81b03610b00610b75565b165f525f60205260a060405f208054906001810154906002810154600180861b0360038301541691600460018060f81b0391015416926040519485526020850152604084015260608301526080820152f35b346101d8575f3660031901126101d8576003546001600160a01b03168152602090f35b600435906001600160f81b03821682036101d857565b8054821015610ba0575f5260205f2001905f90565b634e487b7160e01b5f52603260045260245ffd5b60a081019081106001600160401b03821117610bcf57604052565b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b03821190821017610bcf57604052565b6001600160401b038111610bcf5760051b60200190565b15610c2457565b60405162461bcd60e51b8152602060048201526017602482015276155b9a5d995c9cd9481a185cc81b9bdd08199bdc9ad959604a1b6044820152606490fd5b5f9060018060f81b03811692835f525f60205260405f209260405192610c8884610bb4565b84548085526001860154602086019081526002870154604087015260038701546001600160a01b0316606087019081526004909701546001600160f81b0316608090960195909552610cdb901515610c1d565b6001600160f81b0390610cef90849061100f565b1692835f525f60205260018060a01b03600360405f20015416610f0857604051610cb8908181016001600160401b03811182821017610bcf5781602091889461145783393081520301905ff580156104ae579451604051630238d35960e41b81526001600160a01b0396871696909160209183916004918391165afa9081156104ae575f91610ed6575b50853b156101d85760405190636dcf2b6b60e11b825260048201525f81602481838a5af180156104ae57610ec1575b50516004604051610db881610bb4565b8381526020810192835260408101858152606082019088825260808301948a8652888752866020526040872093518455516001840155516002830155600382019060018060a01b0390511660018060a01b0319825416179055019060018060f81b0390511660ff60f81b825416179055848152600160205260408120805491600160401b831015610ead575091610e7b8260a0969460017f01f81928675a1438b22fa2c26e2f32761fabde400ea464465ba6e3cb253f8dfd999795018155610b8b565b81549060031b9083821b915f19901b1916179055604051933385526020850152604084015260608301526080820152a1565b634e487b7160e01b81526041600452602490fd5b610ece9192505f90610be3565b5f905f610da8565b90506020813d602011610f00575b81610ef160209383610be3565b810103126101d857515f610d79565b3d9150610ee4565b60405162461bcd60e51b815260206004820152601f60248201527f4368696c6420756e69766572736520616c7265616479206465706c6f796564006044820152606490fd5b60018060f81b03165f525f6020526004602060405f20604051610f6f81610bb4565b81548152600182015483820152600282015460408083019190915260038301546001600160a01b031660608301819052928501546001600160f81b031660809092019190915251630238d35960e41b815292839182905afa80156104ae575f90610fdc575b601491500490565b506020813d602011611007575b81610ff660209383610be3565b810103126101d85760149051610fd4565b3d9150610fe9565b60405191602083019160018060f81b03168252604083015260408252611036606083610be3565b905190206001600160f81b031690565b9190820391821161105357565b634e487b7160e01b5f52601160045260245ffd5b9190820180921161105357565b9061107e82610c06565b61108b6040519182610be3565b828152809261109c601f1991610c06565b0190602036910137565b8051821015610ba05760209160051b010190565b6001600160f81b0381165f9081526001602052604090209390926110de8184611067565b9085548092115f146112e657505b8281111561125a576110fe8382611046565b61110781611074565b9561111182611074565b9561111b83610c06565b926111296040519485610be3565b808452611138601f1991610c06565b015f5b818110611225575050829587815b8a87821061115b575050505050505050565b81866111b061119760019661121c956111aa8b61119d61117b8d8a611046565b988996879361118a838c610b8b565b90549060031b1c9061100f565b98610b8b565b90549060031b1c926110a6565b526110a6565b90858060f81b03168091525f525f60205260405f20604051906111d282610bb4565b8054825285810154602083015260028101546040830152858060a01b0360038201541660608301526004868060f81b03910154166080820152611215828a6110a6565b52876110a6565b50018890611149565b60209060405161123481610bb4565b5f81525f838201525f60408201525f60608201525f60808201528282880101520161113b565b509250505060206040519161126f8284610be3565b5f83525f368137604051926112848385610be3565b5f84525f368137604051926112998185610be3565b5f8452601f1981015f5b8181106112b257505050929190565b82906040516112c081610bb4565b5f81525f838201525f60408201525f60608201525f6080820152828289010152016112a3565b6112f1915083611067565b6110ec565b908160209103126101d8575180151581036101d85790565b6001600160a01b039091168152602081019190915260400190565b6001600160a01b0316919073221657776846890989a759ba2973e427dff5c9bb830361140e576001600160a01b03163081036113c257505f916044602092604051948593849263a9059cbb60e01b845273deadbeefdeadbeefdeadbeefdeadbeefdeadbeef600485015260248401525af180156104ae576113a75750565b6113bf9060203d602011610885576108778183610be3565b50565b9060646020925f60405195869485936323b872dd60e01b8552600485015273deadbeefdeadbeefdeadbeefdeadbeefdeadbeef602485015260448401525af180156104ae576113a75750565b90823b156101d857611439925f9283604051809681958294632770a7eb60e21b84526004840161130e565b03925af180156104ae5761144a5750565b5f61145491610be3565b56fe60a06040523461035e57610cb86020813803918261001c81610362565b93849283398101031261035e57516001600160a01b038116810361035e576100446040610362565b90600a8252692932b83aba30ba34b7b760b11b60208301526100666040610362565b600381526205245560ec1b602082015282519091906001600160401b03811161026457600354600181811c91168015610354575b602082101461024657601f81116102e6575b506020601f821160011461028357819293945f92610278575b50508160011b915f199060031b1c1916176003555b81516001600160401b03811161026457600454600181811c9116801561025a575b602082101461024657601f81116101d8575b50602092601f821160011461017757928192935f9261016c575b50508160011b915f199060031b1c1916176004555b60805260405161093090816103888239608051818181610121015281816101aa01528181610419015261046a0152f35b015190505f80610127565b601f1982169360045f52805f20915f5b8681106101c057508360019596106101a8575b505050811b0160045561013c565b01515f1960f88460031b161c191690555f808061019a565b91926020600181928685015181550194019201610187565b8181111561010d5760045f52601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b6020841061023e575b81601f9101920160051c03905f5b82811061023157505061010d565b5f82820155600101610223565b5f9150610215565b634e487b7160e01b5f52602260045260245ffd5b90607f16906100fb565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100c5565b601f1982169060035f52805f20915f5b8181106102ce575095836001959697106102b6575b505050811b016003556100da565b01515f1960f88460031b161c191690555f80806102a8565b9192602060018192868b015181550194019201610293565b818111156100ac5760035f52601f820160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b6020841061034c575b81601f9101920160051c03905f5b82811061033f5750506100ac565b5f82820155600101610331565b5f9150610323565b90607f169061009a565b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176102645760405256fe6080806040526004361015610012575f80fd5b5f3560e01c90816306fdde03146106dd57508063095ea7b31461065b57806318160ddd1461063e578063238d35901461062157806323b872dd14610542578063313ce5671461052757806340c10f19146104485780634fffd0371461040457806370a08231146103cd57806395d89b41146102b25780639dc29fac14610188578063a9059cbb14610157578063db9e56d61461010a5763dd62ed3e146100b6575f80fd5b34610106576040366003190112610106576100cf6107d6565b6100d76107ec565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b5f80fd5b346101065760203660031901126101065761014f337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b600435600555005b346101065760403660031901126101065761017d6101736107d6565b6024359033610856565b602060405160018152f35b34610106576040366003190112610106576101a16107d6565b6024356101d8337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b038216801561029f57805f525f60205260405f20548281106102865790825f928284528360205203604083205582600254036002555f5160206108db5f395f51905f526020604051858152a360055491818303928311610272577fcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca59260055561026d6040519283928361083b565b0390a1005b634e487b7160e01b5f52601160045260245ffd5b9063391434e360e21b5f5260045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b34610106575f366003190112610106576040515f6004548060011c906001811680156103c3575b6020831081146103af57828552908115610393575060011461033d575b50819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b0390f35b634e487b7160e01b5f52604160045260245ffd5b60045f9081529091507f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b5b82821061037d575060209150820101826102f6565b6001816020925483858801015201910190610368565b90506020925060ff191682840152151560051b820101826102f6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916102d9565b34610106576020366003190112610106576001600160a01b036103ee6107d6565b165f525f602052602060405f2054604051908152f35b34610106575f366003190112610106576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610106576040366003190112610106576104616107d6565b602435610498337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610802565b6001600160a01b0382169182156105145760025492828401809411610272577f0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d412139688593600255805f525f60205260405f208381540190555f5f5160206108db5f395f51905f526020604051868152a361026d6040519283928361083b565b63ec442f0560e01b5f525f60045260245ffd5b34610106575f36600319011261010657602060405160128152f35b346101065760603660031901126101065761055b6107d6565b6105636107ec565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106105a1575b5061017d9350610856565b8381106106065784156105f35733156105e05761017d945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610596565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b34610106575f366003190112610106576020600554604051908152f35b34610106575f366003190112610106576020600254604051908152f35b34610106576040366003190112610106576106746107d6565b6024359033156105f3576001600160a01b03169081156105e057335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b34610106575f366003190112610106575f6003548060011c906001811680156107a2575b6020831081146103af57828552908115610393575060011461074c5750819003601f01601f19168101906001600160401b0382118183101761032957610325829182604052826107ac565b60035f9081529091507fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b5b82821061078c575060209150820101826102f6565b6001816020925483858801015201910190610777565b91607f1691610701565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b038216820361010657565b602435906001600160a01b038216820361010657565b1561080957565b60405162461bcd60e51b815260206004820152600a6024820152692737ba103d37b63a30b960b11b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b6001600160a01b031690811561029f576001600160a01b031691821561051457815f525f60205260405f20548181106108c157815f5160206108db5f395f51905f5292602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffdfeddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa2646970667358221220420aa8bace1227ca57fe868a3cfbcbbf23f5d118a89f33378f3a92ddb10feea464736f6c63430008210033a26469706673582212208e41115b77344d17717becbc3c3354997ff807f0f8c23bef2910d1c56faf45ca64736f6c63430008210033'
		}
	}
}
export declare const ZoltarQuestionData_ZoltarQuestionData: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'createQuestion'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'questionData'
					readonly type: 'tuple'
					readonly internalType: 'struct ZoltarQuestionData.QuestionData'
					readonly components: readonly [
						{
							readonly name: 'title'
							readonly type: 'string'
							readonly internalType: 'string'
						},
						{
							readonly name: 'description'
							readonly type: 'string'
							readonly internalType: 'string'
						},
						{
							readonly name: 'startTime'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'endTime'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'numTicks'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'displayValueMin'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'displayValueMax'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'answerUnit'
							readonly type: 'string'
							readonly internalType: 'string'
						},
					]
				},
				{
					readonly name: 'outcomeOptions'
					readonly type: 'string[]'
					readonly internalType: 'string[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getAnswerOptionName'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'answer'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getOutcomeLabels'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'numberOfEntries'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'returnOutcomeLabels'
					readonly type: 'string[]'
					readonly internalType: 'string[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestionCount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestionEndDate'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestionId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'questionData'
					readonly type: 'tuple'
					readonly internalType: 'struct ZoltarQuestionData.QuestionData'
					readonly components: readonly [
						{
							readonly name: 'title'
							readonly type: 'string'
							readonly internalType: 'string'
						},
						{
							readonly name: 'description'
							readonly type: 'string'
							readonly internalType: 'string'
						},
						{
							readonly name: 'startTime'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'endTime'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'numTicks'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'displayValueMin'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'displayValueMax'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'answerUnit'
							readonly type: 'string'
							readonly internalType: 'string'
						},
					]
				},
				{
					readonly name: 'outcomeOptions'
					readonly type: 'string[]'
					readonly internalType: 'string[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestions'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'numberOfEntries'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'returnQuestionIds'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isMalformedAnswerOption'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'answer'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'outcomeLabels'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionCreatedTimestamp'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionIds'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionIndexPlusOne'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questions'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'title'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: 'description'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: 'startTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'numTicks'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'displayValueMin'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
				{
					readonly name: 'displayValueMax'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
				{
					readonly name: 'answerUnit'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'splitUint256IntoTwoWithInvalid'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'invalid'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'firstPart'
					readonly type: 'uint120'
					readonly internalType: 'uint120'
				},
				{
					readonly name: 'secondPart'
					readonly type: 'uint120'
					readonly internalType: 'uint120'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60808060405234601557611a18908161001a8239f35b5f80fdfe6080806040526004361015610012575f80fd5b5f3560e01c90816312c7ca9814610bec575080631dec983014610bcb57806329d637e614610ba857806331b1b97814610af7578063348fed1b14610acd578063491aa41214610a7d5780636836951314610a54578063705b5c9c146103b4578063956bf1ae14610263578063ac9087c014610231578063dd41cc2f14610214578063efcb6931146101d5578063f03477831461019d5763fd1df035146100b6575f80fd5b34610199576100c436610dcd565b6100cd81611214565b916100db6040519384610c15565b8183526100e782611214565b602084019290601f19013684376100fe818361107c565b906003548092115f146101885750905b805b82811061015b578385604051918291602083019060208452518091526040830191905f5b818110610142575050500390f35b8251845285945060209384019390920191600101610134565b80610167600192610edf565b90549060031b1c61018161017b858461122b565b88611238565b5201610110565b61019391508261107c565b9061010e565b5f80fd5b3461019957602036600319011261019957600435600354811015610199576101c6602091610edf565b90549060031b1c604051908152f35b346101995760203660031901126101995760606101f36004356113f3565b6040805193151584526001600160781b039283166020850152911690820152f35b34610199575f366003190112610199576020600354604051908152f35b346101995761025f61024b61024536610dcd565b90611298565b604051918291602083526020830190610ebb565b0390f35b346101995760603660031901126101995760443560043560243561028683611214565b926102946040519485610c15565b808452601f196102a382611214565b015f5b8181106103a35750506102b9818361107c565b835f52600160205260405f2054105f146103935750815f52600160205260405f2054915b815b83811061034d57846040518091602082016020835281518091526040830190602060408260051b8601019301915f905b82821061031e57505050500390f35b9193600191939550602061033d8192603f198a82030186528851610ebb565b960192019201859493919261030f565b600190825f528160205261038c6103678260405f20610f0b565b5061037b610375878561122b565b91610e1b565b610385828a611238565b5287611238565b50016102df565b61039d908261107c565b916102dd565b8060606020809389010152016102a6565b34610199576103c236610c99565b91906103cf838284610f40565b92835f525f60205260405f2054610a15578061079357505060c081015160a0820151121561074f5760808101511561070a575b5f82815260026020526040902081518051909391906001600160401b0381116105aa57610439816104338454610de3565b846111c7565b602094601f82116001146106a95761045e9293949582915f9261069e575b50506111b5565b81555b6020830151805160018301916001600160401b0382116105aa5761048f826104898554610de3565b856111c7565b602090601f8311600114610635578260e09593600795936104b7935f9261062a5750506111b5565b90555b60408501516002820155606085015160038201556080850151600482015560a0850151600582015560c085015160068201550192015191825160018060401b0381116105aa5761050e816104338454610de3565b6020601f82116001146105c95781906105309394955f926105be5750506111b5565b90555b805f525f6020524260405f2055805f52600460205260405f20541561055e575b602090604051908152f35b60035490600160401b8210156105aa5761058082600160209401600355610edf565b81549060031b9083821b915f19901b1916179055600354815f526004835260405f20559050610553565b634e487b7160e01b5f52604160045260245ffd5b015190508580610457565b601f19821690835f52805f20915f5b818110610612575095836001959697106105fa575b505050811b019055610533565b01515f1960f88460031b161c191690558480806105ed565b9192602060018192868b0151815501940192016105d8565b015190508980610457565b90601f19831691845f52815f20925f5b818110610686575092600192859260e09896600798961061066e575b505050811b0190556104ba565b01515f1960f88460031b161c19169055888080610661565b92936020600181928786015181550195019301610645565b015190508680610457565b601f19821695835f52805f20915f5b8881106106f2575083600195969798106106da575b505050811b018155610461565b01515f1960f88460031b161c191690558580806106cd565b919260206001819286850151815501940192016106b8565b60405162461bcd60e51b815260206004820152601d60248201527f6e756d5469636b73206e6565647320746f20626520706f7369746976650000006044820152606490fd5b60405162461bcd60e51b815260206004820152601c60248201527b36b0bc1036bab9ba1031329033b932b0ba32b9103a3430b71036b4b760211b6044820152606490fd5b5f5f195b82821061093b5750505f84815260016020526040902091600160401b82116105aa5782548284558083106108bd575b505f928352602083209290805b8383106107e4575050505050610402565b6107ee818361114d565b906001600160401b0382116105aa576108118261080b8954610de3565b896111c7565b5f90601f83116001146108535792610839836001959460209487965f926108485750506111b5565b88555b019501920191936107d3565b013590508d80610457565b601f19831691885f5260205f20925f5b8181106108a5575093602093600196938796938388951061088c575b505050811b01885561083c565b01355f19600384901b60f8161c191690558c808061087f565b91936020600181928787013581550195019201610863565b835f52828060205f20019103905f5b8281106108da5750506107c6565b8060019183016108ea8154610de3565b90816108f9575b5050016108cc565b81601f5f9311851461090f5750555b89806108f1565b8183526020832061092b91601f0160051c84190190860161119a565b8082528160208120915555610908565b61094682848661117f565b9050156109e15761098761097961095e84868861117f565b92906040519283916020830195602087526040840191610f20565b03601f198101835282610c15565b5190209081101561099d57600190910190610797565b606460405162461bcd60e51b815260206004820152602060248201527f4f7574636f6d65206f7074696f6e20686173686573206e6f7420736f727465646044820152fd5b60405162461bcd60e51b815260206004820152600c60248201526b456d70747920737472696e6760a01b6044820152606490fd5b60405162461bcd60e51b81526020600482015260176024820152765175657374696f6e20616c72656164792065786973747360481b6044820152606490fd5b34610199576020366003190112610199576004355f525f602052602060405f2054604051908152f35b3461019957610a8b36610dcd565b905f52600160205260405f2090815481101561019957610aaa91610f0b565b610aba5761024b61025f91610e1b565b634e487b7160e01b5f525f60045260245ffd5b34610199576020366003190112610199576004355f526004602052602060405f2054604051908152f35b34610199576020366003190112610199576004355f526002602052610b7360405f2061025f610b2582610e1b565b91610b3260018201610e1b565b60028201549160038101546004820154600583015491610b81610b5c600760068701549601610e1b565b956040519a8b9a6101008c526101008c0190610ebb565b908a820360208c0152610ebb565b9560408901526060880152608087015260a086015260c085015283820360e0850152610ebb565b34610199576020610bc1610bbb36610dcd565b9061109d565b6040519015158152f35b34610199576020610be4610bde36610c99565b91610f40565b604051908152f35b34610199576020366003190112610199576020906004355f5260028252600360405f2001548152f35b601f909101601f19168101906001600160401b038211908210176105aa57604052565b6001600160401b0381116105aa57601f01601f191660200190565b81601f8201121561019957803590610c6a82610c38565b92610c786040519485610c15565b8284526020838301011161019957815f926020809301838601378301015290565b6040600319820112610199576004356001600160401b038111610199576101008183036003190112610199576040519061010082016001600160401b038111838210176105aa5760405260048101356001600160401b03811161019957836004610d0592840101610c53565b825260248101356001600160401b03811161019957836004610d2992840101610c53565b602083015260448101356040830152606481013560608301526084810135608083015260a481013560a083015260c481013560c083015260e48101356001600160401b0381116101995760048491610d82930101610c53565b60e0820152916024356001600160401b0381116101995782602382011215610199576004810135926001600160401b0384116101995760248460051b83010111610199576024019190565b6040906003190112610199576004359060243590565b90600182811c92168015610e11575b6020831014610dfd57565b634e487b7160e01b5f52602260045260245ffd5b91607f1691610df2565b9060405191825f825492610e2e84610de3565b8084529360018116908115610e995750600114610e55575b50610e5392500383610c15565b565b90505f9291925260205f20905f915b818310610e7d575050906020610e53928201015f610e46565b6020919350806001915483858901015201910190918492610e64565b905060209250610e5394915060ff191682840152151560051b8201015f610e46565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b600354811015610ef75760035f5260205f2001905f90565b634e487b7160e01b5f52603260045260245ffd5b8054821015610ef7575f5260205f2001905f90565b908060209392818452848401375f828201840152601f01601f1916010190565b91906040518092610fce60208301956040875260e0610f86610f7083516101006060890152610160880190610ebb565b6020840151878203605f19016080890152610ebb565b91604081015160a0870152606081015160c087015260808101518287015260a081015161010087015260c08101516101208701520151605f1985830301610140860152610ebb565b90601f19838303016040840152808252602082019060208160051b84010192855f91601e1982360301905b84841061101f57505050505050611019925003601f198101835282610c15565b51902090565b9193959092949650601f19828203018752873583811215610199578401602081019190356001600160401b0381116101995780360383136101995761106a6020928392600195610f20565b99019701940191889697959391610ff9565b9190820180921161108957565b634e487b7160e01b5f52601160045260245ffd5b805f52600160205260405f2054156110e15781156110db575f52600160205260405f2054906001820180921161108957106110d757600190565b5f90565b50505f90565b906110eb906113f3565b909161111c57611107916001600160781b03918216911661107c565b905f526002602052600460405f200154141590565b6001600160781b03919091161591508161113b575b506110d757600190565b6001600160781b03161590505f611131565b903590601e198136030182121561019957018035906001600160401b0382116101995760200191813603831361019957565b90821015610ef7576111969160051b81019061114d565b9091565b5f5b8281106111a857505050565b5f8282015560010161119c565b8160011b915f199060031b1c19161790565b91601f82116111d557505050565b8082116111e157505050565b610e53925f5260205f20916020601f830160051c921061120c575b601f82910160051c03910161119a565b5f91506111fc565b6001600160401b0381116105aa5760051b60200190565b9190820391821161108957565b8051821015610ef75760209160051b010190565b6040519061125b604083610c15565b6007825266125b9d985b1a5960ca1b6020830152565b60405190611280604083610c15565b600982526813585b199bdc9b595960ba1b6020830152565b90815f52600160205260405f2054155f14611395576112b6906113f3565b929161135b576001600160781b039081169216906112d4828461107c565b815f526002602052600460405f200154146112f8575050505b6112f5611271565b90565b60408051908101939092906001600160401b038511848610176105aa57604094855283526020808401919091525f91825260029052919091206004810154600582015460068301546112f594909391929161135590600701610e1b565b9061140e565b6001600160781b03161591905081611383575b5061137b576112f5611271565b6112f561124c565b6001600160781b03161590505f61136e565b90816113a55750506112f561124c565b805f52600160205260405f2054600181018091116110895782106113ca5750506112ed565b5f52600160205260405f205f198201918211611089576112f5916113ed91610f0b565b50610e1b565b60ff81901c15916001600160781b03607883901c8116921690565b939192909383156114d857818313156114a3576020015161144f9361144a936114449290849003906001600160781b031661150a565b9061165a565b611771565b9080511561149f57600160209283806112f5946040519684889551918291018487015e840190600160fd1b83830152805192839101602183015e01015f838201520301601f198101835282610c15565b5090565b60405162461bcd60e51b815260206004820152600d60248201526c696e76616c69642072616e676560981b6044820152606490fd5b60405162461bcd60e51b815260206004820152600a60248201526906e756d5469636b733d360b41b6044820152606490fd5b9180156115e2575f1982840992828102928380861095039480860395146115c0578483111561158957829109600182190182168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b60405162461bcd60e51b815260206004820152600f60248201526e6d756c446976206f766572666c6f7760881b6044820152606490fd5b5050915081156115ce570490565b634e487b7160e01b5f52601260045260245ffd5b60405162461bcd60e51b815260206004820152600d60248201526c064656e6f6d696e61746f723d3609c1b6044820152606490fd5b1561161e57565b60405162461bcd60e51b81526020600482015260146024820152737363616c617256616c7565206f766572666c6f7760601b6044820152606490fd5b5f8112156116c25761166b906118a8565b808210156116a6579061167d9161122b565b61168d600160ff1b821115611617565b600160ff1b811461169d575f0390565b50600160ff1b90565b6116af9161122b565b6112f56001600160ff1b03821115611617565b6001600160ff1b038181039291908311611089576116e56112f593831115611617565b61107c565b90610e536021602093604051948591602d60f81b828401528051918291018484015e81015f838201520301601f198101845283610c15565b908151811015610ef7570160200190565b8015611089575f190190565b9061174982610c38565b6117566040519182610c15565b8281528092611767601f1991610c38565b0190602036910137565b61177d5f8212916118a8565b90611795670de0b6b3a76400008084049306926118b5565b9180156118995760126117aa6117af926118b5565b611956565b9182515b8015158061186b575b156117cf576117ca90611733565b6117b3565b929091926117dc8161173f565b915f5b828110611840575050506001602093928480611832946040519784899551918291018487015e840190601760f91b83830152805192839101602183015e01015f838201520301601f198101845283610c15565b156112f5576112f5906116ea565b6001906001600160f81b03196118568285611722565b51165f1a6118648287611722565b53016117df565b505f19810181811161108957600360fc1b906001600160f81b0319906118919087611722565b5116146117bc565b50156112f5576112f5906116ea565b5f8112156112f5575f0390565b801561193657805f81805b61191b57506118ce8161173f565b925b6118d957505090565b6118e290611733565b9060ff600a8206166030019060ff821161108957600a9160f81b6001600160f81b0319165f1a6119128486611722565b530490816118d0565b91505f198114611089576001600a91019104808392916118c0565b50604051611945604082610c15565b60018152600360fc1b602082015290565b919080835110156119df5761197661196d8261173f565b9184519061122b565b925f5b8481106119c957505f5b81518110156119c2576001906001600160f81b03196119a28285611722565b51166119bb6119b1838961107c565b915f1a9186611722565b5301611983565b5090925050565b8060306119d860019386611722565b5301611979565b5056fea2646970667358221220d2fccacb7375bb033c0a3e2539d6ecfa46485fc4db28a7fa67637030479cc3d964736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f3560e01c90816312c7ca9814610bec575080631dec983014610bcb57806329d637e614610ba857806331b1b97814610af7578063348fed1b14610acd578063491aa41214610a7d5780636836951314610a54578063705b5c9c146103b4578063956bf1ae14610263578063ac9087c014610231578063dd41cc2f14610214578063efcb6931146101d5578063f03477831461019d5763fd1df035146100b6575f80fd5b34610199576100c436610dcd565b6100cd81611214565b916100db6040519384610c15565b8183526100e782611214565b602084019290601f19013684376100fe818361107c565b906003548092115f146101885750905b805b82811061015b578385604051918291602083019060208452518091526040830191905f5b818110610142575050500390f35b8251845285945060209384019390920191600101610134565b80610167600192610edf565b90549060031b1c61018161017b858461122b565b88611238565b5201610110565b61019391508261107c565b9061010e565b5f80fd5b3461019957602036600319011261019957600435600354811015610199576101c6602091610edf565b90549060031b1c604051908152f35b346101995760203660031901126101995760606101f36004356113f3565b6040805193151584526001600160781b039283166020850152911690820152f35b34610199575f366003190112610199576020600354604051908152f35b346101995761025f61024b61024536610dcd565b90611298565b604051918291602083526020830190610ebb565b0390f35b346101995760603660031901126101995760443560043560243561028683611214565b926102946040519485610c15565b808452601f196102a382611214565b015f5b8181106103a35750506102b9818361107c565b835f52600160205260405f2054105f146103935750815f52600160205260405f2054915b815b83811061034d57846040518091602082016020835281518091526040830190602060408260051b8601019301915f905b82821061031e57505050500390f35b9193600191939550602061033d8192603f198a82030186528851610ebb565b960192019201859493919261030f565b600190825f528160205261038c6103678260405f20610f0b565b5061037b610375878561122b565b91610e1b565b610385828a611238565b5287611238565b50016102df565b61039d908261107c565b916102dd565b8060606020809389010152016102a6565b34610199576103c236610c99565b91906103cf838284610f40565b92835f525f60205260405f2054610a15578061079357505060c081015160a0820151121561074f5760808101511561070a575b5f82815260026020526040902081518051909391906001600160401b0381116105aa57610439816104338454610de3565b846111c7565b602094601f82116001146106a95761045e9293949582915f9261069e575b50506111b5565b81555b6020830151805160018301916001600160401b0382116105aa5761048f826104898554610de3565b856111c7565b602090601f8311600114610635578260e09593600795936104b7935f9261062a5750506111b5565b90555b60408501516002820155606085015160038201556080850151600482015560a0850151600582015560c085015160068201550192015191825160018060401b0381116105aa5761050e816104338454610de3565b6020601f82116001146105c95781906105309394955f926105be5750506111b5565b90555b805f525f6020524260405f2055805f52600460205260405f20541561055e575b602090604051908152f35b60035490600160401b8210156105aa5761058082600160209401600355610edf565b81549060031b9083821b915f19901b1916179055600354815f526004835260405f20559050610553565b634e487b7160e01b5f52604160045260245ffd5b015190508580610457565b601f19821690835f52805f20915f5b818110610612575095836001959697106105fa575b505050811b019055610533565b01515f1960f88460031b161c191690558480806105ed565b9192602060018192868b0151815501940192016105d8565b015190508980610457565b90601f19831691845f52815f20925f5b818110610686575092600192859260e09896600798961061066e575b505050811b0190556104ba565b01515f1960f88460031b161c19169055888080610661565b92936020600181928786015181550195019301610645565b015190508680610457565b601f19821695835f52805f20915f5b8881106106f2575083600195969798106106da575b505050811b018155610461565b01515f1960f88460031b161c191690558580806106cd565b919260206001819286850151815501940192016106b8565b60405162461bcd60e51b815260206004820152601d60248201527f6e756d5469636b73206e6565647320746f20626520706f7369746976650000006044820152606490fd5b60405162461bcd60e51b815260206004820152601c60248201527b36b0bc1036bab9ba1031329033b932b0ba32b9103a3430b71036b4b760211b6044820152606490fd5b5f5f195b82821061093b5750505f84815260016020526040902091600160401b82116105aa5782548284558083106108bd575b505f928352602083209290805b8383106107e4575050505050610402565b6107ee818361114d565b906001600160401b0382116105aa576108118261080b8954610de3565b896111c7565b5f90601f83116001146108535792610839836001959460209487965f926108485750506111b5565b88555b019501920191936107d3565b013590508d80610457565b601f19831691885f5260205f20925f5b8181106108a5575093602093600196938796938388951061088c575b505050811b01885561083c565b01355f19600384901b60f8161c191690558c808061087f565b91936020600181928787013581550195019201610863565b835f52828060205f20019103905f5b8281106108da5750506107c6565b8060019183016108ea8154610de3565b90816108f9575b5050016108cc565b81601f5f9311851461090f5750555b89806108f1565b8183526020832061092b91601f0160051c84190190860161119a565b8082528160208120915555610908565b61094682848661117f565b9050156109e15761098761097961095e84868861117f565b92906040519283916020830195602087526040840191610f20565b03601f198101835282610c15565b5190209081101561099d57600190910190610797565b606460405162461bcd60e51b815260206004820152602060248201527f4f7574636f6d65206f7074696f6e20686173686573206e6f7420736f727465646044820152fd5b60405162461bcd60e51b815260206004820152600c60248201526b456d70747920737472696e6760a01b6044820152606490fd5b60405162461bcd60e51b81526020600482015260176024820152765175657374696f6e20616c72656164792065786973747360481b6044820152606490fd5b34610199576020366003190112610199576004355f525f602052602060405f2054604051908152f35b3461019957610a8b36610dcd565b905f52600160205260405f2090815481101561019957610aaa91610f0b565b610aba5761024b61025f91610e1b565b634e487b7160e01b5f525f60045260245ffd5b34610199576020366003190112610199576004355f526004602052602060405f2054604051908152f35b34610199576020366003190112610199576004355f526002602052610b7360405f2061025f610b2582610e1b565b91610b3260018201610e1b565b60028201549160038101546004820154600583015491610b81610b5c600760068701549601610e1b565b956040519a8b9a6101008c526101008c0190610ebb565b908a820360208c0152610ebb565b9560408901526060880152608087015260a086015260c085015283820360e0850152610ebb565b34610199576020610bc1610bbb36610dcd565b9061109d565b6040519015158152f35b34610199576020610be4610bde36610c99565b91610f40565b604051908152f35b34610199576020366003190112610199576020906004355f5260028252600360405f2001548152f35b601f909101601f19168101906001600160401b038211908210176105aa57604052565b6001600160401b0381116105aa57601f01601f191660200190565b81601f8201121561019957803590610c6a82610c38565b92610c786040519485610c15565b8284526020838301011161019957815f926020809301838601378301015290565b6040600319820112610199576004356001600160401b038111610199576101008183036003190112610199576040519061010082016001600160401b038111838210176105aa5760405260048101356001600160401b03811161019957836004610d0592840101610c53565b825260248101356001600160401b03811161019957836004610d2992840101610c53565b602083015260448101356040830152606481013560608301526084810135608083015260a481013560a083015260c481013560c083015260e48101356001600160401b0381116101995760048491610d82930101610c53565b60e0820152916024356001600160401b0381116101995782602382011215610199576004810135926001600160401b0384116101995760248460051b83010111610199576024019190565b6040906003190112610199576004359060243590565b90600182811c92168015610e11575b6020831014610dfd57565b634e487b7160e01b5f52602260045260245ffd5b91607f1691610df2565b9060405191825f825492610e2e84610de3565b8084529360018116908115610e995750600114610e55575b50610e5392500383610c15565b565b90505f9291925260205f20905f915b818310610e7d575050906020610e53928201015f610e46565b6020919350806001915483858901015201910190918492610e64565b905060209250610e5394915060ff191682840152151560051b8201015f610e46565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b600354811015610ef75760035f5260205f2001905f90565b634e487b7160e01b5f52603260045260245ffd5b8054821015610ef7575f5260205f2001905f90565b908060209392818452848401375f828201840152601f01601f1916010190565b91906040518092610fce60208301956040875260e0610f86610f7083516101006060890152610160880190610ebb565b6020840151878203605f19016080890152610ebb565b91604081015160a0870152606081015160c087015260808101518287015260a081015161010087015260c08101516101208701520151605f1985830301610140860152610ebb565b90601f19838303016040840152808252602082019060208160051b84010192855f91601e1982360301905b84841061101f57505050505050611019925003601f198101835282610c15565b51902090565b9193959092949650601f19828203018752873583811215610199578401602081019190356001600160401b0381116101995780360383136101995761106a6020928392600195610f20565b99019701940191889697959391610ff9565b9190820180921161108957565b634e487b7160e01b5f52601160045260245ffd5b805f52600160205260405f2054156110e15781156110db575f52600160205260405f2054906001820180921161108957106110d757600190565b5f90565b50505f90565b906110eb906113f3565b909161111c57611107916001600160781b03918216911661107c565b905f526002602052600460405f200154141590565b6001600160781b03919091161591508161113b575b506110d757600190565b6001600160781b03161590505f611131565b903590601e198136030182121561019957018035906001600160401b0382116101995760200191813603831361019957565b90821015610ef7576111969160051b81019061114d565b9091565b5f5b8281106111a857505050565b5f8282015560010161119c565b8160011b915f199060031b1c19161790565b91601f82116111d557505050565b8082116111e157505050565b610e53925f5260205f20916020601f830160051c921061120c575b601f82910160051c03910161119a565b5f91506111fc565b6001600160401b0381116105aa5760051b60200190565b9190820391821161108957565b8051821015610ef75760209160051b010190565b6040519061125b604083610c15565b6007825266125b9d985b1a5960ca1b6020830152565b60405190611280604083610c15565b600982526813585b199bdc9b595960ba1b6020830152565b90815f52600160205260405f2054155f14611395576112b6906113f3565b929161135b576001600160781b039081169216906112d4828461107c565b815f526002602052600460405f200154146112f8575050505b6112f5611271565b90565b60408051908101939092906001600160401b038511848610176105aa57604094855283526020808401919091525f91825260029052919091206004810154600582015460068301546112f594909391929161135590600701610e1b565b9061140e565b6001600160781b03161591905081611383575b5061137b576112f5611271565b6112f561124c565b6001600160781b03161590505f61136e565b90816113a55750506112f561124c565b805f52600160205260405f2054600181018091116110895782106113ca5750506112ed565b5f52600160205260405f205f198201918211611089576112f5916113ed91610f0b565b50610e1b565b60ff81901c15916001600160781b03607883901c8116921690565b939192909383156114d857818313156114a3576020015161144f9361144a936114449290849003906001600160781b031661150a565b9061165a565b611771565b9080511561149f57600160209283806112f5946040519684889551918291018487015e840190600160fd1b83830152805192839101602183015e01015f838201520301601f198101835282610c15565b5090565b60405162461bcd60e51b815260206004820152600d60248201526c696e76616c69642072616e676560981b6044820152606490fd5b60405162461bcd60e51b815260206004820152600a60248201526906e756d5469636b733d360b41b6044820152606490fd5b9180156115e2575f1982840992828102928380861095039480860395146115c0578483111561158957829109600182190182168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b60405162461bcd60e51b815260206004820152600f60248201526e6d756c446976206f766572666c6f7760881b6044820152606490fd5b5050915081156115ce570490565b634e487b7160e01b5f52601260045260245ffd5b60405162461bcd60e51b815260206004820152600d60248201526c064656e6f6d696e61746f723d3609c1b6044820152606490fd5b1561161e57565b60405162461bcd60e51b81526020600482015260146024820152737363616c617256616c7565206f766572666c6f7760601b6044820152606490fd5b5f8112156116c25761166b906118a8565b808210156116a6579061167d9161122b565b61168d600160ff1b821115611617565b600160ff1b811461169d575f0390565b50600160ff1b90565b6116af9161122b565b6112f56001600160ff1b03821115611617565b6001600160ff1b038181039291908311611089576116e56112f593831115611617565b61107c565b90610e536021602093604051948591602d60f81b828401528051918291018484015e81015f838201520301601f198101845283610c15565b908151811015610ef7570160200190565b8015611089575f190190565b9061174982610c38565b6117566040519182610c15565b8281528092611767601f1991610c38565b0190602036910137565b61177d5f8212916118a8565b90611795670de0b6b3a76400008084049306926118b5565b9180156118995760126117aa6117af926118b5565b611956565b9182515b8015158061186b575b156117cf576117ca90611733565b6117b3565b929091926117dc8161173f565b915f5b828110611840575050506001602093928480611832946040519784899551918291018487015e840190601760f91b83830152805192839101602183015e01015f838201520301601f198101845283610c15565b156112f5576112f5906116ea565b6001906001600160f81b03196118568285611722565b51165f1a6118648287611722565b53016117df565b505f19810181811161108957600360fc1b906001600160f81b0319906118919087611722565b5116146117bc565b50156112f5576112f5906116ea565b5f8112156112f5575f0390565b801561193657805f81805b61191b57506118ce8161173f565b925b6118d957505090565b6118e290611733565b9060ff600a8206166030019060ff821161108957600a9160f81b6001600160f81b0319165f1a6119128486611722565b530490816118d0565b91505f198114611089576001600a91019104808392916118c0565b50604051611945604082610c15565b60018152600360fc1b602082015290565b919080835110156119df5761197661196d8261173f565b9184519061122b565b925f5b8481106119c957505f5b81518110156119c2576001906001600160f81b03196119a28285611722565b51166119bb6119b1838961107c565b915f1a9186611722565b5301611983565b5090925050565b8060306119d860019386611722565b5301611979565b5056fea2646970667358221220d2fccacb7375bb033c0a3e2539d6ecfa46485fc4db28a7fa67637030479cc3d964736f6c63430008210033'
		}
	}
}
export declare const draftIERC6093_IERC1155Errors: {
	readonly abi: readonly [
		{
			readonly type: 'error'
			readonly name: 'ERC1155InsufficientBalance'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC1155InvalidApprover'
			readonly inputs: readonly [
				{
					readonly name: 'approver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC1155InvalidArrayLength'
			readonly inputs: readonly [
				{
					readonly name: 'idsLength'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'valuesLength'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC1155InvalidOperator'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC1155InvalidReceiver'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC1155InvalidSender'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC1155MissingApprovalForAll'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const draftIERC6093_IERC20Errors: {
	readonly abi: readonly [
		{
			readonly type: 'error'
			readonly name: 'ERC20InsufficientAllowance'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'allowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InsufficientBalance'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'needed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidApprover'
			readonly inputs: readonly [
				{
					readonly name: 'approver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidReceiver'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidSender'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC20InvalidSpender'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const draftIERC6093_IERC721Errors: {
	readonly abi: readonly [
		{
			readonly type: 'error'
			readonly name: 'ERC721IncorrectOwner'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721InsufficientApproval'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721InvalidApprover'
			readonly inputs: readonly [
				{
					readonly name: 'approver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721InvalidOperator'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721InvalidOwner'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721InvalidReceiver'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721InvalidSender'
			readonly inputs: readonly [
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ERC721NonexistentToken'
			readonly inputs: readonly [
				{
					readonly name: 'tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_BinaryOutcomes_BinaryOutcomes: {
	readonly abi: readonly []
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea2646970667358221220bd6e3f0b4604f4a8c798925a35261a1772f9980385585a146c82952e08da4e9f64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '5f80fdfea2646970667358221220bd6e3f0b4604f4a8c798925a35261a1772f9980385585a146c82952e08da4e9f64736f6c63430008210033'
		}
	}
}
export declare const peripherals_EscalationGame_EscalationGame: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ClaimDeposit'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'amountToWithdraw'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'burnAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DepositOnOutcome'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
					readonly indexed: false
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'depositIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'cumulativeAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'GameStarted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'startingTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'startBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'nonDecisionThreshold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'WithdrawDeposit'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
					readonly indexed: false
				},
				{
					readonly name: 'amountToWithdraw'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'depositIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balances'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'claimDepositForWinning'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'depositIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amountToWithdraw'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'originalDepositAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'computeIterativeAttritionCost'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'timeSinceStart'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'computeTimeSinceStartFromAttritionCost'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'attritionCost'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'depositOnOutcome'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'depositAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deposits'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'cumulativeAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getBalances'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256[3]'
					readonly internalType: 'uint256[3]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getBindingCapital'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getDepositsByOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'numberOfEntries'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'returnDeposits'
					readonly type: 'tuple[]'
					readonly internalType: 'struct Deposit[]'
					readonly components: readonly [
						{
							readonly name: 'depositor'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'amount'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'cumulativeAmount'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getEscalationGameEndDate'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: 'endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestionResolution'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'hasReachedNonDecision'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'lnRatioScaled'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'nonDecisionThreshold'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'nonDecisionTimestamp'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'owner'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'refundCanceledDeposit'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'depositIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: 'expectedDepositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amountToWithdraw'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPool'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'start'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_startBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_nonDecisionThreshold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'startBond'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'startingTime'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalCost'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'withdrawDeposit'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'depositIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'expectedDepositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'depositor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amountToWithdraw'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'originalDepositAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '608034607d57601f611ba738819003918201601f19168301916001600160401b03831184841017608157808492602094604052833981010312607d57516001600160a01b03811690819003607d57600580546001600160a01b03199081169290921790556009805490911633179055604051611b1190816100968239f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe60806040526004361015610011575f80fd5b5f3560e01c8062113e0814610f655780630757581714610f4757806310b40b4914610f2a5780632493333014610f1057806339518b5e14610ef45780633bdc2c0514610c9a5780633c5e6c9714610c805780634903b0d114610c54578063498eec4014610c365780636538919014610c0d5780638da5cb5b14610be55780638fb4b57314610990578063a697afb414610968578063b1290c6b14610903578063c4b8e520146108e6578063ca539aed146108cc578063d20d04ab146108af578063e2247da914610429578063e57bd89c1461040c578063eab13564146103d1578063eb0548771461025f578063f7b2a8e31461023b5763fb8b799214610115575f80fd5b34610237576040366003190112610237576024356001600160a01b03811690600435908290036102375761015460018060a01b0360055416331461125b565b600a546101f25761016361146d565b9160048310156101de5761019a9060ff84165f5260046020526101898360405f20610fe0565b50546001600160a01b03161461135a565b6101da6101cb5f516020611a9c5f395f51905f526101b8858561155c565b93819791929660405193849389856113a6565b0390a160405193849384610ff9565b0390f35b634e487b7160e01b5f52602160045260245ffd5b60405162461bcd60e51b815260206004820152601f60248201527f53797374656d206861732072656163686564206e6f6e2d6465636973696f6e006044820152606490fd5b5f80fd5b34610237575f366003190112610237576020610255611904565b6040519015158152f35b346102375760603660031901126102375760043560048110156102375760243560443561028b816118d9565b926102996040519485611032565b818452601f196102a8836118d9565b015f5b8181106103ba5750506102be8284611093565b9160ff5f921692835f52600460205260405f2054105f146103a85750505f91815f52600460205260405f2054925b815b84811061035c57856040518091602082016020835281518091526020604084019201905f5b818110610321575050500390f35b825180516001600160a01b03168552602081810151818701526040918201519186019190915286955060609094019390920191600101610313565b816101de57600190845f5260046020526103a161037c8260405f20610fe0565b5061039061038a8785611086565b91611329565b61039a828b6118f0565b52886118f0565b50016102ee565b6103b490849294611093565b926102ec565b6020906103c561153e565b828289010152016102ab565b34610237576040366003190112610237576024356004811015610237576103fd6101da9160043561155c565b60409391935193849384610ff9565b34610237575f366003190112610237576020600654604051908152f35b34610237576060366003190112610237576004356001600160a01b03811690819003610237576024359060048210156102375760443590600a54610858576005546001600160a01b031633036108135761048660038414156112e5565b61048e61146d565b60048110156101de576003036107cf5760038310156107bb5782600101918254926006549182851015610787576007548110610722576104ce8584611086565b908181111561071a5750935b846104e58183611093565b936001549060025491600354908381115f1461070157818111156106fb57805b809481925b8d6106b65750149182156106ac575b5050915b80871492836106a4575b508261069a575b5050610677575b505081905561054261153e565b91808352602083018481526040840192835260ff861690815f52600460205260405f208054600160401b8110156106635761058291600182018155610fe0565b959095610650575185546001600160a01b0319166001600160a01b0391909116178555516001850181905583516002909501949094555f908152600460205260409020545f1981019590861161063c576020957f76d404f6c77a6e7654712999924e07301be3b256d4b99f65ccbef115a25496859461060e60a095519360405195865289860190610fd3565b604084015260608301526080820152a1610626611904565b610633575b604051908152f35b42600a5561062b565b634e487b7160e01b5f52601160045260245ffd5b634e487b7160e01b5f525f60045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b91925093505f19810190811161063c57806106929194611093565b908580610535565b109050888061052e565b92508a610527565b149050828b610519565b915060018d036106de575081149182156106d4575b50505b9161051d565b149050828b6106cb565b925081149182156106f1575b50506106ce565b149050828b6106ea565b81610505565b8184111561071457835b8094819261050a565b8161070b565b9050936104da565b60405162461bcd60e51b815260206004820152603760248201527f616c6c20616d6f756e7473206e65656420746f20626520626967676572206f7260448201527608195c5d585b081d1bc81cdd185c9d0819195c1bdcda5d604a1b6064820152608490fd5b60405162461bcd60e51b815260206004820152600c60248201526b105b1c9958591e48199d5b1b60a21b6044820152606490fd5b634e487b7160e01b5f52603260045260245ffd5b60405162461bcd60e51b815260206004820152601c60248201527b14de5cdd195b481a185cc8185b1c9958591e481d1a5b5959081bdd5d60221b6044820152606490fd5b60405162461bcd60e51b815260206004820152601e60248201527f4f6e6c7920536563757269747920506f6f6c2063616e206465706f73697400006044820152606490fd5b60405162461bcd60e51b815260206004820152602960248201527f53797374656d2068617320616c726561647920726561636865642061206e6f6e60448201526816b232b1b4b9b4b7b760b91b6064820152608490fd5b34610237575f366003190112610237576020600854604051908152f35b34610237575f36600319011261023757602061062b61151a565b34610237575f366003190112610237576020600a54604051908152f35b346102375760403660031901126102375760043560ff811680910361023757602435905f52600460205260405f209081548110156102375761094491610fe0565b5060018060a01b038154166101da6002600184015493015460405193849384610ff9565b34610237575f366003190112610237576005546040516001600160a01b039091168152602090f35b346102375760403660031901126102375760095460243590600435906001600160a01b03163303610ba9575f54610b725780821115610b2e578015610aeb57670de0b6b3a76400008110610a9a57670de0b6b3a76400008210610a4a576203f480420180421161063c577fedb371157a97763aaa1b348e6811cbb8c9eb299aaf93a6f5ba91f312bcb40fcf92606092825f558160065580600755610a34828261195a565b60085560405192835260208301526040820152a1005b60405162461bcd60e51b815260206004820152602260248201527f7468726573686f6c64206d757374206265206174206c6561737420312065746860448201526132b960f11b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f737461727420626f6e64206d757374206265206174206c6561737420312065746044820152623432b960e91b6064820152608490fd5b60405162461bcd60e51b815260206004820152601b60248201527a737461727420626f6e64206d75737420626520706f73697469766560281b6044820152606490fd5b606460405162461bcd60e51b815260206004820152602060248201527f7468726573686f6c64206d7573742065786365656420737461727420626f6e646044820152fd5b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610237575f366003190112610237576009546040516001600160a01b039091168152602090f35b34610237575f366003190112610237576020610c2761146d565b610c346040518092610fd3565bf35b3461023757602036600319011261023757602061062b600435611408565b346102375760203660031901126102375760043560038110156102375760209060010154604051908152f35b34610237575f36600319011261023757602061062b6113d4565b3461023757606036600319011261023757600435602435906004821015610237576044356001600160a01b0381169190829003610237576005546001600160a01b0316610ce833821461125b565b604051634fffd03760e01b815290602082600481845afa918215610e87575f92610ebf575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f91610e92575b506040516387ca99af60e01b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f91610e55575b5015610e18575f516020611a9c5f395f51905f52610e0991604094610d9d60038214156112e5565b60ff8116805f526004602052610dd2610dc1610dbb858a5f20610fe0565b50611329565b9660018060a01b038851161461135a565b5f5260046020525f6001610de884898420610fe0565b500155602060018060a01b03865116950151938492875193849388856113a6565b0390a182519182526020820152f35b60405162461bcd60e51b8152602060048201526015602482015274169bdb1d185c881a185cc81b9bdd08199bdc9ad959605a1b6044820152606490fd5b90506020813d602011610e7f575b81610e7060209383611032565b81010312610237575184610d75565b3d9150610e63565b6040513d5f823e3d90fd5b610eb29150823d8411610eb8575b610eaa8183611032565b8101906112c6565b86610d36565b503d610ea0565b6004919250610ee5602091823d8411610eed575b610edd8183611032565b8101906112a7565b929150610d0d565b503d610ed3565b34610237575f3660031901126102375760205f54604051908152f35b34610237575f36600319011261023757602061062b6111c9565b34610237575f366003190112610237576020600754604051908152f35b3461023757602036600319011261023757602061062b6004356110a0565b34610237575f366003190112610237576060604051610f848282611032565b369037604051610f9381611017565b60015481526002546020820152600354604082015260405190815f905b60038210610fbd57606084f35b6020806001928551815201930191019091610fb0565b9060048210156101de5752565b80548210156107bb575f52600360205f20910201905f90565b604091949392606082019560018060a01b0316825260208201520152565b606081019081106001600160401b0382111761066357604052565b601f909101601f19168101906001600160401b0382119082101761066357604052565b8181029291811591840414171561063c57565b8115611072570490565b634e487b7160e01b5f52601260045260245ffd5b9190820391821161063c57565b9190820180921161063c57565b6007546006549162409980811161119557801561118f5762409980811461118a576110d16240998091600854611055565b04620a939b810490620a939b8202828104620a939b148315171561063c576110f891611086565b90620f4240829083810180911161063c57926002915b6010831061113d575b5050509161112b91620f4240931b90611055565b0481811115611138575090565b905090565b8161114a91959395611055565b620f42408502858104620f4240148615171561063c5761116991611068565b9182156111845761117c83600192611093565b94019161110e565b93611117565b505090565b50905090565b60405162461bcd60e51b815260206004820152600c60248201526b496e76616c69642074696d6560a01b6044820152606490fd5b600154600254808210158061124f575b8015611238575b156111e9575090565b9080821015908161122b575b811561120b575b50611208575060035490565b90565b600354831015915081611220575b505f6111fc565b90508111155f611219565b60035483111591506111f5565b5060035482101580156111e05750808211156111e0565b506003548211156111d9565b1561126257565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c7920536563757269747920506f6f6c2063616e207769746864726177006044820152606490fd5b9081602091031261023757516001600160a01b03811681036102375790565b9081602091031261023757516001600160f81b03811681036102375790565b156112ec57565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b9060405161133681611017565b82546001600160a01b03168152600183015460208201526002909201546040830152565b1561136157565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c79206465706f736974206f776e65722063616e207769746864726177006044820152606490fd5b6001600160a01b039091168152608081019493926060926113cb906020840190610fd3565b60408201520152565b5f5442811015611403576113e89042611086565b624099808110156113fc57611208906110a0565b5060065490565b505f90565b60075490818111156114535760065481101561144a576114279161195a565b6240998081029080820462409980149015171561063c5760085461120891611068565b50506240998090565b50505f90565b9060ff8091169116019060ff821161063c57565b6114756113d4565b60015490808210611513576001915b600280549360ff906114b49085871061150a576114af60015b60035497881061150357600192611459565b611459565b1610156114fb57828111806114f2575b6114eb57821191826114e1575b50506114dc57600290565b600190565b1190505f806114d1565b5050505f90565b508181116114c4565b505050600390565b5f92611459565b6114af5f61149d565b5f91611484565b600a548061120857506112085f546115386115336111c9565b611408565b90611093565b6040519061154b82611017565b5f6040838281528260208201520152565b919060018060a01b036005541680331490811561185c575b50156117fa5760048110156101de5760016115c460ff8361159960035f9614156112e5565b169485845260046020526115b3610dbb8260408720610fe0565b958452600460205260408420610fe0565b50015581516020830180516001600160a01b039092169360406115e56111c9565b91019081518181115f146117605750505051915f5b600554604051634fffd03760e01b8152906001600160a01b0316602082600481845afa918215610e87575f9261173b575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f9161171e575b50604051634044d26360e11b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f916116ec575b50600654908181106116c1575b505060405f516020611abc5f395f51905f52918151908682526020820152a1565b6040916116e06116e5925f516020611abc5f395f51905f529598611055565b611068565b94916116a0565b90506020813d602011611716575b8161170760209383611032565b8101031261023757515f611693565b3d91506116fa565b6117359150823d8411610eb857610eaa8183611032565b5f611654565b6004919250611758602091823d8411610eed57610edd8183611032565b92915061162b565b61176f82918597955190611093565b11156117c05761178561178a9251865190611093565b611086565b928360011b908482046002148515171561063c57611785826117b560056117ba950497889451611086565b611093565b926115fa565b505082518060011b908082046002149015171561063c576005900492518060011b908082046002149015171561063c57836117ba91611086565b60405162461bcd60e51b815260206004820152603460248201527f4f6e6c7920536563757269747920506f6f6c206f722064657369676e6174656460448201527320666f726b65722063616e20776974686472617760601b6064820152608490fd5b604051631204b6bd60e31b81529150602090829060049082905afa908115610e87575f91611897575b506001600160a01b031633145f611574565b90506020813d6020116118d1575b816118b260209383611032565b8101031261023757516001600160a01b0381168103610237575f611885565b3d91506118a5565b6001600160401b0381116106635760051b60200190565b80518210156107bb5760209160051b010190565b600260ff61193e600154600654809110155f14611950576114af6001915b85548111611949576001905b6003541061150357600192611459565b1610156114dc575f90565b5f9061192e565b6114af5f91611922565b5f905b8060011b908082046002148115171561063c57818410611983575060019091019061195d565b61199b91509291926119958184611086565b92611093565b620f4240820291808304620f4240149015171561063c576119bb91611068565b90811561145357620a939b810290808204620a939b149015171561063c57620f42406119e78380611055565b6001919004835b60108310611a17575b5050506001600160ff1b038216820361063c576112089160011b90611093565b81611a2491959395611055565b600185901b906001600160ff1b038616860361063c575f19820182811161063c57611a4e91611055565b906001810180911161063c57620f4240810290808204620f4240149015171561063c57611a7a91611068565b918215611a9557611a8d83600192611093565b9401916119ee565b936119f756fe74839e2d346f4dd419b9f83f68e3802298d7bcceec5468ed97aa5abbb1c2764252b1aa0106c8f02c90bbf2a2a2589b772cfe95ba33c37c499c7cbdb7c8410ceda264697066735822122061fd77ac2b69d1a47a2a5f141cc4c059919aa9427c5db4ac9e4edfb4d8575dac64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60806040526004361015610011575f80fd5b5f3560e01c8062113e0814610f655780630757581714610f4757806310b40b4914610f2a5780632493333014610f1057806339518b5e14610ef45780633bdc2c0514610c9a5780633c5e6c9714610c805780634903b0d114610c54578063498eec4014610c365780636538919014610c0d5780638da5cb5b14610be55780638fb4b57314610990578063a697afb414610968578063b1290c6b14610903578063c4b8e520146108e6578063ca539aed146108cc578063d20d04ab146108af578063e2247da914610429578063e57bd89c1461040c578063eab13564146103d1578063eb0548771461025f578063f7b2a8e31461023b5763fb8b799214610115575f80fd5b34610237576040366003190112610237576024356001600160a01b03811690600435908290036102375761015460018060a01b0360055416331461125b565b600a546101f25761016361146d565b9160048310156101de5761019a9060ff84165f5260046020526101898360405f20610fe0565b50546001600160a01b03161461135a565b6101da6101cb5f516020611a9c5f395f51905f526101b8858561155c565b93819791929660405193849389856113a6565b0390a160405193849384610ff9565b0390f35b634e487b7160e01b5f52602160045260245ffd5b60405162461bcd60e51b815260206004820152601f60248201527f53797374656d206861732072656163686564206e6f6e2d6465636973696f6e006044820152606490fd5b5f80fd5b34610237575f366003190112610237576020610255611904565b6040519015158152f35b346102375760603660031901126102375760043560048110156102375760243560443561028b816118d9565b926102996040519485611032565b818452601f196102a8836118d9565b015f5b8181106103ba5750506102be8284611093565b9160ff5f921692835f52600460205260405f2054105f146103a85750505f91815f52600460205260405f2054925b815b84811061035c57856040518091602082016020835281518091526020604084019201905f5b818110610321575050500390f35b825180516001600160a01b03168552602081810151818701526040918201519186019190915286955060609094019390920191600101610313565b816101de57600190845f5260046020526103a161037c8260405f20610fe0565b5061039061038a8785611086565b91611329565b61039a828b6118f0565b52886118f0565b50016102ee565b6103b490849294611093565b926102ec565b6020906103c561153e565b828289010152016102ab565b34610237576040366003190112610237576024356004811015610237576103fd6101da9160043561155c565b60409391935193849384610ff9565b34610237575f366003190112610237576020600654604051908152f35b34610237576060366003190112610237576004356001600160a01b03811690819003610237576024359060048210156102375760443590600a54610858576005546001600160a01b031633036108135761048660038414156112e5565b61048e61146d565b60048110156101de576003036107cf5760038310156107bb5782600101918254926006549182851015610787576007548110610722576104ce8584611086565b908181111561071a5750935b846104e58183611093565b936001549060025491600354908381115f1461070157818111156106fb57805b809481925b8d6106b65750149182156106ac575b5050915b80871492836106a4575b508261069a575b5050610677575b505081905561054261153e565b91808352602083018481526040840192835260ff861690815f52600460205260405f208054600160401b8110156106635761058291600182018155610fe0565b959095610650575185546001600160a01b0319166001600160a01b0391909116178555516001850181905583516002909501949094555f908152600460205260409020545f1981019590861161063c576020957f76d404f6c77a6e7654712999924e07301be3b256d4b99f65ccbef115a25496859461060e60a095519360405195865289860190610fd3565b604084015260608301526080820152a1610626611904565b610633575b604051908152f35b42600a5561062b565b634e487b7160e01b5f52601160045260245ffd5b634e487b7160e01b5f525f60045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b91925093505f19810190811161063c57806106929194611093565b908580610535565b109050888061052e565b92508a610527565b149050828b610519565b915060018d036106de575081149182156106d4575b50505b9161051d565b149050828b6106cb565b925081149182156106f1575b50506106ce565b149050828b6106ea565b81610505565b8184111561071457835b8094819261050a565b8161070b565b9050936104da565b60405162461bcd60e51b815260206004820152603760248201527f616c6c20616d6f756e7473206e65656420746f20626520626967676572206f7260448201527608195c5d585b081d1bc81cdd185c9d0819195c1bdcda5d604a1b6064820152608490fd5b60405162461bcd60e51b815260206004820152600c60248201526b105b1c9958591e48199d5b1b60a21b6044820152606490fd5b634e487b7160e01b5f52603260045260245ffd5b60405162461bcd60e51b815260206004820152601c60248201527b14de5cdd195b481a185cc8185b1c9958591e481d1a5b5959081bdd5d60221b6044820152606490fd5b60405162461bcd60e51b815260206004820152601e60248201527f4f6e6c7920536563757269747920506f6f6c2063616e206465706f73697400006044820152606490fd5b60405162461bcd60e51b815260206004820152602960248201527f53797374656d2068617320616c726561647920726561636865642061206e6f6e60448201526816b232b1b4b9b4b7b760b91b6064820152608490fd5b34610237575f366003190112610237576020600854604051908152f35b34610237575f36600319011261023757602061062b61151a565b34610237575f366003190112610237576020600a54604051908152f35b346102375760403660031901126102375760043560ff811680910361023757602435905f52600460205260405f209081548110156102375761094491610fe0565b5060018060a01b038154166101da6002600184015493015460405193849384610ff9565b34610237575f366003190112610237576005546040516001600160a01b039091168152602090f35b346102375760403660031901126102375760095460243590600435906001600160a01b03163303610ba9575f54610b725780821115610b2e578015610aeb57670de0b6b3a76400008110610a9a57670de0b6b3a76400008210610a4a576203f480420180421161063c577fedb371157a97763aaa1b348e6811cbb8c9eb299aaf93a6f5ba91f312bcb40fcf92606092825f558160065580600755610a34828261195a565b60085560405192835260208301526040820152a1005b60405162461bcd60e51b815260206004820152602260248201527f7468726573686f6c64206d757374206265206174206c6561737420312065746860448201526132b960f11b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f737461727420626f6e64206d757374206265206174206c6561737420312065746044820152623432b960e91b6064820152608490fd5b60405162461bcd60e51b815260206004820152601b60248201527a737461727420626f6e64206d75737420626520706f73697469766560281b6044820152606490fd5b606460405162461bcd60e51b815260206004820152602060248201527f7468726573686f6c64206d7573742065786365656420737461727420626f6e646044820152fd5b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610237575f366003190112610237576009546040516001600160a01b039091168152602090f35b34610237575f366003190112610237576020610c2761146d565b610c346040518092610fd3565bf35b3461023757602036600319011261023757602061062b600435611408565b346102375760203660031901126102375760043560038110156102375760209060010154604051908152f35b34610237575f36600319011261023757602061062b6113d4565b3461023757606036600319011261023757600435602435906004821015610237576044356001600160a01b0381169190829003610237576005546001600160a01b0316610ce833821461125b565b604051634fffd03760e01b815290602082600481845afa918215610e87575f92610ebf575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f91610e92575b506040516387ca99af60e01b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f91610e55575b5015610e18575f516020611a9c5f395f51905f52610e0991604094610d9d60038214156112e5565b60ff8116805f526004602052610dd2610dc1610dbb858a5f20610fe0565b50611329565b9660018060a01b038851161461135a565b5f5260046020525f6001610de884898420610fe0565b500155602060018060a01b03865116950151938492875193849388856113a6565b0390a182519182526020820152f35b60405162461bcd60e51b8152602060048201526015602482015274169bdb1d185c881a185cc81b9bdd08199bdc9ad959605a1b6044820152606490fd5b90506020813d602011610e7f575b81610e7060209383611032565b81010312610237575184610d75565b3d9150610e63565b6040513d5f823e3d90fd5b610eb29150823d8411610eb8575b610eaa8183611032565b8101906112c6565b86610d36565b503d610ea0565b6004919250610ee5602091823d8411610eed575b610edd8183611032565b8101906112a7565b929150610d0d565b503d610ed3565b34610237575f3660031901126102375760205f54604051908152f35b34610237575f36600319011261023757602061062b6111c9565b34610237575f366003190112610237576020600754604051908152f35b3461023757602036600319011261023757602061062b6004356110a0565b34610237575f366003190112610237576060604051610f848282611032565b369037604051610f9381611017565b60015481526002546020820152600354604082015260405190815f905b60038210610fbd57606084f35b6020806001928551815201930191019091610fb0565b9060048210156101de5752565b80548210156107bb575f52600360205f20910201905f90565b604091949392606082019560018060a01b0316825260208201520152565b606081019081106001600160401b0382111761066357604052565b601f909101601f19168101906001600160401b0382119082101761066357604052565b8181029291811591840414171561063c57565b8115611072570490565b634e487b7160e01b5f52601260045260245ffd5b9190820391821161063c57565b9190820180921161063c57565b6007546006549162409980811161119557801561118f5762409980811461118a576110d16240998091600854611055565b04620a939b810490620a939b8202828104620a939b148315171561063c576110f891611086565b90620f4240829083810180911161063c57926002915b6010831061113d575b5050509161112b91620f4240931b90611055565b0481811115611138575090565b905090565b8161114a91959395611055565b620f42408502858104620f4240148615171561063c5761116991611068565b9182156111845761117c83600192611093565b94019161110e565b93611117565b505090565b50905090565b60405162461bcd60e51b815260206004820152600c60248201526b496e76616c69642074696d6560a01b6044820152606490fd5b600154600254808210158061124f575b8015611238575b156111e9575090565b9080821015908161122b575b811561120b575b50611208575060035490565b90565b600354831015915081611220575b505f6111fc565b90508111155f611219565b60035483111591506111f5565b5060035482101580156111e05750808211156111e0565b506003548211156111d9565b1561126257565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c7920536563757269747920506f6f6c2063616e207769746864726177006044820152606490fd5b9081602091031261023757516001600160a01b03811681036102375790565b9081602091031261023757516001600160f81b03811681036102375790565b156112ec57565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b9060405161133681611017565b82546001600160a01b03168152600183015460208201526002909201546040830152565b1561136157565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c79206465706f736974206f776e65722063616e207769746864726177006044820152606490fd5b6001600160a01b039091168152608081019493926060926113cb906020840190610fd3565b60408201520152565b5f5442811015611403576113e89042611086565b624099808110156113fc57611208906110a0565b5060065490565b505f90565b60075490818111156114535760065481101561144a576114279161195a565b6240998081029080820462409980149015171561063c5760085461120891611068565b50506240998090565b50505f90565b9060ff8091169116019060ff821161063c57565b6114756113d4565b60015490808210611513576001915b600280549360ff906114b49085871061150a576114af60015b60035497881061150357600192611459565b611459565b1610156114fb57828111806114f2575b6114eb57821191826114e1575b50506114dc57600290565b600190565b1190505f806114d1565b5050505f90565b508181116114c4565b505050600390565b5f92611459565b6114af5f61149d565b5f91611484565b600a548061120857506112085f546115386115336111c9565b611408565b90611093565b6040519061154b82611017565b5f6040838281528260208201520152565b919060018060a01b036005541680331490811561185c575b50156117fa5760048110156101de5760016115c460ff8361159960035f9614156112e5565b169485845260046020526115b3610dbb8260408720610fe0565b958452600460205260408420610fe0565b50015581516020830180516001600160a01b039092169360406115e56111c9565b91019081518181115f146117605750505051915f5b600554604051634fffd03760e01b8152906001600160a01b0316602082600481845afa918215610e87575f9261173b575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f9161171e575b50604051634044d26360e11b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f916116ec575b50600654908181106116c1575b505060405f516020611abc5f395f51905f52918151908682526020820152a1565b6040916116e06116e5925f516020611abc5f395f51905f529598611055565b611068565b94916116a0565b90506020813d602011611716575b8161170760209383611032565b8101031261023757515f611693565b3d91506116fa565b6117359150823d8411610eb857610eaa8183611032565b5f611654565b6004919250611758602091823d8411610eed57610edd8183611032565b92915061162b565b61176f82918597955190611093565b11156117c05761178561178a9251865190611093565b611086565b928360011b908482046002148515171561063c57611785826117b560056117ba950497889451611086565b611093565b926115fa565b505082518060011b908082046002149015171561063c576005900492518060011b908082046002149015171561063c57836117ba91611086565b60405162461bcd60e51b815260206004820152603460248201527f4f6e6c7920536563757269747920506f6f6c206f722064657369676e6174656460448201527320666f726b65722063616e20776974686472617760601b6064820152608490fd5b604051631204b6bd60e31b81529150602090829060049082905afa908115610e87575f91611897575b506001600160a01b031633145f611574565b90506020813d6020116118d1575b816118b260209383611032565b8101031261023757516001600160a01b0381168103610237575f611885565b3d91506118a5565b6001600160401b0381116106635760051b60200190565b80518210156107bb5760209160051b010190565b600260ff61193e600154600654809110155f14611950576114af6001915b85548111611949576001905b6003541061150357600192611459565b1610156114dc575f90565b5f9061192e565b6114af5f91611922565b5f905b8060011b908082046002148115171561063c57818410611983575060019091019061195d565b61199b91509291926119958184611086565b92611093565b620f4240820291808304620f4240149015171561063c576119bb91611068565b90811561145357620a939b810290808204620a939b149015171561063c57620f42406119e78380611055565b6001919004835b60108310611a17575b5050506001600160ff1b038216820361063c576112089160011b90611093565b81611a2491959395611055565b600185901b906001600160ff1b038616860361063c575f19820182811161063c57611a4e91611055565b906001810180911161063c57620f4240810290808204620f4240149015171561063c57611a7a91611068565b918215611a9557611a8d83600192611093565b9401916119ee565b936119f756fe74839e2d346f4dd419b9f83f68e3802298d7bcceec5468ed97aa5abbb1c2764252b1aa0106c8f02c90bbf2a2a2589b772cfe95ba33c37c499c7cbdb7c8410ceda264697066735822122061fd77ac2b69d1a47a2a5f141cc4c059919aa9427c5db4ac9e4edfb4d8575dac64736f6c63430008210033'
		}
	}
}
export declare const peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_openOracle'
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
				{
					readonly name: '_reputationToken'
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ExecutedQueuedOperation'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operationId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'operation'
					readonly type: 'uint8'
					readonly internalType: 'enum OperationType'
					readonly indexed: false
				},
				{
					readonly name: 'success'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'errorMessage'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'PriceReported'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'executeQueuedOperation'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'operationId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'getQueuedOperation'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'tuple'
					readonly internalType: 'struct QueuedOperation'
					readonly components: readonly [
						{
							readonly name: 'operation'
							readonly type: 'uint8'
							readonly internalType: 'enum OperationType'
						},
						{
							readonly name: 'initiatorVault'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'targetVault'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'amount'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'snapshotTargetOwnership'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'snapshotTargetAllowance'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'snapshotTotalRep'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'snapshotDenominator'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getRequestPriceEthCost'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isPriceValid'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'lastPrice'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'lastSettlementTimestamp'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'openOracle'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'openOracleReportPrice'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'pendingReportId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'queuedOperationCounter'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'queuedOperations'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'operation'
					readonly type: 'uint8'
					readonly internalType: 'enum OperationType'
				},
				{
					readonly name: 'initiatorVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'targetVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTargetOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTargetAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTotalRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'queuedPendingOperationId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'requestPrice'
			readonly stateMutability: 'payable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'requestPriceIfNeededAndQueueOperation'
			readonly stateMutability: 'payable'
			readonly inputs: readonly [
				{
					readonly name: 'operation'
					readonly type: 'uint8'
					readonly internalType: 'enum OperationType'
				},
				{
					readonly name: 'targetVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'securityPool'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'setRepEthPrice'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_lastPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setSecurityPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60c03461009957601f6115d638819003918201601f19168301916001600160401b0383118484101761009d578084926040948552833981010312610099578051906001600160a01b038216820361009957602001516001600160a01b03811681036100995760805260a05260405161152490816100b28239608051816109a4015260a0518181816102ec01528181610c000152610e730152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f905f3560e01c908163044b25e814610e6157508063053f14da14610e44578063066530ba14610e265780630d0a761b14610d965780631604f9ea146109745780632a6f710c1461050f5780633611956c146104ea5780633b05cb0a1461047b5780633c4dee16146103fa57806343739382146102c05780635ef99e2c146102a3578063661a6e9d146102855780638e274f2d1461026757806392d9583614610145578063a697afb41461011c578063d3caa14e146100f95763e6602da8146100d9575f80fd5b346100f657806003193601126100f6576020600554604051908152f35b80fd5b50346100f657806003193601126100f6576020610114611497565b604051908152f35b50346100f657806003193601126100f6576004546040516001600160a01b039091168152602090f35b50346100f657806003193601126100f6576040816101009260e0835161016a81610edb565b82815282602082015282858201528260608201528260808201528260a08201528260c082015201526001548152600660205220604051906101aa82610edb565b8054906101ba60ff831684611477565b602083019160018060a01b039060081c16825260018060a01b03600182015416604084019081526002820154606085019081526003830154906080860191825260048401549260a08701938452600660058601549560c0890196875201549560e0880196875261022e604051809951610ea2565b516001600160a01b03908116602089015290511660408701525160608601525160808501525160a08401525160c08301525160e0820152f35b50346100f657806003193601126100f6576020600254604051908152f35b50346100f657806003193601126100f6576020600154604051908152f35b50346100f657806003193601126100f65760209054604051908152f35b50346100f65760a03660031901126100f6576004356024356102e0610eaf565b506102e9610ec5565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036103b95782548203610379577f105ef48e33e056f268bf84d375d020be5e62281274554de0094343712dd08ee791604091848055426002558060035582519182526020820152a160015480610369575080f35b6103729061107b565b8060015580f35b60405162461bcd60e51b81526020600482015260186024820152776e6f74207265706f7274206372656174656420627920757360401b6044820152606490fd5b60405162461bcd60e51b81526020600482015260196024820152781bdb9b1e481bdc195b881bdc9858db194818d85b8818d85b1b603a1b6044820152606490fd5b50346100f65760203660031901126100f6576004356001600160a01b03811690819003610477576004546001600160a01b038116610443576001600160a01b0319161760045580f35b60405162461bcd60e51b815260206004820152600c60248201526b616c7265616479207365742160a01b6044820152606490fd5b5080fd5b50346100f65760203660031901126100f6576004546001600160a01b031633036104a85760043560035580f35b60405162461bcd60e51b815260206004820152601a6024820152791bdb9b1e481cd958dd5c9a5d1e481c1bdbdb0818d85b881cd95d60321b6044820152606490fd5b50346100f657806003193601126100f6576020610505611483565b6040519015158152f35b5060603660031901126107d35760043560038110156107d3576024356001600160a01b038116908190036107d357604435801561092f576005545f19811461091b57600101918260055560018060a01b0360045416916040516328c16ded60e21b815282600482015260a081602481875afa9182156107c8575f915f936108e0575b50604051630a40d29760e21b8152602081600481895afa9081156107c8575f9161089b575b506040516370a0823160e01b8152600481018790529490602090869060249082906001600160a01b03165afa9485156107c8575f95610864575b5060206004966040519788809263021b50ff60e01b82525afa9586156107c8575f96610830575b5061062e604051986106288a610edb565b89611477565b602088019633885260408901918252606089019283526080890193845260a0890194855260c0890195865260e089019687525f52600660205260405f209751600381101561081c5760069760ff8a5491610100600160a81b03905160081b1692169060018060a81b03191617178855600188019060018060a01b0390511660018060a01b031982541617905551600287015551600386015551600485015551600584015551910155805f6106e0611483565b15610756576106fa906106f460055461107b565b3461142c565b806107025750f35b81808092335af1610711611439565b501561071a5780f35b60405162461bcd60e51b81526020600482015260146024820152730ccc2d2d8cac840e8de40e4cae8eae4dc40cae8d60631b6044820152606490fd5b60015415610768575b6106fa906106f4565b5050600554600155610778611497565b8034106107d75780303b156107d3575f60049160405192838092630b027cf560e11b8252305af180156107c8576107b2575b50819061075f565b6106fa92505f6107c191610ef7565b5f916107aa565b6040513d5f823e3d90fd5b5f80fd5b60405162461bcd60e51b815260206004820152601f60248201527f6e6f7420656e6f7567682065746820746f2072657175657374207072696365006044820152606490fd5b634e487b7160e01b5f52602160045260245ffd5b9095506020813d60201161085c575b8161084c60209383610ef7565b810103126107d35751945f610617565b3d915061083f565b9594506020863d602011610893575b8161088060209383610ef7565b810103126107d3579451939460206105f0565b3d9150610873565b90506020813d6020116108d8575b816108b660209383610ef7565b810103126107d35751936001600160a01b03851685036107d3579360206105b6565b3d91506108a9565b9150915060a0813d60a011610913575b816108fd60a09383610ef7565b810103126107d35760208151910151915f610591565b3d91506108f0565b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b815260206004820152601d60248201527f6e65656420746f20646f206e6f6e207a65726f206f7065726174696f6e0000006044820152606490fd5b5f3660031901126107d3575f54610d575761098d611497565b803410610d16576040516318160ddd60e01b8152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316602083600481845afa9283156107c8575f93610ce2575b504860011b4881046002144815171561091b57620186a0810290808204620186a0149015171561091b57604051936102408501906001600160401b03821186831017610cce57620186a0916040526406251cabf886520460208501526040840152606083015260b460808301525f60a08301525f60c083015273c02aaa39b223fe8d0a0e5c4f27ead9083c756cc260e0830152620f4240610100830152612710610120830152608c61014083015260016101608301525f6101808301525f6101a0830152306101c08301526321b9c9c160e11b6101e08301525f61020083015260016102208301526102206040519263f30ef90560e01b845280516004850152602081015160248501526040810151604485015260018060a01b03606082015116606485015265ffffffffffff608082015116608485015262ffffff60a08201511660a485015262ffffff60c08201511660c485015260018060a01b0360e08201511660e485015263ffffffff6101008201511661010485015262ffffff6101208201511661012485015261ffff61014082015116610144850152610160810151151561016485015261018081015115156101848501526101a081015115156101a485015260018060a01b036101c0820151166101c485015263ffffffff60e01b6101e0820151166101e485015260018060a01b036102008201511661020485015201511515610224830152602082610244818460018060a01b037f0000000000000000000000000000000000000000000000000000000000000000165af180156107c8575f90610c9a575b610c3c92505f553461142c565b80610c4357005b5f80808093335af1610c53611439565b5015610c5b57005b60405162461bcd60e51b81526020600482015260176024820152766661696c656420746f20726566756e642065786365737360481b6044820152606490fd5b506020823d602011610cc6575b81610cb460209383610ef7565b810103126107d357610c3c9151610c2f565b3d9150610ca7565b634e487b7160e01b5f52604160045260245ffd5b9092506020813d602011610d0e575b81610cfe60209383610ef7565b810103126107d3575191836109e3565b3d9150610cf1565b60405162461bcd60e51b81526020600482015260196024820152786e6f742062696720656e6f7567682065746820626f756e747960381b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276105b1c9958591e481c195b991a5b99c81c995c5d595cdd604a1b6044820152606490fd5b346107d35760203660031901126107d3576004355f52600660205261010060405f2080549060018060a01b036001820154169060028101546003820154600483015491600660058501549401549460405196610df58860ff8316610ea2565b60081c6001600160a01b0316602088015260408701526060860152608085015260a084015260c083015260e0820152f35b346107d35760203660031901126107d357610e4260043561107b565b005b346107d3575f3660031901126107d3576020600354604051908152f35b346107d3575f3660031901126107d3577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b90600382101561081c5752565b606435906001600160a01b03821682036107d357565b608435906001600160a01b03821682036107d357565b61010081019081106001600160401b03821117610cce57604052565b601f909101601f19168101906001600160401b03821190821017610cce57604052565b6001600160a01b039091168152602081019190915260400190565b9060a092610f499183526020830190610ea2565b60016040820152608060608201525f60808201520190565b5f9060033d11610f6d57565b905060045f803e5f5160e01c90565b5f60443d10610fe2576040513d600319016004823e8051916001600160401b0383113d602485011117610fed578183018051909390916001600160401b038311610fe5573d84016003190185840160200111610fe55750610fe292910160200190610ef7565b90565b949350505050565b92915050565b919261100960a094602093855283850190610ea2565b5f6040840152608060608401528051918291826080860152018484015e5f828201840152601f01601f1916010190565b9060c09261104d9183526020830190610ea2565b5f604082015260806060820152600d60808201526c2ab735b737bbb71032b93937b960991b60a08201520190565b5f90805f526006602052600260405f200154156113d95761109a611483565b15611394575f8181526006602052604081206002810180549290555460ff16600381101561081c576112875760018060a01b0360045416828452600660205260018060a01b03604085205460081c16838552600660205260018060a01b0360016040872001541691848652600660205260036040872001548587526006602052600460408820015486885260066020526005604089200154908789526006602052600660408a20015492843b15611283579360e4938a9795938897949388946040519b8c998a9863baea8cd360e01b8a5260048a0152602489015260448801526064870152608486015260a485015260c48401525af1918261126a575b505061123c5760016111a7610f61565b6308c379a0146111ed575b6111ba575050565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283611039565b0390a1565b6111f5610f7c565b80611201575b506111b2565b90505f5160206114cf5f395f51905f528391838552600660205260ff6040862054166112336040519283928784610ff3565b0390a15f6111fb565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283610f35565b8161127491610ef7565b61127f57825f611197565b8280fd5b8980fd5b815f52600660205260ff60405f205416600381101561081c5760010361131457600454828452600660205260408420546001600160a01b039182169160089190911c16813b15611310576112f69285928392836040518097819582946319ed4e0b60e21b845260048401610f1a565b03925af1918261126a57505061123c5760016111a7610f61565b8480fd5b6004545f838152600660205260409020546001600160a01b039182169260089190911c90911690823b156107d357611365925f92836040518096819582946376aad9b360e11b845260048401610f1a565b03925af1908161137f575b5061123c5760016111a7610f61565b61138c9193505f90610ef7565b5f915f611370565b60405162461bcd60e51b815260206004820152601d60248201527f7072696365206973206e6f742076616c696420746f20657865637574650000006044820152606490fd5b60405162461bcd60e51b815260206004820152602560248201527f6e6f2073756368206f7065726174696f6e206f7220616c72656164792065786560448201526418dd5d195960da1b6064820152608490fd5b9190820391821161091b57565b3d15611472573d906001600160401b038211610cce5760405191611467601f8201601f191660200184610ef7565b82523d5f602084013e565b606090565b600382101561081c5752565b600254610e10810180911161091b57421090565b4860021b4881046004144815171561091b576210c8e08102908082046210c8e0149015171561091b576065810180911161091b579056fe0392f08a9cc4b58edfbb67203b491ea1c706b0691caadcae5ab0c983455af709a2646970667358221220b81fe165076547a8a10a28ff70cdcc61de41fee8878400f5f819f6f547c0123c64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f905f3560e01c908163044b25e814610e6157508063053f14da14610e44578063066530ba14610e265780630d0a761b14610d965780631604f9ea146109745780632a6f710c1461050f5780633611956c146104ea5780633b05cb0a1461047b5780633c4dee16146103fa57806343739382146102c05780635ef99e2c146102a3578063661a6e9d146102855780638e274f2d1461026757806392d9583614610145578063a697afb41461011c578063d3caa14e146100f95763e6602da8146100d9575f80fd5b346100f657806003193601126100f6576020600554604051908152f35b80fd5b50346100f657806003193601126100f6576020610114611497565b604051908152f35b50346100f657806003193601126100f6576004546040516001600160a01b039091168152602090f35b50346100f657806003193601126100f6576040816101009260e0835161016a81610edb565b82815282602082015282858201528260608201528260808201528260a08201528260c082015201526001548152600660205220604051906101aa82610edb565b8054906101ba60ff831684611477565b602083019160018060a01b039060081c16825260018060a01b03600182015416604084019081526002820154606085019081526003830154906080860191825260048401549260a08701938452600660058601549560c0890196875201549560e0880196875261022e604051809951610ea2565b516001600160a01b03908116602089015290511660408701525160608601525160808501525160a08401525160c08301525160e0820152f35b50346100f657806003193601126100f6576020600254604051908152f35b50346100f657806003193601126100f6576020600154604051908152f35b50346100f657806003193601126100f65760209054604051908152f35b50346100f65760a03660031901126100f6576004356024356102e0610eaf565b506102e9610ec5565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036103b95782548203610379577f105ef48e33e056f268bf84d375d020be5e62281274554de0094343712dd08ee791604091848055426002558060035582519182526020820152a160015480610369575080f35b6103729061107b565b8060015580f35b60405162461bcd60e51b81526020600482015260186024820152776e6f74207265706f7274206372656174656420627920757360401b6044820152606490fd5b60405162461bcd60e51b81526020600482015260196024820152781bdb9b1e481bdc195b881bdc9858db194818d85b8818d85b1b603a1b6044820152606490fd5b50346100f65760203660031901126100f6576004356001600160a01b03811690819003610477576004546001600160a01b038116610443576001600160a01b0319161760045580f35b60405162461bcd60e51b815260206004820152600c60248201526b616c7265616479207365742160a01b6044820152606490fd5b5080fd5b50346100f65760203660031901126100f6576004546001600160a01b031633036104a85760043560035580f35b60405162461bcd60e51b815260206004820152601a6024820152791bdb9b1e481cd958dd5c9a5d1e481c1bdbdb0818d85b881cd95d60321b6044820152606490fd5b50346100f657806003193601126100f6576020610505611483565b6040519015158152f35b5060603660031901126107d35760043560038110156107d3576024356001600160a01b038116908190036107d357604435801561092f576005545f19811461091b57600101918260055560018060a01b0360045416916040516328c16ded60e21b815282600482015260a081602481875afa9182156107c8575f915f936108e0575b50604051630a40d29760e21b8152602081600481895afa9081156107c8575f9161089b575b506040516370a0823160e01b8152600481018790529490602090869060249082906001600160a01b03165afa9485156107c8575f95610864575b5060206004966040519788809263021b50ff60e01b82525afa9586156107c8575f96610830575b5061062e604051986106288a610edb565b89611477565b602088019633885260408901918252606089019283526080890193845260a0890194855260c0890195865260e089019687525f52600660205260405f209751600381101561081c5760069760ff8a5491610100600160a81b03905160081b1692169060018060a81b03191617178855600188019060018060a01b0390511660018060a01b031982541617905551600287015551600386015551600485015551600584015551910155805f6106e0611483565b15610756576106fa906106f460055461107b565b3461142c565b806107025750f35b81808092335af1610711611439565b501561071a5780f35b60405162461bcd60e51b81526020600482015260146024820152730ccc2d2d8cac840e8de40e4cae8eae4dc40cae8d60631b6044820152606490fd5b60015415610768575b6106fa906106f4565b5050600554600155610778611497565b8034106107d75780303b156107d3575f60049160405192838092630b027cf560e11b8252305af180156107c8576107b2575b50819061075f565b6106fa92505f6107c191610ef7565b5f916107aa565b6040513d5f823e3d90fd5b5f80fd5b60405162461bcd60e51b815260206004820152601f60248201527f6e6f7420656e6f7567682065746820746f2072657175657374207072696365006044820152606490fd5b634e487b7160e01b5f52602160045260245ffd5b9095506020813d60201161085c575b8161084c60209383610ef7565b810103126107d35751945f610617565b3d915061083f565b9594506020863d602011610893575b8161088060209383610ef7565b810103126107d3579451939460206105f0565b3d9150610873565b90506020813d6020116108d8575b816108b660209383610ef7565b810103126107d35751936001600160a01b03851685036107d3579360206105b6565b3d91506108a9565b9150915060a0813d60a011610913575b816108fd60a09383610ef7565b810103126107d35760208151910151915f610591565b3d91506108f0565b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b815260206004820152601d60248201527f6e65656420746f20646f206e6f6e207a65726f206f7065726174696f6e0000006044820152606490fd5b5f3660031901126107d3575f54610d575761098d611497565b803410610d16576040516318160ddd60e01b8152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316602083600481845afa9283156107c8575f93610ce2575b504860011b4881046002144815171561091b57620186a0810290808204620186a0149015171561091b57604051936102408501906001600160401b03821186831017610cce57620186a0916040526406251cabf886520460208501526040840152606083015260b460808301525f60a08301525f60c083015273c02aaa39b223fe8d0a0e5c4f27ead9083c756cc260e0830152620f4240610100830152612710610120830152608c61014083015260016101608301525f6101808301525f6101a0830152306101c08301526321b9c9c160e11b6101e08301525f61020083015260016102208301526102206040519263f30ef90560e01b845280516004850152602081015160248501526040810151604485015260018060a01b03606082015116606485015265ffffffffffff608082015116608485015262ffffff60a08201511660a485015262ffffff60c08201511660c485015260018060a01b0360e08201511660e485015263ffffffff6101008201511661010485015262ffffff6101208201511661012485015261ffff61014082015116610144850152610160810151151561016485015261018081015115156101848501526101a081015115156101a485015260018060a01b036101c0820151166101c485015263ffffffff60e01b6101e0820151166101e485015260018060a01b036102008201511661020485015201511515610224830152602082610244818460018060a01b037f0000000000000000000000000000000000000000000000000000000000000000165af180156107c8575f90610c9a575b610c3c92505f553461142c565b80610c4357005b5f80808093335af1610c53611439565b5015610c5b57005b60405162461bcd60e51b81526020600482015260176024820152766661696c656420746f20726566756e642065786365737360481b6044820152606490fd5b506020823d602011610cc6575b81610cb460209383610ef7565b810103126107d357610c3c9151610c2f565b3d9150610ca7565b634e487b7160e01b5f52604160045260245ffd5b9092506020813d602011610d0e575b81610cfe60209383610ef7565b810103126107d3575191836109e3565b3d9150610cf1565b60405162461bcd60e51b81526020600482015260196024820152786e6f742062696720656e6f7567682065746820626f756e747960381b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276105b1c9958591e481c195b991a5b99c81c995c5d595cdd604a1b6044820152606490fd5b346107d35760203660031901126107d3576004355f52600660205261010060405f2080549060018060a01b036001820154169060028101546003820154600483015491600660058501549401549460405196610df58860ff8316610ea2565b60081c6001600160a01b0316602088015260408701526060860152608085015260a084015260c083015260e0820152f35b346107d35760203660031901126107d357610e4260043561107b565b005b346107d3575f3660031901126107d3576020600354604051908152f35b346107d3575f3660031901126107d3577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b90600382101561081c5752565b606435906001600160a01b03821682036107d357565b608435906001600160a01b03821682036107d357565b61010081019081106001600160401b03821117610cce57604052565b601f909101601f19168101906001600160401b03821190821017610cce57604052565b6001600160a01b039091168152602081019190915260400190565b9060a092610f499183526020830190610ea2565b60016040820152608060608201525f60808201520190565b5f9060033d11610f6d57565b905060045f803e5f5160e01c90565b5f60443d10610fe2576040513d600319016004823e8051916001600160401b0383113d602485011117610fed578183018051909390916001600160401b038311610fe5573d84016003190185840160200111610fe55750610fe292910160200190610ef7565b90565b949350505050565b92915050565b919261100960a094602093855283850190610ea2565b5f6040840152608060608401528051918291826080860152018484015e5f828201840152601f01601f1916010190565b9060c09261104d9183526020830190610ea2565b5f604082015260806060820152600d60808201526c2ab735b737bbb71032b93937b960991b60a08201520190565b5f90805f526006602052600260405f200154156113d95761109a611483565b15611394575f8181526006602052604081206002810180549290555460ff16600381101561081c576112875760018060a01b0360045416828452600660205260018060a01b03604085205460081c16838552600660205260018060a01b0360016040872001541691848652600660205260036040872001548587526006602052600460408820015486885260066020526005604089200154908789526006602052600660408a20015492843b15611283579360e4938a9795938897949388946040519b8c998a9863baea8cd360e01b8a5260048a0152602489015260448801526064870152608486015260a485015260c48401525af1918261126a575b505061123c5760016111a7610f61565b6308c379a0146111ed575b6111ba575050565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283611039565b0390a1565b6111f5610f7c565b80611201575b506111b2565b90505f5160206114cf5f395f51905f528391838552600660205260ff6040862054166112336040519283928784610ff3565b0390a15f6111fb565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283610f35565b8161127491610ef7565b61127f57825f611197565b8280fd5b8980fd5b815f52600660205260ff60405f205416600381101561081c5760010361131457600454828452600660205260408420546001600160a01b039182169160089190911c16813b15611310576112f69285928392836040518097819582946319ed4e0b60e21b845260048401610f1a565b03925af1918261126a57505061123c5760016111a7610f61565b8480fd5b6004545f838152600660205260409020546001600160a01b039182169260089190911c90911690823b156107d357611365925f92836040518096819582946376aad9b360e11b845260048401610f1a565b03925af1908161137f575b5061123c5760016111a7610f61565b61138c9193505f90610ef7565b5f915f611370565b60405162461bcd60e51b815260206004820152601d60248201527f7072696365206973206e6f742076616c696420746f20657865637574650000006044820152606490fd5b60405162461bcd60e51b815260206004820152602560248201527f6e6f2073756368206f7065726174696f6e206f7220616c72656164792065786560448201526418dd5d195960da1b6064820152608490fd5b9190820391821161091b57565b3d15611472573d906001600160401b038211610cce5760405191611467601f8201601f191660200184610ef7565b82523d5f602084013e565b606090565b600382101561081c5752565b600254610e10810180911161091b57421090565b4860021b4881046004144815171561091b576210c8e08102908082046210c8e0149015171561091b576065810180911161091b579056fe0392f08a9cc4b58edfbb67203b491ea1c706b0691caadcae5ab0c983455af709a2646970667358221220b81fe165076547a8a10a28ff70cdcc61de41fee8878400f5f819f6f547c0123c64736f6c63430008210033'
		}
	}
}
export declare const peripherals_SecurityPool_SecurityPool: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_securityPoolForker'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_securityPoolFactory'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPoolFactory'
				},
				{
					readonly name: '_questionData'
					readonly type: 'address'
					readonly internalType: 'contract ZoltarQuestionData'
				},
				{
					readonly name: '_escalationGameFactory'
					readonly type: 'address'
					readonly internalType: 'contract EscalationGameFactory'
				},
				{
					readonly name: '_priceOracleManagerAndOperatorQueuer'
					readonly type: 'address'
					readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
				},
				{
					readonly name: '_shareToken'
					readonly type: 'address'
					readonly internalType: 'contract IShareToken'
				},
				{
					readonly name: '_openOracle'
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
				{
					readonly name: '_parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: '_zoltar'
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_securityMultiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_truthAuction'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'CreateCompleteSet'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'shareTokenSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'completeSetsToMint'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DepositRep'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'PerformLiquidation'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'callerVault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'targetVaultAddress'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'debtAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'debtToMove'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'repToMove'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'PerformWithdrawRep'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'PoolRetentionRateChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'retentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'RedeemFees'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'fees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'RedeemRep'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'caller'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'RedeemShares'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'redeemer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'sharesAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'ethValue'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'SecurityBondAllowanceChange'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'from'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'to'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'UpdateCollateralAmount'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'totalFeesOwedToVaults'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'UpdateVaultFees'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'feeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'unpaidEthFees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'activateForkMode'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'authorizeChildPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'pool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'cashToShares'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'eth'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'completeSetCollateralAmount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'configureVault'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'vaultFeeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'createCompleteSet'
			readonly stateMutability: 'payable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'currentRetentionRate'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'depositRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'depositToEscalationGame'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: 'maxAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'drainAllRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'escalationGame'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract EscalationGame'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'escalationGameFactory'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract EscalationGameFactory'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'feeIndex'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getVaultCount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getVaults'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'count'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'vaultRange'
					readonly type: 'address[]'
					readonly internalType: 'address[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'lastUpdatedFeeAccumulator'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'openOracle'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'parent'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'performLiquidation'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'callerVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'targetVaultAddress'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'debtAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTargetOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTargetAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTotalRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'performSetSecurityBondsAllowance'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'callerVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'performWithdrawRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'poolOwnershipDenominator'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'poolOwnershipToRep'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'priceOracleManagerAndOperatorQueuer'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionData'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ZoltarQuestionData'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'redeemCompleteSet'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'completeSetAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'redeemFees'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'redeemRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'redeemShares'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'repToPoolOwnership'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'repToken'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityMultiplier'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolFactory'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPoolFactory'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolForker'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityVaults'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'unpaidEthFees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'feeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'lockedRepInEscalationGame'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'setOwnershipDenominator'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setPoolFinancials'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newCollateral'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'newTotalBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setStartingParams'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_repEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setSystemState'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newState'
					readonly type: 'uint8'
					readonly internalType: 'enum SystemState'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setTotalShares'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newTotalShares'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'shareToken'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract IShareToken'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'shareTokenSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'sharesToCash'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'completeSetAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'systemState'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'enum SystemState'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalFeesOwedToVaults'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSecurityBondAllowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferEth'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address payable'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'truthAuction'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'universeId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'updateCollateralAmount'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'updateRetentionRate'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'updateVaultFees'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'withdrawFromEscalationGame'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: 'depositIndexes'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'zoltar'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
			]
		},
		{
			readonly type: 'receive'
			readonly stateMutability: 'payable'
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '6101c080604052346103e3576101a0816144c58038038091610021828561044f565b8339810103126103e35761003481610486565b60208201519091906001600160a01b038116908190036103e35760408201516001600160a01b03811691908290036103e3576060830151936001600160a01b03851685036103e35760808401516001600160a01b03811681036103e35760a0850151956001600160a01b03871687036103e35760c08601516001600160a01b03811681036103e35760e08701516001600160a01b038116978882036103e357610100810151906001600160a01b03821682036103e357610120810151976001600160f81b03891689036103e3576101408201519061011b6101806101608501519401610486565b9960a05260018060a01b0319600354161760035560805260075560c05260e05261016052610180526101405260018060a01b031660018060a01b031960025416176002556101a05260018060a01b03196001541617600155155f1461043d5760ff19601054166010555b6101005260c05160a051604051630a8ad82560e41b81526001600160f81b03909116600482015290602090829060249082906001600160a01b03165afa9081156103ef575f916103fa575b5061012081905260c05160405163095ea7b360e01b81526001600160a01b0391821660048201525f19602482015291602091839160449183915f91165af180156103ef576103b3575b60405161402a908161049b8239608051818181610cc401528181611b290152613c1d015260a05181818161036d01528181610b130152818161106e015281816116650152818161186b01528181611ddd0152818161209201528181612699015281816126e30152818161306b0152613b9f015260c0518181816103a901528181610b48015281816110b4015281816116a0015281816118a401528181611e25015281816120c70152818161263b01528181612722015281816130a30152613bd4015260e0518181816080015261259301526101005181818161196201528181611e8c0152818161203a0152818161279d0152612c2a0152610120518181816105370152818161085201528181610d2e01528181610f870152818161172401528181611c2e0152818161226701528181612b150152818161353f015281816136080152613991015261014051818181610405015281816110010152818161110b0152818161211d0152612a2401526101605181613273015261018051818181610ab60152610d9601526101a05181818160b20152611fd70152f35b6020813d6020116103e7575b816103cc6020938361044f565b810103126103e35751801515036103e3575f610219565b5f80fd5b3d91506103bf565b6040513d5f823e3d90fd5b90506020813d602011610435575b816104156020938361044f565b810103126103e357516001600160a01b03811681036103e35760206101d0565b3d9150610408565b600260ff196010541617601055610185565b601f909101601f19168101906001600160401b0382119082101761047257604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036103e35756fe60808060405260043610156100e0575b50361561001a575f80fd5b6002546001600160a01b0316331480156100ae575b801561007c575b1561003d57005b60405162461bcd60e51b81526020600482015260176024820152762ab730baba3437b934bd32b21022aa241039b2b73232b960491b6044820152606490fd5b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610036565b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161461002f565b5f905f3560e01c908163021b50ff146132a257508063044b25e81461325e578063094959b4146131f25780630f78dd98146131d5578063126c496214612ca05780631db2079f14612bec578063214e16e714612bce57806327c0a4f314612baf5780632801969714612b91578063287fa97314612b4457806329034a5c14612aff5780632986454714612ae15780632ac970c9146129ed5780633c4e2d04146129ce5780633d11a051146129375780633e50b4c4146126c857806344c094a314612683578063495e54211461266a5780634fffd0371461262557806359ae2fa81461260757806359d3b80a146125e05780635e452ae4146125c257806360f96a8f1461257d5780636640e2851461255457806367b5382c146120695780636c9fa59e1461202457806374d4e491146120065780637b7bab9d14611fc15780638c899c2e14611fa35780639025b5e814611f7a57806394614dbf14611dbc578063991292e314611d92578063999d115014611d69578063a305b7b414611d03578063a77384c114611cd3578063ae0255bc14611b4c578063b06a5c5214611b11578063b460481d1461184b578063b665feae14611644578063b8b1087114611616578063b948083c146115ef578063b98cca3714611589578063baea8cd314611030578063c20e976714610feb578063c37ffb8914610f30578063c4c2b5ea14610f17578063c5afa41414610ae5578063d46eecdf14610aa0578063d721cc7714610a70578063d76c4f9d14610a4e578063d9625212146109c8578063e9bb84c214610933578063ec32c8ca14610815578063ec7a9c1a146107f75763ed55b3660361000f57346107f45760403660031901126107f45761035e613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820152602480359291906020908290817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa80156107e95784906107b5575b6103eb915015613747565b61040360ff601054166103fd81613336565b1561338e565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061043933831461387d565b604051630d84655b60e21b8152602081600481865afa80156107aa5761046691869161077b575b506138b6565b61046f81613e5c565b60018060a01b038116808552600d60205260016040862001549261049e84610499876004546134c6565b6134a5565b600455818652600d602052846001604088200155818652600d6020526104c76040872054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f65760405163029f8a6d60e11b8152602081600481865afa80156106eb578890610747575b6105169150876134d3565b10156106af576040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161070a575b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657600460208154936040519283809263029f8a6d60e11b82525afa80156106eb5788906106b3575b6105c39150836134d3565b10156106af5760055411610656577f0cc729a57ccae35254cf96efe31c880c3b3a9f276261d86107b55263bd084b56938161062f928752600d602052670de0b6b3a764000060016040892001541080159061063d575b6106239150613930565b60405193849384613912565b0390a161063a6137b2565b80f35b508652600d602052610623600160408820015415610619565b60405162461bcd60e51b815260206004820152602b60248201527f6d696e74656420746f6f206d616e7920636f6d706c657465207365747320746f60448201526a20616c6c6f77207468697360a81b6064820152608490fd5b8580fd5b506020813d6020116106e3575b816106cd602093836132d2565b810103126106df576105c390516105b8565b5f80fd5b3d91506106c0565b6040513d8a823e3d90fd5b634e487b7160e01b87526011600452602487fd5b90506020813d602011610734575b81610725602093836132d2565b810103126106df57515f61056f565b3d9150610718565b6040513d89823e3d90fd5b506020813d602011610773575b81610761602093836132d2565b810103126106df57610516905161050b565b3d9150610754565b61079d915060203d6020116107a3575b61079581836132d2565b8101906133ee565b5f610460565b503d61078b565b6040513d87823e3d90fd5b506020813d6020116107e1575b816107cf602093836132d2565b810103126106df576103eb90516103e0565b3d91506107c2565b6040513d86823e3d90fd5b80fd5b50346107f457806003193601126107f4576020600954604051908152f35b50346107f457806003193601126107f45761083b60018060a01b03600254163314613354565b6040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f0575b506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b03925af180156108e5576108c9575080f35b6108e19060203d6020116107a35761079581836132d2565b5080f35b6040513d84823e3d90fd5b9250506020823d602011610920575b8161090c602093836132d2565b810103126106df5790518291906020610892565b3d91506108ff565b6040513d85823e3d90fd5b50346107f45760403660031901126107f457806004356001600160a01b038116908190036109c5578180809261097460018060a01b03600254163314613354565b602435905af16109826136ab565b501561098b5780f35b60405162461bcd60e51b81526020600482015260126024820152710ccc2d2d8cac840e8de40e6cadcc8408aa8960731b6044820152606490fd5b50fd5b50346107f45760803660031901126107f4576109e2613320565b6109f760018060a01b03600254163314613354565b6001600160a01b03811690610a1690610a11831515613f29565b613f65565b808252600d6020526024356040832055808252600d60205260443560016040842001558152600d602052606435600360408320015580f35b50346107f45760203660031901126107f45761063a610a6b613320565b613e5c565b50346107f45760203660031901126107f457610a9760018060a01b03600254163314613354565b60043560065580f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f4578060043560048110156109c5576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610edf575b50610b8b9015613747565b610b9d60ff601054166103fd81613336565b81546001600160a01b031615610cb2575b815460405163e2247da960e01b8152336004820152926020928492606492849290916001600160a01b031690610be381613336565b602484015260243560448401525af19081156108e5578291610c80575b50338252600d602052610c1b600460408420019182546134c6565b9055338152600d602052610c326040822054613976565b338252600d602052600460408320015411610c4a5780f35b60405162461bcd60e51b815260206004820152600e60248201526d04e6f7420656e6f756768205245560941b6044820152606490fd5b90506020813d602011610caa575b81610c9b602093836132d2565b810103126106df57515f610c00565b3d9150610c8e565b600154604051630258f95360e31b81527f00000000000000000000000000000000000000000000000000000000000000006004820152919250602090829060249082906001600160a01b03165afa908115610928578391610ead575b50421115610e6f57604051630238d35960e41b81528291906020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610e38575b506040516382579fc360e01b8152670de0b6b3a764000060048201526028909104602482015290602082604481867f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015610928578390610def575b83546001600160a01b0319166001600160a01b03919091161783559050610bae565b50906020813d602011610e30575b81610e0a602093836132d2565b81010312610e2c5751906001600160a01b0382168203610e2c57602091610dcd565b5050fd5b3d9150610dfd565b9250506020823d602011610e67575b81610e54602093836132d2565b810103126106df57602883925190610d66565b3d9150610e47565b60405162461bcd60e51b81526020600482015260166024820152751c5d595cdd1a5bdb881a185cc81b9bdd08195b99195960521b6044820152606490fd5b90506020813d602011610ed7575b81610ec8602093836132d2565b810103126106df57515f610d0e565b3d9150610ebb565b9250506020823d602011610f0f575b81610efb602093836132d2565b810103126106df57610b8b83925190610b80565b3d9150610eee565b50346107f457806003193601126107f45761063a613b88565b50346107f457806003193601126107f457610f5660018060a01b03600254163314613354565b600160ff196010541617601055610f6b613b88565b600c8190556040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f057506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760e03660031901126107f45761104a613320565b602435826001600160a01b038216808303611585576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526084359360c435916044359190606435906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161154d575b506110f79015613747565b61110960ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169361113f33861461387d565b604051630d84655b60e21b8152602081600481895afa9384156106eb5761117460209561117d9360049b9161153657506138b6565b610a6b8b613f65565b61118689613e5c565b806115205750670de0b6b3a76400009004925b60405163029f8a6d60e11b815295869182905afa93841561073c5787946114ec575b50600754926111d3856111ce86896134d3565b6134d3565b670de0b6b3a7640000840290848204670de0b6b3a764000014851517156114565711156114a857858211156114a15785925b831561146a5788956111ce6112268961122161125195896134d3565b6134e6565b966111ce87600160406112388c6135da565b9e828060a01b03169c8d8152600d6020522001546134c6565b858952600d60205261126f61126a8960408c20546134c6565b613976565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156114565711611411577f966090b9fc0bdd1d04cc16943b6c5be54254c04ae7aa5ba115bee12f8bce678b966112c48460a0986134a5565b828a52600d602052600160408b200155818952600d602052604089206112eb8282546134a5565b9055858952600d602052600160408a20016113078582546134c6565b9055858952600d60205261132060408a209182546134c6565b9055808852600d602052678ac7230489e8000061134060408a2054613976565b108015906113fd575b61135290613af0565b808852600d602052670de0b6b3a7640000600160408a200154108015906113e6575b61137d90613af0565b848852600d6020526113a5678ac7230489e8000061139e60408b2054613976565b1015613b3c565b848852600d6020526113c8670de0b6b3a7640000600160408b2001541015613b3c565b6040519485526020850152604084015260608301526080820152a180f35b50808852600d602052604088206001015415611374565b50808852600d602052604088205415611349565b60405162461bcd60e51b815260206004820152601d60248201527f4e657720706f6f6c20776f756c64206265206c697175696461626c65210000006044820152606490fd5b634e487b7160e01b8a52601160045260248afd5b60405162461bcd60e51b815260206004820152600f60248201526e6e6f206465627420746f206d6f766560881b6044820152606490fd5b8192611205565b60405162461bcd60e51b815260206004820152601c60248201527b7661756c74206e6565647320746f206265206c697175696461626c6560201b6044820152606490fd5b9093506020813d602011611518575b81611508602093836132d2565b810103126106df5751925f6111bb565b3d91506114fb565b6112216115309260a435906134d3565b92611199565b61079d9150873d89116107a35761079581836132d2565b9650506020863d60201161157d575b81611569602093836132d2565b810103126106df576110f7899651906110ec565b3d915061155c565b5080fd5b50346107f4576115a161159b366132bc565b90613a2c565b90604051918291602083016020845282518091526020604085019301915b8181106115cd575050500390f35b82516001600160a01b03168452859450602093840193909201916001016115bf565b50346107f45760203660031901126107f457602061160e600435613976565b604051908152f35b50346107f45760203660031901126107f457602061160e61163b6005546004356134d3565b600854906134e6565b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048281019190915235906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390611817575b6116e2915015613747565b6116f460ff601054166103fd81613336565b6116fd816135da565b6040516323b872dd60e01b815291906020838061171f853033600485016138f0565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19081156107e9577f266a200266d5d786f67674869101a74359975afe2100e4ebdb9e3621de2eb67c936117ab926117fa575b5061178a33613f65565b338552600d602052604085206117a18282546134c6565b90556006546134c6565b600655338352600d6020526117d6678ac7230489e800006117cf6040862054613976565b1015613930565b338352600d6020526040832054906117f46040519283923384613912565b0390a180f35b6118129060203d6020116107a35761079581836132d2565b611780565b506020813d602011611843575b81611831602093836132d2565b810103126106df576116e290516116d7565b3d9150611824565b50346107f457806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820181905282916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391611ad8575b50906118ea60249215613747565b6118fc60ff601054166103fd81613336565b60025460405163352dfc9760e11b81523060048201529260209184919082906001600160a01b03165afa918215610928578392611aa7575b5061193e82613336565b61194b6003831415613406565b604051630366d19d60e61b815260048101919091527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169161199481613336565b6024820152602081604481855afa908115610928578391611a6f575b506020916119d691604051948580948193631bc7955960e11b835233906004840161348c565b03925af180156108e5578290611a30575b5f516020613fd55f395f51905f529150611a0661163b600554836134d3565b90611a208480808086335af1611a1a6136ab565b506136e9565b6117f46040519283923384613912565b506020813d602011611a67575b81611a4a602093836132d2565b810103126106df575f516020613fd55f395f51905f5290516119e7565b3d9150611a3d565b9250506020823d602011611a9f575b81611a8b602093836132d2565b810103126106df57905182919060206119b0565b3d9150611a7e565b611aca91925060203d602011611ad1575b611ac281836132d2565b8101906133d6565b905f611934565b503d611ab8565b919250506020813d602011611b09575b81611af5602093836132d2565b810103126106df57518291906118ea6118dc565b3d9150611ae8565b50346107f457806003193601126107f45760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346107f45760203660031901126107f457611b66613320565b60025460405163352dfc9760e11b815230600482015290602090829060249082906001600160a01b03165afa90811561092857611bb8916003918591611cb4575b50611bb181613336565b1415613406565b611bc181613e5c565b6001600160a01b038116808352600d6020526040832054611bfb90611be590613976565b828552600d6020526004604086200154906134a5565b908352600d6020528260408120556040519163a9059cbb60e01b835260208380611c2985856004840161372c565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19283156107e9577f86a75ce05d96dd9f84d84175307eda113c08d1a36a7f47448229d90c1df7abdf93611c97575b506117f460405192839233846138f0565b611caf9060203d6020116107a35761079581836132d2565b611c86565b611ccd915060203d602011611ad157611ac281836132d2565b5f611ba7565b50346107f45760203660031901126107f457611cfa60018060a01b03600254163314613354565b60043560085580f35b50346107f45760203660031901126107f45760a0906040906001600160a01b03611d2b613320565b168152600d60205220805490600181015490600281015460046003830154920154926040519485526020850152604084015260608301526080820152f35b50346107f457806003193601126107f4576001546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f457602060ff6010541660405190611db881613336565b8152f35b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004808401919091529091839135906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa908115610928578391611f42575b50611e609015613747565b611e7260ff601054166103fd81613336565b611e7a613b88565b611e8961163b600554836134d3565b927f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15611f3e57828491611ee19383604051809681958294634a38db3160e11b8452339060048501613787565b03925af1801561092857611f29575b50818061063a94611f0482946008546134a5565b600855611f13816005546134a5565b600555611f1e6137b2565b335af1611a1a6136ab565b611f348380926132d2565b611585575f611ef0565b8380fd5b9250506020823d602011611f72575b81611f5e602093836132d2565b810103126106df57611e6084925190611e55565b3d9150611f51565b50346107f457806003193601126107f4576002546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600854604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600e54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f457612083613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390612520575b612109915015613747565b61211b60ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061215133831461387d565b604051630d84655b60e21b8152602081600481865afa80156107e95761217d91859161077b57506138b6565b6121886024356135da565b9061219a612194613504565b836134c6565b6001600160a01b038216808652600d6020526040862054909391111561251a5750818452600d6020526040842054915b6121d383613976565b92818652600d6020526121ed846104996040892054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657828752600d60205260016040882001546040519063029f8a6d60e11b82526020826004818b5afa90811561243e5789916124e4575b61224d92506134d3565b11612493576040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031695906020816024818a5afa80156106eb578690899061245d575b6122b392506134a5565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156124495760049060208254916040519384809263029f8a6d60e11b82525afa90811561243e578991612408575b61230892506134d3565b116123b557612331918652600d602052604086206123278282546134a5565b90556006546134a5565b6006556020604051809463a9059cbb60e01b825281878161235688886004840161372c565b03925af19283156107e9577fbbfe2b12a823e4f2b0b4b77b68e919461565bade7d192fd09011cd7f2721d5c893612398575b506117f46040519283928361372c565b6123b09060203d6020116107a35761079581836132d2565b612388565b60405162461bcd60e51b815260206004820152602560248201527f476c6f62616c20536563757269747920426f6e6420416c6c6f77616e636520626044820152643937b5b2b760d91b6064820152608490fd5b90506020823d602011612436575b81612423602093836132d2565b810103126106df576123089151906122fe565b3d9150612416565b6040513d8b823e3d90fd5b634e487b7160e01b88526011600452602488fd5b50506020813d60201161248b575b81612478602093836132d2565b810103126106df57856122b391516122a9565b3d915061246b565b60405162461bcd60e51b8152602060048201526024808201527f4c6f63616c20536563757269747920426f6e6420416c6c6f77616e636520627260448201526337b5b2b760e11b6064820152608490fd5b90506020823d602011612512575b816124ff602093836132d2565b810103126106df5761224d915190612243565b3d91506124f2565b916121ca565b506020813d60201161254c575b8161253a602093836132d2565b810103126106df5761210990516120fe565b3d915061252d565b50346107f457806003193601126107f4576003546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600554604051908152f35b50346107f457806003193601126107f457546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600454604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f45761063a6137b2565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03168152602090f35b50806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004830152906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa8015610928578390612903575b61275c915015613747565b61276e60ff601054166103fd81613336565b34156128cb5761277c613b88565b60045461278b600554346134c6565b1161287a578161279a3461366e565b917f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15612876578383916127f2938360405180968195829463d24cd71360e01b8452339060048501613787565b03925af180156108e557612861575b507fc4f182d89ad6e504359313de2a844d67bfc57e590dd6be312525703ed336225c606083612832816008546134c6565b9081600855612843346005546134c6565b908160055560405192835260208301526040820152a161063a6137b2565b8161286b916132d2565b61158557815f612801565b8280fd5b60405162461bcd60e51b8152602060048201526024808201527f6e6f20636170616369747920746f206372656174652074686174206d616e79206044820152637365747360e01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601060248201526f0dccacac840e8de40e6cadcc840cae8d60831b6044820152606490fd5b506020813d60201161292f575b8161291d602093836132d2565b810103126106df5761275c9051612751565b3d9150612910565b50346107f45760203660031901126107f4577f88df2253f70738a84fea9b6fb6a5eaaf426532c74425b93265d5fde54075af0a612972613320565b60018060a01b03811690818452600d6020526129bf8480808060026040822001548781988352600d6020528260026040822001556129b2826009546134a5565b6009555af1611a1a6136ab565b6117f46040519283928361372c565b50346107f45760203660031901126107f457602061160e60043561366e565b50346107f45760603660031901126107f4576003546001600160a01b03163303612a905742600a55600435600c55604435600555807f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b156109c557818091602460405180948193631d82e58560e11b8352833560048401525af180156108e557612a7f5750f35b81612a89916132d2565b6107f45780f35b60405162461bcd60e51b8152602060048201526024808201527f6f6e6c792063616c6c61626c65206279207365637572697479506f6f6c466163604482015263746f727960e01b6064820152608490fd5b50346107f457806003193601126107f4576020600b54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760203660031901126107f457600435600481101561158557612b7760018060a01b03600254163314613354565b612b8081613336565b60ff80196010541691161760105580f35b50346107f457806003193601126107f4576020600754604051908152f35b50346107f45760203660031901126107f457602061160e6004356135da565b50346107f457806003193601126107f4576020600c54604051908152f35b50346106df5760203660031901126106df576004356001600160a01b038116908190036106df57612c2860018060a01b03600254163314613354565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690813b156106df575f91602483926040519485938492635b52ebef60e11b845260048401525af18015612c9557612c87575080f35b612c9391505f906132d2565b005b6040513d5f823e3d90fd5b346106df5760403660031901126106df5760043560048110156106df57602435906001600160401b0382116106df57366023830112156106df57816004013591612ce983613309565b92612cf760405194856132d2565b8084526024602085019160051b830101913683116106df57602401905b8282106131c55750505f546001600160a01b0316919050811561317457612d4360ff601054166103fd81613336565b612d4c81613336565b600381146131375760025460405163352dfc9760e11b81523060048201529190602090839060249082906001600160a01b03165afa918215612c95575f92613116575b50612d9982613336565b6003821480938161305c575b8461300a575b50612db583613336565b801590613003575b612dc690613406565b5f5b8451811015612c93578315612f15575f80549091906040906001600160a01b03166064612df5848a613450565b5183519586938492633bdc2c0560e01b84526004840152612e1589613336565b8860248401523360448401525af18015612c95575f5f91612ed4575b6001935081905b848060a01b031691825f52600d602052600460405f2001612e5a8282546134a5565b905580821115612e9657612e7190612e76926134a5565b6135da565b905f52600d602052612e8d60405f209182546134c6565b90555b01612dc8565b808210612ea6575b505050612e90565b612eb391612e71916134a5565b905f52600d602052612eca60405f209182546134a5565b9055868080612e9e565b50506040823d8211612f0d575b81612eee604093836132d2565b810103126106df57816020612f04600194613478565b91015190612e31565b3d9150612ee1565b612f1e83613336565b612f2782613336565b828203612fce575f906060612f6860018060a01b03845416612f49848a613450565b51604051958680948193637dc5bcc960e11b835233906004840161348c565b03925af18015612c95575f5f915f90612f87575b600194509190612e38565b5050506060823d8211612fc6575b81612fa2606093836132d2565b810103126106df5781612fb6600193613478565b6020820151604090920151612f7c565b3d9150612f95565b60405162461bcd60e51b815260206004820152600d60248201526c57726f6e67206f7574636f6d6560981b6044820152606490fd5b5082612dbd565b60405163f7b2a8e360e01b8152919450602090829060049082905afa908115612c95575f9161303d575b50159285612dab565b613056915060203d6020116107a35761079581836132d2565b85613034565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201529094506020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916130e4575b50151593612da5565b90506020813d60201161310e575b816130ff602093836132d2565b810103126106df5751866130db565b3d91506130f2565b61313091925060203d602011611ad157611ac281836132d2565b9084612d8f565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526024808201527f657363616c6174696f6e2067616d65206e6565647320746f206265206465706c6044820152631bde595960e21b6064820152608490fd5b8135815260209182019101612d14565b346106df575f3660031901126106df576020600a54604051908152f35b346106df57613200366132bc565b9061321660018060a01b03600254163314613354565b80821061322557600555600455005b60405162461bcd60e51b8152602060048201526011602482015270189bdb99081a5b9cdd59999a58da595b9d607a1b6044820152606490fd5b346106df575f3660031901126106df576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346106df575f3660031901126106df576020906006548152f35b60409060031901126106df576004359060243590565b601f909101601f19168101906001600160401b038211908210176132f557604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116132f55760051b60200190565b600435906001600160a01b03821682036106df57565b6004111561334057565b634e487b7160e01b5f52602160045260245ffd5b1561335b57565b60405162461bcd60e51b815260206004820152600b60248201526a27b7363c902337b935b2b960a91b6044820152606490fd5b1561339557565b60405162461bcd60e51b815260206004820152601960248201527814de5cdd195b481a5cc81b9bdd081bdc195c985d1a5bdb985b603a1b6044820152606490fd5b908160209103126106df575160048110156106df5790565b908160209103126106df575180151581036106df5790565b1561340d57565b60405162461bcd60e51b815260206004820152601b60248201527a5175657374696f6e20686173206e6f742066696e616c697a65642160281b6044820152606490fd5b80518210156134645760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b51906001600160a01b03821682036106df57565b9081526001600160a01b03909116602082015260400190565b919082039182116134b257565b634e487b7160e01b5f52601160045260245ffd5b919082018092116134b257565b818102929181159184041417156134b257565b81156134f0570490565b634e487b7160e01b5f52601260045260245ffd5b6006545f81156135c557678ac7230489e8000082810292908304036134b2576040516370a0823160e01b8152306004820152916020836024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9182156135b95791613583575b61358092506134e6565b90565b90506020823d6020116135b1575b8161359e602093836132d2565b810103126106df57613580915190613576565b3d9150613591565b604051903d90823e3d90fd5b506a3c2f7086aed236c807a1b560251b919050565b6006548015613649576135ec916134d3565b6040516370a0823160e01b8152306004820152906020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916135835761358092506134e6565b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b6005548061369b5750670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b61122161358092600854906134d3565b3d156136e4573d906001600160401b0382116132f557604051916136d9601f8201601f1916602001846132d2565b82523d5f602084013e565b606090565b156136f057565b60405162461bcd60e51b81526020600482015260146024820152733330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b1561374e57565b60405162461bcd60e51b8152602060048201526011602482015270169bdb1d185c881a185cc8199bdc9ad959607a1b6044820152606490fd5b6001600160f81b0390911681526001600160a01b039091166020820152604081019190915260600190565b600454801561387a5760ff601054166137ca81613336565b61387a57600554906040519163420671d160e11b83526004830152602482015260208160448173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613847575b506020817f685712dbe95545a3f62ba5b3e15f5eca83a0d979dfba0c33ee395b45f1b8816a92600c55604051908152a1565b90506020813d602011613872575b81613862602093836132d2565b810103126106df57516020613815565b3d9150613855565b50565b1561388457565b60405162461bcd60e51b815260206004820152600a6024820152694f6e6c794f7261636c6560b01b6044820152606490fd5b156138bd57565b60405162461bcd60e51b815260206004820152600b60248201526a5374616c6520707269636560a81b6044820152606490fd5b6001600160a01b03918216815291166020820152604081019190915260600190565b604091949392606082019560018060a01b0316825260208201520152565b1561393757565b60405162461bcd60e51b81526020600482015260176024820152761b5a5b8819195c1bdcda5d081c995c5d5a5c995b595b9d604a1b6044820152606490fd5b6040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916139e0575b506139d790613580926134d3565b600654906134e6565b90506020813d602011613a0c575b816139fb602093836132d2565b810103126106df57516135806139c9565b3d91506139ee565b600e5481101561346457600e5f5260205f2001905f90565b9190600e54808410801590613ae8575b613acc5783613a4a916134a5565b80821015613ac557505b613a5d81613309565b613a6a60405191826132d2565b818152601f19613a7983613309565b0136602083013780935f5b838110613a915750505050565b80613aa6613aa1600193856134c6565b613a14565b838060a01b0391549060031b1c16613abe8286613450565b5201613a84565b9050613a54565b50509050604051613ade6020826132d2565b5f81525f36813790565b508115613a3c565b15613af757565b60405162461bcd60e51b815260206004820152601e60248201527f746172676574206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b15613b4357565b60405162461bcd60e51b815260206004820152601e60248201527f63616c6c6572206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b60045415613e5a576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015612c95575f90613e27575b600154604051630258f95360e31b81527f000000000000000000000000000000000000000000000000000000000000000060048201529250602090839060249082906001600160a01b03165afa918215612c95575f92613df3575b5080613dec57505b8042115f14613de657805b600a54818111613de157613c8c916134a5565b8015613ddd5760055490600c5490604051916367b870af60e01b835260048301526024820152670de0b6b3a7640000604482015260208160648173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613da3575b50613cff90670de0b6b3a7640000926134d3565b04613d0c816005546134a5565b90613d19826009546134c6565b9081600955670de0b6b3a7640000830292808404670de0b6b3a764000014901517156134b2577f6ff9a830210578ad4c7a059cea7ddaa46b3f205a71080d031c16d4070eeb82f093613d7b613d73604095600454906134e6565b600b546134c6565b600b55816005554281105f14613d9c575b600a5582519182526020820152a1565b5042613d8c565b90506020813d602011613dd5575b81613dbe602093836132d2565b810103126106df5751670de0b6b3a7640000613ceb565b3d9150613db1565b5050565b505050565b42613c79565b9050613c6e565b9091506020813d602011613e1f575b81613e0f602093836132d2565b810103126106df5751905f613c66565b3d9150613e02565b506020813d602011613e52575b81613e41602093836132d2565b810103126106df5760249051613c0b565b3d9150613e34565b565b7fa9b6a8e9daf01958ea6a93a4f548ee24e1cf49edc6eda0c8b4bd62b25af32f6f90613e86613b88565b6001600160a01b0381165f818152600d602052604090206001810154600b54600390920154929392670de0b6b3a764000091613ecc91613ec690856134a5565b906134d3565b0490835f52600d602052600360405f200155825f52600d602052613ef8600260405f20019182546134c6565b90555f918252600d60205260409182902060038101546002909101549251928392613f24929084613912565b0390a1565b15613f3057565b60405162461bcd60e51b815260206004820152600d60248201526c1a5b9d985b1a59081d985d5b1d609a1b6044820152606490fd5b6001600160a01b0316613f79811515613f29565b805f52600f60205260405f205461387a57600e54600160401b8110156132f557806001613fa99201600e55613a14565b81549060031b9083821b9160018060a01b03901b1916179055600e54905f52600f60205260405f205556feef7fb21fed1701a6c82b78d78bad1ddab67e41025c2d5078a1be2a3a238b4e62a2646970667358221220900f3b24dc65776ec870bcdd15a729e4f1117d4882abecb33bf72208912fd0fd64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60808060405260043610156100e0575b50361561001a575f80fd5b6002546001600160a01b0316331480156100ae575b801561007c575b1561003d57005b60405162461bcd60e51b81526020600482015260176024820152762ab730baba3437b934bd32b21022aa241039b2b73232b960491b6044820152606490fd5b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610036565b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161461002f565b5f905f3560e01c908163021b50ff146132a257508063044b25e81461325e578063094959b4146131f25780630f78dd98146131d5578063126c496214612ca05780631db2079f14612bec578063214e16e714612bce57806327c0a4f314612baf5780632801969714612b91578063287fa97314612b4457806329034a5c14612aff5780632986454714612ae15780632ac970c9146129ed5780633c4e2d04146129ce5780633d11a051146129375780633e50b4c4146126c857806344c094a314612683578063495e54211461266a5780634fffd0371461262557806359ae2fa81461260757806359d3b80a146125e05780635e452ae4146125c257806360f96a8f1461257d5780636640e2851461255457806367b5382c146120695780636c9fa59e1461202457806374d4e491146120065780637b7bab9d14611fc15780638c899c2e14611fa35780639025b5e814611f7a57806394614dbf14611dbc578063991292e314611d92578063999d115014611d69578063a305b7b414611d03578063a77384c114611cd3578063ae0255bc14611b4c578063b06a5c5214611b11578063b460481d1461184b578063b665feae14611644578063b8b1087114611616578063b948083c146115ef578063b98cca3714611589578063baea8cd314611030578063c20e976714610feb578063c37ffb8914610f30578063c4c2b5ea14610f17578063c5afa41414610ae5578063d46eecdf14610aa0578063d721cc7714610a70578063d76c4f9d14610a4e578063d9625212146109c8578063e9bb84c214610933578063ec32c8ca14610815578063ec7a9c1a146107f75763ed55b3660361000f57346107f45760403660031901126107f45761035e613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820152602480359291906020908290817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa80156107e95784906107b5575b6103eb915015613747565b61040360ff601054166103fd81613336565b1561338e565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061043933831461387d565b604051630d84655b60e21b8152602081600481865afa80156107aa5761046691869161077b575b506138b6565b61046f81613e5c565b60018060a01b038116808552600d60205260016040862001549261049e84610499876004546134c6565b6134a5565b600455818652600d602052846001604088200155818652600d6020526104c76040872054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f65760405163029f8a6d60e11b8152602081600481865afa80156106eb578890610747575b6105169150876134d3565b10156106af576040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161070a575b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657600460208154936040519283809263029f8a6d60e11b82525afa80156106eb5788906106b3575b6105c39150836134d3565b10156106af5760055411610656577f0cc729a57ccae35254cf96efe31c880c3b3a9f276261d86107b55263bd084b56938161062f928752600d602052670de0b6b3a764000060016040892001541080159061063d575b6106239150613930565b60405193849384613912565b0390a161063a6137b2565b80f35b508652600d602052610623600160408820015415610619565b60405162461bcd60e51b815260206004820152602b60248201527f6d696e74656420746f6f206d616e7920636f6d706c657465207365747320746f60448201526a20616c6c6f77207468697360a81b6064820152608490fd5b8580fd5b506020813d6020116106e3575b816106cd602093836132d2565b810103126106df576105c390516105b8565b5f80fd5b3d91506106c0565b6040513d8a823e3d90fd5b634e487b7160e01b87526011600452602487fd5b90506020813d602011610734575b81610725602093836132d2565b810103126106df57515f61056f565b3d9150610718565b6040513d89823e3d90fd5b506020813d602011610773575b81610761602093836132d2565b810103126106df57610516905161050b565b3d9150610754565b61079d915060203d6020116107a3575b61079581836132d2565b8101906133ee565b5f610460565b503d61078b565b6040513d87823e3d90fd5b506020813d6020116107e1575b816107cf602093836132d2565b810103126106df576103eb90516103e0565b3d91506107c2565b6040513d86823e3d90fd5b80fd5b50346107f457806003193601126107f4576020600954604051908152f35b50346107f457806003193601126107f45761083b60018060a01b03600254163314613354565b6040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f0575b506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b03925af180156108e5576108c9575080f35b6108e19060203d6020116107a35761079581836132d2565b5080f35b6040513d84823e3d90fd5b9250506020823d602011610920575b8161090c602093836132d2565b810103126106df5790518291906020610892565b3d91506108ff565b6040513d85823e3d90fd5b50346107f45760403660031901126107f457806004356001600160a01b038116908190036109c5578180809261097460018060a01b03600254163314613354565b602435905af16109826136ab565b501561098b5780f35b60405162461bcd60e51b81526020600482015260126024820152710ccc2d2d8cac840e8de40e6cadcc8408aa8960731b6044820152606490fd5b50fd5b50346107f45760803660031901126107f4576109e2613320565b6109f760018060a01b03600254163314613354565b6001600160a01b03811690610a1690610a11831515613f29565b613f65565b808252600d6020526024356040832055808252600d60205260443560016040842001558152600d602052606435600360408320015580f35b50346107f45760203660031901126107f45761063a610a6b613320565b613e5c565b50346107f45760203660031901126107f457610a9760018060a01b03600254163314613354565b60043560065580f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f4578060043560048110156109c5576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610edf575b50610b8b9015613747565b610b9d60ff601054166103fd81613336565b81546001600160a01b031615610cb2575b815460405163e2247da960e01b8152336004820152926020928492606492849290916001600160a01b031690610be381613336565b602484015260243560448401525af19081156108e5578291610c80575b50338252600d602052610c1b600460408420019182546134c6565b9055338152600d602052610c326040822054613976565b338252600d602052600460408320015411610c4a5780f35b60405162461bcd60e51b815260206004820152600e60248201526d04e6f7420656e6f756768205245560941b6044820152606490fd5b90506020813d602011610caa575b81610c9b602093836132d2565b810103126106df57515f610c00565b3d9150610c8e565b600154604051630258f95360e31b81527f00000000000000000000000000000000000000000000000000000000000000006004820152919250602090829060249082906001600160a01b03165afa908115610928578391610ead575b50421115610e6f57604051630238d35960e41b81528291906020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610e38575b506040516382579fc360e01b8152670de0b6b3a764000060048201526028909104602482015290602082604481867f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015610928578390610def575b83546001600160a01b0319166001600160a01b03919091161783559050610bae565b50906020813d602011610e30575b81610e0a602093836132d2565b81010312610e2c5751906001600160a01b0382168203610e2c57602091610dcd565b5050fd5b3d9150610dfd565b9250506020823d602011610e67575b81610e54602093836132d2565b810103126106df57602883925190610d66565b3d9150610e47565b60405162461bcd60e51b81526020600482015260166024820152751c5d595cdd1a5bdb881a185cc81b9bdd08195b99195960521b6044820152606490fd5b90506020813d602011610ed7575b81610ec8602093836132d2565b810103126106df57515f610d0e565b3d9150610ebb565b9250506020823d602011610f0f575b81610efb602093836132d2565b810103126106df57610b8b83925190610b80565b3d9150610eee565b50346107f457806003193601126107f45761063a613b88565b50346107f457806003193601126107f457610f5660018060a01b03600254163314613354565b600160ff196010541617601055610f6b613b88565b600c8190556040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f057506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760e03660031901126107f45761104a613320565b602435826001600160a01b038216808303611585576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526084359360c435916044359190606435906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161154d575b506110f79015613747565b61110960ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169361113f33861461387d565b604051630d84655b60e21b8152602081600481895afa9384156106eb5761117460209561117d9360049b9161153657506138b6565b610a6b8b613f65565b61118689613e5c565b806115205750670de0b6b3a76400009004925b60405163029f8a6d60e11b815295869182905afa93841561073c5787946114ec575b50600754926111d3856111ce86896134d3565b6134d3565b670de0b6b3a7640000840290848204670de0b6b3a764000014851517156114565711156114a857858211156114a15785925b831561146a5788956111ce6112268961122161125195896134d3565b6134e6565b966111ce87600160406112388c6135da565b9e828060a01b03169c8d8152600d6020522001546134c6565b858952600d60205261126f61126a8960408c20546134c6565b613976565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156114565711611411577f966090b9fc0bdd1d04cc16943b6c5be54254c04ae7aa5ba115bee12f8bce678b966112c48460a0986134a5565b828a52600d602052600160408b200155818952600d602052604089206112eb8282546134a5565b9055858952600d602052600160408a20016113078582546134c6565b9055858952600d60205261132060408a209182546134c6565b9055808852600d602052678ac7230489e8000061134060408a2054613976565b108015906113fd575b61135290613af0565b808852600d602052670de0b6b3a7640000600160408a200154108015906113e6575b61137d90613af0565b848852600d6020526113a5678ac7230489e8000061139e60408b2054613976565b1015613b3c565b848852600d6020526113c8670de0b6b3a7640000600160408b2001541015613b3c565b6040519485526020850152604084015260608301526080820152a180f35b50808852600d602052604088206001015415611374565b50808852600d602052604088205415611349565b60405162461bcd60e51b815260206004820152601d60248201527f4e657720706f6f6c20776f756c64206265206c697175696461626c65210000006044820152606490fd5b634e487b7160e01b8a52601160045260248afd5b60405162461bcd60e51b815260206004820152600f60248201526e6e6f206465627420746f206d6f766560881b6044820152606490fd5b8192611205565b60405162461bcd60e51b815260206004820152601c60248201527b7661756c74206e6565647320746f206265206c697175696461626c6560201b6044820152606490fd5b9093506020813d602011611518575b81611508602093836132d2565b810103126106df5751925f6111bb565b3d91506114fb565b6112216115309260a435906134d3565b92611199565b61079d9150873d89116107a35761079581836132d2565b9650506020863d60201161157d575b81611569602093836132d2565b810103126106df576110f7899651906110ec565b3d915061155c565b5080fd5b50346107f4576115a161159b366132bc565b90613a2c565b90604051918291602083016020845282518091526020604085019301915b8181106115cd575050500390f35b82516001600160a01b03168452859450602093840193909201916001016115bf565b50346107f45760203660031901126107f457602061160e600435613976565b604051908152f35b50346107f45760203660031901126107f457602061160e61163b6005546004356134d3565b600854906134e6565b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048281019190915235906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390611817575b6116e2915015613747565b6116f460ff601054166103fd81613336565b6116fd816135da565b6040516323b872dd60e01b815291906020838061171f853033600485016138f0565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19081156107e9577f266a200266d5d786f67674869101a74359975afe2100e4ebdb9e3621de2eb67c936117ab926117fa575b5061178a33613f65565b338552600d602052604085206117a18282546134c6565b90556006546134c6565b600655338352600d6020526117d6678ac7230489e800006117cf6040862054613976565b1015613930565b338352600d6020526040832054906117f46040519283923384613912565b0390a180f35b6118129060203d6020116107a35761079581836132d2565b611780565b506020813d602011611843575b81611831602093836132d2565b810103126106df576116e290516116d7565b3d9150611824565b50346107f457806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820181905282916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391611ad8575b50906118ea60249215613747565b6118fc60ff601054166103fd81613336565b60025460405163352dfc9760e11b81523060048201529260209184919082906001600160a01b03165afa918215610928578392611aa7575b5061193e82613336565b61194b6003831415613406565b604051630366d19d60e61b815260048101919091527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169161199481613336565b6024820152602081604481855afa908115610928578391611a6f575b506020916119d691604051948580948193631bc7955960e11b835233906004840161348c565b03925af180156108e5578290611a30575b5f516020613fd55f395f51905f529150611a0661163b600554836134d3565b90611a208480808086335af1611a1a6136ab565b506136e9565b6117f46040519283923384613912565b506020813d602011611a67575b81611a4a602093836132d2565b810103126106df575f516020613fd55f395f51905f5290516119e7565b3d9150611a3d565b9250506020823d602011611a9f575b81611a8b602093836132d2565b810103126106df57905182919060206119b0565b3d9150611a7e565b611aca91925060203d602011611ad1575b611ac281836132d2565b8101906133d6565b905f611934565b503d611ab8565b919250506020813d602011611b09575b81611af5602093836132d2565b810103126106df57518291906118ea6118dc565b3d9150611ae8565b50346107f457806003193601126107f45760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346107f45760203660031901126107f457611b66613320565b60025460405163352dfc9760e11b815230600482015290602090829060249082906001600160a01b03165afa90811561092857611bb8916003918591611cb4575b50611bb181613336565b1415613406565b611bc181613e5c565b6001600160a01b038116808352600d6020526040832054611bfb90611be590613976565b828552600d6020526004604086200154906134a5565b908352600d6020528260408120556040519163a9059cbb60e01b835260208380611c2985856004840161372c565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19283156107e9577f86a75ce05d96dd9f84d84175307eda113c08d1a36a7f47448229d90c1df7abdf93611c97575b506117f460405192839233846138f0565b611caf9060203d6020116107a35761079581836132d2565b611c86565b611ccd915060203d602011611ad157611ac281836132d2565b5f611ba7565b50346107f45760203660031901126107f457611cfa60018060a01b03600254163314613354565b60043560085580f35b50346107f45760203660031901126107f45760a0906040906001600160a01b03611d2b613320565b168152600d60205220805490600181015490600281015460046003830154920154926040519485526020850152604084015260608301526080820152f35b50346107f457806003193601126107f4576001546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f457602060ff6010541660405190611db881613336565b8152f35b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004808401919091529091839135906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa908115610928578391611f42575b50611e609015613747565b611e7260ff601054166103fd81613336565b611e7a613b88565b611e8961163b600554836134d3565b927f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15611f3e57828491611ee19383604051809681958294634a38db3160e11b8452339060048501613787565b03925af1801561092857611f29575b50818061063a94611f0482946008546134a5565b600855611f13816005546134a5565b600555611f1e6137b2565b335af1611a1a6136ab565b611f348380926132d2565b611585575f611ef0565b8380fd5b9250506020823d602011611f72575b81611f5e602093836132d2565b810103126106df57611e6084925190611e55565b3d9150611f51565b50346107f457806003193601126107f4576002546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600854604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600e54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f457612083613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390612520575b612109915015613747565b61211b60ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061215133831461387d565b604051630d84655b60e21b8152602081600481865afa80156107e95761217d91859161077b57506138b6565b6121886024356135da565b9061219a612194613504565b836134c6565b6001600160a01b038216808652600d6020526040862054909391111561251a5750818452600d6020526040842054915b6121d383613976565b92818652600d6020526121ed846104996040892054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657828752600d60205260016040882001546040519063029f8a6d60e11b82526020826004818b5afa90811561243e5789916124e4575b61224d92506134d3565b11612493576040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031695906020816024818a5afa80156106eb578690899061245d575b6122b392506134a5565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156124495760049060208254916040519384809263029f8a6d60e11b82525afa90811561243e578991612408575b61230892506134d3565b116123b557612331918652600d602052604086206123278282546134a5565b90556006546134a5565b6006556020604051809463a9059cbb60e01b825281878161235688886004840161372c565b03925af19283156107e9577fbbfe2b12a823e4f2b0b4b77b68e919461565bade7d192fd09011cd7f2721d5c893612398575b506117f46040519283928361372c565b6123b09060203d6020116107a35761079581836132d2565b612388565b60405162461bcd60e51b815260206004820152602560248201527f476c6f62616c20536563757269747920426f6e6420416c6c6f77616e636520626044820152643937b5b2b760d91b6064820152608490fd5b90506020823d602011612436575b81612423602093836132d2565b810103126106df576123089151906122fe565b3d9150612416565b6040513d8b823e3d90fd5b634e487b7160e01b88526011600452602488fd5b50506020813d60201161248b575b81612478602093836132d2565b810103126106df57856122b391516122a9565b3d915061246b565b60405162461bcd60e51b8152602060048201526024808201527f4c6f63616c20536563757269747920426f6e6420416c6c6f77616e636520627260448201526337b5b2b760e11b6064820152608490fd5b90506020823d602011612512575b816124ff602093836132d2565b810103126106df5761224d915190612243565b3d91506124f2565b916121ca565b506020813d60201161254c575b8161253a602093836132d2565b810103126106df5761210990516120fe565b3d915061252d565b50346107f457806003193601126107f4576003546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600554604051908152f35b50346107f457806003193601126107f457546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600454604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f45761063a6137b2565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03168152602090f35b50806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004830152906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa8015610928578390612903575b61275c915015613747565b61276e60ff601054166103fd81613336565b34156128cb5761277c613b88565b60045461278b600554346134c6565b1161287a578161279a3461366e565b917f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15612876578383916127f2938360405180968195829463d24cd71360e01b8452339060048501613787565b03925af180156108e557612861575b507fc4f182d89ad6e504359313de2a844d67bfc57e590dd6be312525703ed336225c606083612832816008546134c6565b9081600855612843346005546134c6565b908160055560405192835260208301526040820152a161063a6137b2565b8161286b916132d2565b61158557815f612801565b8280fd5b60405162461bcd60e51b8152602060048201526024808201527f6e6f20636170616369747920746f206372656174652074686174206d616e79206044820152637365747360e01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601060248201526f0dccacac840e8de40e6cadcc840cae8d60831b6044820152606490fd5b506020813d60201161292f575b8161291d602093836132d2565b810103126106df5761275c9051612751565b3d9150612910565b50346107f45760203660031901126107f4577f88df2253f70738a84fea9b6fb6a5eaaf426532c74425b93265d5fde54075af0a612972613320565b60018060a01b03811690818452600d6020526129bf8480808060026040822001548781988352600d6020528260026040822001556129b2826009546134a5565b6009555af1611a1a6136ab565b6117f46040519283928361372c565b50346107f45760203660031901126107f457602061160e60043561366e565b50346107f45760603660031901126107f4576003546001600160a01b03163303612a905742600a55600435600c55604435600555807f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b156109c557818091602460405180948193631d82e58560e11b8352833560048401525af180156108e557612a7f5750f35b81612a89916132d2565b6107f45780f35b60405162461bcd60e51b8152602060048201526024808201527f6f6e6c792063616c6c61626c65206279207365637572697479506f6f6c466163604482015263746f727960e01b6064820152608490fd5b50346107f457806003193601126107f4576020600b54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760203660031901126107f457600435600481101561158557612b7760018060a01b03600254163314613354565b612b8081613336565b60ff80196010541691161760105580f35b50346107f457806003193601126107f4576020600754604051908152f35b50346107f45760203660031901126107f457602061160e6004356135da565b50346107f457806003193601126107f4576020600c54604051908152f35b50346106df5760203660031901126106df576004356001600160a01b038116908190036106df57612c2860018060a01b03600254163314613354565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690813b156106df575f91602483926040519485938492635b52ebef60e11b845260048401525af18015612c9557612c87575080f35b612c9391505f906132d2565b005b6040513d5f823e3d90fd5b346106df5760403660031901126106df5760043560048110156106df57602435906001600160401b0382116106df57366023830112156106df57816004013591612ce983613309565b92612cf760405194856132d2565b8084526024602085019160051b830101913683116106df57602401905b8282106131c55750505f546001600160a01b0316919050811561317457612d4360ff601054166103fd81613336565b612d4c81613336565b600381146131375760025460405163352dfc9760e11b81523060048201529190602090839060249082906001600160a01b03165afa918215612c95575f92613116575b50612d9982613336565b6003821480938161305c575b8461300a575b50612db583613336565b801590613003575b612dc690613406565b5f5b8451811015612c93578315612f15575f80549091906040906001600160a01b03166064612df5848a613450565b5183519586938492633bdc2c0560e01b84526004840152612e1589613336565b8860248401523360448401525af18015612c95575f5f91612ed4575b6001935081905b848060a01b031691825f52600d602052600460405f2001612e5a8282546134a5565b905580821115612e9657612e7190612e76926134a5565b6135da565b905f52600d602052612e8d60405f209182546134c6565b90555b01612dc8565b808210612ea6575b505050612e90565b612eb391612e71916134a5565b905f52600d602052612eca60405f209182546134a5565b9055868080612e9e565b50506040823d8211612f0d575b81612eee604093836132d2565b810103126106df57816020612f04600194613478565b91015190612e31565b3d9150612ee1565b612f1e83613336565b612f2782613336565b828203612fce575f906060612f6860018060a01b03845416612f49848a613450565b51604051958680948193637dc5bcc960e11b835233906004840161348c565b03925af18015612c95575f5f915f90612f87575b600194509190612e38565b5050506060823d8211612fc6575b81612fa2606093836132d2565b810103126106df5781612fb6600193613478565b6020820151604090920151612f7c565b3d9150612f95565b60405162461bcd60e51b815260206004820152600d60248201526c57726f6e67206f7574636f6d6560981b6044820152606490fd5b5082612dbd565b60405163f7b2a8e360e01b8152919450602090829060049082905afa908115612c95575f9161303d575b50159285612dab565b613056915060203d6020116107a35761079581836132d2565b85613034565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201529094506020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916130e4575b50151593612da5565b90506020813d60201161310e575b816130ff602093836132d2565b810103126106df5751866130db565b3d91506130f2565b61313091925060203d602011611ad157611ac281836132d2565b9084612d8f565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526024808201527f657363616c6174696f6e2067616d65206e6565647320746f206265206465706c6044820152631bde595960e21b6064820152608490fd5b8135815260209182019101612d14565b346106df575f3660031901126106df576020600a54604051908152f35b346106df57613200366132bc565b9061321660018060a01b03600254163314613354565b80821061322557600555600455005b60405162461bcd60e51b8152602060048201526011602482015270189bdb99081a5b9cdd59999a58da595b9d607a1b6044820152606490fd5b346106df575f3660031901126106df576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346106df575f3660031901126106df576020906006548152f35b60409060031901126106df576004359060243590565b601f909101601f19168101906001600160401b038211908210176132f557604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116132f55760051b60200190565b600435906001600160a01b03821682036106df57565b6004111561334057565b634e487b7160e01b5f52602160045260245ffd5b1561335b57565b60405162461bcd60e51b815260206004820152600b60248201526a27b7363c902337b935b2b960a91b6044820152606490fd5b1561339557565b60405162461bcd60e51b815260206004820152601960248201527814de5cdd195b481a5cc81b9bdd081bdc195c985d1a5bdb985b603a1b6044820152606490fd5b908160209103126106df575160048110156106df5790565b908160209103126106df575180151581036106df5790565b1561340d57565b60405162461bcd60e51b815260206004820152601b60248201527a5175657374696f6e20686173206e6f742066696e616c697a65642160281b6044820152606490fd5b80518210156134645760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b51906001600160a01b03821682036106df57565b9081526001600160a01b03909116602082015260400190565b919082039182116134b257565b634e487b7160e01b5f52601160045260245ffd5b919082018092116134b257565b818102929181159184041417156134b257565b81156134f0570490565b634e487b7160e01b5f52601260045260245ffd5b6006545f81156135c557678ac7230489e8000082810292908304036134b2576040516370a0823160e01b8152306004820152916020836024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9182156135b95791613583575b61358092506134e6565b90565b90506020823d6020116135b1575b8161359e602093836132d2565b810103126106df57613580915190613576565b3d9150613591565b604051903d90823e3d90fd5b506a3c2f7086aed236c807a1b560251b919050565b6006548015613649576135ec916134d3565b6040516370a0823160e01b8152306004820152906020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916135835761358092506134e6565b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b6005548061369b5750670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b61122161358092600854906134d3565b3d156136e4573d906001600160401b0382116132f557604051916136d9601f8201601f1916602001846132d2565b82523d5f602084013e565b606090565b156136f057565b60405162461bcd60e51b81526020600482015260146024820152733330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b1561374e57565b60405162461bcd60e51b8152602060048201526011602482015270169bdb1d185c881a185cc8199bdc9ad959607a1b6044820152606490fd5b6001600160f81b0390911681526001600160a01b039091166020820152604081019190915260600190565b600454801561387a5760ff601054166137ca81613336565b61387a57600554906040519163420671d160e11b83526004830152602482015260208160448173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613847575b506020817f685712dbe95545a3f62ba5b3e15f5eca83a0d979dfba0c33ee395b45f1b8816a92600c55604051908152a1565b90506020813d602011613872575b81613862602093836132d2565b810103126106df57516020613815565b3d9150613855565b50565b1561388457565b60405162461bcd60e51b815260206004820152600a6024820152694f6e6c794f7261636c6560b01b6044820152606490fd5b156138bd57565b60405162461bcd60e51b815260206004820152600b60248201526a5374616c6520707269636560a81b6044820152606490fd5b6001600160a01b03918216815291166020820152604081019190915260600190565b604091949392606082019560018060a01b0316825260208201520152565b1561393757565b60405162461bcd60e51b81526020600482015260176024820152761b5a5b8819195c1bdcda5d081c995c5d5a5c995b595b9d604a1b6044820152606490fd5b6040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916139e0575b506139d790613580926134d3565b600654906134e6565b90506020813d602011613a0c575b816139fb602093836132d2565b810103126106df57516135806139c9565b3d91506139ee565b600e5481101561346457600e5f5260205f2001905f90565b9190600e54808410801590613ae8575b613acc5783613a4a916134a5565b80821015613ac557505b613a5d81613309565b613a6a60405191826132d2565b818152601f19613a7983613309565b0136602083013780935f5b838110613a915750505050565b80613aa6613aa1600193856134c6565b613a14565b838060a01b0391549060031b1c16613abe8286613450565b5201613a84565b9050613a54565b50509050604051613ade6020826132d2565b5f81525f36813790565b508115613a3c565b15613af757565b60405162461bcd60e51b815260206004820152601e60248201527f746172676574206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b15613b4357565b60405162461bcd60e51b815260206004820152601e60248201527f63616c6c6572206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b60045415613e5a576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015612c95575f90613e27575b600154604051630258f95360e31b81527f000000000000000000000000000000000000000000000000000000000000000060048201529250602090839060249082906001600160a01b03165afa918215612c95575f92613df3575b5080613dec57505b8042115f14613de657805b600a54818111613de157613c8c916134a5565b8015613ddd5760055490600c5490604051916367b870af60e01b835260048301526024820152670de0b6b3a7640000604482015260208160648173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613da3575b50613cff90670de0b6b3a7640000926134d3565b04613d0c816005546134a5565b90613d19826009546134c6565b9081600955670de0b6b3a7640000830292808404670de0b6b3a764000014901517156134b2577f6ff9a830210578ad4c7a059cea7ddaa46b3f205a71080d031c16d4070eeb82f093613d7b613d73604095600454906134e6565b600b546134c6565b600b55816005554281105f14613d9c575b600a5582519182526020820152a1565b5042613d8c565b90506020813d602011613dd5575b81613dbe602093836132d2565b810103126106df5751670de0b6b3a7640000613ceb565b3d9150613db1565b5050565b505050565b42613c79565b9050613c6e565b9091506020813d602011613e1f575b81613e0f602093836132d2565b810103126106df5751905f613c66565b3d9150613e02565b506020813d602011613e52575b81613e41602093836132d2565b810103126106df5760249051613c0b565b3d9150613e34565b565b7fa9b6a8e9daf01958ea6a93a4f548ee24e1cf49edc6eda0c8b4bd62b25af32f6f90613e86613b88565b6001600160a01b0381165f818152600d602052604090206001810154600b54600390920154929392670de0b6b3a764000091613ecc91613ec690856134a5565b906134d3565b0490835f52600d602052600360405f200155825f52600d602052613ef8600260405f20019182546134c6565b90555f918252600d60205260409182902060038101546002909101549251928392613f24929084613912565b0390a1565b15613f3057565b60405162461bcd60e51b815260206004820152600d60248201526c1a5b9d985b1a59081d985d5b1d609a1b6044820152606490fd5b6001600160a01b0316613f79811515613f29565b805f52600f60205260405f205461387a57600e54600160401b8110156132f557806001613fa99201600e55613a14565b81549060031b9083821b9160018060a01b03901b1916179055600e54905f52600f60205260405f205556feef7fb21fed1701a6c82b78d78bad1ddab67e41025c2d5078a1be2a3a238b4e62a2646970667358221220900f3b24dc65776ec870bcdd15a729e4f1117d4882abecb33bf72208912fd0fd64736f6c63430008210033'
		}
	}
}
export declare const peripherals_SecurityPoolForker_SecurityPoolForker: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_zoltar'
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ClaimAuctionProceeds'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'poolOwnershipAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'poolOwnershipDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'FinalizeAuction'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'repAvailable'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'migratedRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'repPurchased'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'poolOwnershipDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'InitiateSecurityPoolFork'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'repAtFork'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MigrateFromEscalationGame'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
					readonly indexed: false
				},
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
					readonly indexed: false
				},
				{
					readonly name: 'depositIndexes'
					readonly type: 'uint8[]'
					readonly internalType: 'uint8[]'
					readonly indexed: false
				},
				{
					readonly name: 'totalRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'newOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MigrateRepFromParent'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'parentSecurityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'parentPoolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MigrateVault'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
					readonly indexed: false
				},
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'securityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'parentLockedRepInEscalationGame'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TruthAuctionFinalized'
			readonly anonymous: false
			readonly inputs: readonly []
		},
		{
			readonly type: 'event'
			readonly name: 'TruthAuctionStarted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'repMigrated'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'repAtFork'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'claimAuctionProceeds'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'createChildUniverse'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'finalizeTruthAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'forkData'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'repAtFork'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'truthAuction'
					readonly type: 'address'
					readonly internalType: 'contract UniformPriceDualCapBatchAuction'
				},
				{
					readonly name: 'truthAuctionStarted'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'migratedRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'auctionedSecurityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'ownFork'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'forkZoltarWithOwnEscalationGame'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'getMigratedRep'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestionOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'initiateSecurityPoolFork'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'migrateFromEscalationGame'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: 'depositIndexes'
					readonly type: 'uint8[]'
					readonly internalType: 'uint8[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'migrateRepToZoltar'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'outcomeIndices'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'migrateVault'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'poolOwnershipToRep'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'repToPoolOwnership'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'startTruthAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'zoltar'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
			]
		},
		{
			readonly type: 'receive'
			readonly stateMutability: 'payable'
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60a03461009457601f61467938819003918201601f19168301916001600160401b038311848410176100985780849260209460405283398101031261009457516001600160a01b0381168103610094576080526040516145cc90816100ad8239608051818181611cf1015281816120cd015281816121ba0152818161228e01528181612dae0152818161352d01526139b80152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610070575b50361561001a575f80fd5b335f52600360205260ff60405f2054161561003157005b60405162461bcd60e51b81526020600482015260176024820152762ab730baba3437b934bd32b21022aa241039b2b73232b960491b6044820152606490fd5b5f905f3560e01c908163125cd27114612d225750806338886ac1146121e95780634fffd037146121a4578063631119681461200e5780636a5bf92e14611fd95780636d47431f14611fb15780637b06b1c514611f755780639de4889f14611f47578063a83f87ef14611c0d578063b41dca891461143c578063bd467c4114610f05578063d060af2b1461077d578063d6f7effc146106f5578063f118f2c9146106c55763f37b86b70361000f57346105225760803660031901126105225761013661326e565b61013e613300565b6044359060048210156106c157606435916001600160401b0383116106bd57366023840112156106bd57826004013590610177826132bb565b936101856040519586613284565b82855260208501906024829460051b820101903682116106b957602401915b81831061069b575050604051632ce9dc0560e11b8152956001600160a01b038116959150602087600481895afa96871561069057889761065f575b508588526001602052604088206101f5846132d2565b60ff84165f526020528260405f2060018060a01b0390541615610646575b505084875260016020526040872061022a836132d2565b60ff83165f90815260209190915260409020546001600160a01b0390811696169283156105f557939587956001600160a01b0388169591875b8451891015610380578a90606060ff60208c60051b8901015116604460405180958193633aac4d5960e21b8352600483015261029e8c6132d2565b8b60248301528c5af1918c8315610374578a918194610320575b506001600160a01b0316036102db576001916102d3916133ba565b980197610263565b60405162461bcd60e51b815260206004820152601e60248201527f6465706f73697420776173206e6f7420666f722074686973207661756c7400006044820152606490fd5b935050506060823d821161036c575b8161033c60609383613284565b81010312610368578151916001600160a01b03831683036103645760208a910151925f6102b8565b8c80fd5b8b80fd5b3d915061032f565b604051903d90823e3d90fd5b858a898d96976040516328c16ded60e21b815282600482015260a0816024818a5afa80156105af5789948a928b926105ba575b506103c86103c1898b61375d565b80976133ba565b91893b1561036857906103f28c93926040519586948594636cb1290960e11b86526004860161441a565b0381838b5af180156105af57908991610596575b5086905287602052600360408920016104208682546133ba565b90556040519360c0850192888652602086015261043c816132d2565b604085015260c060608501525180915260e083019790875b81811061057d57505050908086977f9b1da15579b64f2538e1975eebfa63926edabe92b503b4c9dd7f392efa11a85e9385608084015260a08301520390a16040516317914ab960e21b8152602081600481875afa908115610572578591610535575b506104d6916104c4916133ef565b83855284602052604085205490613402565b823b1561053057610500928492836040518096819582946374ddc26160e11b845260048401613384565b03925af18015610525576105115750f35b8161051b91613284565b6105225780f35b80fd5b6040513d84823e3d90fd5b505050fd5b9450506020843d60201161056a575b8161055160209383613284565b810103126105665792518493906104d66104b6565b5f80fd5b3d9150610544565b6040513d87823e3d90fd5b825160ff168a526020998a019990920191600101610454565b816105a091613284565b6105ab57878a610406565b8780fd5b6040513d8b823e3d90fd5b915094506105e0915060a03d60a0116105ee575b6105d88183613284565b8101906143f3565b50929050949091908c6103b3565b503d6105ce565b60405162461bcd60e51b8152602060048201526024808201527f657363616c6174696f6e2067616d65206e6565647320746f206265206465706c6044820152631bde595960e21b6064820152608490fd5b61065891610653826132d2565b61390a565b5f82610213565b61068291975060203d602011610689575b61067a8183613284565b810190613335565b955f6101df565b503d610670565b6040513d8a823e3d90fd5b823560ff811681036106b5578152602092830192016101a4565b8980fd5b8880fd5b8480fd5b8380fd5b50346105225760403660031901126105225760206106ed6106e461326e565b6024359061443e565b604051908152f35b50346105225760203660031901126105225760e0906040906001600160a01b0361071d61326e565b168152806020522060ff81549160018060a01b0360018201541690600281015460038201549060056004840154930154936040519687526020870152604086015260608501526080840152818116151560a084015260081c1660c0820152f35b5034610522576040366003190112610522578061079861326e565b6107a06132f0565b6001600160a01b03821691823b156105305760405163d76c4f9d60e01b8152336004820152848160248183885af1908115610572578591610ef0575b5083905260016020526040842060ff83165f526020528160405f2060018060a01b0390541615610ee0575b505081835260016020908152604080852060ff84165f90815292529020546001600160a01b031690813b156105305760405163d76c4f9d60e01b8152336004820152848160248183875af1908115610572578591610ecb575b5050823b15610530576040516362615af560e11b8152848160048183885af1908115610572578591610eb6575b50506040516328c16ded60e21b81523360048201529160a083602481875afa92831561057257859086908795610e8d575b506040516328c16ded60e21b81523360048201529160a083602481875afa91821561069057889389908a94610e62575b507f944157f2627ad30430728ee2c54f6b2ae1c72e340d7b7343be34435791a206d56060604051338152846020820152856040820152a16040516317914ab960e21b81526020816004818a5afa908115610c74578b91610e2d575b50604051630b35c5f560e31b81526020816004818b5afa908115610d7d578c91610df6575b5083610979916133ba565b873b156103685760405191630252566d60e21b8352600483015260248201528a81604481838b5af1908115610c74578b91610de1575b50859490508115610dda575b60405163021b50ff60e01b81529093906020816004818e5afa908115610d7d578c91610da5575b50151580610ce2575b610b39575b506109fd929394506133ba565b92803b156105ab57610a2a9388809460405196879586948593636cb1290960e11b8552336004860161441a565b03925af1908115610572578591610b24575b50506040516328c16ded60e21b81523360048201529160a083602481875afa928315610572578586918795610ae7575b506040805133815260ff9095166020860152840152606083015260808201525f5160206145775f395f51905f529060a090a1813b15610ae3578291608483926040519485938492636cb1290960e11b845233600485015282602485015282604485015260648401525af18015610525576105115750f35b5050fd5b60a0809496505f5160206145775f395f51905f52959350610b1492503d85116105ee576105d88183613284565b5096939593945090929050610a6c565b81610b2e91613284565b61053057835f610a3c565b610b5b91939450610b5490610b4e8a8961375d565b90613420565b80956133ba565b9381610c7f575b610b6c818761443e565b90868b528a602052600360408c2001610b868382546133ba565b9055610b96575b918493926109f0565b6040516317914ab960e21b81526020816004818d5afa908115610c74578b91610c3b575b50610bda91610bc8916133ef565b898b528a60205260408b205490613402565b883b156106b55789610c0191604051809381926374ddc26160e11b83528a60048401613384565b0381838d5af1908115610c30578a91610c1b575b50610b8d565b81610c2591613284565b6106b957885f610c15565b6040513d8c823e3d90fd5b9a505060208a3d602011610c6c575b81610c5760209383613284565b810103126105665798518a9990610bda610bba565b3d9150610c4a565b6040513d8d823e3d90fd5b604051632986454760e01b8152909350602081600481895afa908115610c30578a91610cad575b5092610b62565b9950506020893d602011610cda575b81610cc960209383613284565b81010312610566578998515f610ca6565b3d9150610cbc565b50604051630a40d29760e21b81526020816004818b5afa908115610d7d576024916020918e91610d88575b506040516370a0823160e01b8152600481018b905292839182906001600160a01b03165afa908115610d7d578c91610d48575b5015156109eb565b9b505060208b3d602011610d75575b81610d6460209383613284565b81010312610566578b9a515f610d40565b3d9150610d57565b6040513d8e823e3d90fd5b610d9f9150823d84116106895761067a8183613284565b5f610d0d565b9b505060208b3d602011610dd2575b81610dc160209383613284565b81010312610566578b9a515f6109e2565b3d9150610db4565b50896109bb565b81610deb91613284565b6106b557895f6109af565b9b505060208b3d602011610e25575b81610e1260209383613284565b810103126105665799518b9a908361096e565b3d9150610e05565b9a505060208a3d602011610e5a575b81610e4960209383613284565b81010312610566578a99515f610949565b3d9150610e3c565b91945050610e8091925060a03d60a0116105ee576105d88183613284565b509392905093905f6108ee565b915050610eaa91935060a03d60a0116105ee576105d88183613284565b9593915050905f6108be565b81610ec091613284565b61053057835f61088d565b81610ed591613284565b61053057835f610860565b610ee99161390a565b5f81610807565b81610efa91613284565b61053057835f6107dc565b503461052257606036600319011261052257610f1f61326e565b610f27613300565b60443591906001600160401b0383116106c157366023840112156106c157826004013591610f54836132bb565b93610f626040519586613284565b83855260208501906024829560061b820101903682116105ab57602401915b8183106113e55750505060018060a01b0381169081865260026020526040862060018060a01b0384165f5260205260ff60405f2054166113ae578186526020868152604080882060010154905163b3f05b9760e01b81529190829060049082906001600160a01b03165afa9081156113a3578791611374575b501561132f5781865260026020526040862060018060a01b0384165f5260205260405f20600160ff198254161790558186528560205260018060a01b03600160408820015416936040518095633be47cf160e01b8252886044830160018060a01b038816998a60048601526040602486015251809152606484019490825b8181106113075750505082908160409503925af19384156112fc5786946112c4575b508315611283576110ac84879261375d565b94604051906328c16ded60e21b8252600482015260a081602481865afa908115610525578290839261125d575b508383528260205260046110f387826040872001546133ef565b85855260208581526040808720600101549051633bec785360e11b815293849182906001600160a01b03165afa9081156105725789928692611221575b50611145929161113f91613402565b926133ba565b90843b156106c157839161116e6040519485938493636cb1290960e11b85528a6004860161441a565b038183875af180156105255761120c575b505060206004916040519283809263021b50ff60e01b82525afa9081156105725785916111cd575b506111c7905f5160206145575f395f51905f52946040519485948561441a565b0390a180f35b90506020813d602011611204575b816111e860209383613284565b8101031261056657515f5160206145575f395f51905f526111a7565b3d91506111db565b8161121691613284565b6106bd57845f61117f565b92509450506020813d602011611255575b8161123f60209383613284565b810103126105665751889388919061113f611130565b3d9150611232565b9050611278915060a03d60a0116105ee576105d88183613284565b50929150505f6110d9565b60405162461bcd60e51b8152602060048201526019602482015278446964206e6f7420707572636861736520616e797468696e6760381b6044820152606490fd5b9093506040813d6040116112f4575b816112e060409383613284565b810103126112f05751925f61109a565b8580fd5b3d91506112d3565b6040513d88823e3d90fd5b825180518852602090810151818901526040909701968b96508d945090920191600101611078565b60405162461bcd60e51b815260206004820152601d60248201527f41756374696f6e206e6565647320746f2062652066696e616c697a65640000006044820152606490fd5b611396915060203d60201161139c575b61138e8183613284565b81019061336c565b5f610ffa565b503d611384565b6040513d89823e3d90fd5b60405162461bcd60e51b815260206004820152600f60248201526e105b1c9958591e4810db185a5b5959608a1b6044820152606490fd5b6040833603126105ab57604080519081016001600160401b0381118282101761142857916020916040938452853581528286013583820152815201920191610f81565b634e487b7160e01b8a52604160045260248afd5b5034610522576020366003190112610522576001600160a01b0361145e61326e565b169081815280602052600260408220015462093a808101809111611bf957421115611bb75781815260208181526040808320600101549051633bec785360e11b8152939190849060049082906001600160a01b03165afa928315610525578293611b83575b5060405163991292e360e01b8152602081600481855afa908115611ad657906003918491611b54575b506114f6816132d2565b03611b0f57808252602082905260408220600101546001600160a01b0316803b156119e857828091600460405180948193634bb278f360e01b83525af18015611ad657908391611afa575b5050803b15611af65760405163287fa97360e01b815260048101839052828160248183865af18015611ad657908391611ae1575b50506040516360f96a8f60e01b8152602081600481855afa908115611ad6578391611a9c575b506001600160a01b03168083526020838152604080852054905163763d4e0d60e11b81529092918431919081600481885afa9081156112fc578691611a6a575b50808210611a5d576115f1602091600493613420565b925b604051630b35c5f560e31b815292839182905afa908115610572578591611a2b575b50604051630b35c5f560e31b8152602081600481885afa80156112fc5786906119f7575b611644915082613420565b848652856020526004604087200155833b156106bd5760405191630252566d60e21b835260048301526024820152838160448183875af180156119ec579084916119d3575b505080159384156118b4575b60405163021b50ff60e01b8152602081600481875afa908115610572578591611882575b5015611800575b839450828452836020526003604085200154906040519063021b50ff60e01b8252602082600481885afa9182156112fc5786926117c9575b506040516317914ab960e21b815292602084600481895afa9384156113a357879461177e575b509160a093915f5160206145375f395f51905f5295936040519485526020850152604084015260608301526080820152a1803b1561177b5781809160046040518094819363495e542160e01b83525af18015610525576105115750f35b50fd5b935090939195506020833d6020116117c1575b8161179e60209383613284565b810103126105665791518695919390925f5160206145375f395f51905f5261171e565b3d9150611791565b955090506020853d6020116117f8575b816117e660209383613284565b8101031261056657859451905f6116f8565b3d91506117d9565b670de0b6b3a7640000820294828604670de0b6b3a764000014171561186e578394833b156106bd576040519063d721cc7760e01b82526004820152848160248183885af1908115610572578591611859575b50506116c0565b8161186391613284565b61053057835f611852565b634e487b7160e01b84526011600452602484fd5b90506020813d6020116118ac575b8161189d60209383613284565b8101031261056657515f6116b9565b3d9150611890565b6118be8183613420565b801561196857838552846020526118dc8360036040882001546133ef565b670de0b6b3a7640000810290808204670de0b6b3a76400001490151715611954579061190791613402565b833b156106bd576040519063d721cc7760e01b82526004820152848160248183885af180156105725790859161193f575b5050611695565b8161194991613284565b6106c157835f611938565b634e487b7160e01b86526011600452602486fd5b50670de0b6b3a76400008202828104670de0b6b3a7640000148617156119bf57833b156106bd576040519063d721cc7760e01b82526004820152848160248183885af180156105725790859161193f575050611695565b634e487b7160e01b85526011600452602485fd5b816119dd91613284565b6119e857825f611689565b8280fd5b6040513d86823e3d90fd5b506020813d602011611a23575b81611a1160209383613284565b81010312610566576116449051611639565b3d9150611a04565b90506020813d602011611a55575b81611a4660209383613284565b8101031261056657515f611615565b3d9150611a39565b50506004602085926115f3565b90506020813d602011611a94575b81611a8560209383613284565b8101031261056657515f6115db565b3d9150611a78565b90506020813d602011611ace575b81611ab760209383613284565b810103126119e857611ac8906133db565b5f61159b565b3d9150611aaa565b6040513d85823e3d90fd5b81611aeb91613284565b611af657815f611575565b5080fd5b81611b0491613284565b611af657815f611541565b60405162461bcd60e51b815260206004820152601d60248201527f41756374696f6e206e6565647320746f206861766520737461727465640000006044820152606490fd5b611b76915060203d602011611b7c575b611b6e8183613284565b810190613354565b5f6114ec565b503d611b64565b9092506020813d602011611baf575b81611b9f60209383613284565b810103126105665751915f6114c3565b3d9150611b92565b60405162461bcd60e51b815260206004820152601a602482015279747275746841756374696f6e207374696c6c206f6e676f696e6760301b6044820152606490fd5b634e487b7160e01b82526011600452602482fd5b5034610522576020366003190112610522576001600160a01b03611c2f61326e565b16604051632ce9dc0560e11b8152602081600481855afa908115611ad6578391611f28575b506001600160a01b03168015159081611ec4575b5015611e70578082913b1561177b57604051637619646560e11b8152828160048183865af1908115611ad6578391611e5b575b5081905260208281526040808420600501805460ff1916600117905551630a40d29760e21b8152919082600481845afa918215611ad6578392611e3a575b5060405163095ea7b360e01b81526001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116600483018190525f19602484015293602091839160449183918991165af180156119ec57611e1d575b506040516344c094a360e01b815290602082600481845afa9182156119ec578492611de8575b506020600491604051928380926358352e2960e11b82525afa9081156119ec578491611db3575b50823b15610530576105009284928360405180968195829463c6b118c760e01b84526004840161339f565b9350506020833d602011611de0575b81611dcf60209383613284565b81010312610566578392515f611d88565b3d9150611dc2565b6004919250611e0e602091823d8411611e16575b611e068183613284565b810190613316565b929150611d61565b503d611dfc565b611e359060203d60201161139c5761138e8183613284565b611d3b565b611e5491925060203d6020116106895761067a8183613284565b905f611cd9565b81611e6591613284565b61177b57815f611c9b565b60405162461bcd60e51b815260206004820152602660248201527f657363616c6174696f6e2067616d6520686173206e6f742074726967676572656044820152656420666f726b60d01b6064820152608490fd5b604051630625c72960e51b81529150602090829060049082905afa908115611ad6578391611ef6575b5015155f611c68565b90506020813d602011611f20575b81611f1160209383613284565b8101031261056657515f611eed565b3d9150611f04565b611f41915060203d6020116106895761067a8183613284565b5f611c54565b503461052257604036600319011261052257611f72611f6461326e565b611f6c6132f0565b9061390a565b80f35b5034610522576020366003190112610522576020906003906040906001600160a01b03611fa061326e565b168152808452200154604051908152f35b50346105225760403660031901126105225760206106ed611fd061326e565b6024359061375d565b5034610522576020366003190112610522576020611ffd611ff861326e565b61342d565b6040519061200a816132d2565b8152f35b50346105225760403660031901126105225761202861326e565b906024356001600160401b038111611af65736602382011215611af657806004013592612054846132bb565b916120626040519384613284565b848352602083016024819660051b830101913683116112f057602401905b8282106121945750506040516344c094a360e01b81526001600160a01b039290921694919050602081600481885afa9081156119ec578491612175575b50938352602083905260408320547f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316949092853b156106bd5760405163580ff51f60e11b81526001600160f81b039092166004830152602482019390935260606044820152915160648301819052608483019190845b81811061215f57505050818394818581819503925af18015610525576105115750f35b825184526020938401939092019160010161213c565b61218e915060203d602011611e1657611e068183613284565b5f6120bd565b8135815260209182019101612080565b50346105225780600319360112610522576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5034610522576020366003190112610522576001600160a01b0361220b61326e565b169060405163991292e360e01b8152602081600481865afa90811561052557906002918391612d03575b5061223f816132d2565b03612cbe576040516344c094a360e01b8152602081600481865afa908115610525578291612c9f575b506040516387ca99af60e01b81526001600160f81b0390911660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610525578291612c6d575b506249d4008101809111611bf957421115612c1d57813b156105225760405163287fa97360e01b815260036004820152818160248183875af1801561052557908291612c08575b50829052806020524260026040832001556040516360f96a8f60e01b8152602081600481865afa908115610525578291612bce575b506001600160a01b0316803b15611af6576040516362615af560e11b8152828160048183865af18015611ad657908391612bb9575b50506040516317914ab960e21b8152602081600481855afa908115611ad6578391612b87575b50604051634644ce1760e11b8152602081600481865afa9081156119ec578491612b55575b50843b156106c1576040519063a77384c160e01b82526004820152838160248183895af180156119ec57908491612b40575b50849052826020527fcefe8ad955503f9a572bf3bae119bd56aa53c9b992fae3956df273320fd2bc71606060036040862001548486528560205260408620546040519185835260208301526040820152a183835260208381526040808520600301548486529185905284205411612a9357505060405163991292e360e01b8152602081600481865afa90811561052557906003918391612a74575b50612499816132d2565b03611b0f57818152602081905260408120600101546001600160a01b0316803b15611af657818091600460405180948193634bb278f360e01b83525af1801561052557908291612a5f575b5050813b156105225760405163287fa97360e01b815260048101829052818160248183875af1801561052557908291612a4a575b50506040516360f96a8f60e01b8152602081600481865afa908115610525578291612a10575b506001600160a01b03168082526020828152604080842054905163763d4e0d60e11b8152909492918331919081600481875afa9081156105725785916129de575b508082106129d157612595602091600493613420565b925b604051630b35c5f560e31b815292839182905afa9081156119ec57849161299f575b50604051630b35c5f560e31b8152602081600481875afa801561057257859061296b575b6125e8915082613420565b838552846020526004604086200155823b156106c15760405191630252566d60e21b835260048301526024820152828160448183865af18015611ad657908391612956575b5050821592831580612853575b5060405163021b50ff60e01b8152602081600481865afa9081156119ec578491612821575b501561279f575b82935081835282602052600360408420015460405163021b50ff60e01b8152602081600481875afa90811561057257859161276a575b506040516317914ab960e21b815291602083600481885afa9283156112fc578693612721575b50915f5160206145375f395f51905f52939160a093604051938452602084015286604084015260608301526080820152a1803b1561177b5781809160046040518094819363495e542160e01b83525af180156105255761051157505080f35b92509450916020823d602011612762575b8161273f60209383613284565b810103126105665790518594919290915f5160206145375f395f51905f526126c2565b3d9150612732565b9450506020843d602011612797575b8161278660209383613284565b81010312610566578493515f61269c565b3d9150612779565b670de0b6b3a7640000810293818504670de0b6b3a764000014171561280d578293823b15610530576040519063d721cc7760e01b82526004820152838160248183875af19081156119ec5784916127f8575b5050612666565b8161280291613284565b610ae357825f6127f1565b634e487b7160e01b83526011600452602483fd5b90506020813d60201161284b575b8161283c60209383613284565b8101031261056657515f61265f565b3d915061282f565b156128ea57818352826020526128708160036040862001546133ef565b670de0b6b3a7640000810290808204670de0b6b3a7640000149015171561186e578161289b91613402565b823b156106c1576040519063d721cc7760e01b82526004820152838160248183875af180156119ec579084916128d5575b50505b5f61263a565b816128df91613284565b6119e857825f6128cc565b670de0b6b3a76400008102818104670de0b6b3a76400001485171561186e57823b156106c1576040519063d721cc7760e01b82526004820152838160248183875af180156119ec57908491612941575b50506128cf565b8161294b91613284565b6119e857825f61293a565b8161296091613284565b611af657815f61262d565b506020813d602011612997575b8161298560209383613284565b81010312610566576125e890516125dd565b3d9150612978565b90506020813d6020116129c9575b816129ba60209383613284565b8101031261056657515f6125b9565b3d91506129ad565b5050600460208492612597565b90506020813d602011612a08575b816129f960209383613284565b8101031261056657515f61257f565b3d91506129ec565b90506020813d602011612a42575b81612a2b60209383613284565b81010312611af657612a3c906133db565b5f61253e565b3d9150612a1e565b81612a5491613284565b61052257805f612518565b81612a6991613284565b61052257805f6124e4565b612a8d915060203d602011611b7c57611b6e8183613284565b5f61248f565b92612b07612ac9849583865285602052610b4e612ab76003604089200154836133ef565b86885287602052604088205490613402565b918085528460205260018060a01b0360016040872001541693855284602052604085205490855284602052620f424060036040872001540490613420565b823b1561053057604484928360405195869485936313fb84ff60e21b8552600485015260248401525af180156105255761051157505080f35b81612b4a91613284565b6119e857825f6123f4565b90506020813d602011612b7f575b81612b7060209383613284565b8101031261056657515f6123c2565b3d9150612b63565b90506020813d602011612bb1575b81612ba260209383613284565b8101031261056657515f61239d565b3d9150612b95565b81612bc391613284565b611af657815f612377565b90506020813d602011612c00575b81612be960209383613284565b81010312611af657612bfa906133db565b5f612342565b3d9150612bdc565b81612c1291613284565b61052257805f61230d565b60405162461bcd60e51b815260206004820152602260248201527f6d6967726174696f6e2074696d65206e6565647320746f2070617373206669726044820152611cdd60f21b6064820152608490fd5b90506020813d602011612c97575b81612c8860209383613284565b8101031261056657515f6122c6565b3d9150612c7b565b612cb8915060203d602011611e1657611e068183613284565b5f612268565b60405162461bcd60e51b815260206004820152601f60248201527f53797374656d206e6565647320746f20626520696e206d6967726174696f6e006044820152606490fd5b612d1c915060203d602011611b7c57611b6e8183613284565b5f612235565b905034610566576020366003190112610566576001600160a01b03612d4561326e565b6344c094a360e01b83521690602081600481855afa90811561307f575f9161324f575b50604051632ce9dc0560e11b8152602081600481865afa90811561307f575f91613230575b506040516387ca99af60e01b81526001600160f81b038316600482018190527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169390929091602081602481885afa90811561307f575f916131fe575b50156131965760405163991292e360e01b8152602081600481895afa90811561307f575f91613177575b50612e26816132d2565b613136576001600160a01b031680159081156130db575b501561308a57833b156105665760405163c37ffb8960e01b81525f8160048183895af1801561307f5761306a575b50604051630a40d29760e21b8152859190602081600481895afa908115611ad657839161304b575b5060405163095ea7b360e01b8152600481018690525f19602482015291906001600160a01b031660208360448187855af19081156119ec57602493602092613030575b506040516370a0823160e01b815230600482015293849182905afa918215611ad6578392612ff9575b50843b156119e857604051636c5bf1ff60e11b815291839183918291612f2991906004840161339f565b038183885af1801561052557612fe4575b505060209060446040518094819363058955ef60e41b835230600484015260248301525afa908115611ad6578391612fb2575b508183528260205260408320558152806020527f3f7489307ff80de8619cce934d9ce55c8a09e1eaad1a44b1b39d9c01d4e2df2f60206040832054604051908152a180f35b90506020813d602011612fdc575b81612fcd60209383613284565b8101031261056657515f612f6d565b3d9150612fc0565b81612fee91613284565b6106c157835f612f3a565b925090506020823d602011613028575b8161301660209383613284565b8101031261056657859151905f612eff565b3d9150613009565b61304690833d851161139c5761138e8183613284565b612ed6565b613064915060203d6020116106895761067a8183613284565b5f612e93565b6130779195505f90613284565b5f935f612e6b565b6040513d5f823e3d90fd5b60405162461bcd60e51b815260206004820152602360248201527f7175657374696f6e20686173206265656e2066696e616c697a656420616c726560448201526261647960e81b6064820152608490fd5b604051630653891960e41b81529150602090829060049082905afa801561307f576003915f91613117575b50613110816132d2565b145f612e3d565b613130915060203d602011611b7c57611b6e8183613284565b5f613106565b60405162461bcd60e51b815260206004820152601960248201527814de5cdd195b481a5cc81b9bdd081bdc195c985d1a5bdb985b603a1b6044820152606490fd5b613190915060203d602011611b7c57611b6e8183613284565b5f612e1c565b60405162461bcd60e51b815260206004820152603a60248201527f5a6f6c746172206e6565647320746f206861766520666f726b6564206265666f604482015279726520536563757269747920506f6f6c2063616e20646f20736f60301b6064820152608490fd5b90506020813d602011613228575b8161321960209383613284565b8101031261056657515f612df2565b3d915061320c565b613249915060203d6020116106895761067a8183613284565b5f612d8d565b613268915060203d602011611e1657611e068183613284565b5f612d68565b600435906001600160a01b038216820361056657565b601f909101601f19168101906001600160401b038211908210176132a757604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116132a75760051b60200190565b600411156132dc57565b634e487b7160e01b5f52602160045260245ffd5b6024359060ff8216820361056657565b602435906001600160a01b038216820361056657565b9081602091031261056657516001600160f81b03811681036105665790565b9081602091031261056657516001600160a01b03811681036105665790565b90816020910312610566575160048110156105665790565b90816020910312610566575180151581036105665790565b6001600160a01b039091168152602081019190915260400190565b6001600160f81b039091168152602081019190915260400190565b919082018092116133c757565b634e487b7160e01b5f52601160045260245ffd5b51906001600160a01b038216820361056657565b818102929181159184041417156133c757565b811561340c570490565b634e487b7160e01b5f52601260045260245ffd5b919082039182116133c757565b60405163991292e360e01b81526001600160a01b039190911690602081600481855afa90811561307f575f9161373e575b50613468816132d2565b60018114613737576040516360f96a8f60e01b8152602081600481865afa90811561307f575f916136fd575b506001600160a01b0316806136c4575b506134ae816132d2565b156134ba575b50600390565b604051632ce9dc0560e11b815290602082600481845afa90811561307f576004925f926136a2575b50602090604051938480926344c094a360e01b82525afa91821561307f575f92613681575b506040516387ca99af60e01b81526001600160f81b0390921660048301526020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa91821561307f575f9261364d575b506001600160a01b0316908161357c575b506134b4565b60405163ca539aed60e01b8152602081600481865afa90811561307f575f9161361b575b5080421191826135fc575b50506135b75780613576565b602060049160405192838092630653891960e41b82525afa90811561307f575f916135e0575090565b6135f9915060203d602011611b7c57611b6e8183613284565b90565b80159250908215613611575b50505f806135ab565b1090505f80613608565b90506020813d602011613645575b8161363660209383613284565b8101031261056657515f6135a0565b3d9150613629565b9091506020813d602011613679575b8161366960209383613284565b810103126105665751905f613565565b3d915061365c565b61369b91925060203d602011611e1657611e068183613284565b905f613507565b60209192506136bd90823d84116106895761067a8183613284565b91906134e2565b5f525f60205260ff600560405f200154166136df575f6134a4565b505f525f60205260ff600560405f20015460081c166135f9816132d2565b90506020813d60201161372f575b8161371860209383613284565b8101031261056657613729906133db565b5f613494565b3d915061370b565b5050600390565b613757915060203d602011611b7c57611b6e8183613284565b5f61345e565b60405163021b50ff60e01b81526001600160a01b03919091169190602081600481865afa90811561307f575f916138d8575b50156138bb5760405163021b50ff60e01b815290602082600481865afa90811561307f575f91613885575b6137c492506133ef565b604051630a40d29760e21b815291602083600481845afa92831561307f575f93613863575b506040516370a0823160e01b8152600481019190915291602090839060249082906001600160a01b03165afa90811561307f575f9161382d575b6135f99250613402565b90506020823d60201161385b575b8161384860209383613284565b81010312610566576135f9915190613823565b3d915061383b565b602091935061387e90823d84116106895761067a8183613284565b92906137e9565b90506020823d6020116138b3575b816138a060209383613284565b81010312610566576137c49151906137ba565b3d9150613893565b670de0b6b3a7640000808202925081159183041417156133c75790565b90506020813d602011613902575b816138f360209383613284565b8101031261056657515f61378f565b3d91506138e6565b6001600160a01b039081165f81815260016020908152604080832060ff87168452909152812054909392166143b65760405163991292e360e01b8152602081600481855afa801561307f576001915f91614397575b50613969816132d2565b03614356576040516344c094a360e01b8152602081600481855afa90811561307f575f91614337575b506040516387ca99af60e01b81526001600160f81b0390911660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561307f575f91614305575b506249d40081018091116133c75742116142c8576040516344c094a360e01b8152602081600481855afa90811561307f575f916142a9575b50604080516001600160f81b039092166020830190815260ff851683830152908252613a55606083613284565b905190206040516317914ab960e21b81526001600160f81b039091169290602081600481865afa90811561307f575f91614277575b50604051630b35c5f560e31b8152602081600481875afa90811561307f575f91614245575b506040519163420671d160e11b83526004830152602482015260208160448173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af490811561307f575f91614213575b50604051636640e28560e01b815293602085600481875afa94851561307f575f956141cf575b5060405163364fd2cf60e11b8152602081600481885afa90811561307f575f9161418d575b506040516358352e2960e11b815295602087600481895afa96871561307f575f97614159575b50604051632801969760e01b8152936020856004818a5afa94851561307f575f95614125575b5060405163c20e976760e01b81526020816004818b5afa90811561307f575f916140e0575b5060405163029f8a6d60e11b81529190602090839060049082906001600160a01b03165afa91821561307f575f926140a5575b50915f91610104949360409788519b8c988997630a3bc40760e21b89528d60048a015260018060a01b0316602489015260448801526064870152608486015260a485015260c48401528160e484015260018060a01b03165af192831561307f575f905f94614054575b506001600160a01b039081165f8181526020818152604080832060058101805461ff001916600889901b61ff0016179055600190810180546001600160a01b03199081169a909716998a17905597835260038252808320805460ff19168917905586835296815286822060ff90951682529390935293909120805490911683179055803b1561056657604051631db2079f60e01b8152600481018390525f8160248183865af1801561307f5761403f575b50604051630a40d29760e21b8152602081600481865afa9081156119ec578491614020575b506040516370a0823160e01b81523060048201526001600160a01b039190911690602081602481855afa90811561057257908592918391613fe8575b50602091613d829160405194858094819363a9059cbb60e01b83528a60048401613384565b03925af180156119ec57613fcb575b508083528260205260ff6005604085200154165f14613f3e5760405163021b50ff60e01b8152602081600481855afa80156119ec578490613f0a575b613de49150828552846020526040852054906133ef565b90808452836020526004602060408620549260405192838092632ce9dc0560e11b82525afa908115610572576004916020918791613eed575b5060405163395ef62760e21b815292839182906001600160a01b03165afa908115610572578591613ebb575b508060011b90808204600214901517156119bf57613e7592916005613e6f9204906133ba565b90613402565b813b156119e857829160248392604051948593849263d721cc7760e01b845260048401525af1801561052557613ea9575050565b613eb4828092613284565b6105225750565b90506020813d602011613ee5575b81613ed660209383613284565b8101031261056657515f613e49565b3d9150613ec9565b613f049150823d84116106895761067a8183613284565b5f613e1d565b506020813d602011613f36575b81613f2460209383613284565b8101031261056657613de49051613dcd565b3d9150613f17565b60206004916040519283809263021b50ff60e01b82525afa908115611ad6578391613f99575b50813b156119e857829160248392604051948593849263d721cc7760e01b845260048401525af1801561052557613ea9575050565b90506020813d602011613fc3575b81613fb460209383613284565b8101031261056657515f613f64565b3d9150613fa7565b613fe39060203d60201161139c5761138e8183613284565b613d91565b9250506020823d602011614018575b8161400460209383613284565b810103126105665790518491906020613d5d565b3d9150613ff7565b614039915060203d6020116106895761067a8183613284565b5f613d21565b61404c9193505f90613284565b5f915f613cfc565b9350506040833d60401161409d575b8161407060409383613284565b81010312610566576020614083846133db565b930151926001600160a01b0384168403610566575f613c4b565b3d9150614063565b915092916020823d6020116140d8575b816140c260209383613284565b8101031261056657905191929091906040613be2565b3d91506140b5565b90506020813d60201161411d575b816140fb60209383613284565b810103126105665751906001600160a01b038216820361056657906020613baf565b3d91506140ee565b9094506020813d602011614151575b8161414160209383613284565b810103126105665751935f613b8a565b3d9150614134565b9096506020813d602011614185575b8161417560209383613284565b810103126105665751955f613b64565b3d9150614168565b90506020813d6020116141c7575b816141a860209383613284565b8101031261056657516001600160a01b0381168103610566575f613b3e565b3d915061419b565b9094506020813d60201161420b575b816141eb60209383613284565b8101031261056657516001600160a01b038116810361056657935f613b19565b3d91506141de565b90506020813d60201161423d575b8161422e60209383613284565b8101031261056657515f613af3565b3d9150614221565b90506020813d60201161426f575b8161426060209383613284565b8101031261056657515f613aaf565b3d9150614253565b90506020813d6020116142a1575b8161429260209383613284565b8101031261056657515f613a8a565b3d9150614285565b6142c2915060203d602011611e1657611e068183613284565b5f613a28565b60405162461bcd60e51b81526020600482015260156024820152741b5a59dc985d1a5bdb881d1a5b59481c185cdcd959605a1b6044820152606490fd5b90506020813d60201161432f575b8161432060209383613284565b8101031261056657515f6139f0565b3d9150614313565b614350915060203d602011611e1657611e068183613284565b5f613992565b60405162461bcd60e51b8152602060048201526019602482015278141bdbdb081b9959591cc81d1bc81a185d9948199bdc9ad959603a1b6044820152606490fd5b6143b0915060203d602011611b7c57611b6e8183613284565b5f61395f565b60405162461bcd60e51b815260206004820152601560248201527418da1a5b1908185b1c9958591e4818dc99585d1959605a1b6044820152606490fd5b908160a0910312610566578051916020820151916040810151916080606083015192015190565b90949392606092608083019660018060a01b03168352602083015260408201520152565b604051630a40d29760e21b8152916001600160a01b039190911690602083600481855afa92831561307f576024936020915f91614519575b506040516370a0823160e01b81526004810185905294859182906001600160a01b03165afa92831561307f575f936144e3575b506144b86004936020926133ef565b916040519384809263021b50ff60e01b82525afa90811561307f575f9161382d576135f99250613402565b92506020833d602011614511575b816144fe60209383613284565b81010312610566579151916144b86144a9565b3d91506144f1565b6145309150823d84116106895761067a8183613284565b5f61447656fe6c004d10f5e2ee616b60bd56d47587f548f392787a1162d17f99b2ea6ebdb5330a75091c2aae3857681c56cf772bf513775bab6d53381145acc8b3b8b394983a7096c7b34f3d00f4c47c73b7ae24a876517405a19573a676af664fc2ec9ea8eba26469706673582212205cf265f779d3c75bf0fb4fc0fbb486175468011d64b11783fdcbdb289dad3af064736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610070575b50361561001a575f80fd5b335f52600360205260ff60405f2054161561003157005b60405162461bcd60e51b81526020600482015260176024820152762ab730baba3437b934bd32b21022aa241039b2b73232b960491b6044820152606490fd5b5f905f3560e01c908163125cd27114612d225750806338886ac1146121e95780634fffd037146121a4578063631119681461200e5780636a5bf92e14611fd95780636d47431f14611fb15780637b06b1c514611f755780639de4889f14611f47578063a83f87ef14611c0d578063b41dca891461143c578063bd467c4114610f05578063d060af2b1461077d578063d6f7effc146106f5578063f118f2c9146106c55763f37b86b70361000f57346105225760803660031901126105225761013661326e565b61013e613300565b6044359060048210156106c157606435916001600160401b0383116106bd57366023840112156106bd57826004013590610177826132bb565b936101856040519586613284565b82855260208501906024829460051b820101903682116106b957602401915b81831061069b575050604051632ce9dc0560e11b8152956001600160a01b038116959150602087600481895afa96871561069057889761065f575b508588526001602052604088206101f5846132d2565b60ff84165f526020528260405f2060018060a01b0390541615610646575b505084875260016020526040872061022a836132d2565b60ff83165f90815260209190915260409020546001600160a01b0390811696169283156105f557939587956001600160a01b0388169591875b8451891015610380578a90606060ff60208c60051b8901015116604460405180958193633aac4d5960e21b8352600483015261029e8c6132d2565b8b60248301528c5af1918c8315610374578a918194610320575b506001600160a01b0316036102db576001916102d3916133ba565b980197610263565b60405162461bcd60e51b815260206004820152601e60248201527f6465706f73697420776173206e6f7420666f722074686973207661756c7400006044820152606490fd5b935050506060823d821161036c575b8161033c60609383613284565b81010312610368578151916001600160a01b03831683036103645760208a910151925f6102b8565b8c80fd5b8b80fd5b3d915061032f565b604051903d90823e3d90fd5b858a898d96976040516328c16ded60e21b815282600482015260a0816024818a5afa80156105af5789948a928b926105ba575b506103c86103c1898b61375d565b80976133ba565b91893b1561036857906103f28c93926040519586948594636cb1290960e11b86526004860161441a565b0381838b5af180156105af57908991610596575b5086905287602052600360408920016104208682546133ba565b90556040519360c0850192888652602086015261043c816132d2565b604085015260c060608501525180915260e083019790875b81811061057d57505050908086977f9b1da15579b64f2538e1975eebfa63926edabe92b503b4c9dd7f392efa11a85e9385608084015260a08301520390a16040516317914ab960e21b8152602081600481875afa908115610572578591610535575b506104d6916104c4916133ef565b83855284602052604085205490613402565b823b1561053057610500928492836040518096819582946374ddc26160e11b845260048401613384565b03925af18015610525576105115750f35b8161051b91613284565b6105225780f35b80fd5b6040513d84823e3d90fd5b505050fd5b9450506020843d60201161056a575b8161055160209383613284565b810103126105665792518493906104d66104b6565b5f80fd5b3d9150610544565b6040513d87823e3d90fd5b825160ff168a526020998a019990920191600101610454565b816105a091613284565b6105ab57878a610406565b8780fd5b6040513d8b823e3d90fd5b915094506105e0915060a03d60a0116105ee575b6105d88183613284565b8101906143f3565b50929050949091908c6103b3565b503d6105ce565b60405162461bcd60e51b8152602060048201526024808201527f657363616c6174696f6e2067616d65206e6565647320746f206265206465706c6044820152631bde595960e21b6064820152608490fd5b61065891610653826132d2565b61390a565b5f82610213565b61068291975060203d602011610689575b61067a8183613284565b810190613335565b955f6101df565b503d610670565b6040513d8a823e3d90fd5b823560ff811681036106b5578152602092830192016101a4565b8980fd5b8880fd5b8480fd5b8380fd5b50346105225760403660031901126105225760206106ed6106e461326e565b6024359061443e565b604051908152f35b50346105225760203660031901126105225760e0906040906001600160a01b0361071d61326e565b168152806020522060ff81549160018060a01b0360018201541690600281015460038201549060056004840154930154936040519687526020870152604086015260608501526080840152818116151560a084015260081c1660c0820152f35b5034610522576040366003190112610522578061079861326e565b6107a06132f0565b6001600160a01b03821691823b156105305760405163d76c4f9d60e01b8152336004820152848160248183885af1908115610572578591610ef0575b5083905260016020526040842060ff83165f526020528160405f2060018060a01b0390541615610ee0575b505081835260016020908152604080852060ff84165f90815292529020546001600160a01b031690813b156105305760405163d76c4f9d60e01b8152336004820152848160248183875af1908115610572578591610ecb575b5050823b15610530576040516362615af560e11b8152848160048183885af1908115610572578591610eb6575b50506040516328c16ded60e21b81523360048201529160a083602481875afa92831561057257859086908795610e8d575b506040516328c16ded60e21b81523360048201529160a083602481875afa91821561069057889389908a94610e62575b507f944157f2627ad30430728ee2c54f6b2ae1c72e340d7b7343be34435791a206d56060604051338152846020820152856040820152a16040516317914ab960e21b81526020816004818a5afa908115610c74578b91610e2d575b50604051630b35c5f560e31b81526020816004818b5afa908115610d7d578c91610df6575b5083610979916133ba565b873b156103685760405191630252566d60e21b8352600483015260248201528a81604481838b5af1908115610c74578b91610de1575b50859490508115610dda575b60405163021b50ff60e01b81529093906020816004818e5afa908115610d7d578c91610da5575b50151580610ce2575b610b39575b506109fd929394506133ba565b92803b156105ab57610a2a9388809460405196879586948593636cb1290960e11b8552336004860161441a565b03925af1908115610572578591610b24575b50506040516328c16ded60e21b81523360048201529160a083602481875afa928315610572578586918795610ae7575b506040805133815260ff9095166020860152840152606083015260808201525f5160206145775f395f51905f529060a090a1813b15610ae3578291608483926040519485938492636cb1290960e11b845233600485015282602485015282604485015260648401525af18015610525576105115750f35b5050fd5b60a0809496505f5160206145775f395f51905f52959350610b1492503d85116105ee576105d88183613284565b5096939593945090929050610a6c565b81610b2e91613284565b61053057835f610a3c565b610b5b91939450610b5490610b4e8a8961375d565b90613420565b80956133ba565b9381610c7f575b610b6c818761443e565b90868b528a602052600360408c2001610b868382546133ba565b9055610b96575b918493926109f0565b6040516317914ab960e21b81526020816004818d5afa908115610c74578b91610c3b575b50610bda91610bc8916133ef565b898b528a60205260408b205490613402565b883b156106b55789610c0191604051809381926374ddc26160e11b83528a60048401613384565b0381838d5af1908115610c30578a91610c1b575b50610b8d565b81610c2591613284565b6106b957885f610c15565b6040513d8c823e3d90fd5b9a505060208a3d602011610c6c575b81610c5760209383613284565b810103126105665798518a9990610bda610bba565b3d9150610c4a565b6040513d8d823e3d90fd5b604051632986454760e01b8152909350602081600481895afa908115610c30578a91610cad575b5092610b62565b9950506020893d602011610cda575b81610cc960209383613284565b81010312610566578998515f610ca6565b3d9150610cbc565b50604051630a40d29760e21b81526020816004818b5afa908115610d7d576024916020918e91610d88575b506040516370a0823160e01b8152600481018b905292839182906001600160a01b03165afa908115610d7d578c91610d48575b5015156109eb565b9b505060208b3d602011610d75575b81610d6460209383613284565b81010312610566578b9a515f610d40565b3d9150610d57565b6040513d8e823e3d90fd5b610d9f9150823d84116106895761067a8183613284565b5f610d0d565b9b505060208b3d602011610dd2575b81610dc160209383613284565b81010312610566578b9a515f6109e2565b3d9150610db4565b50896109bb565b81610deb91613284565b6106b557895f6109af565b9b505060208b3d602011610e25575b81610e1260209383613284565b810103126105665799518b9a908361096e565b3d9150610e05565b9a505060208a3d602011610e5a575b81610e4960209383613284565b81010312610566578a99515f610949565b3d9150610e3c565b91945050610e8091925060a03d60a0116105ee576105d88183613284565b509392905093905f6108ee565b915050610eaa91935060a03d60a0116105ee576105d88183613284565b9593915050905f6108be565b81610ec091613284565b61053057835f61088d565b81610ed591613284565b61053057835f610860565b610ee99161390a565b5f81610807565b81610efa91613284565b61053057835f6107dc565b503461052257606036600319011261052257610f1f61326e565b610f27613300565b60443591906001600160401b0383116106c157366023840112156106c157826004013591610f54836132bb565b93610f626040519586613284565b83855260208501906024829560061b820101903682116105ab57602401915b8183106113e55750505060018060a01b0381169081865260026020526040862060018060a01b0384165f5260205260ff60405f2054166113ae578186526020868152604080882060010154905163b3f05b9760e01b81529190829060049082906001600160a01b03165afa9081156113a3578791611374575b501561132f5781865260026020526040862060018060a01b0384165f5260205260405f20600160ff198254161790558186528560205260018060a01b03600160408820015416936040518095633be47cf160e01b8252886044830160018060a01b038816998a60048601526040602486015251809152606484019490825b8181106113075750505082908160409503925af19384156112fc5786946112c4575b508315611283576110ac84879261375d565b94604051906328c16ded60e21b8252600482015260a081602481865afa908115610525578290839261125d575b508383528260205260046110f387826040872001546133ef565b85855260208581526040808720600101549051633bec785360e11b815293849182906001600160a01b03165afa9081156105725789928692611221575b50611145929161113f91613402565b926133ba565b90843b156106c157839161116e6040519485938493636cb1290960e11b85528a6004860161441a565b038183875af180156105255761120c575b505060206004916040519283809263021b50ff60e01b82525afa9081156105725785916111cd575b506111c7905f5160206145575f395f51905f52946040519485948561441a565b0390a180f35b90506020813d602011611204575b816111e860209383613284565b8101031261056657515f5160206145575f395f51905f526111a7565b3d91506111db565b8161121691613284565b6106bd57845f61117f565b92509450506020813d602011611255575b8161123f60209383613284565b810103126105665751889388919061113f611130565b3d9150611232565b9050611278915060a03d60a0116105ee576105d88183613284565b50929150505f6110d9565b60405162461bcd60e51b8152602060048201526019602482015278446964206e6f7420707572636861736520616e797468696e6760381b6044820152606490fd5b9093506040813d6040116112f4575b816112e060409383613284565b810103126112f05751925f61109a565b8580fd5b3d91506112d3565b6040513d88823e3d90fd5b825180518852602090810151818901526040909701968b96508d945090920191600101611078565b60405162461bcd60e51b815260206004820152601d60248201527f41756374696f6e206e6565647320746f2062652066696e616c697a65640000006044820152606490fd5b611396915060203d60201161139c575b61138e8183613284565b81019061336c565b5f610ffa565b503d611384565b6040513d89823e3d90fd5b60405162461bcd60e51b815260206004820152600f60248201526e105b1c9958591e4810db185a5b5959608a1b6044820152606490fd5b6040833603126105ab57604080519081016001600160401b0381118282101761142857916020916040938452853581528286013583820152815201920191610f81565b634e487b7160e01b8a52604160045260248afd5b5034610522576020366003190112610522576001600160a01b0361145e61326e565b169081815280602052600260408220015462093a808101809111611bf957421115611bb75781815260208181526040808320600101549051633bec785360e11b8152939190849060049082906001600160a01b03165afa928315610525578293611b83575b5060405163991292e360e01b8152602081600481855afa908115611ad657906003918491611b54575b506114f6816132d2565b03611b0f57808252602082905260408220600101546001600160a01b0316803b156119e857828091600460405180948193634bb278f360e01b83525af18015611ad657908391611afa575b5050803b15611af65760405163287fa97360e01b815260048101839052828160248183865af18015611ad657908391611ae1575b50506040516360f96a8f60e01b8152602081600481855afa908115611ad6578391611a9c575b506001600160a01b03168083526020838152604080852054905163763d4e0d60e11b81529092918431919081600481885afa9081156112fc578691611a6a575b50808210611a5d576115f1602091600493613420565b925b604051630b35c5f560e31b815292839182905afa908115610572578591611a2b575b50604051630b35c5f560e31b8152602081600481885afa80156112fc5786906119f7575b611644915082613420565b848652856020526004604087200155833b156106bd5760405191630252566d60e21b835260048301526024820152838160448183875af180156119ec579084916119d3575b505080159384156118b4575b60405163021b50ff60e01b8152602081600481875afa908115610572578591611882575b5015611800575b839450828452836020526003604085200154906040519063021b50ff60e01b8252602082600481885afa9182156112fc5786926117c9575b506040516317914ab960e21b815292602084600481895afa9384156113a357879461177e575b509160a093915f5160206145375f395f51905f5295936040519485526020850152604084015260608301526080820152a1803b1561177b5781809160046040518094819363495e542160e01b83525af18015610525576105115750f35b50fd5b935090939195506020833d6020116117c1575b8161179e60209383613284565b810103126105665791518695919390925f5160206145375f395f51905f5261171e565b3d9150611791565b955090506020853d6020116117f8575b816117e660209383613284565b8101031261056657859451905f6116f8565b3d91506117d9565b670de0b6b3a7640000820294828604670de0b6b3a764000014171561186e578394833b156106bd576040519063d721cc7760e01b82526004820152848160248183885af1908115610572578591611859575b50506116c0565b8161186391613284565b61053057835f611852565b634e487b7160e01b84526011600452602484fd5b90506020813d6020116118ac575b8161189d60209383613284565b8101031261056657515f6116b9565b3d9150611890565b6118be8183613420565b801561196857838552846020526118dc8360036040882001546133ef565b670de0b6b3a7640000810290808204670de0b6b3a76400001490151715611954579061190791613402565b833b156106bd576040519063d721cc7760e01b82526004820152848160248183885af180156105725790859161193f575b5050611695565b8161194991613284565b6106c157835f611938565b634e487b7160e01b86526011600452602486fd5b50670de0b6b3a76400008202828104670de0b6b3a7640000148617156119bf57833b156106bd576040519063d721cc7760e01b82526004820152848160248183885af180156105725790859161193f575050611695565b634e487b7160e01b85526011600452602485fd5b816119dd91613284565b6119e857825f611689565b8280fd5b6040513d86823e3d90fd5b506020813d602011611a23575b81611a1160209383613284565b81010312610566576116449051611639565b3d9150611a04565b90506020813d602011611a55575b81611a4660209383613284565b8101031261056657515f611615565b3d9150611a39565b50506004602085926115f3565b90506020813d602011611a94575b81611a8560209383613284565b8101031261056657515f6115db565b3d9150611a78565b90506020813d602011611ace575b81611ab760209383613284565b810103126119e857611ac8906133db565b5f61159b565b3d9150611aaa565b6040513d85823e3d90fd5b81611aeb91613284565b611af657815f611575565b5080fd5b81611b0491613284565b611af657815f611541565b60405162461bcd60e51b815260206004820152601d60248201527f41756374696f6e206e6565647320746f206861766520737461727465640000006044820152606490fd5b611b76915060203d602011611b7c575b611b6e8183613284565b810190613354565b5f6114ec565b503d611b64565b9092506020813d602011611baf575b81611b9f60209383613284565b810103126105665751915f6114c3565b3d9150611b92565b60405162461bcd60e51b815260206004820152601a602482015279747275746841756374696f6e207374696c6c206f6e676f696e6760301b6044820152606490fd5b634e487b7160e01b82526011600452602482fd5b5034610522576020366003190112610522576001600160a01b03611c2f61326e565b16604051632ce9dc0560e11b8152602081600481855afa908115611ad6578391611f28575b506001600160a01b03168015159081611ec4575b5015611e70578082913b1561177b57604051637619646560e11b8152828160048183865af1908115611ad6578391611e5b575b5081905260208281526040808420600501805460ff1916600117905551630a40d29760e21b8152919082600481845afa918215611ad6578392611e3a575b5060405163095ea7b360e01b81526001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116600483018190525f19602484015293602091839160449183918991165af180156119ec57611e1d575b506040516344c094a360e01b815290602082600481845afa9182156119ec578492611de8575b506020600491604051928380926358352e2960e11b82525afa9081156119ec578491611db3575b50823b15610530576105009284928360405180968195829463c6b118c760e01b84526004840161339f565b9350506020833d602011611de0575b81611dcf60209383613284565b81010312610566578392515f611d88565b3d9150611dc2565b6004919250611e0e602091823d8411611e16575b611e068183613284565b810190613316565b929150611d61565b503d611dfc565b611e359060203d60201161139c5761138e8183613284565b611d3b565b611e5491925060203d6020116106895761067a8183613284565b905f611cd9565b81611e6591613284565b61177b57815f611c9b565b60405162461bcd60e51b815260206004820152602660248201527f657363616c6174696f6e2067616d6520686173206e6f742074726967676572656044820152656420666f726b60d01b6064820152608490fd5b604051630625c72960e51b81529150602090829060049082905afa908115611ad6578391611ef6575b5015155f611c68565b90506020813d602011611f20575b81611f1160209383613284565b8101031261056657515f611eed565b3d9150611f04565b611f41915060203d6020116106895761067a8183613284565b5f611c54565b503461052257604036600319011261052257611f72611f6461326e565b611f6c6132f0565b9061390a565b80f35b5034610522576020366003190112610522576020906003906040906001600160a01b03611fa061326e565b168152808452200154604051908152f35b50346105225760403660031901126105225760206106ed611fd061326e565b6024359061375d565b5034610522576020366003190112610522576020611ffd611ff861326e565b61342d565b6040519061200a816132d2565b8152f35b50346105225760403660031901126105225761202861326e565b906024356001600160401b038111611af65736602382011215611af657806004013592612054846132bb565b916120626040519384613284565b848352602083016024819660051b830101913683116112f057602401905b8282106121945750506040516344c094a360e01b81526001600160a01b039290921694919050602081600481885afa9081156119ec578491612175575b50938352602083905260408320547f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316949092853b156106bd5760405163580ff51f60e11b81526001600160f81b039092166004830152602482019390935260606044820152915160648301819052608483019190845b81811061215f57505050818394818581819503925af18015610525576105115750f35b825184526020938401939092019160010161213c565b61218e915060203d602011611e1657611e068183613284565b5f6120bd565b8135815260209182019101612080565b50346105225780600319360112610522576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5034610522576020366003190112610522576001600160a01b0361220b61326e565b169060405163991292e360e01b8152602081600481865afa90811561052557906002918391612d03575b5061223f816132d2565b03612cbe576040516344c094a360e01b8152602081600481865afa908115610525578291612c9f575b506040516387ca99af60e01b81526001600160f81b0390911660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610525578291612c6d575b506249d4008101809111611bf957421115612c1d57813b156105225760405163287fa97360e01b815260036004820152818160248183875af1801561052557908291612c08575b50829052806020524260026040832001556040516360f96a8f60e01b8152602081600481865afa908115610525578291612bce575b506001600160a01b0316803b15611af6576040516362615af560e11b8152828160048183865af18015611ad657908391612bb9575b50506040516317914ab960e21b8152602081600481855afa908115611ad6578391612b87575b50604051634644ce1760e11b8152602081600481865afa9081156119ec578491612b55575b50843b156106c1576040519063a77384c160e01b82526004820152838160248183895af180156119ec57908491612b40575b50849052826020527fcefe8ad955503f9a572bf3bae119bd56aa53c9b992fae3956df273320fd2bc71606060036040862001548486528560205260408620546040519185835260208301526040820152a183835260208381526040808520600301548486529185905284205411612a9357505060405163991292e360e01b8152602081600481865afa90811561052557906003918391612a74575b50612499816132d2565b03611b0f57818152602081905260408120600101546001600160a01b0316803b15611af657818091600460405180948193634bb278f360e01b83525af1801561052557908291612a5f575b5050813b156105225760405163287fa97360e01b815260048101829052818160248183875af1801561052557908291612a4a575b50506040516360f96a8f60e01b8152602081600481865afa908115610525578291612a10575b506001600160a01b03168082526020828152604080842054905163763d4e0d60e11b8152909492918331919081600481875afa9081156105725785916129de575b508082106129d157612595602091600493613420565b925b604051630b35c5f560e31b815292839182905afa9081156119ec57849161299f575b50604051630b35c5f560e31b8152602081600481875afa801561057257859061296b575b6125e8915082613420565b838552846020526004604086200155823b156106c15760405191630252566d60e21b835260048301526024820152828160448183865af18015611ad657908391612956575b5050821592831580612853575b5060405163021b50ff60e01b8152602081600481865afa9081156119ec578491612821575b501561279f575b82935081835282602052600360408420015460405163021b50ff60e01b8152602081600481875afa90811561057257859161276a575b506040516317914ab960e21b815291602083600481885afa9283156112fc578693612721575b50915f5160206145375f395f51905f52939160a093604051938452602084015286604084015260608301526080820152a1803b1561177b5781809160046040518094819363495e542160e01b83525af180156105255761051157505080f35b92509450916020823d602011612762575b8161273f60209383613284565b810103126105665790518594919290915f5160206145375f395f51905f526126c2565b3d9150612732565b9450506020843d602011612797575b8161278660209383613284565b81010312610566578493515f61269c565b3d9150612779565b670de0b6b3a7640000810293818504670de0b6b3a764000014171561280d578293823b15610530576040519063d721cc7760e01b82526004820152838160248183875af19081156119ec5784916127f8575b5050612666565b8161280291613284565b610ae357825f6127f1565b634e487b7160e01b83526011600452602483fd5b90506020813d60201161284b575b8161283c60209383613284565b8101031261056657515f61265f565b3d915061282f565b156128ea57818352826020526128708160036040862001546133ef565b670de0b6b3a7640000810290808204670de0b6b3a7640000149015171561186e578161289b91613402565b823b156106c1576040519063d721cc7760e01b82526004820152838160248183875af180156119ec579084916128d5575b50505b5f61263a565b816128df91613284565b6119e857825f6128cc565b670de0b6b3a76400008102818104670de0b6b3a76400001485171561186e57823b156106c1576040519063d721cc7760e01b82526004820152838160248183875af180156119ec57908491612941575b50506128cf565b8161294b91613284565b6119e857825f61293a565b8161296091613284565b611af657815f61262d565b506020813d602011612997575b8161298560209383613284565b81010312610566576125e890516125dd565b3d9150612978565b90506020813d6020116129c9575b816129ba60209383613284565b8101031261056657515f6125b9565b3d91506129ad565b5050600460208492612597565b90506020813d602011612a08575b816129f960209383613284565b8101031261056657515f61257f565b3d91506129ec565b90506020813d602011612a42575b81612a2b60209383613284565b81010312611af657612a3c906133db565b5f61253e565b3d9150612a1e565b81612a5491613284565b61052257805f612518565b81612a6991613284565b61052257805f6124e4565b612a8d915060203d602011611b7c57611b6e8183613284565b5f61248f565b92612b07612ac9849583865285602052610b4e612ab76003604089200154836133ef565b86885287602052604088205490613402565b918085528460205260018060a01b0360016040872001541693855284602052604085205490855284602052620f424060036040872001540490613420565b823b1561053057604484928360405195869485936313fb84ff60e21b8552600485015260248401525af180156105255761051157505080f35b81612b4a91613284565b6119e857825f6123f4565b90506020813d602011612b7f575b81612b7060209383613284565b8101031261056657515f6123c2565b3d9150612b63565b90506020813d602011612bb1575b81612ba260209383613284565b8101031261056657515f61239d565b3d9150612b95565b81612bc391613284565b611af657815f612377565b90506020813d602011612c00575b81612be960209383613284565b81010312611af657612bfa906133db565b5f612342565b3d9150612bdc565b81612c1291613284565b61052257805f61230d565b60405162461bcd60e51b815260206004820152602260248201527f6d6967726174696f6e2074696d65206e6565647320746f2070617373206669726044820152611cdd60f21b6064820152608490fd5b90506020813d602011612c97575b81612c8860209383613284565b8101031261056657515f6122c6565b3d9150612c7b565b612cb8915060203d602011611e1657611e068183613284565b5f612268565b60405162461bcd60e51b815260206004820152601f60248201527f53797374656d206e6565647320746f20626520696e206d6967726174696f6e006044820152606490fd5b612d1c915060203d602011611b7c57611b6e8183613284565b5f612235565b905034610566576020366003190112610566576001600160a01b03612d4561326e565b6344c094a360e01b83521690602081600481855afa90811561307f575f9161324f575b50604051632ce9dc0560e11b8152602081600481865afa90811561307f575f91613230575b506040516387ca99af60e01b81526001600160f81b038316600482018190527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169390929091602081602481885afa90811561307f575f916131fe575b50156131965760405163991292e360e01b8152602081600481895afa90811561307f575f91613177575b50612e26816132d2565b613136576001600160a01b031680159081156130db575b501561308a57833b156105665760405163c37ffb8960e01b81525f8160048183895af1801561307f5761306a575b50604051630a40d29760e21b8152859190602081600481895afa908115611ad657839161304b575b5060405163095ea7b360e01b8152600481018690525f19602482015291906001600160a01b031660208360448187855af19081156119ec57602493602092613030575b506040516370a0823160e01b815230600482015293849182905afa918215611ad6578392612ff9575b50843b156119e857604051636c5bf1ff60e11b815291839183918291612f2991906004840161339f565b038183885af1801561052557612fe4575b505060209060446040518094819363058955ef60e41b835230600484015260248301525afa908115611ad6578391612fb2575b508183528260205260408320558152806020527f3f7489307ff80de8619cce934d9ce55c8a09e1eaad1a44b1b39d9c01d4e2df2f60206040832054604051908152a180f35b90506020813d602011612fdc575b81612fcd60209383613284565b8101031261056657515f612f6d565b3d9150612fc0565b81612fee91613284565b6106c157835f612f3a565b925090506020823d602011613028575b8161301660209383613284565b8101031261056657859151905f612eff565b3d9150613009565b61304690833d851161139c5761138e8183613284565b612ed6565b613064915060203d6020116106895761067a8183613284565b5f612e93565b6130779195505f90613284565b5f935f612e6b565b6040513d5f823e3d90fd5b60405162461bcd60e51b815260206004820152602360248201527f7175657374696f6e20686173206265656e2066696e616c697a656420616c726560448201526261647960e81b6064820152608490fd5b604051630653891960e41b81529150602090829060049082905afa801561307f576003915f91613117575b50613110816132d2565b145f612e3d565b613130915060203d602011611b7c57611b6e8183613284565b5f613106565b60405162461bcd60e51b815260206004820152601960248201527814de5cdd195b481a5cc81b9bdd081bdc195c985d1a5bdb985b603a1b6044820152606490fd5b613190915060203d602011611b7c57611b6e8183613284565b5f612e1c565b60405162461bcd60e51b815260206004820152603a60248201527f5a6f6c746172206e6565647320746f206861766520666f726b6564206265666f604482015279726520536563757269747920506f6f6c2063616e20646f20736f60301b6064820152608490fd5b90506020813d602011613228575b8161321960209383613284565b8101031261056657515f612df2565b3d915061320c565b613249915060203d6020116106895761067a8183613284565b5f612d8d565b613268915060203d602011611e1657611e068183613284565b5f612d68565b600435906001600160a01b038216820361056657565b601f909101601f19168101906001600160401b038211908210176132a757604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116132a75760051b60200190565b600411156132dc57565b634e487b7160e01b5f52602160045260245ffd5b6024359060ff8216820361056657565b602435906001600160a01b038216820361056657565b9081602091031261056657516001600160f81b03811681036105665790565b9081602091031261056657516001600160a01b03811681036105665790565b90816020910312610566575160048110156105665790565b90816020910312610566575180151581036105665790565b6001600160a01b039091168152602081019190915260400190565b6001600160f81b039091168152602081019190915260400190565b919082018092116133c757565b634e487b7160e01b5f52601160045260245ffd5b51906001600160a01b038216820361056657565b818102929181159184041417156133c757565b811561340c570490565b634e487b7160e01b5f52601260045260245ffd5b919082039182116133c757565b60405163991292e360e01b81526001600160a01b039190911690602081600481855afa90811561307f575f9161373e575b50613468816132d2565b60018114613737576040516360f96a8f60e01b8152602081600481865afa90811561307f575f916136fd575b506001600160a01b0316806136c4575b506134ae816132d2565b156134ba575b50600390565b604051632ce9dc0560e11b815290602082600481845afa90811561307f576004925f926136a2575b50602090604051938480926344c094a360e01b82525afa91821561307f575f92613681575b506040516387ca99af60e01b81526001600160f81b0390921660048301526020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa91821561307f575f9261364d575b506001600160a01b0316908161357c575b506134b4565b60405163ca539aed60e01b8152602081600481865afa90811561307f575f9161361b575b5080421191826135fc575b50506135b75780613576565b602060049160405192838092630653891960e41b82525afa90811561307f575f916135e0575090565b6135f9915060203d602011611b7c57611b6e8183613284565b90565b80159250908215613611575b50505f806135ab565b1090505f80613608565b90506020813d602011613645575b8161363660209383613284565b8101031261056657515f6135a0565b3d9150613629565b9091506020813d602011613679575b8161366960209383613284565b810103126105665751905f613565565b3d915061365c565b61369b91925060203d602011611e1657611e068183613284565b905f613507565b60209192506136bd90823d84116106895761067a8183613284565b91906134e2565b5f525f60205260ff600560405f200154166136df575f6134a4565b505f525f60205260ff600560405f20015460081c166135f9816132d2565b90506020813d60201161372f575b8161371860209383613284565b8101031261056657613729906133db565b5f613494565b3d915061370b565b5050600390565b613757915060203d602011611b7c57611b6e8183613284565b5f61345e565b60405163021b50ff60e01b81526001600160a01b03919091169190602081600481865afa90811561307f575f916138d8575b50156138bb5760405163021b50ff60e01b815290602082600481865afa90811561307f575f91613885575b6137c492506133ef565b604051630a40d29760e21b815291602083600481845afa92831561307f575f93613863575b506040516370a0823160e01b8152600481019190915291602090839060249082906001600160a01b03165afa90811561307f575f9161382d575b6135f99250613402565b90506020823d60201161385b575b8161384860209383613284565b81010312610566576135f9915190613823565b3d915061383b565b602091935061387e90823d84116106895761067a8183613284565b92906137e9565b90506020823d6020116138b3575b816138a060209383613284565b81010312610566576137c49151906137ba565b3d9150613893565b670de0b6b3a7640000808202925081159183041417156133c75790565b90506020813d602011613902575b816138f360209383613284565b8101031261056657515f61378f565b3d91506138e6565b6001600160a01b039081165f81815260016020908152604080832060ff87168452909152812054909392166143b65760405163991292e360e01b8152602081600481855afa801561307f576001915f91614397575b50613969816132d2565b03614356576040516344c094a360e01b8152602081600481855afa90811561307f575f91614337575b506040516387ca99af60e01b81526001600160f81b0390911660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561307f575f91614305575b506249d40081018091116133c75742116142c8576040516344c094a360e01b8152602081600481855afa90811561307f575f916142a9575b50604080516001600160f81b039092166020830190815260ff851683830152908252613a55606083613284565b905190206040516317914ab960e21b81526001600160f81b039091169290602081600481865afa90811561307f575f91614277575b50604051630b35c5f560e31b8152602081600481875afa90811561307f575f91614245575b506040519163420671d160e11b83526004830152602482015260208160448173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af490811561307f575f91614213575b50604051636640e28560e01b815293602085600481875afa94851561307f575f956141cf575b5060405163364fd2cf60e11b8152602081600481885afa90811561307f575f9161418d575b506040516358352e2960e11b815295602087600481895afa96871561307f575f97614159575b50604051632801969760e01b8152936020856004818a5afa94851561307f575f95614125575b5060405163c20e976760e01b81526020816004818b5afa90811561307f575f916140e0575b5060405163029f8a6d60e11b81529190602090839060049082906001600160a01b03165afa91821561307f575f926140a5575b50915f91610104949360409788519b8c988997630a3bc40760e21b89528d60048a015260018060a01b0316602489015260448801526064870152608486015260a485015260c48401528160e484015260018060a01b03165af192831561307f575f905f94614054575b506001600160a01b039081165f8181526020818152604080832060058101805461ff001916600889901b61ff0016179055600190810180546001600160a01b03199081169a909716998a17905597835260038252808320805460ff19168917905586835296815286822060ff90951682529390935293909120805490911683179055803b1561056657604051631db2079f60e01b8152600481018390525f8160248183865af1801561307f5761403f575b50604051630a40d29760e21b8152602081600481865afa9081156119ec578491614020575b506040516370a0823160e01b81523060048201526001600160a01b039190911690602081602481855afa90811561057257908592918391613fe8575b50602091613d829160405194858094819363a9059cbb60e01b83528a60048401613384565b03925af180156119ec57613fcb575b508083528260205260ff6005604085200154165f14613f3e5760405163021b50ff60e01b8152602081600481855afa80156119ec578490613f0a575b613de49150828552846020526040852054906133ef565b90808452836020526004602060408620549260405192838092632ce9dc0560e11b82525afa908115610572576004916020918791613eed575b5060405163395ef62760e21b815292839182906001600160a01b03165afa908115610572578591613ebb575b508060011b90808204600214901517156119bf57613e7592916005613e6f9204906133ba565b90613402565b813b156119e857829160248392604051948593849263d721cc7760e01b845260048401525af1801561052557613ea9575050565b613eb4828092613284565b6105225750565b90506020813d602011613ee5575b81613ed660209383613284565b8101031261056657515f613e49565b3d9150613ec9565b613f049150823d84116106895761067a8183613284565b5f613e1d565b506020813d602011613f36575b81613f2460209383613284565b8101031261056657613de49051613dcd565b3d9150613f17565b60206004916040519283809263021b50ff60e01b82525afa908115611ad6578391613f99575b50813b156119e857829160248392604051948593849263d721cc7760e01b845260048401525af1801561052557613ea9575050565b90506020813d602011613fc3575b81613fb460209383613284565b8101031261056657515f613f64565b3d9150613fa7565b613fe39060203d60201161139c5761138e8183613284565b613d91565b9250506020823d602011614018575b8161400460209383613284565b810103126105665790518491906020613d5d565b3d9150613ff7565b614039915060203d6020116106895761067a8183613284565b5f613d21565b61404c9193505f90613284565b5f915f613cfc565b9350506040833d60401161409d575b8161407060409383613284565b81010312610566576020614083846133db565b930151926001600160a01b0384168403610566575f613c4b565b3d9150614063565b915092916020823d6020116140d8575b816140c260209383613284565b8101031261056657905191929091906040613be2565b3d91506140b5565b90506020813d60201161411d575b816140fb60209383613284565b810103126105665751906001600160a01b038216820361056657906020613baf565b3d91506140ee565b9094506020813d602011614151575b8161414160209383613284565b810103126105665751935f613b8a565b3d9150614134565b9096506020813d602011614185575b8161417560209383613284565b810103126105665751955f613b64565b3d9150614168565b90506020813d6020116141c7575b816141a860209383613284565b8101031261056657516001600160a01b0381168103610566575f613b3e565b3d915061419b565b9094506020813d60201161420b575b816141eb60209383613284565b8101031261056657516001600160a01b038116810361056657935f613b19565b3d91506141de565b90506020813d60201161423d575b8161422e60209383613284565b8101031261056657515f613af3565b3d9150614221565b90506020813d60201161426f575b8161426060209383613284565b8101031261056657515f613aaf565b3d9150614253565b90506020813d6020116142a1575b8161429260209383613284565b8101031261056657515f613a8a565b3d9150614285565b6142c2915060203d602011611e1657611e068183613284565b5f613a28565b60405162461bcd60e51b81526020600482015260156024820152741b5a59dc985d1a5bdb881d1a5b59481c185cdcd959605a1b6044820152606490fd5b90506020813d60201161432f575b8161432060209383613284565b8101031261056657515f6139f0565b3d9150614313565b614350915060203d602011611e1657611e068183613284565b5f613992565b60405162461bcd60e51b8152602060048201526019602482015278141bdbdb081b9959591cc81d1bc81a185d9948199bdc9ad959603a1b6044820152606490fd5b6143b0915060203d602011611b7c57611b6e8183613284565b5f61395f565b60405162461bcd60e51b815260206004820152601560248201527418da1a5b1908185b1c9958591e4818dc99585d1959605a1b6044820152606490fd5b908160a0910312610566578051916020820151916040810151916080606083015192015190565b90949392606092608083019660018060a01b03168352602083015260408201520152565b604051630a40d29760e21b8152916001600160a01b039190911690602083600481855afa92831561307f576024936020915f91614519575b506040516370a0823160e01b81526004810185905294859182906001600160a01b03165afa92831561307f575f936144e3575b506144b86004936020926133ef565b916040519384809263021b50ff60e01b82525afa90811561307f575f9161382d576135f99250613402565b92506020833d602011614511575b816144fe60209383613284565b81010312610566579151916144b86144a9565b3d91506144f1565b6145309150823d84116106895761067a8183613284565b5f61447656fe6c004d10f5e2ee616b60bd56d47587f548f392787a1162d17f99b2ea6ebdb5330a75091c2aae3857681c56cf772bf513775bab6d53381145acc8b3b8b394983a7096c7b34f3d00f4c47c73b7ae24a876517405a19573a676af664fc2ec9ea8eba26469706673582212205cf265f779d3c75bf0fb4fc0fbb486175468011d64b11783fdcbdb289dad3af064736f6c63430008210033'
		}
	}
}
export declare const peripherals_SecurityPoolUtils_SecurityPoolUtils: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'calculateRetentionRate'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'z'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'rpow'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'x'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'n'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'baseUnit'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'z'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '608080604052346019576101f7908161001e823930815050f35b5f80fdfe60806040526004361015610011575f80fd5b5f3560e01c806367b870af146100575763840ce3a21461002f575f80fd5b604036600319011261005357602061004b602435600435610118565b604051908152f35b5f80fd5b6060366003190112610053576004356024356044358260018316156100cc575b9160011c92835b61008d57602083604051908152f35b8161009b826100a0936100f1565b6100d3565b9283600182166100b6575b5060011c928361007e565b61009b83916100c593956100f1565b91836100ab565b5080610077565b81156100dd570490565b634e487b7160e01b5f52601260045260245ffd5b8181029291811591840414171561010457565b634e487b7160e01b5f52601160045260245ffd5b9080156101b3576064820291808304606414901517156101045761013b916100d3565b60508111156101515750670de0b6ae80ef960090565b670de0b6b3a7640000810290808204670de0b6b3a7640000149015171561010457605090048064046a94b600029064046a94b60082040361010457670de0b6b3a76400009004670de0b6b2eb844c0003670de0b6b2eb844c0081116101045790565b5050670de0b6b2eb844c009056fea26469706673582212200e5d35df082a43d030117c60c78889486c50dc971ab56ff3786e18e785e0539264736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60806040526004361015610011575f80fd5b5f3560e01c806367b870af146100575763840ce3a21461002f575f80fd5b604036600319011261005357602061004b602435600435610118565b604051908152f35b5f80fd5b6060366003190112610053576004356024356044358260018316156100cc575b9160011c92835b61008d57602083604051908152f35b8161009b826100a0936100f1565b6100d3565b9283600182166100b6575b5060011c928361007e565b61009b83916100c593956100f1565b91836100ab565b5080610077565b81156100dd570490565b634e487b7160e01b5f52601260045260245ffd5b8181029291811591840414171561010457565b634e487b7160e01b5f52601160045260245ffd5b9080156101b3576064820291808304606414901517156101045761013b916100d3565b60508111156101515750670de0b6ae80ef960090565b670de0b6b3a7640000810290808204670de0b6b3a7640000149015171561010457605090048064046a94b600029064046a94b60082040361010457670de0b6b3a76400009004670de0b6b2eb844c0003670de0b6b2eb844c0081116101045790565b5050670de0b6b2eb844c009056fea26469706673582212200e5d35df082a43d030117c60c78889486c50dc971ab56ff3786e18e785e0539264736f6c63430008210033'
		}
	}
}
export declare const peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'AuctionStarted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'ethRaiseCap'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'maxRepBeingSold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'minBidSize'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Finalized'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'ethToSend'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'hitCap'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'foundTick'
					readonly type: 'int256'
					readonly internalType: 'int256'
					readonly indexed: false
				},
				{
					readonly name: 'repFilled'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'ethFilled'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'RefundLosingBids'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'bidder'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly indexed: false
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
				{
					readonly name: 'ethAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'SubmitBid'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'bidder'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tick'
					readonly type: 'int256'
					readonly internalType: 'int256'
					readonly indexed: false
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'WithdrawBids'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'withdrawFor'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly indexed: false
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
				{
					readonly name: 'totalFilledRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'totalEthRefund'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'auctionStarted'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'clearingTick'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'computeClearing'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: 'hitCap'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'clearingTickOut'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
				{
					readonly name: 'accumulatedEth'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'ethAtClearingTick'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'ethFilledAtClearing'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'ethRaiseCap'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'ethRaised'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'finalize'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'finalized'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'maxRepBeingSold'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'minBidSize'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'owner'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'refundLosingBids'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'startAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_ethRaiseCap'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_maxRepBeingSold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'submitBid'
			readonly stateMutability: 'payable'
			readonly inputs: readonly [
				{
					readonly name: 'tick'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'tickToPrice'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'tick'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalRepPurchased'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'underfunded'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'underfundedRemainder'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'underfundedThreshold'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'underfundedWinningEth'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'withdrawBids'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'withdrawFor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'totalFilledRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'totalEthRefund'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60a03461008457601f611e7c38819003918201601f19168301916001600160401b038311848410176100885780849260209460405283398101031261008457516001600160a01b0381168103610084576001600355608052604051611ddf908161009d8239608051818181610449015281816106db015281816108520152610aa70152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f3560e01c908163062caa2e14610eae5750806334d028b214610e915780633be47cf114610a515780634aa44a9e14610a2f5780634bb278f3146108315780634fee13fc146106c1578063604fc95c146106865780636606d4c8146106695780636fbc38771461064c57806377d8f0a61461062f5780637d7e5ef21461060957806388b701b2146104785780638da5cb5b1461043457806397841b80146101d7578063985e704b146101ba578063b3f05b9714610198578063c7726bdf1461017b578063d4f18e191461015e578063d6d6c41514610141578063ee2679bc146101245763fddf0fc014610103575f80fd5b34610120575f366003190112610120576020600954604051908152f35b5f80fd5b34610120575f366003190112610120576020600b54604051908152f35b34610120575f366003190112610120576020600f54604051908152f35b34610120575f366003190112610120576020600c54604051908152f35b34610120575f366003190112610120576020600454604051908152f35b34610120575f36600319011261012057602060ff600654166040519015158152f35b34610120575f366003190112610120576020601054604051908152f35b34610120576020366003190112610120576004356001600160401b03811161012057610207903690600401610f3f565b61021660ff6006541615611117565b6102255f8080806002546112db565b5090911590506103fd575f91825b8151841015610365576102468483610fd9565b51519360206102558285610fd9565b510151848612156103225761027590865f52600160205260405f2061101c565b5080546001600160a01b031633036102f057600101805480156102b7576102a4816001955f6102ad9555611091565b96600254611b26565b6002550192610233565b60405162461bcd60e51b815260206004820152601160248201527030b63932b0b23c903bb4ba34323930bbb760791b6044820152606490fd5b60405162461bcd60e51b815260206004820152600a6024820152693737ba103134b23232b960b11b6044820152606490fd5b60405162461bcd60e51b815260206004820152601b60248201527a18d85b9b9bdd081dda5d1a191c985dc8189a5b991a5b99c8189a59602a1b6044820152606490fd5b5f80808084335af16103756110dd565b50156103c6577f9b473f4c4661ba8fd1835f2e37be18e79da8a58688eca262b53ff97a561c1522916103bb9160405192839233845260606020850152606084019061109e565b9060408301520390a1005b60405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600f60248201526e1b9bc818db19585c9a5b99c81e595d608a1b6044820152606490fd5b34610120575f366003190112610120576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b602036600319011261012057600435600b5480156105d65760ff600654166105a55762093a8081018091116105915742101561055c57600c5434106105275760607f99f739e348683f5e26b074d975994b3e724f052365a5f9a2e7e34fd81e47ade1916207ffff198112158061051a575b6104f290611157565b61050260025434908333916116fd565b600255604051903382526020820152346040820152a1005b50620800008113156104e9565b60405162461bcd60e51b815260206004820152600d60248201526c189a59081d1bdbc81cdb585b1b609a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c185d58dd1a5bdb88195b991959609a1b6044820152606490fd5b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b8152602060048201526009602482015268199a5b985b1a5e995960ba1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600b60248201526a1b9bdd081cdd185c9d195960aa1b6044820152606490fd5b34610120576020366003190112610120576020610627600435611198565b604051908152f35b34610120575f366003190112610120576020600a54604051908152f35b34610120575f366003190112610120576020600e54604051908152f35b34610120575f366003190112610120576020600554604051908152f35b34610120575f3660031901126101205760806106a75f8080806002546112db565b916040519315158452602084015260408301526060820152f35b3461012057604036600319011261012057600435602435337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316036107f557600b546107be57811515806107b5575b15610781577f44c53be110c6aa83aa83cd02e351ed172359268272ee1b5d31c0fe48db35c6c791816060926004558160055542600b556001620186a0830480600c5510610777575b600c549060405192835260208301526040820152a1005b6001600c55610760565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206361707360a01b6044820152606490fd5b50801515610718565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610120575f3660031901126101205761085060ff6006541615611117565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316338190036109f0576108915f8080806002546112db565b909391600160ff19600654161760065560075560085582600955815f1461097257670de0b6b3a76400006108cf6108c9600754611198565b85611074565b04600a555f8080808680955b5af16108e56110dd565b5015610936577f97e47dd2a0543af4ea794e9f54623786da8e3b8584a3c15dbcfe8ec103176b699260a092600754600a549160405194855215156020850152604084015260608301526080820152a1005b60405162461bcd60e51b81526020600482015260146024820152732330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b600d805460ff19166001179055600454806109a157505f19600f555f6010555f600a555f8080808080956108db565b6109b5906109b0600954611050565b611087565b600f555f600e556109cb600254600f5490611258565b6010819055156109ea576004545b600a555f80808060105480956108db565b5f6109d9565b60405162461bcd60e51b81526020600482015260176024820152764f6e6c79206f776e65722063616e2066696e616c697a6560481b6044820152606490fd5b34610120575f36600319011261012057602060ff600d54166040519015158152f35b34610120576040366003190112610120576004356001600160a01b03811690819003610120576024356001600160401b03811161012057610a96903690600401610f3f565b5f915f9060ff6006541615610e5c577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610e2157610ae0600754611198565b915f945b8451861015610d6657610af78686610fd9565b515195610b1d6020610b098389610fd9565b510151885f52600160205260405f2061101c565b5080546001600160a01b0316859003610d315760018101978854918215610cfa57600d5460ff1615610bce5750610b5390611198565b600f541015610bb957610b6c610b7591600a5490611074565b600e5490611091565b60105490610b838282611087565b8215610ba5576001945f93610b9b9306600e55611091565b975b550194610ae4565b634e487b7160e01b5f52601260045260245ffd5b610bc85f916001949995611091565b93610b9d565b600754949994909181811215610bef57505050610bc85f9160019495611091565b9394931315610c49575085610c0a575b50905f600192610b9d565b919096670de0b6b3a76400008302928304670de0b6b3a76400000361059157610c405f91610c3a88600196611087565b90611091565b97919250610bff565b60020154919391610c5a8282611043565b60085491818311610cdd575050505f905b808211610cd5575b86610c8b575b60019392610c3a5f93610bc893611043565b979291670de0b6b3a7640000820290828204670de0b6b3a7640000148315171561059157610c3a5f93610cc7600197610c3a8c610bc897611087565b9b9350935050929350610c79565b905080610c73565b8210610ceb57505080610c6b565b610cf491611043565b90610c6b565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e4818db185a5b5959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd081d1a195a5c88189a59609a1b6044820152606490fd5b827e428a2600e557fb4fb2ea7b934d2608af79e533f6936f7d097107613f3ee4f9610da58760405191829185835260806020840152608083019061109e565b8560408301528660608301520390a182610dca575b5060409182519182526020820152f35b5f80808581945af1610dda6110dd565b5015610de65782610dba565b60405162461bcd60e51b8152602060048201526013602482015272195d1a081d1c985b9cd9995c8819985a5b1959606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152601360248201527213db9b1e481bdddb995c8818d85b8818d85b1b606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd08199a5b985b1a5e9959609a1b6044820152606490fd5b34610120575f366003190112610120576020600754604051908152f35b34610120575f366003190112610120576020906008548152f35b6040519060c082016001600160401b03811183821017610ee757604052565b634e487b7160e01b5f52604160045260245ffd5b60405190606082016001600160401b03811183821017610ee757604052565b6040519190601f01601f191682016001600160401b03811183821017610ee757604052565b81601f82011215610120578035906001600160401b038211610ee757610f6a60208360051b01610f1a565b9260208085858152019360061b8301019181831161012057602001925b828410610f95575050505090565b604084830312610120576040805191908201906001600160401b03821183831017610ee7576040926020928452863581528287013583820152815201930192610f87565b8051821015610fed5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b5f52600160205260405f2090565b5f525f60205260405f2090565b8054821015610fed575f52600360205f20910201905f90565b5f1981019190821161059157565b9190820391821161059157565b90670de0b6b3a7640000820291808304670de0b6b3a7640000149015171561059157565b8181029291811591840414171561059157565b8115610ba5570490565b9190820180921161059157565b90602080835192838152019201905f5b8181106110bb5750505090565b82518051855260209081015181860152604090940193909201916001016110ae565b3d15611112573d906001600160401b038211610ee757611106601f8301601f1916602001610f1a565b9182523d5f602084013e565b606090565b1561111e57565b60405162461bcd60e51b8152602060048201526011602482015270185b1c9958591e48199a5b985b1a5e9959607a1b6044820152606490fd5b1561115e57565b60405162461bcd60e51b81526020600482015260126024820152717469636b206f7574206f6620626f756e647360701b6044820152606490fd5b906207ffff198212158061124b575b6111b090611157565b5f821291821561124657600160ff1b8114610591575f035b670de0b6b3a7640000925f5b60ff81166014811015611222576001901b83166111f7575b60010160ff166111d4565b936001670de0b6b3a764000061121860ff9361121289611494565b90611074565b04959150506111ec565b5050905061122c57565b908015610ba5576a0c097ce7bc90715b34b9f160241b0490565b6111c8565b50620800008213156111a7565b80156112d5575f525f60205260405f2090806112748354611198565b11611289576004611286920154611258565b90565b6001820154906004830154806112b2575b5060036112a992930154611258565b61128691611091565b6112ce6112a99360026112c660039461100f565b015490611091565b925061129a565b50505f90565b949390948015611486576112ee9061100f565b600481015490919080156114805760026113078261100f565b01545b611451575b5081549561131c87611198565b936001840154958515611449575b82611422575b6005549384841015611410575050506113498183611043565b808611611408575b5061135c8582611091565b9361137861136a8287611074565b670de0b6b3a7640000900490565b600454809110156113af575050508210156113a5579381600361139d959601546112db565b929391929091565b5091600193929190565b9092506109b09194506113c29350611050565b915f928281116113f4575b508083116113ea575b50816113e191611091565b91600193929190565b91506113e16113d6565b6114019193508290611043565b915f6113cd565b94505f611351565b96509694509650505050600193929190565b61142f61136a8785611074565b600454101561133057969450965050925050600193929190565b5f965061132a565b928194919296611460946112db565b909280969296611476575050819491925f61130f565b9594929350919050565b5f61130a565b5050929190505f9291905f90565b60ff168015611677576001811461166a576002811461165d5760038114611650576004811461164357600581146116365760068114611629576007811461161c576008811461160f576009811461160257600a81146115f557600b81146115e857600c81146115db57600d81146115ce57600e81146115c157600f81146115b357601081146115a5576011811461159657601281146115845760131461156f5760405162461bcd60e51b8152602060048201526013602482015272496e646578206f7574206f6620626f756e647360681b6044820152606490fd5b70ac68c7d696d2a7feb69b86a3f86612aa6390565b506c030ea31ae5857ddf43f23b6a3590565b50696837a9452e9c20fccb9390565b50682607c4dade2ffff8d990565b5068016f930b8c7a7a908890565b5067476c1029a11c44ae90565b50671f7ba7b82f6c9c5a90565b506714e70aabdb4a06fc90565b5067110820d9bfe975a290565b50670f5fc52fb491650d90565b50670e9b5714c33819c490565b50670e3cd527937106bf90565b50670e0e7a781961e75990565b50670df785d75ac05be090565b50670dec1999b5903ebe90565b50670de666fc35fe931b90565b50670de38e8d5fd9895890565b50670de2228de1d1616490565b50670de16c9c1c64640090565b50670de111a6b7de400090565b5f1981146105915760010190565b8054600160401b811015610ee7576116af9160018201815561101c565b9190916116ea57805182546001600160a01b0319166001600160a01b0391909116178255602081015160018301556040015160029190910155565b634e487b7160e01b5f525f60045260245ffd5b91909282156117f05761170f8361100f565b80548581036117be575090611286946001611775949301611731838254611091565b905561173c81611001565b546117835761174b8291611001565b91611766611757610efb565b6001600160a01b039095168552565b60208401526040830152611692565b61177e816118ac565b611959565b61174b6117b88360026117b061179886611001565b6117aa6117a488611001565b54611035565b9061101c565b500154611091565b91611001565b9092908512156117e15760036117d793019485546116fd565b6112869255611775565b60046117d793019485546116fd565b61128692506118816003549461180d61180887611684565b600355565b61187c611818610ec8565b8281528460208201528460408201525f60608201525f6080820152600160a08201526118438861100f565b9060a060059180518455602081015160018501556040810151600285015560608101516003850155608081015160048501550151910155565b611001565b9061189c61188d610efb565b6001600160a01b039094168452565b8060208401526040830152611692565b5f525f60205260405f205f5f905f915f90600385015480611938575b50600485015480611914575b506118e76118ec92936001870154611091565b611091565b60028401558082111561190d57505b60010190816001116105915760050155565b90506118fb565b5f9081526020819052604090206002810154600590910154925090506118e76118d4565b5f9081526020819052604081206002810154600590910154955093506118c8565b805f525f602052611970600360405f200154611bb8565b815f525f602052611987600460405f200154611bb8565b905f82820392128183128116918313901516176105915760018113611a2f575f19136119b05790565b80611286915f525f602052600460405f2001545f525f6020526119d9600460405f200154611bb8565b815f525f602052600460405f2001545f525f6020526119fe600360405f200154611bb8565b1115611bd357805f525f602052611a1b600460405f200154611c10565b815f525f602052600460405f200155611bd3565b5080611286915f525f602052600360405f2001545f525f602052611a59600360405f200154611bb8565b815f525f602052600360405f2001545f525f602052611a7e600460405f200154611bb8565b1115611c1057805f525f602052611a9b600360405f200154611bd3565b815f525f602052600360405f200155611c10565b15611ab657565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206e6f646560a01b6044820152606490fd5b15611af157565b60405162461bcd60e51b815260206004820152600d60248201526c65746820756e646572666c6f7760981b6044820152606490fd5b9091611b33821515611aaf565b611b3c8261100f565b805480851215611b655750906003611b579201938454611b26565b611286925561177e816118ac565b841315611b7c579060046117d79201938454611b26565b6001611b9a9194939401918254611b9582821015611aea565b611043565b815554611baa5761128691611c81565b508061177e611286926118ac565b80611bc257505f90565b5f525f602052600560405f20015490565b5f818152602081905260408082206004018054808452918320600301805490859055928490529190915590611c07906118ac565b611286816118ac565b5f818152602081905260408082206003018054808452918320600401805490859055928490529190915590611c07906118ac565b15611c4b57565b60405162461bcd60e51b815260206004820152600e60248201526d64656c657465206d697373696e6760901b6044820152606490fd5b611c8c811515611c44565b611c958161100f565b805480841215611caf57506003611b579101928354611c81565b831315611cc55760046117d79101928354611c81565b9150600382019182541580611d75575b611d6257825415611d4f576004810192835415611d1b57506117d790611d03611cfe8554611d81565b61100f565b90815481556001808301549101558354905490611c81565b54925061128691611d2c915061100f565b60055f918281558260018201558260028201558260038201558260048201550155565b60040154915061128690611d2c9061100f565b50611d719150611d2c9061100f565b5f90565b50600481015415611cd5565b5b805f525f602052600360405f20015415611286575f525f602052600360405f200154611d8256fea2646970667358221220c0d65f3db561f0628972e7988b381d3ec7a5d64f7566c1462239d511859b2f2c64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f3560e01c908163062caa2e14610eae5750806334d028b214610e915780633be47cf114610a515780634aa44a9e14610a2f5780634bb278f3146108315780634fee13fc146106c1578063604fc95c146106865780636606d4c8146106695780636fbc38771461064c57806377d8f0a61461062f5780637d7e5ef21461060957806388b701b2146104785780638da5cb5b1461043457806397841b80146101d7578063985e704b146101ba578063b3f05b9714610198578063c7726bdf1461017b578063d4f18e191461015e578063d6d6c41514610141578063ee2679bc146101245763fddf0fc014610103575f80fd5b34610120575f366003190112610120576020600954604051908152f35b5f80fd5b34610120575f366003190112610120576020600b54604051908152f35b34610120575f366003190112610120576020600f54604051908152f35b34610120575f366003190112610120576020600c54604051908152f35b34610120575f366003190112610120576020600454604051908152f35b34610120575f36600319011261012057602060ff600654166040519015158152f35b34610120575f366003190112610120576020601054604051908152f35b34610120576020366003190112610120576004356001600160401b03811161012057610207903690600401610f3f565b61021660ff6006541615611117565b6102255f8080806002546112db565b5090911590506103fd575f91825b8151841015610365576102468483610fd9565b51519360206102558285610fd9565b510151848612156103225761027590865f52600160205260405f2061101c565b5080546001600160a01b031633036102f057600101805480156102b7576102a4816001955f6102ad9555611091565b96600254611b26565b6002550192610233565b60405162461bcd60e51b815260206004820152601160248201527030b63932b0b23c903bb4ba34323930bbb760791b6044820152606490fd5b60405162461bcd60e51b815260206004820152600a6024820152693737ba103134b23232b960b11b6044820152606490fd5b60405162461bcd60e51b815260206004820152601b60248201527a18d85b9b9bdd081dda5d1a191c985dc8189a5b991a5b99c8189a59602a1b6044820152606490fd5b5f80808084335af16103756110dd565b50156103c6577f9b473f4c4661ba8fd1835f2e37be18e79da8a58688eca262b53ff97a561c1522916103bb9160405192839233845260606020850152606084019061109e565b9060408301520390a1005b60405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600f60248201526e1b9bc818db19585c9a5b99c81e595d608a1b6044820152606490fd5b34610120575f366003190112610120576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b602036600319011261012057600435600b5480156105d65760ff600654166105a55762093a8081018091116105915742101561055c57600c5434106105275760607f99f739e348683f5e26b074d975994b3e724f052365a5f9a2e7e34fd81e47ade1916207ffff198112158061051a575b6104f290611157565b61050260025434908333916116fd565b600255604051903382526020820152346040820152a1005b50620800008113156104e9565b60405162461bcd60e51b815260206004820152600d60248201526c189a59081d1bdbc81cdb585b1b609a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c185d58dd1a5bdb88195b991959609a1b6044820152606490fd5b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b8152602060048201526009602482015268199a5b985b1a5e995960ba1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600b60248201526a1b9bdd081cdd185c9d195960aa1b6044820152606490fd5b34610120576020366003190112610120576020610627600435611198565b604051908152f35b34610120575f366003190112610120576020600a54604051908152f35b34610120575f366003190112610120576020600e54604051908152f35b34610120575f366003190112610120576020600554604051908152f35b34610120575f3660031901126101205760806106a75f8080806002546112db565b916040519315158452602084015260408301526060820152f35b3461012057604036600319011261012057600435602435337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316036107f557600b546107be57811515806107b5575b15610781577f44c53be110c6aa83aa83cd02e351ed172359268272ee1b5d31c0fe48db35c6c791816060926004558160055542600b556001620186a0830480600c5510610777575b600c549060405192835260208301526040820152a1005b6001600c55610760565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206361707360a01b6044820152606490fd5b50801515610718565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610120575f3660031901126101205761085060ff6006541615611117565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316338190036109f0576108915f8080806002546112db565b909391600160ff19600654161760065560075560085582600955815f1461097257670de0b6b3a76400006108cf6108c9600754611198565b85611074565b04600a555f8080808680955b5af16108e56110dd565b5015610936577f97e47dd2a0543af4ea794e9f54623786da8e3b8584a3c15dbcfe8ec103176b699260a092600754600a549160405194855215156020850152604084015260608301526080820152a1005b60405162461bcd60e51b81526020600482015260146024820152732330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b600d805460ff19166001179055600454806109a157505f19600f555f6010555f600a555f8080808080956108db565b6109b5906109b0600954611050565b611087565b600f555f600e556109cb600254600f5490611258565b6010819055156109ea576004545b600a555f80808060105480956108db565b5f6109d9565b60405162461bcd60e51b81526020600482015260176024820152764f6e6c79206f776e65722063616e2066696e616c697a6560481b6044820152606490fd5b34610120575f36600319011261012057602060ff600d54166040519015158152f35b34610120576040366003190112610120576004356001600160a01b03811690819003610120576024356001600160401b03811161012057610a96903690600401610f3f565b5f915f9060ff6006541615610e5c577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610e2157610ae0600754611198565b915f945b8451861015610d6657610af78686610fd9565b515195610b1d6020610b098389610fd9565b510151885f52600160205260405f2061101c565b5080546001600160a01b0316859003610d315760018101978854918215610cfa57600d5460ff1615610bce5750610b5390611198565b600f541015610bb957610b6c610b7591600a5490611074565b600e5490611091565b60105490610b838282611087565b8215610ba5576001945f93610b9b9306600e55611091565b975b550194610ae4565b634e487b7160e01b5f52601260045260245ffd5b610bc85f916001949995611091565b93610b9d565b600754949994909181811215610bef57505050610bc85f9160019495611091565b9394931315610c49575085610c0a575b50905f600192610b9d565b919096670de0b6b3a76400008302928304670de0b6b3a76400000361059157610c405f91610c3a88600196611087565b90611091565b97919250610bff565b60020154919391610c5a8282611043565b60085491818311610cdd575050505f905b808211610cd5575b86610c8b575b60019392610c3a5f93610bc893611043565b979291670de0b6b3a7640000820290828204670de0b6b3a7640000148315171561059157610c3a5f93610cc7600197610c3a8c610bc897611087565b9b9350935050929350610c79565b905080610c73565b8210610ceb57505080610c6b565b610cf491611043565b90610c6b565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e4818db185a5b5959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd081d1a195a5c88189a59609a1b6044820152606490fd5b827e428a2600e557fb4fb2ea7b934d2608af79e533f6936f7d097107613f3ee4f9610da58760405191829185835260806020840152608083019061109e565b8560408301528660608301520390a182610dca575b5060409182519182526020820152f35b5f80808581945af1610dda6110dd565b5015610de65782610dba565b60405162461bcd60e51b8152602060048201526013602482015272195d1a081d1c985b9cd9995c8819985a5b1959606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152601360248201527213db9b1e481bdddb995c8818d85b8818d85b1b606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd08199a5b985b1a5e9959609a1b6044820152606490fd5b34610120575f366003190112610120576020600754604051908152f35b34610120575f366003190112610120576020906008548152f35b6040519060c082016001600160401b03811183821017610ee757604052565b634e487b7160e01b5f52604160045260245ffd5b60405190606082016001600160401b03811183821017610ee757604052565b6040519190601f01601f191682016001600160401b03811183821017610ee757604052565b81601f82011215610120578035906001600160401b038211610ee757610f6a60208360051b01610f1a565b9260208085858152019360061b8301019181831161012057602001925b828410610f95575050505090565b604084830312610120576040805191908201906001600160401b03821183831017610ee7576040926020928452863581528287013583820152815201930192610f87565b8051821015610fed5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b5f52600160205260405f2090565b5f525f60205260405f2090565b8054821015610fed575f52600360205f20910201905f90565b5f1981019190821161059157565b9190820391821161059157565b90670de0b6b3a7640000820291808304670de0b6b3a7640000149015171561059157565b8181029291811591840414171561059157565b8115610ba5570490565b9190820180921161059157565b90602080835192838152019201905f5b8181106110bb5750505090565b82518051855260209081015181860152604090940193909201916001016110ae565b3d15611112573d906001600160401b038211610ee757611106601f8301601f1916602001610f1a565b9182523d5f602084013e565b606090565b1561111e57565b60405162461bcd60e51b8152602060048201526011602482015270185b1c9958591e48199a5b985b1a5e9959607a1b6044820152606490fd5b1561115e57565b60405162461bcd60e51b81526020600482015260126024820152717469636b206f7574206f6620626f756e647360701b6044820152606490fd5b906207ffff198212158061124b575b6111b090611157565b5f821291821561124657600160ff1b8114610591575f035b670de0b6b3a7640000925f5b60ff81166014811015611222576001901b83166111f7575b60010160ff166111d4565b936001670de0b6b3a764000061121860ff9361121289611494565b90611074565b04959150506111ec565b5050905061122c57565b908015610ba5576a0c097ce7bc90715b34b9f160241b0490565b6111c8565b50620800008213156111a7565b80156112d5575f525f60205260405f2090806112748354611198565b11611289576004611286920154611258565b90565b6001820154906004830154806112b2575b5060036112a992930154611258565b61128691611091565b6112ce6112a99360026112c660039461100f565b015490611091565b925061129a565b50505f90565b949390948015611486576112ee9061100f565b600481015490919080156114805760026113078261100f565b01545b611451575b5081549561131c87611198565b936001840154958515611449575b82611422575b6005549384841015611410575050506113498183611043565b808611611408575b5061135c8582611091565b9361137861136a8287611074565b670de0b6b3a7640000900490565b600454809110156113af575050508210156113a5579381600361139d959601546112db565b929391929091565b5091600193929190565b9092506109b09194506113c29350611050565b915f928281116113f4575b508083116113ea575b50816113e191611091565b91600193929190565b91506113e16113d6565b6114019193508290611043565b915f6113cd565b94505f611351565b96509694509650505050600193929190565b61142f61136a8785611074565b600454101561133057969450965050925050600193929190565b5f965061132a565b928194919296611460946112db565b909280969296611476575050819491925f61130f565b9594929350919050565b5f61130a565b5050929190505f9291905f90565b60ff168015611677576001811461166a576002811461165d5760038114611650576004811461164357600581146116365760068114611629576007811461161c576008811461160f576009811461160257600a81146115f557600b81146115e857600c81146115db57600d81146115ce57600e81146115c157600f81146115b357601081146115a5576011811461159657601281146115845760131461156f5760405162461bcd60e51b8152602060048201526013602482015272496e646578206f7574206f6620626f756e647360681b6044820152606490fd5b70ac68c7d696d2a7feb69b86a3f86612aa6390565b506c030ea31ae5857ddf43f23b6a3590565b50696837a9452e9c20fccb9390565b50682607c4dade2ffff8d990565b5068016f930b8c7a7a908890565b5067476c1029a11c44ae90565b50671f7ba7b82f6c9c5a90565b506714e70aabdb4a06fc90565b5067110820d9bfe975a290565b50670f5fc52fb491650d90565b50670e9b5714c33819c490565b50670e3cd527937106bf90565b50670e0e7a781961e75990565b50670df785d75ac05be090565b50670dec1999b5903ebe90565b50670de666fc35fe931b90565b50670de38e8d5fd9895890565b50670de2228de1d1616490565b50670de16c9c1c64640090565b50670de111a6b7de400090565b5f1981146105915760010190565b8054600160401b811015610ee7576116af9160018201815561101c565b9190916116ea57805182546001600160a01b0319166001600160a01b0391909116178255602081015160018301556040015160029190910155565b634e487b7160e01b5f525f60045260245ffd5b91909282156117f05761170f8361100f565b80548581036117be575090611286946001611775949301611731838254611091565b905561173c81611001565b546117835761174b8291611001565b91611766611757610efb565b6001600160a01b039095168552565b60208401526040830152611692565b61177e816118ac565b611959565b61174b6117b88360026117b061179886611001565b6117aa6117a488611001565b54611035565b9061101c565b500154611091565b91611001565b9092908512156117e15760036117d793019485546116fd565b6112869255611775565b60046117d793019485546116fd565b61128692506118816003549461180d61180887611684565b600355565b61187c611818610ec8565b8281528460208201528460408201525f60608201525f6080820152600160a08201526118438861100f565b9060a060059180518455602081015160018501556040810151600285015560608101516003850155608081015160048501550151910155565b611001565b9061189c61188d610efb565b6001600160a01b039094168452565b8060208401526040830152611692565b5f525f60205260405f205f5f905f915f90600385015480611938575b50600485015480611914575b506118e76118ec92936001870154611091565b611091565b60028401558082111561190d57505b60010190816001116105915760050155565b90506118fb565b5f9081526020819052604090206002810154600590910154925090506118e76118d4565b5f9081526020819052604081206002810154600590910154955093506118c8565b805f525f602052611970600360405f200154611bb8565b815f525f602052611987600460405f200154611bb8565b905f82820392128183128116918313901516176105915760018113611a2f575f19136119b05790565b80611286915f525f602052600460405f2001545f525f6020526119d9600460405f200154611bb8565b815f525f602052600460405f2001545f525f6020526119fe600360405f200154611bb8565b1115611bd357805f525f602052611a1b600460405f200154611c10565b815f525f602052600460405f200155611bd3565b5080611286915f525f602052600360405f2001545f525f602052611a59600360405f200154611bb8565b815f525f602052600360405f2001545f525f602052611a7e600460405f200154611bb8565b1115611c1057805f525f602052611a9b600360405f200154611bd3565b815f525f602052600360405f200155611c10565b15611ab657565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206e6f646560a01b6044820152606490fd5b15611af157565b60405162461bcd60e51b815260206004820152600d60248201526c65746820756e646572666c6f7760981b6044820152606490fd5b9091611b33821515611aaf565b611b3c8261100f565b805480851215611b655750906003611b579201938454611b26565b611286925561177e816118ac565b841315611b7c579060046117d79201938454611b26565b6001611b9a9194939401918254611b9582821015611aea565b611043565b815554611baa5761128691611c81565b508061177e611286926118ac565b80611bc257505f90565b5f525f602052600560405f20015490565b5f818152602081905260408082206004018054808452918320600301805490859055928490529190915590611c07906118ac565b611286816118ac565b5f818152602081905260408082206003018054808452918320600401805490859055928490529190915590611c07906118ac565b15611c4b57565b60405162461bcd60e51b815260206004820152600e60248201526d64656c657465206d697373696e6760901b6044820152606490fd5b611c8c811515611c44565b611c958161100f565b805480841215611caf57506003611b579101928354611c81565b831315611cc55760046117d79101928354611c81565b9150600382019182541580611d75575b611d6257825415611d4f576004810192835415611d1b57506117d790611d03611cfe8554611d81565b61100f565b90815481556001808301549101558354905490611c81565b54925061128691611d2c915061100f565b60055f918281558260018201558260028201558260038201558260048201550155565b60040154915061128690611d2c9061100f565b50611d719150611d2c9061100f565b5f90565b50600481015415611cd5565b5b805f525f602052600360405f20015415611286575f525f602052600360405f200154611d8256fea2646970667358221220c0d65f3db561f0628972e7988b381d3ec7a5d64f7566c1462239d511859b2f2c64736f6c63430008210033'
		}
	}
}
export declare const peripherals_WETH9_WETH9: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'guy'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Deposit'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Withdrawal'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'guy'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'decimals'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deposit'
			readonly stateMutability: 'payable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'name'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'symbol'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'withdraw'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'receive'
			readonly stateMutability: 'payable'
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '608060405234610106576100135f5461010a565b601f81116100b4575b507f577261707065642045746865720000000000000000000000000000000000001a5f5560015461004c9061010a565b601f811161007f575b6008630ae8aa8960e31b016001556002805460ff1916601217905560405161070090816101438239f35b60048111156100555760015f52601f60205f20910160051c5f5b8181106100a7575050610055565b5f83820155600101610099565b600d81111561001c575f8080527f290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e56391601f0160051c905b8181106100f957505061001c565b5f838201556001016100eb565b5f80fd5b90600182811c92168015610138575b602083101461012457565b634e487b7160e01b5f52602260045260245ffd5b91607f169161011956fe60806040526004361015610022575b3615610018575f80fd5b610020610663565b005b5f3560e01c806306fdde0314610409578063095ea7b31461039057806318160ddd1461037557806323b872dd146103465780632e1a7d4d146102ad578063313ce5671461028d57806370a082311461025557806395d89b4114610138578063a9059cbb14610106578063d0e30db0146100f35763dd62ed3e0361000e57346100ef5760403660031901126100ef576100b8610504565b6100c061051a565b6001600160a01b039182165f908152600460209081526040808320949093168252928352819020549051908152f35b5f80fd5b5f3660031901126100ef57610020610663565b346100ef5760403660031901126100ef57602061012e610124610504565b602435903361055e565b6040519015158152f35b346100ef575f3660031901126100ef576040515f6001548060011c9060018116801561024b575b6020831081146102375782855290811561021b57506001146101c5575b50819003601f01601f19168101906001600160401b038211818310176101b157604082905281906101ad90826104da565b0390f35b634e487b7160e01b5f52604160045260245ffd5b60015f9081529091507fb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf65b8282106102055750602091508201018261017c565b60018160209254838588010152019101906101f0565b90506020925060ff191682840152151560051b8201018261017c565b634e487b7160e01b5f52602260045260245ffd5b91607f169161015f565b346100ef5760203660031901126100ef576001600160a01b03610276610504565b165f526003602052602060405f2054604051908152f35b346100ef575f3660031901126100ef57602060ff60025416604051908152f35b346100ef5760203660031901126100ef57600435335f5260036020528060405f2054106100ef57335f52600360205260405f206102eb828254610530565b9055805f811561033d575b5f80809381933390f115610332576040519081527f7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b6560203392a2005b6040513d5f823e3d90fd5b506108fc6102f6565b346100ef5760603660031901126100ef57602061012e610364610504565b61036c61051a565b6044359161055e565b346100ef575f3660031901126100ef57602047604051908152f35b346100ef5760403660031901126100ef576103a9610504565b335f8181526004602090815260408083206001600160a01b03909516808452948252918290206024359081905591519182527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92591a3602060405160018152f35b346100ef575f3660031901126100ef576040515f5f548060011c906001811680156104d0575b6020831081146102375782855290811561021b575060011461047c5750819003601f01601f19168101906001600160401b038211818310176101b157604082905281906101ad90826104da565b5f8080529091507f290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5635b8282106104ba5750602091508201018261017c565b60018160209254838588010152019101906104a5565b91607f169161042f565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100ef57565b602435906001600160a01b03821682036100ef57565b9190820391821161053d57565b634e487b7160e01b5f52601160045260245ffd5b9190820180921161053d57565b60018060a01b031690815f5260036020528260405f2054106100ef573382141580610640575b6105df575b60205f5160206106ab5f395f51905f5291835f526003825260405f206105b0868254610530565b905560018060a01b031693845f526003825260405f206105d1828254610551565b9055604051908152a3600190565b5f82815260046020908152604080832033845290915290205483116100ef5760205f5160206106ab5f395f51905f5291835f526004825260405f2060018060a01b0333165f52825260405f20610636868254610530565b9055915050610589565b505f8281526004602090815260408083203384529091529020545f191415610584565b335f52600360205260405f2061067a348254610551565b90556040513481527fe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c60203392a256feddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa2646970667358221220a027d7e3b9ddbbe6855ca7fbf7f2124973bc38a9a904375a224e5d3f4dfffc6664736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60806040526004361015610022575b3615610018575f80fd5b610020610663565b005b5f3560e01c806306fdde0314610409578063095ea7b31461039057806318160ddd1461037557806323b872dd146103465780632e1a7d4d146102ad578063313ce5671461028d57806370a082311461025557806395d89b4114610138578063a9059cbb14610106578063d0e30db0146100f35763dd62ed3e0361000e57346100ef5760403660031901126100ef576100b8610504565b6100c061051a565b6001600160a01b039182165f908152600460209081526040808320949093168252928352819020549051908152f35b5f80fd5b5f3660031901126100ef57610020610663565b346100ef5760403660031901126100ef57602061012e610124610504565b602435903361055e565b6040519015158152f35b346100ef575f3660031901126100ef576040515f6001548060011c9060018116801561024b575b6020831081146102375782855290811561021b57506001146101c5575b50819003601f01601f19168101906001600160401b038211818310176101b157604082905281906101ad90826104da565b0390f35b634e487b7160e01b5f52604160045260245ffd5b60015f9081529091507fb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf65b8282106102055750602091508201018261017c565b60018160209254838588010152019101906101f0565b90506020925060ff191682840152151560051b8201018261017c565b634e487b7160e01b5f52602260045260245ffd5b91607f169161015f565b346100ef5760203660031901126100ef576001600160a01b03610276610504565b165f526003602052602060405f2054604051908152f35b346100ef575f3660031901126100ef57602060ff60025416604051908152f35b346100ef5760203660031901126100ef57600435335f5260036020528060405f2054106100ef57335f52600360205260405f206102eb828254610530565b9055805f811561033d575b5f80809381933390f115610332576040519081527f7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b6560203392a2005b6040513d5f823e3d90fd5b506108fc6102f6565b346100ef5760603660031901126100ef57602061012e610364610504565b61036c61051a565b6044359161055e565b346100ef575f3660031901126100ef57602047604051908152f35b346100ef5760403660031901126100ef576103a9610504565b335f8181526004602090815260408083206001600160a01b03909516808452948252918290206024359081905591519182527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92591a3602060405160018152f35b346100ef575f3660031901126100ef576040515f5f548060011c906001811680156104d0575b6020831081146102375782855290811561021b575060011461047c5750819003601f01601f19168101906001600160401b038211818310176101b157604082905281906101ad90826104da565b5f8080529091507f290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5635b8282106104ba5750602091508201018261017c565b60018160209254838588010152019101906104a5565b91607f169161042f565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100ef57565b602435906001600160a01b03821682036100ef57565b9190820391821161053d57565b634e487b7160e01b5f52601160045260245ffd5b9190820180921161053d57565b60018060a01b031690815f5260036020528260405f2054106100ef573382141580610640575b6105df575b60205f5160206106ab5f395f51905f5291835f526003825260405f206105b0868254610530565b905560018060a01b031693845f526003825260405f206105d1828254610551565b9055604051908152a3600190565b5f82815260046020908152604080832033845290915290205483116100ef5760205f5160206106ab5f395f51905f5291835f526004825260405f2060018060a01b0333165f52825260405f20610636868254610530565b9055915050610589565b505f8281526004602090815260408083203384529091529020545f191415610584565b335f52600360205260405f2061067a348254610551565b90556040513481527fe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c60203392a256feddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa2646970667358221220a027d7e3b9ddbbe6855ca7fbf7f2124973bc38a9a904375a224e5d3f4dfffc6664736f6c63430008210033'
		}
	}
}
export declare const peripherals_factories_EscalationGameFactory_EscalationGameFactory: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'deployEscalationGame'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'startBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_nonDecisionThreshold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract EscalationGame'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60808060405234601557611cc3908161001a8239f35b5f80fdfe60808060405260043610156011575f80fd5b5f3560e01c6382579fc3146023575f80fd5b3460e257604036600319011260e257611ba7908082016001600160401b0381118282101760c357816020915f946100e7833933815203019082f5801560d7576001600160a01b0316803b1560e25760405190638fb4b57360e01b8252600435600483015260243560248301525f8260448183855af1801560d75760ac575b602090604051908152f35b6001600160401b03821160c35760209160405260a1565b634e487b7160e01b5f52604160045260245ffd5b6040513d5f823e3d90fd5b5f80fdfe608034607d57601f611ba738819003918201601f19168301916001600160401b03831184841017608157808492602094604052833981010312607d57516001600160a01b03811690819003607d57600580546001600160a01b03199081169290921790556009805490911633179055604051611b1190816100968239f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe60806040526004361015610011575f80fd5b5f3560e01c8062113e0814610f655780630757581714610f4757806310b40b4914610f2a5780632493333014610f1057806339518b5e14610ef45780633bdc2c0514610c9a5780633c5e6c9714610c805780634903b0d114610c54578063498eec4014610c365780636538919014610c0d5780638da5cb5b14610be55780638fb4b57314610990578063a697afb414610968578063b1290c6b14610903578063c4b8e520146108e6578063ca539aed146108cc578063d20d04ab146108af578063e2247da914610429578063e57bd89c1461040c578063eab13564146103d1578063eb0548771461025f578063f7b2a8e31461023b5763fb8b799214610115575f80fd5b34610237576040366003190112610237576024356001600160a01b03811690600435908290036102375761015460018060a01b0360055416331461125b565b600a546101f25761016361146d565b9160048310156101de5761019a9060ff84165f5260046020526101898360405f20610fe0565b50546001600160a01b03161461135a565b6101da6101cb5f516020611a9c5f395f51905f526101b8858561155c565b93819791929660405193849389856113a6565b0390a160405193849384610ff9565b0390f35b634e487b7160e01b5f52602160045260245ffd5b60405162461bcd60e51b815260206004820152601f60248201527f53797374656d206861732072656163686564206e6f6e2d6465636973696f6e006044820152606490fd5b5f80fd5b34610237575f366003190112610237576020610255611904565b6040519015158152f35b346102375760603660031901126102375760043560048110156102375760243560443561028b816118d9565b926102996040519485611032565b818452601f196102a8836118d9565b015f5b8181106103ba5750506102be8284611093565b9160ff5f921692835f52600460205260405f2054105f146103a85750505f91815f52600460205260405f2054925b815b84811061035c57856040518091602082016020835281518091526020604084019201905f5b818110610321575050500390f35b825180516001600160a01b03168552602081810151818701526040918201519186019190915286955060609094019390920191600101610313565b816101de57600190845f5260046020526103a161037c8260405f20610fe0565b5061039061038a8785611086565b91611329565b61039a828b6118f0565b52886118f0565b50016102ee565b6103b490849294611093565b926102ec565b6020906103c561153e565b828289010152016102ab565b34610237576040366003190112610237576024356004811015610237576103fd6101da9160043561155c565b60409391935193849384610ff9565b34610237575f366003190112610237576020600654604051908152f35b34610237576060366003190112610237576004356001600160a01b03811690819003610237576024359060048210156102375760443590600a54610858576005546001600160a01b031633036108135761048660038414156112e5565b61048e61146d565b60048110156101de576003036107cf5760038310156107bb5782600101918254926006549182851015610787576007548110610722576104ce8584611086565b908181111561071a5750935b846104e58183611093565b936001549060025491600354908381115f1461070157818111156106fb57805b809481925b8d6106b65750149182156106ac575b5050915b80871492836106a4575b508261069a575b5050610677575b505081905561054261153e565b91808352602083018481526040840192835260ff861690815f52600460205260405f208054600160401b8110156106635761058291600182018155610fe0565b959095610650575185546001600160a01b0319166001600160a01b0391909116178555516001850181905583516002909501949094555f908152600460205260409020545f1981019590861161063c576020957f76d404f6c77a6e7654712999924e07301be3b256d4b99f65ccbef115a25496859461060e60a095519360405195865289860190610fd3565b604084015260608301526080820152a1610626611904565b610633575b604051908152f35b42600a5561062b565b634e487b7160e01b5f52601160045260245ffd5b634e487b7160e01b5f525f60045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b91925093505f19810190811161063c57806106929194611093565b908580610535565b109050888061052e565b92508a610527565b149050828b610519565b915060018d036106de575081149182156106d4575b50505b9161051d565b149050828b6106cb565b925081149182156106f1575b50506106ce565b149050828b6106ea565b81610505565b8184111561071457835b8094819261050a565b8161070b565b9050936104da565b60405162461bcd60e51b815260206004820152603760248201527f616c6c20616d6f756e7473206e65656420746f20626520626967676572206f7260448201527608195c5d585b081d1bc81cdd185c9d0819195c1bdcda5d604a1b6064820152608490fd5b60405162461bcd60e51b815260206004820152600c60248201526b105b1c9958591e48199d5b1b60a21b6044820152606490fd5b634e487b7160e01b5f52603260045260245ffd5b60405162461bcd60e51b815260206004820152601c60248201527b14de5cdd195b481a185cc8185b1c9958591e481d1a5b5959081bdd5d60221b6044820152606490fd5b60405162461bcd60e51b815260206004820152601e60248201527f4f6e6c7920536563757269747920506f6f6c2063616e206465706f73697400006044820152606490fd5b60405162461bcd60e51b815260206004820152602960248201527f53797374656d2068617320616c726561647920726561636865642061206e6f6e60448201526816b232b1b4b9b4b7b760b91b6064820152608490fd5b34610237575f366003190112610237576020600854604051908152f35b34610237575f36600319011261023757602061062b61151a565b34610237575f366003190112610237576020600a54604051908152f35b346102375760403660031901126102375760043560ff811680910361023757602435905f52600460205260405f209081548110156102375761094491610fe0565b5060018060a01b038154166101da6002600184015493015460405193849384610ff9565b34610237575f366003190112610237576005546040516001600160a01b039091168152602090f35b346102375760403660031901126102375760095460243590600435906001600160a01b03163303610ba9575f54610b725780821115610b2e578015610aeb57670de0b6b3a76400008110610a9a57670de0b6b3a76400008210610a4a576203f480420180421161063c577fedb371157a97763aaa1b348e6811cbb8c9eb299aaf93a6f5ba91f312bcb40fcf92606092825f558160065580600755610a34828261195a565b60085560405192835260208301526040820152a1005b60405162461bcd60e51b815260206004820152602260248201527f7468726573686f6c64206d757374206265206174206c6561737420312065746860448201526132b960f11b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f737461727420626f6e64206d757374206265206174206c6561737420312065746044820152623432b960e91b6064820152608490fd5b60405162461bcd60e51b815260206004820152601b60248201527a737461727420626f6e64206d75737420626520706f73697469766560281b6044820152606490fd5b606460405162461bcd60e51b815260206004820152602060248201527f7468726573686f6c64206d7573742065786365656420737461727420626f6e646044820152fd5b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610237575f366003190112610237576009546040516001600160a01b039091168152602090f35b34610237575f366003190112610237576020610c2761146d565b610c346040518092610fd3565bf35b3461023757602036600319011261023757602061062b600435611408565b346102375760203660031901126102375760043560038110156102375760209060010154604051908152f35b34610237575f36600319011261023757602061062b6113d4565b3461023757606036600319011261023757600435602435906004821015610237576044356001600160a01b0381169190829003610237576005546001600160a01b0316610ce833821461125b565b604051634fffd03760e01b815290602082600481845afa918215610e87575f92610ebf575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f91610e92575b506040516387ca99af60e01b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f91610e55575b5015610e18575f516020611a9c5f395f51905f52610e0991604094610d9d60038214156112e5565b60ff8116805f526004602052610dd2610dc1610dbb858a5f20610fe0565b50611329565b9660018060a01b038851161461135a565b5f5260046020525f6001610de884898420610fe0565b500155602060018060a01b03865116950151938492875193849388856113a6565b0390a182519182526020820152f35b60405162461bcd60e51b8152602060048201526015602482015274169bdb1d185c881a185cc81b9bdd08199bdc9ad959605a1b6044820152606490fd5b90506020813d602011610e7f575b81610e7060209383611032565b81010312610237575184610d75565b3d9150610e63565b6040513d5f823e3d90fd5b610eb29150823d8411610eb8575b610eaa8183611032565b8101906112c6565b86610d36565b503d610ea0565b6004919250610ee5602091823d8411610eed575b610edd8183611032565b8101906112a7565b929150610d0d565b503d610ed3565b34610237575f3660031901126102375760205f54604051908152f35b34610237575f36600319011261023757602061062b6111c9565b34610237575f366003190112610237576020600754604051908152f35b3461023757602036600319011261023757602061062b6004356110a0565b34610237575f366003190112610237576060604051610f848282611032565b369037604051610f9381611017565b60015481526002546020820152600354604082015260405190815f905b60038210610fbd57606084f35b6020806001928551815201930191019091610fb0565b9060048210156101de5752565b80548210156107bb575f52600360205f20910201905f90565b604091949392606082019560018060a01b0316825260208201520152565b606081019081106001600160401b0382111761066357604052565b601f909101601f19168101906001600160401b0382119082101761066357604052565b8181029291811591840414171561063c57565b8115611072570490565b634e487b7160e01b5f52601260045260245ffd5b9190820391821161063c57565b9190820180921161063c57565b6007546006549162409980811161119557801561118f5762409980811461118a576110d16240998091600854611055565b04620a939b810490620a939b8202828104620a939b148315171561063c576110f891611086565b90620f4240829083810180911161063c57926002915b6010831061113d575b5050509161112b91620f4240931b90611055565b0481811115611138575090565b905090565b8161114a91959395611055565b620f42408502858104620f4240148615171561063c5761116991611068565b9182156111845761117c83600192611093565b94019161110e565b93611117565b505090565b50905090565b60405162461bcd60e51b815260206004820152600c60248201526b496e76616c69642074696d6560a01b6044820152606490fd5b600154600254808210158061124f575b8015611238575b156111e9575090565b9080821015908161122b575b811561120b575b50611208575060035490565b90565b600354831015915081611220575b505f6111fc565b90508111155f611219565b60035483111591506111f5565b5060035482101580156111e05750808211156111e0565b506003548211156111d9565b1561126257565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c7920536563757269747920506f6f6c2063616e207769746864726177006044820152606490fd5b9081602091031261023757516001600160a01b03811681036102375790565b9081602091031261023757516001600160f81b03811681036102375790565b156112ec57565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b9060405161133681611017565b82546001600160a01b03168152600183015460208201526002909201546040830152565b1561136157565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c79206465706f736974206f776e65722063616e207769746864726177006044820152606490fd5b6001600160a01b039091168152608081019493926060926113cb906020840190610fd3565b60408201520152565b5f5442811015611403576113e89042611086565b624099808110156113fc57611208906110a0565b5060065490565b505f90565b60075490818111156114535760065481101561144a576114279161195a565b6240998081029080820462409980149015171561063c5760085461120891611068565b50506240998090565b50505f90565b9060ff8091169116019060ff821161063c57565b6114756113d4565b60015490808210611513576001915b600280549360ff906114b49085871061150a576114af60015b60035497881061150357600192611459565b611459565b1610156114fb57828111806114f2575b6114eb57821191826114e1575b50506114dc57600290565b600190565b1190505f806114d1565b5050505f90565b508181116114c4565b505050600390565b5f92611459565b6114af5f61149d565b5f91611484565b600a548061120857506112085f546115386115336111c9565b611408565b90611093565b6040519061154b82611017565b5f6040838281528260208201520152565b919060018060a01b036005541680331490811561185c575b50156117fa5760048110156101de5760016115c460ff8361159960035f9614156112e5565b169485845260046020526115b3610dbb8260408720610fe0565b958452600460205260408420610fe0565b50015581516020830180516001600160a01b039092169360406115e56111c9565b91019081518181115f146117605750505051915f5b600554604051634fffd03760e01b8152906001600160a01b0316602082600481845afa918215610e87575f9261173b575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f9161171e575b50604051634044d26360e11b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f916116ec575b50600654908181106116c1575b505060405f516020611abc5f395f51905f52918151908682526020820152a1565b6040916116e06116e5925f516020611abc5f395f51905f529598611055565b611068565b94916116a0565b90506020813d602011611716575b8161170760209383611032565b8101031261023757515f611693565b3d91506116fa565b6117359150823d8411610eb857610eaa8183611032565b5f611654565b6004919250611758602091823d8411610eed57610edd8183611032565b92915061162b565b61176f82918597955190611093565b11156117c05761178561178a9251865190611093565b611086565b928360011b908482046002148515171561063c57611785826117b560056117ba950497889451611086565b611093565b926115fa565b505082518060011b908082046002149015171561063c576005900492518060011b908082046002149015171561063c57836117ba91611086565b60405162461bcd60e51b815260206004820152603460248201527f4f6e6c7920536563757269747920506f6f6c206f722064657369676e6174656460448201527320666f726b65722063616e20776974686472617760601b6064820152608490fd5b604051631204b6bd60e31b81529150602090829060049082905afa908115610e87575f91611897575b506001600160a01b031633145f611574565b90506020813d6020116118d1575b816118b260209383611032565b8101031261023757516001600160a01b0381168103610237575f611885565b3d91506118a5565b6001600160401b0381116106635760051b60200190565b80518210156107bb5760209160051b010190565b600260ff61193e600154600654809110155f14611950576114af6001915b85548111611949576001905b6003541061150357600192611459565b1610156114dc575f90565b5f9061192e565b6114af5f91611922565b5f905b8060011b908082046002148115171561063c57818410611983575060019091019061195d565b61199b91509291926119958184611086565b92611093565b620f4240820291808304620f4240149015171561063c576119bb91611068565b90811561145357620a939b810290808204620a939b149015171561063c57620f42406119e78380611055565b6001919004835b60108310611a17575b5050506001600160ff1b038216820361063c576112089160011b90611093565b81611a2491959395611055565b600185901b906001600160ff1b038616860361063c575f19820182811161063c57611a4e91611055565b906001810180911161063c57620f4240810290808204620f4240149015171561063c57611a7a91611068565b918215611a9557611a8d83600192611093565b9401916119ee565b936119f756fe74839e2d346f4dd419b9f83f68e3802298d7bcceec5468ed97aa5abbb1c2764252b1aa0106c8f02c90bbf2a2a2589b772cfe95ba33c37c499c7cbdb7c8410ceda264697066735822122061fd77ac2b69d1a47a2a5f141cc4c059919aa9427c5db4ac9e4edfb4d8575dac64736f6c63430008210033a26469706673582212205ccc2da2c702a5b8c969553c98f395dbfb61480e1e6376d394cabb6720556bb264736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60808060405260043610156011575f80fd5b5f3560e01c6382579fc3146023575f80fd5b3460e257604036600319011260e257611ba7908082016001600160401b0381118282101760c357816020915f946100e7833933815203019082f5801560d7576001600160a01b0316803b1560e25760405190638fb4b57360e01b8252600435600483015260243560248301525f8260448183855af1801560d75760ac575b602090604051908152f35b6001600160401b03821160c35760209160405260a1565b634e487b7160e01b5f52604160045260245ffd5b6040513d5f823e3d90fd5b5f80fdfe608034607d57601f611ba738819003918201601f19168301916001600160401b03831184841017608157808492602094604052833981010312607d57516001600160a01b03811690819003607d57600580546001600160a01b03199081169290921790556009805490911633179055604051611b1190816100968239f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe60806040526004361015610011575f80fd5b5f3560e01c8062113e0814610f655780630757581714610f4757806310b40b4914610f2a5780632493333014610f1057806339518b5e14610ef45780633bdc2c0514610c9a5780633c5e6c9714610c805780634903b0d114610c54578063498eec4014610c365780636538919014610c0d5780638da5cb5b14610be55780638fb4b57314610990578063a697afb414610968578063b1290c6b14610903578063c4b8e520146108e6578063ca539aed146108cc578063d20d04ab146108af578063e2247da914610429578063e57bd89c1461040c578063eab13564146103d1578063eb0548771461025f578063f7b2a8e31461023b5763fb8b799214610115575f80fd5b34610237576040366003190112610237576024356001600160a01b03811690600435908290036102375761015460018060a01b0360055416331461125b565b600a546101f25761016361146d565b9160048310156101de5761019a9060ff84165f5260046020526101898360405f20610fe0565b50546001600160a01b03161461135a565b6101da6101cb5f516020611a9c5f395f51905f526101b8858561155c565b93819791929660405193849389856113a6565b0390a160405193849384610ff9565b0390f35b634e487b7160e01b5f52602160045260245ffd5b60405162461bcd60e51b815260206004820152601f60248201527f53797374656d206861732072656163686564206e6f6e2d6465636973696f6e006044820152606490fd5b5f80fd5b34610237575f366003190112610237576020610255611904565b6040519015158152f35b346102375760603660031901126102375760043560048110156102375760243560443561028b816118d9565b926102996040519485611032565b818452601f196102a8836118d9565b015f5b8181106103ba5750506102be8284611093565b9160ff5f921692835f52600460205260405f2054105f146103a85750505f91815f52600460205260405f2054925b815b84811061035c57856040518091602082016020835281518091526020604084019201905f5b818110610321575050500390f35b825180516001600160a01b03168552602081810151818701526040918201519186019190915286955060609094019390920191600101610313565b816101de57600190845f5260046020526103a161037c8260405f20610fe0565b5061039061038a8785611086565b91611329565b61039a828b6118f0565b52886118f0565b50016102ee565b6103b490849294611093565b926102ec565b6020906103c561153e565b828289010152016102ab565b34610237576040366003190112610237576024356004811015610237576103fd6101da9160043561155c565b60409391935193849384610ff9565b34610237575f366003190112610237576020600654604051908152f35b34610237576060366003190112610237576004356001600160a01b03811690819003610237576024359060048210156102375760443590600a54610858576005546001600160a01b031633036108135761048660038414156112e5565b61048e61146d565b60048110156101de576003036107cf5760038310156107bb5782600101918254926006549182851015610787576007548110610722576104ce8584611086565b908181111561071a5750935b846104e58183611093565b936001549060025491600354908381115f1461070157818111156106fb57805b809481925b8d6106b65750149182156106ac575b5050915b80871492836106a4575b508261069a575b5050610677575b505081905561054261153e565b91808352602083018481526040840192835260ff861690815f52600460205260405f208054600160401b8110156106635761058291600182018155610fe0565b959095610650575185546001600160a01b0319166001600160a01b0391909116178555516001850181905583516002909501949094555f908152600460205260409020545f1981019590861161063c576020957f76d404f6c77a6e7654712999924e07301be3b256d4b99f65ccbef115a25496859461060e60a095519360405195865289860190610fd3565b604084015260608301526080820152a1610626611904565b610633575b604051908152f35b42600a5561062b565b634e487b7160e01b5f52601160045260245ffd5b634e487b7160e01b5f525f60045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b91925093505f19810190811161063c57806106929194611093565b908580610535565b109050888061052e565b92508a610527565b149050828b610519565b915060018d036106de575081149182156106d4575b50505b9161051d565b149050828b6106cb565b925081149182156106f1575b50506106ce565b149050828b6106ea565b81610505565b8184111561071457835b8094819261050a565b8161070b565b9050936104da565b60405162461bcd60e51b815260206004820152603760248201527f616c6c20616d6f756e7473206e65656420746f20626520626967676572206f7260448201527608195c5d585b081d1bc81cdd185c9d0819195c1bdcda5d604a1b6064820152608490fd5b60405162461bcd60e51b815260206004820152600c60248201526b105b1c9958591e48199d5b1b60a21b6044820152606490fd5b634e487b7160e01b5f52603260045260245ffd5b60405162461bcd60e51b815260206004820152601c60248201527b14de5cdd195b481a185cc8185b1c9958591e481d1a5b5959081bdd5d60221b6044820152606490fd5b60405162461bcd60e51b815260206004820152601e60248201527f4f6e6c7920536563757269747920506f6f6c2063616e206465706f73697400006044820152606490fd5b60405162461bcd60e51b815260206004820152602960248201527f53797374656d2068617320616c726561647920726561636865642061206e6f6e60448201526816b232b1b4b9b4b7b760b91b6064820152608490fd5b34610237575f366003190112610237576020600854604051908152f35b34610237575f36600319011261023757602061062b61151a565b34610237575f366003190112610237576020600a54604051908152f35b346102375760403660031901126102375760043560ff811680910361023757602435905f52600460205260405f209081548110156102375761094491610fe0565b5060018060a01b038154166101da6002600184015493015460405193849384610ff9565b34610237575f366003190112610237576005546040516001600160a01b039091168152602090f35b346102375760403660031901126102375760095460243590600435906001600160a01b03163303610ba9575f54610b725780821115610b2e578015610aeb57670de0b6b3a76400008110610a9a57670de0b6b3a76400008210610a4a576203f480420180421161063c577fedb371157a97763aaa1b348e6811cbb8c9eb299aaf93a6f5ba91f312bcb40fcf92606092825f558160065580600755610a34828261195a565b60085560405192835260208301526040820152a1005b60405162461bcd60e51b815260206004820152602260248201527f7468726573686f6c64206d757374206265206174206c6561737420312065746860448201526132b960f11b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f737461727420626f6e64206d757374206265206174206c6561737420312065746044820152623432b960e91b6064820152608490fd5b60405162461bcd60e51b815260206004820152601b60248201527a737461727420626f6e64206d75737420626520706f73697469766560281b6044820152606490fd5b606460405162461bcd60e51b815260206004820152602060248201527f7468726573686f6c64206d7573742065786365656420737461727420626f6e646044820152fd5b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610237575f366003190112610237576009546040516001600160a01b039091168152602090f35b34610237575f366003190112610237576020610c2761146d565b610c346040518092610fd3565bf35b3461023757602036600319011261023757602061062b600435611408565b346102375760203660031901126102375760043560038110156102375760209060010154604051908152f35b34610237575f36600319011261023757602061062b6113d4565b3461023757606036600319011261023757600435602435906004821015610237576044356001600160a01b0381169190829003610237576005546001600160a01b0316610ce833821461125b565b604051634fffd03760e01b815290602082600481845afa918215610e87575f92610ebf575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f91610e92575b506040516387ca99af60e01b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f91610e55575b5015610e18575f516020611a9c5f395f51905f52610e0991604094610d9d60038214156112e5565b60ff8116805f526004602052610dd2610dc1610dbb858a5f20610fe0565b50611329565b9660018060a01b038851161461135a565b5f5260046020525f6001610de884898420610fe0565b500155602060018060a01b03865116950151938492875193849388856113a6565b0390a182519182526020820152f35b60405162461bcd60e51b8152602060048201526015602482015274169bdb1d185c881a185cc81b9bdd08199bdc9ad959605a1b6044820152606490fd5b90506020813d602011610e7f575b81610e7060209383611032565b81010312610237575184610d75565b3d9150610e63565b6040513d5f823e3d90fd5b610eb29150823d8411610eb8575b610eaa8183611032565b8101906112c6565b86610d36565b503d610ea0565b6004919250610ee5602091823d8411610eed575b610edd8183611032565b8101906112a7565b929150610d0d565b503d610ed3565b34610237575f3660031901126102375760205f54604051908152f35b34610237575f36600319011261023757602061062b6111c9565b34610237575f366003190112610237576020600754604051908152f35b3461023757602036600319011261023757602061062b6004356110a0565b34610237575f366003190112610237576060604051610f848282611032565b369037604051610f9381611017565b60015481526002546020820152600354604082015260405190815f905b60038210610fbd57606084f35b6020806001928551815201930191019091610fb0565b9060048210156101de5752565b80548210156107bb575f52600360205f20910201905f90565b604091949392606082019560018060a01b0316825260208201520152565b606081019081106001600160401b0382111761066357604052565b601f909101601f19168101906001600160401b0382119082101761066357604052565b8181029291811591840414171561063c57565b8115611072570490565b634e487b7160e01b5f52601260045260245ffd5b9190820391821161063c57565b9190820180921161063c57565b6007546006549162409980811161119557801561118f5762409980811461118a576110d16240998091600854611055565b04620a939b810490620a939b8202828104620a939b148315171561063c576110f891611086565b90620f4240829083810180911161063c57926002915b6010831061113d575b5050509161112b91620f4240931b90611055565b0481811115611138575090565b905090565b8161114a91959395611055565b620f42408502858104620f4240148615171561063c5761116991611068565b9182156111845761117c83600192611093565b94019161110e565b93611117565b505090565b50905090565b60405162461bcd60e51b815260206004820152600c60248201526b496e76616c69642074696d6560a01b6044820152606490fd5b600154600254808210158061124f575b8015611238575b156111e9575090565b9080821015908161122b575b811561120b575b50611208575060035490565b90565b600354831015915081611220575b505f6111fc565b90508111155f611219565b60035483111591506111f5565b5060035482101580156111e05750808211156111e0565b506003548211156111d9565b1561126257565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c7920536563757269747920506f6f6c2063616e207769746864726177006044820152606490fd5b9081602091031261023757516001600160a01b03811681036102375790565b9081602091031261023757516001600160f81b03811681036102375790565b156112ec57565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b9060405161133681611017565b82546001600160a01b03168152600183015460208201526002909201546040830152565b1561136157565b60405162461bcd60e51b815260206004820152601f60248201527f4f6e6c79206465706f736974206f776e65722063616e207769746864726177006044820152606490fd5b6001600160a01b039091168152608081019493926060926113cb906020840190610fd3565b60408201520152565b5f5442811015611403576113e89042611086565b624099808110156113fc57611208906110a0565b5060065490565b505f90565b60075490818111156114535760065481101561144a576114279161195a565b6240998081029080820462409980149015171561063c5760085461120891611068565b50506240998090565b50505f90565b9060ff8091169116019060ff821161063c57565b6114756113d4565b60015490808210611513576001915b600280549360ff906114b49085871061150a576114af60015b60035497881061150357600192611459565b611459565b1610156114fb57828111806114f2575b6114eb57821191826114e1575b50506114dc57600290565b600190565b1190505f806114d1565b5050505f90565b508181116114c4565b505050600390565b5f92611459565b6114af5f61149d565b5f91611484565b600a548061120857506112085f546115386115336111c9565b611408565b90611093565b6040519061154b82611017565b5f6040838281528260208201520152565b919060018060a01b036005541680331490811561185c575b50156117fa5760048110156101de5760016115c460ff8361159960035f9614156112e5565b169485845260046020526115b3610dbb8260408720610fe0565b958452600460205260408420610fe0565b50015581516020830180516001600160a01b039092169360406115e56111c9565b91019081518181115f146117605750505051915f5b600554604051634fffd03760e01b8152906001600160a01b0316602082600481845afa918215610e87575f9261173b575b506020600491604051928380926344c094a360e01b82525afa8015610e87576020915f9161171e575b50604051634044d26360e11b81526001600160f81b03909116600482015291829060249082906001600160a01b03165afa908115610e87575f916116ec575b50600654908181106116c1575b505060405f516020611abc5f395f51905f52918151908682526020820152a1565b6040916116e06116e5925f516020611abc5f395f51905f529598611055565b611068565b94916116a0565b90506020813d602011611716575b8161170760209383611032565b8101031261023757515f611693565b3d91506116fa565b6117359150823d8411610eb857610eaa8183611032565b5f611654565b6004919250611758602091823d8411610eed57610edd8183611032565b92915061162b565b61176f82918597955190611093565b11156117c05761178561178a9251865190611093565b611086565b928360011b908482046002148515171561063c57611785826117b560056117ba950497889451611086565b611093565b926115fa565b505082518060011b908082046002149015171561063c576005900492518060011b908082046002149015171561063c57836117ba91611086565b60405162461bcd60e51b815260206004820152603460248201527f4f6e6c7920536563757269747920506f6f6c206f722064657369676e6174656460448201527320666f726b65722063616e20776974686472617760601b6064820152608490fd5b604051631204b6bd60e31b81529150602090829060049082905afa908115610e87575f91611897575b506001600160a01b031633145f611574565b90506020813d6020116118d1575b816118b260209383611032565b8101031261023757516001600160a01b0381168103610237575f611885565b3d91506118a5565b6001600160401b0381116106635760051b60200190565b80518210156107bb5760209160051b010190565b600260ff61193e600154600654809110155f14611950576114af6001915b85548111611949576001905b6003541061150357600192611459565b1610156114dc575f90565b5f9061192e565b6114af5f91611922565b5f905b8060011b908082046002148115171561063c57818410611983575060019091019061195d565b61199b91509291926119958184611086565b92611093565b620f4240820291808304620f4240149015171561063c576119bb91611068565b90811561145357620a939b810290808204620a939b149015171561063c57620f42406119e78380611055565b6001919004835b60108310611a17575b5050506001600160ff1b038216820361063c576112089160011b90611093565b81611a2491959395611055565b600185901b906001600160ff1b038616860361063c575f19820182811161063c57611a4e91611055565b906001810180911161063c57620f4240810290808204620f4240149015171561063c57611a7a91611068565b918215611a9557611a8d83600192611093565b9401916119ee565b936119f756fe74839e2d346f4dd419b9f83f68e3802298d7bcceec5468ed97aa5abbb1c2764252b1aa0106c8f02c90bbf2a2a2589b772cfe95ba33c37c499c7cbdb7c8410ceda264697066735822122061fd77ac2b69d1a47a2a5f141cc4c059919aa9427c5db4ac9e4edfb4d8575dac64736f6c63430008210033a26469706673582212205ccc2da2c702a5b8c969553c98f395dbfb61480e1e6376d394cabb6720556bb264736f6c63430008210033'
		}
	}
}
export declare const peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'deployPriceOracleManagerAndOperatorQueuer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_openOracle'
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
				{
					readonly name: '_reputationToken'
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
				},
				{
					readonly name: 'salt'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60808060405234601557611713908161001a8239f35b5f80fdfe6080600436101561000e575f80fd5b5f3560e01c6316537fe914610021575f80fd5b34610103576060366003190112610103576004356001600160a01b03811690819003610103576024356001600160a01b0381169190829003610103576020830191338352604435604085015260408452606084019284841060018060401b038511176100ef57604084905284519020936115d680820193909290606085016001600160401b038111878210176100ef576060946101088839526080840152601f1992030101905ff580156100e4576040516001600160a01b039091168152602090f35b6040513d5f823e3d90fd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe60c03461009957601f6115d638819003918201601f19168301916001600160401b0383118484101761009d578084926040948552833981010312610099578051906001600160a01b038216820361009957602001516001600160a01b03811681036100995760805260a05260405161152490816100b28239608051816109a4015260a0518181816102ec01528181610c000152610e730152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f905f3560e01c908163044b25e814610e6157508063053f14da14610e44578063066530ba14610e265780630d0a761b14610d965780631604f9ea146109745780632a6f710c1461050f5780633611956c146104ea5780633b05cb0a1461047b5780633c4dee16146103fa57806343739382146102c05780635ef99e2c146102a3578063661a6e9d146102855780638e274f2d1461026757806392d9583614610145578063a697afb41461011c578063d3caa14e146100f95763e6602da8146100d9575f80fd5b346100f657806003193601126100f6576020600554604051908152f35b80fd5b50346100f657806003193601126100f6576020610114611497565b604051908152f35b50346100f657806003193601126100f6576004546040516001600160a01b039091168152602090f35b50346100f657806003193601126100f6576040816101009260e0835161016a81610edb565b82815282602082015282858201528260608201528260808201528260a08201528260c082015201526001548152600660205220604051906101aa82610edb565b8054906101ba60ff831684611477565b602083019160018060a01b039060081c16825260018060a01b03600182015416604084019081526002820154606085019081526003830154906080860191825260048401549260a08701938452600660058601549560c0890196875201549560e0880196875261022e604051809951610ea2565b516001600160a01b03908116602089015290511660408701525160608601525160808501525160a08401525160c08301525160e0820152f35b50346100f657806003193601126100f6576020600254604051908152f35b50346100f657806003193601126100f6576020600154604051908152f35b50346100f657806003193601126100f65760209054604051908152f35b50346100f65760a03660031901126100f6576004356024356102e0610eaf565b506102e9610ec5565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036103b95782548203610379577f105ef48e33e056f268bf84d375d020be5e62281274554de0094343712dd08ee791604091848055426002558060035582519182526020820152a160015480610369575080f35b6103729061107b565b8060015580f35b60405162461bcd60e51b81526020600482015260186024820152776e6f74207265706f7274206372656174656420627920757360401b6044820152606490fd5b60405162461bcd60e51b81526020600482015260196024820152781bdb9b1e481bdc195b881bdc9858db194818d85b8818d85b1b603a1b6044820152606490fd5b50346100f65760203660031901126100f6576004356001600160a01b03811690819003610477576004546001600160a01b038116610443576001600160a01b0319161760045580f35b60405162461bcd60e51b815260206004820152600c60248201526b616c7265616479207365742160a01b6044820152606490fd5b5080fd5b50346100f65760203660031901126100f6576004546001600160a01b031633036104a85760043560035580f35b60405162461bcd60e51b815260206004820152601a6024820152791bdb9b1e481cd958dd5c9a5d1e481c1bdbdb0818d85b881cd95d60321b6044820152606490fd5b50346100f657806003193601126100f6576020610505611483565b6040519015158152f35b5060603660031901126107d35760043560038110156107d3576024356001600160a01b038116908190036107d357604435801561092f576005545f19811461091b57600101918260055560018060a01b0360045416916040516328c16ded60e21b815282600482015260a081602481875afa9182156107c8575f915f936108e0575b50604051630a40d29760e21b8152602081600481895afa9081156107c8575f9161089b575b506040516370a0823160e01b8152600481018790529490602090869060249082906001600160a01b03165afa9485156107c8575f95610864575b5060206004966040519788809263021b50ff60e01b82525afa9586156107c8575f96610830575b5061062e604051986106288a610edb565b89611477565b602088019633885260408901918252606089019283526080890193845260a0890194855260c0890195865260e089019687525f52600660205260405f209751600381101561081c5760069760ff8a5491610100600160a81b03905160081b1692169060018060a81b03191617178855600188019060018060a01b0390511660018060a01b031982541617905551600287015551600386015551600485015551600584015551910155805f6106e0611483565b15610756576106fa906106f460055461107b565b3461142c565b806107025750f35b81808092335af1610711611439565b501561071a5780f35b60405162461bcd60e51b81526020600482015260146024820152730ccc2d2d8cac840e8de40e4cae8eae4dc40cae8d60631b6044820152606490fd5b60015415610768575b6106fa906106f4565b5050600554600155610778611497565b8034106107d75780303b156107d3575f60049160405192838092630b027cf560e11b8252305af180156107c8576107b2575b50819061075f565b6106fa92505f6107c191610ef7565b5f916107aa565b6040513d5f823e3d90fd5b5f80fd5b60405162461bcd60e51b815260206004820152601f60248201527f6e6f7420656e6f7567682065746820746f2072657175657374207072696365006044820152606490fd5b634e487b7160e01b5f52602160045260245ffd5b9095506020813d60201161085c575b8161084c60209383610ef7565b810103126107d35751945f610617565b3d915061083f565b9594506020863d602011610893575b8161088060209383610ef7565b810103126107d3579451939460206105f0565b3d9150610873565b90506020813d6020116108d8575b816108b660209383610ef7565b810103126107d35751936001600160a01b03851685036107d3579360206105b6565b3d91506108a9565b9150915060a0813d60a011610913575b816108fd60a09383610ef7565b810103126107d35760208151910151915f610591565b3d91506108f0565b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b815260206004820152601d60248201527f6e65656420746f20646f206e6f6e207a65726f206f7065726174696f6e0000006044820152606490fd5b5f3660031901126107d3575f54610d575761098d611497565b803410610d16576040516318160ddd60e01b8152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316602083600481845afa9283156107c8575f93610ce2575b504860011b4881046002144815171561091b57620186a0810290808204620186a0149015171561091b57604051936102408501906001600160401b03821186831017610cce57620186a0916040526406251cabf886520460208501526040840152606083015260b460808301525f60a08301525f60c083015273c02aaa39b223fe8d0a0e5c4f27ead9083c756cc260e0830152620f4240610100830152612710610120830152608c61014083015260016101608301525f6101808301525f6101a0830152306101c08301526321b9c9c160e11b6101e08301525f61020083015260016102208301526102206040519263f30ef90560e01b845280516004850152602081015160248501526040810151604485015260018060a01b03606082015116606485015265ffffffffffff608082015116608485015262ffffff60a08201511660a485015262ffffff60c08201511660c485015260018060a01b0360e08201511660e485015263ffffffff6101008201511661010485015262ffffff6101208201511661012485015261ffff61014082015116610144850152610160810151151561016485015261018081015115156101848501526101a081015115156101a485015260018060a01b036101c0820151166101c485015263ffffffff60e01b6101e0820151166101e485015260018060a01b036102008201511661020485015201511515610224830152602082610244818460018060a01b037f0000000000000000000000000000000000000000000000000000000000000000165af180156107c8575f90610c9a575b610c3c92505f553461142c565b80610c4357005b5f80808093335af1610c53611439565b5015610c5b57005b60405162461bcd60e51b81526020600482015260176024820152766661696c656420746f20726566756e642065786365737360481b6044820152606490fd5b506020823d602011610cc6575b81610cb460209383610ef7565b810103126107d357610c3c9151610c2f565b3d9150610ca7565b634e487b7160e01b5f52604160045260245ffd5b9092506020813d602011610d0e575b81610cfe60209383610ef7565b810103126107d3575191836109e3565b3d9150610cf1565b60405162461bcd60e51b81526020600482015260196024820152786e6f742062696720656e6f7567682065746820626f756e747960381b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276105b1c9958591e481c195b991a5b99c81c995c5d595cdd604a1b6044820152606490fd5b346107d35760203660031901126107d3576004355f52600660205261010060405f2080549060018060a01b036001820154169060028101546003820154600483015491600660058501549401549460405196610df58860ff8316610ea2565b60081c6001600160a01b0316602088015260408701526060860152608085015260a084015260c083015260e0820152f35b346107d35760203660031901126107d357610e4260043561107b565b005b346107d3575f3660031901126107d3576020600354604051908152f35b346107d3575f3660031901126107d3577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b90600382101561081c5752565b606435906001600160a01b03821682036107d357565b608435906001600160a01b03821682036107d357565b61010081019081106001600160401b03821117610cce57604052565b601f909101601f19168101906001600160401b03821190821017610cce57604052565b6001600160a01b039091168152602081019190915260400190565b9060a092610f499183526020830190610ea2565b60016040820152608060608201525f60808201520190565b5f9060033d11610f6d57565b905060045f803e5f5160e01c90565b5f60443d10610fe2576040513d600319016004823e8051916001600160401b0383113d602485011117610fed578183018051909390916001600160401b038311610fe5573d84016003190185840160200111610fe55750610fe292910160200190610ef7565b90565b949350505050565b92915050565b919261100960a094602093855283850190610ea2565b5f6040840152608060608401528051918291826080860152018484015e5f828201840152601f01601f1916010190565b9060c09261104d9183526020830190610ea2565b5f604082015260806060820152600d60808201526c2ab735b737bbb71032b93937b960991b60a08201520190565b5f90805f526006602052600260405f200154156113d95761109a611483565b15611394575f8181526006602052604081206002810180549290555460ff16600381101561081c576112875760018060a01b0360045416828452600660205260018060a01b03604085205460081c16838552600660205260018060a01b0360016040872001541691848652600660205260036040872001548587526006602052600460408820015486885260066020526005604089200154908789526006602052600660408a20015492843b15611283579360e4938a9795938897949388946040519b8c998a9863baea8cd360e01b8a5260048a0152602489015260448801526064870152608486015260a485015260c48401525af1918261126a575b505061123c5760016111a7610f61565b6308c379a0146111ed575b6111ba575050565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283611039565b0390a1565b6111f5610f7c565b80611201575b506111b2565b90505f5160206114cf5f395f51905f528391838552600660205260ff6040862054166112336040519283928784610ff3565b0390a15f6111fb565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283610f35565b8161127491610ef7565b61127f57825f611197565b8280fd5b8980fd5b815f52600660205260ff60405f205416600381101561081c5760010361131457600454828452600660205260408420546001600160a01b039182169160089190911c16813b15611310576112f69285928392836040518097819582946319ed4e0b60e21b845260048401610f1a565b03925af1918261126a57505061123c5760016111a7610f61565b8480fd5b6004545f838152600660205260409020546001600160a01b039182169260089190911c90911690823b156107d357611365925f92836040518096819582946376aad9b360e11b845260048401610f1a565b03925af1908161137f575b5061123c5760016111a7610f61565b61138c9193505f90610ef7565b5f915f611370565b60405162461bcd60e51b815260206004820152601d60248201527f7072696365206973206e6f742076616c696420746f20657865637574650000006044820152606490fd5b60405162461bcd60e51b815260206004820152602560248201527f6e6f2073756368206f7065726174696f6e206f7220616c72656164792065786560448201526418dd5d195960da1b6064820152608490fd5b9190820391821161091b57565b3d15611472573d906001600160401b038211610cce5760405191611467601f8201601f191660200184610ef7565b82523d5f602084013e565b606090565b600382101561081c5752565b600254610e10810180911161091b57421090565b4860021b4881046004144815171561091b576210c8e08102908082046210c8e0149015171561091b576065810180911161091b579056fe0392f08a9cc4b58edfbb67203b491ea1c706b0691caadcae5ab0c983455af709a2646970667358221220b81fe165076547a8a10a28ff70cdcc61de41fee8878400f5f819f6f547c0123c64736f6c63430008210033a2646970667358221220b6bffd1ebe98477c92de237be20acac89c11bdff289d6ffaeeff31067f234f6f64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080600436101561000e575f80fd5b5f3560e01c6316537fe914610021575f80fd5b34610103576060366003190112610103576004356001600160a01b03811690819003610103576024356001600160a01b0381169190829003610103576020830191338352604435604085015260408452606084019284841060018060401b038511176100ef57604084905284519020936115d680820193909290606085016001600160401b038111878210176100ef576060946101088839526080840152601f1992030101905ff580156100e4576040516001600160a01b039091168152602090f35b6040513d5f823e3d90fd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe60c03461009957601f6115d638819003918201601f19168301916001600160401b0383118484101761009d578084926040948552833981010312610099578051906001600160a01b038216820361009957602001516001600160a01b03811681036100995760805260a05260405161152490816100b28239608051816109a4015260a0518181816102ec01528181610c000152610e730152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f905f3560e01c908163044b25e814610e6157508063053f14da14610e44578063066530ba14610e265780630d0a761b14610d965780631604f9ea146109745780632a6f710c1461050f5780633611956c146104ea5780633b05cb0a1461047b5780633c4dee16146103fa57806343739382146102c05780635ef99e2c146102a3578063661a6e9d146102855780638e274f2d1461026757806392d9583614610145578063a697afb41461011c578063d3caa14e146100f95763e6602da8146100d9575f80fd5b346100f657806003193601126100f6576020600554604051908152f35b80fd5b50346100f657806003193601126100f6576020610114611497565b604051908152f35b50346100f657806003193601126100f6576004546040516001600160a01b039091168152602090f35b50346100f657806003193601126100f6576040816101009260e0835161016a81610edb565b82815282602082015282858201528260608201528260808201528260a08201528260c082015201526001548152600660205220604051906101aa82610edb565b8054906101ba60ff831684611477565b602083019160018060a01b039060081c16825260018060a01b03600182015416604084019081526002820154606085019081526003830154906080860191825260048401549260a08701938452600660058601549560c0890196875201549560e0880196875261022e604051809951610ea2565b516001600160a01b03908116602089015290511660408701525160608601525160808501525160a08401525160c08301525160e0820152f35b50346100f657806003193601126100f6576020600254604051908152f35b50346100f657806003193601126100f6576020600154604051908152f35b50346100f657806003193601126100f65760209054604051908152f35b50346100f65760a03660031901126100f6576004356024356102e0610eaf565b506102e9610ec5565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036103b95782548203610379577f105ef48e33e056f268bf84d375d020be5e62281274554de0094343712dd08ee791604091848055426002558060035582519182526020820152a160015480610369575080f35b6103729061107b565b8060015580f35b60405162461bcd60e51b81526020600482015260186024820152776e6f74207265706f7274206372656174656420627920757360401b6044820152606490fd5b60405162461bcd60e51b81526020600482015260196024820152781bdb9b1e481bdc195b881bdc9858db194818d85b8818d85b1b603a1b6044820152606490fd5b50346100f65760203660031901126100f6576004356001600160a01b03811690819003610477576004546001600160a01b038116610443576001600160a01b0319161760045580f35b60405162461bcd60e51b815260206004820152600c60248201526b616c7265616479207365742160a01b6044820152606490fd5b5080fd5b50346100f65760203660031901126100f6576004546001600160a01b031633036104a85760043560035580f35b60405162461bcd60e51b815260206004820152601a6024820152791bdb9b1e481cd958dd5c9a5d1e481c1bdbdb0818d85b881cd95d60321b6044820152606490fd5b50346100f657806003193601126100f6576020610505611483565b6040519015158152f35b5060603660031901126107d35760043560038110156107d3576024356001600160a01b038116908190036107d357604435801561092f576005545f19811461091b57600101918260055560018060a01b0360045416916040516328c16ded60e21b815282600482015260a081602481875afa9182156107c8575f915f936108e0575b50604051630a40d29760e21b8152602081600481895afa9081156107c8575f9161089b575b506040516370a0823160e01b8152600481018790529490602090869060249082906001600160a01b03165afa9485156107c8575f95610864575b5060206004966040519788809263021b50ff60e01b82525afa9586156107c8575f96610830575b5061062e604051986106288a610edb565b89611477565b602088019633885260408901918252606089019283526080890193845260a0890194855260c0890195865260e089019687525f52600660205260405f209751600381101561081c5760069760ff8a5491610100600160a81b03905160081b1692169060018060a81b03191617178855600188019060018060a01b0390511660018060a01b031982541617905551600287015551600386015551600485015551600584015551910155805f6106e0611483565b15610756576106fa906106f460055461107b565b3461142c565b806107025750f35b81808092335af1610711611439565b501561071a5780f35b60405162461bcd60e51b81526020600482015260146024820152730ccc2d2d8cac840e8de40e4cae8eae4dc40cae8d60631b6044820152606490fd5b60015415610768575b6106fa906106f4565b5050600554600155610778611497565b8034106107d75780303b156107d3575f60049160405192838092630b027cf560e11b8252305af180156107c8576107b2575b50819061075f565b6106fa92505f6107c191610ef7565b5f916107aa565b6040513d5f823e3d90fd5b5f80fd5b60405162461bcd60e51b815260206004820152601f60248201527f6e6f7420656e6f7567682065746820746f2072657175657374207072696365006044820152606490fd5b634e487b7160e01b5f52602160045260245ffd5b9095506020813d60201161085c575b8161084c60209383610ef7565b810103126107d35751945f610617565b3d915061083f565b9594506020863d602011610893575b8161088060209383610ef7565b810103126107d3579451939460206105f0565b3d9150610873565b90506020813d6020116108d8575b816108b660209383610ef7565b810103126107d35751936001600160a01b03851685036107d3579360206105b6565b3d91506108a9565b9150915060a0813d60a011610913575b816108fd60a09383610ef7565b810103126107d35760208151910151915f610591565b3d91506108f0565b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b815260206004820152601d60248201527f6e65656420746f20646f206e6f6e207a65726f206f7065726174696f6e0000006044820152606490fd5b5f3660031901126107d3575f54610d575761098d611497565b803410610d16576040516318160ddd60e01b8152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316602083600481845afa9283156107c8575f93610ce2575b504860011b4881046002144815171561091b57620186a0810290808204620186a0149015171561091b57604051936102408501906001600160401b03821186831017610cce57620186a0916040526406251cabf886520460208501526040840152606083015260b460808301525f60a08301525f60c083015273c02aaa39b223fe8d0a0e5c4f27ead9083c756cc260e0830152620f4240610100830152612710610120830152608c61014083015260016101608301525f6101808301525f6101a0830152306101c08301526321b9c9c160e11b6101e08301525f61020083015260016102208301526102206040519263f30ef90560e01b845280516004850152602081015160248501526040810151604485015260018060a01b03606082015116606485015265ffffffffffff608082015116608485015262ffffff60a08201511660a485015262ffffff60c08201511660c485015260018060a01b0360e08201511660e485015263ffffffff6101008201511661010485015262ffffff6101208201511661012485015261ffff61014082015116610144850152610160810151151561016485015261018081015115156101848501526101a081015115156101a485015260018060a01b036101c0820151166101c485015263ffffffff60e01b6101e0820151166101e485015260018060a01b036102008201511661020485015201511515610224830152602082610244818460018060a01b037f0000000000000000000000000000000000000000000000000000000000000000165af180156107c8575f90610c9a575b610c3c92505f553461142c565b80610c4357005b5f80808093335af1610c53611439565b5015610c5b57005b60405162461bcd60e51b81526020600482015260176024820152766661696c656420746f20726566756e642065786365737360481b6044820152606490fd5b506020823d602011610cc6575b81610cb460209383610ef7565b810103126107d357610c3c9151610c2f565b3d9150610ca7565b634e487b7160e01b5f52604160045260245ffd5b9092506020813d602011610d0e575b81610cfe60209383610ef7565b810103126107d3575191836109e3565b3d9150610cf1565b60405162461bcd60e51b81526020600482015260196024820152786e6f742062696720656e6f7567682065746820626f756e747960381b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276105b1c9958591e481c195b991a5b99c81c995c5d595cdd604a1b6044820152606490fd5b346107d35760203660031901126107d3576004355f52600660205261010060405f2080549060018060a01b036001820154169060028101546003820154600483015491600660058501549401549460405196610df58860ff8316610ea2565b60081c6001600160a01b0316602088015260408701526060860152608085015260a084015260c083015260e0820152f35b346107d35760203660031901126107d357610e4260043561107b565b005b346107d3575f3660031901126107d3576020600354604051908152f35b346107d3575f3660031901126107d3577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b90600382101561081c5752565b606435906001600160a01b03821682036107d357565b608435906001600160a01b03821682036107d357565b61010081019081106001600160401b03821117610cce57604052565b601f909101601f19168101906001600160401b03821190821017610cce57604052565b6001600160a01b039091168152602081019190915260400190565b9060a092610f499183526020830190610ea2565b60016040820152608060608201525f60808201520190565b5f9060033d11610f6d57565b905060045f803e5f5160e01c90565b5f60443d10610fe2576040513d600319016004823e8051916001600160401b0383113d602485011117610fed578183018051909390916001600160401b038311610fe5573d84016003190185840160200111610fe55750610fe292910160200190610ef7565b90565b949350505050565b92915050565b919261100960a094602093855283850190610ea2565b5f6040840152608060608401528051918291826080860152018484015e5f828201840152601f01601f1916010190565b9060c09261104d9183526020830190610ea2565b5f604082015260806060820152600d60808201526c2ab735b737bbb71032b93937b960991b60a08201520190565b5f90805f526006602052600260405f200154156113d95761109a611483565b15611394575f8181526006602052604081206002810180549290555460ff16600381101561081c576112875760018060a01b0360045416828452600660205260018060a01b03604085205460081c16838552600660205260018060a01b0360016040872001541691848652600660205260036040872001548587526006602052600460408820015486885260066020526005604089200154908789526006602052600660408a20015492843b15611283579360e4938a9795938897949388946040519b8c998a9863baea8cd360e01b8a5260048a0152602489015260448801526064870152608486015260a485015260c48401525af1918261126a575b505061123c5760016111a7610f61565b6308c379a0146111ed575b6111ba575050565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283611039565b0390a1565b6111f5610f7c565b80611201575b506111b2565b90505f5160206114cf5f395f51905f528391838552600660205260ff6040862054166112336040519283928784610ff3565b0390a15f6111fb565b60ff604083835f5160206114cf5f395f51905f5295526006602052205416906111e860405192839283610f35565b8161127491610ef7565b61127f57825f611197565b8280fd5b8980fd5b815f52600660205260ff60405f205416600381101561081c5760010361131457600454828452600660205260408420546001600160a01b039182169160089190911c16813b15611310576112f69285928392836040518097819582946319ed4e0b60e21b845260048401610f1a565b03925af1918261126a57505061123c5760016111a7610f61565b8480fd5b6004545f838152600660205260409020546001600160a01b039182169260089190911c90911690823b156107d357611365925f92836040518096819582946376aad9b360e11b845260048401610f1a565b03925af1908161137f575b5061123c5760016111a7610f61565b61138c9193505f90610ef7565b5f915f611370565b60405162461bcd60e51b815260206004820152601d60248201527f7072696365206973206e6f742076616c696420746f20657865637574650000006044820152606490fd5b60405162461bcd60e51b815260206004820152602560248201527f6e6f2073756368206f7065726174696f6e206f7220616c72656164792065786560448201526418dd5d195960da1b6064820152608490fd5b9190820391821161091b57565b3d15611472573d906001600160401b038211610cce5760405191611467601f8201601f191660200184610ef7565b82523d5f602084013e565b606090565b600382101561081c5752565b600254610e10810180911161091b57421090565b4860021b4881046004144815171561091b576210c8e08102908082046210c8e0149015171561091b576065810180911161091b579056fe0392f08a9cc4b58edfbb67203b491ea1c706b0691caadcae5ab0c983455af709a2646970667358221220b81fe165076547a8a10a28ff70cdcc61de41fee8878400f5f819f6f547c0123c64736f6c63430008210033a2646970667358221220b6bffd1ebe98477c92de237be20acac89c11bdff289d6ffaeeff31067f234f6f64736f6c63430008210033'
		}
	}
}
export declare const peripherals_factories_SecurityPoolFactory_SecurityPoolFactory: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_securityPoolForker'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPoolForker'
				},
				{
					readonly name: '_questionData'
					readonly type: 'address'
					readonly internalType: 'contract ZoltarQuestionData'
				},
				{
					readonly name: '_escalationGameFactory'
					readonly type: 'address'
					readonly internalType: 'contract EscalationGameFactory'
				},
				{
					readonly name: '_openOracle'
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
				{
					readonly name: '_zoltar'
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
				{
					readonly name: '_shareTokenFactory'
					readonly type: 'address'
					readonly internalType: 'contract ShareTokenFactory'
				},
				{
					readonly name: '_uniformPriceDualCapBatchAuctionFactory'
					readonly type: 'address'
					readonly internalType: 'contract UniformPriceDualCapBatchAuctionFactory'
				},
				{
					readonly name: '_priceOracleManagerAndOperatorQueuerFactory'
					readonly type: 'address'
					readonly internalType: 'contract PriceOracleManagerAndOperatorQueuerFactory'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DeploySecurityPool'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
					readonly indexed: false
				},
				{
					readonly name: 'truthAuction'
					readonly type: 'address'
					readonly internalType: 'contract UniformPriceDualCapBatchAuction'
					readonly indexed: false
				},
				{
					readonly name: 'priceOracleManagerAndOperatorQueuer'
					readonly type: 'address'
					readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
					readonly indexed: false
				},
				{
					readonly name: 'shareToken'
					readonly type: 'address'
					readonly internalType: 'contract IShareToken'
					readonly indexed: false
				},
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
					readonly indexed: false
				},
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
					readonly indexed: false
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'securityMultiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'startingRepEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deployChildSecurityPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'shareToken'
					readonly type: 'address'
					readonly internalType: 'contract IShareToken'
				},
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityMultiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'startingRepEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'truthAuction'
					readonly type: 'address'
					readonly internalType: 'contract UniformPriceDualCapBatchAuction'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deployOriginSecurityPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityMultiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'startingRepEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolDeploymentCount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolDeploymentsRange'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'count'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'deployments'
					readonly type: 'tuple[]'
					readonly internalType: 'struct ISecurityPoolFactory.SecurityPoolDeployment[]'
					readonly components: readonly [
						{
							readonly name: 'securityPool'
							readonly type: 'address'
							readonly internalType: 'contract ISecurityPool'
						},
						{
							readonly name: 'truthAuction'
							readonly type: 'address'
							readonly internalType: 'contract UniformPriceDualCapBatchAuction'
						},
						{
							readonly name: 'priceOracleManagerAndOperatorQueuer'
							readonly type: 'address'
							readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
						},
						{
							readonly name: 'shareToken'
							readonly type: 'address'
							readonly internalType: 'contract IShareToken'
						},
						{
							readonly name: 'parent'
							readonly type: 'address'
							readonly internalType: 'contract ISecurityPool'
						},
						{
							readonly name: 'universeId'
							readonly type: 'uint248'
							readonly internalType: 'uint248'
						},
						{
							readonly name: 'questionId'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'securityMultiplier'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'currentRetentionRate'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'startingRepEthPrice'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'completeSetCollateralAmount'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60803461018757601f61598438819003918201601f19168301916001600160401b0383118484101761018b57808492610100946040528339810103126101875780516001600160a01b03811691908290036101875760208101516001600160a01b03811692908390036101875760408201516001600160a01b03811692908390036101875760608101516001600160a01b03811692908390036101875760808201516001600160a01b03811692908390036101875760a08101516001600160a01b038116908190036101875760c08201516001600160a01b03811692908390036101875760e001516001600160a01b03811693908490036101875760018060a01b0319600754161760075560018060a01b03195f5416175f5560018060a01b0319600154161760015560018060a01b0319600254161760025560018060a01b0319600354161760035560018060a01b0319600454161760045560018060a01b0319600554161760055560018060a01b031960065416176006556040516157e490816101a08239f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f905f3560e01c908163128af394146110c45750806328ef101c14610c31578063cdf0bbb4146103945763d5f3fecb1461004a575f80fd5b3461039157604036600319011261039157600435602435906008548082116103505781810390811161033c5782116102fd5791906100878161127e565b9261009560405194856110fa565b818452601f196100a48361127e565b01835b818110610299575050600854835b83811061018f578585604051918291602083016020845282518091526020604085019301915b8181106100e9575050500390f35b825180516001600160a01b0390811686526020828101518216818801526040808401518316908801526060808401518316908801526080808401519092169187019190915260a0808301516001600160f81b03169087015260c0808301519087015260e0808301519087015261010080830151908701526101208083015190870152610140918201519186019190915286955061016090940193909201916001016100db565b808396949596018084116102855782811015610271576008875260405160019291600a90600b025f51602061578f5f395f51905f52016101ce836110de565b805460a086811b8790039182168552828701548216602086015260028301548216604086015260038301548216606086015260048301549091166080850152600582015460f887901b8790031690840152600681015460c0840152600781015460e084015260088101546101008401526009810154610120840152015461014082015261025b8287611295565b526102668186611295565b5001949392946100b5565b634e487b7160e01b87526032600452602487fd5b634e487b7160e01b87526011600452602487fd5b602090604096949596516102ac816110de565b87815287838201528760408201528760608201528760808201528760a08201528760c08201528760e082015287610100820152876101208201528761014082015282828701015201949392946100a7565b60405162461bcd60e51b815260206004820152601760248201527672616e676520656e64206f7574206f6620626f756e647360481b6044820152606490fd5b634e487b7160e01b84526011600452602484fd5b60405162461bcd60e51b815260206004820152601960248201527872616e6765207374617274206f7574206f6620626f756e647360381b6044820152606490fd5b80fd5b50346103915760a0366003190112610391576004356001600160f81b0381168103610c2d5760018060a01b036006541690604051636836951360e01b81526024356004820152602081602481865afa908115610c22578491610bf0575b5015610bb1578260649260405193848092634ab5f8d760e11b82526024356004830152846024830152600360448301525afa918215610ba6578392610a88575b50815115610a74576020820151602081519101209160409260036020855161045987826110fa565b828152016259657360e81b81522003610a32578051600110156109dc57828101516020815191012060026020855161049187826110fa565b82815201614e6f60f01b815220036109f0578051600210156109dc57606001515161098a576003548251630a8ad82560e41b81526001600160f81b038316600482015284939291602090829060249082906001600160a01b03165afa908115610960576105759291602091869161096d575b5084518281018781526001600160f81b03851682880152602435606083015260443560808084019190915282529061053c60a0826110fa565b5190206002546004805488516316537fe960e01b81529788956001600160a01b039485169587958d95879592939290911690850161113c565b03925af191821561096057849261092f575b5060208351818101906044358252602435868201528581526105aa6060826110fa565b5190208554855162bc378960e31b8152600481019290925260248035908301529095869160449183916001600160a01b03165af19384156108c95785946108e7575b5060075460065460055460045460035487516001600160a01b0392831697909591831694909383169290811691166001600160401b036144c58701908111908711176108d357908a95949392916144c56112aa87396144c586019081523060208201528981019190915260608101919091526001600160a01b039182166080820181905291891660a082015260c081019690965260e086018490526101008601919091526001600160f81b0384166101208601526024356101408601526044356101608601526101808501839052938190036101a0019082f580156108c9576001600160a01b031693823b1561088757858451631e26f70b60e11b8152866004820152818160248183895af180156108aa576108b4575b5050843b1561088757858451632ac970c960e01b8152606435600482015260843560248201528160448201528181606481838b5af180156108aa57610895575b50506001600160a01b0381163b15610887578351635b52ebef60e11b8152600481018690528681602481836001600160a01b0387165af1801561088b57610872575b5091602095610160925f51602061576f5f395f51905f529461080e87516107ab816110de565b8981528a81018590528881018690526001600160a01b0383166060820152608081018590526001600160f81b03841660a082015260243560c082015260443560e0820152606435610100820152608435610120820152610140810185905261115e565b8651888152898101849052808801949094526001600160a01b03166060840152608083018290526001600160f81b031660a083015260243560c083015260443560e0830152606435610100830152608435610120830152610140820152a151908152f35b61087d8780926110fa565b610887575f610785565b8580fd5b85513d89823e3d90fd5b8161089f916110fa565b61088757855f610743565b86513d84823e3d90fd5b816108be916110fa565b61088757855f610703565b83513d87823e3d90fd5b634e487b7160e01b8b52604160045260248bfd5b9093506020813d602011610927575b81610903602093836110fa565b8101031261092357516001600160a01b038116810361092357925f6105ec565b8480fd5b3d91506108f6565b61095291925060203d602011610959575b61094a81836110fa565b81019061111d565b905f610587565b503d610940565b50505051903d90823e3d90fd5b6109849150823d84116109595761094a81836110fa565b5f610503565b815162461bcd60e51b815260206004820152602560248201527f5175657374696f6e206d75737420686176652065786163746c792032206f7574604482015264636f6d657360d81b6064820152608490fd5b634e487b7160e01b84526032600452602484fd5b825162461bcd60e51b815260206004820152601b60248201527a29b2b1b7b7321037baba31b7b6b29036bab9ba103132901127379160291b6044820152606490fd5b825162461bcd60e51b815260206004820152601b60248201527a2334b939ba1037baba31b7b6b29036bab9ba10313290112cb2b99160291b6044820152606490fd5b634e487b7160e01b83526032600452602483fd5b9091503d8084833e610a9a81836110fa565b810190602081830312610ba2578051906001600160401b03821161092357019080601f83011215610ba257815191610ad18361127e565b92610adf60405194856110fa565b80845260208085019160051b83010191838311610b9e5760208101915b838310610b0f575050505050905f610431565b82516001600160401b038111610b9a5782019085603f83011215610b9a576020820151906001600160401b038211610b8657604051610b58601f8401601f1916602001826110fa565b8281528a60408585010189106103915760208481969560408397018386015e83010152815201920191610afc565b634e487b7160e01b8a52604160045260248afd5b8880fd5b8680fd5b8380fd5b6040513d85823e3d90fd5b60405162461bcd60e51b8152602060048201526017602482015276145d595cdd1a5bdb88191bd95cc81b9bdd08195e1a5cdd604a1b6044820152606490fd5b90506020813d602011610c1a575b81610c0b602093836110fa565b81010312610ba257515f6103f1565b3d9150610bfe565b6040513d86823e3d90fd5b5080fd5b5034610feb57610100366003190112610feb576004356001600160a01b0381169190829003610feb576024356001600160a01b0381169290839003610feb576044356001600160f81b03811690819003610feb5760075460e4359160c4359160a435916084359160643591906001600160a01b0316330361108557602496604051602081019082825283604082015284606082015285608082015260808152610cdb60a0826110fa565b51902099602060018060a01b03600354166040519a8b8092630a8ad82560e41b82528760048301525afa8015610fe0578b602091610d4f9b5f91611068575b50600254600480546040516316537fe960e01b81529e8f956001600160a01b039485169587955f95879590911690850161113c565b03925af1988915610fe0575f99611047575b506001546007546040516303f72d3b60e01b81526001600160a01b039182166004820152602481019d909d528c918291165a925f604492602095f19a8b15610fe0575f9b611003575b5060018060a01b036007541660018060a01b036006541660018060a01b03600554169160018060a01b03600454169d60018060a01b03600354169060018060a01b03169c604051946144c5948587019487861060018060401b03871117610fef5787966112aa8839855230602086015260408501526060840152600160a01b60019003169e8f60808401528560a084015260c08301528560e08301526101008201528561012082015286610140820152876101608201528b610180820152036101a0015f9182f58015610fe0576001600160a01b0316998b3b15610feb575f808d60248e6040519485938492631e26f70b60e11b845260048401525af18015610fe057610fcd575b508a3b156103915788818960648a8f84906040519687958694632ac970c960e01b86526004860152602485015260448401525af18015610fc257610fad575b50509260409a95925f51602061576f5f395f51905f529895926101609895610f658d8f5190610f1f826110de565b81528d60208201528f8b908201528260608201528360808201528460a08201528560c08201528660e082015287610100820152886101208201528961014082015261115e565b8d51988d8a528c60208b01528e8a01526060890152608088015260a087015260c086015260e0850152610100840152610120830152610140820152a182519182526020820152f35b610fb88280926110fa565b6103915780610ef1565b6040513d84823e3d90fd5b610fd991505f906110fa565b5f5f610eb2565b6040513d5f823e3d90fd5b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b909a506020813d60201161103f575b8161101f602093836110fa565b81010312610feb57516001600160a01b0381168103610feb57995f610daa565b3d9150611012565b61106191995060203d6020116109595761094a81836110fa565b975f610d61565b61107f9150833d85116109595761094a81836110fa565b5f610d1a565b60405162461bcd60e51b815260206004820152601760248201527637b7363c9039b2b1bab934ba3ca837b7b62337b935b2b960491b6044820152606490fd5b34610feb575f366003190112610feb576020906008548152f35b61016081019081106001600160401b03821117610fef57604052565b601f909101601f19168101906001600160401b03821190821017610fef57604052565b90816020910312610feb57516001600160a01b0381168103610feb5790565b6001600160a01b03918216815291166020820152604081019190915260600190565b600854600160401b811015610fef576001810160085560085481101561126a5760085f52600b025f51602061578f5f395f51905f520190805182546001600160a01b03199081166001600160a01b039283161784556020830151600185018054831691841691909117905560408301516002850180548316918416919091179055606083015160038501805483169184169190911790556080830151600485018054909216921691909117905560a08101516005830180546001600160f81b0319166001600160f81b039290921691909117905560c0810151600683015560e08101516007830155610100810151600883015561012081015160098301556101400151600a9190910155565b634e487b7160e01b5f52603260045260245ffd5b6001600160401b038111610fef5760051b60200190565b805182101561126a5760209160051b01019056fe6101c080604052346103e3576101a0816144c58038038091610021828561044f565b8339810103126103e35761003481610486565b60208201519091906001600160a01b038116908190036103e35760408201516001600160a01b03811691908290036103e3576060830151936001600160a01b03851685036103e35760808401516001600160a01b03811681036103e35760a0850151956001600160a01b03871687036103e35760c08601516001600160a01b03811681036103e35760e08701516001600160a01b038116978882036103e357610100810151906001600160a01b03821682036103e357610120810151976001600160f81b03891689036103e3576101408201519061011b6101806101608501519401610486565b9960a05260018060a01b0319600354161760035560805260075560c05260e05261016052610180526101405260018060a01b031660018060a01b031960025416176002556101a05260018060a01b03196001541617600155155f1461043d5760ff19601054166010555b6101005260c05160a051604051630a8ad82560e41b81526001600160f81b03909116600482015290602090829060249082906001600160a01b03165afa9081156103ef575f916103fa575b5061012081905260c05160405163095ea7b360e01b81526001600160a01b0391821660048201525f19602482015291602091839160449183915f91165af180156103ef576103b3575b60405161402a908161049b8239608051818181610cc401528181611b290152613c1d015260a05181818161036d01528181610b130152818161106e015281816116650152818161186b01528181611ddd0152818161209201528181612699015281816126e30152818161306b0152613b9f015260c0518181816103a901528181610b48015281816110b4015281816116a0015281816118a401528181611e25015281816120c70152818161263b01528181612722015281816130a30152613bd4015260e0518181816080015261259301526101005181818161196201528181611e8c0152818161203a0152818161279d0152612c2a0152610120518181816105370152818161085201528181610d2e01528181610f870152818161172401528181611c2e0152818161226701528181612b150152818161353f015281816136080152613991015261014051818181610405015281816110010152818161110b0152818161211d0152612a2401526101605181613273015261018051818181610ab60152610d9601526101a05181818160b20152611fd70152f35b6020813d6020116103e7575b816103cc6020938361044f565b810103126103e35751801515036103e3575f610219565b5f80fd5b3d91506103bf565b6040513d5f823e3d90fd5b90506020813d602011610435575b816104156020938361044f565b810103126103e357516001600160a01b03811681036103e35760206101d0565b3d9150610408565b600260ff196010541617601055610185565b601f909101601f19168101906001600160401b0382119082101761047257604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036103e35756fe60808060405260043610156100e0575b50361561001a575f80fd5b6002546001600160a01b0316331480156100ae575b801561007c575b1561003d57005b60405162461bcd60e51b81526020600482015260176024820152762ab730baba3437b934bd32b21022aa241039b2b73232b960491b6044820152606490fd5b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610036565b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161461002f565b5f905f3560e01c908163021b50ff146132a257508063044b25e81461325e578063094959b4146131f25780630f78dd98146131d5578063126c496214612ca05780631db2079f14612bec578063214e16e714612bce57806327c0a4f314612baf5780632801969714612b91578063287fa97314612b4457806329034a5c14612aff5780632986454714612ae15780632ac970c9146129ed5780633c4e2d04146129ce5780633d11a051146129375780633e50b4c4146126c857806344c094a314612683578063495e54211461266a5780634fffd0371461262557806359ae2fa81461260757806359d3b80a146125e05780635e452ae4146125c257806360f96a8f1461257d5780636640e2851461255457806367b5382c146120695780636c9fa59e1461202457806374d4e491146120065780637b7bab9d14611fc15780638c899c2e14611fa35780639025b5e814611f7a57806394614dbf14611dbc578063991292e314611d92578063999d115014611d69578063a305b7b414611d03578063a77384c114611cd3578063ae0255bc14611b4c578063b06a5c5214611b11578063b460481d1461184b578063b665feae14611644578063b8b1087114611616578063b948083c146115ef578063b98cca3714611589578063baea8cd314611030578063c20e976714610feb578063c37ffb8914610f30578063c4c2b5ea14610f17578063c5afa41414610ae5578063d46eecdf14610aa0578063d721cc7714610a70578063d76c4f9d14610a4e578063d9625212146109c8578063e9bb84c214610933578063ec32c8ca14610815578063ec7a9c1a146107f75763ed55b3660361000f57346107f45760403660031901126107f45761035e613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820152602480359291906020908290817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa80156107e95784906107b5575b6103eb915015613747565b61040360ff601054166103fd81613336565b1561338e565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061043933831461387d565b604051630d84655b60e21b8152602081600481865afa80156107aa5761046691869161077b575b506138b6565b61046f81613e5c565b60018060a01b038116808552600d60205260016040862001549261049e84610499876004546134c6565b6134a5565b600455818652600d602052846001604088200155818652600d6020526104c76040872054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f65760405163029f8a6d60e11b8152602081600481865afa80156106eb578890610747575b6105169150876134d3565b10156106af576040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161070a575b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657600460208154936040519283809263029f8a6d60e11b82525afa80156106eb5788906106b3575b6105c39150836134d3565b10156106af5760055411610656577f0cc729a57ccae35254cf96efe31c880c3b3a9f276261d86107b55263bd084b56938161062f928752600d602052670de0b6b3a764000060016040892001541080159061063d575b6106239150613930565b60405193849384613912565b0390a161063a6137b2565b80f35b508652600d602052610623600160408820015415610619565b60405162461bcd60e51b815260206004820152602b60248201527f6d696e74656420746f6f206d616e7920636f6d706c657465207365747320746f60448201526a20616c6c6f77207468697360a81b6064820152608490fd5b8580fd5b506020813d6020116106e3575b816106cd602093836132d2565b810103126106df576105c390516105b8565b5f80fd5b3d91506106c0565b6040513d8a823e3d90fd5b634e487b7160e01b87526011600452602487fd5b90506020813d602011610734575b81610725602093836132d2565b810103126106df57515f61056f565b3d9150610718565b6040513d89823e3d90fd5b506020813d602011610773575b81610761602093836132d2565b810103126106df57610516905161050b565b3d9150610754565b61079d915060203d6020116107a3575b61079581836132d2565b8101906133ee565b5f610460565b503d61078b565b6040513d87823e3d90fd5b506020813d6020116107e1575b816107cf602093836132d2565b810103126106df576103eb90516103e0565b3d91506107c2565b6040513d86823e3d90fd5b80fd5b50346107f457806003193601126107f4576020600954604051908152f35b50346107f457806003193601126107f45761083b60018060a01b03600254163314613354565b6040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f0575b506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b03925af180156108e5576108c9575080f35b6108e19060203d6020116107a35761079581836132d2565b5080f35b6040513d84823e3d90fd5b9250506020823d602011610920575b8161090c602093836132d2565b810103126106df5790518291906020610892565b3d91506108ff565b6040513d85823e3d90fd5b50346107f45760403660031901126107f457806004356001600160a01b038116908190036109c5578180809261097460018060a01b03600254163314613354565b602435905af16109826136ab565b501561098b5780f35b60405162461bcd60e51b81526020600482015260126024820152710ccc2d2d8cac840e8de40e6cadcc8408aa8960731b6044820152606490fd5b50fd5b50346107f45760803660031901126107f4576109e2613320565b6109f760018060a01b03600254163314613354565b6001600160a01b03811690610a1690610a11831515613f29565b613f65565b808252600d6020526024356040832055808252600d60205260443560016040842001558152600d602052606435600360408320015580f35b50346107f45760203660031901126107f45761063a610a6b613320565b613e5c565b50346107f45760203660031901126107f457610a9760018060a01b03600254163314613354565b60043560065580f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f4578060043560048110156109c5576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610edf575b50610b8b9015613747565b610b9d60ff601054166103fd81613336565b81546001600160a01b031615610cb2575b815460405163e2247da960e01b8152336004820152926020928492606492849290916001600160a01b031690610be381613336565b602484015260243560448401525af19081156108e5578291610c80575b50338252600d602052610c1b600460408420019182546134c6565b9055338152600d602052610c326040822054613976565b338252600d602052600460408320015411610c4a5780f35b60405162461bcd60e51b815260206004820152600e60248201526d04e6f7420656e6f756768205245560941b6044820152606490fd5b90506020813d602011610caa575b81610c9b602093836132d2565b810103126106df57515f610c00565b3d9150610c8e565b600154604051630258f95360e31b81527f00000000000000000000000000000000000000000000000000000000000000006004820152919250602090829060249082906001600160a01b03165afa908115610928578391610ead575b50421115610e6f57604051630238d35960e41b81528291906020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610e38575b506040516382579fc360e01b8152670de0b6b3a764000060048201526028909104602482015290602082604481867f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015610928578390610def575b83546001600160a01b0319166001600160a01b03919091161783559050610bae565b50906020813d602011610e30575b81610e0a602093836132d2565b81010312610e2c5751906001600160a01b0382168203610e2c57602091610dcd565b5050fd5b3d9150610dfd565b9250506020823d602011610e67575b81610e54602093836132d2565b810103126106df57602883925190610d66565b3d9150610e47565b60405162461bcd60e51b81526020600482015260166024820152751c5d595cdd1a5bdb881a185cc81b9bdd08195b99195960521b6044820152606490fd5b90506020813d602011610ed7575b81610ec8602093836132d2565b810103126106df57515f610d0e565b3d9150610ebb565b9250506020823d602011610f0f575b81610efb602093836132d2565b810103126106df57610b8b83925190610b80565b3d9150610eee565b50346107f457806003193601126107f45761063a613b88565b50346107f457806003193601126107f457610f5660018060a01b03600254163314613354565b600160ff196010541617601055610f6b613b88565b600c8190556040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f057506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760e03660031901126107f45761104a613320565b602435826001600160a01b038216808303611585576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526084359360c435916044359190606435906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161154d575b506110f79015613747565b61110960ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169361113f33861461387d565b604051630d84655b60e21b8152602081600481895afa9384156106eb5761117460209561117d9360049b9161153657506138b6565b610a6b8b613f65565b61118689613e5c565b806115205750670de0b6b3a76400009004925b60405163029f8a6d60e11b815295869182905afa93841561073c5787946114ec575b50600754926111d3856111ce86896134d3565b6134d3565b670de0b6b3a7640000840290848204670de0b6b3a764000014851517156114565711156114a857858211156114a15785925b831561146a5788956111ce6112268961122161125195896134d3565b6134e6565b966111ce87600160406112388c6135da565b9e828060a01b03169c8d8152600d6020522001546134c6565b858952600d60205261126f61126a8960408c20546134c6565b613976565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156114565711611411577f966090b9fc0bdd1d04cc16943b6c5be54254c04ae7aa5ba115bee12f8bce678b966112c48460a0986134a5565b828a52600d602052600160408b200155818952600d602052604089206112eb8282546134a5565b9055858952600d602052600160408a20016113078582546134c6565b9055858952600d60205261132060408a209182546134c6565b9055808852600d602052678ac7230489e8000061134060408a2054613976565b108015906113fd575b61135290613af0565b808852600d602052670de0b6b3a7640000600160408a200154108015906113e6575b61137d90613af0565b848852600d6020526113a5678ac7230489e8000061139e60408b2054613976565b1015613b3c565b848852600d6020526113c8670de0b6b3a7640000600160408b2001541015613b3c565b6040519485526020850152604084015260608301526080820152a180f35b50808852600d602052604088206001015415611374565b50808852600d602052604088205415611349565b60405162461bcd60e51b815260206004820152601d60248201527f4e657720706f6f6c20776f756c64206265206c697175696461626c65210000006044820152606490fd5b634e487b7160e01b8a52601160045260248afd5b60405162461bcd60e51b815260206004820152600f60248201526e6e6f206465627420746f206d6f766560881b6044820152606490fd5b8192611205565b60405162461bcd60e51b815260206004820152601c60248201527b7661756c74206e6565647320746f206265206c697175696461626c6560201b6044820152606490fd5b9093506020813d602011611518575b81611508602093836132d2565b810103126106df5751925f6111bb565b3d91506114fb565b6112216115309260a435906134d3565b92611199565b61079d9150873d89116107a35761079581836132d2565b9650506020863d60201161157d575b81611569602093836132d2565b810103126106df576110f7899651906110ec565b3d915061155c565b5080fd5b50346107f4576115a161159b366132bc565b90613a2c565b90604051918291602083016020845282518091526020604085019301915b8181106115cd575050500390f35b82516001600160a01b03168452859450602093840193909201916001016115bf565b50346107f45760203660031901126107f457602061160e600435613976565b604051908152f35b50346107f45760203660031901126107f457602061160e61163b6005546004356134d3565b600854906134e6565b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048281019190915235906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390611817575b6116e2915015613747565b6116f460ff601054166103fd81613336565b6116fd816135da565b6040516323b872dd60e01b815291906020838061171f853033600485016138f0565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19081156107e9577f266a200266d5d786f67674869101a74359975afe2100e4ebdb9e3621de2eb67c936117ab926117fa575b5061178a33613f65565b338552600d602052604085206117a18282546134c6565b90556006546134c6565b600655338352600d6020526117d6678ac7230489e800006117cf6040862054613976565b1015613930565b338352600d6020526040832054906117f46040519283923384613912565b0390a180f35b6118129060203d6020116107a35761079581836132d2565b611780565b506020813d602011611843575b81611831602093836132d2565b810103126106df576116e290516116d7565b3d9150611824565b50346107f457806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820181905282916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391611ad8575b50906118ea60249215613747565b6118fc60ff601054166103fd81613336565b60025460405163352dfc9760e11b81523060048201529260209184919082906001600160a01b03165afa918215610928578392611aa7575b5061193e82613336565b61194b6003831415613406565b604051630366d19d60e61b815260048101919091527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169161199481613336565b6024820152602081604481855afa908115610928578391611a6f575b506020916119d691604051948580948193631bc7955960e11b835233906004840161348c565b03925af180156108e5578290611a30575b5f516020613fd55f395f51905f529150611a0661163b600554836134d3565b90611a208480808086335af1611a1a6136ab565b506136e9565b6117f46040519283923384613912565b506020813d602011611a67575b81611a4a602093836132d2565b810103126106df575f516020613fd55f395f51905f5290516119e7565b3d9150611a3d565b9250506020823d602011611a9f575b81611a8b602093836132d2565b810103126106df57905182919060206119b0565b3d9150611a7e565b611aca91925060203d602011611ad1575b611ac281836132d2565b8101906133d6565b905f611934565b503d611ab8565b919250506020813d602011611b09575b81611af5602093836132d2565b810103126106df57518291906118ea6118dc565b3d9150611ae8565b50346107f457806003193601126107f45760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346107f45760203660031901126107f457611b66613320565b60025460405163352dfc9760e11b815230600482015290602090829060249082906001600160a01b03165afa90811561092857611bb8916003918591611cb4575b50611bb181613336565b1415613406565b611bc181613e5c565b6001600160a01b038116808352600d6020526040832054611bfb90611be590613976565b828552600d6020526004604086200154906134a5565b908352600d6020528260408120556040519163a9059cbb60e01b835260208380611c2985856004840161372c565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19283156107e9577f86a75ce05d96dd9f84d84175307eda113c08d1a36a7f47448229d90c1df7abdf93611c97575b506117f460405192839233846138f0565b611caf9060203d6020116107a35761079581836132d2565b611c86565b611ccd915060203d602011611ad157611ac281836132d2565b5f611ba7565b50346107f45760203660031901126107f457611cfa60018060a01b03600254163314613354565b60043560085580f35b50346107f45760203660031901126107f45760a0906040906001600160a01b03611d2b613320565b168152600d60205220805490600181015490600281015460046003830154920154926040519485526020850152604084015260608301526080820152f35b50346107f457806003193601126107f4576001546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f457602060ff6010541660405190611db881613336565b8152f35b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004808401919091529091839135906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa908115610928578391611f42575b50611e609015613747565b611e7260ff601054166103fd81613336565b611e7a613b88565b611e8961163b600554836134d3565b927f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15611f3e57828491611ee19383604051809681958294634a38db3160e11b8452339060048501613787565b03925af1801561092857611f29575b50818061063a94611f0482946008546134a5565b600855611f13816005546134a5565b600555611f1e6137b2565b335af1611a1a6136ab565b611f348380926132d2565b611585575f611ef0565b8380fd5b9250506020823d602011611f72575b81611f5e602093836132d2565b810103126106df57611e6084925190611e55565b3d9150611f51565b50346107f457806003193601126107f4576002546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600854604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600e54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f457612083613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390612520575b612109915015613747565b61211b60ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061215133831461387d565b604051630d84655b60e21b8152602081600481865afa80156107e95761217d91859161077b57506138b6565b6121886024356135da565b9061219a612194613504565b836134c6565b6001600160a01b038216808652600d6020526040862054909391111561251a5750818452600d6020526040842054915b6121d383613976565b92818652600d6020526121ed846104996040892054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657828752600d60205260016040882001546040519063029f8a6d60e11b82526020826004818b5afa90811561243e5789916124e4575b61224d92506134d3565b11612493576040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031695906020816024818a5afa80156106eb578690899061245d575b6122b392506134a5565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156124495760049060208254916040519384809263029f8a6d60e11b82525afa90811561243e578991612408575b61230892506134d3565b116123b557612331918652600d602052604086206123278282546134a5565b90556006546134a5565b6006556020604051809463a9059cbb60e01b825281878161235688886004840161372c565b03925af19283156107e9577fbbfe2b12a823e4f2b0b4b77b68e919461565bade7d192fd09011cd7f2721d5c893612398575b506117f46040519283928361372c565b6123b09060203d6020116107a35761079581836132d2565b612388565b60405162461bcd60e51b815260206004820152602560248201527f476c6f62616c20536563757269747920426f6e6420416c6c6f77616e636520626044820152643937b5b2b760d91b6064820152608490fd5b90506020823d602011612436575b81612423602093836132d2565b810103126106df576123089151906122fe565b3d9150612416565b6040513d8b823e3d90fd5b634e487b7160e01b88526011600452602488fd5b50506020813d60201161248b575b81612478602093836132d2565b810103126106df57856122b391516122a9565b3d915061246b565b60405162461bcd60e51b8152602060048201526024808201527f4c6f63616c20536563757269747920426f6e6420416c6c6f77616e636520627260448201526337b5b2b760e11b6064820152608490fd5b90506020823d602011612512575b816124ff602093836132d2565b810103126106df5761224d915190612243565b3d91506124f2565b916121ca565b506020813d60201161254c575b8161253a602093836132d2565b810103126106df5761210990516120fe565b3d915061252d565b50346107f457806003193601126107f4576003546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600554604051908152f35b50346107f457806003193601126107f457546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600454604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f45761063a6137b2565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03168152602090f35b50806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004830152906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa8015610928578390612903575b61275c915015613747565b61276e60ff601054166103fd81613336565b34156128cb5761277c613b88565b60045461278b600554346134c6565b1161287a578161279a3461366e565b917f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15612876578383916127f2938360405180968195829463d24cd71360e01b8452339060048501613787565b03925af180156108e557612861575b507fc4f182d89ad6e504359313de2a844d67bfc57e590dd6be312525703ed336225c606083612832816008546134c6565b9081600855612843346005546134c6565b908160055560405192835260208301526040820152a161063a6137b2565b8161286b916132d2565b61158557815f612801565b8280fd5b60405162461bcd60e51b8152602060048201526024808201527f6e6f20636170616369747920746f206372656174652074686174206d616e79206044820152637365747360e01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601060248201526f0dccacac840e8de40e6cadcc840cae8d60831b6044820152606490fd5b506020813d60201161292f575b8161291d602093836132d2565b810103126106df5761275c9051612751565b3d9150612910565b50346107f45760203660031901126107f4577f88df2253f70738a84fea9b6fb6a5eaaf426532c74425b93265d5fde54075af0a612972613320565b60018060a01b03811690818452600d6020526129bf8480808060026040822001548781988352600d6020528260026040822001556129b2826009546134a5565b6009555af1611a1a6136ab565b6117f46040519283928361372c565b50346107f45760203660031901126107f457602061160e60043561366e565b50346107f45760603660031901126107f4576003546001600160a01b03163303612a905742600a55600435600c55604435600555807f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b156109c557818091602460405180948193631d82e58560e11b8352833560048401525af180156108e557612a7f5750f35b81612a89916132d2565b6107f45780f35b60405162461bcd60e51b8152602060048201526024808201527f6f6e6c792063616c6c61626c65206279207365637572697479506f6f6c466163604482015263746f727960e01b6064820152608490fd5b50346107f457806003193601126107f4576020600b54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760203660031901126107f457600435600481101561158557612b7760018060a01b03600254163314613354565b612b8081613336565b60ff80196010541691161760105580f35b50346107f457806003193601126107f4576020600754604051908152f35b50346107f45760203660031901126107f457602061160e6004356135da565b50346107f457806003193601126107f4576020600c54604051908152f35b50346106df5760203660031901126106df576004356001600160a01b038116908190036106df57612c2860018060a01b03600254163314613354565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690813b156106df575f91602483926040519485938492635b52ebef60e11b845260048401525af18015612c9557612c87575080f35b612c9391505f906132d2565b005b6040513d5f823e3d90fd5b346106df5760403660031901126106df5760043560048110156106df57602435906001600160401b0382116106df57366023830112156106df57816004013591612ce983613309565b92612cf760405194856132d2565b8084526024602085019160051b830101913683116106df57602401905b8282106131c55750505f546001600160a01b0316919050811561317457612d4360ff601054166103fd81613336565b612d4c81613336565b600381146131375760025460405163352dfc9760e11b81523060048201529190602090839060249082906001600160a01b03165afa918215612c95575f92613116575b50612d9982613336565b6003821480938161305c575b8461300a575b50612db583613336565b801590613003575b612dc690613406565b5f5b8451811015612c93578315612f15575f80549091906040906001600160a01b03166064612df5848a613450565b5183519586938492633bdc2c0560e01b84526004840152612e1589613336565b8860248401523360448401525af18015612c95575f5f91612ed4575b6001935081905b848060a01b031691825f52600d602052600460405f2001612e5a8282546134a5565b905580821115612e9657612e7190612e76926134a5565b6135da565b905f52600d602052612e8d60405f209182546134c6565b90555b01612dc8565b808210612ea6575b505050612e90565b612eb391612e71916134a5565b905f52600d602052612eca60405f209182546134a5565b9055868080612e9e565b50506040823d8211612f0d575b81612eee604093836132d2565b810103126106df57816020612f04600194613478565b91015190612e31565b3d9150612ee1565b612f1e83613336565b612f2782613336565b828203612fce575f906060612f6860018060a01b03845416612f49848a613450565b51604051958680948193637dc5bcc960e11b835233906004840161348c565b03925af18015612c95575f5f915f90612f87575b600194509190612e38565b5050506060823d8211612fc6575b81612fa2606093836132d2565b810103126106df5781612fb6600193613478565b6020820151604090920151612f7c565b3d9150612f95565b60405162461bcd60e51b815260206004820152600d60248201526c57726f6e67206f7574636f6d6560981b6044820152606490fd5b5082612dbd565b60405163f7b2a8e360e01b8152919450602090829060049082905afa908115612c95575f9161303d575b50159285612dab565b613056915060203d6020116107a35761079581836132d2565b85613034565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201529094506020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916130e4575b50151593612da5565b90506020813d60201161310e575b816130ff602093836132d2565b810103126106df5751866130db565b3d91506130f2565b61313091925060203d602011611ad157611ac281836132d2565b9084612d8f565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526024808201527f657363616c6174696f6e2067616d65206e6565647320746f206265206465706c6044820152631bde595960e21b6064820152608490fd5b8135815260209182019101612d14565b346106df575f3660031901126106df576020600a54604051908152f35b346106df57613200366132bc565b9061321660018060a01b03600254163314613354565b80821061322557600555600455005b60405162461bcd60e51b8152602060048201526011602482015270189bdb99081a5b9cdd59999a58da595b9d607a1b6044820152606490fd5b346106df575f3660031901126106df576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346106df575f3660031901126106df576020906006548152f35b60409060031901126106df576004359060243590565b601f909101601f19168101906001600160401b038211908210176132f557604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116132f55760051b60200190565b600435906001600160a01b03821682036106df57565b6004111561334057565b634e487b7160e01b5f52602160045260245ffd5b1561335b57565b60405162461bcd60e51b815260206004820152600b60248201526a27b7363c902337b935b2b960a91b6044820152606490fd5b1561339557565b60405162461bcd60e51b815260206004820152601960248201527814de5cdd195b481a5cc81b9bdd081bdc195c985d1a5bdb985b603a1b6044820152606490fd5b908160209103126106df575160048110156106df5790565b908160209103126106df575180151581036106df5790565b1561340d57565b60405162461bcd60e51b815260206004820152601b60248201527a5175657374696f6e20686173206e6f742066696e616c697a65642160281b6044820152606490fd5b80518210156134645760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b51906001600160a01b03821682036106df57565b9081526001600160a01b03909116602082015260400190565b919082039182116134b257565b634e487b7160e01b5f52601160045260245ffd5b919082018092116134b257565b818102929181159184041417156134b257565b81156134f0570490565b634e487b7160e01b5f52601260045260245ffd5b6006545f81156135c557678ac7230489e8000082810292908304036134b2576040516370a0823160e01b8152306004820152916020836024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9182156135b95791613583575b61358092506134e6565b90565b90506020823d6020116135b1575b8161359e602093836132d2565b810103126106df57613580915190613576565b3d9150613591565b604051903d90823e3d90fd5b506a3c2f7086aed236c807a1b560251b919050565b6006548015613649576135ec916134d3565b6040516370a0823160e01b8152306004820152906020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916135835761358092506134e6565b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b6005548061369b5750670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b61122161358092600854906134d3565b3d156136e4573d906001600160401b0382116132f557604051916136d9601f8201601f1916602001846132d2565b82523d5f602084013e565b606090565b156136f057565b60405162461bcd60e51b81526020600482015260146024820152733330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b1561374e57565b60405162461bcd60e51b8152602060048201526011602482015270169bdb1d185c881a185cc8199bdc9ad959607a1b6044820152606490fd5b6001600160f81b0390911681526001600160a01b039091166020820152604081019190915260600190565b600454801561387a5760ff601054166137ca81613336565b61387a57600554906040519163420671d160e11b83526004830152602482015260208160448173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613847575b506020817f685712dbe95545a3f62ba5b3e15f5eca83a0d979dfba0c33ee395b45f1b8816a92600c55604051908152a1565b90506020813d602011613872575b81613862602093836132d2565b810103126106df57516020613815565b3d9150613855565b50565b1561388457565b60405162461bcd60e51b815260206004820152600a6024820152694f6e6c794f7261636c6560b01b6044820152606490fd5b156138bd57565b60405162461bcd60e51b815260206004820152600b60248201526a5374616c6520707269636560a81b6044820152606490fd5b6001600160a01b03918216815291166020820152604081019190915260600190565b604091949392606082019560018060a01b0316825260208201520152565b1561393757565b60405162461bcd60e51b81526020600482015260176024820152761b5a5b8819195c1bdcda5d081c995c5d5a5c995b595b9d604a1b6044820152606490fd5b6040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916139e0575b506139d790613580926134d3565b600654906134e6565b90506020813d602011613a0c575b816139fb602093836132d2565b810103126106df57516135806139c9565b3d91506139ee565b600e5481101561346457600e5f5260205f2001905f90565b9190600e54808410801590613ae8575b613acc5783613a4a916134a5565b80821015613ac557505b613a5d81613309565b613a6a60405191826132d2565b818152601f19613a7983613309565b0136602083013780935f5b838110613a915750505050565b80613aa6613aa1600193856134c6565b613a14565b838060a01b0391549060031b1c16613abe8286613450565b5201613a84565b9050613a54565b50509050604051613ade6020826132d2565b5f81525f36813790565b508115613a3c565b15613af757565b60405162461bcd60e51b815260206004820152601e60248201527f746172676574206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b15613b4357565b60405162461bcd60e51b815260206004820152601e60248201527f63616c6c6572206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b60045415613e5a576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015612c95575f90613e27575b600154604051630258f95360e31b81527f000000000000000000000000000000000000000000000000000000000000000060048201529250602090839060249082906001600160a01b03165afa918215612c95575f92613df3575b5080613dec57505b8042115f14613de657805b600a54818111613de157613c8c916134a5565b8015613ddd5760055490600c5490604051916367b870af60e01b835260048301526024820152670de0b6b3a7640000604482015260208160648173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613da3575b50613cff90670de0b6b3a7640000926134d3565b04613d0c816005546134a5565b90613d19826009546134c6565b9081600955670de0b6b3a7640000830292808404670de0b6b3a764000014901517156134b2577f6ff9a830210578ad4c7a059cea7ddaa46b3f205a71080d031c16d4070eeb82f093613d7b613d73604095600454906134e6565b600b546134c6565b600b55816005554281105f14613d9c575b600a5582519182526020820152a1565b5042613d8c565b90506020813d602011613dd5575b81613dbe602093836132d2565b810103126106df5751670de0b6b3a7640000613ceb565b3d9150613db1565b5050565b505050565b42613c79565b9050613c6e565b9091506020813d602011613e1f575b81613e0f602093836132d2565b810103126106df5751905f613c66565b3d9150613e02565b506020813d602011613e52575b81613e41602093836132d2565b810103126106df5760249051613c0b565b3d9150613e34565b565b7fa9b6a8e9daf01958ea6a93a4f548ee24e1cf49edc6eda0c8b4bd62b25af32f6f90613e86613b88565b6001600160a01b0381165f818152600d602052604090206001810154600b54600390920154929392670de0b6b3a764000091613ecc91613ec690856134a5565b906134d3565b0490835f52600d602052600360405f200155825f52600d602052613ef8600260405f20019182546134c6565b90555f918252600d60205260409182902060038101546002909101549251928392613f24929084613912565b0390a1565b15613f3057565b60405162461bcd60e51b815260206004820152600d60248201526c1a5b9d985b1a59081d985d5b1d609a1b6044820152606490fd5b6001600160a01b0316613f79811515613f29565b805f52600f60205260405f205461387a57600e54600160401b8110156132f557806001613fa99201600e55613a14565b81549060031b9083821b9160018060a01b03901b1916179055600e54905f52600f60205260405f205556feef7fb21fed1701a6c82b78d78bad1ddab67e41025c2d5078a1be2a3a238b4e62a2646970667358221220900f3b24dc65776ec870bcdd15a729e4f1117d4882abecb33bf72208912fd0fd64736f6c634300082100339764ef375b80b2e64d609b0bf0737252ffaa127605d510d5e0742fcf0641bb8cf3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee3a26469706673582212206a2d3dd5ef1cca633113a555ae4f631ae0277d254117fc5752846049609337b464736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f905f3560e01c908163128af394146110c45750806328ef101c14610c31578063cdf0bbb4146103945763d5f3fecb1461004a575f80fd5b3461039157604036600319011261039157600435602435906008548082116103505781810390811161033c5782116102fd5791906100878161127e565b9261009560405194856110fa565b818452601f196100a48361127e565b01835b818110610299575050600854835b83811061018f578585604051918291602083016020845282518091526020604085019301915b8181106100e9575050500390f35b825180516001600160a01b0390811686526020828101518216818801526040808401518316908801526060808401518316908801526080808401519092169187019190915260a0808301516001600160f81b03169087015260c0808301519087015260e0808301519087015261010080830151908701526101208083015190870152610140918201519186019190915286955061016090940193909201916001016100db565b808396949596018084116102855782811015610271576008875260405160019291600a90600b025f51602061578f5f395f51905f52016101ce836110de565b805460a086811b8790039182168552828701548216602086015260028301548216604086015260038301548216606086015260048301549091166080850152600582015460f887901b8790031690840152600681015460c0840152600781015460e084015260088101546101008401526009810154610120840152015461014082015261025b8287611295565b526102668186611295565b5001949392946100b5565b634e487b7160e01b87526032600452602487fd5b634e487b7160e01b87526011600452602487fd5b602090604096949596516102ac816110de565b87815287838201528760408201528760608201528760808201528760a08201528760c08201528760e082015287610100820152876101208201528761014082015282828701015201949392946100a7565b60405162461bcd60e51b815260206004820152601760248201527672616e676520656e64206f7574206f6620626f756e647360481b6044820152606490fd5b634e487b7160e01b84526011600452602484fd5b60405162461bcd60e51b815260206004820152601960248201527872616e6765207374617274206f7574206f6620626f756e647360381b6044820152606490fd5b80fd5b50346103915760a0366003190112610391576004356001600160f81b0381168103610c2d5760018060a01b036006541690604051636836951360e01b81526024356004820152602081602481865afa908115610c22578491610bf0575b5015610bb1578260649260405193848092634ab5f8d760e11b82526024356004830152846024830152600360448301525afa918215610ba6578392610a88575b50815115610a74576020820151602081519101209160409260036020855161045987826110fa565b828152016259657360e81b81522003610a32578051600110156109dc57828101516020815191012060026020855161049187826110fa565b82815201614e6f60f01b815220036109f0578051600210156109dc57606001515161098a576003548251630a8ad82560e41b81526001600160f81b038316600482015284939291602090829060249082906001600160a01b03165afa908115610960576105759291602091869161096d575b5084518281018781526001600160f81b03851682880152602435606083015260443560808084019190915282529061053c60a0826110fa565b5190206002546004805488516316537fe960e01b81529788956001600160a01b039485169587958d95879592939290911690850161113c565b03925af191821561096057849261092f575b5060208351818101906044358252602435868201528581526105aa6060826110fa565b5190208554855162bc378960e31b8152600481019290925260248035908301529095869160449183916001600160a01b03165af19384156108c95785946108e7575b5060075460065460055460045460035487516001600160a01b0392831697909591831694909383169290811691166001600160401b036144c58701908111908711176108d357908a95949392916144c56112aa87396144c586019081523060208201528981019190915260608101919091526001600160a01b039182166080820181905291891660a082015260c081019690965260e086018490526101008601919091526001600160f81b0384166101208601526024356101408601526044356101608601526101808501839052938190036101a0019082f580156108c9576001600160a01b031693823b1561088757858451631e26f70b60e11b8152866004820152818160248183895af180156108aa576108b4575b5050843b1561088757858451632ac970c960e01b8152606435600482015260843560248201528160448201528181606481838b5af180156108aa57610895575b50506001600160a01b0381163b15610887578351635b52ebef60e11b8152600481018690528681602481836001600160a01b0387165af1801561088b57610872575b5091602095610160925f51602061576f5f395f51905f529461080e87516107ab816110de565b8981528a81018590528881018690526001600160a01b0383166060820152608081018590526001600160f81b03841660a082015260243560c082015260443560e0820152606435610100820152608435610120820152610140810185905261115e565b8651888152898101849052808801949094526001600160a01b03166060840152608083018290526001600160f81b031660a083015260243560c083015260443560e0830152606435610100830152608435610120830152610140820152a151908152f35b61087d8780926110fa565b610887575f610785565b8580fd5b85513d89823e3d90fd5b8161089f916110fa565b61088757855f610743565b86513d84823e3d90fd5b816108be916110fa565b61088757855f610703565b83513d87823e3d90fd5b634e487b7160e01b8b52604160045260248bfd5b9093506020813d602011610927575b81610903602093836110fa565b8101031261092357516001600160a01b038116810361092357925f6105ec565b8480fd5b3d91506108f6565b61095291925060203d602011610959575b61094a81836110fa565b81019061111d565b905f610587565b503d610940565b50505051903d90823e3d90fd5b6109849150823d84116109595761094a81836110fa565b5f610503565b815162461bcd60e51b815260206004820152602560248201527f5175657374696f6e206d75737420686176652065786163746c792032206f7574604482015264636f6d657360d81b6064820152608490fd5b634e487b7160e01b84526032600452602484fd5b825162461bcd60e51b815260206004820152601b60248201527a29b2b1b7b7321037baba31b7b6b29036bab9ba103132901127379160291b6044820152606490fd5b825162461bcd60e51b815260206004820152601b60248201527a2334b939ba1037baba31b7b6b29036bab9ba10313290112cb2b99160291b6044820152606490fd5b634e487b7160e01b83526032600452602483fd5b9091503d8084833e610a9a81836110fa565b810190602081830312610ba2578051906001600160401b03821161092357019080601f83011215610ba257815191610ad18361127e565b92610adf60405194856110fa565b80845260208085019160051b83010191838311610b9e5760208101915b838310610b0f575050505050905f610431565b82516001600160401b038111610b9a5782019085603f83011215610b9a576020820151906001600160401b038211610b8657604051610b58601f8401601f1916602001826110fa565b8281528a60408585010189106103915760208481969560408397018386015e83010152815201920191610afc565b634e487b7160e01b8a52604160045260248afd5b8880fd5b8680fd5b8380fd5b6040513d85823e3d90fd5b60405162461bcd60e51b8152602060048201526017602482015276145d595cdd1a5bdb88191bd95cc81b9bdd08195e1a5cdd604a1b6044820152606490fd5b90506020813d602011610c1a575b81610c0b602093836110fa565b81010312610ba257515f6103f1565b3d9150610bfe565b6040513d86823e3d90fd5b5080fd5b5034610feb57610100366003190112610feb576004356001600160a01b0381169190829003610feb576024356001600160a01b0381169290839003610feb576044356001600160f81b03811690819003610feb5760075460e4359160c4359160a435916084359160643591906001600160a01b0316330361108557602496604051602081019082825283604082015284606082015285608082015260808152610cdb60a0826110fa565b51902099602060018060a01b03600354166040519a8b8092630a8ad82560e41b82528760048301525afa8015610fe0578b602091610d4f9b5f91611068575b50600254600480546040516316537fe960e01b81529e8f956001600160a01b039485169587955f95879590911690850161113c565b03925af1988915610fe0575f99611047575b506001546007546040516303f72d3b60e01b81526001600160a01b039182166004820152602481019d909d528c918291165a925f604492602095f19a8b15610fe0575f9b611003575b5060018060a01b036007541660018060a01b036006541660018060a01b03600554169160018060a01b03600454169d60018060a01b03600354169060018060a01b03169c604051946144c5948587019487861060018060401b03871117610fef5787966112aa8839855230602086015260408501526060840152600160a01b60019003169e8f60808401528560a084015260c08301528560e08301526101008201528561012082015286610140820152876101608201528b610180820152036101a0015f9182f58015610fe0576001600160a01b0316998b3b15610feb575f808d60248e6040519485938492631e26f70b60e11b845260048401525af18015610fe057610fcd575b508a3b156103915788818960648a8f84906040519687958694632ac970c960e01b86526004860152602485015260448401525af18015610fc257610fad575b50509260409a95925f51602061576f5f395f51905f529895926101609895610f658d8f5190610f1f826110de565b81528d60208201528f8b908201528260608201528360808201528460a08201528560c08201528660e082015287610100820152886101208201528961014082015261115e565b8d51988d8a528c60208b01528e8a01526060890152608088015260a087015260c086015260e0850152610100840152610120830152610140820152a182519182526020820152f35b610fb88280926110fa565b6103915780610ef1565b6040513d84823e3d90fd5b610fd991505f906110fa565b5f5f610eb2565b6040513d5f823e3d90fd5b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b909a506020813d60201161103f575b8161101f602093836110fa565b81010312610feb57516001600160a01b0381168103610feb57995f610daa565b3d9150611012565b61106191995060203d6020116109595761094a81836110fa565b975f610d61565b61107f9150833d85116109595761094a81836110fa565b5f610d1a565b60405162461bcd60e51b815260206004820152601760248201527637b7363c9039b2b1bab934ba3ca837b7b62337b935b2b960491b6044820152606490fd5b34610feb575f366003190112610feb576020906008548152f35b61016081019081106001600160401b03821117610fef57604052565b601f909101601f19168101906001600160401b03821190821017610fef57604052565b90816020910312610feb57516001600160a01b0381168103610feb5790565b6001600160a01b03918216815291166020820152604081019190915260600190565b600854600160401b811015610fef576001810160085560085481101561126a5760085f52600b025f51602061578f5f395f51905f520190805182546001600160a01b03199081166001600160a01b039283161784556020830151600185018054831691841691909117905560408301516002850180548316918416919091179055606083015160038501805483169184169190911790556080830151600485018054909216921691909117905560a08101516005830180546001600160f81b0319166001600160f81b039290921691909117905560c0810151600683015560e08101516007830155610100810151600883015561012081015160098301556101400151600a9190910155565b634e487b7160e01b5f52603260045260245ffd5b6001600160401b038111610fef5760051b60200190565b805182101561126a5760209160051b01019056fe6101c080604052346103e3576101a0816144c58038038091610021828561044f565b8339810103126103e35761003481610486565b60208201519091906001600160a01b038116908190036103e35760408201516001600160a01b03811691908290036103e3576060830151936001600160a01b03851685036103e35760808401516001600160a01b03811681036103e35760a0850151956001600160a01b03871687036103e35760c08601516001600160a01b03811681036103e35760e08701516001600160a01b038116978882036103e357610100810151906001600160a01b03821682036103e357610120810151976001600160f81b03891689036103e3576101408201519061011b6101806101608501519401610486565b9960a05260018060a01b0319600354161760035560805260075560c05260e05261016052610180526101405260018060a01b031660018060a01b031960025416176002556101a05260018060a01b03196001541617600155155f1461043d5760ff19601054166010555b6101005260c05160a051604051630a8ad82560e41b81526001600160f81b03909116600482015290602090829060249082906001600160a01b03165afa9081156103ef575f916103fa575b5061012081905260c05160405163095ea7b360e01b81526001600160a01b0391821660048201525f19602482015291602091839160449183915f91165af180156103ef576103b3575b60405161402a908161049b8239608051818181610cc401528181611b290152613c1d015260a05181818161036d01528181610b130152818161106e015281816116650152818161186b01528181611ddd0152818161209201528181612699015281816126e30152818161306b0152613b9f015260c0518181816103a901528181610b48015281816110b4015281816116a0015281816118a401528181611e25015281816120c70152818161263b01528181612722015281816130a30152613bd4015260e0518181816080015261259301526101005181818161196201528181611e8c0152818161203a0152818161279d0152612c2a0152610120518181816105370152818161085201528181610d2e01528181610f870152818161172401528181611c2e0152818161226701528181612b150152818161353f015281816136080152613991015261014051818181610405015281816110010152818161110b0152818161211d0152612a2401526101605181613273015261018051818181610ab60152610d9601526101a05181818160b20152611fd70152f35b6020813d6020116103e7575b816103cc6020938361044f565b810103126103e35751801515036103e3575f610219565b5f80fd5b3d91506103bf565b6040513d5f823e3d90fd5b90506020813d602011610435575b816104156020938361044f565b810103126103e357516001600160a01b03811681036103e35760206101d0565b3d9150610408565b600260ff196010541617601055610185565b601f909101601f19168101906001600160401b0382119082101761047257604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036103e35756fe60808060405260043610156100e0575b50361561001a575f80fd5b6002546001600160a01b0316331480156100ae575b801561007c575b1561003d57005b60405162461bcd60e51b81526020600482015260176024820152762ab730baba3437b934bd32b21022aa241039b2b73232b960491b6044820152606490fd5b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614610036565b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161461002f565b5f905f3560e01c908163021b50ff146132a257508063044b25e81461325e578063094959b4146131f25780630f78dd98146131d5578063126c496214612ca05780631db2079f14612bec578063214e16e714612bce57806327c0a4f314612baf5780632801969714612b91578063287fa97314612b4457806329034a5c14612aff5780632986454714612ae15780632ac970c9146129ed5780633c4e2d04146129ce5780633d11a051146129375780633e50b4c4146126c857806344c094a314612683578063495e54211461266a5780634fffd0371461262557806359ae2fa81461260757806359d3b80a146125e05780635e452ae4146125c257806360f96a8f1461257d5780636640e2851461255457806367b5382c146120695780636c9fa59e1461202457806374d4e491146120065780637b7bab9d14611fc15780638c899c2e14611fa35780639025b5e814611f7a57806394614dbf14611dbc578063991292e314611d92578063999d115014611d69578063a305b7b414611d03578063a77384c114611cd3578063ae0255bc14611b4c578063b06a5c5214611b11578063b460481d1461184b578063b665feae14611644578063b8b1087114611616578063b948083c146115ef578063b98cca3714611589578063baea8cd314611030578063c20e976714610feb578063c37ffb8914610f30578063c4c2b5ea14610f17578063c5afa41414610ae5578063d46eecdf14610aa0578063d721cc7714610a70578063d76c4f9d14610a4e578063d9625212146109c8578063e9bb84c214610933578063ec32c8ca14610815578063ec7a9c1a146107f75763ed55b3660361000f57346107f45760403660031901126107f45761035e613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820152602480359291906020908290817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa80156107e95784906107b5575b6103eb915015613747565b61040360ff601054166103fd81613336565b1561338e565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061043933831461387d565b604051630d84655b60e21b8152602081600481865afa80156107aa5761046691869161077b575b506138b6565b61046f81613e5c565b60018060a01b038116808552600d60205260016040862001549261049e84610499876004546134c6565b6134a5565b600455818652600d602052846001604088200155818652600d6020526104c76040872054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f65760405163029f8a6d60e11b8152602081600481865afa80156106eb578890610747575b6105169150876134d3565b10156106af576040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161070a575b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657600460208154936040519283809263029f8a6d60e11b82525afa80156106eb5788906106b3575b6105c39150836134d3565b10156106af5760055411610656577f0cc729a57ccae35254cf96efe31c880c3b3a9f276261d86107b55263bd084b56938161062f928752600d602052670de0b6b3a764000060016040892001541080159061063d575b6106239150613930565b60405193849384613912565b0390a161063a6137b2565b80f35b508652600d602052610623600160408820015415610619565b60405162461bcd60e51b815260206004820152602b60248201527f6d696e74656420746f6f206d616e7920636f6d706c657465207365747320746f60448201526a20616c6c6f77207468697360a81b6064820152608490fd5b8580fd5b506020813d6020116106e3575b816106cd602093836132d2565b810103126106df576105c390516105b8565b5f80fd5b3d91506106c0565b6040513d8a823e3d90fd5b634e487b7160e01b87526011600452602487fd5b90506020813d602011610734575b81610725602093836132d2565b810103126106df57515f61056f565b3d9150610718565b6040513d89823e3d90fd5b506020813d602011610773575b81610761602093836132d2565b810103126106df57610516905161050b565b3d9150610754565b61079d915060203d6020116107a3575b61079581836132d2565b8101906133ee565b5f610460565b503d61078b565b6040513d87823e3d90fd5b506020813d6020116107e1575b816107cf602093836132d2565b810103126106df576103eb90516103e0565b3d91506107c2565b6040513d86823e3d90fd5b80fd5b50346107f457806003193601126107f4576020600954604051908152f35b50346107f457806003193601126107f45761083b60018060a01b03600254163314613354565b6040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f0575b506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b03925af180156108e5576108c9575080f35b6108e19060203d6020116107a35761079581836132d2565b5080f35b6040513d84823e3d90fd5b9250506020823d602011610920575b8161090c602093836132d2565b810103126106df5790518291906020610892565b3d91506108ff565b6040513d85823e3d90fd5b50346107f45760403660031901126107f457806004356001600160a01b038116908190036109c5578180809261097460018060a01b03600254163314613354565b602435905af16109826136ab565b501561098b5780f35b60405162461bcd60e51b81526020600482015260126024820152710ccc2d2d8cac840e8de40e6cadcc8408aa8960731b6044820152606490fd5b50fd5b50346107f45760803660031901126107f4576109e2613320565b6109f760018060a01b03600254163314613354565b6001600160a01b03811690610a1690610a11831515613f29565b613f65565b808252600d6020526024356040832055808252600d60205260443560016040842001558152600d602052606435600360408320015580f35b50346107f45760203660031901126107f45761063a610a6b613320565b613e5c565b50346107f45760203660031901126107f457610a9760018060a01b03600254163314613354565b60043560065580f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f4578060043560048110156109c5576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610edf575b50610b8b9015613747565b610b9d60ff601054166103fd81613336565b81546001600160a01b031615610cb2575b815460405163e2247da960e01b8152336004820152926020928492606492849290916001600160a01b031690610be381613336565b602484015260243560448401525af19081156108e5578291610c80575b50338252600d602052610c1b600460408420019182546134c6565b9055338152600d602052610c326040822054613976565b338252600d602052600460408320015411610c4a5780f35b60405162461bcd60e51b815260206004820152600e60248201526d04e6f7420656e6f756768205245560941b6044820152606490fd5b90506020813d602011610caa575b81610c9b602093836132d2565b810103126106df57515f610c00565b3d9150610c8e565b600154604051630258f95360e31b81527f00000000000000000000000000000000000000000000000000000000000000006004820152919250602090829060249082906001600160a01b03165afa908115610928578391610ead575b50421115610e6f57604051630238d35960e41b81528291906020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391610e38575b506040516382579fc360e01b8152670de0b6b3a764000060048201526028909104602482015290602082604481867f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af18015610928578390610def575b83546001600160a01b0319166001600160a01b03919091161783559050610bae565b50906020813d602011610e30575b81610e0a602093836132d2565b81010312610e2c5751906001600160a01b0382168203610e2c57602091610dcd565b5050fd5b3d9150610dfd565b9250506020823d602011610e67575b81610e54602093836132d2565b810103126106df57602883925190610d66565b3d9150610e47565b60405162461bcd60e51b81526020600482015260166024820152751c5d595cdd1a5bdb881a185cc81b9bdd08195b99195960521b6044820152606490fd5b90506020813d602011610ed7575b81610ec8602093836132d2565b810103126106df57515f610d0e565b3d9150610ebb565b9250506020823d602011610f0f575b81610efb602093836132d2565b810103126106df57610b8b83925190610b80565b3d9150610eee565b50346107f457806003193601126107f45761063a613b88565b50346107f457806003193601126107f457610f5660018060a01b03600254163314613354565b600160ff196010541617601055610f6b613b88565b600c8190556040516370a0823160e01b815230600482015281907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690602081602481855afa9081156109285783916108f057506020916108b79160405194858094819363a9059cbb60e01b8352336004840161372c565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760e03660031901126107f45761104a613320565b602435826001600160a01b038216808303611585576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526084359360c435916044359190606435906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561073c57879161154d575b506110f79015613747565b61110960ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169361113f33861461387d565b604051630d84655b60e21b8152602081600481895afa9384156106eb5761117460209561117d9360049b9161153657506138b6565b610a6b8b613f65565b61118689613e5c565b806115205750670de0b6b3a76400009004925b60405163029f8a6d60e11b815295869182905afa93841561073c5787946114ec575b50600754926111d3856111ce86896134d3565b6134d3565b670de0b6b3a7640000840290848204670de0b6b3a764000014851517156114565711156114a857858211156114a15785925b831561146a5788956111ce6112268961122161125195896134d3565b6134e6565b966111ce87600160406112388c6135da565b9e828060a01b03169c8d8152600d6020522001546134c6565b858952600d60205261126f61126a8960408c20546134c6565b613976565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156114565711611411577f966090b9fc0bdd1d04cc16943b6c5be54254c04ae7aa5ba115bee12f8bce678b966112c48460a0986134a5565b828a52600d602052600160408b200155818952600d602052604089206112eb8282546134a5565b9055858952600d602052600160408a20016113078582546134c6565b9055858952600d60205261132060408a209182546134c6565b9055808852600d602052678ac7230489e8000061134060408a2054613976565b108015906113fd575b61135290613af0565b808852600d602052670de0b6b3a7640000600160408a200154108015906113e6575b61137d90613af0565b848852600d6020526113a5678ac7230489e8000061139e60408b2054613976565b1015613b3c565b848852600d6020526113c8670de0b6b3a7640000600160408b2001541015613b3c565b6040519485526020850152604084015260608301526080820152a180f35b50808852600d602052604088206001015415611374565b50808852600d602052604088205415611349565b60405162461bcd60e51b815260206004820152601d60248201527f4e657720706f6f6c20776f756c64206265206c697175696461626c65210000006044820152606490fd5b634e487b7160e01b8a52601160045260248afd5b60405162461bcd60e51b815260206004820152600f60248201526e6e6f206465627420746f206d6f766560881b6044820152606490fd5b8192611205565b60405162461bcd60e51b815260206004820152601c60248201527b7661756c74206e6565647320746f206265206c697175696461626c6560201b6044820152606490fd5b9093506020813d602011611518575b81611508602093836132d2565b810103126106df5751925f6111bb565b3d91506114fb565b6112216115309260a435906134d3565b92611199565b61079d9150873d89116107a35761079581836132d2565b9650506020863d60201161157d575b81611569602093836132d2565b810103126106df576110f7899651906110ec565b3d915061155c565b5080fd5b50346107f4576115a161159b366132bc565b90613a2c565b90604051918291602083016020845282518091526020604085019301915b8181106115cd575050500390f35b82516001600160a01b03168452859450602093840193909201916001016115bf565b50346107f45760203660031901126107f457602061160e600435613976565b604051908152f35b50346107f45760203660031901126107f457602061160e61163b6005546004356134d3565b600854906134e6565b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048281019190915235906020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390611817575b6116e2915015613747565b6116f460ff601054166103fd81613336565b6116fd816135da565b6040516323b872dd60e01b815291906020838061171f853033600485016138f0565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19081156107e9577f266a200266d5d786f67674869101a74359975afe2100e4ebdb9e3621de2eb67c936117ab926117fa575b5061178a33613f65565b338552600d602052604085206117a18282546134c6565b90556006546134c6565b600655338352600d6020526117d6678ac7230489e800006117cf6040862054613976565b1015613930565b338352600d6020526040832054906117f46040519283923384613912565b0390a180f35b6118129060203d6020116107a35761079581836132d2565b611780565b506020813d602011611843575b81611831602093836132d2565b810103126106df576116e290516116d7565b3d9150611824565b50346107f457806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03166004820181905282916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610928578391611ad8575b50906118ea60249215613747565b6118fc60ff601054166103fd81613336565b60025460405163352dfc9760e11b81523060048201529260209184919082906001600160a01b03165afa918215610928578392611aa7575b5061193e82613336565b61194b6003831415613406565b604051630366d19d60e61b815260048101919091527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169161199481613336565b6024820152602081604481855afa908115610928578391611a6f575b506020916119d691604051948580948193631bc7955960e11b835233906004840161348c565b03925af180156108e5578290611a30575b5f516020613fd55f395f51905f529150611a0661163b600554836134d3565b90611a208480808086335af1611a1a6136ab565b506136e9565b6117f46040519283923384613912565b506020813d602011611a67575b81611a4a602093836132d2565b810103126106df575f516020613fd55f395f51905f5290516119e7565b3d9150611a3d565b9250506020823d602011611a9f575b81611a8b602093836132d2565b810103126106df57905182919060206119b0565b3d9150611a7e565b611aca91925060203d602011611ad1575b611ac281836132d2565b8101906133d6565b905f611934565b503d611ab8565b919250506020813d602011611b09575b81611af5602093836132d2565b810103126106df57518291906118ea6118dc565b3d9150611ae8565b50346107f457806003193601126107f45760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346107f45760203660031901126107f457611b66613320565b60025460405163352dfc9760e11b815230600482015290602090829060249082906001600160a01b03165afa90811561092857611bb8916003918591611cb4575b50611bb181613336565b1415613406565b611bc181613e5c565b6001600160a01b038116808352600d6020526040832054611bfb90611be590613976565b828552600d6020526004604086200154906134a5565b908352600d6020528260408120556040519163a9059cbb60e01b835260208380611c2985856004840161372c565b0381877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19283156107e9577f86a75ce05d96dd9f84d84175307eda113c08d1a36a7f47448229d90c1df7abdf93611c97575b506117f460405192839233846138f0565b611caf9060203d6020116107a35761079581836132d2565b611c86565b611ccd915060203d602011611ad157611ac281836132d2565b5f611ba7565b50346107f45760203660031901126107f457611cfa60018060a01b03600254163314613354565b60043560085580f35b50346107f45760203660031901126107f45760a0906040906001600160a01b03611d2b613320565b168152600d60205220805490600181015490600281015460046003830154920154926040519485526020850152604084015260608301526080820152f35b50346107f457806003193601126107f4576001546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f457602060ff6010541660405190611db881613336565b8152f35b50346107f45760203660031901126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004808401919091529091839135906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa908115610928578391611f42575b50611e609015613747565b611e7260ff601054166103fd81613336565b611e7a613b88565b611e8961163b600554836134d3565b927f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15611f3e57828491611ee19383604051809681958294634a38db3160e11b8452339060048501613787565b03925af1801561092857611f29575b50818061063a94611f0482946008546134a5565b600855611f13816005546134a5565b600555611f1e6137b2565b335af1611a1a6136ab565b611f348380926132d2565b611585575f611ef0565b8380fd5b9250506020823d602011611f72575b81611f5e602093836132d2565b810103126106df57611e6084925190611e55565b3d9150611f51565b50346107f457806003193601126107f4576002546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600854604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600e54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760403660031901126107f457612083613320565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015610928578390612520575b612109915015613747565b61211b60ff601054166103fd81613336565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169061215133831461387d565b604051630d84655b60e21b8152602081600481865afa80156107e95761217d91859161077b57506138b6565b6121886024356135da565b9061219a612194613504565b836134c6565b6001600160a01b038216808652600d6020526040862054909391111561251a5750818452600d6020526040842054915b6121d383613976565b92818652600d6020526121ed846104996040892054613976565b670de0b6b3a7640000810290808204670de0b6b3a764000014901517156106f657828752600d60205260016040882001546040519063029f8a6d60e11b82526020826004818b5afa90811561243e5789916124e4575b61224d92506134d3565b11612493576040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031695906020816024818a5afa80156106eb578690899061245d575b6122b392506134a5565b90670de0b6b3a7640000820291808304670de0b6b3a764000014901517156124495760049060208254916040519384809263029f8a6d60e11b82525afa90811561243e578991612408575b61230892506134d3565b116123b557612331918652600d602052604086206123278282546134a5565b90556006546134a5565b6006556020604051809463a9059cbb60e01b825281878161235688886004840161372c565b03925af19283156107e9577fbbfe2b12a823e4f2b0b4b77b68e919461565bade7d192fd09011cd7f2721d5c893612398575b506117f46040519283928361372c565b6123b09060203d6020116107a35761079581836132d2565b612388565b60405162461bcd60e51b815260206004820152602560248201527f476c6f62616c20536563757269747920426f6e6420416c6c6f77616e636520626044820152643937b5b2b760d91b6064820152608490fd5b90506020823d602011612436575b81612423602093836132d2565b810103126106df576123089151906122fe565b3d9150612416565b6040513d8b823e3d90fd5b634e487b7160e01b88526011600452602488fd5b50506020813d60201161248b575b81612478602093836132d2565b810103126106df57856122b391516122a9565b3d915061246b565b60405162461bcd60e51b8152602060048201526024808201527f4c6f63616c20536563757269747920426f6e6420416c6c6f77616e636520627260448201526337b5b2b760e11b6064820152608490fd5b90506020823d602011612512575b816124ff602093836132d2565b810103126106df5761224d915190612243565b3d91506124f2565b916121ca565b506020813d60201161254c575b8161253a602093836132d2565b810103126106df5761210990516120fe565b3d915061252d565b50346107f457806003193601126107f4576003546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f4576020600554604051908152f35b50346107f457806003193601126107f457546040516001600160a01b039091168152602090f35b50346107f457806003193601126107f4576020600454604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f457806003193601126107f45761063a6137b2565b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160f81b03168152602090f35b50806003193601126107f4576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b0381166004830152906020816024816001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000165afa8015610928578390612903575b61275c915015613747565b61276e60ff601054166103fd81613336565b34156128cb5761277c613b88565b60045461278b600554346134c6565b1161287a578161279a3461366e565b917f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15612876578383916127f2938360405180968195829463d24cd71360e01b8452339060048501613787565b03925af180156108e557612861575b507fc4f182d89ad6e504359313de2a844d67bfc57e590dd6be312525703ed336225c606083612832816008546134c6565b9081600855612843346005546134c6565b908160055560405192835260208301526040820152a161063a6137b2565b8161286b916132d2565b61158557815f612801565b8280fd5b60405162461bcd60e51b8152602060048201526024808201527f6e6f20636170616369747920746f206372656174652074686174206d616e79206044820152637365747360e01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601060248201526f0dccacac840e8de40e6cadcc840cae8d60831b6044820152606490fd5b506020813d60201161292f575b8161291d602093836132d2565b810103126106df5761275c9051612751565b3d9150612910565b50346107f45760203660031901126107f4577f88df2253f70738a84fea9b6fb6a5eaaf426532c74425b93265d5fde54075af0a612972613320565b60018060a01b03811690818452600d6020526129bf8480808060026040822001548781988352600d6020528260026040822001556129b2826009546134a5565b6009555af1611a1a6136ab565b6117f46040519283928361372c565b50346107f45760203660031901126107f457602061160e60043561366e565b50346107f45760603660031901126107f4576003546001600160a01b03163303612a905742600a55600435600c55604435600555807f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b156109c557818091602460405180948193631d82e58560e11b8352833560048401525af180156108e557612a7f5750f35b81612a89916132d2565b6107f45780f35b60405162461bcd60e51b8152602060048201526024808201527f6f6e6c792063616c6c61626c65206279207365637572697479506f6f6c466163604482015263746f727960e01b6064820152608490fd5b50346107f457806003193601126107f4576020600b54604051908152f35b50346107f457806003193601126107f4576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346107f45760203660031901126107f457600435600481101561158557612b7760018060a01b03600254163314613354565b612b8081613336565b60ff80196010541691161760105580f35b50346107f457806003193601126107f4576020600754604051908152f35b50346107f45760203660031901126107f457602061160e6004356135da565b50346107f457806003193601126107f4576020600c54604051908152f35b50346106df5760203660031901126106df576004356001600160a01b038116908190036106df57612c2860018060a01b03600254163314613354565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690813b156106df575f91602483926040519485938492635b52ebef60e11b845260048401525af18015612c9557612c87575080f35b612c9391505f906132d2565b005b6040513d5f823e3d90fd5b346106df5760403660031901126106df5760043560048110156106df57602435906001600160401b0382116106df57366023830112156106df57816004013591612ce983613309565b92612cf760405194856132d2565b8084526024602085019160051b830101913683116106df57602401905b8282106131c55750505f546001600160a01b0316919050811561317457612d4360ff601054166103fd81613336565b612d4c81613336565b600381146131375760025460405163352dfc9760e11b81523060048201529190602090839060249082906001600160a01b03165afa918215612c95575f92613116575b50612d9982613336565b6003821480938161305c575b8461300a575b50612db583613336565b801590613003575b612dc690613406565b5f5b8451811015612c93578315612f15575f80549091906040906001600160a01b03166064612df5848a613450565b5183519586938492633bdc2c0560e01b84526004840152612e1589613336565b8860248401523360448401525af18015612c95575f5f91612ed4575b6001935081905b848060a01b031691825f52600d602052600460405f2001612e5a8282546134a5565b905580821115612e9657612e7190612e76926134a5565b6135da565b905f52600d602052612e8d60405f209182546134c6565b90555b01612dc8565b808210612ea6575b505050612e90565b612eb391612e71916134a5565b905f52600d602052612eca60405f209182546134a5565b9055868080612e9e565b50506040823d8211612f0d575b81612eee604093836132d2565b810103126106df57816020612f04600194613478565b91015190612e31565b3d9150612ee1565b612f1e83613336565b612f2782613336565b828203612fce575f906060612f6860018060a01b03845416612f49848a613450565b51604051958680948193637dc5bcc960e11b835233906004840161348c565b03925af18015612c95575f5f915f90612f87575b600194509190612e38565b5050506060823d8211612fc6575b81612fa2606093836132d2565b810103126106df5781612fb6600193613478565b6020820151604090920151612f7c565b3d9150612f95565b60405162461bcd60e51b815260206004820152600d60248201526c57726f6e67206f7574636f6d6560981b6044820152606490fd5b5082612dbd565b60405163f7b2a8e360e01b8152919450602090829060049082905afa908115612c95575f9161303d575b50159285612dab565b613056915060203d6020116107a35761079581836132d2565b85613034565b6040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201529094506020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916130e4575b50151593612da5565b90506020813d60201161310e575b816130ff602093836132d2565b810103126106df5751866130db565b3d91506130f2565b61313091925060203d602011611ad157611ac281836132d2565b9084612d8f565b60405162461bcd60e51b8152602060048201526015602482015274496e76616c6964206f7574636f6d653a204e6f6e6560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526024808201527f657363616c6174696f6e2067616d65206e6565647320746f206265206465706c6044820152631bde595960e21b6064820152608490fd5b8135815260209182019101612d14565b346106df575f3660031901126106df576020600a54604051908152f35b346106df57613200366132bc565b9061321660018060a01b03600254163314613354565b80821061322557600555600455005b60405162461bcd60e51b8152602060048201526011602482015270189bdb99081a5b9cdd59999a58da595b9d607a1b6044820152606490fd5b346106df575f3660031901126106df576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346106df575f3660031901126106df576020906006548152f35b60409060031901126106df576004359060243590565b601f909101601f19168101906001600160401b038211908210176132f557604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116132f55760051b60200190565b600435906001600160a01b03821682036106df57565b6004111561334057565b634e487b7160e01b5f52602160045260245ffd5b1561335b57565b60405162461bcd60e51b815260206004820152600b60248201526a27b7363c902337b935b2b960a91b6044820152606490fd5b1561339557565b60405162461bcd60e51b815260206004820152601960248201527814de5cdd195b481a5cc81b9bdd081bdc195c985d1a5bdb985b603a1b6044820152606490fd5b908160209103126106df575160048110156106df5790565b908160209103126106df575180151581036106df5790565b1561340d57565b60405162461bcd60e51b815260206004820152601b60248201527a5175657374696f6e20686173206e6f742066696e616c697a65642160281b6044820152606490fd5b80518210156134645760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b51906001600160a01b03821682036106df57565b9081526001600160a01b03909116602082015260400190565b919082039182116134b257565b634e487b7160e01b5f52601160045260245ffd5b919082018092116134b257565b818102929181159184041417156134b257565b81156134f0570490565b634e487b7160e01b5f52601260045260245ffd5b6006545f81156135c557678ac7230489e8000082810292908304036134b2576040516370a0823160e01b8152306004820152916020836024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9182156135b95791613583575b61358092506134e6565b90565b90506020823d6020116135b1575b8161359e602093836132d2565b810103126106df57613580915190613576565b3d9150613591565b604051903d90823e3d90fd5b506a3c2f7086aed236c807a1b560251b919050565b6006548015613649576135ec916134d3565b6040516370a0823160e01b8152306004820152906020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916135835761358092506134e6565b50670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b6005548061369b5750670de0b6b3a7640000810290808204670de0b6b3a764000014901517156134b25790565b61122161358092600854906134d3565b3d156136e4573d906001600160401b0382116132f557604051916136d9601f8201601f1916602001846132d2565b82523d5f602084013e565b606090565b156136f057565b60405162461bcd60e51b81526020600482015260146024820152733330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b6001600160a01b039091168152602081019190915260400190565b1561374e57565b60405162461bcd60e51b8152602060048201526011602482015270169bdb1d185c881a185cc8199bdc9ad959607a1b6044820152606490fd5b6001600160f81b0390911681526001600160a01b039091166020820152604081019190915260600190565b600454801561387a5760ff601054166137ca81613336565b61387a57600554906040519163420671d160e11b83526004830152602482015260208160448173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613847575b506020817f685712dbe95545a3f62ba5b3e15f5eca83a0d979dfba0c33ee395b45f1b8816a92600c55604051908152a1565b90506020813d602011613872575b81613862602093836132d2565b810103126106df57516020613815565b3d9150613855565b50565b1561388457565b60405162461bcd60e51b815260206004820152600a6024820152694f6e6c794f7261636c6560b01b6044820152606490fd5b156138bd57565b60405162461bcd60e51b815260206004820152600b60248201526a5374616c6520707269636560a81b6044820152606490fd5b6001600160a01b03918216815291166020820152604081019190915260600190565b604091949392606082019560018060a01b0316825260208201520152565b1561393757565b60405162461bcd60e51b81526020600482015260176024820152761b5a5b8819195c1bdcda5d081c995c5d5a5c995b595b9d604a1b6044820152606490fd5b6040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115612c95575f916139e0575b506139d790613580926134d3565b600654906134e6565b90506020813d602011613a0c575b816139fb602093836132d2565b810103126106df57516135806139c9565b3d91506139ee565b600e5481101561346457600e5f5260205f2001905f90565b9190600e54808410801590613ae8575b613acc5783613a4a916134a5565b80821015613ac557505b613a5d81613309565b613a6a60405191826132d2565b818152601f19613a7983613309565b0136602083013780935f5b838110613a915750505050565b80613aa6613aa1600193856134c6565b613a14565b838060a01b0391549060031b1c16613abe8286613450565b5201613a84565b9050613a54565b50509050604051613ade6020826132d2565b5f81525f36813790565b508115613a3c565b15613af757565b60405162461bcd60e51b815260206004820152601e60248201527f746172676574206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b15613b4357565b60405162461bcd60e51b815260206004820152601e60248201527f63616c6c6572206d696e206465706f73697420726571756972656d656e7400006044820152606490fd5b60045415613e5a576040516387ca99af60e01b81527f00000000000000000000000000000000000000000000000000000000000000006001600160f81b031660048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa8015612c95575f90613e27575b600154604051630258f95360e31b81527f000000000000000000000000000000000000000000000000000000000000000060048201529250602090839060249082906001600160a01b03165afa918215612c95575f92613df3575b5080613dec57505b8042115f14613de657805b600a54818111613de157613c8c916134a5565b8015613ddd5760055490600c5490604051916367b870af60e01b835260048301526024820152670de0b6b3a7640000604482015260208160648173__$597d296d81f9c7cf22e8ca2cad4b80bc52$__5af4908115612c95575f91613da3575b50613cff90670de0b6b3a7640000926134d3565b04613d0c816005546134a5565b90613d19826009546134c6565b9081600955670de0b6b3a7640000830292808404670de0b6b3a764000014901517156134b2577f6ff9a830210578ad4c7a059cea7ddaa46b3f205a71080d031c16d4070eeb82f093613d7b613d73604095600454906134e6565b600b546134c6565b600b55816005554281105f14613d9c575b600a5582519182526020820152a1565b5042613d8c565b90506020813d602011613dd5575b81613dbe602093836132d2565b810103126106df5751670de0b6b3a7640000613ceb565b3d9150613db1565b5050565b505050565b42613c79565b9050613c6e565b9091506020813d602011613e1f575b81613e0f602093836132d2565b810103126106df5751905f613c66565b3d9150613e02565b506020813d602011613e52575b81613e41602093836132d2565b810103126106df5760249051613c0b565b3d9150613e34565b565b7fa9b6a8e9daf01958ea6a93a4f548ee24e1cf49edc6eda0c8b4bd62b25af32f6f90613e86613b88565b6001600160a01b0381165f818152600d602052604090206001810154600b54600390920154929392670de0b6b3a764000091613ecc91613ec690856134a5565b906134d3565b0490835f52600d602052600360405f200155825f52600d602052613ef8600260405f20019182546134c6565b90555f918252600d60205260409182902060038101546002909101549251928392613f24929084613912565b0390a1565b15613f3057565b60405162461bcd60e51b815260206004820152600d60248201526c1a5b9d985b1a59081d985d5b1d609a1b6044820152606490fd5b6001600160a01b0316613f79811515613f29565b805f52600f60205260405f205461387a57600e54600160401b8110156132f557806001613fa99201600e55613a14565b81549060031b9083821b9160018060a01b03901b1916179055600e54905f52600f60205260405f205556feef7fb21fed1701a6c82b78d78bad1ddab67e41025c2d5078a1be2a3a238b4e62a2646970667358221220900f3b24dc65776ec870bcdd15a729e4f1117d4882abecb33bf72208912fd0fd64736f6c634300082100339764ef375b80b2e64d609b0bf0737252ffaa127605d510d5e0742fcf0641bb8cf3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee3a26469706673582212206a2d3dd5ef1cca633113a555ae4f631ae0277d254117fc5752846049609337b464736f6c63430008210033'
		}
	}
}
export declare const peripherals_factories_ShareTokenFactory_ShareTokenFactory: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_zoltar'
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deployShareToken'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'salt'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'shareToken'
					readonly type: 'address'
					readonly internalType: 'contract ShareToken'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60a034606557601f61218138819003918201601f19168301916001600160401b03831184841017606957808492602094604052833981010312606557516001600160a01b0381168103606557608052604051612103908161007e82396080518160550152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe60808060405260043610156011575f80fd5b5f3560e01c6305e1bc48146023575f80fd5b3460d057604036600319011260d057611ff981810191906001600160401b0383118284101760bc576100d582393382527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166020830152602435604083015260043591819003606001905ff5801560b1576040516001600160a01b039091168152602090f35b6040513d5f823e3d90fd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe60a080604052346103cf57606081611ff9803803809161001f82856103d3565b8339810103126103cf5780516001600160a01b03811691908290036103cf5760208101516001600160a01b03811681036103cf57604061006492015190608052610411565b9060405191665368617265732d60c81b60208401528051926100a3602782602085019680888484015e81015f838201520301601f1981018352826103d3565b8051906001600160401b0382116102cd57600354600181811c911680156103c5575b60208210146102af57601f8111610357575b50602090601f83116001146102ec57918061013e94926026945f926102e1575b50508160011b915f199060031b1c1916176003555b6040519485916553484152452d60d01b60208401525180918484015e81015f838201520301601f1981018452836103d3565b81516001600160401b0381116102cd57600454600181811c911680156102c3575b60208210146102af57601f8111610241575b50602092601f82116001146101e057928192935f926101d5575b50508160011b915f199060031b1c1916176004555b5f52600560205260405f20600160ff19825416179055604051611ae290816105178239608051818181610bf60152610eb70152f35b015190505f8061018b565b601f1982169360045f52805f20915f5b8681106102295750836001959610610211575b505050811b016004556101a0565b01515f1960f88460031b161c191690555f8080610203565b919260206001819286850151815501940192016101f0565b818111156101715760045f52601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b602084106102a7575b81601f9101920160051c03905f5b82811061029a575050610171565b5f8282015560010161028c565b5f915061027e565b634e487b7160e01b5f52602260045260245ffd5b90607f169061015f565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100f7565b90601f1983169160035f52815f20925f5b81811061033f575092600192859260269661013e989610610327575b505050811b0160035561010c565b01515f1960f88460031b161c191690555f8080610319565b929360206001819287860151815501950193016102fd565b828111156100d75760035f52601f830160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b602085106103bd575b81601f9101920160051c03905f5b8281106103b05750506100d7565b5f828201556001016103a2565b5f9150610394565b90607f16906100c5565b5f80fd5b601f909101601f19168101906001600160401b038211908210176102cd57604052565b6001600160401b0381116102cd57601f01601f191660200190565b80156104f6575f81805b6104df5750610429816103f6565b9061043760405192836103d3565b808252601f19610446826103f6565b013660208401375b8083156104d85780156104c4575f190192600a810660300191826030116104c45783518510156104b057600a9260f81b7fff00000000000000000000000000000000000000000000000000000000000000165f1a908401601f0153049161044e565b634e487b7160e01b5f52603260045260245ffd5b634e487b7160e01b5f52601160045260245ffd5b5050905090565b905f1981146104c4576001600a910191048061041b565b506040516105056040826103d3565b60018152600360fc1b60208201529056fe60806040526004361015610011575f80fd5b5f3560e01c8062fdd58e1461134157806306fdde03146112865780630febdd4914611192578063175e95231461055057806326afd2e81461115d578063378f2ab21461110e578063454b060814610e815780634e1273f414610c7f5780634f4dc53614610c255780634fffd03714610be157806380e15c4014610aed5780639471b662146108a657806395d89b41146107a25780639c5996d61461070c578063a22cb46514610629578063a2d57491146105f5578063b6a5d7de1461057a578063bd85b03914610550578063d24cd713146102ef578063d9b46740146102c9578063e8324bb614610284578063e985e9c51461024e578063edc3bc3f146101f7578063fba0ee64146101725763fc25a4da1461012b575f80fd5b3461016e57604036600319011261016e5761014461137e565b6004355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b5f80fd5b3461016e57608036600319011261016e5761018b611368565b61019361137e565b906044356001600160401b03811161016e576101b390369060040161150a565b926064356001600160401b03811161016e576101f5946101e76101dd6101ef93369060040161150a565b959092369161140c565b93369161140c565b926118f6565b005b3461016e57604036600319011261016e57610210611368565b61021861137e565b9060018060a01b03165f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b3461016e57604036600319011261016e57602061027a61026c611368565b61027461137e565b906116b9565b6040519015158152f35b3461016e57604036600319011261016e5761029d61148b565b6024359060ff8216820361016e576020916102b79161167f565b6040516001600160f81b039091168152f35b3461016e5760206102d9366114db565b9060ff60405192169060ff199060081b16178152f35b3461016e576102fd366114a1565b335f52600560205261031a600160ff60405f2054161515146115c3565b60405192610329608085611394565b600384526060928336602087013760405193610346608086611394565b600385523660208601375f9160ff199060081b16915b60ff81169060038210156103ae57600482101561039a578461038f83610395948717610388828c611657565b5288611657565b52611600565b61035c565b634e487b7160e01b5f52602160045260245ffd5b6001600160a01b038316868882156104fb578051825103610498575f5b8151811015610471578061040b6103e460019386611657565b516103ef8386611657565b515f525f60205260405f20875f5260205260405f2054906118c1565b6104158285611657565b515f525f60205260405f20865f5260205260405f20556104358184611657565b515f528160205261045560405f205461044e8387611657565b51906118c1565b61045f8285611657565b515f528260205260405f2055016103cb565b505f516020611a6d5f395f51905f526104935f936040519182913395836118ce565b0390a4005b60405162461bcd60e51b815260206004820152603560248201527f455243313135353a206d696e7465642049447320616e642076616c756573206d60448201527475737420686176652073616d65206c656e6774687360581b6064820152608490fd5b60405162461bcd60e51b815260206004820152602760248201527f455243313135353a206261746368206d696e7420746f20746865207a65726f206044820152666164647265737360c81b6064820152608490fd5b3461016e57602036600319011261016e576004355f526001602052602060405f2054604051908152f35b3461016e57602036600319011261016e576004356001600160a01b0381169081900361016e57335f5260056020526105b860ff60405f2054166115c3565b805f52600560205260405f20600160ff198254161790557fdc84e3a4c83602050e3865df792a4e6800211a79ac60db94e703a820ce8929245f80a2005b3461016e5760ff610605366114db565b919091169060ff199060081b16175f526001602052602060405f2054604051908152f35b3461016e57604036600319011261016e57610642611368565b6024359081151580920361016e576001600160a01b0316903382146106b257335f52600260205260405f20825f5260205260405f2060ff1981541660ff83161790556040519081527f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c3160203392a3005b60405162461bcd60e51b815260206004820152602c60248201527f455243313135353a2063616e6e6f742073657420617070726f76616c2073746160448201526b3a3ab9903337b91039b2b63360a11b6064820152608490fd5b3461016e57604036600319011261016e5761072561148b565b61077261073061137e565b600260405193610741606086611394565b606036863760081b60ff1916610757818461153a565b8552610766600182178461153a565b6020860152179061153a565b604082015260405190815f905b6003821061078c57606084f35b602080600192855181520193019101909161077f565b3461016e575f36600319011261016e576040515f6004548060011c9060018116801561089c575b602083108114610888578285529081156108645750600114610806575b610802836107f681850382611394565b604051918291826113cb565b0390f35b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b80821061084a575090915081016020016107f66107e6565b919260018160209254838588010152019101909291610832565b60ff191660208086019190915291151560051b840190910191506107f690506107e6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916107c9565b3461016e576108b4366114a1565b335f5260056020526108d1600160ff60405f2054161515146115c3565b604051926108e0608085611394565b6003845260609283366020870137604051936108fd608086611394565b600385523660208601375f9160ff199060081b16915b60ff811690600382101561094457600482101561039a578461038f8361093f948717610388828c611657565b610913565b856001600160a01b038416888115610a84578051835103610a22575f5b8151811015610a00578061097760019284611657565b515f525f60205260405f20845f526020526109a160405f205461099a8388611657565b51906117ca565b6109ab8285611657565b515f525f60205260405f20855f5260205260405f20556109cb8184611657565b515f52816020526109e460405f205461099a8388611657565b6109ee8285611657565b515f528260205260405f205501610961565b505f516020611a6d5f395f51905f526104935f946040519182913395836118ce565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a206275726e742049447320616e642076616c756573206d75604482015273737420686176652073616d65206c656e6774687360601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603b60248201527f455243313135353a20617474656d7074696e6720746f206275726e206261746360448201527a1a081bd9881d1bdad95b9cc81bdb881e995c9bc81858d8dbdd5b9d602a1b6064820152608490fd5b3461016e57604036600319011261016e57610b0661148b565b602435906001600160401b03821161016e573660238301121561016e578160040135610b31816113f5565b92610b3f6040519485611394565b8184526024602085019260051b8201019036821161016e57602401915b818310610bc8578385610b6f8151611625565b5f9260ff199060081b16925b8251811015610bb257610b8e8184611657565b5190600482101561039a5760ff600192168517610bab8285611657565b5201610b7b565b6040516020808252819061080290820185611458565b8235600481101561016e57815260209283019201610b5c565b3461016e575f36600319011261016e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461016e57606036600319011261016e57610c3e61148b565b602435600481101561016e576044356001600160a01b038116810361016e5760209260ff610c7793169060ff199060081b16179061153a565b604051908152f35b3461016e57604036600319011261016e576004356001600160401b03811161016e573660238201121561016e578060040135610cba816113f5565b91610cc86040519384611394565b8183526024602084019260051b8201019036821161016e57602401915b818310610e6157836024356001600160401b03811161016e573660238201121561016e57610d1d90369060248160040135910161140c565b908051825103610e0357610d318151611625565b5f5b8251811015610bb2576001600160a01b03610d4e8285611657565b511615610da15780610d6260019286611657565b515f525f60205260405f20828060a01b03610d7d8387611657565b5116838060a01b03165f5260205260405f2054610d9a8285611657565b5201610d33565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a20736f6d65206164647265737320696e2062617463682062604482015273616c616e6365207175657279206973207a65726f60601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603060248201527f455243313135353a206163636f756e747320616e6420494473206d757374206860448201526f6176652073616d65206c656e6774687360801b6064820152608490fd5b82356001600160a01b038116810361016e57815260209283019201610ce5565b3461016e57602036600319011261016e576040516387ca99af60e01b815260048035600881901c918301829052916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115611103575f916110d1575b501561109257610eff823361153a565b91821561105557610f118382336117d7565b3380159160ff81165f5b600360ff821610610f2857005b849060ff19610f37828961167f565b60081b16831791611006577fc47a839c70aa320457c80c5abd38ce8b516c72e37be119b7962f67f1f8eb7ac2608083611001945f525f60205260405f20885f52602052610f888b60405f20546118c1565b815f525f60205260405f20895f5260205260405f2055805f526001602052610fb48b60405f20546118c1565b815f52600160205260405f20556040518181528b60208201525f33915f516020611a8d5f395f51905f5260403392a46040519033825287602083015260408201528a6060820152a1611600565b610f1b565b60405162461bcd60e51b815260206004820152602160248201527f455243313135353a206d696e7420746f20746865207a65726f206164647265736044820152607360f81b6064820152608490fd5b60405162461bcd60e51b81526020600482015260156024820152744e6f2062616c616e636520746f206d69677261746560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276155b9a5d995c9cd9481a185cc81b9bdd08199bdc9ad959604a1b6044820152606490fd5b90506020813d6020116110fb575b816110ec60209383611394565b8101031261016e575183610eef565b3d91506110df565b6040513d5f823e3d90fd5b3461016e57604036600319011261016e576020600435610c7761112f61137e565b335f526005845261114b600160ff60405f2054161515146115c3565b611155838261153a565b9283916117d7565b3461016e57602036600319011261016e5760043560ff8116906040519060081c8152600482101561039a576040916020820152f35b3461016e57608036600319011261016e576111ab611368565b6111b361137e565b6001600160a01b0316906044356064356111ce841515611701565b6001600160a01b038316926111ee9033851490811561126e575b5061175e565b815f525f60205260405f20835f5260205261120d8160405f20546117ca565b5f838152602081815260408083208784529091528082209290925585815220546112389082906118c1565b825f525f60205260405f20855f5260205260405f205560405191825260208201525f516020611a8d5f395f51905f5260403392a4005b6001915061127d9033906116b9565b151514866111e8565b3461016e575f36600319011261016e576040515f6003548060011c90600181168015611337575b6020831081146108885782855290811561086457506001146112d957610802836107f681850382611394565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061131d575090915081016020016107f66107e6565b919260018160209254838588010152019101909291611305565b91607f16916112ad565b3461016e57604036600319011261016e576020610c7761135f611368565b6024359061153a565b600435906001600160a01b038216820361016e57565b602435906001600160a01b038216820361016e57565b601f909101601f19168101906001600160401b038211908210176113b757604052565b634e487b7160e01b5f52604160045260245ffd5b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b6001600160401b0381116113b75760051b60200190565b929190611418816113f5565b936114266040519586611394565b602085838152019160051b810192831161016e57905b82821061144857505050565b813581526020918201910161143c565b90602080835192838152019201905f5b8181106114755750505090565b8251845260209384019390920191600101611468565b600435906001600160f81b038216820361016e57565b606090600319011261016e576004356001600160f81b038116810361016e57906024356001600160a01b038116810361016e579060443590565b604090600319011261016e576004356001600160f81b038116810361016e5790602435600481101561016e5790565b9181601f8401121561016e578235916001600160401b03831161016e576020808501948460051b01011161016e57565b906001600160a01b0382161561156a575f525f60205260405f209060018060a01b03165f5260205260405f205490565b60405162461bcd60e51b815260206004820152602b60248201527f455243313135353a2062616c616e636520717565727920666f7220746865207a60448201526a65726f206164647265737360a81b6064820152608490fd5b156115ca57565b60405162461bcd60e51b815260206004820152600e60248201526d1b9bdd08185d5d1a1bdc9a5e995960921b6044820152606490fd5b60ff1660ff81146116115760010190565b634e487b7160e01b5f52601160045260245ffd5b9061162f826113f5565b61163c6040519182611394565b828152809261164d601f19916113f5565b0190602036910137565b805182101561166b5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b60ff60405192602084019260018060f81b03168352166040830152604082526116a9606083611394565b905190206001600160f81b031690565b6001600160a01b0382163014919082156116d257505090565b6001600160a01b039081165f90815260026020908152604080832093909416825291909152205460ff16919050565b1561170857565b60405162461bcd60e51b815260206004820152602860248201527f455243313135353a207461726765742061646472657373206d757374206265206044820152676e6f6e2d7a65726f60c01b6064820152608490fd5b1561176557565b60405162461bcd60e51b815260206004820152603760248201527f455243313135353a206e656564206f70657261746f7220617070726f76616c20604482015276666f7220337264207061727479207472616e736665727360481b6064820152608490fd5b9190820391821161161157565b6001600160a01b0316908115611861575f9281845283602052604084208385526020526118088160408620546117ca565b8285528460205260408520848652602052604085205581845260016020526118348160408620546117ca565b8285526001602052604085205560405191825260208201525f516020611a8d5f395f51905f5260403392a4565b60405162461bcd60e51b815260206004820152603260248201527f455243313135353a20617474656d7074696e6720746f206275726e20746f6b656044820152711b9cc81bdb881e995c9bc81858d8dbdd5b9d60721b6064820152608490fd5b9190820180921161161157565b90916118e56118f393604084526040840190611458565b916020818403910152611458565b90565b90939291938451835103611a1057845115611a09576001600160a01b031690611920821515611701565b6001600160a01b0381169061193f903383149081156119f1575061175e565b5f5b85518110156119c6578061195760019288611657565b516119aa6119658388611657565b51825f525f60205260405f20865f526020526119858160405f20546117ca565b5f848152602081815260408083208a84529091528082209290925588815220546118c1565b905f525f60205260405f20855f5260205260405f205501611941565b50916119ec5f516020611a6d5f395f51905f5291959294956040519182913395836118ce565b0390a4565b60019150611a009033906116b9565b1515145f6111e8565b5050509050565b60405162461bcd60e51b815260206004820152602e60248201527f455243313135353a2049447320616e642076616c756573206d7573742068617660448201526d652073616d65206c656e6774687360901b6064820152608490fdfe4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fbc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62a26469706673582212205a0d93ed77b535fdfe0d8fc03cad1fddecd07041b195930912ed8e52afee8eb864736f6c63430008210033a264697066735822122031c94698fe3ed7eafadd6091f9e5781df327bb336c9c5ce0aae78ee2bd238eb564736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60808060405260043610156011575f80fd5b5f3560e01c6305e1bc48146023575f80fd5b3460d057604036600319011260d057611ff981810191906001600160401b0383118284101760bc576100d582393382527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166020830152602435604083015260043591819003606001905ff5801560b1576040516001600160a01b039091168152602090f35b6040513d5f823e3d90fd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe60a080604052346103cf57606081611ff9803803809161001f82856103d3565b8339810103126103cf5780516001600160a01b03811691908290036103cf5760208101516001600160a01b03811681036103cf57604061006492015190608052610411565b9060405191665368617265732d60c81b60208401528051926100a3602782602085019680888484015e81015f838201520301601f1981018352826103d3565b8051906001600160401b0382116102cd57600354600181811c911680156103c5575b60208210146102af57601f8111610357575b50602090601f83116001146102ec57918061013e94926026945f926102e1575b50508160011b915f199060031b1c1916176003555b6040519485916553484152452d60d01b60208401525180918484015e81015f838201520301601f1981018452836103d3565b81516001600160401b0381116102cd57600454600181811c911680156102c3575b60208210146102af57601f8111610241575b50602092601f82116001146101e057928192935f926101d5575b50508160011b915f199060031b1c1916176004555b5f52600560205260405f20600160ff19825416179055604051611ae290816105178239608051818181610bf60152610eb70152f35b015190505f8061018b565b601f1982169360045f52805f20915f5b8681106102295750836001959610610211575b505050811b016004556101a0565b01515f1960f88460031b161c191690555f8080610203565b919260206001819286850151815501940192016101f0565b818111156101715760045f52601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b602084106102a7575b81601f9101920160051c03905f5b82811061029a575050610171565b5f8282015560010161028c565b5f915061027e565b634e487b7160e01b5f52602260045260245ffd5b90607f169061015f565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100f7565b90601f1983169160035f52815f20925f5b81811061033f575092600192859260269661013e989610610327575b505050811b0160035561010c565b01515f1960f88460031b161c191690555f8080610319565b929360206001819287860151815501950193016102fd565b828111156100d75760035f52601f830160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b602085106103bd575b81601f9101920160051c03905f5b8281106103b05750506100d7565b5f828201556001016103a2565b5f9150610394565b90607f16906100c5565b5f80fd5b601f909101601f19168101906001600160401b038211908210176102cd57604052565b6001600160401b0381116102cd57601f01601f191660200190565b80156104f6575f81805b6104df5750610429816103f6565b9061043760405192836103d3565b808252601f19610446826103f6565b013660208401375b8083156104d85780156104c4575f190192600a810660300191826030116104c45783518510156104b057600a9260f81b7fff00000000000000000000000000000000000000000000000000000000000000165f1a908401601f0153049161044e565b634e487b7160e01b5f52603260045260245ffd5b634e487b7160e01b5f52601160045260245ffd5b5050905090565b905f1981146104c4576001600a910191048061041b565b506040516105056040826103d3565b60018152600360fc1b60208201529056fe60806040526004361015610011575f80fd5b5f3560e01c8062fdd58e1461134157806306fdde03146112865780630febdd4914611192578063175e95231461055057806326afd2e81461115d578063378f2ab21461110e578063454b060814610e815780634e1273f414610c7f5780634f4dc53614610c255780634fffd03714610be157806380e15c4014610aed5780639471b662146108a657806395d89b41146107a25780639c5996d61461070c578063a22cb46514610629578063a2d57491146105f5578063b6a5d7de1461057a578063bd85b03914610550578063d24cd713146102ef578063d9b46740146102c9578063e8324bb614610284578063e985e9c51461024e578063edc3bc3f146101f7578063fba0ee64146101725763fc25a4da1461012b575f80fd5b3461016e57604036600319011261016e5761014461137e565b6004355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b5f80fd5b3461016e57608036600319011261016e5761018b611368565b61019361137e565b906044356001600160401b03811161016e576101b390369060040161150a565b926064356001600160401b03811161016e576101f5946101e76101dd6101ef93369060040161150a565b959092369161140c565b93369161140c565b926118f6565b005b3461016e57604036600319011261016e57610210611368565b61021861137e565b9060018060a01b03165f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b3461016e57604036600319011261016e57602061027a61026c611368565b61027461137e565b906116b9565b6040519015158152f35b3461016e57604036600319011261016e5761029d61148b565b6024359060ff8216820361016e576020916102b79161167f565b6040516001600160f81b039091168152f35b3461016e5760206102d9366114db565b9060ff60405192169060ff199060081b16178152f35b3461016e576102fd366114a1565b335f52600560205261031a600160ff60405f2054161515146115c3565b60405192610329608085611394565b600384526060928336602087013760405193610346608086611394565b600385523660208601375f9160ff199060081b16915b60ff81169060038210156103ae57600482101561039a578461038f83610395948717610388828c611657565b5288611657565b52611600565b61035c565b634e487b7160e01b5f52602160045260245ffd5b6001600160a01b038316868882156104fb578051825103610498575f5b8151811015610471578061040b6103e460019386611657565b516103ef8386611657565b515f525f60205260405f20875f5260205260405f2054906118c1565b6104158285611657565b515f525f60205260405f20865f5260205260405f20556104358184611657565b515f528160205261045560405f205461044e8387611657565b51906118c1565b61045f8285611657565b515f528260205260405f2055016103cb565b505f516020611a6d5f395f51905f526104935f936040519182913395836118ce565b0390a4005b60405162461bcd60e51b815260206004820152603560248201527f455243313135353a206d696e7465642049447320616e642076616c756573206d60448201527475737420686176652073616d65206c656e6774687360581b6064820152608490fd5b60405162461bcd60e51b815260206004820152602760248201527f455243313135353a206261746368206d696e7420746f20746865207a65726f206044820152666164647265737360c81b6064820152608490fd5b3461016e57602036600319011261016e576004355f526001602052602060405f2054604051908152f35b3461016e57602036600319011261016e576004356001600160a01b0381169081900361016e57335f5260056020526105b860ff60405f2054166115c3565b805f52600560205260405f20600160ff198254161790557fdc84e3a4c83602050e3865df792a4e6800211a79ac60db94e703a820ce8929245f80a2005b3461016e5760ff610605366114db565b919091169060ff199060081b16175f526001602052602060405f2054604051908152f35b3461016e57604036600319011261016e57610642611368565b6024359081151580920361016e576001600160a01b0316903382146106b257335f52600260205260405f20825f5260205260405f2060ff1981541660ff83161790556040519081527f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c3160203392a3005b60405162461bcd60e51b815260206004820152602c60248201527f455243313135353a2063616e6e6f742073657420617070726f76616c2073746160448201526b3a3ab9903337b91039b2b63360a11b6064820152608490fd5b3461016e57604036600319011261016e5761072561148b565b61077261073061137e565b600260405193610741606086611394565b606036863760081b60ff1916610757818461153a565b8552610766600182178461153a565b6020860152179061153a565b604082015260405190815f905b6003821061078c57606084f35b602080600192855181520193019101909161077f565b3461016e575f36600319011261016e576040515f6004548060011c9060018116801561089c575b602083108114610888578285529081156108645750600114610806575b610802836107f681850382611394565b604051918291826113cb565b0390f35b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b80821061084a575090915081016020016107f66107e6565b919260018160209254838588010152019101909291610832565b60ff191660208086019190915291151560051b840190910191506107f690506107e6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916107c9565b3461016e576108b4366114a1565b335f5260056020526108d1600160ff60405f2054161515146115c3565b604051926108e0608085611394565b6003845260609283366020870137604051936108fd608086611394565b600385523660208601375f9160ff199060081b16915b60ff811690600382101561094457600482101561039a578461038f8361093f948717610388828c611657565b610913565b856001600160a01b038416888115610a84578051835103610a22575f5b8151811015610a00578061097760019284611657565b515f525f60205260405f20845f526020526109a160405f205461099a8388611657565b51906117ca565b6109ab8285611657565b515f525f60205260405f20855f5260205260405f20556109cb8184611657565b515f52816020526109e460405f205461099a8388611657565b6109ee8285611657565b515f528260205260405f205501610961565b505f516020611a6d5f395f51905f526104935f946040519182913395836118ce565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a206275726e742049447320616e642076616c756573206d75604482015273737420686176652073616d65206c656e6774687360601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603b60248201527f455243313135353a20617474656d7074696e6720746f206275726e206261746360448201527a1a081bd9881d1bdad95b9cc81bdb881e995c9bc81858d8dbdd5b9d602a1b6064820152608490fd5b3461016e57604036600319011261016e57610b0661148b565b602435906001600160401b03821161016e573660238301121561016e578160040135610b31816113f5565b92610b3f6040519485611394565b8184526024602085019260051b8201019036821161016e57602401915b818310610bc8578385610b6f8151611625565b5f9260ff199060081b16925b8251811015610bb257610b8e8184611657565b5190600482101561039a5760ff600192168517610bab8285611657565b5201610b7b565b6040516020808252819061080290820185611458565b8235600481101561016e57815260209283019201610b5c565b3461016e575f36600319011261016e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461016e57606036600319011261016e57610c3e61148b565b602435600481101561016e576044356001600160a01b038116810361016e5760209260ff610c7793169060ff199060081b16179061153a565b604051908152f35b3461016e57604036600319011261016e576004356001600160401b03811161016e573660238201121561016e578060040135610cba816113f5565b91610cc86040519384611394565b8183526024602084019260051b8201019036821161016e57602401915b818310610e6157836024356001600160401b03811161016e573660238201121561016e57610d1d90369060248160040135910161140c565b908051825103610e0357610d318151611625565b5f5b8251811015610bb2576001600160a01b03610d4e8285611657565b511615610da15780610d6260019286611657565b515f525f60205260405f20828060a01b03610d7d8387611657565b5116838060a01b03165f5260205260405f2054610d9a8285611657565b5201610d33565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a20736f6d65206164647265737320696e2062617463682062604482015273616c616e6365207175657279206973207a65726f60601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603060248201527f455243313135353a206163636f756e747320616e6420494473206d757374206860448201526f6176652073616d65206c656e6774687360801b6064820152608490fd5b82356001600160a01b038116810361016e57815260209283019201610ce5565b3461016e57602036600319011261016e576040516387ca99af60e01b815260048035600881901c918301829052916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115611103575f916110d1575b501561109257610eff823361153a565b91821561105557610f118382336117d7565b3380159160ff81165f5b600360ff821610610f2857005b849060ff19610f37828961167f565b60081b16831791611006577fc47a839c70aa320457c80c5abd38ce8b516c72e37be119b7962f67f1f8eb7ac2608083611001945f525f60205260405f20885f52602052610f888b60405f20546118c1565b815f525f60205260405f20895f5260205260405f2055805f526001602052610fb48b60405f20546118c1565b815f52600160205260405f20556040518181528b60208201525f33915f516020611a8d5f395f51905f5260403392a46040519033825287602083015260408201528a6060820152a1611600565b610f1b565b60405162461bcd60e51b815260206004820152602160248201527f455243313135353a206d696e7420746f20746865207a65726f206164647265736044820152607360f81b6064820152608490fd5b60405162461bcd60e51b81526020600482015260156024820152744e6f2062616c616e636520746f206d69677261746560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276155b9a5d995c9cd9481a185cc81b9bdd08199bdc9ad959604a1b6044820152606490fd5b90506020813d6020116110fb575b816110ec60209383611394565b8101031261016e575183610eef565b3d91506110df565b6040513d5f823e3d90fd5b3461016e57604036600319011261016e576020600435610c7761112f61137e565b335f526005845261114b600160ff60405f2054161515146115c3565b611155838261153a565b9283916117d7565b3461016e57602036600319011261016e5760043560ff8116906040519060081c8152600482101561039a576040916020820152f35b3461016e57608036600319011261016e576111ab611368565b6111b361137e565b6001600160a01b0316906044356064356111ce841515611701565b6001600160a01b038316926111ee9033851490811561126e575b5061175e565b815f525f60205260405f20835f5260205261120d8160405f20546117ca565b5f838152602081815260408083208784529091528082209290925585815220546112389082906118c1565b825f525f60205260405f20855f5260205260405f205560405191825260208201525f516020611a8d5f395f51905f5260403392a4005b6001915061127d9033906116b9565b151514866111e8565b3461016e575f36600319011261016e576040515f6003548060011c90600181168015611337575b6020831081146108885782855290811561086457506001146112d957610802836107f681850382611394565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061131d575090915081016020016107f66107e6565b919260018160209254838588010152019101909291611305565b91607f16916112ad565b3461016e57604036600319011261016e576020610c7761135f611368565b6024359061153a565b600435906001600160a01b038216820361016e57565b602435906001600160a01b038216820361016e57565b601f909101601f19168101906001600160401b038211908210176113b757604052565b634e487b7160e01b5f52604160045260245ffd5b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b6001600160401b0381116113b75760051b60200190565b929190611418816113f5565b936114266040519586611394565b602085838152019160051b810192831161016e57905b82821061144857505050565b813581526020918201910161143c565b90602080835192838152019201905f5b8181106114755750505090565b8251845260209384019390920191600101611468565b600435906001600160f81b038216820361016e57565b606090600319011261016e576004356001600160f81b038116810361016e57906024356001600160a01b038116810361016e579060443590565b604090600319011261016e576004356001600160f81b038116810361016e5790602435600481101561016e5790565b9181601f8401121561016e578235916001600160401b03831161016e576020808501948460051b01011161016e57565b906001600160a01b0382161561156a575f525f60205260405f209060018060a01b03165f5260205260405f205490565b60405162461bcd60e51b815260206004820152602b60248201527f455243313135353a2062616c616e636520717565727920666f7220746865207a60448201526a65726f206164647265737360a81b6064820152608490fd5b156115ca57565b60405162461bcd60e51b815260206004820152600e60248201526d1b9bdd08185d5d1a1bdc9a5e995960921b6044820152606490fd5b60ff1660ff81146116115760010190565b634e487b7160e01b5f52601160045260245ffd5b9061162f826113f5565b61163c6040519182611394565b828152809261164d601f19916113f5565b0190602036910137565b805182101561166b5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b60ff60405192602084019260018060f81b03168352166040830152604082526116a9606083611394565b905190206001600160f81b031690565b6001600160a01b0382163014919082156116d257505090565b6001600160a01b039081165f90815260026020908152604080832093909416825291909152205460ff16919050565b1561170857565b60405162461bcd60e51b815260206004820152602860248201527f455243313135353a207461726765742061646472657373206d757374206265206044820152676e6f6e2d7a65726f60c01b6064820152608490fd5b1561176557565b60405162461bcd60e51b815260206004820152603760248201527f455243313135353a206e656564206f70657261746f7220617070726f76616c20604482015276666f7220337264207061727479207472616e736665727360481b6064820152608490fd5b9190820391821161161157565b6001600160a01b0316908115611861575f9281845283602052604084208385526020526118088160408620546117ca565b8285528460205260408520848652602052604085205581845260016020526118348160408620546117ca565b8285526001602052604085205560405191825260208201525f516020611a8d5f395f51905f5260403392a4565b60405162461bcd60e51b815260206004820152603260248201527f455243313135353a20617474656d7074696e6720746f206275726e20746f6b656044820152711b9cc81bdb881e995c9bc81858d8dbdd5b9d60721b6064820152608490fd5b9190820180921161161157565b90916118e56118f393604084526040840190611458565b916020818403910152611458565b90565b90939291938451835103611a1057845115611a09576001600160a01b031690611920821515611701565b6001600160a01b0381169061193f903383149081156119f1575061175e565b5f5b85518110156119c6578061195760019288611657565b516119aa6119658388611657565b51825f525f60205260405f20865f526020526119858160405f20546117ca565b5f848152602081815260408083208a84529091528082209290925588815220546118c1565b905f525f60205260405f20855f5260205260405f205501611941565b50916119ec5f516020611a6d5f395f51905f5291959294956040519182913395836118ce565b0390a4565b60019150611a009033906116b9565b1515145f6111e8565b5050509050565b60405162461bcd60e51b815260206004820152602e60248201527f455243313135353a2049447320616e642076616c756573206d7573742068617660448201526d652073616d65206c656e6774687360901b6064820152608490fdfe4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fbc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62a26469706673582212205a0d93ed77b535fdfe0d8fc03cad1fddecd07041b195930912ed8e52afee8eb864736f6c63430008210033a264697066735822122031c94698fe3ed7eafadd6091f9e5781df327bb336c9c5ce0aae78ee2bd238eb564736f6c63430008210033'
		}
	}
}
export declare const peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'deployUniformPriceDualCapBatchAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'salt'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract UniformPriceDualCapBatchAuction'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60808060405234601557611f62908161001a8239f35b5f80fdfe60808060405260043610156011575f80fd5b5f3560e01c6303f72d3b146023575f80fd5b3460ac57604036600319011260ac576004356001600160a01b038116919082900360ac57611e7c81810192906001600160401b038411838510176098576100b183398252602081602435930301905ff58015608d576040516001600160a01b039091168152602090f35b6040513d5f823e3d90fd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe60a03461008457601f611e7c38819003918201601f19168301916001600160401b038311848410176100885780849260209460405283398101031261008457516001600160a01b0381168103610084576001600355608052604051611ddf908161009d8239608051818181610449015281816106db015281816108520152610aa70152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f3560e01c908163062caa2e14610eae5750806334d028b214610e915780633be47cf114610a515780634aa44a9e14610a2f5780634bb278f3146108315780634fee13fc146106c1578063604fc95c146106865780636606d4c8146106695780636fbc38771461064c57806377d8f0a61461062f5780637d7e5ef21461060957806388b701b2146104785780638da5cb5b1461043457806397841b80146101d7578063985e704b146101ba578063b3f05b9714610198578063c7726bdf1461017b578063d4f18e191461015e578063d6d6c41514610141578063ee2679bc146101245763fddf0fc014610103575f80fd5b34610120575f366003190112610120576020600954604051908152f35b5f80fd5b34610120575f366003190112610120576020600b54604051908152f35b34610120575f366003190112610120576020600f54604051908152f35b34610120575f366003190112610120576020600c54604051908152f35b34610120575f366003190112610120576020600454604051908152f35b34610120575f36600319011261012057602060ff600654166040519015158152f35b34610120575f366003190112610120576020601054604051908152f35b34610120576020366003190112610120576004356001600160401b03811161012057610207903690600401610f3f565b61021660ff6006541615611117565b6102255f8080806002546112db565b5090911590506103fd575f91825b8151841015610365576102468483610fd9565b51519360206102558285610fd9565b510151848612156103225761027590865f52600160205260405f2061101c565b5080546001600160a01b031633036102f057600101805480156102b7576102a4816001955f6102ad9555611091565b96600254611b26565b6002550192610233565b60405162461bcd60e51b815260206004820152601160248201527030b63932b0b23c903bb4ba34323930bbb760791b6044820152606490fd5b60405162461bcd60e51b815260206004820152600a6024820152693737ba103134b23232b960b11b6044820152606490fd5b60405162461bcd60e51b815260206004820152601b60248201527a18d85b9b9bdd081dda5d1a191c985dc8189a5b991a5b99c8189a59602a1b6044820152606490fd5b5f80808084335af16103756110dd565b50156103c6577f9b473f4c4661ba8fd1835f2e37be18e79da8a58688eca262b53ff97a561c1522916103bb9160405192839233845260606020850152606084019061109e565b9060408301520390a1005b60405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600f60248201526e1b9bc818db19585c9a5b99c81e595d608a1b6044820152606490fd5b34610120575f366003190112610120576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b602036600319011261012057600435600b5480156105d65760ff600654166105a55762093a8081018091116105915742101561055c57600c5434106105275760607f99f739e348683f5e26b074d975994b3e724f052365a5f9a2e7e34fd81e47ade1916207ffff198112158061051a575b6104f290611157565b61050260025434908333916116fd565b600255604051903382526020820152346040820152a1005b50620800008113156104e9565b60405162461bcd60e51b815260206004820152600d60248201526c189a59081d1bdbc81cdb585b1b609a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c185d58dd1a5bdb88195b991959609a1b6044820152606490fd5b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b8152602060048201526009602482015268199a5b985b1a5e995960ba1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600b60248201526a1b9bdd081cdd185c9d195960aa1b6044820152606490fd5b34610120576020366003190112610120576020610627600435611198565b604051908152f35b34610120575f366003190112610120576020600a54604051908152f35b34610120575f366003190112610120576020600e54604051908152f35b34610120575f366003190112610120576020600554604051908152f35b34610120575f3660031901126101205760806106a75f8080806002546112db565b916040519315158452602084015260408301526060820152f35b3461012057604036600319011261012057600435602435337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316036107f557600b546107be57811515806107b5575b15610781577f44c53be110c6aa83aa83cd02e351ed172359268272ee1b5d31c0fe48db35c6c791816060926004558160055542600b556001620186a0830480600c5510610777575b600c549060405192835260208301526040820152a1005b6001600c55610760565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206361707360a01b6044820152606490fd5b50801515610718565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610120575f3660031901126101205761085060ff6006541615611117565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316338190036109f0576108915f8080806002546112db565b909391600160ff19600654161760065560075560085582600955815f1461097257670de0b6b3a76400006108cf6108c9600754611198565b85611074565b04600a555f8080808680955b5af16108e56110dd565b5015610936577f97e47dd2a0543af4ea794e9f54623786da8e3b8584a3c15dbcfe8ec103176b699260a092600754600a549160405194855215156020850152604084015260608301526080820152a1005b60405162461bcd60e51b81526020600482015260146024820152732330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b600d805460ff19166001179055600454806109a157505f19600f555f6010555f600a555f8080808080956108db565b6109b5906109b0600954611050565b611087565b600f555f600e556109cb600254600f5490611258565b6010819055156109ea576004545b600a555f80808060105480956108db565b5f6109d9565b60405162461bcd60e51b81526020600482015260176024820152764f6e6c79206f776e65722063616e2066696e616c697a6560481b6044820152606490fd5b34610120575f36600319011261012057602060ff600d54166040519015158152f35b34610120576040366003190112610120576004356001600160a01b03811690819003610120576024356001600160401b03811161012057610a96903690600401610f3f565b5f915f9060ff6006541615610e5c577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610e2157610ae0600754611198565b915f945b8451861015610d6657610af78686610fd9565b515195610b1d6020610b098389610fd9565b510151885f52600160205260405f2061101c565b5080546001600160a01b0316859003610d315760018101978854918215610cfa57600d5460ff1615610bce5750610b5390611198565b600f541015610bb957610b6c610b7591600a5490611074565b600e5490611091565b60105490610b838282611087565b8215610ba5576001945f93610b9b9306600e55611091565b975b550194610ae4565b634e487b7160e01b5f52601260045260245ffd5b610bc85f916001949995611091565b93610b9d565b600754949994909181811215610bef57505050610bc85f9160019495611091565b9394931315610c49575085610c0a575b50905f600192610b9d565b919096670de0b6b3a76400008302928304670de0b6b3a76400000361059157610c405f91610c3a88600196611087565b90611091565b97919250610bff565b60020154919391610c5a8282611043565b60085491818311610cdd575050505f905b808211610cd5575b86610c8b575b60019392610c3a5f93610bc893611043565b979291670de0b6b3a7640000820290828204670de0b6b3a7640000148315171561059157610c3a5f93610cc7600197610c3a8c610bc897611087565b9b9350935050929350610c79565b905080610c73565b8210610ceb57505080610c6b565b610cf491611043565b90610c6b565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e4818db185a5b5959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd081d1a195a5c88189a59609a1b6044820152606490fd5b827e428a2600e557fb4fb2ea7b934d2608af79e533f6936f7d097107613f3ee4f9610da58760405191829185835260806020840152608083019061109e565b8560408301528660608301520390a182610dca575b5060409182519182526020820152f35b5f80808581945af1610dda6110dd565b5015610de65782610dba565b60405162461bcd60e51b8152602060048201526013602482015272195d1a081d1c985b9cd9995c8819985a5b1959606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152601360248201527213db9b1e481bdddb995c8818d85b8818d85b1b606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd08199a5b985b1a5e9959609a1b6044820152606490fd5b34610120575f366003190112610120576020600754604051908152f35b34610120575f366003190112610120576020906008548152f35b6040519060c082016001600160401b03811183821017610ee757604052565b634e487b7160e01b5f52604160045260245ffd5b60405190606082016001600160401b03811183821017610ee757604052565b6040519190601f01601f191682016001600160401b03811183821017610ee757604052565b81601f82011215610120578035906001600160401b038211610ee757610f6a60208360051b01610f1a565b9260208085858152019360061b8301019181831161012057602001925b828410610f95575050505090565b604084830312610120576040805191908201906001600160401b03821183831017610ee7576040926020928452863581528287013583820152815201930192610f87565b8051821015610fed5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b5f52600160205260405f2090565b5f525f60205260405f2090565b8054821015610fed575f52600360205f20910201905f90565b5f1981019190821161059157565b9190820391821161059157565b90670de0b6b3a7640000820291808304670de0b6b3a7640000149015171561059157565b8181029291811591840414171561059157565b8115610ba5570490565b9190820180921161059157565b90602080835192838152019201905f5b8181106110bb5750505090565b82518051855260209081015181860152604090940193909201916001016110ae565b3d15611112573d906001600160401b038211610ee757611106601f8301601f1916602001610f1a565b9182523d5f602084013e565b606090565b1561111e57565b60405162461bcd60e51b8152602060048201526011602482015270185b1c9958591e48199a5b985b1a5e9959607a1b6044820152606490fd5b1561115e57565b60405162461bcd60e51b81526020600482015260126024820152717469636b206f7574206f6620626f756e647360701b6044820152606490fd5b906207ffff198212158061124b575b6111b090611157565b5f821291821561124657600160ff1b8114610591575f035b670de0b6b3a7640000925f5b60ff81166014811015611222576001901b83166111f7575b60010160ff166111d4565b936001670de0b6b3a764000061121860ff9361121289611494565b90611074565b04959150506111ec565b5050905061122c57565b908015610ba5576a0c097ce7bc90715b34b9f160241b0490565b6111c8565b50620800008213156111a7565b80156112d5575f525f60205260405f2090806112748354611198565b11611289576004611286920154611258565b90565b6001820154906004830154806112b2575b5060036112a992930154611258565b61128691611091565b6112ce6112a99360026112c660039461100f565b015490611091565b925061129a565b50505f90565b949390948015611486576112ee9061100f565b600481015490919080156114805760026113078261100f565b01545b611451575b5081549561131c87611198565b936001840154958515611449575b82611422575b6005549384841015611410575050506113498183611043565b808611611408575b5061135c8582611091565b9361137861136a8287611074565b670de0b6b3a7640000900490565b600454809110156113af575050508210156113a5579381600361139d959601546112db565b929391929091565b5091600193929190565b9092506109b09194506113c29350611050565b915f928281116113f4575b508083116113ea575b50816113e191611091565b91600193929190565b91506113e16113d6565b6114019193508290611043565b915f6113cd565b94505f611351565b96509694509650505050600193929190565b61142f61136a8785611074565b600454101561133057969450965050925050600193929190565b5f965061132a565b928194919296611460946112db565b909280969296611476575050819491925f61130f565b9594929350919050565b5f61130a565b5050929190505f9291905f90565b60ff168015611677576001811461166a576002811461165d5760038114611650576004811461164357600581146116365760068114611629576007811461161c576008811461160f576009811461160257600a81146115f557600b81146115e857600c81146115db57600d81146115ce57600e81146115c157600f81146115b357601081146115a5576011811461159657601281146115845760131461156f5760405162461bcd60e51b8152602060048201526013602482015272496e646578206f7574206f6620626f756e647360681b6044820152606490fd5b70ac68c7d696d2a7feb69b86a3f86612aa6390565b506c030ea31ae5857ddf43f23b6a3590565b50696837a9452e9c20fccb9390565b50682607c4dade2ffff8d990565b5068016f930b8c7a7a908890565b5067476c1029a11c44ae90565b50671f7ba7b82f6c9c5a90565b506714e70aabdb4a06fc90565b5067110820d9bfe975a290565b50670f5fc52fb491650d90565b50670e9b5714c33819c490565b50670e3cd527937106bf90565b50670e0e7a781961e75990565b50670df785d75ac05be090565b50670dec1999b5903ebe90565b50670de666fc35fe931b90565b50670de38e8d5fd9895890565b50670de2228de1d1616490565b50670de16c9c1c64640090565b50670de111a6b7de400090565b5f1981146105915760010190565b8054600160401b811015610ee7576116af9160018201815561101c565b9190916116ea57805182546001600160a01b0319166001600160a01b0391909116178255602081015160018301556040015160029190910155565b634e487b7160e01b5f525f60045260245ffd5b91909282156117f05761170f8361100f565b80548581036117be575090611286946001611775949301611731838254611091565b905561173c81611001565b546117835761174b8291611001565b91611766611757610efb565b6001600160a01b039095168552565b60208401526040830152611692565b61177e816118ac565b611959565b61174b6117b88360026117b061179886611001565b6117aa6117a488611001565b54611035565b9061101c565b500154611091565b91611001565b9092908512156117e15760036117d793019485546116fd565b6112869255611775565b60046117d793019485546116fd565b61128692506118816003549461180d61180887611684565b600355565b61187c611818610ec8565b8281528460208201528460408201525f60608201525f6080820152600160a08201526118438861100f565b9060a060059180518455602081015160018501556040810151600285015560608101516003850155608081015160048501550151910155565b611001565b9061189c61188d610efb565b6001600160a01b039094168452565b8060208401526040830152611692565b5f525f60205260405f205f5f905f915f90600385015480611938575b50600485015480611914575b506118e76118ec92936001870154611091565b611091565b60028401558082111561190d57505b60010190816001116105915760050155565b90506118fb565b5f9081526020819052604090206002810154600590910154925090506118e76118d4565b5f9081526020819052604081206002810154600590910154955093506118c8565b805f525f602052611970600360405f200154611bb8565b815f525f602052611987600460405f200154611bb8565b905f82820392128183128116918313901516176105915760018113611a2f575f19136119b05790565b80611286915f525f602052600460405f2001545f525f6020526119d9600460405f200154611bb8565b815f525f602052600460405f2001545f525f6020526119fe600360405f200154611bb8565b1115611bd357805f525f602052611a1b600460405f200154611c10565b815f525f602052600460405f200155611bd3565b5080611286915f525f602052600360405f2001545f525f602052611a59600360405f200154611bb8565b815f525f602052600360405f2001545f525f602052611a7e600460405f200154611bb8565b1115611c1057805f525f602052611a9b600360405f200154611bd3565b815f525f602052600360405f200155611c10565b15611ab657565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206e6f646560a01b6044820152606490fd5b15611af157565b60405162461bcd60e51b815260206004820152600d60248201526c65746820756e646572666c6f7760981b6044820152606490fd5b9091611b33821515611aaf565b611b3c8261100f565b805480851215611b655750906003611b579201938454611b26565b611286925561177e816118ac565b841315611b7c579060046117d79201938454611b26565b6001611b9a9194939401918254611b9582821015611aea565b611043565b815554611baa5761128691611c81565b508061177e611286926118ac565b80611bc257505f90565b5f525f602052600560405f20015490565b5f818152602081905260408082206004018054808452918320600301805490859055928490529190915590611c07906118ac565b611286816118ac565b5f818152602081905260408082206003018054808452918320600401805490859055928490529190915590611c07906118ac565b15611c4b57565b60405162461bcd60e51b815260206004820152600e60248201526d64656c657465206d697373696e6760901b6044820152606490fd5b611c8c811515611c44565b611c958161100f565b805480841215611caf57506003611b579101928354611c81565b831315611cc55760046117d79101928354611c81565b9150600382019182541580611d75575b611d6257825415611d4f576004810192835415611d1b57506117d790611d03611cfe8554611d81565b61100f565b90815481556001808301549101558354905490611c81565b54925061128691611d2c915061100f565b60055f918281558260018201558260028201558260038201558260048201550155565b60040154915061128690611d2c9061100f565b50611d719150611d2c9061100f565b5f90565b50600481015415611cd5565b5b805f525f602052600360405f20015415611286575f525f602052600360405f200154611d8256fea2646970667358221220c0d65f3db561f0628972e7988b381d3ec7a5d64f7566c1462239d511859b2f2c64736f6c63430008210033a2646970667358221220a6bd16cd68e0b9413cf284311e0cb86d6f045095b9c9ce4f90ed6a5d93c2373064736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60808060405260043610156011575f80fd5b5f3560e01c6303f72d3b146023575f80fd5b3460ac57604036600319011260ac576004356001600160a01b038116919082900360ac57611e7c81810192906001600160401b038411838510176098576100b183398252602081602435930301905ff58015608d576040516001600160a01b039091168152602090f35b6040513d5f823e3d90fd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe60a03461008457601f611e7c38819003918201601f19168301916001600160401b038311848410176100885780849260209460405283398101031261008457516001600160a01b0381168103610084576001600355608052604051611ddf908161009d8239608051818181610449015281816106db015281816108520152610aa70152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f3560e01c908163062caa2e14610eae5750806334d028b214610e915780633be47cf114610a515780634aa44a9e14610a2f5780634bb278f3146108315780634fee13fc146106c1578063604fc95c146106865780636606d4c8146106695780636fbc38771461064c57806377d8f0a61461062f5780637d7e5ef21461060957806388b701b2146104785780638da5cb5b1461043457806397841b80146101d7578063985e704b146101ba578063b3f05b9714610198578063c7726bdf1461017b578063d4f18e191461015e578063d6d6c41514610141578063ee2679bc146101245763fddf0fc014610103575f80fd5b34610120575f366003190112610120576020600954604051908152f35b5f80fd5b34610120575f366003190112610120576020600b54604051908152f35b34610120575f366003190112610120576020600f54604051908152f35b34610120575f366003190112610120576020600c54604051908152f35b34610120575f366003190112610120576020600454604051908152f35b34610120575f36600319011261012057602060ff600654166040519015158152f35b34610120575f366003190112610120576020601054604051908152f35b34610120576020366003190112610120576004356001600160401b03811161012057610207903690600401610f3f565b61021660ff6006541615611117565b6102255f8080806002546112db565b5090911590506103fd575f91825b8151841015610365576102468483610fd9565b51519360206102558285610fd9565b510151848612156103225761027590865f52600160205260405f2061101c565b5080546001600160a01b031633036102f057600101805480156102b7576102a4816001955f6102ad9555611091565b96600254611b26565b6002550192610233565b60405162461bcd60e51b815260206004820152601160248201527030b63932b0b23c903bb4ba34323930bbb760791b6044820152606490fd5b60405162461bcd60e51b815260206004820152600a6024820152693737ba103134b23232b960b11b6044820152606490fd5b60405162461bcd60e51b815260206004820152601b60248201527a18d85b9b9bdd081dda5d1a191c985dc8189a5b991a5b99c8189a59602a1b6044820152606490fd5b5f80808084335af16103756110dd565b50156103c6577f9b473f4c4661ba8fd1835f2e37be18e79da8a58688eca262b53ff97a561c1522916103bb9160405192839233845260606020850152606084019061109e565b9060408301520390a1005b60405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600f60248201526e1b9bc818db19585c9a5b99c81e595d608a1b6044820152606490fd5b34610120575f366003190112610120576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b602036600319011261012057600435600b5480156105d65760ff600654166105a55762093a8081018091116105915742101561055c57600c5434106105275760607f99f739e348683f5e26b074d975994b3e724f052365a5f9a2e7e34fd81e47ade1916207ffff198112158061051a575b6104f290611157565b61050260025434908333916116fd565b600255604051903382526020820152346040820152a1005b50620800008113156104e9565b60405162461bcd60e51b815260206004820152600d60248201526c189a59081d1bdbc81cdb585b1b609a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c185d58dd1a5bdb88195b991959609a1b6044820152606490fd5b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b8152602060048201526009602482015268199a5b985b1a5e995960ba1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600b60248201526a1b9bdd081cdd185c9d195960aa1b6044820152606490fd5b34610120576020366003190112610120576020610627600435611198565b604051908152f35b34610120575f366003190112610120576020600a54604051908152f35b34610120575f366003190112610120576020600e54604051908152f35b34610120575f366003190112610120576020600554604051908152f35b34610120575f3660031901126101205760806106a75f8080806002546112db565b916040519315158452602084015260408301526060820152f35b3461012057604036600319011261012057600435602435337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316036107f557600b546107be57811515806107b5575b15610781577f44c53be110c6aa83aa83cd02e351ed172359268272ee1b5d31c0fe48db35c6c791816060926004558160055542600b556001620186a0830480600c5510610777575b600c549060405192835260208301526040820152a1005b6001600c55610760565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206361707360a01b6044820152606490fd5b50801515610718565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481cdd185c9d1959608a1b6044820152606490fd5b60405162461bcd60e51b81526020600482015260146024820152731bdb9b1e481bdddb995c8818d85b881cdd185c9d60621b6044820152606490fd5b34610120575f3660031901126101205761085060ff6006541615611117565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316338190036109f0576108915f8080806002546112db565b909391600160ff19600654161760065560075560085582600955815f1461097257670de0b6b3a76400006108cf6108c9600754611198565b85611074565b04600a555f8080808680955b5af16108e56110dd565b5015610936577f97e47dd2a0543af4ea794e9f54623786da8e3b8584a3c15dbcfe8ec103176b699260a092600754600a549160405194855215156020850152604084015260608301526080820152a1005b60405162461bcd60e51b81526020600482015260146024820152732330b4b632b2103a379039b2b7321022ba3432b960611b6044820152606490fd5b600d805460ff19166001179055600454806109a157505f19600f555f6010555f600a555f8080808080956108db565b6109b5906109b0600954611050565b611087565b600f555f600e556109cb600254600f5490611258565b6010819055156109ea576004545b600a555f80808060105480956108db565b5f6109d9565b60405162461bcd60e51b81526020600482015260176024820152764f6e6c79206f776e65722063616e2066696e616c697a6560481b6044820152606490fd5b34610120575f36600319011261012057602060ff600d54166040519015158152f35b34610120576040366003190112610120576004356001600160a01b03811690819003610120576024356001600160401b03811161012057610a96903690600401610f3f565b5f915f9060ff6006541615610e5c577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610e2157610ae0600754611198565b915f945b8451861015610d6657610af78686610fd9565b515195610b1d6020610b098389610fd9565b510151885f52600160205260405f2061101c565b5080546001600160a01b0316859003610d315760018101978854918215610cfa57600d5460ff1615610bce5750610b5390611198565b600f541015610bb957610b6c610b7591600a5490611074565b600e5490611091565b60105490610b838282611087565b8215610ba5576001945f93610b9b9306600e55611091565b975b550194610ae4565b634e487b7160e01b5f52601260045260245ffd5b610bc85f916001949995611091565b93610b9d565b600754949994909181811215610bef57505050610bc85f9160019495611091565b9394931315610c49575085610c0a575b50905f600192610b9d565b919096670de0b6b3a76400008302928304670de0b6b3a76400000361059157610c405f91610c3a88600196611087565b90611091565b97919250610bff565b60020154919391610c5a8282611043565b60085491818311610cdd575050505f905b808211610cd5575b86610c8b575b60019392610c3a5f93610bc893611043565b979291670de0b6b3a7640000820290828204670de0b6b3a7640000148315171561059157610c3a5f93610cc7600197610c3a8c610bc897611087565b9b9350935050929350610c79565b905080610c73565b8210610ceb57505080610c6b565b610cf491611043565b90610c6b565b60405162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e4818db185a5b5959608a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd081d1a195a5c88189a59609a1b6044820152606490fd5b827e428a2600e557fb4fb2ea7b934d2608af79e533f6936f7d097107613f3ee4f9610da58760405191829185835260806020840152608083019061109e565b8560408301528660608301520390a182610dca575b5060409182519182526020820152f35b5f80808581945af1610dda6110dd565b5015610de65782610dba565b60405162461bcd60e51b8152602060048201526013602482015272195d1a081d1c985b9cd9995c8819985a5b1959606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152601360248201527213db9b1e481bdddb995c8818d85b8818d85b1b606a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c1b9bdd08199a5b985b1a5e9959609a1b6044820152606490fd5b34610120575f366003190112610120576020600754604051908152f35b34610120575f366003190112610120576020906008548152f35b6040519060c082016001600160401b03811183821017610ee757604052565b634e487b7160e01b5f52604160045260245ffd5b60405190606082016001600160401b03811183821017610ee757604052565b6040519190601f01601f191682016001600160401b03811183821017610ee757604052565b81601f82011215610120578035906001600160401b038211610ee757610f6a60208360051b01610f1a565b9260208085858152019360061b8301019181831161012057602001925b828410610f95575050505090565b604084830312610120576040805191908201906001600160401b03821183831017610ee7576040926020928452863581528287013583820152815201930192610f87565b8051821015610fed5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b5f52600160205260405f2090565b5f525f60205260405f2090565b8054821015610fed575f52600360205f20910201905f90565b5f1981019190821161059157565b9190820391821161059157565b90670de0b6b3a7640000820291808304670de0b6b3a7640000149015171561059157565b8181029291811591840414171561059157565b8115610ba5570490565b9190820180921161059157565b90602080835192838152019201905f5b8181106110bb5750505090565b82518051855260209081015181860152604090940193909201916001016110ae565b3d15611112573d906001600160401b038211610ee757611106601f8301601f1916602001610f1a565b9182523d5f602084013e565b606090565b1561111e57565b60405162461bcd60e51b8152602060048201526011602482015270185b1c9958591e48199a5b985b1a5e9959607a1b6044820152606490fd5b1561115e57565b60405162461bcd60e51b81526020600482015260126024820152717469636b206f7574206f6620626f756e647360701b6044820152606490fd5b906207ffff198212158061124b575b6111b090611157565b5f821291821561124657600160ff1b8114610591575f035b670de0b6b3a7640000925f5b60ff81166014811015611222576001901b83166111f7575b60010160ff166111d4565b936001670de0b6b3a764000061121860ff9361121289611494565b90611074565b04959150506111ec565b5050905061122c57565b908015610ba5576a0c097ce7bc90715b34b9f160241b0490565b6111c8565b50620800008213156111a7565b80156112d5575f525f60205260405f2090806112748354611198565b11611289576004611286920154611258565b90565b6001820154906004830154806112b2575b5060036112a992930154611258565b61128691611091565b6112ce6112a99360026112c660039461100f565b015490611091565b925061129a565b50505f90565b949390948015611486576112ee9061100f565b600481015490919080156114805760026113078261100f565b01545b611451575b5081549561131c87611198565b936001840154958515611449575b82611422575b6005549384841015611410575050506113498183611043565b808611611408575b5061135c8582611091565b9361137861136a8287611074565b670de0b6b3a7640000900490565b600454809110156113af575050508210156113a5579381600361139d959601546112db565b929391929091565b5091600193929190565b9092506109b09194506113c29350611050565b915f928281116113f4575b508083116113ea575b50816113e191611091565b91600193929190565b91506113e16113d6565b6114019193508290611043565b915f6113cd565b94505f611351565b96509694509650505050600193929190565b61142f61136a8785611074565b600454101561133057969450965050925050600193929190565b5f965061132a565b928194919296611460946112db565b909280969296611476575050819491925f61130f565b9594929350919050565b5f61130a565b5050929190505f9291905f90565b60ff168015611677576001811461166a576002811461165d5760038114611650576004811461164357600581146116365760068114611629576007811461161c576008811461160f576009811461160257600a81146115f557600b81146115e857600c81146115db57600d81146115ce57600e81146115c157600f81146115b357601081146115a5576011811461159657601281146115845760131461156f5760405162461bcd60e51b8152602060048201526013602482015272496e646578206f7574206f6620626f756e647360681b6044820152606490fd5b70ac68c7d696d2a7feb69b86a3f86612aa6390565b506c030ea31ae5857ddf43f23b6a3590565b50696837a9452e9c20fccb9390565b50682607c4dade2ffff8d990565b5068016f930b8c7a7a908890565b5067476c1029a11c44ae90565b50671f7ba7b82f6c9c5a90565b506714e70aabdb4a06fc90565b5067110820d9bfe975a290565b50670f5fc52fb491650d90565b50670e9b5714c33819c490565b50670e3cd527937106bf90565b50670e0e7a781961e75990565b50670df785d75ac05be090565b50670dec1999b5903ebe90565b50670de666fc35fe931b90565b50670de38e8d5fd9895890565b50670de2228de1d1616490565b50670de16c9c1c64640090565b50670de111a6b7de400090565b5f1981146105915760010190565b8054600160401b811015610ee7576116af9160018201815561101c565b9190916116ea57805182546001600160a01b0319166001600160a01b0391909116178255602081015160018301556040015160029190910155565b634e487b7160e01b5f525f60045260245ffd5b91909282156117f05761170f8361100f565b80548581036117be575090611286946001611775949301611731838254611091565b905561173c81611001565b546117835761174b8291611001565b91611766611757610efb565b6001600160a01b039095168552565b60208401526040830152611692565b61177e816118ac565b611959565b61174b6117b88360026117b061179886611001565b6117aa6117a488611001565b54611035565b9061101c565b500154611091565b91611001565b9092908512156117e15760036117d793019485546116fd565b6112869255611775565b60046117d793019485546116fd565b61128692506118816003549461180d61180887611684565b600355565b61187c611818610ec8565b8281528460208201528460408201525f60608201525f6080820152600160a08201526118438861100f565b9060a060059180518455602081015160018501556040810151600285015560608101516003850155608081015160048501550151910155565b611001565b9061189c61188d610efb565b6001600160a01b039094168452565b8060208401526040830152611692565b5f525f60205260405f205f5f905f915f90600385015480611938575b50600485015480611914575b506118e76118ec92936001870154611091565b611091565b60028401558082111561190d57505b60010190816001116105915760050155565b90506118fb565b5f9081526020819052604090206002810154600590910154925090506118e76118d4565b5f9081526020819052604081206002810154600590910154955093506118c8565b805f525f602052611970600360405f200154611bb8565b815f525f602052611987600460405f200154611bb8565b905f82820392128183128116918313901516176105915760018113611a2f575f19136119b05790565b80611286915f525f602052600460405f2001545f525f6020526119d9600460405f200154611bb8565b815f525f602052600460405f2001545f525f6020526119fe600360405f200154611bb8565b1115611bd357805f525f602052611a1b600460405f200154611c10565b815f525f602052600460405f200155611bd3565b5080611286915f525f602052600360405f2001545f525f602052611a59600360405f200154611bb8565b815f525f602052600360405f2001545f525f602052611a7e600460405f200154611bb8565b1115611c1057805f525f602052611a9b600360405f200154611bd3565b815f525f602052600360405f200155611c10565b15611ab657565b60405162461bcd60e51b815260206004820152600c60248201526b696e76616c6964206e6f646560a01b6044820152606490fd5b15611af157565b60405162461bcd60e51b815260206004820152600d60248201526c65746820756e646572666c6f7760981b6044820152606490fd5b9091611b33821515611aaf565b611b3c8261100f565b805480851215611b655750906003611b579201938454611b26565b611286925561177e816118ac565b841315611b7c579060046117d79201938454611b26565b6001611b9a9194939401918254611b9582821015611aea565b611043565b815554611baa5761128691611c81565b508061177e611286926118ac565b80611bc257505f90565b5f525f602052600560405f20015490565b5f818152602081905260408082206004018054808452918320600301805490859055928490529190915590611c07906118ac565b611286816118ac565b5f818152602081905260408082206003018054808452918320600401805490859055928490529190915590611c07906118ac565b15611c4b57565b60405162461bcd60e51b815260206004820152600e60248201526d64656c657465206d697373696e6760901b6044820152606490fd5b611c8c811515611c44565b611c958161100f565b805480841215611caf57506003611b579101928354611c81565b831315611cc55760046117d79101928354611c81565b9150600382019182541580611d75575b611d6257825415611d4f576004810192835415611d1b57506117d790611d03611cfe8554611d81565b61100f565b90815481556001808301549101558354905490611c81565b54925061128691611d2c915061100f565b60055f918281558260018201558260028201558260038201558260048201550155565b60040154915061128690611d2c9061100f565b50611d719150611d2c9061100f565b5f90565b50600481015415611cd5565b5b805f525f602052600360405f20015415611286575f525f602052600360405f200154611d8256fea2646970667358221220c0d65f3db561f0628972e7988b381d3ec7a5d64f7566c1462239d511859b2f2c64736f6c63430008210033a2646970667358221220a6bd16cd68e0b9413cf284311e0cb86d6f045095b9c9ce4f90ed6a5d93c2373064736f6c63430008210033'
		}
	}
}
export declare const peripherals_interfaces_IAugur_IAugur: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'CompleteSetsPurchased'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'numCompleteSets'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'CompleteSetsSold'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'numCompleteSets'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'fees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DesignatedReportStakeChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'designatedReportStake'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DisputeCrowdsourcerCompleted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'nextWindowStartTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'nextWindowEndTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'pacingOn'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'totalRepStakedInPayout'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'totalRepStakedInMarket'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'disputeRound'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DisputeCrowdsourcerContribution'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'reporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amountStaked'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'description'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'currentStake'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'stakeRemaining'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'disputeRound'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DisputeCrowdsourcerCreated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'size'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'disputeRound'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DisputeCrowdsourcerRedeemed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'reporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amountRedeemed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'repReceived'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'DisputeWindowCreated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'disputeWindow'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'startTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'initial'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'FinishDeployment'
			readonly anonymous: false
			readonly inputs: readonly []
		},
		{
			readonly type: 'event'
			readonly name: 'InitialReportSubmitted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'reporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'initialReporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amountStaked'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'isDesignatedReporter'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'description'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
				{
					readonly name: 'nextWindowStartTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'nextWindowEndTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'InitialReporterRedeemed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'reporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'initialReporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amountRedeemed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'repReceived'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'InitialReporterTransferred'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketCreated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'extraInfo'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'marketCreator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'designatedReporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'feePerCashInAttoCash'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'prices'
					readonly type: 'int256[]'
					readonly internalType: 'int256[]'
					readonly indexed: false
				},
				{
					readonly name: 'marketType'
					readonly type: 'uint8'
					readonly internalType: 'enum MarketType'
					readonly indexed: false
				},
				{
					readonly name: 'numTicks'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'outcomes'
					readonly type: 'bytes32[]'
					readonly internalType: 'bytes32[]'
					readonly indexed: false
				},
				{
					readonly name: 'noShowBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketFinalized'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'winningPayoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketMigrated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'originalUniverse'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'newUniverse'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketOIChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'marketOI'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketParticipantsDisavowed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketRepBondTransferred'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'MarketTransferred'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'NoShowBondChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'noShowBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ParticipationTokensRedeemed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'disputeWindow'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'attoParticipationTokens'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'feePayoutShare'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'RegisterContract'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'contractAddress'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'key'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ReportingFeeChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'reportingFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ReportingParticipantDisavowed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'reportingParticipant'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ShareTokenBalanceChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TimestampSet'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'newTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TokenBalanceChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tokenType'
					readonly type: 'uint8'
					readonly internalType: 'enum TokenType'
					readonly indexed: false
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TokensBurned'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'target'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'tokenType'
					readonly type: 'uint8'
					readonly internalType: 'enum TokenType'
					readonly indexed: false
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TokensMinted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'target'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'tokenType'
					readonly type: 'uint8'
					readonly internalType: 'enum TokenType'
					readonly indexed: false
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TokensTransferred'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'tokenType'
					readonly type: 'uint8'
					readonly internalType: 'enum TokenType'
					readonly indexed: false
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TradingProceedsClaimed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'sender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'question'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'outcome'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'numShares'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'numPayoutTokens'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'fees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'UniverseCreated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'parentUniverse'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'childUniverse'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'creationTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'UniverseForked'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'forkingMarket'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ValidityBondChanged'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'validityBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'WarpSyncDataUpdated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'warpSyncHash'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'marketEndTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'createChildUniverse'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_parentPayoutDistributionHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
				{
					readonly name: '_parentPayoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'derivePayoutDistributionHash'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: '_numTicks'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'numOutcomes'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'disputeCrowdsourcerCreated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: '_size'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_disputeRound'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getMaximumMarketEndDate'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getTimestamp'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getUniverseForkIndex'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isKnownFeeSender'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_feeSender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isKnownMarket'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isKnownUniverse'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isTrustedSender'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_address'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logCompleteSetsPurchased'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_numCompleteSets'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logCompleteSetsSold'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_numCompleteSets'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_fees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDesignatedReportStakeChanged'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_designatedReportStake'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeCrowdsourcerCompleted'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: '_nextWindowStartTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_nextWindowEndTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_pacingOn'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: '_totalRepStakedInPayout'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalRepStakedInMarket'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_disputeRound'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeCrowdsourcerContribution'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_reporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_disputeCrowdsourcer'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amountStaked'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'description'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: '_currentStake'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_stakeRemaining'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_disputeRound'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeCrowdsourcerRedeemed'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_reporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amountRedeemed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_repReceived'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeCrowdsourcerTokensBurned'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_target'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeCrowdsourcerTokensMinted'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_target'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeCrowdsourcerTokensTransferred'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_fromBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_toBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logDisputeWindowCreated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_disputeWindow'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_initial'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logInitialReportSubmitted'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_reporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_initialReporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amountStaked'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_isDesignatedReporter'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: '_description'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: '_nextWindowStartTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_nextWindowEndTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logInitialReporterRedeemed'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_reporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amountRedeemed'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_repReceived'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_payoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logInitialReporterTransferred'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logMarketFinalized'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_winningPayoutNumerators'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logMarketMigrated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_originalUniverse'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logMarketOIChanged'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logMarketParticipantsDisavowed'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logMarketRepBondTransferred'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logMarketTransferred'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logNoShowBondChanged'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_noShowBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logParticipationTokensBurned'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_target'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logParticipationTokensMinted'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_target'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logParticipationTokensRedeemed'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_attoParticipationTokens'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_feePayoutShare'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logParticipationTokensTransferred'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_fromBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_toBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logReportingFeeChanged'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_reportingFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logReportingParticipantDisavowed'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logReputationTokensBurned'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_target'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logReputationTokensMinted'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_target'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_totalSupply'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logReputationTokensTransferred'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_fromBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_toBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logShareTokensBalanceChanged'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logTimestampSet'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_newTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logTradingProceedsClaimed'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_sender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_numShares'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_numPayoutTokens'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_fees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logUniverseForked'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_forkingMarket'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logValidityBondChanged'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_validityBond'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'logWarpSyncDataUpdated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_warpSyncHash'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_marketEndTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'lookup'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_key'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'onCategoricalMarketCreated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_extraInfo'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_marketCreator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_designatedReporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_feePerCashInAttoCash'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_outcomes'
					readonly type: 'bytes32[]'
					readonly internalType: 'bytes32[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'onScalarMarketCreated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_extraInfo'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_marketCreator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_designatedReporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_feePerCashInAttoCash'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_prices'
					readonly type: 'int256[]'
					readonly internalType: 'int256[]'
				},
				{
					readonly name: '_numTicks'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'onYesNoMarketCreated'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_endTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_extraInfo'
					readonly type: 'string'
					readonly internalType: 'string'
				},
				{
					readonly name: '_market'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_marketCreator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_designatedReporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_feePerCashInAttoCash'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'trustedCashTransfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_IERC1155_IERC1155: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'ApprovalForAll'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'approved'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TransferBatch'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'values'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TransferSingle'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'URI'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'value'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfBatch'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owners'
					readonly type: 'address[]'
					readonly internalType: 'address[]'
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'balances_'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isApprovedForAll'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'safeBatchTransferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: 'values'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'safeTransferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setApprovalForAll'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'approved'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_ISecurityPool_ISecurityPool: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'activateForkMode'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'authorizeChildPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'pool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'cashToShares'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'eth'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'completeSetCollateralAmount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'configureVault'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'vaultFeeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'createCompleteSet'
			readonly stateMutability: 'payable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'currentRetentionRate'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'depositRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'drainAllRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'escalationGame'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract EscalationGame'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'feeIndex'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getVaultCount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getVaults'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'count'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'vaults'
					readonly type: 'address[]'
					readonly internalType: 'address[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'lastUpdatedFeeAccumulator'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'openOracle'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract OpenOracle'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'parent'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'performLiquidation'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'callerVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'targetVaultAddress'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'debtAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTargetOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTargetAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotTotalRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'snapshotDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'performSetSecurityBondsAllowance'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'callerVault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'performWithdrawRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'poolOwnershipDenominator'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'poolOwnershipToRep'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'priceOracleManagerAndOperatorQueuer'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionData'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ZoltarQuestionData'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'questionId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'redeemCompleteSet'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'redeemFees'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'redeemRep'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'repToPoolOwnership'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'repAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'repToken'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ReputationToken'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityMultiplier'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolFactory'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPoolFactory'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolForker'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityVaults'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'poolOwnership'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'unpaidEthFees'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'feeIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'lockedRepInEscalationGame'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'setOwnershipDenominator'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newDenominator'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setPoolFinancials'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newCollateral'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'newTotalBondAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setStartingParams'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'repEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setSystemState'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newState'
					readonly type: 'uint8'
					readonly internalType: 'enum SystemState'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setTotalShares'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'newTotalShares'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'shareToken'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract IShareToken'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'shareTokenSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'sharesToCash'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'completeSetAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'systemState'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'enum SystemState'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalFeesOwedToVaults'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSecurityBondAllowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferEth'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'receiver'
					readonly type: 'address'
					readonly internalType: 'address payable'
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'universeId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'updateCollateralAmount'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'updateRetentionRate'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'updateVaultFees'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'zoltar'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
			]
		},
		{
			readonly type: 'receive'
			readonly stateMutability: 'payable'
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_ISecurityPool_ISecurityPoolFactory: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'deployChildSecurityPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'parent'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'shareToken'
					readonly type: 'address'
					readonly internalType: 'contract IShareToken'
				},
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityMultiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'startingRepEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'completeSetCollateralAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'truthAuction'
					readonly type: 'address'
					readonly internalType: 'contract UniformPriceDualCapBatchAuction'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deployOriginSecurityPool'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'securityMultiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'currentRetentionRate'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'startingRepEthPrice'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolDeploymentCount'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'securityPoolDeploymentsRange'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'startIndex'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'count'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'deployments'
					readonly type: 'tuple[]'
					readonly internalType: 'struct ISecurityPoolFactory.SecurityPoolDeployment[]'
					readonly components: readonly [
						{
							readonly name: 'securityPool'
							readonly type: 'address'
							readonly internalType: 'contract ISecurityPool'
						},
						{
							readonly name: 'truthAuction'
							readonly type: 'address'
							readonly internalType: 'contract UniformPriceDualCapBatchAuction'
						},
						{
							readonly name: 'priceOracleManagerAndOperatorQueuer'
							readonly type: 'address'
							readonly internalType: 'contract PriceOracleManagerAndOperatorQueuer'
						},
						{
							readonly name: 'shareToken'
							readonly type: 'address'
							readonly internalType: 'contract IShareToken'
						},
						{
							readonly name: 'parent'
							readonly type: 'address'
							readonly internalType: 'contract ISecurityPool'
						},
						{
							readonly name: 'universeId'
							readonly type: 'uint248'
							readonly internalType: 'uint248'
						},
						{
							readonly name: 'questionId'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'securityMultiplier'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'currentRetentionRate'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'startingRepEthPrice'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'completeSetCollateralAmount'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_ISecurityPoolForker_ISecurityPoolForker: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'claimAuctionProceeds'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'vault'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'createChildUniverse'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'finalizeTruthAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'forkZoltarWithOwnEscalationGame'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'getQuestionOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'initiateSecurityPoolFork'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'migrateRepToZoltar'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'outcomeIndices'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'migrateVault'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'startTruthAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_IShareToken_IShareToken: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'authorize'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_securityPoolCandidate'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfShares'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'balances'
					readonly type: 'uint256[3]'
					readonly internalType: 'uint256[3]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'burnCompleteSets'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'burnTokenId'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getTokenId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: '_tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getTokenIds'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcomes'
					readonly type: 'uint8[]'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: '_tokenIds'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'mintCompleteSets'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_cashAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupplyForOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'unpackTokenId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: '_tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_IUniformPriceDualCapBatchAuction_IUniformPriceDualCapBatchAuction: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'AuctionStarted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'ethRaiseCap'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'maxRepBeingSold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'minBidSize'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Finalized'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'ethToSend'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'hitCap'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'foundTick'
					readonly type: 'int256'
					readonly internalType: 'int256'
					readonly indexed: false
				},
				{
					readonly name: 'repFilled'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'ethFilled'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'RefundLosingBids'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'bidder'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly indexed: false
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
				{
					readonly name: 'ethAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'SubmitBid'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'bidder'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tick'
					readonly type: 'int256'
					readonly internalType: 'int256'
					readonly indexed: false
				},
				{
					readonly name: 'amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'WithdrawBids'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'withdrawFor'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly indexed: false
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
				{
					readonly name: 'totalFilledRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'totalEthRefund'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'auctionStarted'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'clearingTick'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'computeClearing'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: 'hitCap'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'clearingTickOut'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
				{
					readonly name: 'accumulatedEth'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'ethAtClearingTick'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'ethFilledAtClearing'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'ethRaiseCap'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'ethRaised'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'finalize'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'finalized'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'maxRepBeingSold'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'minBidSize'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'owner'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'refundLosingBids'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'startAuction'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'ethRaiseCap'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'maxRepBeingSold'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'submitBid'
			readonly stateMutability: 'payable'
			readonly inputs: readonly [
				{
					readonly name: 'tick'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'tickToPrice'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'tick'
					readonly type: 'int256'
					readonly internalType: 'int256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalRepPurchased'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'withdrawBids'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'withdrawFor'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'tickIndices'
					readonly type: 'tuple[]'
					readonly internalType: 'struct IUniformPriceDualCapBatchAuction.TickIndex[]'
					readonly components: readonly [
						{
							readonly name: 'tick'
							readonly type: 'int256'
							readonly internalType: 'int256'
						},
						{
							readonly name: 'bidIndex'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
					]
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'totalFilledRep'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'totalEthRefund'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_interfaces_IWeth9_IWeth9: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'guy'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Deposit'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Withdrawal'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'guy'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'decimals'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'deposit'
			readonly stateMutability: 'payable'
			readonly inputs: readonly []
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'name'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'symbol'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'src'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'dst'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'withdraw'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'wad'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_openOracle_OpenOracle_OpenOracle: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
		},
		{
			readonly type: 'error'
			readonly name: 'AlreadyProcessed'
			readonly inputs: readonly [
				{
					readonly name: 'action'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'CallToArbSysFailed'
			readonly inputs: readonly []
		},
		{
			readonly type: 'error'
			readonly name: 'EthTransferFailed'
			readonly inputs: readonly []
		},
		{
			readonly type: 'error'
			readonly name: 'InsufficientAmount'
			readonly inputs: readonly [
				{
					readonly name: 'resource'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'InvalidAmount2'
			readonly inputs: readonly [
				{
					readonly name: 'parameter'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'InvalidGasLimit'
			readonly inputs: readonly []
		},
		{
			readonly type: 'error'
			readonly name: 'InvalidInput'
			readonly inputs: readonly [
				{
					readonly name: 'parameter'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'InvalidStateHash'
			readonly inputs: readonly [
				{
					readonly name: 'parameter'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'InvalidTiming'
			readonly inputs: readonly [
				{
					readonly name: 'action'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'NoReportToDispute'
			readonly inputs: readonly []
		},
		{
			readonly type: 'error'
			readonly name: 'OutOfBounds'
			readonly inputs: readonly [
				{
					readonly name: 'parameter'
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'ReentrancyGuardReentrantCall'
			readonly inputs: readonly []
		},
		{
			readonly type: 'error'
			readonly name: 'SafeERC20FailedOperation'
			readonly inputs: readonly [
				{
					readonly name: 'token'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'TokensCannotBeSame'
			readonly inputs: readonly []
		},
		{
			readonly type: 'event'
			readonly name: 'InitialReportSubmitted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
				{
					readonly name: 'reporter'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'amount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'amount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'token1Address'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token2Address'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'swapFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'protocolFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'settlementTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'disputeDelay'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'escalationHalt'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timeType'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'callbackContract'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'callbackSelector'
					readonly type: 'bytes4'
					readonly internalType: 'bytes4'
					readonly indexed: false
				},
				{
					readonly name: 'trackDisputes'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'callbackGasLimit'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
					readonly indexed: false
				},
				{
					readonly name: 'blockTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ReportDisputed'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
				{
					readonly name: 'disputer'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'newAmount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'newAmount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'token1Address'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token2Address'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'swapFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'protocolFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'settlementTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'disputeDelay'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'escalationHalt'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timeType'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'callbackContract'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'callbackSelector'
					readonly type: 'bytes4'
					readonly internalType: 'bytes4'
					readonly indexed: false
				},
				{
					readonly name: 'trackDisputes'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'callbackGasLimit'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
					readonly indexed: false
				},
				{
					readonly name: 'blockTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ReportInstanceCreated'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
				{
					readonly name: 'token1Address'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'token2Address'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'feePercentage'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'multiplier'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'exactToken1Report'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'ethFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'creator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'settlementTime'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'escalationHalt'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'disputeDelay'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'protocolFee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'settlerReward'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'timeType'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'callbackContract'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'callbackSelector'
					readonly type: 'bytes4'
					readonly internalType: 'bytes4'
					readonly indexed: false
				},
				{
					readonly name: 'trackDisputes'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'callbackGasLimit'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'keepFee'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
					readonly indexed: false
				},
				{
					readonly name: 'blockTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'feeToken'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ReportSettled'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'settlementTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'blockTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'SettlementCallbackExecuted'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
				{
					readonly name: 'callbackContract'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'success'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'MULTIPLIER_PRECISION'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'PERCENTAGE_PRECISION'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'PRICE_PRECISION'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'SETTLEMENT_WINDOW'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'SETTLEMENT_WINDOW_BLOCKS'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'accruedProtocolFees'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'createReportInstance'
			readonly stateMutability: 'payable'
			readonly inputs: readonly [
				{
					readonly name: 'token1Address'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'token2Address'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'exactToken1Report'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'feePercentage'
					readonly type: 'uint24'
					readonly internalType: 'uint24'
				},
				{
					readonly name: 'multiplier'
					readonly type: 'uint16'
					readonly internalType: 'uint16'
				},
				{
					readonly name: 'settlementTime'
					readonly type: 'uint48'
					readonly internalType: 'uint48'
				},
				{
					readonly name: 'escalationHalt'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'disputeDelay'
					readonly type: 'uint24'
					readonly internalType: 'uint24'
				},
				{
					readonly name: 'protocolFee'
					readonly type: 'uint24'
					readonly internalType: 'uint24'
				},
				{
					readonly name: 'settlerReward'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'createReportInstance'
			readonly stateMutability: 'payable'
			readonly inputs: readonly [
				{
					readonly name: 'params'
					readonly type: 'tuple'
					readonly internalType: 'struct OpenOracle.CreateReportParams'
					readonly components: readonly [
						{
							readonly name: 'exactToken1Report'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'escalationHalt'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'settlerReward'
							readonly type: 'uint256'
							readonly internalType: 'uint256'
						},
						{
							readonly name: 'token1Address'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'settlementTime'
							readonly type: 'uint48'
							readonly internalType: 'uint48'
						},
						{
							readonly name: 'disputeDelay'
							readonly type: 'uint24'
							readonly internalType: 'uint24'
						},
						{
							readonly name: 'protocolFee'
							readonly type: 'uint24'
							readonly internalType: 'uint24'
						},
						{
							readonly name: 'token2Address'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'callbackGasLimit'
							readonly type: 'uint32'
							readonly internalType: 'uint32'
						},
						{
							readonly name: 'feePercentage'
							readonly type: 'uint24'
							readonly internalType: 'uint24'
						},
						{
							readonly name: 'multiplier'
							readonly type: 'uint16'
							readonly internalType: 'uint16'
						},
						{
							readonly name: 'timeType'
							readonly type: 'bool'
							readonly internalType: 'bool'
						},
						{
							readonly name: 'trackDisputes'
							readonly type: 'bool'
							readonly internalType: 'bool'
						},
						{
							readonly name: 'keepFee'
							readonly type: 'bool'
							readonly internalType: 'bool'
						},
						{
							readonly name: 'callbackContract'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'callbackSelector'
							readonly type: 'bytes4'
							readonly internalType: 'bytes4'
						},
						{
							readonly name: 'protocolFeeRecipient'
							readonly type: 'address'
							readonly internalType: 'address'
						},
						{
							readonly name: 'feeToken'
							readonly type: 'bool'
							readonly internalType: 'bool'
						},
					]
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'disputeAndSwap'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'tokenToSwap'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'newAmount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'newAmount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'disputer'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'amt2Expected'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'disputeAndSwap'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'tokenToSwap'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'newAmount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'newAmount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'amt2Expected'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'disputeHistory'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'amount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'amount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'tokenToSwap'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'reportTimestamp'
					readonly type: 'uint48'
					readonly internalType: 'uint48'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'extraData'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
				{
					readonly name: 'callbackContract'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'numReports'
					readonly type: 'uint32'
					readonly internalType: 'uint32'
				},
				{
					readonly name: 'callbackGasLimit'
					readonly type: 'uint32'
					readonly internalType: 'uint32'
				},
				{
					readonly name: 'callbackSelector'
					readonly type: 'bytes4'
					readonly internalType: 'bytes4'
				},
				{
					readonly name: 'protocolFeeRecipient'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'trackDisputes'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'keepFee'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'feeToken'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getETHProtocolFees'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getProtocolFees'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'tokenToGet'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getSettlementData'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'settlementTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'nextReportId'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'protocolFees'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'reportMeta'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'exactToken1Report'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'escalationHalt'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'fee'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'settlerReward'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'token1'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'settlementTime'
					readonly type: 'uint48'
					readonly internalType: 'uint48'
				},
				{
					readonly name: 'token2'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'timeType'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'feePercentage'
					readonly type: 'uint24'
					readonly internalType: 'uint24'
				},
				{
					readonly name: 'protocolFee'
					readonly type: 'uint24'
					readonly internalType: 'uint24'
				},
				{
					readonly name: 'multiplier'
					readonly type: 'uint16'
					readonly internalType: 'uint16'
				},
				{
					readonly name: 'disputeDelay'
					readonly type: 'uint24'
					readonly internalType: 'uint24'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'reportStatus'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'currentAmount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'currentAmount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'currentReporter'
					readonly type: 'address'
					readonly internalType: 'address payable'
				},
				{
					readonly name: 'reportTimestamp'
					readonly type: 'uint48'
					readonly internalType: 'uint48'
				},
				{
					readonly name: 'settlementTimestamp'
					readonly type: 'uint48'
					readonly internalType: 'uint48'
				},
				{
					readonly name: 'initialReporter'
					readonly type: 'address'
					readonly internalType: 'address payable'
				},
				{
					readonly name: 'lastReportOppoTime'
					readonly type: 'uint48'
					readonly internalType: 'uint48'
				},
				{
					readonly name: 'disputeOccurred'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
				{
					readonly name: 'isDistributed'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'settle'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'price'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'settlementTimestamp'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'submitInitialReport'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'amount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'amount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
				{
					readonly name: 'reporter'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'submitInitialReport'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'reportId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'amount1'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'amount2'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'stateHash'
					readonly type: 'bytes32'
					readonly internalType: 'bytes32'
				},
			]
			readonly outputs: readonly []
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60808060405234603d5760017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f005560015f55612ee990816100428239f35b5f80fdfe6101206040526004361015610012575f80fd5b5f3560e01c8063037584811461094e5780633deb6cae14610933578063634d1f89146108cd5780636e79bbf6146108b157806378025ec41461080957806379a5e106146107b95780637fc88cd81461079157806388f7ca63146107755780638df828001461073257806395082d2514610710578063a641fc85146106d8578063b309483a146106bd578063bbbea0521461060e578063c1d1205a146105c9578063c5f8f92c146104b7578063e256888f1461049a578063e6238a8214610478578063ee1c113b146103fa578063f0f750c0146103a9578063f27dd8ab14610365578063f30ef905146101d75763ff57143b1461010c575f80fd5b346101d35760203660031901126101d3576004355f52600160205261018060405f2080549065ffffffffffff6001820154916002810154600382015490600560048401549301549460405196875260208701526040860152606085015260018060a01b038116608085015260a01c1660a083015260018060a01b03811660c083015260ff8160a01c16151560e083015262ffffff8160a81c1661010083015262ffffff8160c01c1661012083015261ffff8160d81c1661014083015260e81c610160820152f35b5f80fd5b6102403660031901126101d3576040516101f081610a14565b6004358152602435602082015260443560408201526064356001600160a01b03811681036101d357606082015260843565ffffffffffff811681036101d357608082015260a43562ffffff811681036101d35760a082015260c43562ffffff811681036101d35760c082015260e4356001600160a01b03811681036101d35760e08201526101043563ffffffff811681036101d3576101008201526101243562ffffff811681036101d3576101208201526101443561ffff811681036101d3576101408201526101643580151581036101d3576101608201526101843580151581036101d3576101808201526101a43580151581036101d3576101a08201526101c4356001600160a01b03811681036101d3576101c08201526101e4356001600160e01b0319811681036101d3576101e0820152610204356001600160a01b03811681036101d3576102008201526102243580151581036101d3578161035d916102206020940152612422565b604051908152f35b346101d35760203660031901126101d3576020610390610383610991565b61038b6114cf565b610f55565b60015f516020612e945f395f51905f5255604051908152f35b346101d35760c03660031901126101d3576103e76103c56109a7565b6103cd6114cf565b60a43590608435903390606435906044359060043561158c565b60015f516020612e945f395f51905f5255005b346101d35760203660031901126101d3576004355f52600260205260405f2060ff600482015460d81c1615610445578060036002604093015491015460d01c82519182526020820152f35b604051627ef01b60e91b815260206004820152600b60248201526a1b9bdd081cd95d1d1b195960aa1b6044820152606490fd5b346101d3575f3660031901126101d3576104906114cf565b6020610390610f05565b346101d3575f3660031901126101d3576020604051629896808152f35b6101403660031901126101d3576104cc610991565b6104d46109a7565b906064359062ffffff82168092036101d35760843561ffff81168091036101d35760a4359265ffffffffffff84168094036101d35760e4359462ffffff86168096036101d3576101043562ffffff81168091036101d35760209661035d966040519661053f88610a14565b604435885260c4358a89015261012435604089015260018060a01b03166060880152608087015260a086015260c085015260018060a01b031660e08401525f61010084015261012083015261014082015260016101608201525f61018082015260016101a08201525f6101c08201525f6101e0820152336102008201526001610220820152612422565b346101d35760e03660031901126101d3576103e76105e56109a7565b6105ed61097b565b906105f66114cf565b60c4359160a43591606435906044359060043561158c565b346101d35760203660031901126101d3576004355f52600260205261014060405f2060ff815491600181015490600281015460046003830154920154926040519586526020860152604085015260018060a01b038116606085015265ffffffffffff8160a01c16608085015260d01c60a084015260018060a01b03811660c084015265ffffffffffff8160a01c1660e0840152818160d01c16151561010084015260d81c161515610120820152f35b346101d3575f3660031901126101d357602060405160648152f35b346101d35760203660031901126101d3576001600160a01b036106f9610991565b165f526004602052602060405f2054604051908152f35b346101d3575f3660031901126101d3576020604051670de0b6b3a76400008152f35b346101d35760203660031901126101d35761074b6114cf565b6040610758600435610ab2565b60015f516020612e945f395f51905f525582519182526020820152f35b346101d3575f3660031901126101d35760206040516105468152f35b346101d35760803660031901126101d3576107b7336064356044356024356004356110e7565b005b346101d35760403660031901126101d3576107d2610991565b6107da6109a7565b6001600160a01b039182165f908152600360209081526040808320949093168252928352819020549051908152f35b346101d35760203660031901126101d3576004355f52600560205261012060405f2060ff815491600260018201549101549060405193845260018060a01b038116602085015263ffffffff8160a01c16604085015263ffffffff8160c01c16606085015263ffffffff60e01b16608084015260018060a01b03811660a0840152818160a01c16151560c0840152818160a81c16151560e084015260b01c161515610100820152f35b346101d3575f3660031901126101d35760205f54604051908152f35b346101d35760403660031901126101d3576004355f52600660205260405f206024355f52602052608060405f2065ffffffffffff8154916002600182015491015490604051938452602084015260018060a01b038116604084015260a01c166060820152f35b346101d3575f3660031901126101d3576020604051603c8152f35b346101d35760a03660031901126101d3576107b761096a61097b565b6064356044356024356004356110e7565b608435906001600160a01b03821682036101d357565b600435906001600160a01b03821682036101d357565b602435906001600160a01b03821682036101d357565b9065ffffffffffff8091169116019065ffffffffffff82116109db57565b634e487b7160e01b5f52601160045260245ffd5b60609060208152600a6020820152691cd95d1d1b195b595b9d60b21b60408201520190565b61024081019081106001600160401b03821117610a3057604052565b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b03821190821017610a3057604052565b3d15610aa0573d906001600160401b038211610a305760405191610a95601f8201601f191660200184610a44565b82523d5f602084013e565b606090565b919082018092116109db57565b90815f52600260205260405f20825f52600160205260405f2092600584019060ff825460a01c165f14610eb75765ffffffffffff610b0381600386015460a01c1682600489015460a01c16906109bd565b164210610e99575b600383019485549065ffffffffffff8260a01c1615610e5f57600485019283549460ff8660d81c1680610e4657506003830154600284015460ff60d81b19909716600160d81b178655815490949060a01c60ff1615610e3557610c1f65ffffffffffff42165b60018060d01b03199060d01b1660018060d01b0383161798898c55847f7179a8c621630f6a7d15716310ca05fca251e72d1dc52cd4a5c458a9e6c6ce546060600284019c8d549060405191825260d01c6020820152426040820152a25f858152600560205260409020600496909601805482549194610bff92916001600160a01b0391821691309116611507565b83548c5460019290920154916001600160a01b0390811691309116611507565b6001840180546001600160a01b0381169081151580610e22575b610cf5575b505050505093610c91929160ff958554878160d01c165f14610cda57505f52600560205285600260405f20015460a81c165f14610cac57508354610c8b91906001600160a01b031661154d565b3361154d565b5460d81c1615610ca45754915460d01c90565b505f91508190565b600201546001600160a01b03165f90815260046020526040902080549091610cd391610aa5565b9055610c8b565b610cf09392506001600160a01b0316905061154d565b610c8b565b8a548d54945495546040516001600160e01b0319841660208201908152602482018a9052604482019390935260d09690961c60648701526001600160a01b03968716608487015290951660a4808601919091528452939892969592949293610d5e60c489610a44565b5a8160ba1c643fffffffc063ffffffc08216911681036109db57603e0163ffffffff81116109db5763ffffffff603f81620186a0931604160163ffffffff81116109db5763ffffffff1611610e135760205f807f63c05bab316b954c37258e1fcd2f871b8270022922505b50f9ab4d61a58067129360ff9d82899763ffffffff610c919f519460c01c16f193610df2610a67565b505460405194151585526001600160a01b031693a391958193945f80610c3e565b6304c5ed9760e51b5f5260045ffd5b506001600160e01b031981161515610c39565b610c1f65ffffffffffff4316610b71565b95505050509450505f14610ca457600201549160d01c90565b60405163d647364f60e01b81526020600482015260116024820152701b9bc81a5b9a5d1a585b081c995c1bdc9d607a1b6044820152606490fd5b60405163b2fe248560e01b815280610eb3600482016109ef565b0390fd5b65ffffffffffff610edb81600386015460a01c1682600489015460a01c16906109bd565b1665ffffffffffff43161015610b0b5760405163b2fe248560e01b815280610eb3600482016109ef565b5f90335f52600460205260405f205480610f1c5750565b909150335f5260046020525f60408120555f80808084335af1610f3d610a67565b5015610f465790565b630db2c7f160e31b5f5260045ffd5b905f91335f52600360205260405f2060018060a01b0382165f5260205260405f20549081610f81575050565b8192935090610fb391335f52600360205260405f2060018060a01b0382165f526020525f604081205533903090611507565b90565b805465ffffffffffff60a01b191660a09290921b65ffffffffffff60a01b16919091179055565b818102929181159184041417156109db57565b8115610ffa570490565b634e487b7160e01b5f52601260045260245ffd5b9f9e919f6101005260e05260c052610100516101e0019d600160a01b6001900360e0511661010051526101005160200152610100516040015262ffffff16610100516060015262ffffff16610100516080015265ffffffffffff166101005160a0015262ffffff166101005160c001526101005160e001521515610100516101000152600160a01b600190031661010051610120015263ffffffff60e01b16610100516101400152151561010051610160015263ffffffff16610100516101800152610100516101a0015260c051610100516101c00152565b5f818152600260205260409020600301549193909290916001600160a01b031661149757825f52600160205260405f2093835f52600260205260405f2094845f52600560205260405f20965f54861015611465578154830361142f5783156113f957848854036113c3576001600160a01b03811694851561138a57600483019261117e8560018060a01b0386541630903390611507565b60058101986111998730338d60018060a01b03905416611507565b858155600181018790556003810180546001600160a01b03199081166001600160a01b039a909a16998a17825560048301805490911690991789558a5490919060a01c60ff1615611379576111f765ffffffffffff42165b83610fb6565b670de0b6b3a76400008702878104670de0b6b3a764000014881517156109db576001611307978c948f8f7f820b2beedf2c18d30de3d9c50bb9d50342008711b3b12587677c30711b286bea9e60ff8f9281996002611259611275968b9c610ff0565b9101555460a01c161561136a5765ffffffffffff431690610fb6565b8c60028201978d888a5460a01c1661130c575b5050505050549c549401549c0154915460a01c169060405197889760018060a01b0385169d8d60018060a01b03169d429863ffffffff8660c01c16978c63ffffffff60e01b88169760018060a01b03169660ff8360a01c169665ffffffffffff8460e81c9660a01c169462ffffff808660c01c169560a81c169361100e565b0390a4565b5f918252600660209081526040808420848052909152909120908155858101919091559154849261134b9160a01c65ffffffffffff1690600201610fb6565b01805463ffffffff60a01b191660a084901b1790555f8f8c8f8d611288565b65ffffffffffff421690610fb6565b6111f765ffffffffffff43166111f1565b60405163d647364f60e01b815260206004820152601060248201526f7265706f72746572206164647265737360801b6044820152606490fd5b604051600162c3b09b60e01b0319815260206004820152600a6024820152690e6e8c2e8ca40d0c2e6d60b31b6044820152606490fd5b60405163d647364f60e01b815260206004820152600d60248201526c1d1bdad95b8c88185b5bdd5b9d609a1b6044820152606490fd5b60405163d647364f60e01b815260206004820152600d60248201526c1d1bdad95b8c48185b5bdd5b9d609a1b6044820152606490fd5b60405163d647364f60e01b81526020600482015260096024820152681c995c1bdc9d081a5960ba1b6044820152606490fd5b604051627ef01b60e91b815260206004820152601060248201526f1c995c1bdc9d081cdd589b5a5d1d195960821b6044820152606490fd5b60025f516020612e945f395f51905f5254146114f85760025f516020612e945f395f51905f5255565b633ee5aeb560e01b5f5260045ffd5b9291908215611547576001600160a01b03811630036115355750611533926001600160a01b0316612dde565b565b611533936001600160a01b0316612d4c565b50505050565b8115611588575f808084819460018060a01b03165af161156b610a67565b50156115745750565b5f80808093815af150611585610a67565b50565b5050565b5f8181526002602090815260408083205460019283905292206005810154910154969895979296949593948210919060d81c61ffff1682156123d7576115d490606492610fdd565b045b85036123665750845f52600160205260405f2092855f52600260205260405f20915f548710156114655785159081801561235e575b612328576003840154916001600160a01b038316156123195760058701549160ff8360a01c16805f146122d05765ffffffffffff6116578160048c015460a01c16828860a01c166109bd565b1642116122b6575b60ff600488015460d81c166122805760048901546001600160a01b03908116959087168614158061226a575b6121095765ffffffffffff911561222d576116af90828660e81c9160a01c166109bd565b164210612213575b85549081670de0b6b3a7640000810204670de0b6b3a764000014821517156109db576001870154926116f384670de0b6b3a76400008502610ff0565b9061170e62ffffff8760c01c1662ffffff8860a81c16610aa5565b6298968061171c8285610fdd565b04629896808402918483046298968014851517156109db576298968001918262989680116109db576117579261175191610ff0565b93610aa5565b908c670de0b6b3a7640000810204670de0b6b3a76400001417156109db576117898e670de0b6b3a76400008e02610ff0565b918210159182612208575b50506121c857820361217857895f52600560205260405f205487036113c3576001600160a01b038c161561213f575f8a81526005602052604090206002015460b081901c60ff16946001600160a01b03918216949187168103611e3f57505050508354906001850154925f14611c51576005870154926298968061183162ffffff82611825828960a81c1688610fdd565b049660c01c1685610fdd565b04915f52600360205260405f2060018060a01b0360048a01541660018060a01b03165f5260205260405f20611867838254610aa5565b90558b8b89856001820154115f14611c3157916118fd9491606461189961ffff60056118f397015460d81c1689610fdd565b04945b8082109182611c2a576118af82826123f8565b925b15611c21576118bf916123f8565b905b80611bff575b5080611be0575b505060048a01546001600160a01b0316926118ee90879082908890610aa5565b610aa5565b9030903390612d4c565b600486015460038501546001600160a01b03918216929116906001600160ff1b03811681036109db5761193c936119369160011b610aa5565b91612dde565b848255600182018790556003820180546001600160a01b0319166001600160a01b038a16179055600584015460a01c60ff1615611bcf5761198965ffffffffffff42165b60038401610fb6565b61199d87670de0b6b3a76400008702610ff0565b600283015560048201805460ff60d01b1916600160d01b179055600584015460a01c60ff1615611bbe576119dd65ffffffffffff43165b60048401610fb6565b855f52600560205260ff600260405f20015460a01c16611ae2575b5050906113076001957fc914f81e730ff0d8aed0d786714bd9591c0d726342263562329f4fe2463316cf94936004840154946005850154988995015490885f52600560205260018060a01b03600160405f20015416895f52600560205263ffffffff60e01b600160405f20015416908a5f52600560205260ff600260405f20015460a01c16928b5f52600560205263ffffffff600160405f20015460c01c16946040519a8b9a60018060a01b03169f60018060a01b0382169f8c429b60ff8360a01c169665ffffffffffff8460e81c9660a01c169462ffffff808660c01c169560a81c169361100e565b5f8681526005602090815260408083206001908101546006845282852060a091821c63ffffffff168087529452919093208881558084018b905560039590950154959796959294919392611b4392911c65ffffffffffff1690600201610fb6565b865f52600660205260405f20825f52602052600260405f200190838060a01b0316838060a01b03198254161790550163ffffffff81116109db575f8581526005602052604090206001908101805463ffffffff60a01b191660a09390931b63ffffffff60a01b169290921790915591929091611307906119f8565b6119dd65ffffffffffff42166119d4565b61198965ffffffffffff4316611980565b60058c0154611bf892906001600160a01b0316612dde565b8d5f6118ce565b60058d0154611c1b9190309033906001600160a01b0316612d4c565b5f6118c7565b50505f906118c1565b5f926118b1565b5050506001830183116109db576118f36118fd928d8d600187019461189c565b8960058894939401549162989680611c7162ffffff8560a81c1686610fdd565b04938362989680611c8b62ffffff889760c01c1684610fdd565b04925f52600360205260405f209060018060a01b039060018060a01b0316165f5260205260405f20611cbe838254610aa5565b905589866001820154115f14611e1757611cf8611d67956118ee856064611cf161ffff60058998015460d81c168d610fdd565b0497610aa5565b10611e0e57848d611d1683611d11846118ee8886610aa5565b6123f8565b935b83611d27846118ee8486610aa5565b1015611e0357611d11611d1192611d3d956123f8565b905b80611de1575b5080611dc1575b5060048801546001600160a01b0316906118f3908590610aa5565b600486015460038501546001600160a01b039081169391166001600160ff1b03821682036109db57611dbc93611da09260011b91612dde565b600586015460038501546001600160a01b039081169116612dde565b61193c565b6005890154611ddb91908e906001600160a01b0316612dde565b5f611d4c565b60058a0154611dfd9190309033906001600160a01b0316612d4c565b5f611d45565b505050505f90611d3f565b848d5f93611d18565b50915091506001840184116109db5781818c92611cf8866118ee611d679760018b0197610aa5565b9394929391929091906001600160a01b03878116908416036121095715611fb55750508960058801549362989680611e7f62ffffff8760a81c1686610fdd565b049462989680611e9762ffffff8360c01c1687610fdd565b04915f52600360205260405f209060018060a01b039060018060a01b0316165f5260205260405f20611eca828254610aa5565b905588836001820154115f14611f955790611f32936064611ef961ffff60056118f396015460d81c1683610fdd565b04905b80821115611f8d57611f0d916123f8565b80611f6b575b5060058a01546001600160a01b0316926118ee90879082908890610aa5565b600586015460038501546001600160a01b03918216929116906001600160ff1b03811681036109db57611dbc936119369160011b610aa5565b60048b0154611f879190309033906001600160a01b0316612d4c565b5f611f13565b50505f611f0d565b5090506001820182116109db576118f38b91836001611f32950190611efc565b62989680611fd462ffffff82611825828760a89b989a9b1c1688610fdd565b04915f52600360205260405f209060018060a01b03165f5260205260405f20611ffe828254610aa5565b9055816001890154115f146120ee5761203a90612034606461202b61ffff60058d015460d81c1686610fdd565b04915b85610aa5565b90610aa5565b90808211156120e65761204c916123f8565b806120c4575b50600586015461206f906001600160a01b03166118f3848c610aa5565b600586015460038501546001600160a01b039081169391166001600160ff1b03821682036109db57611dbc936120a89260011b91612dde565b600486015460038501546001600160a01b039081169116612dde565b60048701546120e09190309033906001600160a01b0316612d4c565b5f612052565b50505f61204c565b6001820182116109db5761203a90612034600184019161202e565b60405163d647364f60e01b815260206004820152600d60248201526c0746f6b656e20746f207377617609c1b6044820152606490fd5b60405163d647364f60e01b815260206004820152601060248201526f6469737075746572206164647265737360801b6044820152606490fd5b60405163a559139960e01b815260206004820152602160248201527f616d6f756e743220646f65736e2774206d61746368206578706563746174696f6044820152603760f91b6064820152608490fd5b604051637a72dbcd60e11b815260206004820152601760248201527670726963652077697468696e20626f756e64617269657360481b6044820152606490fd5b111590505f80611794565b60405163b2fe248560e01b815280610eb360048201612e67565b61224090828660e81c9160a01c166109bd565b1665ffffffffffff431610156116b75760405163b2fe248560e01b815280610eb360048201612e67565b506001600160a01b03878116908616141561168b565b604051627ef01b60e91b815260206004820152600e60248201526d1c995c1bdc9d081cd95d1d1b195960921b6044820152606490fd5b60405163b2fe248560e01b815280610eb360048201612e36565b65ffffffffffff6122ef8160048c015460a01c16828860a01c166109bd565b1665ffffffffffff4316111561165f5760405163b2fe248560e01b815280610eb360048201612e36565b63419dba4b60e11b5f5260045ffd5b60405163d647364f60e01b815260206004820152600d60248201526c746f6b656e20616d6f756e747360981b6044820152606490fd5b50881561160b565b6123a457604051637a72dbcd60e11b8152602060048201526011602482015270195cd8d85b185d1a5bdb881a185b1d1959607a1b6044820152606490fd5b60405163d647364f60e01b815260206004820152600a6024820152691b995dc8185b5bdd5b9d60b21b6044820152606490fd5b5060018101809111156115d657634e487b7160e01b5f52601160045260245ffd5b919082039182116109db57565b805460ff60a01b191691151560a01b60ff60a01b16919091179055565b6064341115612d2057805115612ceb57606081015160e08201516001600160a01b03908116911614612cdc5765ffffffffffff60808201511662ffffff60a08301511611612c98576040810151341115612c5d5762ffffff6101208201511615612c255762ffffff6101208201511662ffffff60c0830151160162ffffff81116109db5762ffffff62989680911611612bf1575f54905f1982146109db5760018281015f9081558381526020919091526040902060608201516004820180546001600160a01b0319166001600160a01b0392831617815560e084015160058401805486518655610120870151610140880151600168ffff000000ffffff0160a01b0319909216939095169290921760a89490941b62ffffff60a81b169390931760d89190911b61ffff60d81b161790915560808301519192916125709165ffffffffffff9190911690610fb6565b61257e6040820151346123f8565b60028301556020810151600183015560a0810151600583015462ffffff60c01b60c084015160c01b169162ffffff60e81b9060e81b1690600164ffff00000160c01b031617176005830155604081015160038301556125e7610160820151151560058401612405565b5f8381526005602052604090206101c08201516001820180546101e08501516001600160e01b0319166001600160a01b03909316600160a01b600160e01b039091161791909117905561018082015190929061264890151560028501612405565b6101008201516001848101805463ffffffff60c01b191660c09390931b63ffffffff60c01b16929092179091556101a0830151600285018054610200860151610220870151600162ffff0160a01b031990921693151560a81b60ff60a81b16939093176001600160a01b03939093169290921791151560b01b60ff60b01b1691909117905561016083015160405190151560f81b602082019081529181526126f1602182610a44565b519020906080830151604051602081019160018060d01b03199060d01b16825260068152612720602682610a44565b519020610100528260a0810151604051602081019162ffffff60e81b9060e81b16825260038152612752602382610a44565b519020916101c0820151604051602081019160018060601b03199060601b16825260148152612782603482610a44565b5190209063ffffffff60e01b6101e08401511660405160208101918252600481526127ae602482610a44565b51902090610100840151604051602081019163ffffffff60e01b9060e01b168252600481526127de602482610a44565b519020906101a08501511515604051602081019160f81b825260018152612806602182610a44565b519020610120860151604051602081019162ffffff60e81b9060e81b16825260038152612834602382610a44565b51902060c0870151604051602081019162ffffff60e81b9060e81b16825260038152612861602382610a44565b51902091600260408901516040516020810191825260208152612885604082610a44565b51902094015460405160208101918252602081526128a4604082610a44565b519020946101808901511515604051602081019160f81b8252600181526128cc602182610a44565b519020966101408a0151604051602081019161ffff60f01b9060f01b168252600281526128fa602282610a44565b5190209861022060208c0151604051602081019182526020815261291f604082610a44565b5190209b01511515604051602081019160f81b825260018152612943602182610a44565b5190209b60405160208101903360601b825260148152612964603482610a44565b5190206040514360d01b6001600160d01b0319166020820190815260068252919f9190612992602682610a44565b51902060a0526040514260d01b6001600160d01b0319166020820190815260068252906129c0602682610a44565b51902060e05260405160c052602060c051015261010051604060c0510152606060c0510152608060c051015260a060c051015260c08051015260e060c051015261010060c051015261012060c051015261014060c051015261016060c051015261018060c05101526101a060c05101526101c060c05101526101e060c051015261020060c051015260a05161022060c051015260e05161024060c051015261024060c05152612a7361026060c051610a44565b60c05151602060c051012080925560018060a01b036060820151169060018060a01b0360e0820151169262ffffff61012083015116918080808061ffff61014082015116815165ffffffffffff608084015116602084015162ffffff60a0860151169062ffffff60c087015116926040870151946101608801511515966102206101a063ffffffff6101006101808d6101c060018060a01b03910151169d6101e08460e01b910151169e015115159e0151169d015115159d015115159e60405160805260805152602060805101526040608051015234606060805101523360808051015260a0608051015260c0608051015260e06080510152610100608051015261012060805101526101406080510152610160608051015261018060805101526101a060805101526101c060805101526101e0608051015261020060805101524261022060805101526102406080510152827fc9d9836f54a918dcd0410f5e54abb43abe66b4360716a45cb4d9f142aaf3c01a610260608051a490565b60405163d647364f60e01b815260206004820152600b60248201526a73756d206f66206665657360a81b6044820152606490fd5b60405163d647364f60e01b815260206004820152600f60248201526e066656550657263656e74616765203608c1b6044820152606490fd5b60405163240bf61760e11b8152602060048201526012602482015271736574746c6572207265776172642066656560701b6044820152606490fd5b60405163b2fe248560e01b815260206004820152601b60248201527a736574746c656d656e7420767320646973707574652064656c617960281b6044820152606490fd5b6340ccdec360e11b5f5260045ffd5b60405163d647364f60e01b815260206004820152600c60248201526b1d1bdad95b88185b5bdd5b9d60a21b6044820152606490fd5b60405163240bf61760e11b815260206004820152600360248201526266656560e81b6044820152606490fd5b6040516323b872dd60e01b5f9081526001600160a01b039384166004529290931660245260449390935260209060648180865af19060015f5114821615612dbd575b6040525f60605215612d9d5750565b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b906001811516612dd557823b15153d15161690612d8e565b503d5f823e3d90fd5b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f5114821615612e1e575b60405215612d9d5750565b906001811516612dd557823b15153d15161690612e13565b606090602081526016602082015275191a5cdc1d5d19481c195c9a5bd908195e1c1a5c995960521b60408201520190565b6060906020815260116020820152706469737075746520746f6f206561726c7960781b6040820152019056fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220428d0ebc94393e9e5972e079bae2bf17df5dcd929dbd6aaf6ef8039a8271826064736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6101206040526004361015610012575f80fd5b5f3560e01c8063037584811461094e5780633deb6cae14610933578063634d1f89146108cd5780636e79bbf6146108b157806378025ec41461080957806379a5e106146107b95780637fc88cd81461079157806388f7ca63146107755780638df828001461073257806395082d2514610710578063a641fc85146106d8578063b309483a146106bd578063bbbea0521461060e578063c1d1205a146105c9578063c5f8f92c146104b7578063e256888f1461049a578063e6238a8214610478578063ee1c113b146103fa578063f0f750c0146103a9578063f27dd8ab14610365578063f30ef905146101d75763ff57143b1461010c575f80fd5b346101d35760203660031901126101d3576004355f52600160205261018060405f2080549065ffffffffffff6001820154916002810154600382015490600560048401549301549460405196875260208701526040860152606085015260018060a01b038116608085015260a01c1660a083015260018060a01b03811660c083015260ff8160a01c16151560e083015262ffffff8160a81c1661010083015262ffffff8160c01c1661012083015261ffff8160d81c1661014083015260e81c610160820152f35b5f80fd5b6102403660031901126101d3576040516101f081610a14565b6004358152602435602082015260443560408201526064356001600160a01b03811681036101d357606082015260843565ffffffffffff811681036101d357608082015260a43562ffffff811681036101d35760a082015260c43562ffffff811681036101d35760c082015260e4356001600160a01b03811681036101d35760e08201526101043563ffffffff811681036101d3576101008201526101243562ffffff811681036101d3576101208201526101443561ffff811681036101d3576101408201526101643580151581036101d3576101608201526101843580151581036101d3576101808201526101a43580151581036101d3576101a08201526101c4356001600160a01b03811681036101d3576101c08201526101e4356001600160e01b0319811681036101d3576101e0820152610204356001600160a01b03811681036101d3576102008201526102243580151581036101d3578161035d916102206020940152612422565b604051908152f35b346101d35760203660031901126101d3576020610390610383610991565b61038b6114cf565b610f55565b60015f516020612e945f395f51905f5255604051908152f35b346101d35760c03660031901126101d3576103e76103c56109a7565b6103cd6114cf565b60a43590608435903390606435906044359060043561158c565b60015f516020612e945f395f51905f5255005b346101d35760203660031901126101d3576004355f52600260205260405f2060ff600482015460d81c1615610445578060036002604093015491015460d01c82519182526020820152f35b604051627ef01b60e91b815260206004820152600b60248201526a1b9bdd081cd95d1d1b195960aa1b6044820152606490fd5b346101d3575f3660031901126101d3576104906114cf565b6020610390610f05565b346101d3575f3660031901126101d3576020604051629896808152f35b6101403660031901126101d3576104cc610991565b6104d46109a7565b906064359062ffffff82168092036101d35760843561ffff81168091036101d35760a4359265ffffffffffff84168094036101d35760e4359462ffffff86168096036101d3576101043562ffffff81168091036101d35760209661035d966040519661053f88610a14565b604435885260c4358a89015261012435604089015260018060a01b03166060880152608087015260a086015260c085015260018060a01b031660e08401525f61010084015261012083015261014082015260016101608201525f61018082015260016101a08201525f6101c08201525f6101e0820152336102008201526001610220820152612422565b346101d35760e03660031901126101d3576103e76105e56109a7565b6105ed61097b565b906105f66114cf565b60c4359160a43591606435906044359060043561158c565b346101d35760203660031901126101d3576004355f52600260205261014060405f2060ff815491600181015490600281015460046003830154920154926040519586526020860152604085015260018060a01b038116606085015265ffffffffffff8160a01c16608085015260d01c60a084015260018060a01b03811660c084015265ffffffffffff8160a01c1660e0840152818160d01c16151561010084015260d81c161515610120820152f35b346101d3575f3660031901126101d357602060405160648152f35b346101d35760203660031901126101d3576001600160a01b036106f9610991565b165f526004602052602060405f2054604051908152f35b346101d3575f3660031901126101d3576020604051670de0b6b3a76400008152f35b346101d35760203660031901126101d35761074b6114cf565b6040610758600435610ab2565b60015f516020612e945f395f51905f525582519182526020820152f35b346101d3575f3660031901126101d35760206040516105468152f35b346101d35760803660031901126101d3576107b7336064356044356024356004356110e7565b005b346101d35760403660031901126101d3576107d2610991565b6107da6109a7565b6001600160a01b039182165f908152600360209081526040808320949093168252928352819020549051908152f35b346101d35760203660031901126101d3576004355f52600560205261012060405f2060ff815491600260018201549101549060405193845260018060a01b038116602085015263ffffffff8160a01c16604085015263ffffffff8160c01c16606085015263ffffffff60e01b16608084015260018060a01b03811660a0840152818160a01c16151560c0840152818160a81c16151560e084015260b01c161515610100820152f35b346101d3575f3660031901126101d35760205f54604051908152f35b346101d35760403660031901126101d3576004355f52600660205260405f206024355f52602052608060405f2065ffffffffffff8154916002600182015491015490604051938452602084015260018060a01b038116604084015260a01c166060820152f35b346101d3575f3660031901126101d3576020604051603c8152f35b346101d35760a03660031901126101d3576107b761096a61097b565b6064356044356024356004356110e7565b608435906001600160a01b03821682036101d357565b600435906001600160a01b03821682036101d357565b602435906001600160a01b03821682036101d357565b9065ffffffffffff8091169116019065ffffffffffff82116109db57565b634e487b7160e01b5f52601160045260245ffd5b60609060208152600a6020820152691cd95d1d1b195b595b9d60b21b60408201520190565b61024081019081106001600160401b03821117610a3057604052565b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b03821190821017610a3057604052565b3d15610aa0573d906001600160401b038211610a305760405191610a95601f8201601f191660200184610a44565b82523d5f602084013e565b606090565b919082018092116109db57565b90815f52600260205260405f20825f52600160205260405f2092600584019060ff825460a01c165f14610eb75765ffffffffffff610b0381600386015460a01c1682600489015460a01c16906109bd565b164210610e99575b600383019485549065ffffffffffff8260a01c1615610e5f57600485019283549460ff8660d81c1680610e4657506003830154600284015460ff60d81b19909716600160d81b178655815490949060a01c60ff1615610e3557610c1f65ffffffffffff42165b60018060d01b03199060d01b1660018060d01b0383161798898c55847f7179a8c621630f6a7d15716310ca05fca251e72d1dc52cd4a5c458a9e6c6ce546060600284019c8d549060405191825260d01c6020820152426040820152a25f858152600560205260409020600496909601805482549194610bff92916001600160a01b0391821691309116611507565b83548c5460019290920154916001600160a01b0390811691309116611507565b6001840180546001600160a01b0381169081151580610e22575b610cf5575b505050505093610c91929160ff958554878160d01c165f14610cda57505f52600560205285600260405f20015460a81c165f14610cac57508354610c8b91906001600160a01b031661154d565b3361154d565b5460d81c1615610ca45754915460d01c90565b505f91508190565b600201546001600160a01b03165f90815260046020526040902080549091610cd391610aa5565b9055610c8b565b610cf09392506001600160a01b0316905061154d565b610c8b565b8a548d54945495546040516001600160e01b0319841660208201908152602482018a9052604482019390935260d09690961c60648701526001600160a01b03968716608487015290951660a4808601919091528452939892969592949293610d5e60c489610a44565b5a8160ba1c643fffffffc063ffffffc08216911681036109db57603e0163ffffffff81116109db5763ffffffff603f81620186a0931604160163ffffffff81116109db5763ffffffff1611610e135760205f807f63c05bab316b954c37258e1fcd2f871b8270022922505b50f9ab4d61a58067129360ff9d82899763ffffffff610c919f519460c01c16f193610df2610a67565b505460405194151585526001600160a01b031693a391958193945f80610c3e565b6304c5ed9760e51b5f5260045ffd5b506001600160e01b031981161515610c39565b610c1f65ffffffffffff4316610b71565b95505050509450505f14610ca457600201549160d01c90565b60405163d647364f60e01b81526020600482015260116024820152701b9bc81a5b9a5d1a585b081c995c1bdc9d607a1b6044820152606490fd5b60405163b2fe248560e01b815280610eb3600482016109ef565b0390fd5b65ffffffffffff610edb81600386015460a01c1682600489015460a01c16906109bd565b1665ffffffffffff43161015610b0b5760405163b2fe248560e01b815280610eb3600482016109ef565b5f90335f52600460205260405f205480610f1c5750565b909150335f5260046020525f60408120555f80808084335af1610f3d610a67565b5015610f465790565b630db2c7f160e31b5f5260045ffd5b905f91335f52600360205260405f2060018060a01b0382165f5260205260405f20549081610f81575050565b8192935090610fb391335f52600360205260405f2060018060a01b0382165f526020525f604081205533903090611507565b90565b805465ffffffffffff60a01b191660a09290921b65ffffffffffff60a01b16919091179055565b818102929181159184041417156109db57565b8115610ffa570490565b634e487b7160e01b5f52601260045260245ffd5b9f9e919f6101005260e05260c052610100516101e0019d600160a01b6001900360e0511661010051526101005160200152610100516040015262ffffff16610100516060015262ffffff16610100516080015265ffffffffffff166101005160a0015262ffffff166101005160c001526101005160e001521515610100516101000152600160a01b600190031661010051610120015263ffffffff60e01b16610100516101400152151561010051610160015263ffffffff16610100516101800152610100516101a0015260c051610100516101c00152565b5f818152600260205260409020600301549193909290916001600160a01b031661149757825f52600160205260405f2093835f52600260205260405f2094845f52600560205260405f20965f54861015611465578154830361142f5783156113f957848854036113c3576001600160a01b03811694851561138a57600483019261117e8560018060a01b0386541630903390611507565b60058101986111998730338d60018060a01b03905416611507565b858155600181018790556003810180546001600160a01b03199081166001600160a01b039a909a16998a17825560048301805490911690991789558a5490919060a01c60ff1615611379576111f765ffffffffffff42165b83610fb6565b670de0b6b3a76400008702878104670de0b6b3a764000014881517156109db576001611307978c948f8f7f820b2beedf2c18d30de3d9c50bb9d50342008711b3b12587677c30711b286bea9e60ff8f9281996002611259611275968b9c610ff0565b9101555460a01c161561136a5765ffffffffffff431690610fb6565b8c60028201978d888a5460a01c1661130c575b5050505050549c549401549c0154915460a01c169060405197889760018060a01b0385169d8d60018060a01b03169d429863ffffffff8660c01c16978c63ffffffff60e01b88169760018060a01b03169660ff8360a01c169665ffffffffffff8460e81c9660a01c169462ffffff808660c01c169560a81c169361100e565b0390a4565b5f918252600660209081526040808420848052909152909120908155858101919091559154849261134b9160a01c65ffffffffffff1690600201610fb6565b01805463ffffffff60a01b191660a084901b1790555f8f8c8f8d611288565b65ffffffffffff421690610fb6565b6111f765ffffffffffff43166111f1565b60405163d647364f60e01b815260206004820152601060248201526f7265706f72746572206164647265737360801b6044820152606490fd5b604051600162c3b09b60e01b0319815260206004820152600a6024820152690e6e8c2e8ca40d0c2e6d60b31b6044820152606490fd5b60405163d647364f60e01b815260206004820152600d60248201526c1d1bdad95b8c88185b5bdd5b9d609a1b6044820152606490fd5b60405163d647364f60e01b815260206004820152600d60248201526c1d1bdad95b8c48185b5bdd5b9d609a1b6044820152606490fd5b60405163d647364f60e01b81526020600482015260096024820152681c995c1bdc9d081a5960ba1b6044820152606490fd5b604051627ef01b60e91b815260206004820152601060248201526f1c995c1bdc9d081cdd589b5a5d1d195960821b6044820152606490fd5b60025f516020612e945f395f51905f5254146114f85760025f516020612e945f395f51905f5255565b633ee5aeb560e01b5f5260045ffd5b9291908215611547576001600160a01b03811630036115355750611533926001600160a01b0316612dde565b565b611533936001600160a01b0316612d4c565b50505050565b8115611588575f808084819460018060a01b03165af161156b610a67565b50156115745750565b5f80808093815af150611585610a67565b50565b5050565b5f8181526002602090815260408083205460019283905292206005810154910154969895979296949593948210919060d81c61ffff1682156123d7576115d490606492610fdd565b045b85036123665750845f52600160205260405f2092855f52600260205260405f20915f548710156114655785159081801561235e575b612328576003840154916001600160a01b038316156123195760058701549160ff8360a01c16805f146122d05765ffffffffffff6116578160048c015460a01c16828860a01c166109bd565b1642116122b6575b60ff600488015460d81c166122805760048901546001600160a01b03908116959087168614158061226a575b6121095765ffffffffffff911561222d576116af90828660e81c9160a01c166109bd565b164210612213575b85549081670de0b6b3a7640000810204670de0b6b3a764000014821517156109db576001870154926116f384670de0b6b3a76400008502610ff0565b9061170e62ffffff8760c01c1662ffffff8860a81c16610aa5565b6298968061171c8285610fdd565b04629896808402918483046298968014851517156109db576298968001918262989680116109db576117579261175191610ff0565b93610aa5565b908c670de0b6b3a7640000810204670de0b6b3a76400001417156109db576117898e670de0b6b3a76400008e02610ff0565b918210159182612208575b50506121c857820361217857895f52600560205260405f205487036113c3576001600160a01b038c161561213f575f8a81526005602052604090206002015460b081901c60ff16946001600160a01b03918216949187168103611e3f57505050508354906001850154925f14611c51576005870154926298968061183162ffffff82611825828960a81c1688610fdd565b049660c01c1685610fdd565b04915f52600360205260405f2060018060a01b0360048a01541660018060a01b03165f5260205260405f20611867838254610aa5565b90558b8b89856001820154115f14611c3157916118fd9491606461189961ffff60056118f397015460d81c1689610fdd565b04945b8082109182611c2a576118af82826123f8565b925b15611c21576118bf916123f8565b905b80611bff575b5080611be0575b505060048a01546001600160a01b0316926118ee90879082908890610aa5565b610aa5565b9030903390612d4c565b600486015460038501546001600160a01b03918216929116906001600160ff1b03811681036109db5761193c936119369160011b610aa5565b91612dde565b848255600182018790556003820180546001600160a01b0319166001600160a01b038a16179055600584015460a01c60ff1615611bcf5761198965ffffffffffff42165b60038401610fb6565b61199d87670de0b6b3a76400008702610ff0565b600283015560048201805460ff60d01b1916600160d01b179055600584015460a01c60ff1615611bbe576119dd65ffffffffffff43165b60048401610fb6565b855f52600560205260ff600260405f20015460a01c16611ae2575b5050906113076001957fc914f81e730ff0d8aed0d786714bd9591c0d726342263562329f4fe2463316cf94936004840154946005850154988995015490885f52600560205260018060a01b03600160405f20015416895f52600560205263ffffffff60e01b600160405f20015416908a5f52600560205260ff600260405f20015460a01c16928b5f52600560205263ffffffff600160405f20015460c01c16946040519a8b9a60018060a01b03169f60018060a01b0382169f8c429b60ff8360a01c169665ffffffffffff8460e81c9660a01c169462ffffff808660c01c169560a81c169361100e565b5f8681526005602090815260408083206001908101546006845282852060a091821c63ffffffff168087529452919093208881558084018b905560039590950154959796959294919392611b4392911c65ffffffffffff1690600201610fb6565b865f52600660205260405f20825f52602052600260405f200190838060a01b0316838060a01b03198254161790550163ffffffff81116109db575f8581526005602052604090206001908101805463ffffffff60a01b191660a09390931b63ffffffff60a01b169290921790915591929091611307906119f8565b6119dd65ffffffffffff42166119d4565b61198965ffffffffffff4316611980565b60058c0154611bf892906001600160a01b0316612dde565b8d5f6118ce565b60058d0154611c1b9190309033906001600160a01b0316612d4c565b5f6118c7565b50505f906118c1565b5f926118b1565b5050506001830183116109db576118f36118fd928d8d600187019461189c565b8960058894939401549162989680611c7162ffffff8560a81c1686610fdd565b04938362989680611c8b62ffffff889760c01c1684610fdd565b04925f52600360205260405f209060018060a01b039060018060a01b0316165f5260205260405f20611cbe838254610aa5565b905589866001820154115f14611e1757611cf8611d67956118ee856064611cf161ffff60058998015460d81c168d610fdd565b0497610aa5565b10611e0e57848d611d1683611d11846118ee8886610aa5565b6123f8565b935b83611d27846118ee8486610aa5565b1015611e0357611d11611d1192611d3d956123f8565b905b80611de1575b5080611dc1575b5060048801546001600160a01b0316906118f3908590610aa5565b600486015460038501546001600160a01b039081169391166001600160ff1b03821682036109db57611dbc93611da09260011b91612dde565b600586015460038501546001600160a01b039081169116612dde565b61193c565b6005890154611ddb91908e906001600160a01b0316612dde565b5f611d4c565b60058a0154611dfd9190309033906001600160a01b0316612d4c565b5f611d45565b505050505f90611d3f565b848d5f93611d18565b50915091506001840184116109db5781818c92611cf8866118ee611d679760018b0197610aa5565b9394929391929091906001600160a01b03878116908416036121095715611fb55750508960058801549362989680611e7f62ffffff8760a81c1686610fdd565b049462989680611e9762ffffff8360c01c1687610fdd565b04915f52600360205260405f209060018060a01b039060018060a01b0316165f5260205260405f20611eca828254610aa5565b905588836001820154115f14611f955790611f32936064611ef961ffff60056118f396015460d81c1683610fdd565b04905b80821115611f8d57611f0d916123f8565b80611f6b575b5060058a01546001600160a01b0316926118ee90879082908890610aa5565b600586015460038501546001600160a01b03918216929116906001600160ff1b03811681036109db57611dbc936119369160011b610aa5565b60048b0154611f879190309033906001600160a01b0316612d4c565b5f611f13565b50505f611f0d565b5090506001820182116109db576118f38b91836001611f32950190611efc565b62989680611fd462ffffff82611825828760a89b989a9b1c1688610fdd565b04915f52600360205260405f209060018060a01b03165f5260205260405f20611ffe828254610aa5565b9055816001890154115f146120ee5761203a90612034606461202b61ffff60058d015460d81c1686610fdd565b04915b85610aa5565b90610aa5565b90808211156120e65761204c916123f8565b806120c4575b50600586015461206f906001600160a01b03166118f3848c610aa5565b600586015460038501546001600160a01b039081169391166001600160ff1b03821682036109db57611dbc936120a89260011b91612dde565b600486015460038501546001600160a01b039081169116612dde565b60048701546120e09190309033906001600160a01b0316612d4c565b5f612052565b50505f61204c565b6001820182116109db5761203a90612034600184019161202e565b60405163d647364f60e01b815260206004820152600d60248201526c0746f6b656e20746f207377617609c1b6044820152606490fd5b60405163d647364f60e01b815260206004820152601060248201526f6469737075746572206164647265737360801b6044820152606490fd5b60405163a559139960e01b815260206004820152602160248201527f616d6f756e743220646f65736e2774206d61746368206578706563746174696f6044820152603760f91b6064820152608490fd5b604051637a72dbcd60e11b815260206004820152601760248201527670726963652077697468696e20626f756e64617269657360481b6044820152606490fd5b111590505f80611794565b60405163b2fe248560e01b815280610eb360048201612e67565b61224090828660e81c9160a01c166109bd565b1665ffffffffffff431610156116b75760405163b2fe248560e01b815280610eb360048201612e67565b506001600160a01b03878116908616141561168b565b604051627ef01b60e91b815260206004820152600e60248201526d1c995c1bdc9d081cd95d1d1b195960921b6044820152606490fd5b60405163b2fe248560e01b815280610eb360048201612e36565b65ffffffffffff6122ef8160048c015460a01c16828860a01c166109bd565b1665ffffffffffff4316111561165f5760405163b2fe248560e01b815280610eb360048201612e36565b63419dba4b60e11b5f5260045ffd5b60405163d647364f60e01b815260206004820152600d60248201526c746f6b656e20616d6f756e747360981b6044820152606490fd5b50881561160b565b6123a457604051637a72dbcd60e11b8152602060048201526011602482015270195cd8d85b185d1a5bdb881a185b1d1959607a1b6044820152606490fd5b60405163d647364f60e01b815260206004820152600a6024820152691b995dc8185b5bdd5b9d60b21b6044820152606490fd5b5060018101809111156115d657634e487b7160e01b5f52601160045260245ffd5b919082039182116109db57565b805460ff60a01b191691151560a01b60ff60a01b16919091179055565b6064341115612d2057805115612ceb57606081015160e08201516001600160a01b03908116911614612cdc5765ffffffffffff60808201511662ffffff60a08301511611612c98576040810151341115612c5d5762ffffff6101208201511615612c255762ffffff6101208201511662ffffff60c0830151160162ffffff81116109db5762ffffff62989680911611612bf1575f54905f1982146109db5760018281015f9081558381526020919091526040902060608201516004820180546001600160a01b0319166001600160a01b0392831617815560e084015160058401805486518655610120870151610140880151600168ffff000000ffffff0160a01b0319909216939095169290921760a89490941b62ffffff60a81b169390931760d89190911b61ffff60d81b161790915560808301519192916125709165ffffffffffff9190911690610fb6565b61257e6040820151346123f8565b60028301556020810151600183015560a0810151600583015462ffffff60c01b60c084015160c01b169162ffffff60e81b9060e81b1690600164ffff00000160c01b031617176005830155604081015160038301556125e7610160820151151560058401612405565b5f8381526005602052604090206101c08201516001820180546101e08501516001600160e01b0319166001600160a01b03909316600160a01b600160e01b039091161791909117905561018082015190929061264890151560028501612405565b6101008201516001848101805463ffffffff60c01b191660c09390931b63ffffffff60c01b16929092179091556101a0830151600285018054610200860151610220870151600162ffff0160a01b031990921693151560a81b60ff60a81b16939093176001600160a01b03939093169290921791151560b01b60ff60b01b1691909117905561016083015160405190151560f81b602082019081529181526126f1602182610a44565b519020906080830151604051602081019160018060d01b03199060d01b16825260068152612720602682610a44565b519020610100528260a0810151604051602081019162ffffff60e81b9060e81b16825260038152612752602382610a44565b519020916101c0820151604051602081019160018060601b03199060601b16825260148152612782603482610a44565b5190209063ffffffff60e01b6101e08401511660405160208101918252600481526127ae602482610a44565b51902090610100840151604051602081019163ffffffff60e01b9060e01b168252600481526127de602482610a44565b519020906101a08501511515604051602081019160f81b825260018152612806602182610a44565b519020610120860151604051602081019162ffffff60e81b9060e81b16825260038152612834602382610a44565b51902060c0870151604051602081019162ffffff60e81b9060e81b16825260038152612861602382610a44565b51902091600260408901516040516020810191825260208152612885604082610a44565b51902094015460405160208101918252602081526128a4604082610a44565b519020946101808901511515604051602081019160f81b8252600181526128cc602182610a44565b519020966101408a0151604051602081019161ffff60f01b9060f01b168252600281526128fa602282610a44565b5190209861022060208c0151604051602081019182526020815261291f604082610a44565b5190209b01511515604051602081019160f81b825260018152612943602182610a44565b5190209b60405160208101903360601b825260148152612964603482610a44565b5190206040514360d01b6001600160d01b0319166020820190815260068252919f9190612992602682610a44565b51902060a0526040514260d01b6001600160d01b0319166020820190815260068252906129c0602682610a44565b51902060e05260405160c052602060c051015261010051604060c0510152606060c0510152608060c051015260a060c051015260c08051015260e060c051015261010060c051015261012060c051015261014060c051015261016060c051015261018060c05101526101a060c05101526101c060c05101526101e060c051015261020060c051015260a05161022060c051015260e05161024060c051015261024060c05152612a7361026060c051610a44565b60c05151602060c051012080925560018060a01b036060820151169060018060a01b0360e0820151169262ffffff61012083015116918080808061ffff61014082015116815165ffffffffffff608084015116602084015162ffffff60a0860151169062ffffff60c087015116926040870151946101608801511515966102206101a063ffffffff6101006101808d6101c060018060a01b03910151169d6101e08460e01b910151169e015115159e0151169d015115159d015115159e60405160805260805152602060805101526040608051015234606060805101523360808051015260a0608051015260c0608051015260e06080510152610100608051015261012060805101526101406080510152610160608051015261018060805101526101a060805101526101c060805101526101e0608051015261020060805101524261022060805101526102406080510152827fc9d9836f54a918dcd0410f5e54abb43abe66b4360716a45cb4d9f142aaf3c01a610260608051a490565b60405163d647364f60e01b815260206004820152600b60248201526a73756d206f66206665657360a81b6044820152606490fd5b60405163d647364f60e01b815260206004820152600f60248201526e066656550657263656e74616765203608c1b6044820152606490fd5b60405163240bf61760e11b8152602060048201526012602482015271736574746c6572207265776172642066656560701b6044820152606490fd5b60405163b2fe248560e01b815260206004820152601b60248201527a736574746c656d656e7420767320646973707574652064656c617960281b6044820152606490fd5b6340ccdec360e11b5f5260045ffd5b60405163d647364f60e01b815260206004820152600c60248201526b1d1bdad95b88185b5bdd5b9d60a21b6044820152606490fd5b60405163240bf61760e11b815260206004820152600360248201526266656560e81b6044820152606490fd5b6040516323b872dd60e01b5f9081526001600160a01b039384166004529290931660245260449390935260209060648180865af19060015f5114821615612dbd575b6040525f60605215612d9d5750565b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b906001811516612dd557823b15153d15161690612d8e565b503d5f823e3d90fd5b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f5114821615612e1e575b60405215612d9d5750565b906001811516612dd557823b15153d15161690612e13565b606090602081526016602082015275191a5cdc1d5d19481c195c9a5bd908195e1c1a5c995960521b60408201520190565b6060906020815260116020820152706469737075746520746f6f206561726c7960781b6040820152019056fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220428d0ebc94393e9e5972e079bae2bf17df5dcd929dbd6aaf6ef8039a8271826064736f6c63430008210033'
		}
	}
}
export declare const peripherals_openOracle_openzeppelin_contracts_interfaces_IERC1363_IERC1363: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approveAndCall'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approveAndCall'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'data'
					readonly type: 'bytes'
					readonly internalType: 'bytes'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'supportsInterface'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'interfaceId'
					readonly type: 'bytes4'
					readonly internalType: 'bytes4'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferAndCall'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferAndCall'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'data'
					readonly type: 'bytes'
					readonly internalType: 'bytes'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFromAndCall'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'data'
					readonly type: 'bytes'
					readonly internalType: 'bytes'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFromAndCall'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_openOracle_openzeppelin_contracts_token_ERC20_IERC20_IERC20: {
	readonly abi: readonly [
		{
			readonly type: 'event'
			readonly name: 'Approval'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Transfer'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'allowance'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'approve'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transfer'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'transferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_openOracle_openzeppelin_contracts_token_ERC20_utils_SafeERC20_SafeERC20: {
	readonly abi: readonly [
		{
			readonly type: 'error'
			readonly name: 'SafeERC20FailedDecreaseAllowance'
			readonly inputs: readonly [
				{
					readonly name: 'spender'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'currentAllowance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'requestedDecrease'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'error'
			readonly name: 'SafeERC20FailedOperation'
			readonly inputs: readonly [
				{
					readonly name: 'token'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea2646970667358221220fd46f05bf402f06b66d0665a79548fe4d22c66d7c49bcef71bc67073ec7eaae364736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '5f80fdfea2646970667358221220fd46f05bf402f06b66d0665a79548fe4d22c66d7c49bcef71bc67073ec7eaae364736f6c63430008210033'
		}
	}
}
export declare const peripherals_openOracle_openzeppelin_contracts_utils_ReentrancyGuard_ReentrancyGuard: {
	readonly abi: readonly [
		{
			readonly type: 'error'
			readonly name: 'ReentrancyGuardReentrantCall'
			readonly inputs: readonly []
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_openOracle_openzeppelin_contracts_utils_StorageSlot_StorageSlot: {
	readonly abi: readonly []
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea26469706673582212206a4c201e853be43f105dc6874d7c580cae94247c9e8f7ee7038290b0a4a0577a64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '5f80fdfea26469706673582212206a4c201e853be43f105dc6874d7c580cae94247c9e8f7ee7038290b0a4a0577a64736f6c63430008210033'
		}
	}
}
export declare const peripherals_openOracle_openzeppelin_contracts_utils_introspection_IERC165_IERC165: {
	readonly abi: readonly [
		{
			readonly type: 'function'
			readonly name: 'supportsInterface'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'interfaceId'
					readonly type: 'bytes4'
					readonly internalType: 'bytes4'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: ''
		}
		readonly deployedBytecode: {
			readonly object: ''
		}
	}
}
export declare const peripherals_tokens_ERC1155_ERC1155: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly []
		},
		{
			readonly type: 'event'
			readonly name: 'ApprovalForAll'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'approved'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TransferBatch'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'values'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TransferSingle'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'URI'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'value'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: '_balances'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: '_operatorApprovals'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: '_supplies'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfBatch'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'accounts'
					readonly type: 'address[]'
					readonly internalType: 'address[]'
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isApprovedForAll'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'safeBatchTransferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: 'values'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'safeTransferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setApprovalForAll'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'approved'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60808060405234601557610b30908161001a8239f35b5f80fdfe6080806040526004361015610012575f80fd5b5f3560e01c908162fdd58e14610628575080630febdd4914610521578063175e9523146101e25780634e1273f4146102ef578063a22cb4651461020c578063bd85b039146101e2578063e985e9c5146101ac578063edc3bc3f14610155578063fba0ee64146100d05763fc25a4da14610089575f80fd5b346100cc5760403660031901126100cc576100a26106e8565b6004355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b5f80fd5b346100cc5760803660031901126100cc576100e96106d2565b6100f16106e8565b906044356001600160401b0381116100cc576101119036906004016107c3565b926064356001600160401b0381116100cc576101539461014561013b61014d9336906004016107c3565b959092369161074e565b93369161074e565b9261092c565b005b346100cc5760403660031901126100cc5761016e6106d2565b6101766106e8565b9060018060a01b03165f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b346100cc5760403660031901126100cc5760206101d86101ca6106d2565b6101d26106e8565b9061081b565b6040519015158152f35b346100cc5760203660031901126100cc576004355f526001602052602060405f2054604051908152f35b346100cc5760403660031901126100cc576102256106d2565b602435908115158092036100cc576001600160a01b03169033821461029557335f52600260205260405f20825f5260205260405f2060ff1981541660ff83161790556040519081527f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c3160203392a3005b60405162461bcd60e51b815260206004820152602c60248201527f455243313135353a2063616e6e6f742073657420617070726f76616c2073746160448201526b3a3ab9903337b91039b2b63360a11b6064820152608490fd5b346100cc5760403660031901126100cc576004356001600160401b0381116100cc57366023820112156100cc57806004013561033261032d82610737565b6106fe565b916024602084848152019260051b820101903682116100cc57602401915b81831061050157836024356001600160401b0381116100cc57366023820112156100cc5761038890369060248160040135910161074e565b9080518251036104a35780516103a061032d82610737565b908082526103b0601f1991610737565b013660208301375f5b8251811015610489576001600160a01b036103d482856107f3565b51161561042757806103e8600192866107f3565b515f525f60205260405f20828060a01b0361040383876107f3565b5116838060a01b03165f5260205260405f205461042082856107f3565b52016103b9565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a20736f6d65206164647265737320696e2062617463682062604482015273616c616e6365207175657279206973207a65726f60601b6064820152608490fd5b6040516020808252819061049f90820185610790565b0390f35b60405162461bcd60e51b815260206004820152603060248201527f455243313135353a206163636f756e747320616e6420494473206d757374206860448201526f6176652073616d65206c656e6774687360801b6064820152608490fd5b82356001600160a01b03811681036100cc57815260209283019201610350565b346100cc5760803660031901126100cc5761053a6106d2565b6105426106e8565b6001600160a01b03169060443560643561055d841515610863565b6001600160a01b0383169261057d90338514908115610610575b506108c0565b815f525f60205260405f20835f5260205261059c8160405f2054610acc565b5f838152602081815260408083208784529091528082209290925585815220546105c7908290610aed565b825f525f60205260405f20855f5260205260405f205560405191825260208201527fc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f6260403392a4005b6001915061061f90339061081b565b15151486610577565b346100cc5760403660031901126100cc576106416106d2565b906001600160a01b0382161561067c57506024355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b62461bcd60e51b815260206004820152602b60248201527f455243313135353a2062616c616e636520717565727920666f7220746865207a60448201526a65726f206164647265737360a81b6064820152608490fd5b600435906001600160a01b03821682036100cc57565b602435906001600160a01b03821682036100cc57565b6040519190601f01601f191682016001600160401b0381118382101761072357604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116107235760051b60200190565b92919061075d61032d82610737565b93818552602085019160051b81019283116100cc57905b82821061078057505050565b8135815260209182019101610774565b90602080835192838152019201905f5b8181106107ad5750505090565b82518452602093840193909201916001016107a0565b9181601f840112156100cc578235916001600160401b0383116100cc576020808501948460051b0101116100cc57565b80518210156108075760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b6001600160a01b03821630149190821561083457505090565b6001600160a01b039081165f90815260026020908152604080832093909416825291909152205460ff16919050565b1561086a57565b60405162461bcd60e51b815260206004820152602860248201527f455243313135353a207461726765742061646472657373206d757374206265206044820152676e6f6e2d7a65726f60c01b6064820152608490fd5b156108c757565b60405162461bcd60e51b815260206004820152603760248201527f455243313135353a206e656564206f70657261746f7220617070726f76616c20604482015276666f7220337264207061727479207472616e736665727360481b6064820152608490fd5b939291908151835103610a7057815115610a69576001600160a01b031690610955821515610863565b6001600160a01b0385169461097490338714908115610a5157506108c0565b5f5b81518110156109fb578061098c600192846107f3565b516109df61099a83886107f3565b51825f525f60205260405f208a5f526020526109ba8160405f2054610acc565b5f848152602081815260408083208e8452909152808220929092558881522054610aed565b905f525f60205260405f20855f5260205260405f205501610976565b50610a3d7f4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb919593929495610a4c604051928392604084526040840190610790565b82810360208401523395610790565b0390a4565b60019150610a6090339061081b565b1515145f610577565b5050509050565b60405162461bcd60e51b815260206004820152602e60248201527f455243313135353a2049447320616e642076616c756573206d7573742068617660448201526d652073616d65206c656e6774687360901b6064820152608490fd5b91908203918211610ad957565b634e487b7160e01b5f52601160045260245ffd5b91908201809211610ad95756fea264697066735822122033aa85629ff351c4ebcc30a6a016d2354aa2a49729921dbe02596b40d7eb2c6d64736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '6080806040526004361015610012575f80fd5b5f3560e01c908162fdd58e14610628575080630febdd4914610521578063175e9523146101e25780634e1273f4146102ef578063a22cb4651461020c578063bd85b039146101e2578063e985e9c5146101ac578063edc3bc3f14610155578063fba0ee64146100d05763fc25a4da14610089575f80fd5b346100cc5760403660031901126100cc576100a26106e8565b6004355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b5f80fd5b346100cc5760803660031901126100cc576100e96106d2565b6100f16106e8565b906044356001600160401b0381116100cc576101119036906004016107c3565b926064356001600160401b0381116100cc576101539461014561013b61014d9336906004016107c3565b959092369161074e565b93369161074e565b9261092c565b005b346100cc5760403660031901126100cc5761016e6106d2565b6101766106e8565b9060018060a01b03165f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b346100cc5760403660031901126100cc5760206101d86101ca6106d2565b6101d26106e8565b9061081b565b6040519015158152f35b346100cc5760203660031901126100cc576004355f526001602052602060405f2054604051908152f35b346100cc5760403660031901126100cc576102256106d2565b602435908115158092036100cc576001600160a01b03169033821461029557335f52600260205260405f20825f5260205260405f2060ff1981541660ff83161790556040519081527f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c3160203392a3005b60405162461bcd60e51b815260206004820152602c60248201527f455243313135353a2063616e6e6f742073657420617070726f76616c2073746160448201526b3a3ab9903337b91039b2b63360a11b6064820152608490fd5b346100cc5760403660031901126100cc576004356001600160401b0381116100cc57366023820112156100cc57806004013561033261032d82610737565b6106fe565b916024602084848152019260051b820101903682116100cc57602401915b81831061050157836024356001600160401b0381116100cc57366023820112156100cc5761038890369060248160040135910161074e565b9080518251036104a35780516103a061032d82610737565b908082526103b0601f1991610737565b013660208301375f5b8251811015610489576001600160a01b036103d482856107f3565b51161561042757806103e8600192866107f3565b515f525f60205260405f20828060a01b0361040383876107f3565b5116838060a01b03165f5260205260405f205461042082856107f3565b52016103b9565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a20736f6d65206164647265737320696e2062617463682062604482015273616c616e6365207175657279206973207a65726f60601b6064820152608490fd5b6040516020808252819061049f90820185610790565b0390f35b60405162461bcd60e51b815260206004820152603060248201527f455243313135353a206163636f756e747320616e6420494473206d757374206860448201526f6176652073616d65206c656e6774687360801b6064820152608490fd5b82356001600160a01b03811681036100cc57815260209283019201610350565b346100cc5760803660031901126100cc5761053a6106d2565b6105426106e8565b6001600160a01b03169060443560643561055d841515610863565b6001600160a01b0383169261057d90338514908115610610575b506108c0565b815f525f60205260405f20835f5260205261059c8160405f2054610acc565b5f838152602081815260408083208784529091528082209290925585815220546105c7908290610aed565b825f525f60205260405f20855f5260205260405f205560405191825260208201527fc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f6260403392a4005b6001915061061f90339061081b565b15151486610577565b346100cc5760403660031901126100cc576106416106d2565b906001600160a01b0382161561067c57506024355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b62461bcd60e51b815260206004820152602b60248201527f455243313135353a2062616c616e636520717565727920666f7220746865207a60448201526a65726f206164647265737360a81b6064820152608490fd5b600435906001600160a01b03821682036100cc57565b602435906001600160a01b03821682036100cc57565b6040519190601f01601f191682016001600160401b0381118382101761072357604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116107235760051b60200190565b92919061075d61032d82610737565b93818552602085019160051b81019283116100cc57905b82821061078057505050565b8135815260209182019101610774565b90602080835192838152019201905f5b8181106107ad5750505090565b82518452602093840193909201916001016107a0565b9181601f840112156100cc578235916001600160401b0383116100cc576020808501948460051b0101116100cc57565b80518210156108075760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b6001600160a01b03821630149190821561083457505090565b6001600160a01b039081165f90815260026020908152604080832093909416825291909152205460ff16919050565b1561086a57565b60405162461bcd60e51b815260206004820152602860248201527f455243313135353a207461726765742061646472657373206d757374206265206044820152676e6f6e2d7a65726f60c01b6064820152608490fd5b156108c757565b60405162461bcd60e51b815260206004820152603760248201527f455243313135353a206e656564206f70657261746f7220617070726f76616c20604482015276666f7220337264207061727479207472616e736665727360481b6064820152608490fd5b939291908151835103610a7057815115610a69576001600160a01b031690610955821515610863565b6001600160a01b0385169461097490338714908115610a5157506108c0565b5f5b81518110156109fb578061098c600192846107f3565b516109df61099a83886107f3565b51825f525f60205260405f208a5f526020526109ba8160405f2054610acc565b5f848152602081815260408083208e8452909152808220929092558881522054610aed565b905f525f60205260405f20855f5260205260405f205501610976565b50610a3d7f4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb919593929495610a4c604051928392604084526040840190610790565b82810360208401523395610790565b0390a4565b60019150610a6090339061081b565b1515145f610577565b5050509050565b60405162461bcd60e51b815260206004820152602e60248201527f455243313135353a2049447320616e642076616c756573206d7573742068617660448201526d652073616d65206c656e6774687360901b6064820152608490fd5b91908203918211610ad957565b634e487b7160e01b5f52601160045260245ffd5b91908201809211610ad95756fea264697066735822122033aa85629ff351c4ebcc30a6a016d2354aa2a49729921dbe02596b40d7eb2c6d64736f6c63430008210033'
		}
	}
}
export declare const peripherals_tokens_ShareToken_ShareToken: {
	readonly abi: readonly [
		{
			readonly type: 'constructor'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_zoltar'
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
				{
					readonly name: 'questionId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'ApprovalForAll'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'owner'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'approved'
					readonly type: 'bool'
					readonly internalType: 'bool'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Authorized'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'securityPool'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'Migrate'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'migrator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: false
				},
				{
					readonly name: 'fromId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'toId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'fromIdBalance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TransferBatch'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
				{
					readonly name: 'values'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'TransferSingle'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
					readonly indexed: true
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: false
				},
			]
		},
		{
			readonly type: 'event'
			readonly name: 'URI'
			readonly anonymous: false
			readonly inputs: readonly [
				{
					readonly name: 'value'
					readonly type: 'string'
					readonly internalType: 'string'
					readonly indexed: false
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
					readonly indexed: true
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: '_balances'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: '_operatorApprovals'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: '_supplies'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'authorize'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_securityPoolCandidate'
					readonly type: 'address'
					readonly internalType: 'contract ISecurityPool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOf'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfBatch'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'accounts'
					readonly type: 'address[]'
					readonly internalType: 'address[]'
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'balanceOfShares'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'balances'
					readonly type: 'uint256[3]'
					readonly internalType: 'uint256[3]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'burnCompleteSets'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_amount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'burnTokenId'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: '_owner'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: 'balance'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getChildUniverseId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: 'universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: 'outcomeIndex'
					readonly type: 'uint8'
					readonly internalType: 'uint8'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getTokenId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: '_tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'getTokenIds'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcomes'
					readonly type: 'uint8[]'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome[]'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: '_tokenIds'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'isApprovedForAll'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'migrate'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'fromId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'mintCompleteSets'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_account'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: '_cashAmount'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'name'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'safeBatchTransferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'ids'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
				{
					readonly name: 'values'
					readonly type: 'uint256[]'
					readonly internalType: 'uint256[]'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'safeTransferFrom'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'from'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'to'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
				{
					readonly name: 'value'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'setApprovalForAll'
			readonly stateMutability: 'nonpayable'
			readonly inputs: readonly [
				{
					readonly name: 'operator'
					readonly type: 'address'
					readonly internalType: 'address'
				},
				{
					readonly name: 'approved'
					readonly type: 'bool'
					readonly internalType: 'bool'
				},
			]
			readonly outputs: readonly []
		},
		{
			readonly type: 'function'
			readonly name: 'symbol'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'string'
					readonly internalType: 'string'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupply'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: 'id'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'totalSupplyForOutcome'
			readonly stateMutability: 'view'
			readonly inputs: readonly [
				{
					readonly name: '_universeId'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'unpackTokenId'
			readonly stateMutability: 'pure'
			readonly inputs: readonly [
				{
					readonly name: '_tokenId'
					readonly type: 'uint256'
					readonly internalType: 'uint256'
				},
			]
			readonly outputs: readonly [
				{
					readonly name: '_universe'
					readonly type: 'uint248'
					readonly internalType: 'uint248'
				},
				{
					readonly name: '_outcome'
					readonly type: 'uint8'
					readonly internalType: 'enum BinaryOutcomes.BinaryOutcome'
				},
			]
		},
		{
			readonly type: 'function'
			readonly name: 'zoltar'
			readonly stateMutability: 'view'
			readonly inputs: readonly []
			readonly outputs: readonly [
				{
					readonly name: ''
					readonly type: 'address'
					readonly internalType: 'contract Zoltar'
				},
			]
		},
	]
	readonly evm: {
		readonly bytecode: {
			readonly object: '60a080604052346103cf57606081611ff9803803809161001f82856103d3565b8339810103126103cf5780516001600160a01b03811691908290036103cf5760208101516001600160a01b03811681036103cf57604061006492015190608052610411565b9060405191665368617265732d60c81b60208401528051926100a3602782602085019680888484015e81015f838201520301601f1981018352826103d3565b8051906001600160401b0382116102cd57600354600181811c911680156103c5575b60208210146102af57601f8111610357575b50602090601f83116001146102ec57918061013e94926026945f926102e1575b50508160011b915f199060031b1c1916176003555b6040519485916553484152452d60d01b60208401525180918484015e81015f838201520301601f1981018452836103d3565b81516001600160401b0381116102cd57600454600181811c911680156102c3575b60208210146102af57601f8111610241575b50602092601f82116001146101e057928192935f926101d5575b50508160011b915f199060031b1c1916176004555b5f52600560205260405f20600160ff19825416179055604051611ae290816105178239608051818181610bf60152610eb70152f35b015190505f8061018b565b601f1982169360045f52805f20915f5b8681106102295750836001959610610211575b505050811b016004556101a0565b01515f1960f88460031b161c191690555f8080610203565b919260206001819286850151815501940192016101f0565b818111156101715760045f52601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b602084106102a7575b81601f9101920160051c03905f5b82811061029a575050610171565b5f8282015560010161028c565b5f915061027e565b634e487b7160e01b5f52602260045260245ffd5b90607f169061015f565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100f7565b90601f1983169160035f52815f20925f5b81811061033f575092600192859260269661013e989610610327575b505050811b0160035561010c565b01515f1960f88460031b161c191690555f8080610319565b929360206001819287860151815501950193016102fd565b828111156100d75760035f52601f830160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b602085106103bd575b81601f9101920160051c03905f5b8281106103b05750506100d7565b5f828201556001016103a2565b5f9150610394565b90607f16906100c5565b5f80fd5b601f909101601f19168101906001600160401b038211908210176102cd57604052565b6001600160401b0381116102cd57601f01601f191660200190565b80156104f6575f81805b6104df5750610429816103f6565b9061043760405192836103d3565b808252601f19610446826103f6565b013660208401375b8083156104d85780156104c4575f190192600a810660300191826030116104c45783518510156104b057600a9260f81b7fff00000000000000000000000000000000000000000000000000000000000000165f1a908401601f0153049161044e565b634e487b7160e01b5f52603260045260245ffd5b634e487b7160e01b5f52601160045260245ffd5b5050905090565b905f1981146104c4576001600a910191048061041b565b506040516105056040826103d3565b60018152600360fc1b60208201529056fe60806040526004361015610011575f80fd5b5f3560e01c8062fdd58e1461134157806306fdde03146112865780630febdd4914611192578063175e95231461055057806326afd2e81461115d578063378f2ab21461110e578063454b060814610e815780634e1273f414610c7f5780634f4dc53614610c255780634fffd03714610be157806380e15c4014610aed5780639471b662146108a657806395d89b41146107a25780639c5996d61461070c578063a22cb46514610629578063a2d57491146105f5578063b6a5d7de1461057a578063bd85b03914610550578063d24cd713146102ef578063d9b46740146102c9578063e8324bb614610284578063e985e9c51461024e578063edc3bc3f146101f7578063fba0ee64146101725763fc25a4da1461012b575f80fd5b3461016e57604036600319011261016e5761014461137e565b6004355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b5f80fd5b3461016e57608036600319011261016e5761018b611368565b61019361137e565b906044356001600160401b03811161016e576101b390369060040161150a565b926064356001600160401b03811161016e576101f5946101e76101dd6101ef93369060040161150a565b959092369161140c565b93369161140c565b926118f6565b005b3461016e57604036600319011261016e57610210611368565b61021861137e565b9060018060a01b03165f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b3461016e57604036600319011261016e57602061027a61026c611368565b61027461137e565b906116b9565b6040519015158152f35b3461016e57604036600319011261016e5761029d61148b565b6024359060ff8216820361016e576020916102b79161167f565b6040516001600160f81b039091168152f35b3461016e5760206102d9366114db565b9060ff60405192169060ff199060081b16178152f35b3461016e576102fd366114a1565b335f52600560205261031a600160ff60405f2054161515146115c3565b60405192610329608085611394565b600384526060928336602087013760405193610346608086611394565b600385523660208601375f9160ff199060081b16915b60ff81169060038210156103ae57600482101561039a578461038f83610395948717610388828c611657565b5288611657565b52611600565b61035c565b634e487b7160e01b5f52602160045260245ffd5b6001600160a01b038316868882156104fb578051825103610498575f5b8151811015610471578061040b6103e460019386611657565b516103ef8386611657565b515f525f60205260405f20875f5260205260405f2054906118c1565b6104158285611657565b515f525f60205260405f20865f5260205260405f20556104358184611657565b515f528160205261045560405f205461044e8387611657565b51906118c1565b61045f8285611657565b515f528260205260405f2055016103cb565b505f516020611a6d5f395f51905f526104935f936040519182913395836118ce565b0390a4005b60405162461bcd60e51b815260206004820152603560248201527f455243313135353a206d696e7465642049447320616e642076616c756573206d60448201527475737420686176652073616d65206c656e6774687360581b6064820152608490fd5b60405162461bcd60e51b815260206004820152602760248201527f455243313135353a206261746368206d696e7420746f20746865207a65726f206044820152666164647265737360c81b6064820152608490fd5b3461016e57602036600319011261016e576004355f526001602052602060405f2054604051908152f35b3461016e57602036600319011261016e576004356001600160a01b0381169081900361016e57335f5260056020526105b860ff60405f2054166115c3565b805f52600560205260405f20600160ff198254161790557fdc84e3a4c83602050e3865df792a4e6800211a79ac60db94e703a820ce8929245f80a2005b3461016e5760ff610605366114db565b919091169060ff199060081b16175f526001602052602060405f2054604051908152f35b3461016e57604036600319011261016e57610642611368565b6024359081151580920361016e576001600160a01b0316903382146106b257335f52600260205260405f20825f5260205260405f2060ff1981541660ff83161790556040519081527f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c3160203392a3005b60405162461bcd60e51b815260206004820152602c60248201527f455243313135353a2063616e6e6f742073657420617070726f76616c2073746160448201526b3a3ab9903337b91039b2b63360a11b6064820152608490fd5b3461016e57604036600319011261016e5761072561148b565b61077261073061137e565b600260405193610741606086611394565b606036863760081b60ff1916610757818461153a565b8552610766600182178461153a565b6020860152179061153a565b604082015260405190815f905b6003821061078c57606084f35b602080600192855181520193019101909161077f565b3461016e575f36600319011261016e576040515f6004548060011c9060018116801561089c575b602083108114610888578285529081156108645750600114610806575b610802836107f681850382611394565b604051918291826113cb565b0390f35b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b80821061084a575090915081016020016107f66107e6565b919260018160209254838588010152019101909291610832565b60ff191660208086019190915291151560051b840190910191506107f690506107e6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916107c9565b3461016e576108b4366114a1565b335f5260056020526108d1600160ff60405f2054161515146115c3565b604051926108e0608085611394565b6003845260609283366020870137604051936108fd608086611394565b600385523660208601375f9160ff199060081b16915b60ff811690600382101561094457600482101561039a578461038f8361093f948717610388828c611657565b610913565b856001600160a01b038416888115610a84578051835103610a22575f5b8151811015610a00578061097760019284611657565b515f525f60205260405f20845f526020526109a160405f205461099a8388611657565b51906117ca565b6109ab8285611657565b515f525f60205260405f20855f5260205260405f20556109cb8184611657565b515f52816020526109e460405f205461099a8388611657565b6109ee8285611657565b515f528260205260405f205501610961565b505f516020611a6d5f395f51905f526104935f946040519182913395836118ce565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a206275726e742049447320616e642076616c756573206d75604482015273737420686176652073616d65206c656e6774687360601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603b60248201527f455243313135353a20617474656d7074696e6720746f206275726e206261746360448201527a1a081bd9881d1bdad95b9cc81bdb881e995c9bc81858d8dbdd5b9d602a1b6064820152608490fd5b3461016e57604036600319011261016e57610b0661148b565b602435906001600160401b03821161016e573660238301121561016e578160040135610b31816113f5565b92610b3f6040519485611394565b8184526024602085019260051b8201019036821161016e57602401915b818310610bc8578385610b6f8151611625565b5f9260ff199060081b16925b8251811015610bb257610b8e8184611657565b5190600482101561039a5760ff600192168517610bab8285611657565b5201610b7b565b6040516020808252819061080290820185611458565b8235600481101561016e57815260209283019201610b5c565b3461016e575f36600319011261016e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461016e57606036600319011261016e57610c3e61148b565b602435600481101561016e576044356001600160a01b038116810361016e5760209260ff610c7793169060ff199060081b16179061153a565b604051908152f35b3461016e57604036600319011261016e576004356001600160401b03811161016e573660238201121561016e578060040135610cba816113f5565b91610cc86040519384611394565b8183526024602084019260051b8201019036821161016e57602401915b818310610e6157836024356001600160401b03811161016e573660238201121561016e57610d1d90369060248160040135910161140c565b908051825103610e0357610d318151611625565b5f5b8251811015610bb2576001600160a01b03610d4e8285611657565b511615610da15780610d6260019286611657565b515f525f60205260405f20828060a01b03610d7d8387611657565b5116838060a01b03165f5260205260405f2054610d9a8285611657565b5201610d33565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a20736f6d65206164647265737320696e2062617463682062604482015273616c616e6365207175657279206973207a65726f60601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603060248201527f455243313135353a206163636f756e747320616e6420494473206d757374206860448201526f6176652073616d65206c656e6774687360801b6064820152608490fd5b82356001600160a01b038116810361016e57815260209283019201610ce5565b3461016e57602036600319011261016e576040516387ca99af60e01b815260048035600881901c918301829052916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115611103575f916110d1575b501561109257610eff823361153a565b91821561105557610f118382336117d7565b3380159160ff81165f5b600360ff821610610f2857005b849060ff19610f37828961167f565b60081b16831791611006577fc47a839c70aa320457c80c5abd38ce8b516c72e37be119b7962f67f1f8eb7ac2608083611001945f525f60205260405f20885f52602052610f888b60405f20546118c1565b815f525f60205260405f20895f5260205260405f2055805f526001602052610fb48b60405f20546118c1565b815f52600160205260405f20556040518181528b60208201525f33915f516020611a8d5f395f51905f5260403392a46040519033825287602083015260408201528a6060820152a1611600565b610f1b565b60405162461bcd60e51b815260206004820152602160248201527f455243313135353a206d696e7420746f20746865207a65726f206164647265736044820152607360f81b6064820152608490fd5b60405162461bcd60e51b81526020600482015260156024820152744e6f2062616c616e636520746f206d69677261746560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276155b9a5d995c9cd9481a185cc81b9bdd08199bdc9ad959604a1b6044820152606490fd5b90506020813d6020116110fb575b816110ec60209383611394565b8101031261016e575183610eef565b3d91506110df565b6040513d5f823e3d90fd5b3461016e57604036600319011261016e576020600435610c7761112f61137e565b335f526005845261114b600160ff60405f2054161515146115c3565b611155838261153a565b9283916117d7565b3461016e57602036600319011261016e5760043560ff8116906040519060081c8152600482101561039a576040916020820152f35b3461016e57608036600319011261016e576111ab611368565b6111b361137e565b6001600160a01b0316906044356064356111ce841515611701565b6001600160a01b038316926111ee9033851490811561126e575b5061175e565b815f525f60205260405f20835f5260205261120d8160405f20546117ca565b5f838152602081815260408083208784529091528082209290925585815220546112389082906118c1565b825f525f60205260405f20855f5260205260405f205560405191825260208201525f516020611a8d5f395f51905f5260403392a4005b6001915061127d9033906116b9565b151514866111e8565b3461016e575f36600319011261016e576040515f6003548060011c90600181168015611337575b6020831081146108885782855290811561086457506001146112d957610802836107f681850382611394565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061131d575090915081016020016107f66107e6565b919260018160209254838588010152019101909291611305565b91607f16916112ad565b3461016e57604036600319011261016e576020610c7761135f611368565b6024359061153a565b600435906001600160a01b038216820361016e57565b602435906001600160a01b038216820361016e57565b601f909101601f19168101906001600160401b038211908210176113b757604052565b634e487b7160e01b5f52604160045260245ffd5b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b6001600160401b0381116113b75760051b60200190565b929190611418816113f5565b936114266040519586611394565b602085838152019160051b810192831161016e57905b82821061144857505050565b813581526020918201910161143c565b90602080835192838152019201905f5b8181106114755750505090565b8251845260209384019390920191600101611468565b600435906001600160f81b038216820361016e57565b606090600319011261016e576004356001600160f81b038116810361016e57906024356001600160a01b038116810361016e579060443590565b604090600319011261016e576004356001600160f81b038116810361016e5790602435600481101561016e5790565b9181601f8401121561016e578235916001600160401b03831161016e576020808501948460051b01011161016e57565b906001600160a01b0382161561156a575f525f60205260405f209060018060a01b03165f5260205260405f205490565b60405162461bcd60e51b815260206004820152602b60248201527f455243313135353a2062616c616e636520717565727920666f7220746865207a60448201526a65726f206164647265737360a81b6064820152608490fd5b156115ca57565b60405162461bcd60e51b815260206004820152600e60248201526d1b9bdd08185d5d1a1bdc9a5e995960921b6044820152606490fd5b60ff1660ff81146116115760010190565b634e487b7160e01b5f52601160045260245ffd5b9061162f826113f5565b61163c6040519182611394565b828152809261164d601f19916113f5565b0190602036910137565b805182101561166b5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b60ff60405192602084019260018060f81b03168352166040830152604082526116a9606083611394565b905190206001600160f81b031690565b6001600160a01b0382163014919082156116d257505090565b6001600160a01b039081165f90815260026020908152604080832093909416825291909152205460ff16919050565b1561170857565b60405162461bcd60e51b815260206004820152602860248201527f455243313135353a207461726765742061646472657373206d757374206265206044820152676e6f6e2d7a65726f60c01b6064820152608490fd5b1561176557565b60405162461bcd60e51b815260206004820152603760248201527f455243313135353a206e656564206f70657261746f7220617070726f76616c20604482015276666f7220337264207061727479207472616e736665727360481b6064820152608490fd5b9190820391821161161157565b6001600160a01b0316908115611861575f9281845283602052604084208385526020526118088160408620546117ca565b8285528460205260408520848652602052604085205581845260016020526118348160408620546117ca565b8285526001602052604085205560405191825260208201525f516020611a8d5f395f51905f5260403392a4565b60405162461bcd60e51b815260206004820152603260248201527f455243313135353a20617474656d7074696e6720746f206275726e20746f6b656044820152711b9cc81bdb881e995c9bc81858d8dbdd5b9d60721b6064820152608490fd5b9190820180921161161157565b90916118e56118f393604084526040840190611458565b916020818403910152611458565b90565b90939291938451835103611a1057845115611a09576001600160a01b031690611920821515611701565b6001600160a01b0381169061193f903383149081156119f1575061175e565b5f5b85518110156119c6578061195760019288611657565b516119aa6119658388611657565b51825f525f60205260405f20865f526020526119858160405f20546117ca565b5f848152602081815260408083208a84529091528082209290925588815220546118c1565b905f525f60205260405f20855f5260205260405f205501611941565b50916119ec5f516020611a6d5f395f51905f5291959294956040519182913395836118ce565b0390a4565b60019150611a009033906116b9565b1515145f6111e8565b5050509050565b60405162461bcd60e51b815260206004820152602e60248201527f455243313135353a2049447320616e642076616c756573206d7573742068617660448201526d652073616d65206c656e6774687360901b6064820152608490fdfe4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fbc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62a26469706673582212205a0d93ed77b535fdfe0d8fc03cad1fddecd07041b195930912ed8e52afee8eb864736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '60806040526004361015610011575f80fd5b5f3560e01c8062fdd58e1461134157806306fdde03146112865780630febdd4914611192578063175e95231461055057806326afd2e81461115d578063378f2ab21461110e578063454b060814610e815780634e1273f414610c7f5780634f4dc53614610c255780634fffd03714610be157806380e15c4014610aed5780639471b662146108a657806395d89b41146107a25780639c5996d61461070c578063a22cb46514610629578063a2d57491146105f5578063b6a5d7de1461057a578063bd85b03914610550578063d24cd713146102ef578063d9b46740146102c9578063e8324bb614610284578063e985e9c51461024e578063edc3bc3f146101f7578063fba0ee64146101725763fc25a4da1461012b575f80fd5b3461016e57604036600319011261016e5761014461137e565b6004355f525f60205260405f209060018060a01b03165f52602052602060405f2054604051908152f35b5f80fd5b3461016e57608036600319011261016e5761018b611368565b61019361137e565b906044356001600160401b03811161016e576101b390369060040161150a565b926064356001600160401b03811161016e576101f5946101e76101dd6101ef93369060040161150a565b959092369161140c565b93369161140c565b926118f6565b005b3461016e57604036600319011261016e57610210611368565b61021861137e565b9060018060a01b03165f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b3461016e57604036600319011261016e57602061027a61026c611368565b61027461137e565b906116b9565b6040519015158152f35b3461016e57604036600319011261016e5761029d61148b565b6024359060ff8216820361016e576020916102b79161167f565b6040516001600160f81b039091168152f35b3461016e5760206102d9366114db565b9060ff60405192169060ff199060081b16178152f35b3461016e576102fd366114a1565b335f52600560205261031a600160ff60405f2054161515146115c3565b60405192610329608085611394565b600384526060928336602087013760405193610346608086611394565b600385523660208601375f9160ff199060081b16915b60ff81169060038210156103ae57600482101561039a578461038f83610395948717610388828c611657565b5288611657565b52611600565b61035c565b634e487b7160e01b5f52602160045260245ffd5b6001600160a01b038316868882156104fb578051825103610498575f5b8151811015610471578061040b6103e460019386611657565b516103ef8386611657565b515f525f60205260405f20875f5260205260405f2054906118c1565b6104158285611657565b515f525f60205260405f20865f5260205260405f20556104358184611657565b515f528160205261045560405f205461044e8387611657565b51906118c1565b61045f8285611657565b515f528260205260405f2055016103cb565b505f516020611a6d5f395f51905f526104935f936040519182913395836118ce565b0390a4005b60405162461bcd60e51b815260206004820152603560248201527f455243313135353a206d696e7465642049447320616e642076616c756573206d60448201527475737420686176652073616d65206c656e6774687360581b6064820152608490fd5b60405162461bcd60e51b815260206004820152602760248201527f455243313135353a206261746368206d696e7420746f20746865207a65726f206044820152666164647265737360c81b6064820152608490fd5b3461016e57602036600319011261016e576004355f526001602052602060405f2054604051908152f35b3461016e57602036600319011261016e576004356001600160a01b0381169081900361016e57335f5260056020526105b860ff60405f2054166115c3565b805f52600560205260405f20600160ff198254161790557fdc84e3a4c83602050e3865df792a4e6800211a79ac60db94e703a820ce8929245f80a2005b3461016e5760ff610605366114db565b919091169060ff199060081b16175f526001602052602060405f2054604051908152f35b3461016e57604036600319011261016e57610642611368565b6024359081151580920361016e576001600160a01b0316903382146106b257335f52600260205260405f20825f5260205260405f2060ff1981541660ff83161790556040519081527f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c3160203392a3005b60405162461bcd60e51b815260206004820152602c60248201527f455243313135353a2063616e6e6f742073657420617070726f76616c2073746160448201526b3a3ab9903337b91039b2b63360a11b6064820152608490fd5b3461016e57604036600319011261016e5761072561148b565b61077261073061137e565b600260405193610741606086611394565b606036863760081b60ff1916610757818461153a565b8552610766600182178461153a565b6020860152179061153a565b604082015260405190815f905b6003821061078c57606084f35b602080600192855181520193019101909161077f565b3461016e575f36600319011261016e576040515f6004548060011c9060018116801561089c575b602083108114610888578285529081156108645750600114610806575b610802836107f681850382611394565b604051918291826113cb565b0390f35b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b80821061084a575090915081016020016107f66107e6565b919260018160209254838588010152019101909291610832565b60ff191660208086019190915291151560051b840190910191506107f690506107e6565b634e487b7160e01b5f52602260045260245ffd5b91607f16916107c9565b3461016e576108b4366114a1565b335f5260056020526108d1600160ff60405f2054161515146115c3565b604051926108e0608085611394565b6003845260609283366020870137604051936108fd608086611394565b600385523660208601375f9160ff199060081b16915b60ff811690600382101561094457600482101561039a578461038f8361093f948717610388828c611657565b610913565b856001600160a01b038416888115610a84578051835103610a22575f5b8151811015610a00578061097760019284611657565b515f525f60205260405f20845f526020526109a160405f205461099a8388611657565b51906117ca565b6109ab8285611657565b515f525f60205260405f20855f5260205260405f20556109cb8184611657565b515f52816020526109e460405f205461099a8388611657565b6109ee8285611657565b515f528260205260405f205501610961565b505f516020611a6d5f395f51905f526104935f946040519182913395836118ce565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a206275726e742049447320616e642076616c756573206d75604482015273737420686176652073616d65206c656e6774687360601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603b60248201527f455243313135353a20617474656d7074696e6720746f206275726e206261746360448201527a1a081bd9881d1bdad95b9cc81bdb881e995c9bc81858d8dbdd5b9d602a1b6064820152608490fd5b3461016e57604036600319011261016e57610b0661148b565b602435906001600160401b03821161016e573660238301121561016e578160040135610b31816113f5565b92610b3f6040519485611394565b8184526024602085019260051b8201019036821161016e57602401915b818310610bc8578385610b6f8151611625565b5f9260ff199060081b16925b8251811015610bb257610b8e8184611657565b5190600482101561039a5760ff600192168517610bab8285611657565b5201610b7b565b6040516020808252819061080290820185611458565b8235600481101561016e57815260209283019201610b5c565b3461016e575f36600319011261016e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461016e57606036600319011261016e57610c3e61148b565b602435600481101561016e576044356001600160a01b038116810361016e5760209260ff610c7793169060ff199060081b16179061153a565b604051908152f35b3461016e57604036600319011261016e576004356001600160401b03811161016e573660238201121561016e578060040135610cba816113f5565b91610cc86040519384611394565b8183526024602084019260051b8201019036821161016e57602401915b818310610e6157836024356001600160401b03811161016e573660238201121561016e57610d1d90369060248160040135910161140c565b908051825103610e0357610d318151611625565b5f5b8251811015610bb2576001600160a01b03610d4e8285611657565b511615610da15780610d6260019286611657565b515f525f60205260405f20828060a01b03610d7d8387611657565b5116838060a01b03165f5260205260405f2054610d9a8285611657565b5201610d33565b60405162461bcd60e51b815260206004820152603460248201527f455243313135353a20736f6d65206164647265737320696e2062617463682062604482015273616c616e6365207175657279206973207a65726f60601b6064820152608490fd5b60405162461bcd60e51b815260206004820152603060248201527f455243313135353a206163636f756e747320616e6420494473206d757374206860448201526f6176652073616d65206c656e6774687360801b6064820152608490fd5b82356001600160a01b038116810361016e57815260209283019201610ce5565b3461016e57602036600319011261016e576040516387ca99af60e01b815260048035600881901c918301829052916020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115611103575f916110d1575b501561109257610eff823361153a565b91821561105557610f118382336117d7565b3380159160ff81165f5b600360ff821610610f2857005b849060ff19610f37828961167f565b60081b16831791611006577fc47a839c70aa320457c80c5abd38ce8b516c72e37be119b7962f67f1f8eb7ac2608083611001945f525f60205260405f20885f52602052610f888b60405f20546118c1565b815f525f60205260405f20895f5260205260405f2055805f526001602052610fb48b60405f20546118c1565b815f52600160205260405f20556040518181528b60208201525f33915f516020611a8d5f395f51905f5260403392a46040519033825287602083015260408201528a6060820152a1611600565b610f1b565b60405162461bcd60e51b815260206004820152602160248201527f455243313135353a206d696e7420746f20746865207a65726f206164647265736044820152607360f81b6064820152608490fd5b60405162461bcd60e51b81526020600482015260156024820152744e6f2062616c616e636520746f206d69677261746560581b6044820152606490fd5b60405162461bcd60e51b8152602060048201526017602482015276155b9a5d995c9cd9481a185cc81b9bdd08199bdc9ad959604a1b6044820152606490fd5b90506020813d6020116110fb575b816110ec60209383611394565b8101031261016e575183610eef565b3d91506110df565b6040513d5f823e3d90fd5b3461016e57604036600319011261016e576020600435610c7761112f61137e565b335f526005845261114b600160ff60405f2054161515146115c3565b611155838261153a565b9283916117d7565b3461016e57602036600319011261016e5760043560ff8116906040519060081c8152600482101561039a576040916020820152f35b3461016e57608036600319011261016e576111ab611368565b6111b361137e565b6001600160a01b0316906044356064356111ce841515611701565b6001600160a01b038316926111ee9033851490811561126e575b5061175e565b815f525f60205260405f20835f5260205261120d8160405f20546117ca565b5f838152602081815260408083208784529091528082209290925585815220546112389082906118c1565b825f525f60205260405f20855f5260205260405f205560405191825260208201525f516020611a8d5f395f51905f5260403392a4005b6001915061127d9033906116b9565b151514866111e8565b3461016e575f36600319011261016e576040515f6003548060011c90600181168015611337575b6020831081146108885782855290811561086457506001146112d957610802836107f681850382611394565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061131d575090915081016020016107f66107e6565b919260018160209254838588010152019101909291611305565b91607f16916112ad565b3461016e57604036600319011261016e576020610c7761135f611368565b6024359061153a565b600435906001600160a01b038216820361016e57565b602435906001600160a01b038216820361016e57565b601f909101601f19168101906001600160401b038211908210176113b757604052565b634e487b7160e01b5f52604160045260245ffd5b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b6001600160401b0381116113b75760051b60200190565b929190611418816113f5565b936114266040519586611394565b602085838152019160051b810192831161016e57905b82821061144857505050565b813581526020918201910161143c565b90602080835192838152019201905f5b8181106114755750505090565b8251845260209384019390920191600101611468565b600435906001600160f81b038216820361016e57565b606090600319011261016e576004356001600160f81b038116810361016e57906024356001600160a01b038116810361016e579060443590565b604090600319011261016e576004356001600160f81b038116810361016e5790602435600481101561016e5790565b9181601f8401121561016e578235916001600160401b03831161016e576020808501948460051b01011161016e57565b906001600160a01b0382161561156a575f525f60205260405f209060018060a01b03165f5260205260405f205490565b60405162461bcd60e51b815260206004820152602b60248201527f455243313135353a2062616c616e636520717565727920666f7220746865207a60448201526a65726f206164647265737360a81b6064820152608490fd5b156115ca57565b60405162461bcd60e51b815260206004820152600e60248201526d1b9bdd08185d5d1a1bdc9a5e995960921b6044820152606490fd5b60ff1660ff81146116115760010190565b634e487b7160e01b5f52601160045260245ffd5b9061162f826113f5565b61163c6040519182611394565b828152809261164d601f19916113f5565b0190602036910137565b805182101561166b5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b60ff60405192602084019260018060f81b03168352166040830152604082526116a9606083611394565b905190206001600160f81b031690565b6001600160a01b0382163014919082156116d257505090565b6001600160a01b039081165f90815260026020908152604080832093909416825291909152205460ff16919050565b1561170857565b60405162461bcd60e51b815260206004820152602860248201527f455243313135353a207461726765742061646472657373206d757374206265206044820152676e6f6e2d7a65726f60c01b6064820152608490fd5b1561176557565b60405162461bcd60e51b815260206004820152603760248201527f455243313135353a206e656564206f70657261746f7220617070726f76616c20604482015276666f7220337264207061727479207472616e736665727360481b6064820152608490fd5b9190820391821161161157565b6001600160a01b0316908115611861575f9281845283602052604084208385526020526118088160408620546117ca565b8285528460205260408520848652602052604085205581845260016020526118348160408620546117ca565b8285526001602052604085205560405191825260208201525f516020611a8d5f395f51905f5260403392a4565b60405162461bcd60e51b815260206004820152603260248201527f455243313135353a20617474656d7074696e6720746f206275726e20746f6b656044820152711b9cc81bdb881e995c9bc81858d8dbdd5b9d60721b6064820152608490fd5b9190820180921161161157565b90916118e56118f393604084526040840190611458565b916020818403910152611458565b90565b90939291938451835103611a1057845115611a09576001600160a01b031690611920821515611701565b6001600160a01b0381169061193f903383149081156119f1575061175e565b5f5b85518110156119c6578061195760019288611657565b516119aa6119658388611657565b51825f525f60205260405f20865f526020526119858160405f20546117ca565b5f848152602081815260408083208a84529091528082209290925588815220546118c1565b905f525f60205260405f20855f5260205260405f205501611941565b50916119ec5f516020611a6d5f395f51905f5291959294956040519182913395836118ce565b0390a4565b60019150611a009033906116b9565b1515145f6111e8565b5050509050565b60405162461bcd60e51b815260206004820152602e60248201527f455243313135353a2049447320616e642076616c756573206d7573742068617660448201526d652073616d65206c656e6774687360901b6064820152608490fdfe4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fbc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62a26469706673582212205a0d93ed77b535fdfe0d8fc03cad1fddecd07041b195930912ed8e52afee8eb864736f6c63430008210033'
		}
	}
}
export declare const peripherals_tokens_TokenId_TokenId: {
	readonly abi: readonly []
	readonly evm: {
		readonly bytecode: {
			readonly object: '6080806040523460175760399081601c823930815050f35b5f80fdfe5f80fdfea26469706673582212203379664d2525c2aff6734b8b631667b100a15a7ef35f80b7f2601cca2c54dd7464736f6c63430008210033'
		}
		readonly deployedBytecode: {
			readonly object: '5f80fdfea26469706673582212203379664d2525c2aff6734b8b631667b100a15a7ef35f80b7f2601cca2c54dd7464736f6c63430008210033'
		}
	}
}
//# sourceMappingURL=contractArtifact.d.ts.map
