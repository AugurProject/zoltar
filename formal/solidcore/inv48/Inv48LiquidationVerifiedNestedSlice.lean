import Inv48LiquidationVerifiedObserved
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

private theorem captureNormal (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+1) t c r nested) tr (.ok (.normal final))) :
    Interaction.Executes (Stmt.eval n t c r
      (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))
      tr (.ok (.normal final)) := by
  change Interaction.Executes (Stmt.eval (n+1) t c r
    (.captureReturn [Inv32FloorHoist.ret]
      (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))) _ _ at run
  rw [Stmt.eval] at run
  obtain ⟨v,a,b,sp,first,last⟩ := GuardRecovery.bindSuccess _ _ _ _ run
  have never := GuardRecovery.neverSound 1
    (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv) rfl n t c r
  cases v with
  | normal mid =>
    cases last
    simp only [List.append_nil] at sp
    subst tr
    exact first
  | returned rt vs => exact False.elim (never _ _ _ first)
  | _ => cases last

/-- Physical nested operands and frame recovered by inverting this very body
run. The call is not supplied as an independent premise. -/
theorem nestedSlice (n : Nat) (c : Context) (r : Runtime) (p u : Nat) (tail : Frame)
    (hp : p<R) (hu : u<R) (checked : c.checked=true)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ GuardRecovery.Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+17) t c (entry r p u tail)
      actualLiquidationLibraryBody) tr (.ok out)) :
    let physical := ready (start (entry r p u tail).pushScope.pushScope) p u
    ∃ final ct,
      Interaction.Executes (Stmt.eval (n+13) t c physical
        (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))
        ct (.ok (.normal final)) ∧
      physical.lookupLocal? "_ic_arg_0" = some (.word p) ∧
      physical.lookupLocal? "_ic_arg_1" = some (.word 10000000) ∧
      physical.lookupLocal? "_ic_arg_2" = some (.word (10000000+u)) ∧
      ct=[] ∧ physical.assignLocal? Inv32FloorHoist.ret (.word (q p u)) = some final ∧
      {final with locals := physical.locals} = physical := by
  have good := uncertaintyFromBody (n+13) c r p u tail hp hu tr out ordinary run
  rw [bodyShape] at run
  obtain ⟨k,v,ke,oe,list⟩ := GuardRecovery.block _ _ _ _ _ _ _ run
  have ke' : k=n+16 := by omega
  subst k
  have vo := GuardRecovery.popOrdinary v (oe ▸ ordinary)
  obtain ⟨mid,pt,bt,sp,pre,body⟩ := GuardRecovery.listPrefix _ _ _ _
    [clean "price",clean "uncertainty",.skip] [_] _ _ (by decide) vo list
  rw [prologue (n+15) c r p u tail hp hu] at pre
  cases pre
  have body := GuardRecovery.singleton _ _ _ _ _ _ _ body
  obtain ⟨k,v',ke,oe',list'⟩ := GuardRecovery.block _ _ _ _ _ _ _ body
  have ke' : k=n+15 := by omega
  subst k
  have vo' := GuardRecovery.popOrdinary v' (oe' ▸ vo)
  let middle := (entry r p u tail).pushScope.pushScope
  have guard : Stmt.eval (n+15) t c middle requireU = pure (.normal middle) := by
    change Stmt.eval (n+15) t c middle (.requireStmt LiquidationLibrary.uncertaintyCondition (some "Invalid oracle uncertainty")) = _
    rw [Stmt.eval]
    dsimp only
    rw [LiquidationLibrary.uncertaintyEval c middle u hu (by dsimp [middle]; locals_simp),if_pos good]
    rfl
  have decl := Inv32FloorStart.zero (n+14) t c middle "_sol_hoist_0"
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ guard,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl] at list'
  obtain ⟨done,ht,rt,sp,hoisted,returned⟩ := GuardRecovery.listPrefix _ _ _ _
    [.block (setup ++ [nested,copy])] [ret] _ _ (by decide) vo' list'
  have hoisted := GuardRecovery.singleton _ _ _ _ _ _ _ hoisted
  obtain ⟨k,v'',ke,oe'',hl⟩ := GuardRecovery.block _ _ _ _ _ _ _ hoisted
  have ke' : k=n+14 := by omega
  subst k
  cases v'' <;> simp only [Result.mapRuntime] at oe''
  all_goals try contradiction
  case normal after =>
    obtain ⟨prepared,at_,rest,sp,arguments,restRun⟩ := GuardRecovery.listPrefix _ _ _ _
      setup [nested,copy] _ _ (by decide) (by simp [GuardRecovery.Escapes]) hl
    rw [setupEval (n+13) c _ p u hp good checked
      (by dsimp [middle]; locals_simp) (by dsimp [middle]; locals_simp)] at arguments
    cases arguments
    obtain ⟨called,ct,xt,sp,call,copyRun⟩ := GuardRecovery.listPrefix _ _ _ _
      [nested] [copy] _ _ (by decide) (by simp [GuardRecovery.Escapes]) restRun
    have call := GuardRecovery.singleton _ _ _ _ _ _ _ call
    have actual := captureNormal (n+13) c _ called ct call
    obtain ⟨P,Y,D⟩ := physicalOperands (start middle) p u
    obtain ⟨trace,assigned,frame⟩ := LiquidationLibrary.nestedObservedFrame (n+12) c _ called p u
      hp good (by omega) P Y D ct actual
    exact ⟨called,ct,actual,P,Y,D,trace,assigned,frame⟩

#print axioms nestedSlice
end LiquidationBody
