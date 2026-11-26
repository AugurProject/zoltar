import Inv39AllowanceTerms
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv39.Allowance
theorem lookupCertified (key : String) (p : Pattern Stmt) (matchesFn : InternalFunction → Bool) (yes : good key p matchesFn) :
    ∃ f, model.core.table.lookup? key=some f ∧ matchesFn f ∧ f.body=p.value := by
  unfold good at yes
  cases link:model.core.table.lookup? key with
  | none => simp [link] at yes
  | some f =>
    simp only [link,Option.map_some,beq_iff_eq,Option.some.injEq,Bool.and_eq_true] at yes
    exact ⟨f,rfl,yes.1,p.sound _ yes.2⟩
def params2 : List BindingDecl := [⟨"owner",.address,false⟩,⟨"spender",.address,false⟩]
def params4 : List BindingDecl := params2++[⟨"value",.uint256,false⟩,⟨"emitEvent",.bool,false⟩]
theorem getLink : ∃ f, model.core.table.lookup? getKey=some f ∧ f.params=params2 ∧ f.returns=[⟨"_ret0",.uint256,false⟩] ∧ f.body=getShape.value := by
  have h := checked
  simp only [Bool.and_eq_true] at h
  obtain ⟨f,eq,m,b⟩ := lookupCertified getKey getShape getMeta h.1
  refine ⟨f,eq,?_,?_,b⟩ <;> unfold getMeta at m <;> split at m <;> simp_all [params2]
theorem approveLink : ∃ f, model.core.table.lookup? approveKey=some f ∧ f.params=params4 ∧ f.returns=[] ∧ f.body=approveShape.value := by
  have h := checked
  simp only [Bool.and_eq_true] at h
  obtain ⟨f,eq,m,b⟩ := lookupCertified approveKey approveShape approveMeta h.2
  refine ⟨f,eq,?_,?_,b⟩ <;> unfold approveMeta at m <;> split at m <;> simp_all [params2,params4]
end Inv39.Allowance
