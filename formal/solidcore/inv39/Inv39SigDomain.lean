import Inv39SigCalls
open SolidCore.Solidity.Source
namespace Inv39.Auth
def domainKey := "__internal_DOMAIN_SEPARATOR()#[]"
private theorem domainEvidence : ((model.core.table.lookup? domainKey).map (fun f=>signatureOk f && accepted (extraCalls leafNames noWatch) true noWatch f.body))=some true := by native_decide
theorem domain : Certified domainKey := by
  have ev := domainEvidence
  cases ok:model.core.table.lookup? domainKey with
  | none=>simp [ok] at ev
  | some f=>
    simp only [ok,Option.map_some,Option.some.injEq,Bool.and_eq_true] at ev
    exact ⟨f,ok,ev.1,fun c=>acceptedSound _ _ _ _ _ (extraCertified _ leaf _ _ _) _ ev.2⟩
def guardNames := domainKey::leafNames
theorem guardNamesChecked (key : String) (mem : key∈guardNames) : Certified key := by
  rcases List.mem_cons.mp mem with rfl|h
  · exact domain
  · exact leaf key h
theorem sigGuard (allow : Bool) (w : Watch) (c : Context) (s : Stmt) (ok : accepted (extraCalls guardNames w) allow w s) :
    guards allow w model.core.table c s := acceptedSound _ _ _ _ _ (extraCertified _ guardNamesChecked _ _ _) _ ok
end Inv39.Auth
