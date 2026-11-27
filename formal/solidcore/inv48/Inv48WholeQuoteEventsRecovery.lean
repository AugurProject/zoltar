import Inv48WholeQuoteEventsCuts
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.MinimumFullTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Cancel a retained execution from the same trace, including its dependent
answers. This is not a replay with a separately chosen responder. -/
theorem cancelLeft {α β : Type} {tree : SolI α} {next : α → SolI β}
    {a b : Interaction.Transcript} {value : α} {result : Except SolidityFailure β}
    (first : Interaction.Executes tree a (.ok value))
    (whole : Interaction.Executes (tree >>= next) (a++b) result) :
    Interaction.Executes (next value) b result := by
  generalize h : Except.ok value = outcome at first
  induction first with
  | done => cases h; exact whole
  | request answer tail ih =>
    cases whole
    exact ih (by assumption) h

/-- The quoteEntry recovery is retained. The aggregate call is cut from the
remainder of precisely that original quote trace. -/
structure Recovery (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (trace : Interaction.Transcript) (final : Runtime) where
  quote : QuoteRecovery (n+50) c physical p a bounty trace (.normal final)
  aggregateCaller : Runtime
  aggregateFinal : Runtime
  aggregateTrace : Interaction.Transcript
  split : trace = quote.minimumTrace ++ aggregateTrace
  aggregateRun : Interaction.Executes (Stmt.eval (n+51) Inv48.Source.model.core.table c
    aggregateCaller (.internalCall ["_ret_aggregateExposureAttoEth_0"]
      "__internal_aggregateExposureAttoEth()#[]" [])) aggregateTrace (.ok (.normal aggregateFinal))

theorem recover (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : bounty<Inv32Division.R)
    (trace : Interaction.Transcript) (final : Runtime)
    (run : Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value) trace (.ok (.normal final))) :
    Nonempty (Recovery n c physical p a bounty trace final) := by
  obtain ⟨s,_path,_events⟩ := quoteEntry (n+50) c physical p a bounty hp ha hb trace
    (.normal final) (by simp [Escapes]) run
  have original := run
  rw [bodyForm] at original
  obtain ⟨k,v,eq,outEq,outer⟩ := block _ _ _ _ _ _ _ original
  have keq : k=n+54 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime] at outEq <;> try contradiction
  case normal last =>
    rw [listAppend,prologueExecution (n+53) _ c physical p a bounty hp ha hb] at outer
    change Interaction.Executes (Stmt.evalList (n+54) _ c (allocated physical p a bounty).pushScope
      [.block (minP.value :: collateralWrite :: fundingCode ++ tailCode)]) trace (.ok (.normal last)) at outer
    have inside := singleton _ _ _ _ _ _ _ outer
    obtain ⟨j,w,eq2,valueEq,interior⟩ := block _ _ _ _ _ _ _ inside
    have jeq : j=n+53 := by omega
    subst j
    cases w <;> simp only [Result.mapRuntime] at valueEq <;> try contradiction
    case normal endState =>
      have form : minP.value :: collateralWrite :: fundingCode ++ tailCode = actualStatements := by
        rw [Inv48.QuoteFundingFields.actualInterior]
        unfold tailCode
        rw [oracleCode_eq,haltX_eq,haltY_eq,denom_eq,feeX_eq,feeY_eq]
        rfl
      rw [form,interiorSegments] at interior
      simp only [List.append_assoc] at interior
      rw [listAppend] at interior
      rw [singleList] at interior
      rw [s.quoteSplit] at interior
      have rest := cancelLeft s.minimumRun interior
      obtain ⟨before,pt,aggTail,split,pre,remaining⟩ := normalPrefix _ _ _ _ _ preAggregate
        ([aggregateHoist]++postAggregate) _ rest
      obtain ⟨after,ht,st,split2,hoisted,post⟩ := normalPrefix _ _ _ _ _ [aggregateHoist]
        postAggregate _ remaining
      have pn := listEvents _ _ _ _ beforeSilent pre
      have sn := listEvents _ _ _ _ afterSilent post
      have eqTrace : s.quoteAfter=ht := by rw [split,split2,pn,sn,List.nil_append,List.append_nil]
      have hoisted := singleton _ _ _ _ _ _ _ hoisted
      change Interaction.Executes (Stmt.eval (n+53) _ c before
        (Inv48.Positive.simpleCode "_sol_hoist_0" "_ret_aggregateExposureAttoEth_0"
          "__internal_aggregateExposureAttoEth()#[]")) ht (.ok (.normal after)) at hoisted
      obtain ⟨caller,called,call⟩ := Inv48.MinimumFullTrace.hoist (n+50) c before after _ _ _ hoisted
      exact ⟨⟨s,caller,called,ht,s.quoteSplit.trans (congrArg (List.append s.minimumTrace) eqTrace),call⟩⟩
end Inv48.WholeQuoteEvents
