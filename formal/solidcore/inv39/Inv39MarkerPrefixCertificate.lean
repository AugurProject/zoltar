import Inv39MarkerPrefixLocals
open SolidCore.Solidity.Source
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

def universeStore : Stmt := .assign (.storage "universeId") (.castOp .uintCleanup 248 (.var "universeId_"))
def guardSyntax : Stmt → Bool
  | .requireStmt e _ => readSyntax e
  | _ => false
def universeSyntax : Stmt → Bool
  | .assign (.storage "universeId") (.castOp .uintCleanup 248 (.var "universeId_")) => true
  | _ => false
def prefixValid (a b d e : Stmt) : Bool := guardSyntax a && guardSyntax b && guardSyntax d && universeSyntax e
theorem certificate :
    (((model.core.findFunctionByName? "initialize").bind fun f =>
      (Repeat.extract f.body).bind extractSites).map fun (a,b,d,e,_) => prefixValid a b d e)=some true := by
  native_decide

end Inv39.Init.Marker.Prefix
