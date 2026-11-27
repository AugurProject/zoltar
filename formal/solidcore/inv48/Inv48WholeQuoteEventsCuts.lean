import Inv48WholeQuoteEventsSafe
import Inv48MinimumFullTraceQuote
import Inv48QuoteSegmentEventsMinimum
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem listEvents (fuel : Nat) (c : Context) (r : Runtime) (ss : List Source.Stmt)
    (safe : ss.all (stmtSafe 100 Inv48.Source.model.core.table) = true)
    (run : Interaction.Executes (Stmt.evalList fuel Inv48.Source.model.core.table c r ss) tr result) :
    tr = [] :=
  quietEvents _ (listFromQuiet _ _ _ _ _ (fun s mem rt =>
    stmtQuiet 100 _ s (List.all_eq_true.mp safe s mem) fuel c rt)) run

/-- Invert the original normal block and retain the middle statement's entire
execution. Both surrounding lists are structurally silent for every runtime. -/
theorem blockCut (n : Nat) (c : Context) (r final : Runtime)
    (xs ys : List Source.Stmt) (child : Source.Stmt)
    (left : xs.all (stmtSafe 100 Inv48.Source.model.core.table) = true)
    (right : ys.all (stmtSafe 100 Inv48.Source.model.core.table) = true)
    (run : Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.block (xs ++ child :: ys))) tr (.ok (.normal final))) :
    ∃ before after,
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c before child)
        tr (.ok (.normal after)) := by
  obtain ⟨k,v,eq,eqOut,list⟩ := block _ _ _ _ _ _ _ run
  have keq : k=n := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime] at eqOut <;> try contradiction
  case normal last =>
    obtain ⟨before,a,b,split,pre,rest⟩ := normalPrefix _ _ _ _ _ xs (child::ys) _ list
    obtain ⟨after,d,e,split2,mid,post⟩ := normalPrefix n _ c before last [child] ys b rest
    have an := listEvents _ _ _ _ left pre
    have en := listEvents _ _ _ _ right post
    have same : tr=d := by rw [split,split2,an,en,List.nil_append,List.append_nil]
    exact ⟨before,after,by rw [same]; exact singleton _ _ _ _ _ _ _ mid⟩

open Inv48.QuoteMemory Inv48.WholeQuote

def preAggregate := (actualStatements.drop 1).take 8
def aggregateHoist := (hoistP "_ret_aggregateExposureAttoEth_0"
  "__internal_aggregateExposureAttoEth()#[]" []).value
def postAggregate := actualStatements.drop 10

theorem interiorSegments : actualStatements =
    [minP.value] ++ preAggregate ++ [aggregateHoist] ++ postAggregate := by
  unfold preAggregate postAggregate
  rw [Inv48.QuoteFundingFields.actualInterior]
  rfl

def silenceCertificate : Bool :=
  preAggregate.all (stmtSafe 100 Inv48.Source.model.core.table) &&
  postAggregate.all (stmtSafe 100 Inv48.Source.model.core.table)

theorem silenceChecked : silenceCertificate = true := by native_decide

theorem beforeSilent : preAggregate.all (stmtSafe 100 Inv48.Source.model.core.table) = true := by
  have h := silenceChecked
  simp only [silenceCertificate,Bool.and_eq_true] at h
  exact h.1

theorem afterSilent : postAggregate.all (stmtSafe 100 Inv48.Source.model.core.table) = true := by
  have h := silenceChecked
  simp only [silenceCertificate,Bool.and_eq_true] at h
  exact h.2
end Inv48.WholeQuoteEvents
