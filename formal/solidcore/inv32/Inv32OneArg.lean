import Inv32Hoist
open SolidCore.Solidity.Source Inv32Hoist Inv32FloorStart
namespace Inv32OneArg
abbrev argName := "_ic_arg_0"
def code (dst ret key : String) (inputTy outputTy : Ty) (rhs : Expr) : Stmt :=
  .block [.varDecl inputTy argName (some rhs),.varDecl outputTy ret none,
    .captureReturn [ret] (.internalCall [ret] key [.var argName]),.assign (.var dst) (.var ret)]
def store (r : Runtime) (dst : String) (v : Nat) := r.declareLocal dst (.word v)
def temps (r : Runtime) (dst ret : String) (out i tmp : Nat) :=
  (((store r dst out).pushScope.declareLocal argName (.word i)).declareLocal ret (.word tmp))
private theorem same (r : Runtime) (a b : String) (v w : Nat) :
    (r.declareLocal a (.word v)).lookupLocal? a = some (.word v) := by
  cases eqn : r.locals <;> simp [Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,eqn]
set_option maxRecDepth 10000
theorem execute (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dst ret key : String)
    (inputTy outputTy : Ty) (rhs : Expr) (i out : Nat)
    (argNeRet : argName ≠ ret) (dstNeArg : dst ≠ argName) (dstNeRet : dst ≠ ret)
    (valid : inputTy.coerceValue? (.word i) = some (.word i))
    (zero : outputTy.defaultValue = .word 0)
    (read : Expr.eval c (store r dst 0).pushScope rhs = pure (.word i,(store r dst 0).pushScope))
    (call : Stmt.eval (n+1) t c (temps r dst ret 0 i 0) (.internalCall [ret] key [.var argName]) =
      internalCallAssign (temps r dst ret 0 i 0) [ret] [.word out]) :
    Stmt.eval (n+3) t c (store r dst 0) (code dst ret key inputTy outputTy rhs) =
      pure (.normal (store r dst out)) := by
  let withArg := (store r dst 0).pushScope.declareLocal argName (.word i)
  have D := declEval (n+1) t c _ argName inputTy rhs _ read valid
  have Z : Stmt.eval (n+2) t c withArg (.varDecl outputTy ret none) =
      pure (.normal (temps r dst ret 0 i 0)) := by rw [Stmt.eval]; dsimp only; rw [zero]; rfl
  have putRet : (temps r dst ret 0 i 0).assignLocal? ret (.word out) = some (temps r dst ret 0 i out) := by
    cases eqn : r.locals <;> simp [temps,store,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,eqn,Value.coerceLike?]
  have taken := takeReturn _ _ _ _ _ _ _ _ _ call putRet
  have copy : Stmt.evalList (n+2) t c (temps r dst ret 0 i out) [.assign (.var dst) (.var ret)] =
      pure (.normal (temps r dst ret out i out)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 out
    all_goals cases eqn : r.locals <;> simp [temps,store,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,eqn,Value.coerceLike?,
      Ne.symm dstNeArg,Ne.symm dstNeRet]
  exact block _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ D).trans ((seqStep _ _ _ _ _ _ _ Z).trans
    ((seqStep _ _ _ _ _ _ _ taken).trans copy)))
end Inv32OneArg
