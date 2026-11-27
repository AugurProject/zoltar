import Inv48RequestQuoteWire
open SolidCore.Solidity.Source
namespace Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def field (i : Nat) : Expr := .index (.var "quote") (.word i)
def args : List Expr := [.caller,.var "sponsor",field 0,field 1,field 2,
  .var "bountyAttoEth",.var "callbackGasLimit"]
def calldataExpr (selector : Nat) : Expr := .encode .withSelector (some (.word selector)) [] types args
def calldata (selector payer sponsor a b h bounty gas : Nat) :=
  wordToBytesBE selectorBytes selector ++ payload payer sponsor a b h bounty gas

theorem arguments (c : Context) (r : Runtime) (id a b h e s sponsor bounty gas : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R) :
    ∀ n, Expr.evalListFuel (n+12) c r args =
      pure (values c.sender sponsor a b h bounty gas,r) := by
  have read (i v : Nat) (hi : i<R) (hv : v<R)
      (item : listGet? [Value.word a,.word b,.word h,.word e,.word s] i = some (.word v)) :
      Inv08.MemoryMember.Reads c r (field i) v := by
    exact Inv08.MemoryMember.fromMemory c r "quote" id i v
      [.word a,.word b,.word h,.word e,.word s] ref mem hi item
  intro n
  unfold args
  rw [Expr.evalListFuel,Expr.evalFuel]
  simp only [pb]; try dsimp only
  rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ S]
  simp only [pb]; try dsimp only
  rw [Expr.evalListFuel,read 0 a (by decide) ha rfl _ (by simp [field,Expr.orderFuel])]
  simp only [pb]; try dsimp only
  rw [Expr.evalListFuel,read 1 b (by decide) hb rfl _ (by simp [field,Expr.orderFuel])]
  simp only [pb]; try dsimp only
  rw [Expr.evalListFuel,read 2 h (by decide) hh rfl _ (by simp [field,Expr.orderFuel])]
  simp only [pb]; try dsimp only
  rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ B]
  simp only [pb]; try dsimp only
  rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ G]
  rfl

theorem encoding (c : Context) (r : Runtime) (selector id a b h e s sponsor bounty gas : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160) (hsel : selector<R) :
    Expr.eval c r (calldataExpr selector) =
      pure (.bytes (calldata selector c.sender sponsor a b h bounty gas),r) := by
  have arg := arguments c r id a b h e s sponsor bounty gas ref mem S B G ha hb hh hB hG
  have enc := encode c.sender sponsor a b h bounty gas hp hs
  have all (n : Nat) : Expr.evalListFuel (n+14) c r (.word selector :: args) =
      pure (.word selector :: values c.sender sponsor a b h bounty gas,r) := by
    rw [Expr.evalListFuel,Expr.evalFuel]
    have norm : normWord selector = selector := Nat.mod_eq_of_lt hsel
    rw [norm]
    simp only [pb]
    rw [show n+13 = (n+1)+12 by omega,arg]
    rfl
  unfold Expr.eval calldataExpr
  simp only [Expr.orderFuel,Expr.listEvalFuel,args,field]
  rw [Expr.evalFuel]
  change (do let pair ← Expr.evalListFuel _ c r (.word selector :: args); _) = _
  rw [all]
  simp only [pb]
  have material : r.materializeForValueUseList c (values c.sender sponsor a b h bounty gas) =
      .ok (values c.sender sponsor a b h bounty gas) := by
    simp [values,Runtime.materializeForValueUseList,Runtime.materializeForValueUse,
      Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  simp only [Value.expectWord]
  rw [show SolidCore.Solidity.Shared.norm selector = selector from Nat.mod_eq_of_lt hsel,material]
  change (match abiEncodeValues? types (values c.sender sponsor a b h bounty gas) with
    | some bs => (pure (Value.bytes (wordToBytesBE selectorBytes selector ++ bs),r) : SolI (Value × Runtime))
    | none => throw (SolidityFailure.revert RevertData.typeMismatch)) = _
  rw [enc]
  rfl

#print axioms encoding
#print axioms arguments
end Inv48.RequestQuote
