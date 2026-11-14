// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Standard and USDT-style transfers plus a deliberately unsupported transfer tax.
contract CollateralTestToken {
	string public name = 'Test collateral';
	string public symbol = 'TEST';
	uint8 public immutable decimals;
	bool public immutable noReturn;
	uint256 public feeBps;
	uint256 public totalSupply;
	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;
	event Transfer(address indexed from, address indexed to, uint256 amount);
	event Approval(address indexed owner, address indexed spender, uint256 amount);
	constructor(uint8 units, bool omitReturn) {
		decimals = units;
		noReturn = omitReturn;
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
	function approve(address spender, uint256 amount) external returns (bool) {
		require(!noReturn || amount == 0 || allowance[msg.sender][spender] == 0, 'Reset allowance first');
		allowance[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return _result();
	}
	function transfer(address to, uint256 amount) external returns (bool) {
		_transfer(msg.sender, to, amount);
		return _result();
	}
	function transferFrom(address from, address to, uint256 amount) external returns (bool) {
		uint256 approved = allowance[from][msg.sender];
		if (approved != type(uint256).max) {
			require(approved >= amount, 'Insufficient allowance');
			allowance[from][msg.sender] = approved - amount;
		}
		_transfer(from, to, amount);
		return _result();
	}
	function _transfer(address from, address to, uint256 amount) private {
		require(balanceOf[from] >= amount, 'Insufficient collateral');
		balanceOf[from] -= amount;
		uint256 received = amount - (amount * feeBps) / 10_000;
		balanceOf[to] += received;
		totalSupply -= amount - received;
		emit Transfer(from, to, received);
	}
	function _result() private view returns (bool) {
		if (noReturn) {
			assembly ('memory-safe') {
				return(0, 0)
			}
		}
		return true;
	}
}
