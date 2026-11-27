import Inv48CapturedEscrowArgsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowFailurePropagation
open Inv48.CapturedEscrowArgs
open Inv48.RequestGuards Inv48.QuoteTransport Inv48.EscrowPrefix Inv48.RequestDispatch Inv48.ActualSiteGuardJoin Inv48.FundingContinuation
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem traced (n : Nat) (c : Context) (post origin : Runtime)
    (s p a b g old id h e fee : Nat) (k : Result → SolI Result)
    (trace : Interaction.Transcript) (out : Result)
    (frame : origin.locals = [(hoist,.memoryRef old)] :: rest s p a b g)
    (mem : post.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e fee))
    (he : e<2^256) (hf : fee<2^256)
    (reject : ∀ mid err tail, ¬ Interaction.Executes (k (.reverted mid err)) tail (.ok out))
    (run : Interaction.Executes
      (Stmt.eval (n+2) Inv48.Source.model.core.table c
        (Inv48.ObservedQuoteJoin.captured post origin p a b id) aliasP.value >>= fun v =>
          pop v >>= fun x => listNext (n+3) Inv48.Source.model.core.table c
            (Inv48.RequestQuote.actual.drop 7) x >>= k) trace (.ok out)) :
    ∃ pending site st pt ct next,
      trace = st ++ pt ++ ct ∧
      ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c
        (aliased post [] (rest s p a b g) id) ((Inv48.RequestQuote.actual.drop 7).take 5)) st (.normal pending) ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c pending.pushScope actualPrep) pt (.normal site) ∧
      Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c site Inv48.RequestQuote.callStmt >>= next) ct (.ok out) ∧
      (∀ mid err tail, ¬ Interaction.Executes (next (.reverted mid err)) tail (.ok out)) ∧
      site = callPrep pending ∧
      site.lookupLocal? "quote" = some (.memoryRef id) ∧
      site.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e fee) ∧
      site.lookupLocal? "sponsor" = some (.word s) ∧
      site.lookupLocal? "bountyAttoEth" = some (.word b) ∧
      site.lookupLocal? "callbackGasLimit" = some (.word g) := by
  have reduced : Interaction.Executes
      (Stmt.evalList (n+3) Inv48.Source.model.core.table c
        (aliased post [] (rest s p a b g) id) (Inv48.RequestQuote.actual.drop 7) >>= k)
      trace (.ok out) := by
    have tree := aliasPop n c post origin s p a b g old id frame
    have reassoc : (Stmt.eval (n+2) Inv48.Source.model.core.table c
        (Inv48.ObservedQuoteJoin.captured post origin p a b id) aliasP.value >>= fun v =>
          pop v >>= fun x => listNext (n+3) Inv48.Source.model.core.table c
            (Inv48.RequestQuote.actual.drop 7) x >>= k) =
        ((Stmt.eval (n+2) Inv48.Source.model.core.table c
          (Inv48.ObservedQuoteJoin.captured post origin p a b id) aliasP.value >>= pop) >>=
          fun x => listNext (n+3) Inv48.Source.model.core.table c (Inv48.RequestQuote.actual.drop 7) x >>= k) := by
      simp only [Inv48.RequestGuards.assoc]
    rw [reassoc,tree] at run
    exact run
  rw [actualDownstream] at reduced
  simp only [List.append_assoc] at reduced
  have safe : Inv48.FundingFallthrough.prefixes Inv48.Source.model.core.table
      ((Inv48.RequestQuote.actual.drop 7).take 5) = true := by
    rw [checkedSuffix]
    rfl
  obtain ⟨pending,st,after,split,writes,body⟩ := listPrefix (n+3) c _ _ _ k trace out safe reject reduced
  change Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c pending
    (.block (actualPrep ++ requestTail) :: Inv48.RequestQuote.actual.drop 13) >>= k) after (.ok out) at body
  rw [Stmt.evalList,Inv48.RequestGuards.assoc] at body
  have rejectBlock : ∀ mid err tail, ¬ Interaction.Executes
      ((fun v => listNext (n+3) Inv48.Source.model.core.table c
        (Inv48.RequestQuote.actual.drop 13) v >>= k) (.reverted mid err)) tail (.ok out) := by
    exact reject
  rw [actualRequestHead] at body
  obtain ⟨site,pt,ct,split2,prep,call⟩ := blockPrefix (n+2) c pending actualPrep
    Inv48.RequestQuote.callStmt (requestTail.drop 1)
    (fun v => listNext (n+3) Inv48.Source.model.core.table c (Inv48.RequestQuote.actual.drop 13) v >>= k) after out (by rw [checkedPrep]; rfl) rejectBlock body
  exact ⟨pending,site,st,pt,ct,_,by simp [split,split2,List.append_assoc],writes,prep,call,(by
      intro mid err tail bad
      exact reject _ _ _ bad),
    fieldsAtPrep (n+2) (n+1) c post pending site s p a b g id h e fee st pt mem he hf writes prep⟩
end Inv48.EscrowFailurePropagation
