import Inv48PositiveSteps
import Inv48PositiveArithmetic
import Inv48PublicShape
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath
namespace Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

abbrev ret1 := "_ret_minimumToken1ReportAttoEth_0"
abbrev ret2 := "_ret_minimumToken2ReportAttoRep_0"
abbrev key1 := "__internal_minimumToken1ReportAttoEth()#[]"
abbrev key2 := "__internal_minimumToken2ReportAttoRep()#[]"
abbrev h0 := "_sol_hoist_0"
abbrev h1 := "_sol_hoist_1"
abbrev h2 := "_sol_hoist_2"
abbrev h3 := "_sol_hoist_3"
abbrev roundRet := "_ret___library_Math_mulDiv_overload_1_0"
abbrev maxRet := "_ret___library_Math_max_0"
abbrev maxKey := "__internal___library_Math_max(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
abbrev a3 := "_ic_arg_3"

def saved (r : Runtime) (dst : String) (v : Nat) := r.declareLocal dst (.word v)
def simpleCode (dst ret key : String) : Stmt := .block [
  .varDecl .uint256 ret none,
  .captureReturn [ret] (.internalCall [ret] key []),
  .assign (.var dst) (.var ret)]

def helperSuccess (baseFuel : Nat) (c : Context) (state : State) (key : String) (v : Nat) :=
  ∀ (n : Nat) (r : Runtime) (targets : List String), r.state = state →
    Stmt.eval (n+baseFuel) Inv48.Source.model.core.table c r (.internalCall targets key []) =
      internalCallAssign r targets [.word v]

macro "positive_store" : tactic => `(tactic|
  simp [saved,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,
    Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,Runtime.pushScope,Runtime.popScope,
    LocalEnv.declare,Frame.lookup?,Frame.assign?,LocalEnv.lookup?,LocalEnv.assign?,Value.coerceLike?])

theorem simple (n baseFuel : Nat) (c : Context) (r : Runtime) (dst ret key : String) (v : Nat)
    (different : dst ≠ ret) (success : helperSuccess baseFuel c r.state key v) :
    Stmt.eval (n+baseFuel+2) Inv48.Source.model.core.table c (saved r dst 0) (simpleCode dst ret key) =
      pure (.normal (saved r dst v)) := by
  let staged := (saved r dst 0).pushScope.declareLocal ret (.word 0)
  let called := (saved r dst 0).pushScope.declareLocal ret (.word v)
  let copied := (saved r dst v).pushScope.declareLocal ret (.word v)
  have pre : runList c.checked (saved r dst 0).pushScope [declareZero ret] = some staged := by simp [runList,declareZero,staged,Ty.defaultValue]
  have call := success n staged [ret] rfl
  have H := hoist (n+baseFuel) Inv48.Source.model.core.table c (saved r dst 0) staged called copied
    dst ret key [declareZero ret] [] v (by simp [listDepth,declareZero]) pre call
    (by dsimp [staged,called]; positive_store)
    (by dsimp [called]; cases eqn : r.locals <;> simp [saved,Runtime.declareLocal,Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,eqn,Ne.symm different])
    (by dsimp [called]; positive_store)
    (by dsimp [called,copied]; cases eqn : r.locals <;> simp [saved,Runtime.declareLocal,Runtime.pushScope,
      Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,eqn,Ne.symm different])
  simpa [simpleCode,declareZero,Action.core,copied,saved,Runtime.popScope,Runtime.pushScope] using H

def cleanWord (name : String) := clean (localWord name)
def castWord (name : String) := clean (cast .uint 256 (localWord name))
def enumOne : Formula where
  core := .enumFromUInt 3 (.castOp .uintCleanup 256 (.word 1))
  depth := 3
  run _ _ := some 1
  sound fuel ctx rt env v enough _ hit := by
    cases hit
    cases fuel with
    | zero => omega
    | succ n => cases n with
      | zero => omega
      | succ n => cases n with
        | zero => omega
        | succ n =>
          have lit : Expr.evalFuel (n+1) ctx rt (.word 1) = pure (.word 1,rt) := by rw [Expr.evalFuel]; rfl
          have cl := Inv32Guards.clean (n+1) ctx rt (.word 1) 1 (by decide) lit
          rw [Expr.evalFuel,cl]; rfl

def roundArgs : List Action := [
  declare .uint256 a0 (cleanWord h1) (by decide),
  declare .uint256 a1 (choice (literal 1) (literal (10^18)) (literal (10^18))) (by decide),
  declare .uint256 a2 (cleanWord "proposedRepPerEthPrice") (by decide),
  declare .uint256 a3 enumOne (by decide),
  declareZero roundRet]

def start (r : Runtime) (price : Nat) :=
  r.withFrame [("proposedRepPerEthPrice",.word price),("_ret0",.word 0)]
def root (r : Runtime) (price : Nat) := (start r price).pushScope.pushScope
def phase1 (r : Runtime) (price collateral : Nat) := saved (root r price) h0 collateral
def phase2 (r : Runtime) (price collateral rep : Nat) := saved (phase1 r price collateral) h1 rep

def roundStage (r : Runtime) (price collateral rep out tmp : Nat) :=
  (((((saved (phase2 r price collateral rep) h2 out).pushScope.declareLocal a0 (.word rep)).declareLocal a1 (.word (10^18))).declareLocal a2 (.word price)).declareLocal a3 (.word 1)).declareLocal roundRet (.word tmp)

def roundCode : Stmt := .block (roundArgs.map Action.core ++ [
  .captureReturn [roundRet] (.internalCall [roundRet] Inv32Bodies.Ceil.key [.var a0,.var a1,.var a2,.var a3]),
  .assign (.var h2) (.var roundRet)])

end Inv48.Positive
