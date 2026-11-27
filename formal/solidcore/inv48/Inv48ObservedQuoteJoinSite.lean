import Inv48ObservedQuoteJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.ObservedQuoteJoin.Site
open Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def Joined {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (quoteFn : InternalFunction) : Prop :=
  Inv48.ActualSiteGuardJoin.Joined q n p a b quoteFn ∧
    ∃ origin, q.runtime = Inv48.SiteEntryBridge.prepared origin p a b

/-- The cleanup, five guards, hoist, and concrete quote entry all belong to one completed shared run. -/
theorem shared (n : Nat) (c : Context) (raw initialRuntime : Runtime)
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
      Joined q n p a b quoteFn := by
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
  obtain ⟨localSite,fuel,runtime,P,A,B⟩ := Inv48.SiteEntryBridge.quoteBlockSite n c hoisted p a b hp ha hb
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
  refine ⟨q, ⟨fuel,P,A,B,?_⟩, hoisted, ?_⟩
  · exact Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb fuel P A B
  · exact runtime
end Inv48.ObservedQuoteJoin.Site

namespace Inv48.ObservedQuoteJoin.Site
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
open Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Consume the shared-body site already extracted by traversal. No wrapper arguments are evaluated here. -/
theorem atBody {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (fn quoteFn : InternalFunction)
    (bodySite : Site root Inv48.Source.model.core.table fn.body trace out)
    (n : Nat) (raw : Runtime) (saved : LocalEnv) (s p a b g : Nat)
    (fuel : bodySite.fuel = n+5)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn)
    (callEntry : internalCallEnter? fn (args s p a b g) raw = some (bodySite.runtime,saved))
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (bodySite.continuation (.reverted mid err)) rest (.ok out)) :
    ∃ q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
      Joined q n p a b quoteFn := by
  have run := bodySite.suffix
  rw [fuel] at run
  obtain ⟨localSite,⟨qfuel,P,A,B,_⟩,origin,originEq⟩ := shared n bodySite.context raw bodySite.runtime fn quoteFn saved
    s p a b g registered linked callEntry hp ha hb hg bodySite.continuation bodySite.after out reject run
  let q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out :=
    {localSite with
      before := bodySite.before ++ localSite.before
      split := bodySite.split.trans ((congrArg (fun tr => bodySite.before ++ tr) localSite.split).trans
        (List.append_assoc _ _ _).symm)
      reached := bodySite.reached.trans (by simpa only [fuel] using localSite.reached)}
  exact ⟨q,⟨qfuel,P,A,B,Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb qfuel P A B⟩,origin,originEq⟩
end Inv48.ObservedQuoteJoin.Site

namespace Inv48.ObservedQuoteJoin.Site
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
open Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Invert the successful shared call once. The conditional join uses precisely its recovered argument values. -/
theorem invocation (n : Nat) (c : Context) (r final : Runtime)
    (targets : List String) (expressions : List Expr) (trace : Interaction.Transcript)
    (fn quoteFn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn)
    (run : Interaction.Executes (Stmt.eval (n+6) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey expressions)) trace (.ok (.normal final))) :
    ∃ values mid argumentTrace remaining,
      trace = argumentTrace ++ remaining ∧
      Interaction.Executes (Expr.evalRefArgList c r expressions).caught argumentTrace (.ok (.ok (values,mid))) ∧
      ∀ s p a b g, values = args s p a b g →
        p < 2^256 → a < 2^256 → b < 2^256 → g < 2^32 →
        ∃ q : Site (Stmt.eval (n+6) Inv48.Source.model.core.table c r
            (.internalCall targets Inv48.RequestQuote.requestKey expressions))
            Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final),
          Joined q n p a b quoteFn := by
  rw [Stmt.eval] at run
  change Interaction.Executes ((Expr.evalRefArgList c r expressions).caught >>=
    callNext (n+5) Inv48.Source.model.core.table c r targets Inv48.RequestQuote.requestKey) trace (.ok (.normal final)) at run
  obtain ⟨v,bt,aft,split,first,last⟩ := bindSuccess _ _ _ _ run
  cases v with
  | error err => simp only [callNext] at last; cases last
  | ok pair =>
    obtain ⟨values,mid⟩ := pair
    cases entered : internalCallEnter? fn values mid with
    | none => simp only [callNext,registered,entered] at last; cases last
    | some pair =>
      obtain ⟨inner,saved⟩ := pair
      have bodyRun : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table
          {c with checked := true} inner fn.body >>= internalCallFinish fn targets saved) aft (.ok (.normal final)) := by
        simpa only [callNext,registered,entered] using last
      refine ⟨values,mid,bt,aft,split,first,?_⟩
      intro s p a b g eq hp ha hb hg
      have callEntry : internalCallEnter? fn (args s p a b g) mid = some (inner,saved) := by rwa [← eq]
      have reject : ∀ q err rest, ¬ Interaction.Executes
          (internalCallFinish fn targets saved (.reverted q err)) rest (.ok (.normal final)) := by
        intro q err rest bad
        simp only [internalCallFinish] at bad
        cases bad
      obtain ⟨localSite,joined⟩ := shared n {c with checked := true} mid inner fn quoteFn saved s p a b g
        registered linked callEntry hp ha hb hg (internalCallFinish fn targets saved) aft (.normal final) reject bodyRun
      let q : Site (Stmt.eval (n+6) Inv48.Source.model.core.table c r
          (.internalCall targets Inv48.RequestQuote.requestKey expressions))
          Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final) :=
        {localSite with
          before := bt ++ localSite.before
          split := split.trans ((congrArg (fun tr => bt ++ tr) localSite.split).trans (List.append_assoc _ _ _).symm)
          reached := by
            rw [Stmt.eval]
            change Prefix ((Expr.evalRefArgList c r expressions).caught >>=
              callNext (n+5) Inv48.Source.model.core.table c r targets Inv48.RequestQuote.requestKey) _ _
            apply (Prefix.ofExecution first _).trans
            simpa only [callNext,registered,entered] using localSite.reached}
      obtain ⟨⟨fuel,P,A,B,_⟩,origin,originEq⟩ := joined
      exact ⟨q,⟨fuel,P,A,B,Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb fuel P A B⟩,origin,originEq⟩
