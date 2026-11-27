import Inv48LiquidationGuardObserved
import Inv48PositiveRunCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumGuardRuntime
open Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pureResult {α : Type} (a b : α) (tr : Interaction.Transcript)
    (run : Interaction.Executes (pure a : SolI α) tr (.ok b)) : tr=[] ∧ b=a := by
  cases run
  exact ⟨rfl,rfl⟩

/-- The current three-statement minimum prefix restores the exact caller
runtime after the actual guard, then declares the collateral result temporary. -/
theorem preserved (n : Nat) (c : Context) (base final : Runtime) (p : Nat)
    (fit : p<Inv32Division.R) (positive : 0<p) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c (root base p)
      [.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,
        .varDecl .uint256 h0 none]) trace (.ok (.normal final))) :
    trace=[] ∧ final=saved (root base p) h0 0 := by
  have guard := Inv32QuoteGuard.requireEval (n+2) Inv48.Source.model.core.table c (root base p)
    condition true "Initial oracle price zero" (positiveCondition c base p fit positive)
  have zero := Inv32FloorStart.zero (n+2) Inv48.Source.model.core.table c (root base p) h0
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ guard,Stmt.evalList] at run
  obtain ⟨value,before,after,split,actual,last⟩ := GuardRecovery.bindSuccess _ _ _ _ run
  cases value <;> try cases last
  case normal mid =>
    obtain ⟨g⟩ := GuardRecovery.guardPassage n c (root base p) mid before actual
    have price : (root base p).lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
      dsimp [root,start]
      write_param
    obtain ⟨_,_,_,_,_,_,_,empty,same⟩ := GuardRecovery.observedSuccess g p fit price
    rw [same] at last
    dsimp only at last
    have tail : Stmt.evalList (n+3) Inv48.Source.model.core.table c (root base p)
        [.varDecl .uint256 h0 none] = pure (.normal (saved (root base p) h0 0)) :=
      (Inv32FloorStart.seqStep _ _ _ _ _ _ _ zero).trans (by simp [Stmt.evalList,saved])
    rw [tail] at last
    obtain ⟨emptyTail,result⟩ := pureResult _ _ _ last
    exact ⟨by rw [split,empty,emptyTail]; rfl,Result.normal.inj result⟩
#print axioms preserved
end Inv48.MinimumGuardRuntime
