import Inv48PublicShape
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.PositiveABI
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def name := "minimumToken1ReportAttoEthForPrice"
def signature := "minimumToken1ReportAttoEthForPrice(uint256)"
theorem present : (Inv48.Source.model.core.findFunctionByName? name).isSome := by
  have H := Inv48.Public.checked_body
  change (Inv48.Source.model.core.findFunctionByName? name).map FunctionDef.body = _ at H
  cases found : Inv48.Source.model.core.findFunctionByName? name with
  | none => rw [found] at H; contradiction
  | some fn => rfl

def entry := (Inv48.Source.model.core.findFunctionByName? name).get present

theorem found : Inv48.Source.model.core.findFunctionByName? name = some entry :=
  (Option.some_get present).symm

theorem body : entry.body = Inv48.Public.body := by
  have H := Inv48.Public.checked_body
  change (Inv48.Source.model.core.findFunctionByName? name).map FunctionDef.body = _ at H
  rw [found] at H
  exact Option.some.inj H

theorem metadataChecked :
    entry.name = name ∧
    entry.selector? = some (ABI.selectorFromSignature signature) ∧
    entry.payable = false ∧
    Inv32Library.decode entry.params = some [.word "proposedRepPerEthPrice"] ∧
    Inv32Library.decode entry.returns = some [.word "_ret0"] := by native_decide

theorem metadata :
    entry.name = name ∧
    entry.selector? = some (ABI.selectorFromSignature signature) ∧
    entry.payable = false ∧
    entry.params = [⟨"proposedRepPerEthPrice",.uint256,false⟩] ∧
    entry.returns = [⟨"_ret0",.uint256,false⟩] := by
  obtain ⟨N,S,P,A,R⟩ := metadataChecked
  exact ⟨N,S,P,Inv32Library.sound _ _ A,Inv32Library.sound _ _ R⟩

#print axioms present
#print axioms body
#print axioms metadata
end Inv48.PositiveABI
