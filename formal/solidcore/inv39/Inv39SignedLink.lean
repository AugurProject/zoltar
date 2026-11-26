import Inv39SignedEvidence
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem signedLink : ∃ f,model.core.table.lookup? signedKey=some f ∧ f.params=paramsWithHash ∧ f.returns=[] ∧
    ∃ early late hash sig, f.body=signedInner early late hash sig ∧ pureExpr early ∧ pureExpr late ∧ sigTerms (watchFlag "from") hash ∧ sigTerms (watchFlag "from") sig := by
  have ev := innerEvidence
  cases found:model.core.table.lookup? signedKey with
  | none=>simp [found] at ev
  | some f=>
    simp only [found,Option.map_some,Option.some.injEq] at ev
    unfold innerMatch at ev; split at ev
    · rename_i early late hash sig tail ps rs parsed
      simp only [Bool.and_eq_true] at ev
      obtain rfl := motionTail.sound tail ev.2
      refine ⟨f,rfl,ps,rs,early,late,hash,sig,?_,ev.1.1.1.1,ev.1.1.1.2,ev.1.1.2,ev.1.2⟩
      unfold paymentChecks at parsed; split at parsed <;> first | cases parsed; assumption | contradiction
    · contradiction
end Inv39.Auth
