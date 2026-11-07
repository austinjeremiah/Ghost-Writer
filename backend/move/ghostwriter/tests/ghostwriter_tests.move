#[test_only]
module ghostwriter::ghostwriter_tests;

use ghostwriter::ghostwriter::{Self, AdminCap, Pool, Policy, Ledger};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const ADMIN: address = @0xA;
const BUYER: address = @0xB;

/// Ed25519 public key for the fixed test seed 0x01 * 32 (see SIGS below).
const QUOTE_PK: vector<u8> = x"8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";

const FEED: vector<u8> = x"23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";
const STRIKE: u64 = 86_000_000; // $0.86
const PAYOUT: u64 = 10_000_000; // 10 DUSDC-equivalent units
const PREMIUM: u64 = 420_000;
const START: u64 = 1_000;
const END: u64 = 1_000_000;
const EXPIRES: u64 = 5_000;
const CONFIRM_DELAY: u64 = 120_000;
const VAULT: u64 = 100_000_000;

// Signatures over quote_bytes_for_testing(...) with the test key, one per quote id used below.
// Regenerate: run `sui move test print_quote_bytes`, sign each printed message with seed 0x01*32
// (e.g. @noble/curves ed25519.sign). They depend on the pool's object id, so they change if
// setup() creates objects in a different order.
const SIG_Q1: vector<u8> = x"6f65002f5c1454d7e5f8fa197d275fa5c91c79ed4c7fc2c0144b2c462b478fec41bfe7e9c7ff1537adabb4a9fdb15cadf86622319e9889a1df448ebc4af11406";
const SIG_BIG: vector<u8> = x"4739202be8857c1ebad10d7beafc69278ec16736f8ffcf043fc089f85b7a7e1233a0bfdb1fafbe0b549d6724a7fec517a04ef294f2affab3874cd65b2a767a01";

// ---------- helpers ----------
fun setup(): (Scenario, Clock) {
    let mut s = ts::begin(ADMIN);
    let cap = ghostwriter::admin_cap_for_testing(s.ctx());
    ghostwriter::create_pool<SUI>(&cap, QUOTE_PK, CONFIRM_DELAY, 200, 60, s.ctx());
    transfer::public_transfer(cap, ADMIN);
    s.next_tx(ADMIN);
    {
        let cap = s.take_from_sender<AdminCap>();
        let mut pool = s.take_shared<Pool<SUI>>();
        ghostwriter::deposit(&mut pool, &cap, coin::mint_for_testing<SUI>(VAULT, s.ctx()));
        ts::return_shared(pool);
        s.return_to_sender(cap);
    };
    let mut clock = clock::create_for_testing(s.ctx());
    clock.set_for_testing(START);
    (s, clock)
}

fun buy_as(s: &mut Scenario, clock: &Clock, payout: u64, quote_id: vector<u8>, sig: vector<u8>, paid: u64) {
    s.next_tx(BUYER);
    let mut pool = s.take_shared<Pool<SUI>>();
    ghostwriter::buy(
        &mut pool, 0, FEED, STRIKE, @0x0, payout, PREMIUM, START, END, quote_id, EXPIRES, sig,
        coin::mint_for_testing<SUI>(paid, s.ctx()), clock, s.ctx(),
    );
    ts::return_shared(pool);
}

fun finish(s: Scenario, clock: Clock) {
    clock.destroy_for_testing();
    s.end();
}

// ---------- pure helpers ----------
#[test]
fun scale_matches_e8() {
    assert!(ghostwriter::scale_to_e8(68005477, 8) == 68005477, 0);
    assert!(ghostwriter::scale_to_e8(6800, 4) == 68000000, 1);
    assert!(ghostwriter::scale_to_e8(6800547700, 10) == 68005477, 2);
}

#[test]
fun test_name() {
    assert!(ghostwriter::name_for_testing() == b"ghostwriter".to_string(), 0);
}

/// Prints the bytes each signed quote below covers, so the SIG_* constants can be regenerated.
#[test]
fun print_quote_bytes() {
    let (mut s, clock) = setup();
    s.next_tx(BUYER);
    let pool = s.take_shared<Pool<SUI>>();
    let id = object::id(&pool);
    std::debug::print(&ghostwriter::quote_bytes_for_testing(id, BUYER, 0, FEED, STRIKE, @0x0, PAYOUT, PREMIUM, START, END, b"q1", EXPIRES));
    std::debug::print(&ghostwriter::quote_bytes_for_testing(id, BUYER, 0, FEED, STRIKE, @0x0, VAULT * 2, PREMIUM, START, END, b"big", EXPIRES));
    ts::return_shared(pool);
    finish(s, clock);
}

