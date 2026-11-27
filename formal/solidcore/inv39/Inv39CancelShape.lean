import Inv39CancelEvidence
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem cancelLinked : ∃ f, model.core.findFunctionByName? "cancelAuthorization"=some f ∧ f.params=cancelParams ∧ f.returns=[] ∧
    ∃ hash sig,f.body=cancelBody hash sig ∧ sigTerms (watchFlag "authorizer") hash ∧ sigTerms (watchFlag "authorizer") sig := by
  have ev := cancelEvidence
  cases found:model.core.findFunctionByName? "cancelAuthorization" with
  | none=>simp [found] at ev
  | some f=>
    simp only [found,Option.map_some,Option.some.injEq] at ev
    unfold certifiesCancel at ev; split at ev
    · rename_i hash sig a b matched
      simp only [Bool.and_eq_true] at ev
      refine ⟨f,rfl,a,b,hash,sig,?_,ev⟩
      unfold matchesCancelBody at matched; split at matched <;> first | cases matched; assumption | contradiction
    · contradiction
end Inv39.Auth
