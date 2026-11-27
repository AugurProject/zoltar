import Inv39UnusedAuth
open SolidCore.Solidity.Source
namespace Inv39.Auth
def watchFlag (owner : String) : Watch := fun k=>k==owner || k=="nonce" || k==target || k=="to" || k=="value"
def sigTerms (w : Watch) := accepted (extraCalls guardNames w) false w
def declFlag (who : String) := Stmt.assign (flagPlace who) (.word 1)
def logFlag (who event : String) := Stmt.emitEvent event [.var who,.var "nonce"]
def cancelPrologue : List Stmt := [.skip,.skip,.assign (.var "v") (.castOp .uintCleanup 8 (.var "v")),.skip,.skip]
def cancelBody (hash sig : Stmt) := Stmt.block (cancelPrologue ++ [.block (binds++[unusedFlag "authorizer",hash,sig,declFlag "authorizer",logFlag "authorizer" "AuthorizationCanceled"])])
def cancelParams : List BindingDecl := [⟨"authorizer",.address,false⟩,⟨"nonce",.fixedBytes 32,false⟩,⟨"v",.uint256,false⟩,⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩]
end Inv39.Auth
