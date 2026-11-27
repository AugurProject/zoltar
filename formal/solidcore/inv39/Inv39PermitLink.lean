import Inv39PermitEvidence
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem permitLinked : ∃ f,model.core.findFunctionByName? "permit"=some f ∧ f.params=permitParams ∧ f.returns=[] ∧
    ∃ cond hash sig,f.body=permitBody cond hash sig ∧ pureExpr cond ∧ sigTerms permitWatch hash ∧ sigTerms permitWatch sig := by
  have ev := permitEvidence
  cases found:model.core.findFunctionByName? "permit" with
  | none=>simp [found] at ev
  | some f=>
    simp only [found,Option.map_some,Option.some.injEq] at ev
    unfold checkPermit at ev; split at ev
    · rename_i cond hash sig approval ps rs parsed
      simp only [Bool.and_eq_true] at ev
      obtain rfl := grant.sound approval ev.2
      refine ⟨f,rfl,ps,rs,cond,hash,sig,?_,ev.1.1.1,ev.1.1.2,ev.1.2⟩
      unfold readPermit at parsed; split at parsed <;> first | cases parsed; assumption | contradiction
    · contradiction
end Inv39.Auth
