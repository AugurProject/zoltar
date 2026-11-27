import Inv48LiquidationVerifiedLibrarySignature
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

theorem argsEval (c : Context) (r : Runtime) (p u : Nat)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (U : r.lookupLocal? "_ic_arg_1" = some (.word u)) :
    Expr.evalRefArgList c r GuardRecovery.libraryArgs = pure ([.word p,.word u],r) := by
  change Expr.evalRefArgListFuel (_+1) c r [.var "_ic_arg_0",.var "_ic_arg_1"] = _
  simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
    Inv32ProductCall.wordArg _ _ _ _ P,Inv32ProductCall.wordArg _ _ _ _ U,pb]

theorem scalarCoercion (r : Runtime) (name : String) (v : Nat) :
    coerceReturnBindingsRef (Inv32Internal.wordBindings [name]) r [.word v] = .ok [.word v] := by
  simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Internal.wordBindings,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]

private theorem pureObserved {α : Type} (v out : α) (tr : Interaction.Transcript)
    (run : Interaction.Executes (pure v : SolI α) tr (.ok out)) : tr=[] ∧ out=v := by
  cases run
  exact ⟨rfl,rfl⟩

theorem assignObserved (r final : Runtime) (name : String) (v : Nat)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (internalCallAssign r [name] [.word v]) tr (.ok (.normal final))) :
    tr=[] ∧ r.assignLocal? name (.word v) = some final := by
  simp only [internalCallAssign,List.isEmpty_cons,Bool.false_eq_true,if_false,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?] at run
  cases assigned : r.assignLocal? name (.word v) with
  | none => rw [assigned] at run; cases run
  | some updated =>
    rw [assigned] at run
    cases run
    exact ⟨rfl,rfl⟩

/-- The actual successful library entry, body and finish, with no public
nonzero-guard or high-fuel premise. The complete nonlocal runtime is framed. -/
theorem enteredObserved (s : GuardRecovery.LibraryEntered fuel c r final tr)
    (p u : Nat) (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (U : r.lookupLocal? "_ic_arg_1" = some (.word u)) :
    u<10000000 ∧ tr=[] ∧
    r.assignLocal? GuardRecovery.libraryRet (.word (q p u)) = some final ∧
    {final with locals := r.locals} = r := by
  obtain ⟨values,mid⟩ := LiquidationLibrary.enteredArguments s p u P U
  obtain ⟨ps,⟨name,rs⟩,body⟩ := signature s.fn s.found
  let tail := s.fn.returnDefaultBindings
  have enter : internalCallEnter? s.fn [.word p,.word u] r =
      some (entry {r with locals := []} p u tail,r.locals) := by
    simp [internalCallEnter?,InternalFunction.initialFrame?,ps,
      Inv32Internal.wordBindings,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,
      BindingDecl.bindArg?,Ty.coerceValue?,entry,Runtime.withFrame,tail]
  have entered := s.entered
  rw [values,mid,enter] at entered
  have ie : s.inner = entry {r with locals := []} p u tail := (congrArg Prod.fst (Option.some.inj entered)).symm
  have se : s.saved = r.locals := (congrArg Prod.snd (Option.some.inj entered)).symm
  have run := s.bodyRun
  rw [body,ie] at run
  obtain ⟨good,bt,result⟩ := bodyObserved s.n {c with checked := true} {r with locals := []} p u tail hp hu rfl
    s.bodyTrace s.result (GuardRecovery.libraryOrdinary s) run
  have args := s.argsRun
  rw [argsEval c r p u P U] at args
  have argsEmpty : s.argsTrace=[] := (pureObserved _ _ _ args).1
  have finish := s.finishRun
  rw [result] at finish
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,rs,
    scalarCoercion] at finish
  rw [se] at finish
  change Interaction.Executes (internalCallAssign r [GuardRecovery.libraryRet] [.word (q p u)])
    s.finishTrace (.ok (.normal final)) at finish
  obtain ⟨finishEmpty,assigned⟩ := assignObserved r final GuardRecovery.libraryRet (q p u) s.finishTrace finish
  refine ⟨good,?_,assigned,LiquidationLibrary.scalarFrame _ _ _ _ assigned⟩
  rw [s.split,argsEmpty,bt,finishEmpty]
  rfl

#print axioms argsEval
#print axioms scalarCoercion
#print axioms enteredObserved
end LiquidationBody
