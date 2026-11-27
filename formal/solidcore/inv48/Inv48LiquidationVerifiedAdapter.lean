import Inv48LiquidationVerifiedArguments
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationLibrary
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

private theorem pureArgs (a b : List Value × Runtime) (tr : Interaction.Transcript)
    (run : Interaction.Executes (pure (.ok a) : SolI (Except RevertData (List Value × Runtime)))
      tr (.ok (.ok b))) : b=a := by
  cases run
  rfl

/-- Exact argument values and pre-entry runtime of the actual observed
 liquidation call, recovered from its reference-argument evaluation. -/
theorem enteredArguments (s : GuardRecovery.LibraryEntered fuel c r final tr)
    (p u : Nat)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (U : r.lookupLocal? "_ic_arg_1" = some (.word u)) :
    s.values = [.word p,.word u] ∧ s.mid=r := by
  have args : Expr.evalRefArgList c r GuardRecovery.libraryArgs =
      pure ([.word p,.word u],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var "_ic_arg_0",.var "_ic_arg_1"] = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
      Inv32ProductCall.wordArg _ _ _ _ P,Inv32ProductCall.wordArg _ _ _ _ U,pb]
  have run := s.argsRun
  rw [args] at run
  have caught : (pure ([.word p,.word u],r) : SolI (List Value × Runtime)).caught = pure (.ok ([.word p,.word u],r)) := rfl
  rw [caught] at run
  have eq := pureArgs _ _ _ run
  exact ⟨congrArg Prod.fst eq,congrArg Prod.snd eq⟩

/-- Complete non-local runtime frame for the observed nested call, including
 storage, events, heap, allocation cursors and EVM scratch. -/
theorem nestedObservedFrame (fuel : Nat) (c : Context) (r final : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<10000000) (enough : 12≤fuel)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (Y : r.lookupLocal? "_ic_arg_1" = some (.word 10000000))
    (D : r.lookupLocal? "_ic_arg_2" = some (.word (10000000+u)))
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (fuel+1) table c r
      (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))
      tr (.ok (.normal final))) :
    tr=[] ∧ r.assignLocal? Inv32FloorHoist.ret (.word (quotient p u)) = some final ∧
    {final with locals := r.locals} = r := by
  obtain ⟨trace,assigned⟩ := nestedObserved fuel c r final p u hp hu enough P Y D tr run
  exact ⟨trace,assigned,scalarFrame r final _ _ assigned⟩

/-- Arithmetic closure once the observed public nonzero guard has been
 transported to the recovered quotient. This is not a public guard theorem. -/
theorem acceptedQuotient (p u : Nat) (accepted : wordTruthy (quotient p u) = true) :
    10000000+u ≤ p*10000000 := by
  apply (GuardRecovery.liquidationPositiveIff p u).mp
  have nz : quotient p u ≠ 0 := by
    intro zero
    rw [zero] at accepted
    contradiction
  exact Nat.pos_of_ne_zero nz

#print axioms enteredArguments
#print axioms nestedObservedFrame
#print axioms acceptedQuotient
end LiquidationLibrary
