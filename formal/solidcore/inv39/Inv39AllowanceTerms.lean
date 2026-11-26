import Inv39MotionCall
import Inv39TransferBinding
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Allowance
abbrev getKey := "__internal_allowance(address,address)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.address false]"
abbrev approveKey := "__internal__approve(address,address,uint256,bool)#[SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.bool]"
abbrev spendKey := "__internal__spendAllowance(address,address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
def getExpr : Pattern Expr := ⟨.index (.storageIndex "_allowances" (.var "owner")) (.var "spender"),
  fun | .index (.storageRead .element "_allowances" [.var "owner"]) (.var "spender") => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> first | rfl | contradiction⟩
def target : Pattern LValue := ⟨.index (.storageIndex "_allowances" (.var "owner")) (.var "spender"),
  fun | .index (.storageIndex "_allowances" (.var "owner")) (.var "spender") => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> first | rfl | contradiction⟩
def approvalLog : Pattern Stmt := ⟨.emitEvent "Approval" [.var "owner",.var "spender",.var "value"],
  fun | .emitEvent "Approval" [.var "owner",.var "spender",.var "value"] => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> first | rfl | contradiction⟩
def getShape := block [Stmt_skip,Stmt_skip,Stmt_skip,block [ret (Inv03.Bodies.clean getExpr)]]
def approveShape := block [Stmt_skip,Stmt_skip,param "value",Stmt_skip,block [
  Motion.forbid "owner" "ERC20 approval owner must not be the zero address",Motion.forbid "spender" "ERC20 approval spender must not be the zero address",
  Stmt_assign target (wvar "value"),Stmt_ifElse (varP "emitEvent") (block [approvalLog]) Stmt_skip]]
def getMeta (f : InternalFunction) := match f.params,f.returns with
  | [⟨"owner",.address,false⟩,⟨"spender",.address,false⟩],[⟨"_ret0",.uint256,false⟩] => true | _,_ => false
def approveMeta (f : InternalFunction) := match f.params,f.returns with
  | [⟨"owner",.address,false⟩,⟨"spender",.address,false⟩,⟨"value",.uint256,false⟩,⟨"emitEvent",.bool,false⟩],[] => true | _,_ => false
def good (k : String) (p : Pattern Stmt) (m : InternalFunction → Bool) := ((model.core.table.lookup? k).map fun f => m f && p.test f.body)==some true
theorem checked : good getKey getShape getMeta && good approveKey approveShape approveMeta := by native_decide
end Inv39.Allowance
