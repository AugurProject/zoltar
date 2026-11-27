import Inv08Integral
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.MemoryMember

def Reads (c : Context) (r : Runtime) (e : Expr) (v : Nat) :=
  ∀ fuel, e.orderFuel+1 ≤ fuel → Expr.evalFuel fuel c r e = pure (.word v,r)
private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl

theorem fromMemory (c : Context) (r : Runtime) (name : String) (id index value : Nat) (vs : List Value)
    (localRef : r.lookupLocal? name = some (.memoryRef id)) (mem : r.loadMemory? id = some (.tuple vs))
    (fit : index<R) (item : listGet? vs index = some (.word value)) :
    Reads c r (Integral.member name index).value value := by
  intro fuel enough
  change 4≤fuel at enough
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le enough
  have norm : SolidCore.Solidity.Shared.norm index = index := Nat.mod_eq_of_lt fit
  have noBase : r.lookupStorageBase? name = none := by simp [Runtime.lookupStorageBase?,localRef]
  have base : Expr.evalFuel (n+2) c r (.var name) = pure (.tuple vs,r) := by
    simp [Expr.evalFuel,noBase,localRef,Runtime.derefMemoryValue,mem,liftOk,bindOk]
  have num : Expr.evalFuel (n+1) c r (.word index) = pure (.word index,r) := by rw [Expr.evalFuel, show normWord index = index from norm]
  have rest : Expr.evalListFuel (n+2) c r [.word index] = pure ([.word index],r) := by
    rw [Expr.evalListFuel,num]; simp only [bindOk,Expr.evalListFuel]
  have args : Expr.evalListFuel (n+3) c r [.var name,.word index] = pure ([.tuple vs,.word index],r) := by
    rw [Expr.evalListFuel,base]; simp only [bindOk,rest]
  rw [Nat.add_comm]
  change Expr.evalFuel (n+4) c r (.index (.var name) (.word index)) = _
  rw [Expr.evalFuel]
  simp [Expr.hasStorageRoot,Expr.hasStorageRefRoot,noBase,args,bindOk,Value.expectWord,norm,
    Runtime.derefMemoryValue,Value.index?,item,liftOk]

theorem clean (h : Reads c r e v) (fit : v<R) : Reads c r (.castOp .uintCleanup 256 e) v := by
  intro fuel enough
  change e.orderFuel+1+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32Guards.clean _ _ _ _ _ fit (h _ (by omega))

theorem add (left : Reads c r e a) (right : Inv40.Reads c r g b) (spare : 0<g.orderFuel) (fit : a+b<R) :
    Inv40.Reads c r (.binary .add e g) (a+b) := by
  intro fuel enough
  change e.orderFuel+g.orderFuel+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ f =>
    exact Inv32Eval.binary f c r .add (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
      (left _ (by omega)) (right _ (by omega)) (Inv40.addWords _ _ _ fit)
end Inv08.MemoryMember
