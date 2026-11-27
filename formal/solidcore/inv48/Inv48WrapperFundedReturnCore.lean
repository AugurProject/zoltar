import Inv48ObservedFundedCellCore
import Inv48ObservedTailBoundsCapture
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WrapperFundedReturn

open Inv48.WholeQuote Inv48.QuoteMemory Inv48.ObservedMinimumHeap
open Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option linter.unnecessarySimpa false
set_option maxRecDepth 1000000
set_option maxHeartbeats 20000000

theorem atQuoteReturn {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q (n+12) p a b fn rows)
    (h : Body (n+56) {{q.context with checked := true} with checked := true}
      {Inv48.QuoteMinimumJoin.callSite
        (prepared (Inv48.RequestPrologue.base q.runtime) p a b).pushScope p with locals := []}
      p s.recovery.during s.recovery.value)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment h.observed.collateral.joined.context h.observed.collateral.joined.caller)
    (base : Inv48.CollateralReturnedMinimum.BaseDeployment h.observed.collateral.joined)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle h.observed.collateral.joined.context h.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) h.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment h.observed.rep.joined.context h.observed.rep.joined.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle h.observed.rep.joined.context h.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) h.observed.rep.joined.during)
    (run : Interaction.Executes (Stmt.eval (n+67) Inv48.Source.model.core.table
      {q.context with checked := true} (entry (Inv48.RequestPrologue.base q.runtime) p a b)
      bodyP.value) s.quoteTrace (.ok (.normal s.post)))
    (multiplier minimum priority feeMul : Nat)
    (haltWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "escalationHaltMultiplierBps" multiplier)
    (minimumWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "minimumReportCollateral" minimum)
    (priorityWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "initialReportPriorityFeeAttoEthPerGas" priority)
    (feeWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "maxSettlementBaseFeeMultiplierBps" feeMul)
    (oracle : OracleInputs {q.context with checked := true}
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0) rows)
 :
    let id := (Inv48.RequestPrologue.base q.runtime).nextMemory
    let f := Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal id a p
    ∃ C R getter words last mt st baseFee,
      C≤a ∧ R*10^18≤a*p ∧ Inv48.QuoteExec.repAmount a p<Inv32Division.R ∧
      s.recovery.value = .returned getter words ∧ f.state = getter.state ∧
      s.quoteTrace = mt ++ st ∧
      Interaction.Executes (Stmt.evalList (n+65) Inv48.Source.model.core.table
        {q.context with checked := true} f tailCode) st (.ok (.normal last)) ∧
      last.popScope.popScope = s.post ∧
      baseFee=EnvWord.blockBasefee.eval {q.context with checked := true}+priority ∧
      baseFee<Inv32Division.R ∧ baseFee*feeMul/10000<Inv32Division.R ∧
      last.lookupLocal? "quote" = some (.memoryRef id) ∧
      s.post.loadMemory? id = some (tuple a (Inv48.QuoteExec.repAmount a p)
        (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100))
        ((a-minimum)*100) (baseFee*feeMul/10000)) := by
  obtain ⟨C0,R0,getter0,words0,ca0,ra0,value0,same0,ref0,mem0,next0⟩ :=
    Inv48.ObservedMinimumHeap.atFundingCut q (n+12) p a b fn rows s h hp ha hb dC base envC dR envR
  have bounty0 : s.recovery.cut.minimumFinal.lookupLocal? "bountyAttoEth" = some (.word b) := by
    rw [← same0]
    rfl
  have earlier : (Inv48.RequestPrologue.base q.runtime).nextMemory <
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0).nextMemory := by
    change _ < s.recovery.cut.minimumFinal.nextMemory
    rw [next0]
    omega
  have bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word b) := by
    cases H : s.recovery.cut.minimumFinal.locals <;>
      simpa [oracleOut,aggregateOut,Inv48.ExposureHeap.continued,Inv48.FundingMathTail.halted,Inv48.ObservedFundedCell.funded,
        Inv48.QuoteMemory.put,Inv32OneArg.store,Runtime.lookupLocal?,Runtime.declareLocal,
        LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Inv03.Bodies.tmp,Inv32CeilFlags.h0,H] using bounty0
  obtain ⟨C,R,getter,words,last,mt,st,ca,ra,fit,value,state,ref,mem,next,split,tail,pop⟩ :=
    Inv48.ObservedFundedCell.atFundingCut q (n+12) p a b fn rows s h hp ha hb dC base envC dR envR run
  have aligned : Inv48.ChildExtraction.Matches rows st := by
    intro event member
    apply s.aligned event
    rw [split]
    exact List.mem_append_right _ member
  have code : tailCode = actualStatements.drop 5 := by
    rw [Inv48.QuoteFundingFields.actualInterior]
    unfold tailCode
    rw [oracleCode_eq,Inv48.WholeQuote.haltX_eq,Inv48.WholeQuote.haltY_eq,
      Inv48.WholeQuote.denom_eq,Inv48.WholeQuote.feeX_eq,Inv48.WholeQuote.feeY_eq]
    rfl
  have tail' : Interaction.Executes (Stmt.evalList (n+65) Inv48.Source.model.core.table
      {q.context with checked := true}
      (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
      (actualStatements.drop 5)) st (.ok (.normal last)) := by
    simpa only [Nat.add_assoc,code] using tail
  obtain ⟨fee,eq,feeFit,settlementFit,lastRef,lastMem⟩ := Inv48.ObservedTailBounds.suffixFields
    n {q.context with checked := true} s.recovery.cut.minimumFinal _ last rows
    _ a (Inv48.QuoteExec.repAmount a p) b multiplier minimum priority feeMul ref mem ha hb fit
    haltWord minimumWord priorityWord feeWord (fun _ => rfl) oracle earlier bountyRead rfl st aligned tail'
  refine ⟨C,R,getter,words,last,mt,st,fee,ca,ra,fit,value,state,split,?_,pop,eq,feeFit,settlementFit,lastRef,?_⟩
  · simpa only [Nat.add_assoc] using tail
  · rw [← pop]
    exact lastMem

#print axioms atQuoteReturn
end Inv48.WrapperFundedReturn
