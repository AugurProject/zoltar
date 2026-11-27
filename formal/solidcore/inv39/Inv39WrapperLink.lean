import Inv39WrapperEvidence
open SolidCore.Solidity.Source
namespace Inv39.Auth
set_option maxRecDepth 16384
set_option maxHeartbeats 4000000
theorem parsedHoist (s : Stmt) (bs : List Byte) (h : hoistBytes s=some bs) : s=wrap bs := by
  unfold hoistBytes at h; split at h
  · split at h
    · rename_i eq
      obtain rfl := beq_iff_eq.mp eq; cases h; rfl
    · contradiction
  · contradiction
theorem parsedWrap (b : Bool) (s call : Stmt) (got : wrapperMatches b s=some call) (bs : List Byte) (callShape : call=wrap bs) :
    s=publicShape b bs := by
  subst call; unfold wrapperMatches at got
  split at got
  · split at got <;> first | cases got; rfl | contradiction
  · contradiction
theorem wrapperLinked (b : Bool) : ∃ f,model.core.findFunctionByName? (publicName b)=some f ∧ f.params=signedParams ∧ f.returns=[] ∧ ∃ bs,f.body=publicShape b bs := by
  have ev := wrappersEvidence
  simp only [Bool.and_eq_true] at ev
  have checked : checkedWrap b := by cases b <;> first | exact ev.1 | exact ev.2
  have ok := beq_iff_eq.mp checked
  cases found:model.core.findFunctionByName? (publicName b) with
  | none=>simp [found] at ok
  | some f=>
    simp only [found,Option.map_some,Option.some.injEq] at ok
    unfold wrapperCheck at ok; split at ok
    · rename_i call ps rs shape
      obtain ⟨bs,parsed⟩ := Option.isSome_iff_exists.mp ok
      exact ⟨f,rfl,ps,rs,bs,parsedWrap b f.body call shape bs (parsedHoist call bs parsed)⟩
    · contradiction
end Inv39.Auth
