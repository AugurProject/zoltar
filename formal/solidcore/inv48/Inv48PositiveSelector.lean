import Inv48PositiveABI
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.PositiveABI
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def selected := Inv48.Source.model.core.findFunctionBySelector? (ABI.selectorFromSignature signature)

theorem selectorChecked :
    selected.map (fun fn => (fn.name,Inv32Library.decode fn.params,Inv32Library.decode fn.returns,
      fn.payable,Inv48.Public.shape.test fn.body)) =
    some (name,some [.word "proposedRepPerEthPrice"],some [.word "_ret0"],false,true) := by native_decide

theorem selectorLink : ∃ fn, selected = some fn ∧ fn.name = name ∧
    fn.params = [⟨"proposedRepPerEthPrice",.uint256,false⟩] ∧
    fn.returns = [⟨"_ret0",.uint256,false⟩] ∧ fn.payable = false ∧ fn.body = Inv48.Public.body := by
  have H := selectorChecked
  cases found : selected with
  | none => simp [found] at H
  | some fn =>
    simp only [found,Option.map_some,Option.some.injEq,Prod.mk.injEq] at H
    obtain ⟨N,A,R,P,B⟩ := H
    exact ⟨fn,rfl,N,Inv32Library.sound _ _ A,Inv32Library.sound _ _ R,P,
      Inv48.Public.shape.sound _ B⟩
#print axioms selectorLink
end Inv48.PositiveABI
