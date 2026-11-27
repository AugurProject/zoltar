import Inv39MarkerPrefixCertificate
open SolidCore.Solidity.Source
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

theorem prefixSites : ∃ f a b d e suffix,
    model.core.findFunctionByName? "initialize"=some f ∧
    f.body=Repeat.body (a::repGuard::b::d::e::repStore::suffix) ∧ prefixValid a b d e=true := by
  obtain ⟨f,a,b,d,e,suffix,found,_,_,body⟩ := sites
  refine ⟨f,a,b,d,e,suffix,found,body,?_⟩
  have cert := certificate
  rw [found] at cert
  simp only [Option.bind_some] at cert
  rw [body] at cert
  simpa [Repeat.extract,Repeat.body,Repeat.cleanup,Repeat.markerGuard,Repeat.markerExpr,authorityGuard,authorityCheck,extractSites,repGuard,repValue,repStore] using cert

theorem prefixOfBody (f : FunctionDef) (a b d e : Stmt) (suffix : List Stmt)
    (found : model.core.findFunctionByName? "initialize"=some f)
    (body : f.body=Repeat.body (a::repGuard::b::d::e::repStore::suffix)) : prefixValid a b d e=true := by
  have cert := certificate
  rw [found] at cert
  simp only [Option.bind_some] at cert
  rw [body] at cert
  simpa [Repeat.extract,Repeat.body,Repeat.cleanup,Repeat.markerGuard,Repeat.markerExpr,authorityGuard,authorityCheck,extractSites,repGuard,repValue,repStore] using cert

theorem guardSyntaxSound (s : Stmt) (ok : guardSyntax s=true) :
    ∃ e reason, s=.requireStmt e reason ∧ Frame.ReadOnly e := by
  cases s <;> try contradiction
  case requireStmt e reason => exact ⟨e,reason,rfl,reads e ok⟩
theorem universeSyntaxSound (s : Stmt) (ok : universeSyntax s=true) : s=universeStore := by
  unfold universeSyntax at ok
  split at ok <;> first | rfl | contradiction
end Inv39.Init.Marker.Prefix
