import Inv48MinimaTableCheck
open SolidCore.Solidity.Source Inv32Shapes Inv32Library Inv32Bodies
namespace Inv48.FeedBinding
open Inv48.Minima.TableCheck
def checkAll (t : FunctionTable) :=
  Inv32Internal.linked? t Mul512.key ["a","b"] ["high","low"] Mul512.shape &&
  Inv32Internal.linked? t Floor.key ["x","y","denominator"] ["result"] Floor.shape &&
  check t Ceil.key [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Ceil.shape &&
  check t RoundsUp.key [.word "rounding"] [.flag "_ret0"] RoundsUp.shape &&
  check t ToUint.key [.flag "b"] [.word "u"] ToUint.shape
theorem certified : checkAll Inv48.Source.model.core.table = true := by native_decide
theorem linked (t : FunctionTable) (h : checkAll t = true) :
    Inv32Internal.ProductLinked t ∧ Inv32FloorCall.FloorLinked t ∧
    LinkAt t Ceil.key [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Ceil.body ∧
    LinkAt t RoundsUp.key [.word "rounding"] [.flag "_ret0"] RoundsUp.body ∧
    LinkAt t ToUint.key [.flag "b"] [.word "u"] ToUint.body := by
  simp only [checkAll,Bool.and_eq_true] at h
  exact ⟨Inv32Internal.linkedOfCheck _ _ _ _ _ h.1.1.1.1,
    Inv32Internal.linkedOfCheck _ _ _ _ _ h.1.1.1.2, checkedLink _ _ _ _ _ h.1.1.2,
    checkedLink _ _ _ _ _ h.1.2,checkedLink _ _ _ _ _ h.2⟩
def generatedLinks := linked Inv48.Source.model.core.table certified
#print axioms generatedLinks
end Inv48.FeedBinding
