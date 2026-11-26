import Inv39ReadDomainCalls
import Inv39Coverage
open SolidCore.Solidity.Source
namespace Inv39.ReadDomainEvidence
def leafNames : List String := ["__internal_name()#[]",
"__internal___library_AuthorizationSignatures_domainSeparator(bytes32,bytes32,address)#[SolidCore.Solidity.Ty.bytesN 32, SolidCore.Solidity.Ty.bytesN 32, SolidCore.Solidity.Ty.address false]"]
def leafCheck (key : String) := ((model.core.table.lookup? key).map fun f => signature f && accepted (fun _ => false) f.body)==some true
private theorem leafChecked : leafNames.all leafCheck := by native_decide
 theorem leafSafe (key : String) (mem : key∈leafNames) :
    ∃ f,model.core.table.lookup? key=some f ∧ signature f ∧ ∀ b c,Frame.StmtPreserves (region b) model.core.table c f.body := by
  have h := List.all_eq_true.mp leafChecked key mem
  unfold leafCheck at h; simp only [beq_iff_eq] at h
  cases found:model.core.table.lookup? key with
  | none => simp [found] at h
  | some f =>
    simp only [found,Option.map_some,Option.some.injEq,Bool.and_eq_true] at h
    exact ⟨f,rfl,h.1,fun b c => sound _ b _ c (by simp) _ h.2⟩
def extra : Stmt → Bool
  | .internalCall _ key args => leafNames.contains key && args.all Auth.ordinaryVar
  | _ => false
 theorem extraSafe (b : State) (c : Context) (s : Stmt) (h : extra s) :
    Frame.StmtPreserves (region b) model.core.table c s := by
  unfold extra at h; split at h
  · simp only [Bool.and_eq_true,List.contains_iff_mem] at h
    obtain ⟨f,found,sig,safe⟩ := leafSafe _ h.1
    exact callRegion b c _ _ _ f found sig h.2 safe
  · contradiction
end Inv39.ReadDomainEvidence
namespace Inv39.ReadEvidence
/-- The checked classifier includes all 13 read entries, not just the outstanding 11. -/
def certificate (f : FunctionDef) :=
  f.params.all (fun d => Auth.scalar d.ty) && f.returns.all Auth.returnOk &&
  (if f.name=="DOMAIN_SEPARATOR" then ReadDomainEvidence.accepted ReadDomainEvidence.extra f.body
   else statements helperCall f.body)
def classified : Bool := model.core.functions.all fun f =>
  if Coverage.views.contains f.name then certificate f else true
 theorem checkedClassification : classified=true := by native_decide
 theorem functionCertificate (f : FunctionDef) (mem : f∈model.core.functions) (view : f.name∈Coverage.views) : certificate f := by
  have h := List.all_eq_true.mp checkedClassification f mem
  simpa only [List.contains_iff_mem.mpr view,if_true] using h
end Inv39.ReadEvidence
