import Inv39AllowanceTerms
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Allowance
def boolTy : Pattern Ty := ⟨.bool,fun | .bool => true | _ => false,by intro x h; dsimp only at h; split at h <;> first | rfl | contradiction⟩
abbrev tmp := "_sol_hoist_0"
abbrev retGet := "_ret_allowance_0"
def getCall := block [Transfer.address "_ic_arg_0" (Option_some (varP "owner")),Transfer.address "_ic_arg_1" (Option_some (varP "spender")),
  decl retGet Option_none,Stmt_captureReturn (seq [lit retGet]) (Stmt_internalCall (seq [lit retGet]) (lit getKey) (seq [varP "_ic_arg_0",varP "_ic_arg_1"])),
  assign tmp (varP retGet)]
def approvedCall (value flag : Pattern Expr) := block [
  Transfer.address "_ic_arg_0" (Option_some (varP "owner")),Transfer.address "_ic_arg_1" (Option_some (varP "spender")),
  decl "_ic_arg_2" (Option_some value),Stmt_varDecl boolTy (lit "_ic_arg_3") (Option_some flag),
  Stmt_captureReturn List_nil (Stmt_internalCall List_nil (lit approveKey) (seq [varP "_ic_arg_0",varP "_ic_arg_1",varP "_ic_arg_2",varP "_ic_arg_3"]))]
def failLow : Pattern Stmt := ⟨.revertError (some "ERC20 transfer amount exceeds spender allowance"),
  fun | .revertError (some "ERC20 transfer amount exceeds spender allowance")=>true | _=>false,
  by intro x h; dsimp only at h; split at h <;> first | rfl | contradiction⟩
def low := Expr_binary BinaryOp_lt (wvar "currentAllowance") (wvar "value")
def reduced := Inv03.Bodies.clean (Inv03.Bodies.clean (Expr_binary BinaryOp_sub (wvar "currentAllowance") (wvar "value")))
def finite := Expr_binary BinaryOp_lt (wvar "currentAllowance") (Inv03.Bodies.clean (num (2^256-1)))
def spendBranch := block [Stmt_ifElse low (block [failLow]) Stmt_skip,Stmt_unchecked (block [approvedCall reduced (num 0)])]
def spendShape := block [Stmt_skip,Stmt_skip,param "value",block [decl tmp Option_none,getCall,decl "currentAllowance" (Option_some (wvar tmp)),
  Stmt_ifElse finite spendBranch Stmt_skip]]
def spendMeta (f : InternalFunction) := match f.params,f.returns with
  | [⟨"owner",.address,false⟩,⟨"spender",.address,false⟩,⟨"value",.uint256,false⟩],[] => true | _,_ => false
def prep (src dest key : String) := block [
  Transfer.address "_ic_arg_0" (Option_some (varP src)),Transfer.address "_ic_arg_1" (Option_some (varP dest)),
  decl "_ic_arg_2" (Option_some (wvar "value")),
  Stmt_captureReturn List_nil (Stmt_internalCall List_nil (lit key) (seq [varP "_ic_arg_0",varP "_ic_arg_1",varP "_ic_arg_2"]))]
def publicShape := block [Stmt_skip,Stmt_skip,param "value",Stmt_skip,block [Transfer.address Transfer.tmp Option_none,Transfer.fetch,
  Transfer.address "spender" (Option_some (varP Transfer.tmp)),prep "from" "spender" spendKey,prep "from" "to" (Motion.key .transfer),ret (num 1)]]
def matchesPublic (f : FunctionDef) := match f.params,f.returns with
  | [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩],[⟨"_ret0",.bool,false⟩]=>true | _,_=>false
def foundPublic := ((model.core.findFunctionByName? "transferFrom").map fun f=> matchesPublic f && publicShape.test f.body)==some true
theorem spendChecked : good spendKey spendShape spendMeta && foundPublic := by native_decide
end Inv39.Allowance
