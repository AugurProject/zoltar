import Inv32Arithmetic
import Inv32Assign
open SolidCore.Solidity.Source Inv32Scalar
namespace Inv32Actions
def locals (r : Runtime) (name : String) : Option Nat := do
  let .word v ← r.lookupLocal? name | none
  return v

private theorem lookup (r : Runtime) (name : String) (v : Nat) (h : locals r name = some v) :
    r.lookupLocal? name = some (.word v) := by
  cases k : r.lookupLocal? name with
  | none => simp [locals,k] at h
  | some val => cases val <;> simp_all [locals]

structure Action where
  core : Stmt
  depth : Nat
  run : Bool → Runtime → Option Runtime
  sound : ∀ n t c r next, depth ≤ n → run c.checked r = some next →
    Stmt.eval n t c r core = pure (.normal next)

theorem evalFormula (e : Formula) (c : Context) (r : Runtime) (v : Nat)
    (size : e.depth ≤ e.core.orderFuel+1)
    (h : e.run c.checked (locals r) = some v) :
    Expr.eval c r e.core = pure (.word v,r) :=
  e.sound _ _ _ _ _ size (lookup r) h

def writeCast (name : String) (kind : Cast) (width : Nat) (e : Formula)
    (size : (cast kind width e).depth ≤ (cast kind width e).core.orderFuel + 1) : Action where
  core := .assign (.var name) (cast kind width e).core
  depth := 1
  run checked r := do
    let _ ← locals r name
    let v ← (cast kind width e).run checked (locals r)
    r.assignLocal? name (.word v)
  sound n t c r next enough hit := by
    cases n with
    | zero => contradiction
    | succ n =>
      cases b : locals r name <;> simp only [b, Option.bind_none, Option.bind_some] at hit
      case none => contradiction
      cases a : (cast kind width e).run c.checked (locals r) <;> simp only [a,Option.bind_none,Option.bind_some] at hit
      case none => contradiction
      exact Inv32Assign.scalarCast _ _ _ _ _ _ _ _ _ _ _ (lookup _ _ _ b)
        (evalFormula _ c r _ size a) hit

def noop : Action where
  core := .skip
  depth := 1
  run _ r := some r
  sound n t c r next enough h := by cases n <;> cases h <;> first | contradiction | rw [Stmt.eval]

def declareZero (name : String) : Action where
  core := .varDecl .uint256 name none
  depth := 1
  run _ r := some (r.declareLocal name Ty.uint256.defaultValue)
  sound n t c r next enough h := by cases n <;> cases h <;> first | contradiction | rw [Stmt.eval]

def unchecked (a : Action) : Action where
  core := .unchecked a.core
  depth := a.depth+1
  run _ r := a.run false r
  sound n t c r next enough h := by
    cases n with
    | zero => omega
    | succ n => rw [Stmt.eval]; exact a.sound _ _ _ _ _ (by omega) h

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def runList (checked : Bool) (r : Runtime) : List Action → Option Runtime
  | [] => some r
  | a :: rest => (a.run checked r).bind (fun next => runList checked next rest)

def listDepth : List Action → Nat
  | [] => 0
  | a :: rest => max a.depth (listDepth rest)

theorem runList_sound (as : List Action) (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (enough : listDepth as ≤ n) (done : runList c.checked r as = some next) :
    Stmt.evalList n t c r (as.map Action.core) = pure (.normal next) := by
  induction as generalizing r with
  | nil => cases done; rw [List.map_nil, Stmt.evalList]
  | cons a rest ih =>
    simp only [listDepth, max_le_iff] at enough
    cases h : a.run c.checked r <;> simp [runList,h] at done
    rw [List.map_cons,Stmt.evalList, a.sound _ _ _ _ _ enough.1 h]
    simp only [pb]
    exact ih _ enough.2 done

def block (as : List Action) : Action where
  core := .block (as.map Action.core)
  depth := listDepth as + 1
  run checked r := (runList checked r.pushScope as).map Runtime.popScope
  sound n t c r next enough hit := by
    cases n with
    | zero => omega
    | succ n =>
      cases h : runList c.checked r.pushScope as <;> simp [h] at hit
      rw [Stmt.eval]; dsimp only
      rw [runList_sound _ _ _ _ _ _ (by omega) h]
      subst next
      rfl

end Inv32Actions
