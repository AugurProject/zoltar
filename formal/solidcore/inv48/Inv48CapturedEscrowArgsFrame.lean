import Inv48QuoteContinuationIdentityShared
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.CapturedEscrowArgs
open Inv48.QuoteContinuationIdentity
open Inv48.ActualSiteGuardJoin Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem recoveredFrame (n : Nat) (c : Context) (raw initialRuntime : Runtime)
    (fn quoteFn : InternalFunction) (saved : LocalEnv) (s p a b g : Nat)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn)
    (callEntry : internalCallEnter? fn (args s p a b g) raw = some (initialRuntime,saved))
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (k (.reverted mid err)) rest (.ok out))
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c initialRuntime fn.body >>= k) trace (.ok out)) :
    ∃ q : Site (Stmt.eval (n+5) Inv48.Source.model.core.table c initialRuntime fn.body >>= k)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
      Inv48.ObservedQuoteJoin.Site.Joined q n p a b quoteFn ∧ ∃ cut : Cut q n p a b,
        (∃ old, cut.start.locals = [(Inv48.QuoteTransport.hoist,.memoryRef old)] :: [] :: requestFrame s p a b g :: []) ∧
        (∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out)) := by
  rw [shape fn registered] at run
  obtain ⟨cleaned,ct,rest,splitC,cleanupRun,innerRun⟩ :=
    blockPrefix (n+4) c initialRuntime cleanup _ (outerTail fn) k trace out safeCleanup reject run
  let outerK := fun v => listNext (n+4) Inv48.Source.model.core.table c (outerTail fn) v >>= fun x => pop x >>= k
  have rejectOuter : ∀ mid err rest, ¬ Interaction.Executes (outerK (.reverted mid err)) rest (.ok out) := by
    intro mid err rest bad
    exact reject _ _ _ bad
  have innerTree : Stmt.eval (n+4) Inv48.Source.model.core.table c cleaned
      (.block (guards ++ guard 5 :: quoteBlockP.value :: innerTail)) =
      (Stmt.evalList (n+3) Inv48.Source.model.core.table c cleaned.pushScope
        (guards ++ guard 5 :: quoteBlockP.value :: innerTail) >>= pop) := by rw [Stmt.eval]; rfl
  rw [innerTree,assoc] at innerRun
  simp only [assoc] at innerRun
  let innerK := fun v => pop v >>= outerK
  have rejectInner : ∀ mid err rest, ¬ Interaction.Executes (innerK (.reverted mid err)) rest (.ok out) := by
    intro mid err rest bad
    exact rejectOuter _ _ _ bad
  obtain ⟨guarded,gt,restG,splitG,guardRun,hoistRest⟩ :=
    listPrefix (n+3) c cleaned.pushScope guards _ innerK rest out safeGuards rejectInner innerRun
  have align : Inv48.EscrowPrefix.ExecutesOK
      (Stmt.evalList (n+3) Inv48.Source.model.core.table c initialRuntime.pushScope cleanup) ct (.normal cleaned) := by
    have enteredEq := callEntry
    rw [entered fn registered raw s p a b g] at enteredEq
    obtain ⟨eq,_⟩ := Prod.mk.inj (Option.some.inj enteredEq)
    rw [← eq] at cleanupRun ⊢
    rw [cleanupExecution (n+3) _ c raw s p a b g hp ha hb hg] at cleanupRun
    rw [cleanupExecution (n+2) _ c raw s p a b g hp ha hb hg]
    exact cleanupRun
  have frame := allGuardsPrefix (n+2) c raw initialRuntime cleaned guarded fn saved s p a b g
    registered callEntry hp ha hb hg ct gt align guardRun
  obtain ⟨hoisted,ht,restH,splitH,hoistRun,quoteRest⟩ :=
    listPrefix (n+3) c guarded [guard 5] _ innerK restG out safeHoist rejectInner hoistRest
  rw [Inv48.WholeQuote.singleList] at hoistRun
  have looks := hoistToQuoteBlock (n+2) c guarded hoisted s p a b g frame.2.1 ht hoistRun
  rw [Stmt.evalList,assoc] at quoteRest
  let quoteK := fun v => listNext (n+3) Inv48.Source.model.core.table c innerTail v >>= innerK
  obtain ⟨localSite,fuel,runtime,P,A,B,kEq,beforeEq,afterEq,contextEq⟩ := Inv48.QuoteContinuationIdentity.quoteBlockSite n c hoisted p a b hp ha hb
    looks.1 looks.2.1 looks.2.2 quoteK restH out quoteRest
  let q : Site (Stmt.eval (n+5) Inv48.Source.model.core.table c initialRuntime fn.body >>= k)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out :=
    { localSite with
      before := ct ++ (gt ++ (ht ++ localSite.before))
      split := by
        calc
          trace = ct ++ rest := splitC
          _ = ct ++ (gt ++ restG) := congrArg (fun tr => ct ++ tr) splitG
          _ = ct ++ (gt ++ (ht ++ restH)) := congrArg (fun tr => ct ++ (gt ++ tr)) splitH
          _ = ct ++ (gt ++ (ht ++ (localSite.before ++ localSite.after))) :=
            congrArg (fun tr => ct ++ (gt ++ (ht ++ tr))) localSite.split
          _ = _ := by simp only [List.append_assoc]
      reached := by
        rw [shape fn registered,blockSplit,assoc]
        apply (Prefix.ofExecution cleanupRun _).trans
        dsimp only
        simp only [assoc]
        change Prefix (Stmt.eval (n+4) Inv48.Source.model.core.table c cleaned
          (.block (guards ++ guard 5 :: quoteBlockP.value :: innerTail)) >>= outerK) _ _
        rw [innerTree,assoc]
        rw [Inv48.WholeQuote.listAppend,assoc]
        apply (Prefix.ofExecution guardRun _).trans
        change Prefix (Stmt.evalList (n+3) _ c guarded ([guard 5] ++ quoteBlockP.value::innerTail) >>= innerK) _ _
        rw [Inv48.WholeQuote.listAppend,assoc]
        have hr : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c guarded [guard 5]) ht (.ok (.normal hoisted)) := by rwa [Inv48.WholeQuote.singleList]
        apply (Prefix.ofExecution hr _).trans
        simpa only [Stmt.evalList,assoc] using localSite.reached }
  refine ⟨q, ⟨⟨fuel,P,A,B,?_⟩, hoisted, ?_⟩, ?_⟩
  · exact Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb fuel P A B
  · exact runtime
  · refine ⟨⟨hoisted,innerK,ct ++ (gt ++ ht),restH,?_,?_,?_,?_,?_,?_,?_,?_,?_⟩, ?_, ?_⟩
    · exact fuel
    · exact runtime
    · change Stmt.evalList (n+2) _ localSite.context hoisted.pushScope _ = pure (.normal localSite.runtime)
      rw [contextEq,runtime]
      exact Inv48.SiteEntryBridge.prefixExecution (n+1) _ c hoisted p a b hp ha hb
        looks.1 looks.2.1 looks.2.2
    · dsimp [q]; rw [beforeEq]; simp
    · exact afterEq
    · simpa only [List.append_assoc] using splitC.trans ((congrArg (fun tr => ct ++ tr) splitG).trans
        (congrArg (fun tr => ct ++ (gt ++ tr)) splitH))
    · change Prefix _ _ (Stmt.evalList (n+3) _ localSite.context hoisted _ >>= innerK)
      rw [contextEq]
      rw [shape fn registered,blockSplit,assoc]
      apply (Prefix.ofExecution cleanupRun _).trans
      dsimp only
      simp only [assoc]
      rw [innerTree,assoc,Inv48.WholeQuote.listAppend,assoc]
      apply (Prefix.ofExecution guardRun _).trans
      change Prefix (Stmt.evalList (n+3) _ c guarded ([guard 5] ++ quoteBlockP.value :: innerTail) >>= innerK) _ _
      rw [Inv48.WholeQuote.listAppend,assoc]
      have hr : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c guarded [guard 5]) ht (.ok (.normal hoisted)) := by
        rwa [Inv48.WholeQuote.singleList]
      have h := Prefix.ofExecution hr (fun v => listNext (n+3) Inv48.Source.model.core.table c (quoteBlockP.value :: innerTail) v >>= innerK)
      have drop : Inv48.RequestQuote.actual.drop 6 = quoteBlockP.value :: innerTail :=
        dropAt _ 6 _ actualQuoteBlock
      simpa only [drop,Stmt.evalList,listNext,assoc] using h
    · have drop : Inv48.RequestQuote.actual.drop 6 = quoteBlockP.value :: innerTail :=
        dropAt _ 6 _ actualQuoteBlock
      simpa only [q,contextEq,drop,Stmt.evalList,assoc] using quoteRest
    · simpa only [q,contextEq,innerTail,quoteK] using kEq

    · have source : guard 5 = (memoryDeclP Inv48.QuoteTransport.hoist).value := by
        simp only [Inv48.GuardArgsFrame.guard,actualHoist,Option.getD_some]
      have tree := hoistDefault (n+2) Inv48.Source.model.core.table c guarded [] s p a b g
      have same : ({guarded with locals := []::[]::requestFrame s p a b g::[]} : Runtime) = guarded := by
        rw [← frame.2.1]
      rw [same] at tree
      rw [source] at hoistRun
      change Interaction.Executes (Stmt.eval (n+3) _ c guarded
        (.memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.hoist none)) ht (.ok (.normal hoisted)) at hoistRun
      rw [tree] at hoistRun
      have eq := Inv48.EscrowPrefix.pureResult _ _ _ hoistRun
      cases eq.2
      exact ⟨guarded.nextMemory,rfl⟩
    · exact rejectInner

end Inv48.CapturedEscrowArgs
