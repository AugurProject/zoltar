import Inv48LiquidationVerifiedBodyShape
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The two actual cleanup assignments leave the canonical entry unchanged. -/
theorem prologue (n : Nat) (c : Context) (r : Runtime) (p u : Nat) (tail : Frame)
    (hp : p<R) (hu : u<R) :
    Stmt.evalList (n+1) t c (entry r p u tail).pushScope
      [clean "price",clean "uncertainty",.skip] =
      pure (.normal (entry r p u tail).pushScope) := by
  have P := Inv32FloorFastPath.cleanParamExec n t c (entry r p u tail).pushScope
    "price" p hp (by locals_simp) (by locals_simp)
  have U := Inv32FloorFastPath.cleanParamExec n t c (entry r p u tail).pushScope
    "uncertainty" u hu (by locals_simp) (by locals_simp)
  have S : Stmt.eval (n+1) t c (entry r p u tail).pushScope .skip =
      pure (.normal (entry r p u tail).pushScope) := by rw [Stmt.eval]
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ P,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ U,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ S,Stmt.evalList]

/-- Invert the prologue and actual uncertainty require from the same body run. -/
theorem uncertaintyFromBody (n : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (tail : Frame) (hp : p<R) (hu : u<R) (tr : Interaction.Transcript) (out : Result)
    (ordinary : ¬ GuardRecovery.Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+4) t c (entry r p u tail)
      actualLiquidationLibraryBody) tr (.ok out)) : u<10000000 := by
  rw [bodyShape] at run
  obtain ⟨k,v,ke,oe,list⟩ := GuardRecovery.block _ _ _ _ _ _ _ run
  have ke' : k=n+3 := by omega
  subst k
  have vo := GuardRecovery.popOrdinary v (oe ▸ ordinary)
  obtain ⟨mid,pt,bt,sp,pre,body⟩ := GuardRecovery.listPrefix _ _ _ _
    [clean "price",clean "uncertainty",.skip] [_] _ _ (by decide) vo list
  rw [prologue (n+2) c r p u tail hp hu] at pre
  cases pre
  have body := GuardRecovery.singleton _ _ _ _ _ _ _ body
  obtain ⟨k,v',ke,oe',list'⟩ := GuardRecovery.block _ _ _ _ _ _ _ body
  have ke' : k=n+2 := by omega
  subst k
  have vo' := GuardRecovery.popOrdinary v' (oe' ▸ vo)
  obtain ⟨mid,rt,rest,sp',req,last⟩ := GuardRecovery.listPrefix _ _ _ _
    [requireU] _ _ _ (by decide) vo' list'
  have req := GuardRecovery.singleton _ _ _ _ _ _ _ req
  exact (LiquidationLibrary.uncertaintyFromRun (n+1) c _ mid u hu
    (by locals_simp) rt req).1

#print axioms prologue
#print axioms uncertaintyFromBody
end LiquidationBody
