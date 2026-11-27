import Inv48BatchReadFrameIteration
import Inv48OperationsWrapperArgsTail
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchLoopClosure
open Inv48.BatchInputLoop Inv48.EscrowJoin Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem cleanupWord (checked : Bool) (v out : Value)
    (h : ValueCleanup.apply checked (.uint 256) v = .ok out) :
    ∃ w, out = .word w := by
  simp only [ValueCleanup.apply,uintCleanup?] at h
  cases forced : v.forceAbiLazy with
  | error e => simp [forced,Bind.bind,Except.bind] at h
  | ok value =>
    simp only [forced,Bind.bind,Except.bind] at h
    simp only [show (0 < 256 && 256 <= 256) = true by decide, ite_true] at h
    cases storage : value.asStorageWord? with
    | none => simp [storage] at h
    | some w =>
      simp only [storage] at h
      split at h
      · contradiction
      · simp only [uintCast?] at h
        cases forced2 : value.forceAbiLazy with
        | error e => simp [forced2,Bind.bind,Except.bind] at h
        | ok value2 =>
          simp only [forced2,Bind.bind,Except.bind] at h
          cases storage2 : value2.asStorageWord? with
          | none => simp [storage2] at h
          | some w2 => simp [storage2] at h; exact ⟨_,h.symm⟩

theorem frameAssigned (f g : Frame) (name : String) (v : Value)
    (h : f.assign? name v = some g) : g.lookup? name = some v := by
  induction f generalizing g with
  | nil => simp [Frame.assign?] at h
  | cons pair tail ih =>
    rcases pair with ⟨key,old⟩
    simp only [Frame.assign?] at h
    split at h
    next eq => cases h; simp [Frame.lookup?,eq]
    next ne =>
      cases a : Frame.assign? tail name v with
      | none => simp [a] at h
      | some updated =>
        simp only [a,Option.some.injEq] at h
        cases h
        simp [Frame.lookup?,ne,ih updated a]

theorem envAssigned (f g : LocalEnv) (name : String) (v : Value)
    (h : f.assign? name v = some g) : g.lookup? name = some v := by
  induction f generalizing g with
  | nil => simp [LocalEnv.assign?] at h
  | cons head tail ih =>
    simp only [LocalEnv.assign?] at h
    cases a : head.assign? name v with
    | some updated =>
      simp only [a,Option.some.injEq] at h
      cases h
      simp [LocalEnv.lookup?,frameAssigned head updated name v a]
    | none =>
      cases b : LocalEnv.assign? tail name v with
      | none => simp [a,b] at h
      | some updated =>
        simp only [a,b,Option.some.injEq] at h
        cases h
        simp [LocalEnv.lookup?,frameMissing head name v a,ih updated b]

theorem wordAssigned (r final : Runtime) (name : String) (old w : Nat)
    (bound : r.lookupLocal? name = some (.word old))
    (write : r.assignLocal? name (.word w) = some final) :
    final.lookupLocal? name = some (.word w) := by
  simp only [Runtime.assignLocal?,bound,Value.coerceLike?] at write
  cases a : r.locals.assign? name (.word w) with
  | none => simp [a] at write
  | some locals =>
    simp only [a,Option.some.injEq] at write
    cases write
    exact envAssigned r.locals locals name (.word w) a
end Inv48.BatchLoopClosure
