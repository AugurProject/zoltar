import Inv48MinimaTableCheck
open SolidCore.Solidity.Source Inv32Shapes Inv32Library
namespace Inv48.Minima.TableCheck

theorem links (t : FunctionTable) (h : checks t = true) :
    LinkAt t "__internal_minimumToken1ReportAttoEth()#[]" [] [.word "_ret0"] collateralPattern.value ∧
    LinkAt t "__internal_minimumToken2ReportAttoRep()#[]" [] [.word "_ret0"] repPattern.value ∧
    LinkAt t Inv04.Shapes.ceilKey [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape.value ∧
    LinkAt t Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.shape.value := by
  simp only [checks,Bool.and_eq_true] at h
  exact ⟨checkedLink _ _ _ _ _ h.1.1.1,checkedLink _ _ _ _ _ h.1.1.2,
    checkedLink _ _ _ _ _ h.1.2,checkedLink _ _ _ _ _ h.2⟩

def generatedLinks := links Inv48.Source.model.core.table certified
#print axioms generatedLinks
end Inv48.Minima.TableCheck