end Inv48.ObservedQuoteJoin.Site

namespace Inv48.ObservedQuoteJoin.Site
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
open Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Join an invocation recovered by WrapperTraversal; retain its original outer continuation. -/
theorem recovered {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (n : Nat) (targets : List String) (expressions : List Expr)
    (found : Inv48.WrapperTraversal.Recovered root targets expressions trace out (n+6))
    (fn quoteFn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn) :
    ∃ callSite : Site root Inv48.Source.model.core.table
        (.internalCall targets Inv48.RequestQuote.requestKey expressions) trace out,
      ∃ values mid argumentTrace,
        Interaction.Executes (Expr.evalRefArgList callSite.context callSite.runtime expressions).caught
          argumentTrace (.ok (.ok (values,mid))) ∧
        ∀ s p a b g, values = args s p a b g →
          p < 2^256 → a < 2^256 → b < 2^256 → g < 2^32 →
          ∃ q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
            Joined q n p a b quoteFn := by
  obtain ⟨callSite,fuel,final,during,rest,split,first,last⟩ := found
  obtain ⟨values,mid,argumentTrace,remaining,_,arguments,join⟩ :=
    invocation n callSite.context callSite.runtime final targets expressions during fn quoteFn registered linked first
  refine ⟨callSite,values,mid,argumentTrace,arguments,?_⟩
  intro s p a b g eq hp ha hb hg
  obtain ⟨localSite,joined⟩ := join s p a b g eq hp ha hb hg
  let q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out :=
    {localSite with
      continuation := fun v => localSite.continuation v >>= callSite.continuation
      before := callSite.before ++ localSite.before
      after := localSite.after ++ rest
      split := by
        calc
          trace = callSite.before ++ callSite.after := callSite.split
          _ = callSite.before ++ (during ++ rest) := congrArg (fun tr => callSite.before ++ tr) split
          _ = callSite.before ++ ((localSite.before ++ localSite.after) ++ rest) :=
            congrArg (fun tr => callSite.before ++ (tr ++ rest)) localSite.split
          _ = _ := by simp only [List.append_assoc]
      reached := callSite.reached.trans (by
        have h := localSite.reached.bind callSite.continuation
        simpa only [fuel,assoc] using h)
      suffix := by
        have h := Interaction.Executes.bind_ok localSite.suffix last
        change Interaction.Executes ((Stmt.eval localSite.fuel Inv48.Source.model.core.table
          localSite.context localSite.runtime Inv48.RequestQuote.quoteCaptureP.value >>=
          localSite.continuation) >>= callSite.continuation) (localSite.after ++ rest) (.ok out) at h
        simpa only [assoc] using h}
  obtain ⟨⟨qfuel,P,A,B,_⟩,origin,originEq⟩ := joined
  exact ⟨q,⟨qfuel,P,A,B,Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb qfuel P A B⟩,origin,originEq⟩
end Inv48.ObservedQuoteJoin.Site
