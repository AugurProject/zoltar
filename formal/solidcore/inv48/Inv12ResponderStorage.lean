import Inv12StorageWF
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

private def storageAt (accounts : EvmYul.AddrMap EvmCompiler.Simulation.OpenAccount) (addr : EvmYul.AccountAddress) :=
  ((accounts.find? addr).getD default).storage

private theorem sameStore (accounts : EvmYul.AddrMap EvmCompiler.Simulation.OpenAccount)
    (addr target : EvmYul.AccountAddress) (account : EvmCompiler.Simulation.OpenAccount)
    (same : account.storage=storageAt accounts target) :
    storageAt (accounts.insert target account) addr=storageAt accounts addr := by
  unfold storageAt at *
  by_cases eqn : compare addr target=Ordering.eq
  · have eq := Std.LawfulEqCmp.compare_eq_iff_eq.mp eqn
    subst target
    rw [Batteries.RBMap.find?_insert_of_eq _ eqn]; exact same
  · rw [Batteries.RBMap.find?_insert_of_ne _ eqn]

theorem debitStore (c : Context) (w : Shared.OpenWorld) (self amount : Nat) :
    selfStore c (debitWorldSelf w self amount)=selfStore c w := by
  unfold debitWorldSelf
  split
  · rfl
  · apply sameStore; rfl

private def adjust (acc : EvmYul.AddrMap EvmCompiler.Simulation.OpenAccount) (entry : Nat × OpenAccountDelta) :=
  let addr := wordToAddress entry.1
  let a := (acc.find? addr).getD default
  let balance := match entry.2.balance? with | some b => wordToU256 b | none => a.balance
  let code := match entry.2.code? with | some bytes => bytesToByteArray bytes | none => a.codeBytes
  acc.insert addr {a with balance:=balance,codeBytes:=code}

private theorem adjustStore (addr : EvmYul.AccountAddress) (changes : List (Nat × OpenAccountDelta))
    (acc : EvmYul.AddrMap EvmCompiler.Simulation.OpenAccount) : storageAt (changes.foldl adjust acc) addr=storageAt acc addr := by
  induction changes generalizing acc with
  | nil => rfl
  | cons x xs ih =>
    change storageAt (xs.foldl adjust (adjust acc x)) addr=_
    rw [ih]; apply sameStore; rfl

theorem deltaStore (c : Context) (w : Shared.OpenWorld) (self : Nat) (delta : PostDelta)
    (writes : delta.selfStorageWrites=[]) : selfStore c (delta.apply self w)=selfStore c w := by
  change storageAt (delta.otherAccounts.foldl adjust _) _=storageAt w.accounts _
  rw [adjustStore]
  apply sameStore
  simp [writes,storageAt]
end Inv12
