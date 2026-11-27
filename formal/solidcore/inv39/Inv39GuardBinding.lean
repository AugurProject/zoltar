import Inv39ChildBody
import Inv39Getters
open SolidCore.Solidity.Source
namespace Inv39.Child
abbrev getterKey := "__internal_totalSupply()#[]"
theorem internalGetter : ∃ fn, model.core.table.lookup? getterKey=some fn ∧ fn.params=Inv32Internal.wordBindings [] ∧
    fn.returns=Inv32Internal.wordBindings ["_ret0"] ∧ fn.body=(Getter.shape .actual).value :=
  Inv32Internal.linkedOfCheck _ _ _ _ _ (by native_decide)
end Inv39.Child
