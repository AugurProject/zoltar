import Inv39AllowanceSlots
import Inv39GuardNumbers
import Inv39BalanceExecution
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
def readTerm : Source.Expr := .index (.storageIndex "_allowances" (.var "owner")) (.var "spender")
def place : Source.LValue := .index (.storageIndex "_allowances" (.var "owner")) (.var "spender")
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl
theorem base (c : Context) (r : Runtime) (o n : Nat) (owner : r.lookupLocal? "owner"=some (.word o)) :
    Expr.resolveLValueFuel (n+2) c r (.storageIndex "_allowances" (.var "owner"))=pure (.storageIndex "_allowances" (.word o),r) := by
  simp only [Expr.storageIndex,Expr.resolveLValueFuel,Inv32Guards.readWord _ _ _ _ _ owner,okBind]
theorem value (c : Context) (r : Runtime) (o s n : Nat) (owner : r.lookupLocal? "owner"=some (.word o))
    (spender : r.lookupLocal? "spender"=some (.word s)) (fields : c.storageFields=model.core.context.storageFields) :
    readTerm.evalFuel (n+3) c r=pure (.word (r.state.loadSlot (slot o s)),r) := by
  unfold readTerm; rw [Expr.evalFuel]
  · have storageRoot : (Expr.storageIndex "_allowances" (.var "owner")).hasStorageRoot=true := rfl
    rw [if_pos storageRoot,base c r o n owner]
    simp only [okBind,ResolvedLValue.asStoragePath?,Inv32Guards.readWord _ _ _ _ _ spender,List.cons_append,List.nil_append,
      read _ _ _ _ fields,liftOk]
  · intro name h; cases h
theorem resolve (c : Context) (r : Runtime) (o s n : Nat) (owner : r.lookupLocal? "owner"=some (.word o))
    (spender : r.lookupLocal? "spender"=some (.word s)) :
    Expr.resolveLValueFuel (n+3) c r readTerm=pure (.storagePath "_allowances" [.word o,.word s],r) := by
  unfold readTerm; rw [Expr.resolveLValueFuel]
  simp only [base _ _ _ _ owner,okBind,Inv32Guards.readWord _ _ _ _ _ spender]
theorem assign (c : Context) (r : Runtime) (t : FunctionTable) (o s v n : Nat)
    (O : r.lookupLocal? "owner"=some (.word o)) (S : r.lookupLocal? "spender"=some (.word s))
    (V : r.lookupLocal? "value"=some (.word v)) (fit : v<R) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (n+1) t c r (.assign place (Child.cv "value")) =
      pure (.normal {r with state:=r.state.storeSlot (slot o s) v}) := by
  have l : place.resolveWithRuntime c r = pure (.storagePath "_allowances" [.word o,.word s],r) := resolve _ _ _ _ 3 O S
  have rhs : (Child.cv "value").eval c r=pure (.word v,r) := Child.readClean _ c r _ v fit V
  have normed : Shared.norm v=v := Nat.mod_eq_of_lt fit
  have w := write c r o s v fields
  rw [normed] at w
  rw [Stmt.eval]; dsimp only
  have caught {α : Type} (v : α) : (pure v : SolI α).caught = pure (.ok v) := rfl
  have noMem : place.wantsMemoryRefRhs r=false := rfl
  simp only [noMem,Bool.false_eq_true,if_false,rhs,caught,okBind,l,w]
  rfl
end Inv39.Allowance
