import Inv48BatchLoopClosureCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchLoopClosure
open Inv48.BatchInputLoop Inv48.BatchReadFrame Inv48.EscrowJoin Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem ipb {α β : Type} (a : α) (k : α → SolI β) : Interaction.bind (pure a) k = k a := rfl
private theorem liftOk {α : Type} (a : α) : (liftM (Except.ok a : Except RevertData α) : SolI α) = pure a := rfl
theorem gasWrite (c : Context) (r final : Runtime) (old : Nat) (rhs out : Value)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (success : gasUpdate c r rhs = .ok (out,final)) :
    ∃ w, r.assignLocal? "requiredGas" (.word w) = some final := by
  simp only [gasUpdate,ResolvedLValue.read,ResolvedLValue.readRaw,bound] at success
  change (do
    let next ← BinaryOp.apply c.checked .add (.word old) rhs
    let value ← ValueCleanup.apply c.checked (.uint 256) next
    let final ← ResolvedLValue.write c r (.local "requiredGas") value
    pure (value,final)) = .ok (out,final) at success
  cases add : BinaryOp.apply c.checked .add (.word old) rhs with
  | error err => simp [add,Bind.bind,Except.bind] at success
  | ok next =>
    simp only [add,Bind.bind,Except.bind] at success
    cases clean : ValueCleanup.apply c.checked (.uint 256) next with
    | error err => simp [clean] at success
    | ok value =>
      obtain ⟨w,rfl⟩ := cleanupWord c.checked next value clean
      simp only [clean,ResolvedLValue.write] at success
      cases assigned : r.assignLocal? "requiredGas" (.word w) with
      | none => simp [assigned] at success
      | some updated =>
        simp only [assigned] at success
        change Except.ok (.word w,updated) = Except.ok (out,final) at success
        cases success
        exact ⟨w,assigned⟩

theorem assignmentWrite (n : Nat) (c : Context) (r final : Runtime)
    (old : Nat) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      (.exprStmt (.assignment (some .add) (some (.uint 256)) (.var "requiredGas") bodyRhs)))
      trace (.ok (.normal final))) : ∃ w, r.assignLocal? "requiredGas" (.word w) = some final := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    have base : r.lookupStorageBase? "requiredGas" = none := by
      simp [Runtime.lookupStorageBase?,bound]
    have resolve : Expr.resolveLValue c r (.var "requiredGas") = pure (.local "requiredGas",r) := by
      simp [Expr.resolveLValue,Expr.resolveLValueFuel,base,bound]
    obtain ⟨rhs,eq⟩ := rhsFrozen c r
    cases rhs with
    | error err =>
      have expression : Expr.eval c r (.assignment (some .add) (some (.uint 256))
          (.var "requiredGas") bodyRhs) = throw err := by
        unfold Expr.eval
        rw [Expr.evalFuel]
        change (Expr.eval c r bodyRhs >>= _) = _
        rw [eq]
        rfl
      rw [Stmt.eval] at run
      dsimp only at run
      rw [expression] at run
      cases err <;> cases run
    | ok rhs =>
      change Expr.eval c r bodyRhs = pure (rhs,r) at eq
      have expression : Expr.eval c r (.assignment (some .add) (some (.uint 256))
          (.var "requiredGas") bodyRhs) =
          (liftM (gasUpdate c r rhs) : SolI (Value × Runtime)) := by
        unfold Expr.eval
        rw [Expr.evalFuel]
        change (Expr.eval c r bodyRhs >>= _) = _
        rw [eq,pb]
        change (Expr.resolveLValue c r (.var "requiredGas") >>= _) = _
        rw [resolve,pb]
        cases read : ResolvedLValue.read c r (.local "requiredGas") with
        | error err => simp [gasUpdate,read,Bind.bind,Except.bind]; rfl
        | ok lhs =>
          cases add : BinaryOp.apply c.checked .add lhs rhs with
          | error err => simp [liftOk,ipb,gasUpdate,read,add,Bind.bind,Except.bind]; rfl
          | ok next =>
            cases clean : ValueCleanup.apply c.checked (.uint 256) next with
            | error err => simp [liftOk,ipb,gasUpdate,read,add,clean,Bind.bind,Except.bind]; rfl
            | ok value =>
              cases write : ResolvedLValue.write c r (.local "requiredGas") value <;>
                simp [liftOk,ipb,gasUpdate,read,add,clean,write,Bind.bind,Except.bind] <;> rfl
      rw [Stmt.eval] at run
      dsimp only at run
      rw [expression] at run
      cases result : gasUpdate c r rhs with
      | error err => simp only [result] at run; cases run
      | ok pair =>
        rcases pair with ⟨value,updated⟩
        simp only [result] at run
        have eq := pureResult _ _ _ run
        cases eq.2
        exact gasWrite c r final old rhs value bound result
