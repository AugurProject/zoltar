// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Standard ERC-20 transfers plus a deliberately unsupported transfer tax.
contract CollateralTestToken {
	string public name = 'Test collateral';
	string public symbol = 'TEST';
	uint8 public immutable decimals;
	uint256 public feeBps;
	bool public paused;
	mapping(address => bool) public blocked;
	uint256 public totalSupply;
	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;
	event Transfer(address indexed from, address indexed to, uint256 amount);
	event Approval(address indexed owner, address indexed spender, uint256 amount);
	constructor(uint8 units) {
		decimals = units;
	}
	function mint(address to, uint256 amount) external {
		balanceOf[to] += amount;
		totalSupply += amount;
		emit Transfer(address(0), to, amount);
	}
	function setFee(uint256 fee) external {
		require(fee <= 10_000, 'Invalid fee');
		feeBps = fee;
	}
	function setPaused(bool value) external {
		paused = value;
	}
	function setBlocked(address account, bool value) external {
		blocked[account] = value;
	}
	function approve(address spender, uint256 amount) external returns (bool) {
		allowance[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}
	function transfer(address to, uint256 amount) external returns (bool) {
		_transfer(msg.sender, to, amount);
		return true;
	}
	function transferFrom(address from, address to, uint256 amount) external returns (bool) {
		uint256 approved = allowance[from][msg.sender];
		if (approved != type(uint256).max) {
			require(approved >= amount, 'Insufficient allowance');
			allowance[from][msg.sender] = approved - amount;
		}
		_transfer(from, to, amount);
		return true;
	}
	function _transfer(address from, address to, uint256 amount) private {
		require(!paused, 'Collateral paused');
		require(!blocked[from] && !blocked[to], 'Collateral address blocked');
		require(balanceOf[from] >= amount, 'Insufficient collateral');
		balanceOf[from] -= amount;
		uint256 received = amount - (amount * feeBps) / 10_000;
		balanceOf[to] += received;
		totalSupply -= amount - received;
		emit Transfer(from, to, received);
	}
}
