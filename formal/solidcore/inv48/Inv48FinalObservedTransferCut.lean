import Inv48PublicObservedQuoteCapture
import Inv48FinalObservedTransferTail
import Inv48WrapperFundedReturnExport
import Inv48EscrowFailurePropagationTrace
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.FinalObservedTransfer
open Inv48.WrapperFundedReturn
open Inv48.WholeQuote Inv48.QuoteMemory Inv48.ObservedMinimumHeap
open Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option linter.unnecessarySimpa false
set_option maxRecDepth 1000000
set_option maxHeartbeats 20000000

theorem atSharedInvocation {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n helperFuel p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (sponsor gas : Nat)
    (cut : Inv48.QuoteContinuationIdentity.Cut q (n+helperFuel+67) p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q (n+helperFuel+67) p a b fn)
    (sourceFrame : ∃ old, cut.start.locals = [(Inv48.QuoteTransport.hoist,.memoryRef old)] :: Inv48.CapturedEscrowArgs.rest sponsor p a b gas)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out))
    (payerFits : q.context.sender<2^160) (sponsorFits : sponsor<2^160) (gasFits : gas<2^32)
    (selfFits : q.context.self<2^256) (construction : q.context.construction=false)
    (folded : Inv48.PublicObservedQuote.Folded q (n+helperFuel+67) p a b fn rows) :
    ∃ s : Inv48.MinimumGuardSiteJoin.FundingTrace q (n+helperFuel+12) p a b fn rows,
    ∀
    (dC : Inv48.CollateralCloneStage.Deployment (bodyAt s).observed.collateral.joined.context (bodyAt s).observed.collateral.joined.caller)
    (_base : Inv48.CollateralReturnedMinimum.BaseDeployment (bodyAt s).observed.collateral.joined)
    (_envC : Inv48.MinimumSuccessWords.CanonicalOracle (bodyAt s).observed.collateral.joined.context (bodyAt s).observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) (bodyAt s).observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment (bodyAt s).observed.rep.joined.context (bodyAt s).observed.rep.joined.caller)
    (_envR : Inv48.MinimumSuccessWords.CanonicalOracle (bodyAt s).observed.rep.joined.context (bodyAt s).observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) (bodyAt s).observed.rep.joined.during)
    (multiplier minimum priority feeMul : Nat)
    (_haltWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "escalationHaltMultiplierBps" multiplier)
    (_minimumWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "minimumReportCollateral" minimum)
    (_priorityWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "initialReportPriorityFeeAttoEthPerGas" priority)
    (_feeWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "maxSettlementBaseFeeMultiplierBps" feeMul)
    (oracle : OracleInputs {q.context with checked := true}
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0) rows)
,
    ∃ site preTrace callTrace next,
      trace = q.before ++ preTrace ++ callTrace ∧
      site.lookupLocal? "quote" = some (.memoryRef (Inv48.RequestPrologue.base q.runtime).nextMemory) ∧
      Expr.eval q.context site (Inv48.RequestQuote.calldataExpr 2391489481) =
        pure (.bytes (Inv48.RequestQuote.calldata 2391489481 q.context.sender sponsor a
          (Inv48.QuoteExec.repAmount a p)
          (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b gas),site) ∧
      Interaction.Executes
        ((selfDispatchCall q.context site.state .call q.context.self
          (Inv48.RequestQuote.calldata 2391489481 q.context.sender sponsor a
            (Inv48.QuoteExec.repAmount a p)
            (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b gas) 0 none >>=
          Inv48.RequestQuote.reply (n+helperFuel+68) Inv48.Source.model.core.table q.context site
            Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody) >>= next)
        callTrace (.ok out) ∧
      (∀ mid err rest, ¬ Interaction.Executes (next (.reverted mid err)) rest (.ok out)) := by
  obtain ⟨s,fundedReturn⟩ := Inv48.WrapperFundedReturn.atSharedInvocation q n helperFuel p a b fn rows linked hp ha hb folded
  refine ⟨s,?_⟩
  intro dC base envC dR envR multiplier minimum priority feeMul
    haltWord minimumWord priorityWord feeWord oracle
  obtain ⟨C,R,getter,words,last,mt,st,fee,ca,ra,fit,value,state,split,tail,pop,
    feeEq,feeFit,settlementFit,lastRef,heap⟩ := fundedReturn
      dC base envC dR envR multiplier minimum priority feeMul
      haltWord minimumWord priorityWord feeWord oracle
  obtain ⟨C0,R0,getter0,words0,ca0,ra0,value0,same0,ref0,mem0,next0⟩ :=
    Inv48.ObservedMinimumHeap.atFundingCut q (n+helperFuel+12) p a b fn rows s (bodyAt s) hp ha hb dC base envC dR envR
  have funding := Inv48.ObservedFundedCell.fundingFacts getter0 s.recovery.cut.minimumFinal a
    (Inv48.QuoteExec.repAmount a p) (Inv48.RequestPrologue.base q.runtime).nextMemory
    (by rw [← same0]; rfl) ref0 next0
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
  have earlier : (Inv48.RequestPrologue.base q.runtime).nextMemory <
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal
        (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0).nextMemory := by
    change _ < s.recovery.cut.minimumFinal.nextMemory
    rw [next0]
    omega
  have bounty0 : s.recovery.cut.minimumFinal.lookupLocal? "bountyAttoEth" = some (.word b) := by
    rw [← same0]; rfl
  have bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word b) := by
    cases H : s.recovery.cut.minimumFinal.locals <;>
      simpa [oracleOut,aggregateOut,Inv48.ExposureHeap.continued,Inv48.FundingMathTail.halted,Inv48.ObservedFundedCell.funded,
        Inv48.QuoteMemory.put,Inv32OneArg.store,Runtime.lookupLocal?,Runtime.declareLocal,
        LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Inv03.Bodies.tmp,Inv32CeilFlags.h0,H] using bounty0
  have tail' : Interaction.Executes (Stmt.evalList ((n+helperFuel)+65) Inv48.Source.model.core.table
      {q.context with checked := true} (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p) (actualStatements.drop 5)) st (.ok (.normal last)) := by
    simpa only [Nat.add_assoc,code] using tail
  obtain ⟨_,hc,_,hh,_,_,_⟩ := Inv48.ObservedTailBounds.suffixBounds (n+helperFuel)
    {q.context with checked := true} s.recovery.cut.minimumFinal _ last rows
    _ a (Inv48.QuoteExec.repAmount a p) b multiplier minimum priority feeMul funding.2.1 funding.2.2.1 ha hb fit
    haltWord minimumWord priorityWord feeWord (fun _ => rfl) oracle earlier bountyRead rfl st aligned tail'
  obtain ⟨exactFee,lastExact,_,_,_,_,_⟩ := suffixExact (n+helperFuel)
    {q.context with checked := true} s.recovery.cut.minimumFinal _ last rows
    _ a (Inv48.QuoteExec.repAmount a p) b multiplier minimum priority feeMul funding.2.1 funding.2.2.1 ha hb fit
    haltWord minimumWord priorityWord feeWord (fun _ => rfl) oracle earlier bountyRead rfl st aligned tail'
  have postLocals : s.post.locals = (allocated (Inv48.RequestPrologue.base q.runtime) p a b).locals := by
    rw [← pop,lastExact]
    simp only [Inv48.FundingMathTail.finalState,Inv48.FundingMathTail.exposed,maximum]
    split <;>
      simp [oracleOut,aggregateOut,Inv48.ExposureHeap.continued,Inv48.ExposureHeap.caller,
        Inv48.FundingMathTail.halted,put,Inv32OneArg.store,Runtime.declareLocal,
        Runtime.popScope,LocalEnv.declare,← same0,Inv48.ObservedMinimumGuard.afterBase,
        prepared,Runtime.pushScope]
  have postRef : s.post.lookupLocal? "quote" = some (.memoryRef (Inv48.RequestPrologue.base q.runtime).nextMemory) := by
    change s.post.locals.lookup? "quote" = _
    rw [postLocals]
    rfl
  have keeps : Inv48.QuoteTailPreserve.Keeps s.post
      (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) :=
    ⟨postRef,_,_,_,heap⟩
  have shape := Inv48.WholeQuote.actualBody
  rw [linked] at shape
  have bodyEq : fn.body = bodyP.value := Option.some.inj shape
  have evaluation := s.quoteRun
  rw [← bodyEq] at evaluation
  obtain ⟨origin,caller,bt,aft,originEq,callerEq,traceSplit,_,_,_,_,_,_,run⟩ :=
    Inv48.PublicObservedQuote.Capture.observedCapture q (n+helperFuel+67) p a b fn rows cut joined folded s.post
      evaluation (Inv48.RequestPrologue.quoteMetadata fn linked).2 _ _ keeps
  subst caller
  have originLocals : origin.locals = cut.start.locals := by
    have eq := congrArg Runtime.locals (originEq.symm.trans cut.runtime)
    rw [Inv48.SiteEntryBridge.preparedLocals,Inv48.SiteEntryBridge.preparedLocals] at eq
    exact (List.cons.inj eq).2
  obtain ⟨old,frame⟩ := sourceFrame
  have he : (a-minimum)*100<2^256 := lt_of_le_of_lt
    (Nat.mul_le_mul_right 100 ((Nat.sub_le a minimum).trans hc)) (by decide)
  obtain ⟨pending,site,st',pt,ct,next,afterSplit,_,_,call,rejectNext,_,ref,mem,S,B,G⟩ :=
    Inv48.EscrowFailurePropagation.traced (n+helperFuel+67) q.context s.post origin sponsor p a b gas old
      (Inv48.RequestPrologue.base q.runtime).nextMemory _ _ _ cut.next aft out
      (originLocals.trans frame) heap he settlementFit reject run
  have hg : gas<Inv32Division.R := lt_of_lt_of_le gasFits (by decide)
  have hh' : max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)<Inv32Division.R := lt_of_le_of_lt hh (by decide)
  have encoding := Inv48.RequestQuote.encoding q.context site 2391489481 _ a _ _ _ _ sponsor b gas
    ref mem S B G ha fit hh' hb hg payerFits sponsorFits (by decide)
  have tree := Inv48.RequestQuote.callTree (n+helperFuel+68) Inv48.Source.model.core.table q.context site
    2391489481 _ a _ _ _ _ sponsor b gas Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups
    Inv48.RequestQuote.successBody ref mem S B G ha fit hh' hb hg payerFits sponsorFits (by decide) selfFits construction
  change Interaction.Executes (Stmt.eval ((n+helperFuel+68)+1) _ q.context site
    (.tryExternalCall .call .self (Inv48.RequestQuote.calldataExpr 2391489481) (.word 0) none false false
      Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody []) >>= next) ct (.ok out) at call
  rw [tree] at call
  exact ⟨site,bt++st'++pt,ct,next,by simp [traceSplit,afterSplit,List.append_assoc],ref,encoding,call,rejectNext⟩

#print axioms atSharedInvocation
end Inv48.FinalObservedTransfer