theorem incWrite (c : Context) (r final : Runtime) (old : Nat) (out : Value)
    (bound : r.lookupLocal? "index" = some (.word old))
    (success : ResolvedLValue.applyIncDecCleanup c r (.local "index") .add true
      (.uint 256) = .ok (out,final)) :
    ∃ w, r.assignLocal? "index" (.word w) = some final := by
  simp only [ResolvedLValue.applyIncDecCleanup,ResolvedLValue.read,ResolvedLValue.readRaw,bound] at success
  change (do
    let next ← BinaryOp.apply c.checked .add (.word old) (.word 1)
    let value ← ValueCleanup.apply c.checked (.uint 256) next
    let updated ← ResolvedLValue.write c r (.local "index") value
    pure (Value.word old,updated)) = .ok (out,final) at success
  cases add : BinaryOp.apply c.checked .add (.word old) (.word 1) with
  | error err => simp [add,Bind.bind,Except.bind] at success
  | ok next =>
    simp only [add,Bind.bind,Except.bind] at success
    cases clean : ValueCleanup.apply c.checked (.uint 256) next with
    | error err => simp [clean] at success
    | ok value =>
      obtain ⟨w,rfl⟩ := cleanupWord c.checked next value clean
      simp only [clean,ResolvedLValue.write] at success
      cases assigned : r.assignLocal? "index" (.word w) with
      | none => simp [assigned] at success
      | some updated =>
        simp only [assigned] at success
        change Except.ok (Value.word old,updated) = Except.ok (out,final) at success
        cases success
        exact ⟨w,assigned⟩

theorem postWrite (n : Nat) (c : Context) (r final : Runtime)
    (old : Nat) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "index" = some (.word old))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopPost) trace (.ok (.normal final))) :
    ∃ w, r.assignLocal? "index" (.word w) = some final := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    have base : r.lookupStorageBase? "index" = none := by
      simp [Runtime.lookupStorageBase?,bound]
    have resolve : Expr.resolveLValue c r (.var "index") = pure (.local "index",r) := by
      simp [Expr.resolveLValue,Expr.resolveLValueFuel,base,bound]
    have expression : Expr.eval c r
        (.incDec .add true (some (.uint 256)) (.var "index")) =
        (liftM (ResolvedLValue.applyIncDecCleanup c r (.local "index") .add true
              (.uint 256)) : SolI (Value × Runtime)) := by
      unfold Expr.eval
      rw [Expr.evalFuel]
      change (Expr.resolveLValue c r (.var "index") >>= _) = _
      rw [resolve,pb]
    change Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.exprStmt (.incDec .add true (some (.uint 256)) (.var "index")))) trace
      (.ok (.normal final)) at run
    rw [Stmt.eval] at run
    dsimp only at run
    rw [expression] at run
    cases result : ResolvedLValue.applyIncDecCleanup c r (.local "index") .add true
        (.uint 256) with
    | error err => simp only [result] at run; cases run
    | ok pair =>
      rcases pair with ⟨value,updated⟩
      simp only [result] at run
      have eq := pureResult _ _ _ run
      cases eq.2
      exact incWrite c r final old value bound result
theorem iterationWrite (n : Nat) (c : Context) (r final : Runtime)
    (old : Nat) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopIteration) trace (.ok (.normal final))) :
    ∃ w, r.assignLocal? "requiredGas" (.word w) = some final := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [iterationShape] at run
    obtain ⟨inner,body,pop⟩ := blockNormal n _ c r final _ trace run
    obtain ⟨r1,t1,t2,_,first,rest⟩ := sequenceNormal n _ c r.pushScope inner _ _ trace body
    have eq1 := requireRuntime n _ c firstCondition _ firstRead _ _ _ first
    subst r1
    obtain ⟨r2,t3,t4,_,second,rest⟩ := sequenceNormal n _ c r.pushScope inner _ _ t2 rest
    have eq2 := requireRuntime n _ c secondCondition _ secondRead _ _ _ second
    subst r2
    obtain ⟨r3,t5,t6,_,assignment,last⟩ := sequenceNormal n _ c r.pushScope inner _ _ t4 rest
    rw [Stmt.evalList] at last
    have terminal := pureResult _ _ _ last
    cases terminal.2
    obtain ⟨value,write⟩ := assignmentWrite n c r.pushScope inner old t5 bound assignment
    obtain ⟨outer,write,shape⟩ := scalarPushWrite r inner "requiredGas" old (.word value) bound write
    rw [pop,shape]
    exact ⟨value,write⟩
end Inv48.BatchLoopClosure
