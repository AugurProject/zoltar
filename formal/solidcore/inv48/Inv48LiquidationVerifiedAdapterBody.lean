import Inv48LiquidationVerifiedEntered
import Inv48LiquidationVerifiedNestedSlice
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Whole actual library-call endpoint. Public nonzero guard transport is
intentionally separate; neither accepted quotient nor adequate fuel is assumed. -/
theorem callObserved (fuel : Nat) (c : Context) (r final : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (U : r.lookupLocal? "_ic_arg_1" = some (.word u))
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel t c r GuardRecovery.libraryCall)
      tr (.ok (.normal final))) :
    u<10000000 ∧ tr=[] ∧
    r.assignLocal? GuardRecovery.libraryRet (.word (q p u)) = some final ∧
    {final with locals := r.locals} = r := by
  obtain ⟨s⟩ := GuardRecovery.enterLibrary fuel c r final tr run
  exact enteredObserved s p u hp hu P U

/-- Invert the actual nested call after replaying only this body's successful
path. Thus no high-fuel premise leaks into the observed-body endpoint. -/
theorem nestedAtAnyFuel (fuel : Nat) (c : Context) (r : Runtime) (p u : Nat) (tail : Frame)
    (hp : p<R) (hu : u<R) (checked : c.checked=true)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ GuardRecovery.Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel t c (entry r p u tail)
      actualLiquidationLibraryBody) tr (.ok out)) :
    let physical := ready (start (entry r p u tail).pushScope.pushScope) p u
    ∃ final ct,
      Interaction.Executes (Stmt.eval (fuel+13) t c physical
        (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))
        ct (.ok (.normal final)) ∧
      physical.lookupLocal? "_ic_arg_0" = some (.word p) ∧
      physical.lookupLocal? "_ic_arg_1" = some (.word 10000000) ∧
      physical.lookupLocal? "_ic_arg_2" = some (.word (10000000+u)) ∧
      ct=[] ∧ physical.assignLocal? Inv32FloorHoist.ret (.word (q p u)) = some final ∧
      {final with locals := physical.locals} = physical := by
  exact nestedSlice fuel c r p u tail hp hu checked tr out ordinary
    (LiquidationReplay.replay (Nat.le_add_right fuel 17) t c _ _ tr out run)

/-- Returned data and the complete nonlocal frame are recovered from one
observed body run, including the return casts and both scope exits. -/
theorem bodyObservedFrame (fuel : Nat) (c : Context) (r : Runtime) (p u : Nat) (tail : Frame)
    (hp : p<R) (hu : u<R) (checked : c.checked=true)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ GuardRecovery.Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel t c (entry r p u tail)
      actualLiquidationLibraryBody) tr (.ok out)) :
    u<10000000 ∧ tr=[] ∧
      out=.returned (entry r p u tail) [.word (q p u)] ∧
      ∀ locals, {(entry r p u tail) with locals} = {r with locals} := by
  obtain ⟨good,trace,result⟩ := bodyObserved fuel c r p u tail hp hu checked tr out ordinary run
  exact ⟨good,trace,result,fun _ => rfl⟩

/-- The physical nested slice belongs to this LibraryEntered body's success
path (replayed at adequate fuel), with no independent helper-run premise. -/
theorem enteredNested (s : GuardRecovery.LibraryEntered fuel c r final tr)
    (p u : Nat) (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (U : r.lookupLocal? "_ic_arg_1" = some (.word u)) :
    let physical := ready (start s.inner.pushScope.pushScope) p u
    ∃ next ct,
      Interaction.Executes (Stmt.eval (s.n+13) t {c with checked := true} physical
        (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))
        ct (.ok (.normal next)) ∧
      physical.lookupLocal? "_ic_arg_0" = some (.word p) ∧
      physical.lookupLocal? "_ic_arg_1" = some (.word 10000000) ∧
      physical.lookupLocal? "_ic_arg_2" = some (.word (10000000+u)) ∧
      ct=[] ∧ physical.assignLocal? Inv32FloorHoist.ret (.word (q p u)) = some next ∧
      {next with locals := physical.locals} = physical := by
  obtain ⟨values,mid⟩ := LiquidationLibrary.enteredArguments s p u P U
  obtain ⟨ps,rs,body⟩ := signature s.fn s.found
  let tail := s.fn.returnDefaultBindings
  have enter : internalCallEnter? s.fn [.word p,.word u] r =
      some (entry {r with locals := []} p u tail,r.locals) := by
    simp [internalCallEnter?,InternalFunction.initialFrame?,ps,
      Inv32Internal.wordBindings,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,
      BindingDecl.bindArg?,Ty.coerceValue?,entry,Runtime.withFrame,tail]
  have entered := s.entered
  rw [values,mid,enter] at entered
  have ie : s.inner = entry {r with locals := []} p u tail :=
    (congrArg Prod.fst (Option.some.inj entered)).symm
  have run := s.bodyRun
  rw [body,ie] at run
  dsimp only
  rw [ie]
  exact nestedAtAnyFuel s.n {c with checked := true} {r with locals := []} p u tail hp hu rfl
    s.bodyTrace s.result (GuardRecovery.libraryOrdinary s) run

#print axioms callObserved
#print axioms nestedAtAnyFuel
#print axioms bodyObservedFrame
end LiquidationBody

#print axioms LiquidationBody.enteredNested
