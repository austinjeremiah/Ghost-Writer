// Ghostwriter: AI-underwritten liquidation protection (Sui Testnet).
module ghostwriter::ghostwriter;

use std::bcs;
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::ed25519;
use sui::event;
use sui::table::{Self, Table};
use pyth::pyth;
use pyth::price;
use pyth::i64;
use pyth::price_info::{Self, PriceInfoObject};
use pyth::price_identifier;
use enclave::enclave::{Self, Enclave, EnclaveConfig};

// ---------- errors ----------
const EPaused: u64 = 1;
const EQuoteExpired: u64 = 2;
const EBadQuoteSig: u64 = 3;
const EQuoteUsed: u64 = 4;
const EInsufficientPayment: u64 = 5;
const EInsufficientCapacity: u64 = 6;
const ENotActive: u64 = 7;
const EWrongKind: u64 = 8;
const EOutsideWindow: u64 = 9;
const EWrongFeed: u64 = 10;
const EPriceTooUncertain: u64 = 11;
const ENotBreached: u64 = 12;
const EBreachAlreadyReported: u64 = 13;
const ENoBreach: u64 = 14;
const ETooEarly: u64 = 15;
const EBadAttestation: u64 = 16;
const EWrongPool: u64 = 17;
const EStaleEnclave: u64 = 18;
const ENotExpired: u64 = 19;
const EBadSeq: u64 = 20;
const EBadParams: u64 = 21;
const ENegativePrice: u64 = 22;
const EInsufficientFree: u64 = 23;
const EPriceAbove: u64 = 24;

// ---------- constants ----------
const KIND_PRICE: u8 = 0;
const KIND_LIQ: u8 = 1;
const STATUS_ACTIVE: u8 = 0;
const STATUS_PAID: u8 = 1;
const STATUS_EXPIRED: u8 = 2;
const LIQUIDATION_INTENT: u8 = 1;
const QUOTE_DOMAIN: vector<u8> = b"ghostwriter.quote.v1";

// ---------- types ----------
/// One-time witness; also the type tag for Enclave<GHOSTWRITER>.
public struct GHOSTWRITER has drop {}

public struct AdminCap has key, store { id: UID }

public struct Pool<phantom C> has key {
    id: UID,
    vault: Balance<C>,
    locked: u64,
    quote_pubkey: vector<u8>,
    premiums_collected: u64,
    payouts_made: u64,
    confirm_delay_ms: u64,
    max_conf_bps: u64,
    max_price_age_s: u64,
    paused: bool,
    used_quotes: Table<vector<u8>, bool>,
}

public struct Policy<phantom C> has key {
    id: UID,
    pool_id: ID,
    holder: address,
    kind: u8,
    feed_id: vector<u8>,
    strike_e8: u64,
    obligation_id: address,
    payout: u64,
    premium: u64,
    start_ms: u64,
    end_ms: u64,
    quote_id: vector<u8>,
    status: u8,
    breach_started_ms: u64,
}

public struct Ledger has key {
    id: UID,
    borrower: address,
    memwal_account: address,
    seq: u64,
    head: vector<u8>,
}

public struct QuoteMessage has copy, drop {
    domain: vector<u8>,
    pool_id: ID,
    buyer: address,
    kind: u8,
    feed_id: vector<u8>,
    strike_e8: u64,
    obligation_id: address,
    payout: u64,
    premium: u64,
    start_ms: u64,
    end_ms: u64,
    quote_id: vector<u8>,
    expires_ms: u64,
}

/// Must match the Rust struct in the enclave field-for-field (BCS is order sensitive).
public struct LiquidationAttestation has copy, drop {
    obligation_id: address,
    tx_digest: vector<u8>,
    repay_amount: u64,
    withdraw_amount: u64,
}

// ---------- events ----------
public struct PoolCreated has copy, drop { pool_id: ID }
public struct PolicyBought has copy, drop {
    policy_id: ID, pool_id: ID, holder: address, kind: u8, payout: u64, premium: u64,
    start_ms: u64, end_ms: u64, quote_id: vector<u8>,
}
public struct BreachReported has copy, drop { policy_id: ID, price_e8: u64, at_ms: u64 }
public struct BreachReset has copy, drop { policy_id: ID, price_e8: u64, at_ms: u64 }
public struct PolicyPaid has copy, drop { policy_id: ID, holder: address, payout: u64, path: u8, evidence: vector<u8> }
public struct PolicyExpired has copy, drop { policy_id: ID }
public struct LedgerCreated has copy, drop { ledger_id: ID, borrower: address, memwal_account: address }
public struct Anchored has copy, drop { ledger_id: ID, borrower: address, seq: u64, head: vector<u8>, at_ms: u64 }

