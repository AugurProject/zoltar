import Inv48CloneGettersCall
import Inv48CloneGettersLink
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def uStart (base : Runtime) (v : Nat) : Runtime := {base with locals := [[("universe",.word v)]]}
def tStart (base : Runtime) : Runtime := {base with locals := [[("_ret0",.word 0)]]}
def uFrame (base : Runtime) (u t v : Nat) : Runtime :=
  {base with locals := [[(retT,.word t),(retU,.word u)],[],[],[("universe",.word v)]]}
def tFrame (base : Runtime) (u t v : Nat) : Runtime :=
  {base with locals := [[(retT,.word t),(retU,.word u),("token",.word v)],[],[("_ret0",.word 0)]]}
def capture : Stmt := .captureReturn [retU,retT] (.internalCall [retU,retT] cloneKey [])

theorem decl_none (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime) (ty : Ty) (name : String) :
    Stmt.eval (n+1) table c r (.varDecl ty name none) =
      pure (.normal (r.declareLocal name ty.defaultValue)) := by
  rw [Stmt.eval]

theorem call_uFrame (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (found : table.lookup? cloneKey = some libraryFn)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+40) table c (uFrame base 0 0 0) capture =
      pure (.normal (uFrame (post base (runtimeCode implementation universeBytes token))
        (decode universeBytes) (decode token) 0)) := by
  have call := library_call n table c (uFrame base 0 0 0) [retU,retT] libraryFn found rfl rfl rfl
    implementation universeBytes token hi hu ht cu ct selfWord boundary
  have write : internalCallAssign (post (uFrame base 0 0 0) (runtimeCode implementation universeBytes token))
      [retU,retT] [.word (decode universeBytes),.word (decode token)] =
      pure (.normal (uFrame (post base (runtimeCode implementation universeBytes token))
        (decode universeBytes) (decode token) 0)) := by
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
      Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.lookupMemoryRef?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,uFrame,retU,retT,post,Runtime.allocMemory]
  unfold capture
  rw [Stmt.eval]
  dsimp only
  rw [call,write]
  rfl

theorem call_tFrame (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (found : table.lookup? cloneKey = some libraryFn)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+40) table c (tFrame base 0 0 0) capture =
      pure (.normal (tFrame (post base (runtimeCode implementation universeBytes token))
        (decode universeBytes) (decode token) 0)) := by
  have call := library_call n table c (tFrame base 0 0 0) [retU,retT] libraryFn found rfl rfl rfl
    implementation universeBytes token hi hu ht cu ct selfWord boundary
  have write : internalCallAssign (post (tFrame base 0 0 0) (runtimeCode implementation universeBytes token))
      [retU,retT] [.word (decode universeBytes),.word (decode token)] =
      pure (.normal (tFrame (post base (runtimeCode implementation universeBytes token))
        (decode universeBytes) (decode token) 0)) := by
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
      Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.lookupMemoryRef?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,tFrame,retU,retT,post,Runtime.allocMemory]
  unfold capture
  rw [Stmt.eval]
  dsimp only
  rw [call,write]
  rfl


