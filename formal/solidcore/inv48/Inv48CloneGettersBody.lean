import Inv48CloneGettersLoops
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem liftOk {α : Type} (a : α) : (liftM (.ok a : Except RevertData α) : SolI α) = pure a := rfl

def callee (base : Runtime) (u t : Nat) : Runtime :=
  { base with locals := [[("universe",.word u),("token",.word t)]] }
def offset (base : Runtime) : Runtime := base.pushScope.declareLocal "offset" (.word 45)
def lengthCheck : Stmt := .requireStmt
  (.binary .eq (clean (.length selfCode))
    (clean (clean (.binary .add (clean (.var "offset")) (.word 51)))))
  (some "Universe module requires a clone")
def prologue : List Stmt := [
  .varDecl .uint256 "offset" none,
  .ifElse (.word 1) (.assign (.var "offset") (.word 45)) (.assign (.var "offset") (.word 45)),
  lengthCheck]
def decoderPrefix : List Stmt := [
  .memoryVarDecl .bytesCalldata "#extcode" (some selfCode),
  .varDecl .uint256 "#extindex" (some (.word 0)),
  .varDecl .uint256 "#extword" (some (.word 0)),
  .assign (.var "#extword") (.word 0)]
def saveUniverse : Stmt := .assign (.var "universe") (cast 248 (clean (.var "#extword")))
def reset : Stmt := .assign (.var "#extword") (.word 0)
def saveToken : Stmt := .assign (.var "token") (cast 160 (.var "#extword"))
theorem body_shape : libraryBody = .block [.skip,.skip,
    .block (prologue ++ [.block (decoderPrefix ++ [firstLoop,saveUniverse,reset,secondLoop,saveToken])])] := rfl

@[simp] theorem caught_pure {α : Type} (a : α) : (pure a : SolI α).caught = pure (.ok a) := rfl

theorem assign (n : Nat) (table : FunctionTable) (c : Context) (r next : Runtime)
    (name : String) (old v : Nat) (e : Expr)
    (bound : r.lookupLocal? name = some (.word old))
    (rhs : Expr.eval c r e = pure (.word v,r))
    (store : r.assignLocal? name (.word v) = some next) :
    Stmt.eval (n+1) table c r (.assign (.var name) e) = pure (.normal next) := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs, Runtime.lookupMemoryRef?, bound]
  rw [Stmt.eval]
  dsimp only
  rw [notMem]
  simp only [Bool.false_eq_true, if_false, rhs, caught_pure, pb]
  rw [Inv32Writes.resolve c r name old bound]
  simp only [caught_pure, pb, ResolvedLValue.write,store]
  cases e <;> simp [Runtime.lookupMemoryRef?,bound,ResolvedLValue.asStoragePath?]

