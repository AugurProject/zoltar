import Inv48FeedMathCall
import Inv32FloorOverflow
open SolidCore.Solidity.Source Inv32Shapes Inv32Library Inv32Bodies
namespace Inv48.QuoteWideBounds
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
private def checks (t : FunctionTable) :=
  Inv48.Minima.TableCheck.check t Ternary.key [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Ternary.shape &&
  Inv48.Minima.TableCheck.check t Panic.key [.word "code"] [] Panic.shape
private theorem certified : checks Inv48.Source.model.core.table = true := by native_decide
def rejectionLinks : Inv32Rejection.Links Inv48.Source.model.core.table := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact ⟨Inv48.FeedMath.productLinked,Inv48.FeedMath.floorLinked,Inv48.FeedMath.uintLinked,
    Inv48.Minima.TableCheck.checkedLink _ _ _ _ _ h.1,
    Inv48.Minima.TableCheck.checkedLink _ _ _ _ _ h.2⟩
#print axioms rejectionLinks
end Inv48.QuoteWideBounds