// ---------- init ----------
fun init(otw: GHOSTWRITER, ctx: &mut TxContext) {
    let cap = enclave::new_cap(otw, ctx);
    // Placeholder PCRs; replace with real ones via enclave::update_pcrs after building the enclave.
    cap.create_enclave_config(
        b"ghostwriter liquidation enclave".to_string(),
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        ctx,
    );
    transfer::public_transfer(cap, ctx.sender());
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// ---------- admin ----------
public fun create_pool<C>(
    _: &AdminCap,
    quote_pubkey: vector<u8>,
    confirm_delay_ms: u64,
    max_conf_bps: u64,
    max_price_age_s: u64,
    ctx: &mut TxContext,
) {
    assert!(quote_pubkey.length() == 32, EBadParams);
    assert!(max_conf_bps > 0 && max_conf_bps <= 10_000 && max_price_age_s > 0, EBadParams);
    let pool = Pool<C> {
        id: object::new(ctx),
        vault: balance::zero(),
        locked: 0,
        quote_pubkey,
        premiums_collected: 0,
        payouts_made: 0,
        confirm_delay_ms,
        max_conf_bps,
        max_price_age_s,
        paused: false,
        used_quotes: table::new(ctx),
    };
    event::emit(PoolCreated { pool_id: object::id(&pool) });
    transfer::share_object(pool);
}

public fun deposit<C>(pool: &mut Pool<C>, _: &AdminCap, coin: Coin<C>) {
    pool.vault.join(coin.into_balance());
}

public fun withdraw<C>(pool: &mut Pool<C>, _: &AdminCap, amount: u64, ctx: &mut TxContext): Coin<C> {
    assert!(free(pool) >= amount, EInsufficientFree);
    coin::from_balance(pool.vault.split(amount), ctx)
}

public fun set_paused<C>(pool: &mut Pool<C>, _: &AdminCap, paused: bool) { pool.paused = paused; }

public fun set_quote_pubkey<C>(pool: &mut Pool<C>, _: &AdminCap, pk: vector<u8>) {
    assert!(pk.length() == 32, EBadParams);
    pool.quote_pubkey = pk;
}

fun free<C>(pool: &Pool<C>): u64 { pool.vault.value() - pool.locked }

// ---------- buy ----------
public fun buy<C>(
    pool: &mut Pool<C>,
    kind: u8,
    feed_id: vector<u8>,
    strike_e8: u64,
    obligation_id: address,
    payout: u64,
    premium: u64,
    start_ms: u64,
    end_ms: u64,
    quote_id: vector<u8>,
    expires_ms: u64,
    signature: vector<u8>,
    mut payment: Coin<C>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!pool.paused, EPaused);
    let now = clock.timestamp_ms();
    assert!(now <= expires_ms, EQuoteExpired);
    assert!(kind == KIND_PRICE || kind == KIND_LIQ, EWrongKind);
    assert!(end_ms > start_ms && end_ms > now && payout > 0, EBadParams);
    assert!(!pool.used_quotes.contains(quote_id), EQuoteUsed);

    let msg = QuoteMessage {
        domain: QUOTE_DOMAIN,
        pool_id: object::id(pool),
        buyer: ctx.sender(),
        kind,
        feed_id,
        strike_e8,
        obligation_id,
        payout,
        premium,
        start_ms,
        end_ms,
        quote_id,
        expires_ms,
    };
    let bytes = bcs::to_bytes(&msg);
    assert!(ed25519::ed25519_verify(&signature, &pool.quote_pubkey, &bytes), EBadQuoteSig);

    assert!(payment.value() >= premium, EInsufficientPayment);
    let paid = payment.split(premium, ctx);
    if (payment.value() == 0) { payment.destroy_zero() } else { transfer::public_transfer(payment, ctx.sender()) };
    pool.vault.join(paid.into_balance());
    pool.premiums_collected = pool.premiums_collected + premium;

    assert!(free(pool) >= payout, EInsufficientCapacity);
    pool.locked = pool.locked + payout;
    pool.used_quotes.add(quote_id, true);

    let policy = Policy<C> {
        id: object::new(ctx),
        pool_id: object::id(pool),
        holder: ctx.sender(),
        kind,
        feed_id,
        strike_e8,
        obligation_id,
        payout,
        premium,
        start_ms,
        end_ms,
        quote_id,
        status: STATUS_ACTIVE,
        breach_started_ms: 0,
    };
    event::emit(PolicyBought {
        policy_id: object::id(&policy),
        pool_id: object::id(pool),
        holder: ctx.sender(),
        kind,
        payout,
        premium,
        start_ms,
        end_ms,
        quote_id,
    });
    transfer::share_object(policy);
}

