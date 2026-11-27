import Inv39MarkerSteps
open SolidCore.Solidity SolidCore.Solidity.Source
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker
/-- Extracts the guard and store from the generated initializer after the existing-marker guard. -/
def extractSites : List Source.Stmt → Option (Source.Stmt × Source.Stmt × Source.Stmt × Source.Stmt × List Source.Stmt)
  | a :: .requireStmt (.binary .ne (.castOp .uintCleanup 256 (.var "repNumber_")) (.word 0))
      (some "REP number must be non-zero") :: b :: c :: d ::
      .assign (.storage "repNumber") (.castOp .uintCleanup 256 (.var "repNumber_")) :: suffix =>
      some (a,b,c,d,suffix)
  | _ => none
theorem extractSitesSound (ss : List Source.Stmt) (a b c d : Source.Stmt) (suffix : List Source.Stmt)
    (found : extractSites ss=some (a,b,c,d,suffix)) :
    ss=a::repGuard::b::c::d::repStore::suffix := by
  unfold extractSites at found
  split at found <;> first | cases found; rfl | contradiction
private theorem checked : ((model.core.findFunctionByName? "initialize").bind fun f =>
    (Repeat.extract f.body).bind extractSites).isSome := by native_decide
/-- This certificate connects the proof's guard/store definitions to current generated syntax. -/
theorem sites : ∃ f a b c d suffix,
    model.core.findFunctionByName? "initialize"=some f ∧ f.params=params ∧ f.returns=[] ∧
    f.body=Repeat.body (a::repGuard::b::c::d::repStore::suffix) := by
  obtain ⟨f,tail,found,ps,rs,body⟩ := Repeat.binding
  have cert := checked
  rw [found] at cert
  cases extracted : Repeat.extract f.body with
  | none => simp [extracted] at cert
  | some ss =>
    simp only [Option.bind_some,extracted] at cert
    obtain ⟨⟨a,b,c,d,suffix⟩,eq⟩ := Option.isSome_iff_exists.mp cert
    exact ⟨f,a,b,c,d,suffix,found,ps,rs,(Repeat.extractSound _ _ extracted).trans
      (congrArg Repeat.body (extractSitesSound _ _ _ _ _ _ eq))⟩
end Inv39.Init.Marker
