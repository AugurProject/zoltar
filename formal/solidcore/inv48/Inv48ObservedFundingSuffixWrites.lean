import Inv48QuoteOperandReadsCore
import Inv48ObservedFundingSuffixCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedFundingSuffix
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Exact funding writes from the adopted runtime. Heap observations refer to
that runtime, never to a reconstructed getter input. The successful suffix is
inverted and its tail retained, with the same physical state and observed C/R. -/
theorem writes (n : Nat) (c : Context) (physical getter actual last : Runtime)
    (p a bounty C R id oldA oldB h e s : Nat)
    (same : Inv48.ObservedMinimumGuard.afterBase (prepared physical p a bounty) getter = actual)
    (collateral : C≤a) (rep : R*10^18≤a*p)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R)
    (fits : Inv48.QuoteExec.repAmount a p<Inv32Division.R)
    (ref : actual.lookupLocal? "quote" = some (.memoryRef id))
    (mem : actual.loadMemory? id = some (tuple oldA oldB h e s))
    (trace : Interaction.Transcript) (tail : List Source.Stmt)
    (run : Interaction.Executes (Stmt.evalList (n+20) Inv48.Source.model.core.table c actual
      (((actualStatements.drop 1).take 4) ++ tail)) trace (.ok (.normal last))) :
    let funded := put (Inv32OneArg.store (put actual id a oldB h e s)
      Inv32CeilFlags.h0 (Inv48.QuoteExec.repAmount a p))
      id a (Inv48.QuoteExec.repAmount a p) h e s
    C≤a ∧ R*10^18≤a*p ∧
    funded.state = getter.state ∧
    funded.loadMemory? id = some (tuple a (Inv48.QuoteExec.repAmount a p) h e s) ∧
    Stmt.evalList (n+20) Inv48.Source.model.core.table c actual
      ((actualStatements.drop 1).take 4) = pure (.normal funded) ∧
    Interaction.Executes (Stmt.evalList (n+20) Inv48.Source.model.core.table c funded tail)
      trace (.ok (.normal last)) := by
  have A : actual.lookupLocal? "requestedInitialAttoWeth" = some (.word a) := by rw [← same]; rfl
  have P : actual.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by rw [← same]; rfl
  have step := fundedQuote Inv48.FeedMath.productLinked Inv48.FeedMath.floorLinked
    Inv48.FeedMath.roundsLinked Inv48.FeedMath.uintLinked Inv48.FeedMath.roundedLinked
    n c actual id oldA oldB h e s a p ref mem A P ha hp fits
  change Stmt.evalList (n+20) Inv48.Source.model.core.table c actual (collateralWrite :: fundingCode) = _ at step
  rw [← Inv48.QuoteFundingFields.actualFundingSlice] at step
  refine ⟨collateral,rep,?_,put_load _ _ _ _ _ _ _,step,?_⟩
  · change actual.state = getter.state
    rw [← same]
    rfl
  · rw [Inv48.WholeQuote.listAppend,step] at run
    exact run

/-- Physical immutable constraints survive the actual funding writes. -/
theorem physicalWrite (c : Context) (actual : Runtime) (name : String) (v : Nat)
    (word : Inv48.QuoteOperandReads.PhysicalWord c actual name v)
    (id a oldB h e s rep : Nat) :
    (put (Inv32OneArg.store (put actual id a oldB h e s) Inv32CeilFlags.h0 rep)
      id a rep h e s).loadImmutableField c name = .ok (.word v) :=
  Inv48.QuoteOperandReads.physicalRead word rfl

#print axioms writes
#print axioms physicalWrite
end Inv48.ObservedFundingSuffix