// ---------- price path ----------
fun pow10(n: u64): u64 {
    let mut r = 1;
    let mut i = 0;
    while (i < n) { r = r * 10; i = i + 1; };
    r
}

/// Converts a Pyth magnitude with expo -neg_expo to USD * 1e8.
public fun scale_to_e8(v: u64, neg_expo: u64): u64 {
    if (neg_expo == 8) v
    else if (neg_expo < 8) v * pow10(8 - neg_expo)
    else v / pow10(neg_expo - 8)
}

fun price_e8<C>(pool: &Pool<C>, policy: &Policy<C>, pio: &PriceInfoObject, clock: &Clock): u64 {
    let info = price_info::get_price_info_from_price_info_object(pio);
    let id = price_identifier::get_bytes(&price_info::get_price_identifier(&info));
    assert!(id == policy.feed_id, EWrongFeed);
    let p = pyth::get_price_no_older_than(pio, clock, pool.max_price_age_s);
    let raw = price::get_price(&p);
    assert!(!i64::get_is_negative(&raw), ENegativePrice);
    let mag = i64::get_magnitude_if_positive(&raw);
    let conf = price::get_conf(&p);
    assert!(mag > 0 && conf * 10_000 <= mag * pool.max_conf_bps, EPriceTooUncertain);
    let expo = price::get_expo(&p);
    assert!(i64::get_is_negative(&expo), EBadParams);
    scale_to_e8(mag, i64::get_magnitude_if_negative(&expo))
}

fun assert_live<C>(pool: &Pool<C>, policy: &Policy<C>, kind: u8) {
    assert!(policy.pool_id == object::id(pool), EWrongPool);
    assert!(policy.status == STATUS_ACTIVE, ENotActive);
    assert!(policy.kind == kind, EWrongKind);
}

public fun report_breach<C>(pool: &Pool<C>, policy: &mut Policy<C>, pio: &PriceInfoObject, clock: &Clock) {
    assert_live(pool, policy, KIND_PRICE);
    assert!(policy.breach_started_ms == 0, EBreachAlreadyReported);
    let now = clock.timestamp_ms();
    assert!(now >= policy.start_ms && now <= policy.end_ms, EOutsideWindow);
    let p = price_e8(pool, policy, pio, clock);
    assert!(p <= policy.strike_e8, ENotBreached);
    policy.breach_started_ms = now;
    event::emit(BreachReported { policy_id: object::id(policy), price_e8: p, at_ms: now });
}

public fun reset_breach<C>(pool: &Pool<C>, policy: &mut Policy<C>, pio: &PriceInfoObject, clock: &Clock) {
    assert_live(pool, policy, KIND_PRICE);
    assert!(policy.breach_started_ms != 0, ENoBreach);
    let p = price_e8(pool, policy, pio, clock);
    assert!(p > policy.strike_e8, EPriceAbove);
    policy.breach_started_ms = 0;
    event::emit(BreachReset { policy_id: object::id(policy), price_e8: p, at_ms: clock.timestamp_ms() });
}

public fun confirm_breach<C>(
    pool: &mut Pool<C>,
    policy: &mut Policy<C>,
    pio: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_live(pool, policy, KIND_PRICE);
    assert!(policy.breach_started_ms != 0, ENoBreach);
    let now = clock.timestamp_ms();
    assert!(now >= policy.breach_started_ms + pool.confirm_delay_ms, ETooEarly);
    // Settlement must happen inside the cover window plus the confirm grace period.
    // Without this the contract would rely on the off-chain watcher calling `expire`
    // or `reset_breach`: a holder who reports a breach and never resets it could
    // otherwise confirm on any later dip below the strike, long after the cover ended.
    assert!(now <= policy.end_ms + pool.confirm_delay_ms, EOutsideWindow);
    let p = price_e8(pool, policy, pio, clock);
    assert!(p <= policy.strike_e8, ENotBreached);
    pay(pool, policy, 0, vector[], ctx);
}

