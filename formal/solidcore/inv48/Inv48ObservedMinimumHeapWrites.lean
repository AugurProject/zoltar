import Inv48ObservedMinimumHeapQuote
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem writes (physical : Runtime) (p a bounty : Nat)
    (s : Body n c {Inv48.QuoteMinimumJoin.callSite
      (Inv48.WholeQuote.prepared physical p a bounty).pushScope p with locals := []} p trace out) (hp : p<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment s.observed.collateral.joined.context s.observed.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.observed.collateral.joined)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle s.observed.collateral.joined.context s.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.observed.rep.joined.context s.observed.rep.joined.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle s.observed.rep.joined.context s.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.observed.rep.joined.during)
    (getter actual last : Runtime) (words : List Value)
    (returned : out = .returned getter words)
    (same : Inv48.ObservedMinimumGuard.afterBase (prepared physical p a bounty) getter = actual)
    (k C R : Nat) (collateral : C≤a) (rep : R*10^18≤a*p)
    (ha : a<Inv32Division.R) (fits : Inv48.QuoteExec.repAmount a p<Inv32Division.R)
    (suffixTrace : Interaction.Transcript) (tail : List Source.Stmt)
    (run : Interaction.Executes (Stmt.evalList (k+20) Inv48.Source.model.core.table c actual
      (((actualStatements.drop 1).take 4) ++ tail)) suffixTrace (.ok (.normal last))) :
    let funded := put (Inv32OneArg.store (put actual physical.nextMemory a 0 0 0 0)
      Inv32CeilFlags.h0 (Inv48.QuoteExec.repAmount a p))
      physical.nextMemory a (Inv48.QuoteExec.repAmount a p) 0 0 0
    C≤a ∧ R*10^18≤a*p ∧
    funded.state = getter.state ∧
    funded.loadMemory? physical.nextMemory = some (tuple a (Inv48.QuoteExec.repAmount a p) 0 0 0) ∧
    Stmt.evalList (k+20) Inv48.Source.model.core.table c actual
      ((actualStatements.drop 1).take 4) = pure (.normal funded) ∧
    Interaction.Executes (Stmt.evalList (k+20) Inv48.Source.model.core.table c funded tail)
      suffixTrace (.ok (.normal last)) := by
  obtain ⟨ref,mem,_⟩ := quoteCell physical p a bounty s hp dC b envC dR envR getter words returned
  rw [same] at ref mem
  exact Inv48.ObservedFundingSuffix.writes k c physical getter actual last
    p a bounty C R physical.nextMemory 0 0 0 0 0 same collateral rep hp ha fits ref mem suffixTrace tail run

end Inv48.ObservedMinimumHeap
