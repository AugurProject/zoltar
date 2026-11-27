import Inv48ObservedMinimumHeapActual
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.Positive Inv48.QuoteMinimumJoin Inv48.WholeQuote Inv48.QuoteMemory Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem funding (n : Nat) (c : Context) (physical after : Runtime)
    (rows : ScriptedResponder) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : bounty<Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result)
    (s : Body n {c with checked := true}
      {callSite (prepared physical p a bounty).pushScope p with locals := []} p trace out)
    (bodyRun : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table
      {c with checked := true}
      (start {callSite (prepared physical p a bounty).pushScope p with locals := []} p)
      Inv48.Public.body) trace (.ok out))
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (dC : Inv48.CollateralCloneStage.Deployment s.observed.collateral.joined.context s.observed.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.observed.collateral.joined)
    (envC : CanonicalOracle s.observed.collateral.joined.context s.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.observed.rep.joined.context s.observed.rep.joined.caller)
    (envR : CanonicalOracle s.observed.rep.joined.context s.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.observed.rep.joined.during)
    (quoteRun : (Stmt.eval ((n+5)+6) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value).runWith rows = .ok (.normal after))
    (actual : Runtime) (minimumTrace : Interaction.Transcript)
    (minimumAligned : Inv48.ChildExtraction.Matches rows minimumTrace)
    (minimumRun : Interaction.Executes (Stmt.eval ((n+5)+4) Inv48.Source.model.core.table c
      (prepared physical p a bounty) minP.value) minimumTrace (.ok (.normal actual)))
    (k : Nat) (fits : Inv48.QuoteExec.repAmount a p<Inv32Division.R)
    (last : Runtime) (suffixTrace : Interaction.Transcript) (tail : List Source.Stmt)
    (run : Interaction.Executes (Stmt.evalList (k+20) Inv48.Source.model.core.table c actual
      (((actualStatements.drop 1).take 4) ++ tail)) suffixTrace (.ok (.normal last))) :
    let funded := put (Inv32OneArg.store (put actual physical.nextMemory a 0 0 0 0)
      Inv32CeilFlags.h0 (Inv48.QuoteExec.repAmount a p))
      physical.nextMemory a (Inv48.QuoteExec.repAmount a p) 0 0 0
    ∃ (C R : Nat) (getter : Runtime),
      C≤a ∧ R*10^18≤a*p ∧ funded.state = getter.state ∧
      funded.loadMemory? physical.nextMemory = some (tuple a (Inv48.QuoteExec.repAmount a p) 0 0 0) ∧
      Stmt.evalList (k+20) Inv48.Source.model.core.table c actual
        ((actualStatements.drop 1).take 4) = pure (.normal funded) ∧
      Interaction.Executes (Stmt.evalList (k+20) Inv48.Source.model.core.table c funded tail)
        suffixTrace (.ok (.normal last)) := by
  obtain ⟨C,R,getter,words,ca,ra,value,same,ref,mem,_⟩ := atMinimumFinal n c physical after rows
    p a bounty hp ha hb trace out s bodyRun aligned dC b envC dR envR quoteRun
    actual minimumTrace minimumAligned minimumRun
  exact ⟨C,R,getter,Inv48.ObservedFundingSuffix.writes k c physical getter actual last
    p a bounty C R physical.nextMemory 0 0 0 0 0 same ca ra hp ha fits ref mem suffixTrace tail run⟩
end Inv48.ObservedMinimumHeap