// ---------- liquidation path ----------
public fun settle_liquidation<C>(
    pool: &mut Pool<C>,
    policy: &mut Policy<C>,
    enclave: &Enclave<GHOSTWRITER>,
    config: &EnclaveConfig<GHOSTWRITER>,
    tx_digest: vector<u8>,
    repay_amount: u64,
    withdraw_amount: u64,
    timestamp_ms: u64,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_live(pool, policy, KIND_LIQ);
    assert!(enclave.config_version() == config.version(), EStaleEnclave);
    assert!(timestamp_ms >= policy.start_ms && timestamp_ms <= policy.end_ms, EOutsideWindow);
    let att = LiquidationAttestation {
        obligation_id: policy.obligation_id,
        tx_digest,
        repay_amount,
        withdraw_amount,
    };
    assert!(enclave.verify_signature(LIQUIDATION_INTENT, timestamp_ms, att, &signature), EBadAttestation);
    pay(pool, policy, 1, tx_digest, ctx);
}

// ---------- shared payout / expiry ----------
fun pay<C>(pool: &mut Pool<C>, policy: &mut Policy<C>, path: u8, evidence: vector<u8>, ctx: &mut TxContext) {
    let amount = policy.payout;
    pool.locked = pool.locked - amount;
    pool.payouts_made = pool.payouts_made + amount;
    policy.status = STATUS_PAID;
    let c = coin::from_balance(pool.vault.split(amount), ctx);
    transfer::public_transfer(c, policy.holder);
    event::emit(PolicyPaid { policy_id: object::id(policy), holder: policy.holder, payout: amount, path, evidence });
}

public fun expire<C>(pool: &mut Pool<C>, policy: &mut Policy<C>, clock: &Clock) {
    assert!(policy.pool_id == object::id(pool), EWrongPool);
    assert!(policy.status == STATUS_ACTIVE, ENotActive);
    assert!(clock.timestamp_ms() > policy.end_ms + pool.confirm_delay_ms, ENotExpired);
    pool.locked = pool.locked - policy.payout;
    policy.status = STATUS_EXPIRED;
    event::emit(PolicyExpired { policy_id: object::id(policy) });
}

// ---------- borrower ledger anchors ----------
public fun create_ledger(_: &AdminCap, borrower: address, memwal_account: address, ctx: &mut TxContext) {
    let l = Ledger { id: object::new(ctx), borrower, memwal_account, seq: 0, head: vector[] };
    event::emit(LedgerCreated { ledger_id: object::id(&l), borrower, memwal_account });
    transfer::share_object(l);
}

public fun anchor(_: &AdminCap, ledger: &mut Ledger, seq: u64, head: vector<u8>, clock: &Clock) {
    assert!(seq == ledger.seq + 1 && head.length() == 32, EBadSeq);
    ledger.seq = seq;
    ledger.head = head;
    event::emit(Anchored { ledger_id: object::id(ledger), borrower: ledger.borrower, seq, head, at_ms: clock.timestamp_ms() });
}

// ---------- views ----------
public fun policy_status<C>(p: &Policy<C>): u8 { p.status }
public fun pool_free<C>(p: &Pool<C>): u64 { free(p) }

public fun pool_locked<C>(p: &Pool<C>): u64 { p.locked }
public fun pool_vault<C>(p: &Pool<C>): u64 { p.vault.value() }
public fun ledger_seq(l: &Ledger): u64 { l.seq }

#[test_only]
public fun name_for_testing(): String { b"ghostwriter".to_string() }

#[test_only]
public fun admin_cap_for_testing(ctx: &mut TxContext): AdminCap { AdminCap { id: object::new(ctx) } }

/// Shares an `EnclaveConfig<GHOSTWRITER>` at version 0 and hands back its `Cap`, exactly as `init`
/// does. Tests of `settle_liquidation` need both, and only this module can make them: the config is
/// created from the one-time witness, which is not constructible anywhere else.
#[test_only]
public fun enclave_config_for_testing(ctx: &mut TxContext): enclave::Cap<GHOSTWRITER> {
    let cap = enclave::new_cap(GHOSTWRITER {}, ctx);
    cap.create_enclave_config(
        b"ghostwriter liquidation enclave".to_string(),
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        ctx,
    );
    cap
}

/// The exact bytes `buy` verifies the quote signature over.
#[test_only]
public fun quote_bytes_for_testing(
    pool_id: ID, buyer: address, kind: u8, feed_id: vector<u8>, strike_e8: u64, obligation_id: address,
    payout: u64, premium: u64, start_ms: u64, end_ms: u64, quote_id: vector<u8>, expires_ms: u64,
): vector<u8> {
    bcs::to_bytes(&QuoteMessage {
        domain: QUOTE_DOMAIN, pool_id, buyer, kind, feed_id, strike_e8, obligation_id,
        payout, premium, start_ms, end_ms, quote_id, expires_ms,
    })
}
