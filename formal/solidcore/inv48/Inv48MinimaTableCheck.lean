import Inv48Model
import Inv48MinimaSyntax
import Inv04Shapes
import Inv32FlagCalls
open SolidCore.Solidity.Source Inv32Shapes Inv32Library
namespace Inv48.Minima.TableCheck
def check (t : FunctionTable) (k : String) (ps rs : List Scalar) (pat : Pattern Stmt) : Bool :=
  decide (metadataAt t k = some (ps,rs)) && (Option_some pat).test ((t.lookup? k).map InternalFunction.body)
theorem checkedLink (t : FunctionTable) (k : String) (ps rs : List Scalar) (pat : Pattern Stmt)
    (h : check t k ps rs pat = true) : LinkAt t k ps rs pat.value := by
  simp only [check,Bool.and_eq_true] at h
  obtain ⟨sig,body⟩ := h
  exact linkAt t k ps rs pat.value (of_decide_eq_true sig) ((Option_some pat).sound _ body)
def checks (t : FunctionTable) :=
  check t "__internal_minimumToken1ReportAttoEth()#[]" [] [.word "_ret0"] collateralPattern &&
  check t "__internal_minimumToken2ReportAttoRep()#[]" [] [.word "_ret0"] repPattern &&
  check t Inv04.Shapes.ceilKey [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape &&
  check t Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.shape
theorem certified : checks Inv48.Source.model.core.table = true := by native_decide
#print axioms certified
end Inv48.Minima.TableCheck
