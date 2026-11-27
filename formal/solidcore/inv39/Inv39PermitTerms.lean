import Inv39AuthNonce
import Inv39CleanParameters
import Inv39CancelTerms
import Inv39DirectApprove
open SolidCore.Solidity.Source
namespace Inv39.Auth
def permitWatch : Watch := fun k=>k=="owner" || k=="spender" || k=="value"
def permitParams : List BindingDecl := [⟨"owner",.address,false⟩,⟨"spender",.address,false⟩,⟨"value",.uint256,false⟩,⟨"deadline",.uint256,false⟩,⟨"v",.uint256,false⟩,⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩]
def permitPrologue : List Stmt := [.skip,.skip,clean 256 "value",clean 256 "deadline",clean 8 "v",.skip,.skip]
def grant := Allowance.prep "owner" "spender" Allowance.approve3Key
def permitBody (deadline : Expr) (hash sig : Stmt) := Stmt.block (permitPrologue ++ [.block (.requireStmt deadline (some "ERC2612 permit expired")::(binds++[bumpStmt,hash,sig,grant.value]))])
end Inv39.Auth
