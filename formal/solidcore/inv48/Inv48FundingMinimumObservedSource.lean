import Inv48FundingMinimumObservedBody
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.FundingMinimumObserved
open Inv48.Positive Inv48.WrapperTraversal Inv48.MinimumCollateralTrace Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- Invert the real minimum stage through its silent declarations, preserving
its actual internal body trace. Price transport is proved, not supplied. -/
theorem minimumBody (n : Nat) (c : Context) (r final : Runtime) (p : Nat)
    (hp : p < Inv32Division.R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+13) Inv48.Source.model.core.table c r
      Inv48.WholeQuote.minP.value) trace (.ok (.normal final))) :
    ∃ inner bodyTrace value before after,
      trace = before ++ bodyTrace ++ after ∧
      ¬ Escapes value ∧
      Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table {c with checked := true}
        (start inner p) Inv48.Public.body) bodyTrace (.ok value) := by
  obtain ⟨k,v,eq,outEq,list⟩ := block _ _ _ _ _ _ _ run
  have ke : k = n+12 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime,Result.normal.injEq] at outEq <;> try contradiction
  case normal copied =>
    change Interaction.Executes (Stmt.evalList (n+12) _ c r.pushScope
      ([.varDecl .uint256 "_sol_hoist_0" none] ++
       [Inv48.WholeQuote.hoistP Inv48.QuoteMinimumJoin.ret Inv48.QuoteMinimumJoin.key
         [Inv48.QuoteMemory.cleanP (Inv48.QuoteMemory.varP "proposedRepPerEthPrice")] |>.value,
        (Inv48.WholeQuote.declP "#view48027" (Inv48.QuoteMemory.cleanP
          (Inv48.QuoteMemory.varP "_sol_hoist_0"))).value,Inv48.WholeQuote.minGuardP.value]))
      trace (.ok (.normal copied)) at list
    obtain ⟨declared,dt,rest,sp,decl,last⟩ := normalPrefix _ _ _ _ _ _ _ _ list
    have zero := Inv32FloorStart.zero (n+11) Inv48.Source.model.core.table c r.pushScope "_sol_hoist_0"
    have decl := singleton _ _ _ _ _ _ _ decl
    rw [zero] at decl
    have declaredEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult decl).2
    subst declared
    obtain ⟨hoisted,ht,tail,sp2,hoist,_⟩ := normalPrefix (n+12) _ c
      (r.pushScope.declareLocal "_sol_hoist_0" (.word 0)) copied
      [Inv48.WholeQuote.hoistP Inv48.QuoteMinimumJoin.ret Inv48.QuoteMinimumJoin.key
        [Inv48.QuoteMemory.cleanP (Inv48.QuoteMemory.varP "proposedRepPerEthPrice")] |>.value]
      _ rest last
    have hoist := singleton _ _ _ _ _ _ _ hoist
    obtain ⟨k,v,eq,outEq,list⟩ := block _ _ _ _ _ _ _ hoist
    have ke : k = n+11 := by omega
    subst k
    cases v <;> simp only [Result.mapRuntime,Result.normal.injEq] at outEq <;> try contradiction
    case normal copied2 =>
      let input := (r.pushScope.declareLocal "_sol_hoist_0" (.word 0)).pushScope
      have read : Expr.eval c input (Inv48.QuoteMemory.clean (.var "proposedRepPerEthPrice")) =
          pure (.word p,input) := by
        change Expr.evalFuel 3 c input _ = _
        apply Inv32Guards.clean 2 c input _ p hp
        apply Inv32Guards.readWord 1 c input _ p
        simpa [input,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.lookup?,
          LocalEnv.declare,Frame.lookup?] using P
      have D := Inv32Hoist.declEval (n+10) Inv48.Source.model.core.table c input
        Inv32OneArg.argName .uint256 (Inv48.QuoteMemory.clean (.var "proposedRepPerEthPrice")) p read (by rfl)
      change Interaction.Executes (Stmt.evalList (n+11) _ c input
        ([.varDecl .uint256 Inv32OneArg.argName (some (Inv48.QuoteMemory.clean (.var "proposedRepPerEthPrice")))] ++ _))
        ht (.ok (.normal copied2)) at list
      obtain ⟨arg,at_,remaining,sp3,argRun,last⟩ := normalPrefix _ _ _ _ _ _ _ _ list
      have argRun := singleton _ _ _ _ _ _ _ argRun
      rw [D] at argRun
      have argEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult argRun).2
      subst arg
      obtain ⟨caller,zt,remaining2,sp4,zeroRun,last⟩ := normalPrefix (n+11) _ c
        (input.declareLocal Inv32OneArg.argName (.word p)) copied2
        [.varDecl .uint256 Inv48.QuoteMinimumJoin.ret none] _ remaining last
      have zeroRun := singleton _ _ _ _ _ _ _ zeroRun
      rw [Inv32FloorStart.zero (n+10)] at zeroRun
      have callerEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult zeroRun).2
      subst caller
      obtain ⟨called,ct,xt,sp5,cap,_⟩ := normalPrefix (n+11) _ c
        ((input.declareLocal Inv32OneArg.argName (.word p)).declareLocal Inv48.QuoteMinimumJoin.ret (.word 0))
        copied2 [.captureReturn [Inv48.QuoteMinimumJoin.ret] Inv48.QuoteMinimumEvents.minimumCall]
        _ remaining2 last
      have call := Inv48.MinimumFullTrace.captureCall (n+9) c _ called
        [Inv48.QuoteMinimumJoin.ret] Inv48.QuoteMinimumJoin.key [.var Inv32OneArg.argName]
        (singleton _ _ _ _ _ _ _ cap)
      obtain ⟨fuel,fn,values,argFinal,inner,saved,value,atArgs,bt,ft,fe,found,bodyEq,entered,split,args,body,finish,ordinary⟩ :=
        Inv48.QuoteMinimumEvents.minimumEntered _ _ _ _ _ call
      have fuelEq : fuel = n+9 := by omega
      subst fuel
      have evaluated : Expr.evalRefArgList c
          ((input.declareLocal Inv32OneArg.argName (.word p)).declareLocal Inv48.QuoteMinimumJoin.ret (.word 0))
          [.var Inv32OneArg.argName] = pure ([.word p],
          (input.declareLocal Inv32OneArg.argName (.word p)).declareLocal Inv48.QuoteMinimumJoin.ret (.word 0)) := by
        apply Inv32FlagCalls.arg
        cases eq : input.locals <;> simp [eq,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,
          Inv32OneArg.argName,Inv48.QuoteMinimumJoin.ret]
      rw [evaluated] at args
      cases args
      obtain ⟨expected,lookup,params,returns,_shape⟩ := Inv48.QuoteMinimumJoin.getterBinding
      have same : fn = expected := Option.some.inj (found.symm.trans lookup)
      subst fn
      have canonical : internalCallEnter? expected [.word p]
          ((input.declareLocal Inv32OneArg.argName (.word p)).declareLocal Inv48.QuoteMinimumJoin.ret (.word 0)) =
          some (start {((input.declareLocal Inv32OneArg.argName (.word p)).declareLocal Inv48.QuoteMinimumJoin.ret (.word 0)) with locals := []} p,
          ((input.declareLocal Inv32OneArg.argName (.word p)).declareLocal Inv48.QuoteMinimumJoin.ret (.word 0)).locals) := by
        simp [internalCallEnter?,InternalFunction.initialFrame?,params,returns,
          InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,
          BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,Ty.defaultValue,start,Runtime.withFrame]
      rw [canonical] at entered
      have innerEq := (Prod.mk.inj (Option.some.inj entered)).1.symm
      rw [innerEq] at body
      refine ⟨_,bt,value,dt++at_++zt,ft++xt++tail,?_,ordinary,body⟩
      simp only [sp,sp2,sp3,sp4,sp5,split,List.nil_append,List.append_assoc]

#print axioms minimumBody
end Inv48.FundingMinimumObserved
