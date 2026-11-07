// gUSD: a test dollar for Ghostwriter on Sui Testnet. It has no value.
//
// The DeepBook Predict DUSDC request form is closed, so Ghostwriter's vault and premiums use this
// coin instead. Anyone can mint from the shared Faucet, capped per call, so the frontend and the
// agent script can fund themselves.
module gusd::gusd;

use sui::coin::{Self, Coin, TreasuryCap};

const EBadAmount: u64 = 1;

/// 6 decimals, like USDC. Max 1,000 gUSD per mint call.
const DECIMALS: u8 = 6;
const MAX_MINT: u64 = 1_000_000_000;

public struct GUSD has drop {}

public struct Faucet has key {
    id: UID,
    cap: TreasuryCap<GUSD>,
}

#[allow(deprecated_usage)]
fun init(otw: GUSD, ctx: &mut TxContext) {
    let (cap, meta) = coin::create_currency(
        otw,
        DECIMALS,
        b"gUSD",
        b"Ghostwriter test dollar",
        b"Test dollars for Ghostwriter on Sui Testnet. No value.",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(meta);
    transfer::share_object(Faucet { id: object::new(ctx), cap });
}

public fun mint(faucet: &mut Faucet, amount: u64, ctx: &mut TxContext): Coin<GUSD> {
    assert!(amount > 0 && amount <= MAX_MINT, EBadAmount);
    coin::mint(&mut faucet.cap, amount, ctx)
}

/// Mint straight to the caller's wallet (for wallets and CLI use).
#[allow(lint(self_transfer))]
public fun mint_to_sender(faucet: &mut Faucet, amount: u64, ctx: &mut TxContext) {
    transfer::public_transfer(mint(faucet, amount, ctx), ctx.sender());
}

public fun max_mint(): u64 { MAX_MINT }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(GUSD {}, ctx) }
