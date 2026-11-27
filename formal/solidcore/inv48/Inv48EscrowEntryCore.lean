import Inv48EscrowEntryLookup
import Inv48PositivePublicCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem pb {α β : Type} (x : α) (k : α → SolI β) : pure x >>= k = k x := rfl

def params : List BindingDecl := [⟨"payer",.address,false⟩,⟨"sponsor",.address,false⟩,
  ⟨"wethAmount",.uint256,false⟩,⟨"repAmount",.uint256,false⟩,
  ⟨"haltAmount",.uint256,false⟩,⟨"bounty",.uint256,false⟩,⟨"callbackGasLimit",.uint256,false⟩]
def returns : List BindingDecl := [⟨"id",.uint256,false⟩,⟨"escrow",.address,false⟩]
def arguments (payer sponsor weth amount halt bounty gas : Nat) : List Value :=
  [.word payer,.word sponsor,.word weth,.word amount,.word halt,.word bounty,.word gas]
def frame (payer sponsor weth amount halt bounty gas : Nat) : Frame :=
  [("payer",.word payer),("sponsor",.word sponsor),("wethAmount",.word weth),
   ("repAmount",.word amount),("haltAmount",.word halt),("bounty",.word bounty),
   ("callbackGasLimit",.word gas),("id",.word 0),("escrow",.word 0)]
def entry (c : Context) (state : State) (payer sponsor weth amount halt bounty gas : Nat) : Runtime :=
  {state := Inv48.Positive.entryState c state, locals := [frame payer sponsor weth amount halt bounty gas]}

theorem binding (fn : FunctionDef) (payer sponsor weth amount halt bounty gas : Nat)
    (ps : fn.params = params) (rs : fn.returns = returns) :
    fn.initialFrame? (arguments payer sponsor weth amount halt bounty gas) =
      some (frame payer sponsor weth amount halt bounty gas) := by
  simp [FunctionDef.initialFrame?,FunctionDef.returnDefaultBindings,ps,rs,params,returns,
    arguments,frame,BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
    Ty.coerceValue?,Ty.defaultValue]

def cleanup (bits : Nat) (name : String) : Stmt :=
  .assign (.var name) (.castOp .uintCleanup bits (.var name))
def prologue : List Stmt := [.skip,.skip,
  cleanup 256 "wethAmount",cleanup 256 "repAmount",cleanup 256 "haltAmount",
  cleanup 256 "bounty",cleanup 32 "callbackGasLimit",.skip,.skip]

theorem cleanupExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (bits value : Nat) (name : String)
    (look : r.lookupLocal? name = some (.word value))
    (clean : uintCleanup? c.checked bits (.word value) = .ok (.word value))
    (write : r.assignLocal? name (.word value) = some r) :
    Stmt.eval (n+1) t c r (cleanup bits name) = pure (.normal r) := by
  apply Inv32Assign.scalarCast n t c r r name value value .uintCleanup bits (.var name) look
  · unfold Expr.eval
    simp only [Expr.orderFuel]
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ look]
    change (do
      let casted ← (uintCleanup? c.checked bits (.word value) : Except RevertData Value)
      pure (casted,r) : SolI (Value × Runtime)) = _
    rw [clean]
    rfl
  · exact write

theorem cleanWidth (checked : Bool) (bits value : Nat)
    (positive : 0 < bits) (width : bits ≤ 256)
    (word : value < 2^256) (fits : value < 2^bits) :
    uintCleanup? checked bits (.word value) = .ok (.word value) := by
  have norm : SolidCore.Solidity.Shared.norm value = value := Nat.mod_eq_of_lt word
  simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,norm,
    positive,width,fits,Nat.mod_eq_of_lt fits,Bind.bind,Except.bind]

macro "entry_locals" : tactic => `(tactic|
  simp [entry,frame,Runtime.pushScope,Runtime.lookupLocal?,Runtime.assignLocal?,
    LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem prologueExec (n : Nat) (t : FunctionTable) (c : Context) (state : State)
    (payer sponsor weth amount halt bounty gas : Nat)
    (hw : weth < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) :
    Stmt.evalList (n+1) t c (entry c state payer sponsor weth amount halt bounty gas).pushScope
      prologue = pure (.normal (entry c state payer sponsor weth amount halt bounty gas).pushScope) := by
  let r := (entry c state payer sponsor weth amount halt bounty gas).pushScope
  have clean256 (name : String) (v : Nat) (hv : v < 2^256)
      (look : r.lookupLocal? name = some (.word v))
      (write : r.assignLocal? name (.word v) = some r) :=
    cleanupExec n t c r 256 v name look
      (cleanWidth c.checked 256 v (by decide) (by decide) hv hv) write
  have w := clean256 "wethAmount" weth hw (by dsimp only [r]; entry_locals) (by dsimp only [r]; entry_locals)
  have a := clean256 "repAmount" amount ha (by dsimp only [r]; entry_locals) (by dsimp only [r]; entry_locals)
  have h := clean256 "haltAmount" halt hh (by dsimp only [r]; entry_locals) (by dsimp only [r]; entry_locals)
  have b := clean256 "bounty" bounty hb (by dsimp only [r]; entry_locals) (by dsimp only [r]; entry_locals)
  have g := cleanupExec n t c r 32 gas "callbackGasLimit" (by dsimp only [r]; entry_locals)
    (cleanWidth c.checked 32 gas (by decide) (by decide)
      (hg.trans_le (by decide)) hg) (by dsimp only [r]; entry_locals)
  have skip : Stmt.eval (n+1) t c r .skip = pure (.normal r) := by rw [Stmt.eval]
  change Stmt.evalList (n+1) t c r prologue = pure (.normal r)
  unfold prologue
  simp only [Stmt.evalList,skip,w,a,h,b,g,
    pb]

#print axioms binding
#print axioms cleanupExec
#print axioms cleanWidth
#print axioms prologueExec
end Inv48.EscrowEntry
