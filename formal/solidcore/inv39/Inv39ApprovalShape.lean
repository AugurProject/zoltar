import Inv39SpendShape
import Inv39AllowanceBindings
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Allowance
abbrev approve3Key := "__internal__approve(address,address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
def approve3Shape := block [Stmt_skip,Stmt_skip,param "value",block [approvedCall (wvar "value") (num 1)]]
def directShape := block [Stmt_skip,param "value",Stmt_skip,block [Transfer.address Transfer.tmp Option_none,Transfer.fetch,
  Transfer.address "owner" (Option_some (varP Transfer.tmp)),prep "owner" "spender" approve3Key,ret (num 1)]]
def directMeta (f : FunctionDef) := match f.params,f.returns with
  | [⟨"spender",.address,false⟩,⟨"value",.uint256,false⟩],[⟨"_ret0",.bool,false⟩]=>true | _,_=>false
def directFound := ((model.core.findFunctionByName? "approve").map fun f=>directMeta f && directShape.test f.body)==some true
theorem approveChecked : good approve3Key approve3Shape spendMeta && directFound := by native_decide
end Inv39.Allowance
