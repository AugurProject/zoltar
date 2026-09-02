// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface IGenesisSeederCallback {
	function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external;
}

contract GenesisSeederTokenMock {
	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	function mint(address account, uint256 amount) external {
		balanceOf[account] += amount;
	}

	function approve(address spender, uint256 amount) external returns (bool) {
		allowance[msg.sender][spender] = amount;
		return true;
	}

	function transfer(address recipient, uint256 amount) external returns (bool) {
		_transfer(msg.sender, recipient, amount);
		return true;
	}

	function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
		uint256 permitted = allowance[sender][msg.sender];
		require(permitted >= amount, 'Allowance');
		allowance[sender][msg.sender] = permitted - amount;
		_transfer(sender, recipient, amount);
		return true;
	}

	function _transfer(address sender, address recipient, uint256 amount) private {
		require(balanceOf[sender] >= amount, 'Balance');
		balanceOf[sender] -= amount;
		balanceOf[recipient] += amount;
	}
}

contract GenesisSeederPoolMock {
	address public lastRecipient;
	uint128 public lastLiquidity;
	uint256 public amount0Owed;
	uint256 public amount1Owed;

	constructor(uint256 configuredAmount0Owed, uint256 configuredAmount1Owed) {
		amount0Owed = configuredAmount0Owed;
		amount1Owed = configuredAmount1Owed;
	}

	function mint(address recipient, int24, int24, uint128 liquidity, bytes calldata data) external returns (uint256 amount0, uint256 amount1) {
		lastRecipient = recipient;
		lastLiquidity = liquidity;
		IGenesisSeederCallback(msg.sender).uniswapV3MintCallback(amount0Owed, amount1Owed, data);
		return (amount0Owed, amount1Owed);
	}
}