theorem u_copy (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime) (u t : Nat) :
    Stmt.eval (n+1) table c (uFrame base u t 0) (.assign (.var "universe") (.var retU)) =
      pure (.normal (uFrame base u t u)) := by
  apply assign n table c _ _ "universe" 0 u _
  · simp [uFrame,retU,retT,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  · exact Inv32Guards.readWord _ _ _ _ _ (by simp [uFrame,retU,retT,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?])
  · simp [uFrame,retU,retT,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?]

theorem t_copy (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime) (u t : Nat) :
    Stmt.eval (n+1) table c (tFrame base u t 0) (.assign (.var "token") (.var retT)) =
      pure (.normal (tFrame base u t t)) := by
  apply assign n table c _ _ "token" 0 t _
  · simp [tFrame,retU,retT,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  · exact Inv32Guards.readWord _ _ _ _ _ (by simp [tFrame,retU,retT,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?])
  · simp [tFrame,retU,retT,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?]

theorem token_return (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime) (u t : Nat) :
    Stmt.eval (n+1) table c (tFrame base u t t) (.returnValues [.var "token"]) =
      pure (.returned (tFrame base u t t) [.word t]) := by
  have h : (tFrame base u t t).lookupLocal? "token" = some (.word t) := by
    simp [tFrame,retU,retT,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have read : Expr.evalReturnValue c (tFrame base u t t) (.var "token") =
      pure (.word t,tFrame base u t t) := by
    simp only [Expr.evalReturnValue,Runtime.lookupMemoryRef?,h]
    exact Inv32Guards.readWord _ _ _ _ _ h
  have values : Expr.evalReturnList c (tFrame base u t t) [.var "token"] =
      pure ([.word t],tFrame base u t t) := by
    change Expr.evalReturnListFuel (_+1+1) c _ _ = _
    simp only [Expr.evalReturnListFuel,read,pb]
  rw [Stmt.eval]
  dsimp only
  rw [values]
  rfl

theorem universe_body (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (found : table.lookup? cloneKey = some libraryFn)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+43) table c (uStart base 0) universeFn.body =
      pure (.normal (uStart (post base (runtimeCode implementation universeBytes token)) (decode universeBytes))) := by
  let code := runtimeCode implementation universeBytes token
  let final := uFrame (post base code) (decode universeBytes) (decode token) (decode universeBytes)
  have tuple : Stmt.eval (n+41) table c (uStart base 0).pushScope.pushScope
      (.block [.varDecl .uint256 retU none,.varDecl .address retT none,capture,
        .assign (.var "universe") (.var retU)]) = pure (.normal final.popScope) := by
    apply Inv32Hoist.block
    rw [Stmt.evalList,decl_none]
    simp only [pb]
    rw [Stmt.evalList,decl_none]
    simp only [pb]
    simp only [Ty.defaultValue]
    change Stmt.evalList (n+40) table c (uFrame base 0 0 0) [capture,.assign (.var "universe") (.var retU)] = _
    rw [Stmt.evalList,call_uFrame n table c base found implementation universeBytes token hi hu ht cu ct selfWord boundary]
    simp only [pb]
    rw [Stmt.evalList,u_copy]
    simp only [pb,Stmt.evalList]
    rfl
  have inner : Stmt.eval (n+42) table c (uStart base 0).pushScope
      (.block [.block [.varDecl .uint256 retU none,.varDecl .address retT none,capture,
        .assign (.var "universe") (.var retU)]]) = pure (.normal final.popScope.popScope) := by
    apply Inv32Hoist.block
    rw [Stmt.evalList,tuple]
    simp only [pb,Stmt.evalList]
  change Stmt.eval (n+43) table c (uStart base 0)
    (.block [.skip,.block [.block [.varDecl .uint256 retU none,.varDecl .address retT none,capture,
      .assign (.var "universe") (.var retU)]]]) = _
  have run : Stmt.eval (n+43) table c (uStart base 0)
    (.block [.skip,.block [.block [.varDecl .uint256 retU none,.varDecl .address retT none,capture,
      .assign (.var "universe") (.var retU)]]]) = pure (.normal final.popScope.popScope.popScope) := by
    apply Inv32Hoist.block
    rw [Stmt.evalList,Stmt.eval]
    dsimp only
    simp only [pb]
    rw [Stmt.evalList,inner]
    simp only [pb,Stmt.evalList]
  rw [run]
  rfl


theorem reputation_body (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (found : table.lookup? cloneKey = some libraryFn)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+42) table c (tStart base) reputationFn.body =
      pure (.returned (tStart (post base (runtimeCode implementation universeBytes token))) [.word (decode token)]) := by
  let code := runtimeCode implementation universeBytes token
  let final := tFrame (post base code) (decode universeBytes) (decode token) (decode token)
  let ss : List Stmt := [.varDecl .address "token" none,.varDecl .uint256 retU none,
    .varDecl .address retT none,capture,.assign (.var "token") (.var retT),.returnValues [.var "token"]]
  have list : Stmt.evalList (n+40) table c (tStart base).pushScope.pushScope ss =
      pure (.returned final [.word (decode token)]) := by
    unfold ss
    rw [Stmt.evalList,decl_none]
    simp only [pb]
    rw [Stmt.evalList,decl_none]
    simp only [pb]
    rw [Stmt.evalList,decl_none]
    simp only [pb]
    simp only [Ty.defaultValue]
    change Stmt.evalList (n+40) table c (tFrame base 0 0 0)
      [capture,.assign (.var "token") (.var retT),.returnValues [.var "token"]] = _
    rw [Stmt.evalList,call_tFrame n table c base found implementation universeBytes token hi hu ht cu ct selfWord boundary]
    simp only [pb]
    rw [Stmt.evalList,t_copy]
    simp only [pb]
    rw [Stmt.evalList,token_return]
    rfl
  have inner : Stmt.eval (n+41) table c (tStart base).pushScope (.block ss) =
      pure (.returned final.popScope [.word (decode token)]) := by
    rw [Stmt.eval]
    dsimp only
    rw [list]
    rfl
  change Stmt.eval (n+42) table c (tStart base) (.block [.skip,.block ss]) = _
  rw [Stmt.eval]
  dsimp only
  rw [Stmt.evalList,Stmt.eval]
  dsimp only
  simp only [pb]
  rw [Stmt.evalList,inner]
  rfl

end Inv48.CloneGetters