theorem offset_prologue (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime) :
    Stmt.evalList (n+3) table c base.pushScope (prologue.take 2) =
    pure (.normal (offset base)) := by
  have step := assign (n+1) table c
    (base.pushScope.declareLocal "offset" (.word 0)) (offset base) "offset" 0 45 (.word 45)
    (by simp [Runtime.declareLocal,Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])
    rfl
    (by simp [offset,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have decl : Stmt.eval (n+3) table c base.pushScope (.varDecl .uint256 "offset" none) =
      pure (.normal (base.pushScope.declareLocal "offset" (.word 0))) := by rw [Stmt.eval]; dsimp only; rw [Ty.defaultValue]
  have branch : Stmt.eval (n+3) table c (base.pushScope.declareLocal "offset" (.word 0))
      (.ifElse (.word 1) (.assign (.var "offset") (.word 45)) (.assign (.var "offset") (.word 45))) =
      pure (.normal (offset base)) := by
    rw [Stmt.eval]
    change Stmt.eval (n+2) table c (base.pushScope.declareLocal "offset" (.word 0))
      (.assign (.var "offset") (.word 45)) = _
    exact step
  change Stmt.evalList (n+3) table c base.pushScope
    [.varDecl .uint256 "offset" none,
     .ifElse (.word 1) (.assign (.var "offset") (.word 45)) (.assign (.var "offset") (.word 45))] = _
  rw [Stmt.evalList,decl]
  simp only [pb]
  rw [Stmt.evalList,branch]
  simp only [pb,Stmt.evalList]

 theorem length_rhs (c : Context) (base : Runtime) (code : List Nat)
    (selfWord : c.self < R) (boundary : base.state.envAccountCode c c.self = code)
    (len : code.length = 96) :
    Expr.eval c (offset base) (.binary .eq (clean (.length selfCode))
      (clean (clean (.binary .add (clean (.var "offset")) (.word 51))))) =
      pure (.word 1,offset base) := by
  have O : (offset base).lookupLocal? "offset" = some (.word 45) := by
    simp [offset,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have B : (offset base).state.envAccountCode c c.self = code := boundary
  simp [Expr.eval,Expr.orderFuel,Expr.evalFuel,clean,selfCode,
    Runtime.lookupStorageBase?,O,Runtime.derefMemoryValue,Value.length?,Value.expectWord,
    normWord,SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,
    show EvmYul.UInt256.size = R from rfl,
    Nat.mod_eq_of_lt selfWord,Nat.mod_eq_of_lt (show 51 < R by decide),B,len,pb,liftOk,
    cleanup_value _ 96 (by decide),cleanup_value _ 45 (by decide),
    add_value _ 45 51 (by decide) (by decide) (by decide),
    Expr.hasStorageRoot,Expr.hasStorageRefRoot,
    show BinaryOp.apply c.checked .eq (.word 96) (.word 96) = .ok (.word 1) by cases c.checked <;> rfl]

private theorem assoc {α β γ : Type} (x : SolI α) (f : α → SolI β) (g : β → SolI γ) :
    ((x >>= f) >>= g) = (x >>= fun a => f a >>= g) :=
  EvmCompiler.Simulation.Interaction.bind_assoc x f g

theorem seq_append (fuel : Nat) (table : FunctionTable) (c : Context) (r next : Runtime)
    (a b : List Stmt) (h : Stmt.evalList fuel table c r a = pure (.normal next)) :
    Stmt.evalList fuel table c r (a ++ b) = Stmt.evalList fuel table c next b := by
  have general (r : Runtime) (a : List Stmt) :
      Stmt.evalList fuel table c r (a ++ b) = (do
        match ← Stmt.evalList fuel table c r a with
        | .normal r' => Stmt.evalList fuel table c r' b
        | result => pure result) := by
    induction a generalizing r with
    | nil => simp only [List.nil_append,Stmt.evalList,pb]
    | cons x xs ih =>
      simp only [List.cons_append,Stmt.evalList]
      rw [assoc]
      congr 1
      funext result
      cases result <;> simp only [pb]
      exact ih _
  rw [general,h]
  rfl

theorem prologue_eval (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = code) (len : code.length = 96) :
    Stmt.evalList (n+3) table c base.pushScope prologue = pure (.normal (offset base)) := by
  have g : Stmt.eval (n+3) table c (offset base) lengthCheck = pure (.normal (offset base)) := by
    rw [Stmt.eval]
    dsimp only [lengthCheck]
    rw [length_rhs c base code selfWord boundary len]
    rfl
  have sh : prologue = prologue.take 2 ++ [lengthCheck] := rfl
  rw [sh,seq_append _ _ _ _ _ _ _ (offset_prologue n table c base)]
  rw [Stmt.evalList,g]
  simp only [pb,Stmt.evalList]

theorem decl_zero (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (n+1) table c r (.varDecl .uint256 name (some (.word 0))) =
      pure (.normal (r.declareLocal name (.word 0))) := by
  rw [Stmt.eval]
  dsimp only
  rfl

theorem decoder_prepare (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = code) :
    Stmt.evalList (n+1) table c (offset base).pushScope decoderPrefix =
      pure (.normal (refState base code 0 0)) := by
  have cache := cache_self_code n table c (offset base).pushScope code selfWord boundary
  have setzero := assign n table c (refState base code 0 0) (refState base code 0 0)
    "#extword" 0 0 (.word 0) (by simp) rfl (ref_store_word _ _ _ _ _)
  unfold decoderPrefix
  rw [Stmt.evalList,cache]
  simp only [pb]
  rw [Stmt.evalList,decl_zero]
  simp only [pb]
  rw [Stmt.evalList,decl_zero]
  simp only [pb]
  change Stmt.evalList (n+1) table c (refState base code 0 0) [reset] = _
  rw [Stmt.evalList]
  change (do
    match ← Stmt.eval (n+1) table c (refState base code 0 0) (.assign (.var "#extword") (.word 0)) with
    | .normal r => Stmt.evalList (n+1) table c r []
    | result => pure result) = _
  rw [setzero]
  simp only [pb,Stmt.evalList]

theorem save_universe (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (u : Nat) (fit : u < 2^248) :
    Stmt.eval (n+1) table c (refState (callee base 0 0).pushScope code 31 u) saveUniverse =
      pure (.normal (refState (callee base u 0).pushScope code 31 u)) := by
  apply assign n table c _ _ "universe" 0 u _
  · simp only [ref_lookup]
    simp [callee,Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  · have ur : u < R := lt_trans fit (by decide)
    simp [saveUniverse,Inv48.SymbolicClone.cast,clean,Expr.eval,Expr.orderFuel,Expr.evalFuel,
      Runtime.lookupStorageBase?,Runtime.derefMemoryValue,
      cleanup_value _ u ur,cast_value 248 u (by decide) (by decide) fit,pb,liftOk]
  · simp [refState,callee,Runtime.pushScope,Runtime.allocMemory,Runtime.assignLocal?,Runtime.lookupLocal?,
      LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?]

theorem reset_eval (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (i acc : Nat) :
    Stmt.eval (n+1) table c (refState base code i acc) reset =
      pure (.normal (refState base code i 0)) :=
  assign n table c _ _ "#extword" acc 0 _ (by simp) rfl (ref_store_word _ _ _ _ _)

theorem save_token (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (u t : Nat) (fit : t < 2^160) :
    Stmt.eval (n+1) table c (refState (callee base u 0).pushScope code 51 t) saveToken =
      pure (.normal (refState (callee base u t).pushScope code 51 t)) := by
  apply assign n table c _ _ "token" 0 t _
  · simp only [ref_lookup]
    simp [callee,Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  · simp [saveToken,Inv48.SymbolicClone.cast,Expr.eval,Expr.orderFuel,Expr.evalFuel,
      Runtime.lookupStorageBase?,Runtime.derefMemoryValue,
      cast_value 160 t (by decide) (by decide) fit,pb,liftOk]
  · simp [refState,callee,Runtime.pushScope,Runtime.allocMemory,Runtime.assignLocal?,Runtime.lookupLocal?,
      LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?]

theorem decoder_eval (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.evalList (n+35) table c (offset (callee base 0 0).pushScope).pushScope
      (decoderPrefix ++ [firstLoop,saveUniverse,reset,secondLoop,saveToken]) =
      pure (.normal (refState (callee base (decode universeBytes) (decode token)).pushScope
        (runtimeCode implementation universeBytes token) 51 (decode token))) := by
  rw [seq_append _ _ _ _ _ _ _ (decoder_prepare (n+34) table c (callee base 0 0).pushScope _ selfWord boundary)]
  rw [Stmt.evalList,first_loop_ref n table c _ implementation universeBytes token hi hu ht cu]
  simp only [pb]
  rw [Stmt.evalList,save_universe (n+34) table c base _ _ (universe_bounds _ hu cu)]
  simp only [pb]
  rw [Stmt.evalList,reset_eval]
  simp only [pb]
  rw [Stmt.evalList,show n+35 = (n+11)+24 by omega,
    second_loop_ref (n+11) table c _ implementation universeBytes token hi hu ht ct]
  simp only [pb]
  rw [Stmt.evalList,show n+11+24 = (n+34)+1 by omega,
    save_token (n+34) table c base _ _ _ (token_bounds _ ht ct)]
  simp only [pb,Stmt.evalList]

end Inv48.CloneGetters
