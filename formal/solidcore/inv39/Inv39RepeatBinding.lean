import Inv39Initialize
import Inv39GuardSyntax
open SolidCore.Solidity SolidCore.Solidity.Source
set_option maxHeartbeats 4000000
namespace Inv39.Init.Repeat
def cleanup (bits : Nat) (name : String) : Source.Stmt := .assign (.var name) (.castOp .uintCleanup bits (.var name))
def markerExpr : Source.Expr := .binary .eq (.castOp .uintCleanup 256 (.storageRead .ref "repNumber" [])) (.word 0)
def markerGuard : Source.Stmt := .requireStmt markerExpr (some "Reputation token already initialized")
def body (tail : List Source.Stmt) : Source.Stmt := .block [cleanup 248 "universeId_", cleanup 256 "totalTheoreticalSupplyAttoRep_", cleanup 256 "repNumber_",
  .block [.block [authorityGuard, .captureReturn [] (.block (markerGuard :: tail))]]]
def extract : Source.Stmt → Option (List Source.Stmt)
  | .block [.assign (.var "universeId_") (.castOp .uintCleanup 248 (.var "universeId_")),
      .assign (.var "totalTheoreticalSupplyAttoRep_") (.castOp .uintCleanup 256 (.var "totalTheoreticalSupplyAttoRep_")),
      .assign (.var "repNumber_") (.castOp .uintCleanup 256 (.var "repNumber_")),
      .block [.block [.requireStmt (.binary .eq .caller (.immutable "zoltar")) (some "ReputationToken caller must be the Zoltar contract"),
        .captureReturn [] (.block (.requireStmt (.binary .eq (.castOp .uintCleanup 256 (.storageRead .ref "repNumber" [])) (.word 0)) (some "Reputation token already initialized") :: tail))]]] => some tail
  | _ => none
theorem extractSound (s : Source.Stmt) (tail : List Source.Stmt) (h : extract s=some tail) : s=body tail := by
  unfold extract at h; split at h <;> first | cases h; rfl | contradiction
private theorem certificate : ((model.core.findFunctionByName? "initialize").bind fun f=>extract f.body).isSome := by native_decide
theorem binding : ∃ f tail, model.core.findFunctionByName? "initialize"=some f ∧ f.params=params ∧ f.returns=[] ∧ f.body=body tail := by
  obtain ⟨f,found,ps,rs,_⟩ := linked
  have cert := certificate
  rw [found] at cert
  obtain ⟨tail,eq⟩ := Option.isSome_iff_exists.mp cert
  exact ⟨f,tail,found,ps,rs,extractSound _ _ eq⟩
end Inv39.Init.Repeat
