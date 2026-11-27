import Inv45Split
open SolidCore.Solidity.Source
namespace Inv45.Public
set_option maxHeartbeats 1000000
 theorem prefixVar (c : Context) (r : Runtime) (name : String) (v : Nat)
    (h : r.lookupLocal? name = some (.word v)) :
    Expr.eval c r (.var name) = pure (.word v,r) :=
  Inv32Guards.readWord _ _ _ _ _ h
 theorem prefixAssign (fuel : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (name source : String) (old v : Nat)
    (bound : r.lookupLocal? name = some (.word old))
    (read : r.lookupLocal? source = some (.word v))
    (store : r.assignLocal? name (.word v) = some next) :
    Stmt.eval (fuel+1) t c r (.assign (.var name) (.var source)) = pure (.normal next) :=
  Inv32Temps.copy fuel t c r next name source old v bound read store


theorem prefixCleanRead (c : Context) (r : Runtime) (name : String) (v : Nat)
    (h : r.lookupLocal? name=some (.word v)) (V : v<Inv32Division.R) :
    Expr.eval c r (.castOp .uintCleanup 256 (.var name))=pure (.word v,r) :=
  Inv32Guards.clean _ c r (.var name) v V (Inv32Guards.readWord _ _ _ _ _ h)

theorem prefixFalse (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (name : String) (yes : Stmt) (h : r.lookupLocal? name=some (.word 0)) :
    Stmt.eval (fuel+2) t c r (.ifElse (.var name) yes .skip)=pure (.normal r) := by
  rw [Stmt.eval]; dsimp only; rw [prefixVar c r name 0 h]
  change Stmt.eval (fuel+1) t c r .skip = _
  rw [Stmt.eval]

theorem prefixReservedCall (fuel : Nat) (c : Context) (r next : Runtime) (n k : Nat) (name target : String)
    (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? name=some (.word (Answer.encode n k)))
    (store : r.assignNamedValuesRef? [target] [.word 0]=some next) :
    Stmt.eval (fuel+6) model.core.table c r (.captureReturn [target] (.internalCall [target] reservedKey [.var name]))=pure (.normal next) := by
  apply Inv32Internal.capture
  rw [reservedCall fuel c r n k name [target] N valid input]
  simp [internalCallAssign,store]

theorem prefixSplitCall (fuel : Nat) (c : Context) (r next : Runtime) (n k : Nat)
    (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? "_ic_arg_0"=some (.word (Answer.encode n k)))
    (store : r.assignNamedValuesRef? ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"] [.word 0,.word (n-k),.word k]=some next) :
    Stmt.eval (fuel+6) model.core.table c r (.captureReturn ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"] (.internalCall ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"] splitKey [.var "_ic_arg_0"]))=pure (.normal next) := by
  apply Inv32Internal.capture
  rw [splitCall fuel c r n k "_ic_arg_0" _ N valid input]
  simp [internalCallAssign,store]
theorem prefixSeq {fuel : Nat} {t : FunctionTable} {c : Context} {r next : Runtime}
    {s : Stmt} {rest : List Stmt} {out : SolI Result}
    (run : Stmt.eval fuel t c r s = pure (.normal next))
    (tail : Stmt.evalList fuel t c next rest = out) :
    Stmt.evalList fuel t c r (s::rest) = out :=
  (Inv32FloorStart.seqStep _ _ _ _ _ _ _ run).trans tail
end Inv45.Public