// ---------- buy ----------
#[test]
fun buy_locks_payout_and_takes_premium() {
    let (mut s, clock) = setup();
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM + 5); // overpay: change goes back
    s.next_tx(BUYER);
    {
        let pool = s.take_shared<Pool<SUI>>();
        assert!(ghostwriter::pool_vault(&pool) == VAULT + PREMIUM, 0);
        assert!(ghostwriter::pool_locked(&pool) == PAYOUT, 1);
        assert!(ghostwriter::pool_free(&pool) == VAULT + PREMIUM - PAYOUT, 2);
        ts::return_shared(pool);
        let policy = s.take_shared<Policy<SUI>>();
        assert!(ghostwriter::policy_status(&policy) == 0, 3);
        ts::return_shared(policy);
        let change = s.take_from_sender<coin::Coin<SUI>>();
        assert!(change.value() == 5, 4);
        s.return_to_sender(change);
    };
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EBadQuoteSig)]
fun buy_rejects_bad_signature() {
    let (mut s, clock) = setup();
    let mut sig = SIG_Q1;
    let last = sig.length() - 1;
    *&mut sig[last] = sig[last] ^ 1;
    buy_as(&mut s, &clock, PAYOUT, b"q1", sig, PREMIUM);
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EBadQuoteSig)]
fun buy_rejects_changed_terms() {
    let (mut s, clock) = setup();
    buy_as(&mut s, &clock, PAYOUT + 1, b"q1", SIG_Q1, PREMIUM); // signature was for PAYOUT
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EQuoteUsed)]
fun buy_rejects_reused_quote() {
    let (mut s, clock) = setup();
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EQuoteExpired)]
fun buy_rejects_expired_quote() {
    let (mut s, mut clock) = setup();
    clock.set_for_testing(EXPIRES + 1);
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EInsufficientPayment)]
fun buy_rejects_underpayment() {
    let (mut s, clock) = setup();
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM - 1);
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EInsufficientCapacity)]
fun buy_rejects_payout_above_free_capacity() {
    let (mut s, clock) = setup();
    buy_as(&mut s, &clock, VAULT * 2, b"big", SIG_BIG, PREMIUM);
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EPaused)]
fun buy_rejects_when_paused() {
    let (mut s, clock) = setup();
    s.next_tx(ADMIN);
    {
        let cap = s.take_from_sender<AdminCap>();
        let mut pool = s.take_shared<Pool<SUI>>();
        ghostwriter::set_paused(&mut pool, &cap, true);
        ts::return_shared(pool);
        s.return_to_sender(cap);
    };
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    finish(s, clock);
}

// ---------- expiry ----------
#[test, expected_failure(abort_code = ghostwriter::ENotExpired)]
fun expire_rejects_before_end_plus_grace() {
    let (mut s, mut clock) = setup();
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    clock.set_for_testing(END + CONFIRM_DELAY); // not strictly after end + grace yet
    s.next_tx(ADMIN);
    let mut pool = s.take_shared<Pool<SUI>>();
    let mut policy = s.take_shared<Policy<SUI>>();
    ghostwriter::expire(&mut pool, &mut policy, &clock);
    ts::return_shared(policy);
    ts::return_shared(pool);
    finish(s, clock);
}

#[test]
fun expire_unlocks_payout() {
    let (mut s, mut clock) = setup();
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    clock.set_for_testing(END + CONFIRM_DELAY + 1);
    s.next_tx(ADMIN);
    {
        let mut pool = s.take_shared<Pool<SUI>>();
        let mut policy = s.take_shared<Policy<SUI>>();
        ghostwriter::expire(&mut pool, &mut policy, &clock);
        assert!(ghostwriter::policy_status(&policy) == 2, 0);
        assert!(ghostwriter::pool_locked(&pool) == 0, 1);
        assert!(ghostwriter::pool_free(&pool) == VAULT + PREMIUM, 2);
        ts::return_shared(policy);
        ts::return_shared(pool);
    };
    finish(s, clock);
}

// ---------- admin ----------
#[test, expected_failure(abort_code = ghostwriter::EInsufficientFree)]
fun withdraw_cannot_touch_locked_funds() {
    let (mut s, clock) = setup();
    buy_as(&mut s, &clock, PAYOUT, b"q1", SIG_Q1, PREMIUM);
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut pool = s.take_shared<Pool<SUI>>();
    let c = ghostwriter::withdraw(&mut pool, &cap, VAULT + PREMIUM - PAYOUT + 1, s.ctx());
    transfer::public_transfer(c, ADMIN);
    ts::return_shared(pool);
    s.return_to_sender(cap);
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EBadParams)]
fun create_pool_rejects_short_pubkey() {
    let mut s = ts::begin(ADMIN);
    let cap = ghostwriter::admin_cap_for_testing(s.ctx());
    ghostwriter::create_pool<SUI>(&cap, x"0102", CONFIRM_DELAY, 200, 60, s.ctx());
    transfer::public_transfer(cap, ADMIN);
    s.end();
}

// ---------- ledger ----------
#[test]
fun ledger_anchors_in_sequence() {
    let (mut s, clock) = setup();
    s.next_tx(ADMIN);
    {
        let cap = s.take_from_sender<AdminCap>();
        ghostwriter::create_ledger(&cap, BUYER, @0xC, s.ctx());
        s.return_to_sender(cap);
    };
    s.next_tx(ADMIN);
    {
        let cap = s.take_from_sender<AdminCap>();
        let mut ledger = s.take_shared<Ledger>();
        ghostwriter::anchor(&cap, &mut ledger, 1, x"1111111111111111111111111111111111111111111111111111111111111111", &clock);
        ghostwriter::anchor(&cap, &mut ledger, 2, x"2222222222222222222222222222222222222222222222222222222222222222", &clock);
        assert!(ghostwriter::ledger_seq(&ledger) == 2, 0);
        ts::return_shared(ledger);
        s.return_to_sender(cap);
    };
    finish(s, clock);
}

#[test, expected_failure(abort_code = ghostwriter::EBadSeq)]
fun ledger_rejects_skipped_seq() {
    let (mut s, clock) = setup();
    s.next_tx(ADMIN);
    {
        let cap = s.take_from_sender<AdminCap>();
        ghostwriter::create_ledger(&cap, BUYER, @0xC, s.ctx());
        s.return_to_sender(cap);
    };
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<AdminCap>();
    let mut ledger = s.take_shared<Ledger>();
    ghostwriter::anchor(&cap, &mut ledger, 2, x"2222222222222222222222222222222222222222222222222222222222222222", &clock);
    ts::return_shared(ledger);
    s.return_to_sender(cap);
    finish(s, clock);
}
